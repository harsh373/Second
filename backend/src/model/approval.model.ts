import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type {
  ApprovalPayload,
  CommitmentPayload,
  DraftPayload,
  SendPayload,
} from "../../../database/schema/approvals";
import { actionEvents, approvals, commitments } from "../../../database/schema/index";
import { AppError } from "../utility/AppError";
import { db } from "../utility/db";
import { createReplyDraft, getReplyContext, sendDraft, verifyDraft, verifyDraftForSend, verifySent } from "../utility/gmailDraft";
import { requireGoogleAccess } from "../utility/googleCall";
import { logger } from "../utility/logger";
import {
  COMMITMENT_LIMIT,
  IMPACTS,
  checkCommitmentTitle,
  countCommitments,
  createCommitment,
  isValidDate,
} from "./commitment.model";
import { listDelegationViews, type DelegationView } from "./delegation.model";
import { containsSensitive } from "./memory.model";

export const APPROVAL_PENDING_LIMIT = 10;
export const APPROVAL_EXPIRY_DAYS = 7;
export const SEND_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const REASON_MAX = 300;
export const DRAFT_BODY_MAX = 4000;
const EXECUTING_TIMEOUT_MS = 5 * 60 * 1000;
const HISTORY_SHOWN = 50;
const EVENTS_SHOWN = 8;
const SENDS_LOOKED_AT = 200;

// The action type is also the delegation tool name that must allow it.
const COMMITMENT_ACTION = "create_commitment";
const DRAFT_ACTION = "gmail_create_draft";
const SEND_ACTION = "gmail_send";
type ActionType = typeof COMMITMENT_ACTION | typeof DRAFT_ACTION | typeof SEND_ACTION;

const ACTION_LABEL: Record<ActionType, string> = {
  create_commitment: "tracking commitments (tool: Track a commitment)",
  gmail_create_draft: "creating Gmail drafts (tool: Create a Gmail draft)",
  gmail_send: "sending emails (tool: Send an email, authority Execute with approval)",
};

type Impact = (typeof IMPACTS)[number];
type ApprovalRow = typeof approvals.$inferSelect;
export type ApprovalStatus = "pending" | "executing" | "executed" | "failed" | "rejected" | "expired";

const LIVE_STATUSES: ApprovalStatus[] = ["pending", "executing", "executed"];

export interface ApprovalView {
  id: string;
  actionType: string;
  commitment: CommitmentPayload | null;
  draft: { to: string; subject: string; body: string } | null;
  // Set on a gmail_send row: the exact email that will be sent.
  send: { to: string; subject: string; body: string; draftApprovalId: string } | null;
  // Set on an executed draft row: the send proposal that belongs to it, if any.
  sendOfDraft: { approvalId: string; status: ApprovalStatus } | null;
  sourceUrl: string | null;
  reason: string | null;
  status: ApprovalStatus;
  errorMessage: string | null;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
  delegation: { responsibility: string; scope: string; authority: string; restrictions: string[] } | null;
  events: { type: string; at: Date }[];
}

