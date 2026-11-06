import type { CommitmentView } from "../model/commitment.model";
import type { PersonView } from "../model/people.model";
import { findConflicts, type CalendarEvent } from "./calendar";
import { daysBetween } from "./priority";

export type BriefingKind = "morning" | "weekly" | "pre_meeting";
export type BriefingPage = "commitments" | "open-loops" | "people";

export interface BriefingItem {
  text: string;
  when: string | null;
  detail: string | null;
  group: string | null; // items with the same group are shown under one heading
  url: string | null; // Gmail thread or calendar event
  page: BriefingPage | null; // or a page inside Second
}

export interface BriefingSection {
  key: string;
  title: string;
  status: "ok" | "unavailable";
  note: string | null;
  items: BriefingItem[];
}

export interface BriefingContent {
  version: 1;
  timezone: string;
  date: string; // today, YYYY-MM-DD in the user's timezone
  warnings: string[];
  sections: BriefingSection[];
}

export type CalendarResult = { ok: true; events: CalendarEvent[] } | { ok: false; message: string };

// The fields of a saved open loop that briefings use.
export interface LoopInput {
  kind: string;
  subject: string | null;
  counterpart: string | null;
  triggerAt: Date;
  snoozedUntil: string | null;
  sourceUrl: string | null;
}

export const CALENDAR_MAX = 100;
const DAY_MS = 86_400_000;
const MAX_ITEMS = 12;

// ---------- small helpers ----------

// Removes control and direction-override characters, collapses spaces, cuts to a maximum length.
const UNSAFE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
export function clean(value: string | null | undefined, max = 120): string {
  const text = (value ?? "").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const plural = (n: number) => (n === 1 ? "" : "s");

function safeUrl(url: string | null | undefined): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function fmtDate(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function item(text: string, extra: Partial<Omit<BriefingItem, "text">> = {}): BriefingItem {
  return { text, when: null, detail: null, group: null, url: null, page: null, ...extra };
}

function cap(items: BriefingItem[], max: number, page: BriefingPage | null, what: string): BriefingItem[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), item(`And ${items.length - max} more ${what}`, { page })];
}

function section(key: string, title: string, items: BriefingItem[], emptyNote: string): BriefingSection {
  return { key, title, status: "ok", note: items.length === 0 ? emptyNote : null, items };
}

function unavailable(key: string, title: string, note: string): BriefingSection {
  return { key, title, status: "unavailable", note, items: [] };
}

function whenOf(e: CalendarEvent): string {
  return e.allDay ? "All day" : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`;
}

const visible = (e: CalendarEvent) =>
  e.status !== "cancelled" && e.attendees.find((a) => a.self)?.responseStatus !== "declined";

// ---------- section builders ----------

function calendarSection(calendar: CalendarResult, grouped: boolean, firstDay: string): BriefingSection {
  if (!calendar.ok) return unavailable("calendar", "Calendar", calendar.message);
  const shown = calendar.events.filter(visible).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const hidden = calendar.events.length - shown.length;
  const items = shown.map((e) => {
    const others = e.attendees.filter((a) => !a.self).length;
    const date = e.start.slice(0, 10);
    return item(clean(e.title, 100), {
      when: whenOf(e),
      detail: others > 0 ? `${others} other attendee${plural(others)}` : null,
      group: grouped ? dayLabel(date < firstDay ? firstDay : date) : null,
      url: safeUrl(e.sourceUrl),
    });
  });
  const notes: string[] = [];
  if (items.length === 0) notes.push("No events in this period.");
  if (hidden > 0) notes.push(`${hidden} cancelled or declined event${plural(hidden)} not shown.`);
  return {
    key: "calendar",
    title: "Calendar",
    status: "ok",
    note: notes.length > 0 ? notes.join(" ") : null,
    items: cap(items, 40, null, "events"),
  };
}

function conflictsSection(calendar: CalendarResult): BriefingSection {
  if (!calendar.ok) return unavailable("conflicts", "Conflicts", "Needs the calendar, which could not be read.");
  const items = findConflicts(calendar.events).map((c) =>
    item(`${clean(c.first.title, 60)} overlaps ${clean(c.second.title, 60)}`, {
      detail: `${dayLabel(c.first.start.slice(0, 10))} · ${c.overlapMinutes} min overlap`,
      url: safeUrl(c.first.sourceUrl),
    }),
  );
  return section("conflicts", "Conflicts", cap(items, MAX_ITEMS, null, "conflicts"), "No overlapping events.");
}

function dueText(dueDate: string, today: string): string {
  const d = daysBetween(today, dueDate);
  if (d < 0) return d === -1 ? "Overdue by 1 day" : `Overdue by ${-d} days`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due ${dayLabel(dueDate)}`;
}

