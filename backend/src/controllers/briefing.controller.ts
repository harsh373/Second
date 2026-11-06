import type { Request, Response } from "express";
import { z } from "zod";
import { getBriefing, listBriefings, saveBriefing } from "../model/briefing.model";
import { loadCommitmentViews, todayForUser } from "../model/commitment.model";
import { getLastScanAt, listActiveLoops } from "../model/openLoop.model";
import { loadPeopleViews } from "../model/people.model";
import { AppError } from "../utility/AppError";
import {
  addDays,
  buildMorning,
  buildPreMeeting,
  buildWeekly,
  CALENDAR_MAX,
  clean,
  type BriefingContent,
  type CalendarResult,
} from "../utility/briefing";
import { getEvent, listEvents, resolveWindow } from "../utility/calendar";
import { logger } from "../utility/logger";

const generateBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("morning") }),
  z.object({ kind: z.literal("weekly") }),
  z.object({ kind: z.literal("pre_meeting"), eventId: z.string().min(1).max(256) }),
]);

const RECONNECT_CODES = new Set(["GOOGLE_NOT_CONNECTED", "GOOGLE_RECONNECT_REQUIRED", "GOOGLE_SCOPE_MISSING"]);

// Reads the calendar live. Never throws: a failure becomes a plain message so other sections still render.
async function loadCalendar(userId: string, from: string, to: string): Promise<CalendarResult> {
  try {
    const w = await resolveWindow(userId, from, to);
    const events = await listEvents(userId, {
      timeMin: w.timeMin,
      timeMax: w.timeMax,
      timezone: w.timezone,
      maxResults: CALENDAR_MAX,
    });
    return { ok: true, events };
  } catch (err) {
    if (err instanceof AppError) {
      const hint = RECONNECT_CODES.has(err.code) ? " Connect or reconnect Google in Settings." : "";
      return { ok: false, message: `The calendar could not be read: ${err.message}${hint}` };
    }
    logger.error("Briefing calendar read failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: "The calendar could not be read." };
  }
}

const toDto = (row: { id: string; kind: string; title: string; generatedAt: Date }, content: BriefingContent) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  generatedAt: row.generatedAt.toISOString(),
  content,
});

export async function generate(req: Request, res: Response) {
  const userId = req.user!.id;
  const body = generateBody.parse(req.body);
  const { today, timezone } = await todayForUser(userId);
  const now = new Date();

  let built: { title: string; content: BriefingContent };
  let eventId: string | null = null;

  if (body.kind === "pre_meeting") {
    const event = await getEvent(userId, body.eventId);
    if (event.status === "cancelled") throw new AppError(400, "That event is cancelled.", "EVENT_CANCELLED");
    const day = event.start.slice(0, 10);
    const [dayEvents, people] = await Promise.all([
      event.allDay ? Promise.resolve<CalendarResult>({ ok: true, events: [event] }) : loadCalendar(userId, day, day),
      loadPeopleViews(userId, { interactionsShown: 20 }),
    ]);
    built = buildPreMeeting({ timezone, today, now, event, dayEvents, people });
    eventId = event.id;
  } else {
    const first = today;
    const last = body.kind === "morning" ? today : addDays(today, 6);
    const [calendar, commitments, loops, lastScanAt] = await Promise.all([
      loadCalendar(userId, first, last),
      loadCommitmentViews(userId, today),
      listActiveLoops(userId, 100),
      getLastScanAt(userId),
    ]);
    const input = { timezone, today, now, calendar, commitments, loops, lastScanAt };
    built = body.kind === "morning" ? buildMorning(input) : buildWeekly(input);
  }

  const saved = await saveBriefing(userId, {
    kind: body.kind,
    title: built.title,
    eventId,
    content: built.content,
  });
  res.status(201).json({ briefing: toDto(saved, built.content) });
}

export async function listAll(req: Request, res: Response) {
  const rows = await listBriefings(req.user!.id);
  res.json({
    briefings: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, generatedAt: r.generatedAt.toISOString() })),
  });
}

export async function getOne(req: Request, res: Response) {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw new AppError(404, "Briefing not found.", "BRIEFING_NOT_FOUND");
  const row = await getBriefing(req.user!.id, id.data);
  if (!row) throw new AppError(404, "Briefing not found.", "BRIEFING_NOT_FOUND");
  res.json({ briefing: toDto(row, row.content) });
}

// Events for the pre-meeting picker: next 7 days, not cancelled, not already finished. Live calendar read.
export async function upcomingEvents(req: Request, res: Response) {
  const userId = req.user!.id;
  const { today } = await todayForUser(userId);
  const w = await resolveWindow(userId, today, addDays(today, 6));
  const events = await listEvents(userId, {
    timeMin: w.timeMin,
    timeMax: w.timeMax,
    timezone: w.timezone,
    maxResults: 50,
  });
  const nowMs = Date.now();
  res.json({
    events: events
      .filter((e) => e.status !== "cancelled" && (e.allDay || Date.parse(e.end) > nowMs))
      .map((e) => ({ id: e.id, title: clean(e.title, 100) || "(no title)", start: e.start, end: e.end, allDay: e.allDay })),
  });
}