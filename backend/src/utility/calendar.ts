import { eq } from "drizzle-orm";
import { google, type calendar_v3 } from "googleapis";
import { userPreferences } from "../../../database/schema/user-preferences";
import { AppError } from "./AppError";
import { db } from "./db";
import { callGoogle } from "./googleCall";

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string; // ISO 8601 with offset, or YYYY-MM-DD for all-day events
  end: string; // for all-day events this is exclusive (Google's convention)
  allDay: boolean;
  location: string | null;
  attendees: { email: string; name: string | null; responseStatus: string | null; self: boolean }[];
  organizer: { email: string; name: string | null; self: boolean } | null;
  status: string; // confirmed | tentative | cancelled
  transparency: "opaque" | "transparent"; // opaque = shows as busy
  meetingLink: string | null;
  sourceUrl: string | null;
}

export interface EventRef {
  id: string;
  title: string;
  start: string;
  end: string;
  sourceUrl: string | null;
}

export interface Conflict {
  first: EventRef;
  second: EventRef;
  overlapMinutes: number;
}

export interface TimeWindow {
  timeMin: Date;
  timeMax: Date;
  timezone: string;
}

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_WINDOW_DAYS = 62;

// ---------- timezone helpers (no library) ----------

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsOf(at: Date, tz: string) {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, fmt);
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return {
    year: p.year ?? 1970,
    month: p.month ?? 1,
    day: p.day ?? 1,
    hour: p.hour ?? 0,
    minute: p.minute ?? 0,
    second: p.second ?? 0,
  };
}

// How far ahead of UTC this timezone is at the given moment.
function tzOffsetMs(at: Date, tz: string): number {
  const p = partsOf(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The real moment when the wall clock in `tz` reads y-m-d h:mm. Day overflow (d+1, d+7) is fine.
function localToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  let utc = guess - tzOffsetMs(new Date(guess), tz);
  utc = guess - tzOffsetMs(new Date(utc), tz); // second pass handles daylight-saving edges
  return new Date(utc);
}

const pad = (n: number) => String(n).padStart(2, "0");

function toZonedIso(at: Date, tz: string): string {
  const p = partsOf(at, tz);
  const off = tzOffsetMs(at, tz);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off) / MIN_MS;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export async function getUserTimezone(userId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: userPreferences.timezone })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.timezone ?? "UTC";
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