function commitmentItem(c: CommitmentView, today: string): BriefingItem {
  const parts = [
    c.dueDate ? dueText(c.dueDate, today) : null,
    c.status === "waiting" ? (c.waitingOn ? `Waiting on ${clean(c.waitingOn, 60)}` : "Waiting on someone") : null,
    c.priority ? `${c.priority.band} priority` : null,
    c.matter ? clean(c.matter.title, 60) : null,
  ].filter((p): p is string => p !== null);
  return item(clean(c.title, 100), { detail: parts.join(" · ") || null, page: "commitments" });
}

function daysOpen(l: LoopInput, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - l.triggerAt.getTime()) / DAY_MS));
}

function loopItem(l: LoopInput, now: Date, withKind: boolean): BriefingItem {
  const days = daysOpen(l, now);
  const parts = [
    withKind ? (l.kind === "needs_reply" ? "You owe a reply" : "Waiting on them") : null,
    clean(l.counterpart, 60) || null,
    `${days} day${plural(days)} open`,
  ].filter((p): p is string => p !== null);
  return item(clean(l.subject, 100) || "(no subject)", {
    detail: parts.join(" · "),
    url: safeUrl(l.sourceUrl),
    page: "open-loops",
  });
}

const liveLoops = (loops: LoopInput[], today: string) =>
  loops.filter((l) => l.snoozedUntil === null || l.snoozedUntil <= today);
const byOldest = (a: LoopInput, b: LoopInput) => a.triggerAt.getTime() - b.triggerAt.getTime();

function scanWarning(last: Date | null, now: Date): string | null {
  if (!last) {
    return "You have not scanned your inbox yet, so the reply sections are empty. Press Scan inbox on the Open loops page.";
  }
  const hours = Math.floor((now.getTime() - last.getTime()) / 3_600_000);
  if (hours < 24) return null;
  const ago = hours < 48 ? `${hours} hours` : `${Math.floor(hours / 24)} days`;
  return `Your inbox was last scanned ${ago} ago, so the reply sections may be out of date. Press Scan inbox on the Open loops page for a fresh list.`;
}

interface Common {
  timezone: string;
  today: string;
  now: Date;
}

// ---------- morning ----------

export function buildMorning(i: Common & {
  calendar: CalendarResult;
  commitments: CommitmentView[];
  loops: LoopInput[];
  lastScanAt: Date | null;
}): { title: string; content: BriefingContent } {
  const { today, now } = i;
  const live = liveLoops(i.loops, today);
  const snoozed = i.loops.length - live.length;
  const warnings = [
    scanWarning(i.lastScanAt, now),
    snoozed > 0 ? `${snoozed} snoozed open loop${plural(snoozed)} not shown.` : null,
  ].filter((w): w is string => w !== null);

  const due = i.commitments
    .filter((c) => c.status !== "done" && c.dueDate !== null && c.dueDate <= today)
    .map((c) => commitmentItem(c, today));
  const owed = live.filter((l) => l.kind === "needs_reply").sort(byOldest).map((l) => loopItem(l, now, false));
  const waiting = live.filter((l) => l.kind === "waiting_on").sort(byOldest).map((l) => loopItem(l, now, false));

  return {
    title: `Morning briefing — ${dayLabel(today)}`,
    content: {
      version: 1,
      timezone: i.timezone,
      date: today,
      warnings,
      sections: [
        calendarSection(i.calendar, false, today),
        conflictsSection(i.calendar),
        section("due", "Overdue or due today", cap(due, MAX_ITEMS, "commitments", "commitments"), "Nothing overdue or due today."),
        section("owed", "You owe a reply", cap(owed, MAX_ITEMS, "open-loops", "threads"), "No saved threads are waiting on your reply."),
        section("waiting", "You are waiting on", cap(waiting, MAX_ITEMS, "open-loops", "threads"), "No saved threads are waiting on someone else."),
      ],
    },
  };
}

