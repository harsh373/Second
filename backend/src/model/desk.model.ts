import { addDays, clean } from "../utility/briefing";
import { daysBetween } from "../utility/priority";
import { listApprovalViews } from "./approval.model";
import { getLatestBriefing } from "./briefing.model";
import { loadCommitmentViews, todayForUser } from "./commitment.model";
import { listDelegationViews } from "./delegation.model";
import { getLastScanAt, listActiveLoops } from "./openLoop.model";

const DAY_MS = 86_400_000;
const APPROVALS_SHOWN = 5;
const COMMITMENTS_SHOWN = 8;
const LOOPS_SHOWN = 5; // per kind
const DELEGATIONS_SHOWN = 5;
const DUE_SOON_DAYS = 7;
const REVIEW_SOON_DAYS = 7;
const LOOPS_READ = 200;

export interface DeskApproval {
  id: string;
  kind: "send" | "draft" | "commitment";
  title: string;
  detail: string | null;
  expiresAt: string;
  blocked: boolean; // true when no active delegation allows it, so Approve would be refused
}

export interface DeskCommitment {
  id: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  status: string;
  waitingOn: string | null;
  band: string | null;
}

export interface DeskLoop {
  id: string;
  subject: string;
  counterpart: string | null;
  daysSince: number;
  sourceUrl: string;
}

export interface DeskDelegation {
  id: string;
  responsibility: string;
  status: string;
  reviewAt: string;
  daysLeft: number;
}

export interface DeskData {
  today: string;
  approvals: { total: number; items: DeskApproval[] };
  commitments: { total: number; items: DeskCommitment[] };
  loops: {
    lastScanAt: string | null;
    needsReplyTotal: number;
    waitingOnTotal: number;
    snoozedHidden: number;
    needsReply: DeskLoop[];
    waitingOn: DeskLoop[];
  };
  delegations: { total: number; items: DeskDelegation[] };
  briefing: { id: string; kind: string; title: string; generatedAt: string } | null;
}

// Reads only what is already saved. It never calls Gmail or Google Calendar.
export async function loadDesk(userId: string): Promise<DeskData> {
  const { today } = await todayForUser(userId);

  const [approvalViews, commitmentViews, loopRows, lastScanAt, delegationData, latestBriefing] = await Promise.all([
    listApprovalViews(userId),
    loadCommitmentViews(userId, today),
    listActiveLoops(userId, LOOPS_READ),
    getLastScanAt(userId),
    listDelegationViews(userId),
    getLatestBriefing(userId),
  ]);

  // 1. Pending approvals
  const pending = approvalViews.filter((a) => a.status === "pending");
  const approvalItems: DeskApproval[] = pending.slice(0, APPROVALS_SHOWN).map((a) => {
    const blocked = a.delegation === null;
    if (a.send) {
      return {
        id: a.id,
        kind: "send",
        title: `Send an email to ${clean(a.send.to, 80)}`,
        detail: clean(a.send.subject, 100) || null,
        expiresAt: a.expiresAt.toISOString(),
        blocked,
      };
    }
    if (a.draft) {
      return {
        id: a.id,
        kind: "draft",
        title: `Reply draft to ${clean(a.draft.to, 80)}`,
        detail: clean(a.draft.subject, 100) || null,
        expiresAt: a.expiresAt.toISOString(),
        blocked,
      };
    }
    return {
      id: a.id,
      kind: "commitment",
      title: `Track: ${clean(a.commitment?.title, 100)}`,
      detail: a.commitment?.dueDate ? `Due ${a.commitment.dueDate}` : null,
      expiresAt: a.expiresAt.toISOString(),
      blocked,
    };
  });

  // 2. Commitments overdue or due within DUE_SOON_DAYS. The model already sorts by priority.
  const horizon = addDays(today, DUE_SOON_DAYS);
  const due = commitmentViews.filter((c) => c.status !== "done" && c.dueDate !== null && c.dueDate <= horizon);
  const commitmentItems: DeskCommitment[] = due.slice(0, COMMITMENTS_SHOWN).map((c) => ({
    id: c.id,
    title: clean(c.title, 120),
    dueDate: c.dueDate as string,
    overdue: (c.dueDate as string) < today,
    status: c.status,
    waitingOn: c.waitingOn ? clean(c.waitingOn, 60) : null,
    band: c.priority?.band ?? null,
  }));

  // 3. Open loops from the last saved scan. Snoozed ones are hidden and counted.
  const live = loopRows.filter((l) => l.snoozedUntil === null || l.snoozedUntil <= today);
  const toLoop = (l: (typeof loopRows)[number]): DeskLoop => ({
    id: l.id,
    subject: clean(l.subject, 120) || "(no subject)",
    counterpart: l.counterpart ? clean(l.counterpart, 80) : null,
    daysSince: Math.max(0, Math.floor((Date.now() - l.triggerAt.getTime()) / DAY_MS)),
    sourceUrl: l.sourceUrl,
  });
  const needsReply = live.filter((l) => l.kind === "needs_reply");
  const waitingOn = live.filter((l) => l.kind === "waiting_on");

  // 4. Delegations whose review date is close (expired ones were already marked by listDelegationViews)
  const reviewHorizon = addDays(today, REVIEW_SOON_DAYS);
  const reviewSoon = delegationData.delegations
    .filter((d) => (d.status === "active" || d.status === "paused") && d.reviewAt <= reviewHorizon)
    .sort((a, b) => (a.reviewAt < b.reviewAt ? -1 : a.reviewAt > b.reviewAt ? 1 : 0));

  return {
    today,
    approvals: { total: pending.length, items: approvalItems },
    commitments: { total: due.length, items: commitmentItems },
    loops: {
      lastScanAt: lastScanAt ? lastScanAt.toISOString() : null,
      needsReplyTotal: needsReply.length,
      waitingOnTotal: waitingOn.length,
      snoozedHidden: loopRows.length - live.length,
      needsReply: needsReply.slice(0, LOOPS_SHOWN).map(toLoop),
      waitingOn: waitingOn.slice(0, LOOPS_SHOWN).map(toLoop),
    },
    delegations: {
      total: reviewSoon.length,
      items: reviewSoon.slice(0, DELEGATIONS_SHOWN).map((d) => ({
        id: d.id,
        responsibility: clean(d.responsibility, 120),
        status: d.status,
        reviewAt: d.reviewAt,
        daysLeft: daysBetween(today, d.reviewAt),
      })),
    },
    briefing: latestBriefing
      ? {
          id: latestBriefing.id,
          kind: latestBriefing.kind,
          title: clean(latestBriefing.title, 120),
          generatedAt: latestBriefing.generatedAt.toISOString(),
        }
      : null,
  };
}