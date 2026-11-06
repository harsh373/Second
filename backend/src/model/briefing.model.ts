import { and, desc, eq, notInArray } from "drizzle-orm";
import { briefings } from "../../../database/schema/index";
import type { BriefingContent, BriefingKind } from "../utility/briefing";
import { db } from "../utility/db";

export const BRIEFING_KEEP = 30;

export interface BriefingSummaryRow {
  id: string;
  kind: string;
  title: string;
  generatedAt: Date;
}

export interface BriefingRow extends BriefingSummaryRow {
  content: BriefingContent;
}

export async function saveBriefing(
  userId: string,
  input: { kind: BriefingKind; title: string; eventId: string | null; content: BriefingContent },
): Promise<BriefingSummaryRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(briefings)
      .values({ userId, kind: input.kind, title: input.title, eventId: input.eventId, content: input.content })
      .returning({ id: briefings.id, kind: briefings.kind, title: briefings.title, generatedAt: briefings.generatedAt });
    if (!row) throw new Error("Could not save the briefing.");

    // Keep only the newest BRIEFING_KEEP for this user.
    const keep = await tx
      .select({ id: briefings.id })
      .from(briefings)
      .where(eq(briefings.userId, userId))
      .orderBy(desc(briefings.generatedAt))
      .limit(BRIEFING_KEEP);
    if (keep.length >= BRIEFING_KEEP) {
      await tx
        .delete(briefings)
        .where(and(eq(briefings.userId, userId), notInArray(briefings.id, keep.map((k) => k.id))));
    }
    return row;
  });
}

export async function listBriefings(userId: string): Promise<BriefingSummaryRow[]> {
  return db
    .select({ id: briefings.id, kind: briefings.kind, title: briefings.title, generatedAt: briefings.generatedAt })
    .from(briefings)
    .where(eq(briefings.userId, userId))
    .orderBy(desc(briefings.generatedAt))
    .limit(BRIEFING_KEEP);
}

export async function getBriefing(userId: string, id: string): Promise<BriefingRow | null> {
  const [row] = await db
    .select({
      id: briefings.id,
      kind: briefings.kind,
      title: briefings.title,
      generatedAt: briefings.generatedAt,
      content: briefings.content,
    })
    .from(briefings)
    .where(and(eq(briefings.id, id), eq(briefings.userId, userId)))
    .limit(1);
  return row ? { ...row, content: row.content as BriefingContent } : null;
}

export async function getLatestBriefing(userId: string, kind?: BriefingKind | undefined): Promise<BriefingRow | null> {
  const [row] = await db
    .select({
      id: briefings.id,
      kind: briefings.kind,
      title: briefings.title,
      generatedAt: briefings.generatedAt,
      content: briefings.content,
    })
    .from(briefings)
    .where(kind ? and(eq(briefings.userId, userId), eq(briefings.kind, kind)) : eq(briefings.userId, userId))
    .orderBy(desc(briefings.generatedAt))
    .limit(1);
  return row ? { ...row, content: row.content as BriefingContent } : null;
}