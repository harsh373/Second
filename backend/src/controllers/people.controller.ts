import type { Request, Response } from "express";
import { z } from "zod";
import { checkLabel, cleanLabel, deletePerson, loadPeopleViews, setLabel } from "../model/people.model";
import { AppError } from "../utility/AppError";
import { runPeopleScan } from "../utility/peopleScan";

const THREADS_SHOWN_IN_LIST = 5;

const idParams = z.object({ id: z.string().uuid() });
const labelBody = z.object({ label: z.string().max(200).nullable() });

export async function list(req: Request, res: Response) {
  const people = await loadPeopleViews(req.user!.id, { interactionsShown: THREADS_SHOWN_IN_LIST });
  res.json({ people });
}

// Live Gmail read (headers only). Has no cooldown yet, so every press costs real Gmail calls.
export async function refresh(req: Request, res: Response) {
  res.json(await runPeopleScan(req.user!.id));
}

export async function updateLabel(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = labelBody.parse(req.body ?? {});
  const cleaned = body.label === null ? "" : cleanLabel(body.label);
  if (cleaned) {
    const problem = checkLabel(cleaned);
    if (problem) throw new AppError(400, problem, "INVALID_RELATIONSHIP");
  }
  const result = await setLabel(req.user!.id, id, cleaned || null, { type: "manual" });
  if (!result) throw new AppError(404, "Person not found.", "PERSON_NOT_FOUND");
  res.json({ previousLabel: result.previousLabel });
}

export async function remove(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const deleted = await deletePerson(req.user!.id, id);
  if (!deleted) throw new AppError(404, "Person not found.", "PERSON_NOT_FOUND");
  res.status(204).end();
}