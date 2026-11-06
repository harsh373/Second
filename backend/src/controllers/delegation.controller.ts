import type { Request, Response } from "express";
import { z } from "zod";
import {
  DELEGATION_AUTHORITIES,
  DELEGATION_TOOLS,
  DELEGATION_TRIGGERS,
  MAX_REVIEW_DAYS,
  NARROW_BLOCKED_TOOLS,
  NARROW_MAX_REVIEW_DAYS,
  RESPONSIBILITY_MAX,
  RESTRICTIONS_MAX_COUNT,
  RESTRICTION_MAX,
  SCOPE_MAX,
  changeDelegationStatus,
  createDelegation,
  deleteDelegation,
  listDelegationViews,
} from "../model/delegation.model";
import { AppError } from "../utility/AppError";

const createSchema = z.object({
  responsibility: z.string(),
  scope: z.string(),
  trigger: z.enum(DELEGATION_TRIGGERS),
  authority: z.enum(DELEGATION_AUTHORITIES),
  tools: z.array(z.enum(DELEGATION_TOOLS)).max(DELEGATION_TOOLS.length),
  restrictions: z.array(z.string()).max(RESTRICTIONS_MAX_COUNT),
  reviewAt: z.string(),
});

const actionSchema = z.object({ action: z.enum(["pause", "resume", "revoke"]) });

function idOf(req: Request): string {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new AppError(404, "Delegation not found.", "DELEGATION_NOT_FOUND");
  return parsed.data;
}

export async function list(req: Request, res: Response) {
  const data = await listDelegationViews(req.user!.id);
  res.json({
    today: data.today,
    delegations: data.delegations,
    options: {
      tools: DELEGATION_TOOLS,
      triggers: DELEGATION_TRIGGERS,
      authorities: DELEGATION_AUTHORITIES,
      narrowBlockedTools: NARROW_BLOCKED_TOOLS,
      maxReviewDays: MAX_REVIEW_DAYS,
      narrowMaxReviewDays: NARROW_MAX_REVIEW_DAYS,
      responsibilityMax: RESPONSIBILITY_MAX,
      scopeMax: SCOPE_MAX,
      restrictionMax: RESTRICTION_MAX,
      restrictionsMaxCount: RESTRICTIONS_MAX_COUNT,
    },
  });
}

export async function create(req: Request, res: Response) {
  const body = createSchema.parse(req.body);
  const delegation = await createDelegation(req.user!.id, { ...body, tools: [...body.tools] });
  res.status(201).json({ delegation });
}

export async function change(req: Request, res: Response) {
  const { action } = actionSchema.parse(req.body);
  await changeDelegationStatus(req.user!.id, idOf(req), action);
  res.json({ ok: true });
}

export async function remove(req: Request, res: Response) {
  await deleteDelegation(req.user!.id, idOf(req));
  res.json({ ok: true });
}