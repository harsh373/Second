import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { delegationEvents, delegationRules, delegations } from "../../../database/schema/index";
import { AppError } from "../utility/AppError";
import { addDays } from "../utility/briefing";
import { db } from "../utility/db";
import { isValidDate, todayForUser } from "./commitment.model";
import { containsSensitive } from "./memory.model";

export const DELEGATION_LIMIT = 50;
export const RESPONSIBILITY_MAX = 200;
export const SCOPE_MAX = 300;
export const RESTRICTION_MAX = 120;
export const RESTRICTIONS_MAX_COUNT = 10;
export const MAX_REVIEW_DAYS = 90;
export const NARROW_MAX_REVIEW_DAYS = 30;
const EVENTS_SHOWN = 10;

export const DELEGATION_TRIGGERS = ["when_asked", "new_email", "before_meeting", "schedule"] as const;
export const DELEGATION_AUTHORITIES = ["observe", "suggest", "execute_with_approval", "narrow_delegation"] as const;
// Future tools. None of them exist yet: this is the list a delegation can name.
export const DELEGATION_TOOLS = [
  "gmail_create_draft",
  "gmail_send",
  "gmail_archive",
  "gmail_label",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_cancel_event",
  "create_commitment",
  "set_reminder",
] as const;

export type DelegationTrigger = (typeof DELEGATION_TRIGGERS)[number];
export type DelegationAuthority = (typeof DELEGATION_AUTHORITIES)[number];
export type DelegationTool = (typeof DELEGATION_TOOLS)[number];
export type DelegationStatus = "active" | "paused" | "revoked" | "expired";
export type DelegationAction = "pause" | "resume" | "revoke";

// Too risky to run on standing permission: these always need approval each time.
export const NARROW_BLOCKED_TOOLS: readonly DelegationTool[] = ["gmail_send", "calendar_cancel_event"];

export interface DelegationInput {
  responsibility: string;
  scope: string;
  trigger: DelegationTrigger;
  authority: DelegationAuthority;
  tools: DelegationTool[];
  restrictions: string[];
  reviewAt: string;
}

export interface DelegationView {
  id: string;
  responsibility: string;
  scope: string;
  trigger: DelegationTrigger;
  authority: DelegationAuthority;
  status: DelegationStatus;
  reviewAt: string;
  createdAt: Date;
  revokedAt: Date | null;
  tools: DelegationTool[];
  restrictions: string[];
  events: { type: string; at: Date }[];
}

function tidy(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function checkText(label: string, value: string, max: number): string {
  const text = tidy(value);
  if (text.length === 0) throw new AppError(400, `${label} cannot be empty.`, "INVALID_DELEGATION");
  if (text.length > max) {
    throw new AppError(400, `${label} is too long (maximum ${max} characters).`, "INVALID_DELEGATION");
  }
  if (containsSensitive(text)) {
    throw new AppError(
      400,
      `${label} looks like it contains a secret or a long number. Remove it.`,
      "INVALID_DELEGATION",
    );
  }
  return text;
}

// There is no scheduler yet, so overdue delegations are marked expired whenever they are read.
async function expireOverdue(userId: string, today: string): Promise<void> {
  await db.transaction(async (tx) => {
    const expired = await tx
      .update(delegations)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(delegations.userId, userId),
          inArray(delegations.status, ["active", "paused"]),
          lt(delegations.reviewAt, today),
        ),
      )
      .returning({ id: delegations.id });
    if (expired.length > 0) {
      await tx
        .insert(delegationEvents)
        .values(expired.map((e) => ({ userId, delegationId: e.id, type: "expired" })));
    }
  });
}

