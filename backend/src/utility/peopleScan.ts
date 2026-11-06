import { INTERACTIONS_PER_PERSON, applyScan, type Direction, type ScanOutcome, type ScanPerson, type ScanThread } from "../model/people.model";
import { isAutomatedAddress, listRecentThreads, type GmailThread, type Participant } from "./gmail";

const SINCE_DAYS = 30;
const MAX_THREADS = 100;
const MAX_RECIPIENTS = 8; // a message the user sent to more people than this is treated as a mailing, not a conversation

export interface PeopleScanSummary extends ScanOutcome {
  threadsScanned: number;
  capped: boolean; // true when the thread limit was reached, so older threads may be missing
  sinceDays: number;
  peopleSeen: number;
}

interface Found {
  email: string;
  name: string | null;
  nameAt: number;
  threads: Map<string, ScanThread>;
}

// Removes control and direction-override characters, collapses whitespace, cuts to a length.
function clean(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanName(raw: string | null, email: string): string | null {
  const name = clean(raw ?? "", 80);
  if (!name || name.includes("@") || name.toLowerCase() === email) return null;
  return name;
}

const SANE_EMAIL = /^[^\s@]+@[^\s@]+$/;

// Counterparts are only people who wrote TO the user (not automated), or people the user wrote TO.
// Other recipients of someone else's email are ignored: being on a CC line is not a relationship.
function collect(thread: GmailThread, account: string, found: Map<string, Found>): void {
  const selves = new Set<string>([account]);
  for (const m of thread.messages) if (m.fromUser && m.from) selves.add(m.from.email);
  const subject = clean(thread.subject, 200) || "(no subject)";

  for (const m of thread.messages) {
    if (m.labelIds.includes("DRAFT") || !m.date) continue;
    const at = Date.parse(m.date);
    if (Number.isNaN(at)) continue;

    let others: Participant[];
    let direction: Direction;
    if (m.fromUser) {
      others = [...m.to, ...m.cc];
      if (others.length > MAX_RECIPIENTS) continue;
      direction = "to";
    } else {
      others = m.from && !m.automated ? [m.from] : [];
      direction = "from";
    }

    for (const p of others) {
      if (selves.has(p.email) || isAutomatedAddress(p.email)) continue;
      if (p.email.length > 254 || !SANE_EMAIL.test(p.email)) continue;

      let entry = found.get(p.email);
      if (!entry) {
        entry = { email: p.email, name: null, nameAt: 0, threads: new Map() };
        found.set(p.email, entry);
      }

      const name = cleanName(p.name, p.email);
      if (name && at >= entry.nameAt) {
        entry.name = name;
        entry.nameAt = at;
      }

      const seen = entry.threads.get(thread.id);
      if (!seen) {
        entry.threads.set(thread.id, {
          threadId: thread.id,
          subject,
          lastMessageAt: new Date(at),
          lastDirection: direction,
          messageCount: 1,
          sourceUrl: thread.sourceUrl,
        });
      } else {
        seen.messageCount += 1;
        if (at >= seen.lastMessageAt.getTime()) {
          seen.lastMessageAt = new Date(at);
          seen.lastDirection = direction;
        }
      }
    }
  }
}

// Reads Google first. If Google is not connected this throws before anything is written.
export async function runPeopleScan(userId: string): Promise<PeopleScanSummary> {
  const { account, sinceDays, threads } = await listRecentThreads(userId, {
    sinceDays: SINCE_DAYS,
    maxThreads: MAX_THREADS,
  });

  const found = new Map<string, Found>();
  for (const thread of threads) collect(thread, account, found);

  const scanned: ScanPerson[] = [];
  for (const f of found.values()) {
    const list = [...f.threads.values()].sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
    const latest = list[0];
    if (!latest) continue;
    scanned.push({
      email: f.email,
      name: f.name,
      lastContactAt: latest.lastMessageAt,
      threads: list.slice(0, INTERACTIONS_PER_PERSON),
    });
  }
  scanned.sort((a, b) => b.lastContactAt.getTime() - a.lastContactAt.getTime());

  const outcome = await applyScan(userId, scanned);
  return {
    ...outcome,
    threadsScanned: threads.length,
    capped: threads.length >= MAX_THREADS,
    sinceDays,
    peopleSeen: scanned.length,
  };
}