import type { Request, Response } from "express";
import { z } from "zod";
import {
  MEMORY_CATEGORIES,
  MEMORY_LIMIT,
  MEMORY_MAX_CHARS,
  checkMemoryContent,
  countMemories,
  createMemory,
  deleteMemory,
  listMemoriesWithSource,
} from "../model/memory.model";
import { AppError } from "../utility/AppError";

const idParams = z.object({ id: z.string().uuid() });
const createBody = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  content: z.string().trim().min(1).max(MEMORY_MAX_CHARS),
});

export async function list(req: Request, res: Response) {
  const rows = await listMemoriesWithSource(req.user!.id);
  res.json({
    memories: rows.map((m) => ({
      id: m.id,
      category: m.category,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      source: m.source
        ? {
            type: m.source.type,
            conversationId: m.source.conversationId,
            excerpt: m.source.excerpt,
            createdAt: m.source.createdAt?.toISOString() ?? null,
          }
        : null,
    })),
  });
}

// The user adds a memory by hand. The same safety rules apply as for automatic ones.
export async function create(req: Request, res: Response) {
  const userId = req.user!.id;
  const body = createBody.parse(req.body ?? {});
  const content = body.content.replace(/\s+/g, " ").trim();

  const problem = checkMemoryContent(content);
  if (problem) throw new AppError(400, problem, "INVALID_MEMORY");

  if ((await countMemories(userId)) >= MEMORY_LIMIT) {
    throw new AppError(409, `You can keep up to ${MEMORY_LIMIT} memories. Delete some first.`, "MEMORY_LIMIT");
  }

  const row = await createMemory(userId, { category: body.category, content }, { type: "manual" }, "user");
  if (!row) throw new AppError(409, "Second already remembers this.", "MEMORY_EXISTS");
  res.status(201).json({ memory: row });
}

export async function remove(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const deleted = await deleteMemory(req.user!.id, id, "user");
  if (!deleted) throw new AppError(404, "Memory not found.", "MEMORY_NOT_FOUND");
  res.status(204).end();
}