function parseBoundary(value: string, tz: string, kind: "from" | "to"): Date {
  const m = DATE_ONLY.exec(value);
  if (m) {
    // "to=2026-11-07" means "up to the end of the 7th", so use the start of the 8th.
    return localToUtc(Number(m[1]), Number(m[2]), Number(m[3]) + (kind === "to" ? 1 : 0), 0, 0, tz);
  }
  if (!HAS_OFFSET.test(value)) {
    throw new AppError(
      400,
      `"${kind}" must be YYYY-MM-DD or an ISO datetime with an offset (like Z or +05:30).`,
      "INVALID_DATE",
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `"${kind}" is not a valid date.`, "INVALID_DATE");
  return date;
}

// Turns optional from/to strings into a real window in the user's timezone.
// Defaults: from = start of today, to = 7 days later.
export async function resolveWindow(userId: string, from?: string, to?: string): Promise<TimeWindow> {
  const timezone = await getUserTimezone(userId);
  let timeMin: Date;
  if (from) timeMin = parseBoundary(from, timezone, "from");
  else {
    const today = partsOf(new Date(), timezone);
    timeMin = localToUtc(today.year, today.month, today.day, 0, 0, timezone);
  }
  const timeMax = to ? parseBoundary(to, timezone, "to") : new Date(timeMin.getTime() + 7 * DAY_MS);

  if (timeMax <= timeMin) throw new AppError(400, `"to" must be after "from".`, "INVALID_WINDOW");
  if (timeMax.getTime() - timeMin.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    throw new AppError(400, `The window can be at most ${MAX_WINDOW_DAYS} days.`, "WINDOW_TOO_LARGE");
  }
  return { timeMin, timeMax, timezone };
}

// ---------- normalizing Google's events ----------

function boundary(t: calendar_v3.Schema$EventDateTime | undefined, tz: string) {
  if (t?.dateTime) return { value: toZonedIso(new Date(t.dateTime), tz), allDay: false };
  return { value: t?.date ?? "", allDay: true };
}

function normalizeEvent(ev: calendar_v3.Schema$Event, calendarId: string, tz: string): CalendarEvent {
  const start = boundary(ev.start, tz);
  const end = boundary(ev.end, tz);
  const videoEntry = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");

  return {
    id: ev.id ?? "",
    calendarId,
    title: ev.summary ?? "(no title)",
    start: start.value,
    end: end.value,
    allDay: start.allDay,
    location: ev.location ?? null,
    attendees: (ev.attendees ?? []).map((a) => ({
      email: (a.email ?? "").toLowerCase(),
      name: a.displayName ?? null,
      responseStatus: a.responseStatus ?? null,
      self: Boolean(a.self),
    })),
    organizer: ev.organizer
      ? { email: (ev.organizer.email ?? "").toLowerCase(), name: ev.organizer.displayName ?? null, self: Boolean(ev.organizer.self) }
      : null,
    status: ev.status ?? "confirmed",
    transparency: ev.transparency === "transparent" ? "transparent" : "opaque",
    meetingLink: ev.hangoutLink ?? videoEntry?.uri ?? null,
    sourceUrl: ev.htmlLink ?? null,
  };
}

// ---------- public service functions (each one is a future agent tool) ----------

export interface ListEventsInput {
  timeMin: Date;
  timeMax: Date;
  calendarId?: string | undefined;
  maxResults?: number | undefined;
  timezone?: string | undefined; // pass it in if you already have it, saves one DB read
}

export async function listEvents(userId: string, input: ListEventsInput): Promise<CalendarEvent[]> {
  const tz = input.timezone ?? (await getUserTimezone(userId));
  const calendarId = input.calendarId ?? "primary";

  return callGoogle(userId, "calendar", async ({ client }) => {
    const calendar = google.calendar({ version: "v3", auth: client });
    const res = await calendar.events.list({
      calendarId,
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      singleEvents: true, // expands recurring events into real occurrences
      orderBy: "startTime",
      maxResults: input.maxResults ?? 100,
    });
    return (res.data.items ?? []).map((ev) => normalizeEvent(ev, calendarId, tz));
  });
}

export async function getEvent(userId: string, eventId: string, calendarId = "primary"): Promise<CalendarEvent> {
  const tz = await getUserTimezone(userId);
  return callGoogle(userId, "calendar", async ({ client }) => {
    const calendar = google.calendar({ version: "v3", auth: client });
    const res = await calendar.events.get({ calendarId, eventId });
    return normalizeEvent(res.data, calendarId, tz);
  });
}

type Interval = [number, number];

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function subtractBusy(window: Interval, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window[0];
  for (const [s, e] of busy) {
    if (e <= cursor) continue;
    if (s >= window[1]) break;
    if (s > cursor) free.push([cursor, Math.min(s, window[1])]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < window[1]) free.push([cursor, window[1]]);
  return free;
}

export interface FreeBusyInput {
  timeMin: Date;
  timeMax: Date;
  calendarIds?: string[] | undefined;
  timezone?: string | undefined;
}

export async function getFreeBusy(userId: string, input: FreeBusyInput) {
  const tz = input.timezone ?? (await getUserTimezone(userId));
  const calendarIds = input.calendarIds?.length ? input.calendarIds : ["primary"];

  return callGoogle(userId, "calendar", async ({ client }) => {
    const calendar = google.calendar({ version: "v3", auth: client });
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: input.timeMin.toISOString(),
        timeMax: input.timeMax.toISOString(),
        timeZone: tz,
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const calendars: Record<string, { busy: { start: string; end: string }[]; errors: string[] }> = {};
    const all: Interval[] = [];
    for (const [id, data] of Object.entries(res.data.calendars ?? {})) {
      const busy = (data.busy ?? []).filter((b) => b.start && b.end);
      calendars[id] = {
        busy: busy.map((b) => ({
          start: toZonedIso(new Date(b.start as string), tz),
          end: toZonedIso(new Date(b.end as string), tz),
        })),
        errors: (data.errors ?? []).map((e) => e.reason ?? "unknown"),
      };
      for (const b of busy) all.push([Date.parse(b.start as string), Date.parse(b.end as string)]);
    }

    const busy = mergeIntervals(all).map(([s, e]) => ({
      start: toZonedIso(new Date(s), tz),
      end: toZonedIso(new Date(e), tz),
    }));
    return { timezone: tz, calendars, busy };
  });
}

export interface FreeSlotsInput extends FreeBusyInput {
  minMinutes?: number | undefined;
  workingHours?: { startHour: number; endHour: number } | undefined; // local hours, e.g. 9 and 18
}

export async function findFreeSlots(userId: string, input: FreeSlotsInput) {
  const tz = input.timezone ?? (await getUserTimezone(userId));
  const minMinutes = input.minMinutes ?? 30;
  const fb = await getFreeBusy(userId, { ...input, timezone: tz });
  const busy: Interval[] = fb.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)]);

  // Never offer slots in the past.
  const windowStart = Math.max(input.timeMin.getTime(), Date.now());
  const windowEnd = input.timeMax.getTime();

  const windows: Interval[] = [];
  if (windowStart < windowEnd) {
    const wh = input.workingHours;
    if (!wh) windows.push([windowStart, windowEnd]);
    else {
      const first = partsOf(new Date(windowStart), tz);
      for (let i = 0; i < MAX_WINDOW_DAYS + 2; i++) {
        const dayStart = localToUtc(first.year, first.month, first.day + i, wh.startHour, 0, tz).getTime();
        const dayEnd = localToUtc(first.year, first.month, first.day + i, wh.endHour, 0, tz).getTime();
        if (dayStart >= windowEnd) break;
        const s = Math.max(dayStart, windowStart);
        const e = Math.min(dayEnd, windowEnd);
        if (s < e) windows.push([s, e]);
      }
    }
  }

  const slots = windows
    .flatMap((w) => subtractBusy(w, busy))
    .filter(([s, e]) => e - s >= minMinutes * MIN_MS)
    .map(([s, e]) => ({
      start: toZonedIso(new Date(s), tz),
      end: toZonedIso(new Date(e), tz),
      minutes: Math.floor((e - s) / MIN_MS),
    }));

  return {
    timezone: tz,
    window: { from: toZonedIso(input.timeMin, tz), to: toZonedIso(input.timeMax, tz) },
    minMinutes,
    workingHours: input.workingHours ?? null,
    busy: fb.busy,
    calendarErrors: Object.fromEntries(Object.entries(fb.calendars).filter(([, c]) => c.errors.length > 0).map(([id, c]) => [id, c.errors])),
    slots,
  };
}

