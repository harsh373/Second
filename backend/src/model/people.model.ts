import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../utility/db";
import { interactions, openLoops, people, userRelationships } from "../../../database/schema/index";
import { containsSensitive } from "./memory.model";

export const PEOPLE_LIMIT = 300; // rows per user (including removed tombstones)
export const INTERACTIONS_PER_PERSON = 20;
export const LABEL_MAX = 60;
export const NAME_MAX = 80;
const INSERT_CHUNK = 500;

export type Direction = "from" | "to"; // from = they wrote last, to = the user wrote last

export interface ScanThread {
  threadId: string;
  subject: string;
  lastMessageAt: Date;
  lastDirection: Direction;
  messageCount: number;
  sourceUrl: string;
}

export interface ScanPerson {
  email: string;
  name: string | null;
  lastContactAt: Date;
  threads: ScanThread[];
}

export interface ScanOutcome {
  added: number;
  updated: number; // people already known and seen again
  skippedRemoved: number; // people the user removed
  skippedLimit: number; // not added because of the people limit
}

export interface InteractionView {
  threadId: string;
  subject: string;
  lastMessageAt: string;
  direction: Direction;
  messageCount: number;
  sourceUrl: string;
  openLoop: "needs_reply" | "waiting_on" | null;
}

export interface PersonView {
  id: string;
  name: string | null;
  email: string | null;
  relationship: { label: string; source: "chat" | "manual"; excerpt: string | null } | null;
  interactionCount: number;
  lastContactAt: string | null;
  lastDirection: Direction | null;
  openLoopCount: number;
  interactions: InteractionView[];
}

export interface StatedRelationship {
  id: string;
  name: string;
  label: string;
  action: "created" | "labelled" | "relabelled";
  previousLabel: string | null;
}

// ---------- validation ----------

