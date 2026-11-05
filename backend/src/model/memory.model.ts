import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../utility/db";
import { memories, memoryEvents, memorySources } from "../../../database/schema/index";

export const MEMORY_CATEGORIES = [
  "identity",
  "preferences",
  "goals",
  "relationships",
  "responsibilities",
  "history",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_MAX_CHARS = 200;
export const MEMORY_LIMIT = 200; // per user

export interface MemorySourceInput {
  type: "chat_message" | "manual";
  conversationId?: string | undefined;
  messageId?: string | undefined;
  excerpt?: string | undefined;
}

export interface MemoryWithSource {
  id: string;
  category: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  source: { type: string; conversationId: string | null; excerpt: string | null; createdAt: Date | null } | null;
}

// ---- Pure rules ----

// Lowercase, no punctuation, single spaces. Two memories with the same normalized text are duplicates.
export function normalizeMemory(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Passwords, keys, tokens, card/ID words, and any run of 9+ digits. Fails closed on purpose.
const SENSITIVE_RE =
  /(pass(word|code|wd)|\botp\b|api[\s_-]?key|secret|access[\s_-]?token|\bcvv\b|card[\s_-]?number|aadhaar|aadhar|\bssn\b)|\d(?:[\s-]?\d){8,}/i;

export function containsSensitive(text: string): boolean {
  return SENSITIVE_RE.test(text);
}

// Returns a reason if the text must not be saved as a memory, or null if it is fine.
export function checkMemoryContent(content: string): string | null {
  if (content.length < 3 || normalizeMemory(content).length < 3) return "That memory is too short.";
  if (content.length > MEMORY_MAX_CHARS) return `Keep a memory under ${MEMORY_MAX_CHARS} characters.`;
  if (containsSensitive(content)) {
    return "Second does not store passwords, keys, tokens or long ID numbers.";
  }
  return null;
}

// ---- Queries (always scoped by userId) ----

export async function countMemories(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memories)
    .where(eq(memories.userId, userId));
  return row?.n ?? 0;
}

export async function listMemoriesWithSource(userId: string): Promise<MemoryWithSource[]> {
  const rows = await db
    .select({
      id: memories.id,
      category: memories.category,
      content: memories.content,
      createdAt: memories.createdAt,
      updatedAt: memories.updatedAt,
      sourceType: memorySources.sourceType,
      conversationId: memorySources.conversationId,
      excerpt: memorySources.excerpt,
      sourceCreatedAt: memorySources.createdAt,
    })
    .from(memories)
    .leftJoin(memorySources, eq(memorySources.memoryId, memories.id))
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.updatedAt), desc(memorySources.createdAt));

  // A memory can have several sources (after updates). Keep the newest one.
  const seen = new Set<string>();
  const out: MemoryWithSource[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      category: r.category,
      content: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      source: r.sourceType
        ? { type: r.sourceType, conversationId: r.conversationId, excerpt: r.excerpt, createdAt: r.sourceCreatedAt }
        : null,
    });
  }
  return out;
}

export async function listMemoriesForPrompt(
  userId: string,
  options: { categories?: string[] | undefined; limit: number },
) {
  const where = options.categories
    ? and(eq(memories.userId, userId), inArray(memories.category, options.categories))
    : eq(memories.userId, userId);
  return db
    .select({ id: memories.id, category: memories.category, content: memories.content })
    .from(memories)
    .where(where)
    .orderBy(desc(memories.updatedAt))
    .limit(options.limit);
}

// Full-text search. The words are letters/digits only and each is quoted, so they cannot break the query syntax.
export async function searchMemories(userId: string, words: string[], limit: number) {
  if (words.length === 0) return [];
  const q = words.map((w) => `'${w}'`).join(" | ");
  return db
    .select({ id: memories.id, category: memories.category, content: memories.content })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        sql`to_tsvector('english', ${memories.content}) @@ to_tsquery('english', ${q})`,
      ),
    )
    .orderBy(sql`ts_rank(to_tsvector('english', ${memories.content}), to_tsquery('english', ${q})) desc`)
    .limit(limit);
}

// Returns null if an identical memory already exists.
export async function createMemory(
  userId: string,
  input: { category: string; content: string },
  source: MemorySourceInput,
  actor: "user" | "second",
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(memories)
      .values({
        userId,
        category: input.category,
        content: input.content,
        normalized: normalizeMemory(input.content),
      })
      .onConflictDoNothing({ target: [memories.userId, memories.normalized] })
      .returning({ id: memories.id, category: memories.category, content: memories.content });
    if (!row) return null;

    await tx.insert(memorySources).values({
      memoryId: row.id,
      sourceType: source.type,
      conversationId: source.conversationId ?? null,
      messageId: source.messageId ?? null,
      excerpt: source.excerpt ?? null,
    });
    await tx.insert(memoryEvents).values({ userId, memoryId: row.id, type: "created", actor });
    return row;
  });
}

// Replaces the text of one of the user's memories. Returns null if it is not theirs or would duplicate another.
export async function updateMemory(
  userId: string,
  id: string,
  input: { category: string; content: string },
  source: MemorySourceInput,
  actor: "user" | "second",
) {
  return db.transaction(async (tx) => {
    const normalized = normalizeMemory(input.content);
    const [clash] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.normalized, normalized)))
      .limit(1);
    if (clash && clash.id !== id) return null;

    const [row] = await tx
      .update(memories)
      .set({ category: input.category, content: input.content, normalized, updatedAt: new Date() })
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning({ id: memories.id, category: memories.category, content: memories.content });
    if (!row) return null;

    await tx.insert(memorySources).values({
      memoryId: row.id,
      sourceType: source.type,
      conversationId: source.conversationId ?? null,
      messageId: source.messageId ?? null,
      excerpt: source.excerpt ?? null,
    });
    await tx.insert(memoryEvents).values({ userId, memoryId: row.id, type: "updated", actor });
    return row;
  });
}

// Returns false if it does not exist or is not the user's.
export async function deleteMemory(userId: string, id: string, actor: "user" | "second"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning({ id: memories.id });
    if (!row) return false;
    await tx.insert(memoryEvents).values({ userId, memoryId: id, type: "deleted", actor });
    return true;
  });
}