function tidy(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Keeps line breaks (a draft is multi-line) but removes control and direction-override characters.
function cleanBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function asCommitment(p: ApprovalPayload): CommitmentPayload | null {
  return "title" in p ? p : null;
}

// A send payload also has a threadId, so a draft is a payload with threadId and WITHOUT draftId.
function asDraft(p: ApprovalPayload): DraftPayload | null {
  return "threadId" in p && !("draftId" in p) ? p : null;
}

function asSend(p: ApprovalPayload): SendPayload | null {
  return "draftId" in p ? p : null;
}

// The fields that make up the fingerprint of each action. Changing any of them changes the hash.
// The commitment format is identical to Feature 14, so old rows still verify.
function hashPayload(actionType: string, p: ApprovalPayload): string | null {
  const c = asCommitment(p);
  const d = asDraft(p);
  const s = asSend(p);
  let fields: unknown[] | null = null;
  if (actionType === COMMITMENT_ACTION && c) fields = [c.title, c.dueDate, c.impact];
  if (actionType === DRAFT_ACTION && d) fields = [d.threadId, d.to, d.subject, d.body, d.inReplyTo, d.references];
  if (actionType === SEND_ACTION && s) fields = [s.draftId, s.threadId, s.to, s.subject, s.body, s.sourceApprovalId];
  return fields ? createHash("sha256").update(JSON.stringify([actionType, ...fields])).digest("hex") : null;
}

// Only Gmail and Google Calendar links are accepted as a source.
function checkSourceUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, "The source link is not a valid URL.", "INVALID_PROPOSAL");
  }
  const host = url.hostname;
  const ok =
    url.protocol === "https:" &&
    raw.length <= 500 &&
    (host === "mail.google.com" ||
      host === "calendar.google.com" ||
      (host === "www.google.com" && url.pathname.startsWith("/calendar")));
  if (!ok) {
    throw new AppError(400, "The source link must be a Gmail or Google Calendar link.", "INVALID_PROPOSAL");
  }
  return raw;
}

function checkReason(value: string): string {
  const reason = tidy(value).slice(0, REASON_MAX);
  if (reason.length === 0) throw new AppError(400, "Give a short reason for the proposal.", "INVALID_PROPOSAL");
  if (containsSensitive(reason)) {
    throw new AppError(400, "The reason looks like it contains a secret or a long number.", "INVALID_PROPOSAL");
  }
  return reason;
}

// The backend decides permission: an ACTIVE delegation with an executing authority level must list the tool.
// Sending is stricter: only Execute with approval counts, never a narrow delegation.
function pickDelegation(delegations: DelegationView[], tool: string): DelegationView | null {
  const approvalOnly = tool === SEND_ACTION;
  return (
    delegations.find(
      (d) =>
        d.status === "active" &&
        (d.authority === "execute_with_approval" || (!approvalOnly && d.authority === "narrow_delegation")) &&
        (d.tools as readonly string[]).includes(tool),
    ) ?? null
  );
}

async function findAuthorizingDelegation(userId: string, tool: string): Promise<DelegationView | null> {
  const { delegations } = await listDelegationViews(userId);
  return pickDelegation(delegations, tool);
}

async function requireDelegationToPropose(userId: string, action: ActionType): Promise<void> {
  if (!(await findAuthorizingDelegation(userId, action))) {
    throw new AppError(
      403,
      `The user has no active delegation that allows ${ACTION_LABEL[action]}. Tell them to create one on the Delegations page. You cannot do this for them.`,
      "NO_DELEGATION",
    );
  }
}

// There is no scheduler yet, so stale rows are cleaned up whenever approvals are read.
async function expireStale(userId: string): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const expired = await tx
      .update(approvals)
      .set({ status: "expired", decidedAt: now })
      .where(and(eq(approvals.userId, userId), eq(approvals.status, "pending"), lt(approvals.expiresAt, now)))
      .returning({ id: approvals.id });
    const stuck = await tx
      .update(approvals)
      .set({
        status: "failed",
        executedAt: now,
        errorMessage:
          "It was interrupted before it finished. Check the result (your Commitments page, your Gmail Drafts folder or your Gmail Sent folder) before proposing it again. It is never run twice automatically.",
      })
      .where(
        and(
          eq(approvals.userId, userId),
          eq(approvals.status, "executing"),
          lt(approvals.decidedAt, new Date(now.getTime() - EXECUTING_TIMEOUT_MS)),
        ),
      )
      .returning({ id: approvals.id });
    const events = [
      ...expired.map((r) => ({ userId, approvalId: r.id, type: "expired" })),
      ...stuck.map((r) => ({ userId, approvalId: r.id, type: "failed" })),
    ];
    if (events.length > 0) await tx.insert(actionEvents).values(events);
  });
}

// ---- Proposing (it only saves a pending row) ----

