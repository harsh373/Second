import type { Request, Response } from "express";
import { z } from "zod";
import { isValidDate, todayForUser } from "../model/commitment.model";
import { applyUserAction, getLastScanAt, listLoops, type OpenLoop } from "../model/openLoop.model";
import { AppError } from "../utility/AppError";
import { runScan } from "../utility/loopScan";
import { daysBetween } from "../utility/priority";

const idParams = z.object({ id: z.string().uuid() });

const patchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve") }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("snooze"), until: z.string().refine(isValidDate, "Use a valid date (YYYY-MM-DD).") }),
]);

function toDto(l: OpenLoop, today: string) {
  const snoozed = l.status === "active" && l.snoozedUntil !== null && l.snoozedUntil > today;
  return {
    id: l.id,
    kind: l.kind,
    subject: l.subject,
    counterpart: l.counterpart,
    sourceUrl: l.sourceUrl,
    triggerAt: l.triggerAt.toISOString(),
    daysSince: Math.max(0, Math.floor((Date.now() - l.triggerAt.getTime()) / 86_400_000)),
    state: snoozed ? "snoozed" : l.status,
    snoozedUntil: snoozed ? l.snoozedUntil : null,
    resolvedAt: l.resolvedAt?.toISOString() ?? null,
    resolvedReason: l.resolvedReason,
    resolvedBy: l.resolvedBy,
  };
}

export async function list(req: Request, res: Response) {
  const userId = req.user!.id;
  const { today } = await todayForUser(userId);
  const [{ active, closed }, lastScanAt] = await Promise.all([listLoops(userId), getLastScanAt(userId)]);
  res.json({
    today,
    lastScanAt: lastScanAt?.toISOString() ?? null,
    loops: [...active, ...closed].map((l) => toDto(l, today)),
  });
}

// Reads Gmail live (read-only), closes loops that are finished and adds new ones. Can take several seconds.
export async function scan(req: Request, res: Response) {
  const summary = await runScan(req.user!.id);
  res.json(summary);
}

export async function update(req: Request, res: Response) {
  const userId = req.user!.id;
  const { id } = idParams.parse(req.params);
  const change = patchBody.parse(req.body ?? {});

  if (change.action === "snooze") {
    const { today } = await todayForUser(userId);
    const days = daysBetween(today, change.until);
    if (days < 1 || days > 365) {
      throw new AppError(400, "Snooze until a date between tomorrow and one year from now.", "INVALID_SNOOZE");
    }
  }

  const ok = await applyUserAction(userId, id, change);
  if (!ok) throw new AppError(404, "That open loop does not exist or cannot be changed this way.", "OPEN_LOOP_NOT_FOUND");
  res.status(204).end();
}