import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../utility/db";
import { loopEvents, openLoops } from "../../../database/schema/index";

export const LOOP_KINDS = ["needs_reply", "waiting_on"] as const;
export type LoopKind = (typeof LOOP_KINDS)[number];

export const OPEN_LOOP_LIMIT = 200; // active loops per user
const CLOSED_SHOWN = 30;

export type OpenLoop = typeof openLoops.$inferSelect;

export interface NewLoop {
  kind: LoopKind;
  threadId: string;
  triggerMessageId: string;
  triggerAt: Date;
  counterpart: string | null;
  subject: string;
  sourceUrl: string;
}

export type LoopAction =
  | { action: "resolve" }
  | { action: "dismiss" }
  | { action: "reopen" }
  | { action: "snooze"; until: string };

export async function countActiveLoops(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(openLoops)
    .where(and(eq(openLoops.userId, userId), eq(openLoops.status, "active")));
  return row?.n ?? 0;
}

// All active loops (oldest trigger first) plus the most recently closed ones.
export async function listLoops(userId: string): Promise<{ active: OpenLoop[]; closed: OpenLoop[] }> {
  const active = await db
    .select()
    .from(openLoops)
    .where(and(eq(openLoops.userId, userId), eq(openLoops.status, "active")))
    .orderBy(asc(openLoops.triggerAt));
  const closed = await db
    .select()
    .from(openLoops)
    .where(and(eq(openLoops.userId, userId), ne(openLoops.status, "active")))
    .orderBy(desc(openLoops.updatedAt))
    .limit(CLOSED_SHOWN);
  return { active, closed };
}

export async function listActiveLoops(userId: string, limit: number): Promise<OpenLoop[]> {
  return db
    .select()
    .from(openLoops)
    .where(and(eq(openLoops.userId, userId), eq(openLoops.status, "active")))
    .orderBy(asc(openLoops.triggerAt))
    .limit(limit);
}

// The active loops that have gone the longest without being re-read from Gmail.
export async function activeLoopsForCheck(userId: string, limit: number) {
  return db
    .select({
      id: openLoops.id,
      threadId: openLoops.threadId,
      kind: openLoops.kind,
      triggerAt: openLoops.triggerAt,
    })
    .from(openLoops)
    .where(and(eq(openLoops.userId, userId), eq(openLoops.status, "active")))
    .orderBy(sql`${openLoops.checkedAt} asc nulls first`)
    .limit(limit);
}

export async function markChecked(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(openLoops)
    .set({ checkedAt: new Date() })
    .where(and(eq(openLoops.userId, userId), inArray(openLoops.id, ids)));
}

// Returns false if the thread already has an active loop of this kind, or this trigger message
// already made a loop before (even a dismissed or resolved one).
export async function createLoopIfNew(userId: string, input: NewLoop): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: openLoops.id })
      .from(openLoops)
      .where(
        and(
          eq(openLoops.userId, userId),
          eq(openLoops.threadId, input.threadId),
          eq(openLoops.kind, input.kind),
          eq(openLoops.status, "active"),
        ),
      )
      .limit(1);
    if (existing) return false;

    const [row] = await tx
      .insert(openLoops)
      .values({ userId, ...input })
      .onConflictDoNothing()
      .returning({ id: openLoops.id });
    if (!row) return false;

    await tx.insert(loopEvents).values({ userId, loopId: row.id, type: "created", actor: "scan" });
    return true;
  });
}

// Closes a loop because Gmail shows it is finished. Returns false if it was not active any more.
export async function resolveLoopFromGmail(
  userId: string,
  id: string,
  result: { reason: string; at: Date | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(openLoops)
      .set({
        status: "resolved",
        resolvedBy: "gmail",
        resolvedReason: result.reason,
        resolvedAt: result.at ?? now,
        snoozedUntil: null,
        updatedAt: now,
      })
      .where(and(eq(openLoops.id, id), eq(openLoops.userId, userId), eq(openLoops.status, "active")))
      .returning({ id: openLoops.id });
    if (!row) return false;
    await tx.insert(loopEvents).values({ userId, loopId: id, type: "resolved", actor: "gmail" });
    return true;
  });
}

// Something the user chose. Returns false if the loop is not theirs, or the action does not fit its state.
export async function applyUserAction(userId: string, id: string, change: LoopAction): Promise<boolean> {
  const now = new Date();
  let set: Partial<typeof openLoops.$inferInsert>;
  let eventType: string;

  switch (change.action) {
    case "resolve":
      set = {
        status: "resolved",
        resolvedBy: "user",
        resolvedReason: "You marked it resolved.",
        resolvedAt: now,
        snoozedUntil: null,
        updatedAt: now,
      };
      eventType = "resolved";
      break;
    case "dismiss":
      set = { status: "dismissed", resolvedBy: "user", resolvedReason: null, resolvedAt: now, snoozedUntil: null, updatedAt: now };
      eventType = "dismissed";
      break;
    case "snooze":
      set = { snoozedUntil: change.until, updatedAt: now };
      eventType = "snoozed";
      break;
    case "reopen":
      set = {
        status: "active",
        snoozedUntil: null,
        resolvedAt: null,
        resolvedReason: null,
        resolvedBy: null,
        checkedAt: null,
        updatedAt: now,
      };
      eventType = "reopened";
      break;
  }

  // Every action except "reopen" only makes sense on an active loop.
  const where =
    change.action === "reopen"
      ? and(eq(openLoops.id, id), eq(openLoops.userId, userId))
      : and(eq(openLoops.id, id), eq(openLoops.userId, userId), eq(openLoops.status, "active"));

  return db.transaction(async (tx) => {
    const [row] = await tx.update(openLoops).set(set).where(where).returning({ id: openLoops.id });
    if (!row) return false;
    await tx.insert(loopEvents).values({ userId, loopId: id, type: eventType, actor: "user" });
    return true;
  });
}

export async function recordScan(userId: string): Promise<void> {
  await db.insert(loopEvents).values({ userId, loopId: null, type: "scan", actor: "user" });
}

export async function getLastScanAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: loopEvents.createdAt })
    .from(loopEvents)
    .where(and(eq(loopEvents.userId, userId), eq(loopEvents.type, "scan")))
    .orderBy(desc(loopEvents.createdAt))
    .limit(1);
  return row?.at ?? null;
}