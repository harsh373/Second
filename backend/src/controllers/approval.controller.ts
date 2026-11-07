import type { Request, Response } from "express";
import { z } from "zod";
import { approveApproval, listApprovalViews, proposeSend, rejectApproval } from "../model/approval.model";
import { AppError } from "../utility/AppError";

function idOf(req: Request): string {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new AppError(404, "Proposal not found.", "APPROVAL_NOT_FOUND");
  return parsed.data;
}

export async function list(req: Request, res: Response) {
  res.json({ approvals: await listApprovalViews(req.user!.id) });
}

export async function approve(req: Request, res: Response) {
  res.json({ approval: await approveApproval(req.user!.id, idOf(req)) });
}

export async function reject(req: Request, res: Response) {
  await rejectApproval(req.user!.id, idOf(req));
  res.json({ ok: true });
}

// Creates a send PROPOSAL for an executed draft. Nothing is sent until that proposal is approved separately.
export async function send(req: Request, res: Response) {
  res.status(201).json(await proposeSend(req.user!.id, idOf(req)));
}