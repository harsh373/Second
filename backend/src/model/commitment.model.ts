import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../utility/db";
import {
  commitmentEdges,
  commitmentEvents,
  commitmentSources,
  commitments,
  matters,
} from "../../../database/schema/index";
import { computePriority, todayIn, type CommitmentStatus, type Impact, type Priority } from "../utility/priority";
import { getChatPreferences } from "./conversation.model";
import { containsSensitive, normalizeMemory } from "./memory.model";

export const COMMITMENT_STATUSES = ["open", "waiting", "done"] as const;
export const IMPACTS = ["low", "normal", "high"] as const;
export const COMMITMENT_TITLE_MAX = 160;
export const COMMITMENT_LIMIT = 300; // per user
export const MATTER_MAX_CHARS = 60;
export const MATTER_LIMIT = 50; // per user

export interface CommitmentSourceInput {
  type: "chat_message" | "manual";
  conversationId?: string | undefined;
  messageId?: string | undefined;
  excerpt?: string | undefined;
}

export interface CreatedCommitment {
  id: string;
  title: string;
  status: "open" | "waiting";
  waitingOn: string | null;
  dueDate: string | null;
  matter: string | null;
}

export interface LinkedCommitment {
  id: string;
  title: string;
  status: CommitmentStatus;
}

export interface CommitmentView {
  id: string;
  title: string;
  status: CommitmentStatus;
  waitingOn: string | null;
  dueDate: string | null;
  impact: Impact;
  matter: { id: string; title: string } | null;
  createdAt: Date;
  completedAt: Date | null;
  source: { type: string; conversationId: string | null; excerpt: string | null; createdAt: Date } | null;
  dependsOn: LinkedCommitment[]; // must be finished first
  dependents: LinkedCommitment[]; // waiting on this one
  priority: Priority | null; // null once done
}

// ---- Pure rules ----

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Returns a reason if the text must not be saved, or null if it is fine.
export function checkCommitmentTitle(title: string): string | null {
  if (normalizeMemory(title).length < 3) return "That commitment is too short.";
  if (title.length > COMMITMENT_TITLE_MAX) return `Keep a commitment under ${COMMITMENT_TITLE_MAX} characters.`;
  if (containsSensitive(title)) return "Second does not store passwords, keys, tokens or long ID numbers.";
  return null;
}

export function checkMatterTitle(title: string): string | null {
  if (normalizeMemory(title).length < 2) return "That matter name is too short.";
  if (title.length > MATTER_MAX_CHARS) return `Keep a matter name under ${MATTER_MAX_CHARS} characters.`;
  if (containsSensitive(title)) return "Second does not store passwords, keys, tokens or long ID numbers.";
  return null;
}

const asStatus = (v: string): CommitmentStatus => (v === "done" || v === "waiting" ? v : "open");
const asImpact = (v: string): Impact => (v === "low" || v === "high" ? v : "normal");

// True if, starting at "start" and following DEPENDS_ON links, you reach "target".
function reaches(edges: { fromId: string; toId: string }[], start: string, target: string): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.fromId, [...(next.get(e.fromId) ?? []), e.toId]);
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(next.get(current) ?? []));
  }
  return false;
}

// ---- Queries (always scoped by userId) ----

export async function todayForUser(userId: string): Promise<{ today: string; timezone: string }> {
  const prefs = await getChatPreferences(userId);
  const timezone = prefs?.timezone ?? "UTC";
  return { today: todayIn(timezone), timezone };
}

export async function countCommitments(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(commitments)
    .where(eq(commitments.userId, userId));
  return row?.n ?? 0;
}

export async function listOpenForPrompt(userId: string, limit: number) {
  return db
    .select({ id: commitments.id, title: commitments.title })
    .from(commitments)
    .where(and(eq(commitments.userId, userId), ne(commitments.status, "done")))
    .orderBy(desc(commitments.updatedAt))
    .limit(limit);
}

export async function listMatterTitles(userId: string, limit: number): Promise<string[]> {
  const rows = await db
    .select({ title: matters.title })
    .from(matters)
    .where(eq(matters.userId, userId))
    .orderBy(desc(matters.updatedAt))
    .limit(limit);
  return rows.map((r) => r.title);
}