type ProposalResult = { approvalId: string; duplicate: boolean; status: string };

async function saveProposal(
  userId: string,
  input: {
    actionType: ActionType;
    payload: ApprovalPayload;
    sourceUrl: string | null;
    reason: string;
    expiresInMs?: number | undefined;
  },
): Promise<ProposalResult> {
  const payloadHash = hashPayload(input.actionType, input.payload);
  if (!payloadHash) throw new AppError(400, "The proposal is not valid.", "INVALID_PROPOSAL");

  await expireStale(userId);

  const createdId = await db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(approvals)
      .where(and(eq(approvals.userId, userId), eq(approvals.status, "pending")));
    if ((pending?.n ?? 0) >= APPROVAL_PENDING_LIMIT) {
      throw new AppError(
        409,
        `There are already ${APPROVAL_PENDING_LIMIT} proposals waiting. Ask the user to approve or reject some first.`,
        "PENDING_LIMIT",
      );
    }
    const [row] = await tx
      .insert(approvals)
      .values({
        userId,
        actionType: input.actionType,
        payload: input.payload,
        payloadHash,
        sourceUrl: input.sourceUrl,
        reason: input.reason,
        expiresAt: new Date(Date.now() + (input.expiresInMs ?? APPROVAL_EXPIRY_DAYS * 86_400_000)),
      })
      .onConflictDoNothing()
      .returning({ id: approvals.id });
    if (!row) return null;
    await tx.insert(actionEvents).values({ userId, approvalId: row.id, type: "created" });
    return row.id;
  });
  if (createdId) return { approvalId: createdId, duplicate: false, status: "pending" };

  const [existing] = await db
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(
      and(
        eq(approvals.userId, userId),
        eq(approvals.payloadHash, payloadHash),
        inArray(approvals.status, LIVE_STATUSES),
      ),
    )
    .limit(1);
  if (!existing) throw new AppError(409, "Could not save the proposal. Try again.", "PROPOSAL_CONFLICT");
  return { approvalId: existing.id, duplicate: true, status: existing.status };
}

export async function proposeCommitment(
  userId: string,
  input: {
    title: string;
    reason: string;
    dueDate?: string | undefined;
    impact?: string | undefined;
    sourceUrl?: string | undefined;
  },
): Promise<ProposalResult> {
  const title = tidy(input.title);
  const problem = checkCommitmentTitle(title);
  if (problem) throw new AppError(400, problem, "INVALID_PROPOSAL");

  const dueDate = input.dueDate?.trim() ? input.dueDate.trim() : null;
  if (dueDate !== null && !isValidDate(dueDate)) {
    throw new AppError(400, "The due date must be YYYY-MM-DD.", "INVALID_PROPOSAL");
  }

  const impact = input.impact?.trim() || "normal";
  if (!(IMPACTS as readonly string[]).includes(impact)) {
    throw new AppError(400, "Impact must be low, normal or high.", "INVALID_PROPOSAL");
  }

  const reason = checkReason(input.reason);
  const sourceUrl = checkSourceUrl(input.sourceUrl);
  await requireDelegationToPropose(userId, COMMITMENT_ACTION);

  return saveProposal(userId, {
    actionType: COMMITMENT_ACTION,
    payload: { title, dueDate, impact },
    sourceUrl,
    reason,
  });
}