// ---------- weekly ----------

export function buildWeekly(i: Common & {
  calendar: CalendarResult;
  commitments: CommitmentView[];
  loops: LoopInput[];
  lastScanAt: Date | null;
}): { title: string; content: BriefingContent } {
  const { today, now, timezone } = i;
  const end = addDays(today, 6);
  const live = liveLoops(i.loops, today);
  const snoozed = i.loops.length - live.length;
  const warnings = [
    scanWarning(i.lastScanAt, now),
    snoozed > 0 ? `${snoozed} snoozed open loop${plural(snoozed)} not shown.` : null,
    i.calendar.ok && i.calendar.events.length >= CALENDAR_MAX
      ? `The calendar returned ${CALENDAR_MAX} events, which is the maximum read, so some may be missing.`
      : null,
  ].filter((w): w is string => w !== null);

  const dueWeek = i.commitments
    .filter((c) => c.status !== "done" && c.dueDate !== null && c.dueDate <= end)
    .map((c) => commitmentItem(c, today));
  const stale = live.filter((l) => daysOpen(l, now) >= 7).sort(byOldest).map((l) => loopItem(l, now, true));
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const completed = i.commitments
    .filter((c) => c.status === "done" && c.completedAt !== null && c.completedAt.getTime() >= weekAgo)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
    .map((c) =>
      item(clean(c.title, 100), {
        detail: c.completedAt ? `Completed ${fmtDate(c.completedAt, timezone)}` : null,
        page: "commitments",
      }),
    );

  return {
    title: `Weekly briefing — ${dayLabel(today)} to ${dayLabel(end)}`,
    content: {
      version: 1,
      timezone,
      date: today,
      warnings,
      sections: [
        calendarSection(i.calendar, true, today),
        conflictsSection(i.calendar),
        section("due", "Due this week (including overdue)", cap(dueWeek, 20, "commitments", "commitments"), "Nothing overdue or due this week."),
        section("stale", "Open loops older than 7 days", cap(stale, 20, "open-loops", "threads"), "No saved open loop is older than 7 days."),
        section("completed", "Completed in the last 7 days", cap(completed, 20, "commitments", "commitments"), "No commitment was marked done in the last 7 days."),
      ],
    },
  };
}

// ---------- pre-meeting ----------

const MAX_ATTENDEES = 30;
const THREADS_PER_PERSON = 5;