// Everything the user tracks, with links, source and a computed priority. Highest priority first, done last.
export async function loadCommitmentViews(userId: string, today: string): Promise<CommitmentView[]> {
  const rows = await db
    .select({
      id: commitments.id,
      title: commitments.title,
      status: commitments.status,
      waitingOn: commitments.waitingOn,
      dueDate: commitments.dueDate,
      impact: commitments.impact,
      completedAt: commitments.completedAt,
      createdAt: commitments.createdAt,
      matterId: matters.id,
      matterTitle: matters.title,
    })
    .from(commitments)
    .leftJoin(matters, eq(commitments.matterId, matters.id))
    .where(eq(commitments.userId, userId));
  if (rows.length === 0) return [];

  const edges = await db
    .select({ fromId: commitmentEdges.fromId, toId: commitmentEdges.toId })
    .from(commitmentEdges)
    .where(and(eq(commitmentEdges.userId, userId), eq(commitmentEdges.type, "DEPENDS_ON")));

  const sourceRows = await db
    .select({
      commitmentId: commitmentSources.commitmentId,
      type: commitmentSources.sourceType,
      conversationId: commitmentSources.conversationId,
      excerpt: commitmentSources.excerpt,
      createdAt: commitmentSources.createdAt,
    })
    .from(commitmentSources)
    .innerJoin(commitments, eq(commitmentSources.commitmentId, commitments.id))
    .where(eq(commitments.userId, userId))
    .orderBy(desc(commitmentSources.createdAt));

  const sourceById = new Map<string, CommitmentView["source"]>();
  for (const s of sourceRows) {
    if (!sourceById.has(s.commitmentId)) {
      sourceById.set(s.commitmentId, {
        type: s.type,
        conversationId: s.conversationId,
        excerpt: s.excerpt,
        createdAt: s.createdAt,
      });
    }
  }

  const info = new Map<string, LinkedCommitment>(
    rows.map((r) => [r.id, { id: r.id, title: r.title, status: asStatus(r.status) }]),
  );
  const dependsOn = new Map<string, LinkedCommitment[]>();
  const dependents = new Map<string, LinkedCommitment[]>();
  for (const e of edges) {
    const from = info.get(e.fromId);
    const to = info.get(e.toId);
    if (!from || !to) continue;
    dependsOn.set(e.fromId, [...(dependsOn.get(e.fromId) ?? []), to]);
    dependents.set(e.toId, [...(dependents.get(e.toId) ?? []), from]);
  }

  const views: CommitmentView[] = rows.map((r) => {
    const status = asStatus(r.status);
    const impact = asImpact(r.impact);
    const blockers = dependsOn.get(r.id) ?? [];
    const downstream = dependents.get(r.id) ?? [];
    return {
      id: r.id,
      title: r.title,
      status,
      waitingOn: r.waitingOn,
      dueDate: r.dueDate,
      impact,
      matter: r.matterId && r.matterTitle ? { id: r.matterId, title: r.matterTitle } : null,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      source: sourceById.get(r.id) ?? null,
      dependsOn: blockers,
      dependents: downstream,
      priority:
        status === "done"
          ? null
          : computePriority({
              status,
              dueDate: r.dueDate,
              impact,
              openDependents: downstream.filter((d) => d.status !== "done").length,
              openBlockers: blockers.filter((d) => d.status !== "done").length,
              today,
            }),
    };
  });

  views.sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const byScore = (b.priority?.score ?? 0) - (a.priority?.score ?? 0);
    if (byScore !== 0) return byScore;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return views;
}