async function loadViews(userId: string, id?: string): Promise<DelegationView[]> {
  const rows = await db
    .select()
    .from(delegations)
    .where(and(eq(delegations.userId, userId), id ? eq(delegations.id, id) : undefined))
    .orderBy(desc(delegations.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [rules, events] = await Promise.all([
    db
      .select()
      .from(delegationRules)
      .where(and(eq(delegationRules.userId, userId), inArray(delegationRules.delegationId, ids)))
      .orderBy(asc(delegationRules.position)),
    db
      .select()
      .from(delegationEvents)
      .where(and(eq(delegationEvents.userId, userId), inArray(delegationEvents.delegationId, ids)))
      .orderBy(desc(delegationEvents.createdAt)),
  ]);

  return rows.map((r) => ({
    id: r.id,
    responsibility: r.responsibility,
    scope: r.scope,
    trigger: r.triggerKind as DelegationTrigger,
    authority: r.authority as DelegationAuthority,
    status: r.status as DelegationStatus,
    reviewAt: r.reviewAt,
    createdAt: r.createdAt,
    revokedAt: r.revokedAt,
    tools: rules.filter((x) => x.delegationId === r.id && x.kind === "tool").map((x) => x.value as DelegationTool),
    restrictions: rules.filter((x) => x.delegationId === r.id && x.kind === "restriction").map((x) => x.value),
    events: events
      .filter((e) => e.delegationId === r.id)
      .slice(0, EVENTS_SHOWN)
      .map((e) => ({ type: e.type, at: e.createdAt })),
  }));
}

export async function listDelegationViews(userId: string): Promise<{ today: string; delegations: DelegationView[] }> {
  const { today } = await todayForUser(userId);
  await expireOverdue(userId, today);
  return { today, delegations: await loadViews(userId) };
}

export async function createDelegation(userId: string, input: DelegationInput): Promise<DelegationView> {
  const responsibility = checkText("Responsibility", input.responsibility, RESPONSIBILITY_MAX);
  const scope = checkText("Scope", input.scope, SCOPE_MAX);

  const restrictions: string[] = [];
  for (const r of input.restrictions) {
    const text = checkText("A restriction", r, RESTRICTION_MAX);
    if (!restrictions.some((x) => x.toLowerCase() === text.toLowerCase())) restrictions.push(text);
  }
  if (restrictions.length > RESTRICTIONS_MAX_COUNT) {
    throw new AppError(400, `At most ${RESTRICTIONS_MAX_COUNT} restrictions.`, "INVALID_DELEGATION");
  }

  // The trust ladder. Only the two higher levels may carry tools.
  const tools = [...new Set(input.tools)];
  const canExecute = input.authority === "execute_with_approval" || input.authority === "narrow_delegation";
  if (!canExecute && tools.length > 0) {
    throw new AppError(
      400,
      "Observe and Suggest never take action, so they cannot have tools. Remove the tools or raise the authority level.",
      "INVALID_DELEGATION",
    );
  }
  if (canExecute && tools.length === 0) {
    throw new AppError(400, "Choose at least one tool for this authority level.", "INVALID_DELEGATION");
  }
  if (input.authority === "narrow_delegation") {
    const blocked = tools.filter((t) => NARROW_BLOCKED_TOOLS.includes(t));
    if (blocked.length > 0) {
      throw new AppError(
        400,
        `${blocked.join(", ")} always needs your approval each time, so it cannot be part of a narrow delegation.`,
        "INVALID_DELEGATION",
      );
    }
  }

  const { today } = await todayForUser(userId);
  if (!isValidDate(input.reviewAt)) {
    throw new AppError(400, "The review date must be a valid date (YYYY-MM-DD).", "INVALID_DELEGATION");
  }
  const maxDays = input.authority === "narrow_delegation" ? NARROW_MAX_REVIEW_DAYS : MAX_REVIEW_DAYS;
  const latest = addDays(today, maxDays);
  if (input.reviewAt <= today) {
    throw new AppError(400, "The review date must be in the future.", "INVALID_DELEGATION");
  }
  if (input.reviewAt > latest) {
    throw new AppError(
      400,
      `For this authority level the review date can be at most ${maxDays} days away (${latest}).`,
      "INVALID_DELEGATION",
    );
  }

  const id = await db.transaction(async (tx) => {
    const countRows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(delegations)
      .where(eq(delegations.userId, userId));
    if ((countRows[0]?.n ?? 0) >= DELEGATION_LIMIT) {
      throw new AppError(
        409,
        `You can keep at most ${DELEGATION_LIMIT} delegations. Delete old revoked or expired ones.`,
        "DELEGATION_LIMIT",
      );
    }

    const [row] = await tx
      .insert(delegations)
      .values({
        userId,
        responsibility,
        scope,
        triggerKind: input.trigger,
        authority: input.authority,
        reviewAt: input.reviewAt,
      })
      .returning({ id: delegations.id });
    if (!row) throw new Error("Could not save the delegation.");

    const ruleRows = [
      ...tools.map((value, position) => ({ delegationId: row.id, userId, kind: "tool", value, position })),
      ...restrictions.map((value, position) => ({
        delegationId: row.id,
        userId,
        kind: "restriction",
        value,
        position,
      })),
    ];
    if (ruleRows.length > 0) await tx.insert(delegationRules).values(ruleRows);
    await tx.insert(delegationEvents).values({ userId, delegationId: row.id, type: "created" });
    return row.id;
  });

  const [view] = await loadViews(userId, id);
  if (!view) throw new Error("Could not load the saved delegation.");
  return view;
}

const TRANSITIONS: Record<
  DelegationAction,
  { from: DelegationStatus[]; to: DelegationStatus; event: string; problem: string }
> = {
  pause: { from: ["active"], to: "paused", event: "paused", problem: "Only an active delegation can be paused." },
  resume: {
    from: ["paused"],
    to: "active",
    event: "resumed",
    problem: "Only a paused delegation can be resumed. An expired or revoked one needs a new delegation.",
  },
  revoke: {
    from: ["active", "paused"],
    to: "revoked",
    event: "revoked",
    problem: "This delegation is already revoked or expired.",
  },
};

export async function changeDelegationStatus(userId: string, id: string, action: DelegationAction): Promise<void> {
  const { today } = await todayForUser(userId);
  await expireOverdue(userId, today);
  const t = TRANSITIONS[action];

  await db.transaction(async (tx) => {
    const changed = await tx
      .update(delegations)
      .set({
        status: t.to,
        updatedAt: new Date(),
        ...(t.to === "revoked" ? { revokedAt: new Date() } : {}),
      })
      .where(and(eq(delegations.id, id), eq(delegations.userId, userId), inArray(delegations.status, t.from)))
      .returning({ id: delegations.id });

    if (changed.length === 0) {
      const [exists] = await tx
        .select({ id: delegations.id })
        .from(delegations)
        .where(and(eq(delegations.id, id), eq(delegations.userId, userId)));
      if (!exists) throw new AppError(404, "Delegation not found.", "DELEGATION_NOT_FOUND");
      throw new AppError(409, t.problem, "DELEGATION_STATE");
    }
    await tx.insert(delegationEvents).values({ userId, delegationId: id, type: t.event });
  });
}

export async function deleteDelegation(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: delegations.status })
      .from(delegations)
      .where(and(eq(delegations.id, id), eq(delegations.userId, userId)));
    if (!row) throw new AppError(404, "Delegation not found.", "DELEGATION_NOT_FOUND");
    if (row.status === "active" || row.status === "paused") {
      throw new AppError(409, "Revoke this delegation before deleting it.", "DELEGATION_STATE");
    }
    await tx.delete(delegations).where(and(eq(delegations.id, id), eq(delegations.userId, userId)));
    await tx.insert(delegationEvents).values({ userId, delegationId: id, type: "deleted" });
  });
}