export function buildPreMeeting(i: Common & {
  event: CalendarEvent;
  dayEvents: CalendarResult;
  people: PersonView[];
}): { title: string; content: BriefingContent } {
  const { event, timezone } = i;
  const byEmail = new Map<string, PersonView>();
  for (const p of i.people) if (p.email) byEmail.set(p.email.toLowerCase(), p);

  const others = event.attendees.filter((a) => !a.self && a.email);
  const checked = others.slice(0, MAX_ATTENDEES);

  const matched = new Map<string, PersonView>();
  const attendeeItems: BriefingItem[] = [];
  for (const a of checked) {
    const person = byEmail.get(a.email.toLowerCase());
    if (!person) {
      attendeeItems.push(
        item(clean(a.name, 60) || "Attendee without a name", { detail: "Not on your People list (matched by exact email only)" }),
      );
      continue;
    }
    matched.set(person.id, person);
    const lastContact = toDate(person.lastContactAt);
    const parts = [
      person.relationship ? `Relationship you set: ${clean(person.relationship.label, 60)}` : null,
      lastContact ? `Last email ${fmtDate(lastContact, timezone)}` : null,
      person.lastDirection === "from" ? "They wrote last" : person.lastDirection === "to" ? "You wrote last" : null,
      `${person.interactionCount} saved thread${plural(person.interactionCount)}`,
    ].filter((p): p is string => p !== null);
    attendeeItems.push(item(clean(person.name ?? a.name, 60) || "Saved person", { detail: parts.join(" · "), page: "people" }));
  }

  const threadItems: BriefingItem[] = [];
  const loopItems: BriefingItem[] = [];
  for (const person of matched.values()) {
    const who = clean(person.name, 60) || "Saved person";
    for (const t of person.interactions) {
      const sent = t.direction === "from" ? "They wrote last" : "You wrote last";
      const last = toDate(t.lastMessageAt);
      const base = {
        when: last ? fmtDate(last, timezone) : null,
        group: who,
        url: safeUrl(t.sourceUrl),
      };
      const subject = clean(t.subject, 100) || "(no subject)";
      if (t.openLoop === "needs_reply" || t.openLoop === "waiting_on") {
        loopItems.push(
          item(subject, {
            ...base,
            detail: t.openLoop === "needs_reply" ? "They wrote last and you have not replied" : "You wrote last and have had no reply",
            page: "open-loops",
          }),
        );
      }
    }
    for (const t of person.interactions.slice(0, THREADS_PER_PERSON)) {
      const sent = t.direction === "from" ? "They wrote last" : "You wrote last";
      const last = toDate(t.lastMessageAt);
      threadItems.push(
        item(clean(t.subject, 100) || "(no subject)", {
          when: last ? fmtDate(last, timezone) : null,
          group: who,
          detail: t.openLoop ? `${sent} · open loop` : sent,
          url: safeUrl(t.sourceUrl),
        }),
      );
    }
  }

  const date = event.start.slice(0, 10);
  const meetingItem = item(clean(event.title, 100), {
    when: `${dayLabel(date)} · ${whenOf(event)}`,
    detail: others.length > 0 ? `${others.length} other attendee${plural(others.length)}` : null,
    url: safeUrl(event.sourceUrl),
  });

  let conflicts: BriefingSection;
  if (event.allDay) {
    conflicts = { key: "conflicts", title: "Conflicts", status: "ok", note: "Conflicts are not checked for all-day events.", items: [] };
  } else if (!i.dayEvents.ok) {
    conflicts = unavailable("conflicts", "Conflicts", i.dayEvents.message);
  } else {
    const items = findConflicts(i.dayEvents.events)
      .filter((c) => c.first.id === event.id || c.second.id === event.id)
      .map((c) => {
        const other = c.first.id === event.id ? c.second : c.first;
        return item(`Overlaps ${clean(other.title, 80)}`, {
          when: `${other.start.slice(11, 16)}–${other.end.slice(11, 16)}`,
          detail: `${c.overlapMinutes} min overlap`,
          url: safeUrl(other.sourceUrl),
        });
      });
    conflicts = section("conflicts", "Conflicts", items, "No other event overlaps this one.");
  }

  const warnings = ["People and open-loop information comes from your saved lists (Refresh people, Scan inbox), not live Gmail."];
  if (others.length > MAX_ATTENDEES) warnings.push(`Only the first ${MAX_ATTENDEES} attendees were checked.`);

  return {
    title: `Pre-meeting: ${clean(event.title, 70)}`,
    content: {
      version: 1,
      timezone,
      date: i.today,
      warnings,
      sections: [
        { key: "meeting", title: "Meeting", status: "ok", note: null, items: [meetingItem] },
        conflicts,
        section("attendees", "Attendees", attendeeItems, "This event lists no other attendees."),
        section("loops", "Open loops with attendees", cap(loopItems, 20, "open-loops", "threads"), "No saved open loop involves a matched attendee."),
        section("threads", "Recent saved threads with attendees", cap(threadItems, 20, "people", "threads"), "No saved threads with matched attendees."),
      ],
    },
  };
}