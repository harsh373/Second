import type { Request, Response } from "express";
import { z } from "zod";
import { findConflicts, findFreeSlots, getEvent, listEvents, resolveWindow } from "../utility/calendar";

const windowQuery = z.object({
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});

const eventsQuery = windowQuery.extend({
  calendarId: z.string().trim().min(1).max(200).default("primary"),
  maxResults: z.coerce.number().int().min(1).max(250).default(100),
});

const eventParams = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/, "Invalid event id"),
});

const availabilityQuery = windowQuery
  .extend({
    minMinutes: z.coerce.number().int().min(5).max(480).default(30),
    calendarIds: z.string().trim().max(500).optional(), // comma separated
    workStart: z.coerce.number().int().min(0).max(23).optional(),
    workEnd: z.coerce.number().int().min(1).max(24).optional(),
  })
  .refine((v) => (v.workStart === undefined) === (v.workEnd === undefined), {
    message: "Give both workStart and workEnd, or neither.",
  })
  .refine((v) => v.workStart === undefined || v.workEnd === undefined || v.workEnd > v.workStart, {
    message: "workEnd must be greater than workStart.",
  });

export async function events(req: Request, res: Response) {
  const q = eventsQuery.parse(req.query);
  const w = await resolveWindow(req.user!.id, q.from, q.to);
  const items = await listEvents(req.user!.id, {
    timeMin: w.timeMin,
    timeMax: w.timeMax,
    calendarId: q.calendarId,
    maxResults: q.maxResults,
    timezone: w.timezone,
  });
  res.json({
    timezone: w.timezone,
    window: { from: w.timeMin.toISOString(), to: w.timeMax.toISOString() },
    events: items,
  });
}

export async function eventById(req: Request, res: Response) {
  const { eventId } = eventParams.parse(req.params);
  const { calendarId } = z.object({ calendarId: z.string().trim().min(1).max(200).default("primary") }).parse(req.query);
  res.json(await getEvent(req.user!.id, eventId, calendarId));
}

export async function availability(req: Request, res: Response) {
  const q = availabilityQuery.parse(req.query);
  const w = await resolveWindow(req.user!.id, q.from, q.to);
  res.json(
    await findFreeSlots(req.user!.id, {
      timeMin: w.timeMin,
      timeMax: w.timeMax,
      timezone: w.timezone,
      minMinutes: q.minMinutes,
      calendarIds: q.calendarIds?.split(",").map((s) => s.trim()).filter(Boolean),
      workingHours:
        q.workStart !== undefined && q.workEnd !== undefined
          ? { startHour: q.workStart, endHour: q.workEnd }
          : undefined,
    }),
  );
}

export async function conflicts(req: Request, res: Response) {
  const q = windowQuery.parse(req.query);
  const w = await resolveWindow(req.user!.id, q.from, q.to);
  const items = await listEvents(req.user!.id, {
    timeMin: w.timeMin,
    timeMax: w.timeMax,
    maxResults: 250,
    timezone: w.timezone,
  });
  res.json({
    timezone: w.timezone,
    window: { from: w.timeMin.toISOString(), to: w.timeMax.toISOString() },
    eventsChecked: items.length,
    conflicts: findConflicts(items),
  });
}