export function normalizeName(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function checkLabel(label: string): string | null {
  if (label.length === 0) return "The relationship cannot be empty.";
  if (label.length > LABEL_MAX) return `The relationship must be at most ${LABEL_MAX} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(label)) return "The relationship contains invalid characters.";
  if (containsSensitive(label)) return "The relationship looks like it contains sensitive information.";
  return null;
}

export function checkPersonName(name: string): string | null {
  if (name.length === 0) return "The name cannot be empty.";
  if (name.length > NAME_MAX) return `The name must be at most ${NAME_MAX} characters.`;
  if (name.includes("@")) return "The name looks like an email address.";
  if (!/\p{L}/u.test(name)) return "The name needs at least one letter.";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "The name contains invalid characters.";
  if (containsSensitive(name)) return "The name looks like it contains sensitive information.";
  return null;
}

// ---------- the Gmail refresh ----------

// Writes the result of a Gmail scan. Existing people are matched by email. People the user removed are skipped.
export async function applyScan(userId: string, scanned: ScanPerson[]): Promise<ScanOutcome> {
  const outcome: ScanOutcome = { added: 0, updated: 0, skippedRemoved: 0, skippedLimit: 0 };
  if (scanned.length === 0) return outcome;

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: people.id, email: people.email, name: people.name, hidden: people.hidden })
      .from(people)
      .where(and(eq(people.userId, userId), inArray(people.email, scanned.map((p) => p.email))));
    const byEmail = new Map<string, (typeof existing)[number]>();
    for (const row of existing) if (row.email) byEmail.set(row.email, row);

    const [countRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(people)
      .where(eq(people.userId, userId));
    const total = countRow?.n ?? 0;

    const personIds = new Map<string, string>(); // email -> person id
    const toInsert: ScanPerson[] = [];

    // `scanned` is ordered most recent first, so the limit keeps the most recent contacts.
    for (const p of scanned) {
      const row = byEmail.get(p.email);
      if (row) {
        if (row.hidden) {
          outcome.skippedRemoved += 1;
          continue;
        }
        personIds.set(p.email, row.id);
        outcome.updated += 1;
        if (!row.name && p.name) {
          await tx
            .update(people)
            .set({ name: p.name, normalizedName: normalizeName(p.name), updatedAt: new Date() })
            .where(eq(people.id, row.id));
        }
      } else if (total + toInsert.length >= PEOPLE_LIMIT) {
        outcome.skippedLimit += 1;
      } else {
        toInsert.push(p);
      }
    }

    if (toInsert.length > 0) {
      const inserted = await tx
        .insert(people)
        .values(
          toInsert.map((p) => ({
            userId,
            email: p.email,
            name: p.name,
            normalizedName: p.name ? normalizeName(p.name) : null,
          })),
        )
        .returning({ id: people.id, email: people.email });
      for (const row of inserted) if (row.email) personIds.set(row.email, row.id);
      outcome.added = inserted.length;
    }

    const rows: (typeof interactions.$inferInsert)[] = [];
    for (const p of scanned) {
      const personId = personIds.get(p.email);
      if (!personId) continue;
      for (const t of p.threads) {
        rows.push({
          userId,
          personId,
          threadId: t.threadId,
          subject: t.subject,
          lastMessageAt: t.lastMessageAt,
          lastDirection: t.lastDirection,
          messageCount: t.messageCount,
          sourceUrl: t.sourceUrl,
        });
      }
    }

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx
        .insert(interactions)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoUpdate({
          target: [interactions.personId, interactions.threadId],
          set: {
            subject: sql`excluded.subject`,
            lastMessageAt: sql`excluded.last_message_at`,
            lastDirection: sql`excluded.last_direction`,
            messageCount: sql`excluded.message_count`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: new Date(),
          },
        });
    }

    // Keep only the most recent threads per person.
    await tx.execute(sql`
      delete from interactions
      where id in (
        select id from (
          select id, row_number() over (partition by person_id order by last_message_at desc, id) as rn
          from interactions
          where user_id = ${userId}
        ) ranked
        where rn > ${INTERACTIONS_PER_PERSON}
      )
    `);

    return outcome;
  });
}

// ---------- reading ----------

// People who are not removed, with relationship, saved threads and which of those threads are open loops.
// interactionsShown limits how many threads are returned per person (counts are always for all saved threads).
export async function loadPeopleViews(
  userId: string,
  options: { id?: string; interactionsShown: number },
): Promise<PersonView[]> {
  const where = options.id
    ? and(eq(people.userId, userId), eq(people.hidden, false), eq(people.id, options.id))
    : and(eq(people.userId, userId), eq(people.hidden, false));
  const rows = await db.select().from(people).where(where);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [rels, ints] = await Promise.all([
    db
      .select()
      .from(userRelationships)
      .where(and(eq(userRelationships.userId, userId), inArray(userRelationships.personId, ids))),
    db
      .select()
      .from(interactions)
      .where(and(eq(interactions.userId, userId), inArray(interactions.personId, ids)))
      .orderBy(desc(interactions.lastMessageAt)),
  ]);

  const threadIds = [...new Set(ints.map((i) => i.threadId))];
  const loops =
    threadIds.length === 0
      ? []
      : await db
          .select({ threadId: openLoops.threadId, kind: openLoops.kind })
          .from(openLoops)
          .where(
            and(
              eq(openLoops.userId, userId),
              eq(openLoops.status, "active"),
              inArray(openLoops.threadId, threadIds),
            ),
          );
  const loopKind = new Map<string, "needs_reply" | "waiting_on">();
  for (const l of loops) if (l.kind === "needs_reply" || l.kind === "waiting_on") loopKind.set(l.threadId, l.kind);

  const relByPerson = new Map<string, (typeof rels)[number]>();
  for (const r of rels) relByPerson.set(r.personId, r);

  const intsByPerson = new Map<string, (typeof ints)[number][]>();
  for (const i of ints) {
    const list = intsByPerson.get(i.personId);
    if (list) list.push(i);
    else intsByPerson.set(i.personId, [i]);
  }

  const views = rows.map((r): PersonView => {
    const mine = intsByPerson.get(r.id) ?? [];
    const rel = relByPerson.get(r.id);
    const latest = mine[0];
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      relationship: rel
        ? { label: rel.label, source: rel.sourceType === "manual" ? "manual" : "chat", excerpt: rel.excerpt }
        : null,
      interactionCount: mine.length,
      lastContactAt: latest ? latest.lastMessageAt.toISOString() : null,
      lastDirection: latest ? (latest.lastDirection === "from" ? "from" : "to") : null,
      openLoopCount: mine.filter((i) => loopKind.has(i.threadId)).length,
      interactions: mine.slice(0, options.interactionsShown).map(
        (i): InteractionView => ({
          threadId: i.threadId,
          subject: i.subject,
          lastMessageAt: i.lastMessageAt.toISOString(),
          direction: i.lastDirection === "from" ? "from" : "to",
          messageCount: i.messageCount,
          sourceUrl: i.sourceUrl,
          openLoop: loopKind.get(i.threadId) ?? null,
        }),
      ),
    };
  });

  views.sort((a, b) => {
    if (a.lastContactAt && b.lastContactAt) {
      return a.lastContactAt === b.lastContactAt ? 0 : a.lastContactAt < b.lastContactAt ? 1 : -1;
    }
    if (a.lastContactAt) return -1;
    if (b.lastContactAt) return 1;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
  return views;
}

// ---------- changes the user makes ----------

// Sets or clears the relationship label. Returns null if the person is not the user's (or was removed).
export async function setLabel(
  userId: string,
  personId: string,
  label: string | null,
  source: { type: "manual" } | { type: "chat_message"; excerpt: string },
): Promise<{ previousLabel: string | null } | null> {
  return db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.userId, userId), eq(people.hidden, false)))
      .limit(1);
    if (!person) return null;

    const [prev] = await tx
      .select({ label: userRelationships.label })
      .from(userRelationships)
      .where(eq(userRelationships.personId, personId))
      .limit(1);

    if (label === null) {
      await tx.delete(userRelationships).where(eq(userRelationships.personId, personId));
    } else {
      const excerpt = source.type === "chat_message" ? source.excerpt : null;
      await tx
        .insert(userRelationships)
        .values({ userId, personId, label, sourceType: source.type, excerpt })
        .onConflictDoUpdate({
          target: userRelationships.personId,
          set: { label, sourceType: source.type, excerpt, updatedAt: new Date() },
        });
    }
    return { previousLabel: prev?.label ?? null };
  });
}

// Gmail people (with an email) are kept as a hidden tombstone so a refresh does not bring them back.
// Name-only people are deleted completely. Returns false if the person is not the user's.
export async function deletePerson(userId: string, personId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: people.id, email: people.email })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.userId, userId), eq(people.hidden, false)))
      .limit(1);
    if (!person) return false;

    if (person.email) {
      await tx.delete(interactions).where(eq(interactions.personId, personId));
      await tx.delete(userRelationships).where(eq(userRelationships.personId, personId));
      await tx
        .update(people)
        .set({ hidden: true, name: null, normalizedName: null, updatedAt: new Date() })
        .where(eq(people.id, personId));
    } else {
      await tx.delete(people).where(eq(people.id, personId)); // interactions and relationship cascade
    }
    return true;
  });
}

// A relationship the user stated in chat. Matches a person by EXACT name only (never fuzzy).
// Returns null when nothing should be saved: ambiguous name, same label already set, or the limit is reached.
export async function saveStatedRelationship(
  userId: string,
  input: { name: string; label: string },
  excerpt: string,
): Promise<StatedRelationship | null> {
  const key = normalizeName(input.name);

  return db.transaction(async (tx) => {
    const matches = await tx
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(and(eq(people.userId, userId), eq(people.hidden, false), eq(people.normalizedName, key)))
      .limit(2);
    if (matches.length > 1) return null; // two people share this name: do not guess

    const match = matches[0];
    let personId: string;
    let displayName: string;
    let created = false;

    if (match) {
      personId = match.id;
      displayName = match.name ?? input.name;
    } else {
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(people)
        .where(eq(people.userId, userId));
      if ((countRow?.n ?? 0) >= PEOPLE_LIMIT) return null;

      const [row] = await tx
        .insert(people)
        .values({ userId, name: input.name, normalizedName: key })
        .returning({ id: people.id });
      if (!row) return null;
      personId = row.id;
      displayName = input.name;
      created = true;
    }

    const [prev] = await tx
      .select({ label: userRelationships.label })
      .from(userRelationships)
      .where(eq(userRelationships.personId, personId))
      .limit(1);
    if (prev && normalizeName(prev.label) === normalizeName(input.label)) return null;

    await tx
      .insert(userRelationships)
      .values({ userId, personId, label: input.label, sourceType: "chat_message", excerpt })
      .onConflictDoUpdate({
        target: userRelationships.personId,
        set: { label: input.label, sourceType: "chat_message", excerpt, updatedAt: new Date() },
      });

    return {
      id: personId,
      name: displayName,
      label: input.label,
      action: created ? "created" : prev ? "relabelled" : "labelled",
      previousLabel: prev?.label ?? null,
    };
  });
}