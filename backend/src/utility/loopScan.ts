import {
  OPEN_LOOP_LIMIT,
  activeLoopsForCheck,
  countActiveLoops,
  createLoopIfNew,
  markChecked,
  recordScan,
  resolveLoopFromGmail,
  type LoopKind,
} from "../model/openLoop.model";
import { findUnansweredThreads, getThreadsMetadata, type GmailThread, type Participant } from "./gmail";

const RESOLVE_CHECK_LIMIT = 25; // loops re-read from Gmail per scan, to protect the Gmail quota

export interface ScanSummary {
  checked: number; // existing loops re-read from Gmail
  resolved: number; // of those, how many Gmail showed as finished
  created: number; // new loops found
  skippedAtLimit: boolean; // true if new loops were not added because the user is at the limit
  found: { needsReply: number; waitingOn: number }; // what the inbox scan listed
  scanned: { inboxThreads: number; sentThreads: number };
}

// Pure rule: does the live thread show that this loop is finished? Uses Gmail facts only.
export function resolutionFor(
  loop: { kind: string; triggerAt: Date },
  thread: GmailThread | null,
): { reason: string; at: Date | null } | null {
  if (!thread) return { reason: "This thread no longer exists in Gmail.", at: null };

  const messages = thread.messages.filter((m) => !m.labelIds.includes("DRAFT"));
  if (messages.length > 0 && messages.every((m) => m.labelIds.includes("TRASH"))) {
    return { reason: "The thread was moved to Trash.", at: null };
  }

  const triggerTime = loop.triggerAt.getTime();
  const after = messages.filter((m) => m.date !== null && Date.parse(m.date) > triggerTime);

  if (loop.kind === "needs_reply") {
    const reply = after.find((m) => m.fromUser);
    return reply ? { reason: "You replied.", at: new Date(reply.date as string) } : null;
  }
  // waiting_on: a later message from someone else counts, automatic mail (bounces, out-of-office) does not.
  const answer = after.find((m) => !m.fromUser && !m.automated);
  return answer ? { reason: "A reply arrived.", at: new Date(answer.date as string) } : null;
}

function describeCounterparts(people: Participant[]): string | null {
  if (people.length === 0) return null;
  const names = people.slice(0, 3).map((p) => p.name ?? p.email);
  const extra = people.length > 3 ? ` +${people.length - 3} more` : "";
  return `${names.join(", ")}${extra}`.slice(0, 200);
}

// Removes control characters and keeps the subject to a sane length.
function cleanSubject(subject: string): string {
  const flat = subject.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (flat || "(no subject)").slice(0, 200);
}

export async function runScan(userId: string): Promise<ScanSummary> {
  // 1. Read from Gmail first. If Google is not connected this throws before anything is written.
  const toCheck = await activeLoopsForCheck(userId, RESOLVE_CHECK_LIMIT);
  const unanswered = await findUnansweredThreads(userId, {});
  const states =
    toCheck.length > 0
      ? await getThreadsMetadata(userId, [...new Set(toCheck.map((l) => l.threadId))])
      : [];

  // 2. Close loops that Gmail shows are finished.
  const threadById = new Map(states.map((s) => [s.id, s.thread]));
  let resolved = 0;
  for (const loop of toCheck) {
    if (!threadById.has(loop.threadId)) continue; // not re-read this time: leave it alone
    const result = resolutionFor(loop, threadById.get(loop.threadId) ?? null);
    if (result && (await resolveLoopFromGmail(userId, loop.id, result))) resolved += 1;
  }
  await markChecked(
    userId,
    toCheck.map((l) => l.id),
  );

  // 3. Add loops for threads the scan lists that are not tracked yet.
  const candidates = [
    ...unanswered.needsReply.map((item) => ({ kind: "needs_reply" as LoopKind, item })),
    ...unanswered.waitingOn.map((item) => ({ kind: "waiting_on" as LoopKind, item })),
  ];

  let active = await countActiveLoops(userId);
  let created = 0;
  let skippedAtLimit = false;
  for (const { kind, item } of candidates) {
    if (active >= OPEN_LOOP_LIMIT) {
      skippedAtLimit = true;
      break;
    }
    const added = await createLoopIfNew(userId, {
      kind,
      threadId: item.threadId,
      triggerMessageId: item.lastMessage.id,
      triggerAt: new Date(item.lastMessage.date),
      counterpart: describeCounterparts(item.counterparts),
      subject: cleanSubject(item.subject),
      sourceUrl: item.sourceUrl,
    });
    if (added) {
      created += 1;
      active += 1;
    }
  }

  await recordScan(userId);

  return {
    checked: toCheck.length,
    resolved,
    created,
    skippedAtLimit,
    found: { needsReply: unanswered.needsReply.length, waitingOn: unanswered.waitingOn.length },
    scanned: unanswered.scanned,
  };
}