// The AI supplies only the thread, the text and the reason. The recipient, subject and threading
// headers come from the real Gmail thread (getReplyContext), so an email cannot choose who gets the reply.
export async function proposeReplyDraft(
  userId: string,
  input: { threadId: string; body: string; reason: string },
): Promise<ProposalResult> {
  const threadId = input.threadId.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(threadId)) {
    throw new AppError(400, "The thread id is not valid. Use a threadId from a tool result.", "INVALID_PROPOSAL");
  }

  const body = cleanBody(input.body);
  if (body.length === 0) throw new AppError(400, "The draft text is empty.", "INVALID_PROPOSAL");
  if (body.length > DRAFT_BODY_MAX) {
    throw new AppError(400, `The draft is too long (maximum ${DRAFT_BODY_MAX} characters).`, "INVALID_PROPOSAL");
  }
  if (containsSensitive(body)) {
    throw new AppError(
      400,
      "The draft text looks like it contains a secret or a long number, so it was not saved. Leave those out.",
      "INVALID_PROPOSAL",
    );
  }

  const reason = checkReason(input.reason);
  await requireDelegationToPropose(userId, DRAFT_ACTION);
  await requireGoogleAccess(userId, "gmail_compose");

  const ctx = await getReplyContext(userId, threadId);
  return saveProposal(userId, {
    actionType: DRAFT_ACTION,
    payload: { threadId, to: ctx.to, subject: ctx.subject, body, inReplyTo: ctx.inReplyTo, references: ctx.references },
    sourceUrl: ctx.sourceUrl,
    reason,
  });
}

// Called when the USER presses Send on an executed draft card. It is not an agent tool: the AI cannot reach it.
// Everything in the proposal is copied from the draft the user already approved and the backend re-verified.
export async function proposeSend(userId: string, draftApprovalId: string): Promise<ProposalResult> {
  await expireStale(userId);

  const [source] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, draftApprovalId), eq(approvals.userId, userId)));
  if (!source || source.actionType !== DRAFT_ACTION) {
    throw new AppError(404, "Draft not found.", "APPROVAL_NOT_FOUND");
  }
  const draft = asDraft(source.payload);
  if (source.status !== "executed" || !source.resultRef || !draft) {
    throw new AppError(409, "Only a draft that was created and verified can be sent.", "APPROVAL_STATE");
  }

  await requireDelegationToPropose(userId, SEND_ACTION);
  await requireGoogleAccess(userId, "gmail_compose");

  // Read the draft from Gmail now, so the user is never asked to approve a send that is already known to be wrong.
  const problem = await verifyDraftForSend(userId, source.resultRef, draft);
  if (problem) {
    throw new AppError(
      409,
      `${problem} This draft cannot be sent from here. Ask Second for a new draft, or send it yourself from Gmail.`,
      "DRAFT_CHANGED",
    );
  }

  return saveProposal(userId, {
    actionType: SEND_ACTION,
    payload: {
      draftId: source.resultRef,
      threadId: draft.threadId,
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      sourceApprovalId: source.id,
    },
    sourceUrl: source.sourceUrl,
    reason: "You pressed Send on a draft you approved earlier.",
    expiresInMs: SEND_EXPIRY_MS,
  });
}

// ---- Reading ----

