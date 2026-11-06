import type { Request, Response } from "express";
import { z } from "zod";
import {
  COMMITMENT_LIMIT,
  COMMITMENT_STATUSES,
  COMMITMENT_TITLE_MAX,
  IMPACTS,
  MATTER_MAX_CHARS,
  checkCommitmentTitle,
  checkMatterTitle,
  countCommitments,
  createCommitment,
  deleteCommitment,
  isValidDate,
  loadCommitmentViews,
  todayForUser,
  updateCommitment,
  type CommitmentView,
} from "../model/commitment.model";
import { AppError } from "../utility/AppError";

const idParams = z.object({ id: z.string().uuid() });
const dateField = z.string().refine(isValidDate, "Use a valid date (YYYY-MM-DD).");

const createBody = z.object({
  title: z.string().trim().min(1).max(COMMITMENT_TITLE_MAX),
  dueDate: dateField.nullish(),
  impact: z.enum(IMPACTS).optional(),
  matter: z.string().trim().max(MATTER_MAX_CHARS).nullish(),
});

const patchBody = z
  .object({
    status: z.enum(COMMITMENT_STATUSES).optional(),
    impact: z.enum(IMPACTS).optional(),
    dueDate: dateField.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update.");

const toDto = (v: CommitmentView) => ({
  id: v.id,
  title: v.title,
  status: v.status,
  waitingOn: v.waitingOn,
  dueDate: v.dueDate,
  impact: v.impact,
  matter: v.matter,
  createdAt: v.createdAt.toISOString(),
  completedAt: v.completedAt?.toISOString() ?? null,
  source: v.source
    ? {
        type: v.source.type,
        conversationId: v.source.conversationId,
        excerpt: v.source.excerpt,
        createdAt: v.source.createdAt.toISOString(),
      }
    : null,
  dependsOn: v.dependsOn,
  dependents: v.dependents,
  priority: v.priority,
});

export async function list(req: Request, res: Response) {
  const userId = req.user!.id;
  const { today } = await todayForUser(userId);
  const views = await loadCommitmentViews(userId, today);
  res.json({ today, commitments: views.map(toDto) });
}

// The user adds a commitment by hand. The same safety rules apply as for automatic ones.
export async function create(req: Request, res: Response) {
  const userId = req.user!.id;
  const body = createBody.parse(req.body ?? {});

  const title = body.title.replace(/\s+/g, " ").trim();
  const problem = checkCommitmentTitle(title);
  if (problem) throw new AppError(400, problem, "INVALID_COMMITMENT");

  const matterTitle = body.matter ? body.matter.replace(/\s+/g, " ").trim() : null;
  if (matterTitle) {
    const matterProblem = checkMatterTitle(matterTitle);
    if (matterProblem) throw new AppError(400, matterProblem, "INVALID_MATTER");
  }

  if ((await countCommitments(userId)) >= COMMITMENT_LIMIT) {
    throw new AppError(409, `You can track up to ${COMMITMENT_LIMIT} commitments. Delete some first.`, "COMMITMENT_LIMIT");
  }

  const row = await createCommitment(
    userId,
    { title, dueDate: body.dueDate ?? null, impact: body.impact, matterTitle },
    { type: "manual" },
    "user",
  );
  if (!row) throw new AppError(409, "You are already tracking this.", "COMMITMENT_EXISTS");
  res.status(201).json({ commitment: { id: row.id } });
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const patch = patchBody.parse(req.body ?? {});
  const ok = await updateCommitment(req.user!.id, id, patch, "user");
  if (!ok) throw new AppError(404, "Commitment not found.", "COMMITMENT_NOT_FOUND");
  res.status(204).end();
}

export async function remove(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const ok = await deleteCommitment(req.user!.id, id, "user");
  if (!ok) throw new AppError(404, "Commitment not found.", "COMMITMENT_NOT_FOUND");
  res.status(204).end();
}