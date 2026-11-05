import type { Request, Response } from "express";
import { z } from "zod";
import { findUnansweredThreads, getThread, searchByPerson, searchThreads } from "../utility/gmail";

const searchQuery = z.object({
  q: z.string().trim().max(500).default(""),
  maxResults: z.coerce.number().int().min(1).max(50).default(15),
  pageToken: z.string().max(500).optional(),
});

const threadParams = z.object({
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Invalid thread id"),
});

const personQuery = z.object({
  person: z.string().trim().min(2).max(200),
});

const unansweredQuery = z.object({
  sinceDays: z.coerce.number().int().min(1).max(60).default(14),
  waitingDays: z.coerce.number().int().min(1).max(30).default(3),
});

export async function listThreads(req: Request, res: Response) {
  const q = searchQuery.parse(req.query);
  res.json(await searchThreads(req.user!.id, { query: q.q, maxResults: q.maxResults, pageToken: q.pageToken }));
}

export async function threadById(req: Request, res: Response) {
  const { threadId } = threadParams.parse(req.params);
  res.json(await getThread(req.user!.id, threadId));
}

export async function threadsByPerson(req: Request, res: Response) {
  const { person } = personQuery.parse(req.query);
  res.json(await searchByPerson(req.user!.id, person));
}

export async function unanswered(req: Request, res: Response) {
  const q = unansweredQuery.parse(req.query);
  res.json(await findUnansweredThreads(req.user!.id, q));
}