// Pure function. Skips all-day, cancelled, "free" (transparent) and events you declined.
export function findConflicts(events: CalendarEvent[]): Conflict[] {
  const relevant = events
    .filter((e) => !e.allDay && e.status !== "cancelled" && e.transparency === "opaque")
    .filter((e) => e.attendees.find((a) => a.self)?.responseStatus !== "declined")
    .map((e) => ({ e, s: Date.parse(e.start), f: Date.parse(e.end) }))
    .filter((x) => !Number.isNaN(x.s) && !Number.isNaN(x.f))
    .sort((a, b) => a.s - b.s);

  const ref = (e: CalendarEvent): EventRef => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    sourceUrl: e.sourceUrl,
  });

  const conflicts: Conflict[] = [];
  for (let i = 0; i < relevant.length; i++) {
    const a = relevant[i] as (typeof relevant)[number];
    for (let j = i + 1; j < relevant.length; j++) {
      const b = relevant[j] as (typeof relevant)[number];
      if (b.s >= a.f) break; // sorted by start, so nothing later can overlap a
      const overlap = Math.min(a.f, b.f) - b.s;
      if (overlap > 0) {
        conflicts.push({ first: ref(a.e), second: ref(b.e), overlapMinutes: Math.round(overlap / MIN_MS) });
      }
    }
  }
  return conflicts;
}