async function loadViews(userId: string, id?: string): Promise<ApprovalView[]> {
  const rows = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.userId, userId), id ? eq(approvals.id, id) : undefined))
    .orderBy(desc(approvals.createdAt))
    .limit(HISTORY_SHOWN);
  if (rows.length === 0) return [];

  const events = await db
    .select()
    .from(actionEvents)
    .where(and(eq(actionEvents.userId, userId), inArray(actionEvents.approvalId, rows.map((r) => r.id))))
    .orderBy(desc(actionEvents.createdAt));
  const delegations = rows.some((r) => r.status === "pending") ? (await listDelegationViews(userId)).delegations : [];

  // For each executed draft, find the send proposal that belongs to it (a live one wins over a dead one).
  const draftIds = rows.filter((r) => r.actionType === DRAFT_ACTION && r.status === "executed").map((r) => r.id);
  const sendOf = new Map<string, { approvalId: string; status: ApprovalStatus }>();
  if (draftIds.length > 0) {
    const sends = await db
      .select({ id: approvals.id, status: approvals.status, payload: approvals.payload })
      .from(approvals)
      .where(and(eq(approvals.userId, userId), eq(approvals.actionType, SEND_ACTION)))
      .orderBy(desc(approvals.createdAt))
      .limit(SENDS_LOOKED_AT);
    for (const s of sends) {
      const p = asSend(s.payload);
      if (!p || !draftIds.includes(p.sourceApprovalId)) continue;
      const status = s.status as ApprovalStatus;
      const current = sendOf.get(p.sourceApprovalId);
      if (!current || (LIVE_STATUSES.includes(status) && !LIVE_STATUSES.includes(current.status))) {
        sendOf.set(p.sourceApprovalId, { approvalId: s.id, status });
      }
    }
  }

  return rows.map((r) => {
    const draft = r.actionType === DRAFT_ACTION ? asDraft(r.payload) : null;
    const send = r.actionType === SEND_ACTION ? asSend(r.payload) : null;
    const delegation = r.status === "pending" ? pickDelegation(delegations, r.actionType) : null;
    return {
      id: r.id,
      actionType: r.actionType,
      commitment: r.actionType === COMMITMENT_ACTION ? asCommitment(r.payload) : null,
      draft: draft ? { to: draft.to, subject: draft.subject, body: draft.body } : null,
      send: send
        ? { to: send.to, subject: send.subject, body: send.body, draftApprovalId: send.sourceApprovalId }
        : null,
      sendOfDraft: draft && r.status === "executed" ? (sendOf.get(r.id) ?? null) : null,
      sourceUrl: r.sourceUrl,
      reason: r.reason,
      status: r.status as ApprovalStatus,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      decidedAt: r.decidedAt,
      executedAt: r.executedAt,
      delegation: delegation
        ? {
            responsibility: delegation.responsibility,
            scope: delegation.scope,
            authority: delegation.authority,
            restrictions: delegation.restrictions,
          }
        : null,
      events: events
        .filter((e) => e.approvalId === r.id)
        .slice(0, EVENTS_SHOWN)
        .map((e) => ({ type: e.type, at: e.createdAt })),
    };
  });
}

export async function listApprovalViews(userId: string): Promise<ApprovalView[]> {
  await expireStale(userId);
  return loadViews(userId);
}

// ---- Deciding ----

async function notPending(userId: string, id: string): Promise<AppError> {
  const [exists] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.id, id), eq(approvals.userId, userId)));
  return exists
    ? new AppError(409, "This proposal is no longer pending.", "APPROVAL_STATE")
    : new AppError(404, "Proposal not found.", "APPROVAL_NOT_FOUND");
}

export async function rejectApproval(userId: string, id: string): Promise<void> {
  await expireStale(userId);
  const changed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(approvals)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(eq(approvals.id, id), eq(approvals.userId, userId), eq(approvals.status, "pending")))
      .returning({ id: approvals.id });
    if (rows.length > 0) await tx.insert(actionEvents).values({ userId, approvalId: id, type: "rejected" });
    return rows.length;
  });
  if (changed === 0) throw await notPending(userId, id);
}

async function settle(
  userId: string,
  id: string,
  from: ApprovalStatus,
  to: "executed" | "failed",
  details: { errorMessage?: string | undefined; resultRef?: string | undefined } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(approvals)
      .set({
        status: to,
        executedAt: new Date(),
        errorMessage: details.errorMessage ?? null,
        // A provider id saved earlier is kept unless a new one is given.
        ...(details.resultRef ? { resultRef: details.resultRef } : {}),
      })
      .where(and(eq(approvals.id, id), eq(approvals.userId, userId), eq(approvals.status, from)))
      .returning({ id: approvals.id });
    if (rows.length > 0) await tx.insert(actionEvents).values({ userId, approvalId: id, type: to });
  });
}

// Saved the moment the provider returns an id, before verifying, so a crash never loses track of what was created.
async function saveRef(userId: string, id: string, ref: string): Promise<void> {
  await db
    .update(approvals)
    .set({ resultRef: ref })
    .where(and(eq(approvals.id, id), eq(approvals.userId, userId), eq(approvals.status, "executing")));
}