// Returns null if an unfinished commitment with the same title already exists.
export async function createCommitment(
  userId: string,
  input: {
    title: string;
    dueDate?: string | null | undefined;
    impact?: Impact | undefined;
    status?: "open" | "waiting" | undefined;
    waitingOn?: string | null | undefined;
    matterTitle?: string | null | undefined;
  },
  source: CommitmentSourceInput,
  actor: "user" | "second",
): Promise<CreatedCommitment | null> {
  const normalized = normalizeMemory(input.title);

  return db.transaction(async (tx) => {
    const [duplicate] = await tx
      .select({ id: commitments.id })
      .from(commitments)
      .where(
        and(eq(commitments.userId, userId), eq(commitments.normalized, normalized), ne(commitments.status, "done")),
      )
      .limit(1);
    if (duplicate) return null;

    // Find the matter by name, or create it (up to the limit).
    let matterId: string | null = null;
    let matterTitle: string | null = null;
    const wanted = input.matterTitle?.replace(/\s+/g, " ").trim();
    const wantedNormalized = wanted ? normalizeMemory(wanted) : "";
    if (wanted && wantedNormalized.length >= 2) {
      const [existing] = await tx
        .select({ id: matters.id, title: matters.title })
        .from(matters)
        .where(and(eq(matters.userId, userId), eq(matters.normalized, wantedNormalized)))
        .limit(1);
      if (existing) {
        matterId = existing.id;
        matterTitle = existing.title;
      } else {
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(matters)
          .where(eq(matters.userId, userId));
        if ((count?.n ?? 0) < MATTER_LIMIT) {
          const [created] = await tx
            .insert(matters)
            .values({ userId, title: wanted, normalized: wantedNormalized })
            .onConflictDoNothing({ target: [matters.userId, matters.normalized] })
            .returning({ id: matters.id, title: matters.title });
          if (created) {
            matterId = created.id;
            matterTitle = created.title;
          }
        }
      }
    }

    const status: "open" | "waiting" = input.status ?? "open";
    const waitingOn = status === "waiting" ? (input.waitingOn ?? null) : null;
    const dueDate = input.dueDate ?? null;

    const [row] = await tx
      .insert(commitments)
      .values({
        userId,
        matterId,
        title: input.title,
        normalized,
        status,
        waitingOn,
        dueDate,
        impact: input.impact ?? "normal",
      })
      .returning({ id: commitments.id });
    if (!row) return null;

    await tx.insert(commitmentSources).values({
      commitmentId: row.id,
      sourceType: source.type,
      conversationId: source.conversationId ?? null,
      messageId: source.messageId ?? null,
      excerpt: source.excerpt ?? null,
    });
    await tx.insert(commitmentEvents).values({ userId, commitmentId: row.id, type: "created", actor });

    return { id: row.id, title: input.title, status, waitingOn, dueDate, matter: matterTitle };
  });
}

// "fromId depends on toId". Refuses unknown ids, ids that are not the user's, and cycles.
export async function addDependency(userId: string, fromId: string, toId: string): Promise<boolean> {
  if (fromId === toId) return false;

  const owned = await db
    .select({ id: commitments.id })
    .from(commitments)
    .where(and(eq(commitments.userId, userId), inArray(commitments.id, [fromId, toId])));
  if (owned.length !== 2) return false;

  const edges = await db
    .select({ fromId: commitmentEdges.fromId, toId: commitmentEdges.toId })
    .from(commitmentEdges)
    .where(and(eq(commitmentEdges.userId, userId), eq(commitmentEdges.type, "DEPENDS_ON")));
  // If "toId" already depends (directly or not) on "fromId", this link would make a loop.
  if (reaches(edges, toId, fromId)) return false;

  const inserted = await db
    .insert(commitmentEdges)
    .values({ userId, fromId, toId, type: "DEPENDS_ON" })
    .onConflictDoNothing()
    .returning({ id: commitmentEdges.id });
  return inserted.length > 0;
}

// Returns false if the commitment does not exist or is not the user's.
export async function updateCommitment(
  userId: string,
  id: string,
  patch: {
    status?: CommitmentStatus | undefined;
    impact?: Impact | undefined;
    dueDate?: string | null | undefined;
  },
  actor: "user" | "second",
): Promise<boolean> {
  const set: Partial<typeof commitments.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.completedAt = patch.status === "done" ? new Date() : null;
    if (patch.status !== "waiting") set.waitingOn = null;
  }
  if (patch.impact !== undefined) set.impact = patch.impact;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(commitments)
      .set(set)
      .where(and(eq(commitments.id, id), eq(commitments.userId, userId)))
      .returning({ id: commitments.id });
    if (!row) return false;
    await tx.insert(commitmentEvents).values({
      userId,
      commitmentId: id,
      type: patch.status === "done" ? "completed" : "updated",
      actor,
    });
    return true;
  });
}

// Returns false if it does not exist or is not the user's. Removes a matter that becomes empty.
export async function deleteCommitment(userId: string, id: string, actor: "user" | "second"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(commitments)
      .where(and(eq(commitments.id, id), eq(commitments.userId, userId)))
      .returning({ id: commitments.id, matterId: commitments.matterId });
    if (!row) return false;
    await tx.insert(commitmentEvents).values({ userId, commitmentId: id, type: "deleted", actor });

    if (row.matterId) {
      const [left] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(commitments)
        .where(eq(commitments.matterId, row.matterId));
      if ((left?.n ?? 0) === 0) {
        await tx.delete(matters).where(and(eq(matters.id, row.matterId), eq(matters.userId, userId)));
      }
    }
    return true;
  });
}