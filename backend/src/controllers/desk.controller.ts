import type { Request, Response } from "express";
import { loadDesk } from "../model/desk.model";

export async function get(req: Request, res: Response) {
  res.json(await loadDesk(req.user!.id));
}