// Reads the commitment back from the database and compares it with what was approved.
async function verifyCommitment(userId: string, commitmentId: string, p: CommitmentPayload): Promise<boolean> {
  const [row] = await db
    .select({
      title: commitments.title,
      dueDate: commitments.dueDate,
      impact: commitments.impact,
      status: commitments.status,
    })
    .from(commitments)
    .where(and(eq(commitments.id, commitmentId), eq(commitments.userId, userId)));
  return !!row && row.title === p.title && row.dueDate === p.dueDate && row.impact === p.impact && row.status === "open";
}

type Outcome = { ok: true; ref: string } | { ok: false; message: string; ref?: string | undefined };

// The per-action part: execute, then verify against the provider. The state machine around it does not change per action.
async function runAction(
  userId: string,
  row: ApprovalRow,
  remember: (ref: string) => Promise<void>,
): Promise<Outcome> {
  if (row.actionType === COMMITMENT_ACTION) {
    const p = asCommitment(row.payload);
    if (!p) return { ok: false, message: "The saved proposal is not valid, so it was not run." };
    if ((await countCommitments(userId)) >= COMMITMENT_LIMIT) {
      return { ok: false, message: "You already track the maximum number of commitments." };
    }
    const created = await createCommitment(
      userId,
      { title: p.title, dueDate: p.dueDate, impact: p.impact as Impact },
      { type: "manual" },
      "second",
    );
    if (!created) return { ok: false, message: "An unfinished commitment with the same title already exists." };
    if (await verifyCommitment(userId, created.id, p)) return { ok: true, ref: created.id };
    return {
      ok: false,
      ref: created.id,
      message: "The commitment was created but could not be verified. Check your Commitments page.",
    };
  }

  if (row.actionType === DRAFT_ACTION) {
    const p = asDraft(row.payload);
    if (!p) return { ok: false, message: "The saved proposal is not valid, so it was not run." };

    let draftId: string;
    try {
      ({ draftId } = await createReplyDraft(userId, p));
    } catch (err) {
      logger.error("Draft creation failed:", err instanceof Error ? err.message : err);
      const why = err instanceof AppError ? err.message : "Something went wrong while talking to Gmail.";
      return { ok: false, message: `${why} If a draft appeared in your Gmail Drafts, delete it before asking again.` };
    }
    await remember(draftId);

    try {
      if (await verifyDraft(userId, draftId, p)) return { ok: true, ref: draftId };
      return {
        ok: false,
        ref: draftId,
        message:
          "A draft was created but it did not match what you approved. Check your Gmail Drafts and delete it if it looks wrong. Nothing was sent.",
      };
    } catch (err) {
      logger.error("Draft verification failed:", err instanceof Error ? err.message : err);
      return {
        ok: false,
        ref: draftId,
        message: "A draft was created but could not be verified. Check your Gmail Drafts. Nothing was sent.",
      };
    }
  }

  if (row.actionType === SEND_ACTION) {
    const p = asSend(row.payload);
    if (!p) return { ok: false, message: "The saved proposal is not valid, so it was not run." };

    // 1. Re-read the draft from Gmail. If anything differs from what was approved, nothing is sent.
    let problem: string | null;
    try {
      problem = await verifyDraftForSend(userId, p.draftId, p);
    } catch (err) {
      logger.error("Draft re-check before send failed:", err instanceof Error ? err.message : err);
      return { ok: false, message: "Could not re-read the draft from Gmail, so nothing was sent. Try again." };
    }
    if (problem) return { ok: false, message: `Nothing was sent. ${problem}` };

    // 2. Send. From here on, a failure is ambiguous: Gmail may or may not have sent it. It is never retried.
    let messageId: string;
    try {
      ({ messageId } = await sendDraft(userId, p.draftId));
    } catch (err) {
      logger.error("Send failed:", err instanceof Error ? err.message : err);
      return {
        ok: false,
        message:
          "Gmail did not confirm the send. Open your Gmail Sent folder: if the email is there, it was sent. If the draft is still in your Drafts folder, it was not sent. It is never retried automatically.",
      };
    }
    await remember(messageId);

    // 3. Verify by reading the sent message back from Gmail.
    try {
      const bad = await verifySent(userId, messageId, p);
      if (bad === null) return { ok: true, ref: messageId };
      return {
        ok: false,
        ref: messageId,
        message: `Gmail accepted the send, but it could not be confirmed: ${bad} Check your Gmail Sent folder. Do not send it again.`,
      };
    } catch (err) {
      logger.error("Send verification failed:", err instanceof Error ? err.message : err);
      return {
        ok: false,
        ref: messageId,
        message:
          "Gmail accepted the send, but it could not be confirmed. Check your Gmail Sent folder. Do not send it again.",
      };
    }
  }

  return { ok: false, message: "This kind of action is not supported." };
}

export async function approveApproval(userId: string, id: string): Promise<ApprovalView> {
  await expireStale(userId);

  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, id), eq(approvals.userId, userId)));
  if (!row) throw new AppError(404, "Proposal not found.", "APPROVAL_NOT_FOUND");
  if (row.status !== "pending") throw new AppError(409, "This proposal is no longer pending.", "APPROVAL_STATE");

  // 1. Integrity: the saved payload must still match its fingerprint.
  if (hashPayload(row.actionType, row.payload) !== row.payloadHash) {
    await settle(userId, id, "pending", "failed", {
      errorMessage: "The saved proposal no longer matches its fingerprint, so it was not run.",
    });
    const [view] = await loadViews(userId, id);
    if (!view) throw new Error("Could not load the proposal.");
    return view;
  }

  // 2. Permission: decided here, by the backend, right now.
  const delegation = await findAuthorizingDelegation(userId, row.actionType);
  if (!delegation) {
    const label = ACTION_LABEL[row.actionType as ActionType] ?? "this action";
    throw new AppError(
      403,
      `No active delegation allows ${label} right now. Create or resume one on the Delegations page, then approve again.`,
      "NO_DELEGATION",
    );
  }

  // 2b. Google permission, checked BEFORE the claim so a missing permission leaves the proposal pending.
  if (row.actionType === DRAFT_ACTION || row.actionType === SEND_ACTION) {
    await requireGoogleAccess(userId, "gmail_compose");
  }

  // 3. Claim: only one request can move pending to executing, so a double click cannot run it twice.
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(approvals)
      .set({ status: "executing", decidedAt: new Date(), delegationId: delegation.id })
      .where(
        and(
          eq(approvals.id, id),
          eq(approvals.userId, userId),
          eq(approvals.status, "pending"),
          gt(approvals.expiresAt, new Date()),
        ),
      )
      .returning({ id: approvals.id });
    if (rows.length === 0) return false;
    await tx.insert(actionEvents).values([
      { userId, approvalId: id, type: "approved" },
      { userId, approvalId: id, type: "executing" },
    ]);
    return true;
  });
  if (!claimed) throw new AppError(409, "This proposal was already handled or has expired.", "APPROVAL_STATE");

  // 4. Execute, then 5. verify by reading the result back from where it was created.
  try {
    const outcome = await runAction(userId, row, (ref) => saveRef(userId, id, ref));
    if (outcome.ok) {
      await settle(userId, id, "executing", "executed", { resultRef: outcome.ref });
    } else {
      await settle(userId, id, "executing", "failed", { errorMessage: outcome.message, resultRef: outcome.ref });
    }
  } catch (err) {
    logger.error("Approval execution failed:", err instanceof Error ? err.message : err);
    await settle(userId, id, "executing", "failed", {
      errorMessage:
        "Something went wrong while running this action. Check your Commitments page, Gmail Drafts and Gmail Sent folder before trying again.",
    });
  }

  const [view] = await loadViews(userId, id);
  if (!view) throw new Error("Could not load the proposal.");
  return view;
}