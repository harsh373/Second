import type { Request, Response } from "express";
import { z } from "zod";
import { addEvent, createRun, finishRun, recordToolExecution } from "../model/agent.model";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getChatPreferences,
  getConversation,
  getRecentMessages,
  setConversationTitle,
  listConversations,
  type Message,
} from "../model/conversation.model";
import { runAgent, type ChatTurn } from "../orchestration/chatGraph";
import { extractMemories, retrieveMemories } from "../orchestration/memory";
import { MODEL_NAME } from "../orchestration/providers/llm";
import { AppError } from "../utility/AppError";
import { logger } from "../utility/logger";

const HISTORY_FOR_MODEL = 40; // older messages are dropped for now (no summarisation yet)
const HISTORY_FOR_DISPLAY = 200;
const TITLE_MAX = 60;

const idParams = z.object({ id: z.string().uuid() });
const replyBody = z.object({ content: z.string().trim().min(1).max(8000).optional() });

const messageDto = (m: Message) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  createdAt: m.createdAt.toISOString(),
});

const summaryDto = (c: { id: string; title: string; updatedAt: Date }) => ({
  id: c.id,
  title: c.title,
  updatedAt: c.updatedAt.toISOString(),
});

function makeTitle(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…` : flat;
}

async function requireOwned(userId: string, rawId: unknown) {
  const { id } = idParams.parse({ id: rawId });
  const conversation = await getConversation(userId, id);
  if (!conversation) throw new AppError(404, "Conversation not found.", "CONVERSATION_NOT_FOUND");
  return conversation;
}

function describeLlmError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403 || status === 404) {
    return "Second's AI provider is not configured correctly. Check the server logs.";
  }
  if (status === 429) return "The AI provider is rate limiting requests. Try again in a moment.";
  if (status === 400) return "The AI model produced an invalid request while using a tool. Try again or rephrase.";
  return "The AI provider failed to respond. Try again.";
}

// Audit writes must never break the chat: log the failure and carry on.
async function audit<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    logger.error("Agent audit write failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listAll(req: Request, res: Response) {
  const rows = await listConversations(req.user!.id);
  res.json({ conversations: rows.map(summaryDto) });
}

export async function create(req: Request, res: Response) {
  const row = await createConversation(req.user!.id);
  res.status(201).json({ conversation: summaryDto(row) });
}

export async function getOne(req: Request, res: Response) {
  const conversation = await requireOwned(req.user!.id, req.params.id);
  const rows = await getRecentMessages(conversation.id, HISTORY_FOR_DISPLAY);
  res.json({ conversation: summaryDto(conversation), messages: rows.map(messageDto) });
}

export async function remove(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const deleted = await deleteConversation(req.user!.id, id);
  if (!deleted) throw new AppError(404, "Conversation not found.", "CONVERSATION_NOT_FOUND");
  res.status(204).end();
}

export async function reply(req: Request, res: Response) {
  const user = req.user!;
  const conversation = await requireOwned(user.id, req.params.id);
  const { content } = replyBody.parse(req.body ?? {});

  let userMessage: Message;
  if (content === undefined) {
    // Retry: only valid when the last message is the user's and has no answer.
    const [last] = await getRecentMessages(conversation.id, 1);
    if (!last || last.role !== "user") {
      throw new AppError(409, "There is no unanswered message to retry.", "NOTHING_TO_RETRY");
    }
    userMessage = last;
  } else {
    userMessage = await addMessage(conversation.id, "user", content);
  }

  const history = await getRecentMessages(conversation.id, HISTORY_FOR_MODEL);
  if (content !== undefined && history.length === 1) {
    await setConversationTitle(conversation.id, makeTitle(content));
  }

  const prefs = await getChatPreferences(user.id);
  // Memory problems must never block a reply: on failure the agent simply runs without notes.
  const memories = await retrieveMemories(user.id, userMessage.content).catch((err) => {
    logger.error("Memory retrieval failed:", err instanceof Error ? err.message : err);
    return [];
  });
  const profile = {
    fullName: user.fullName,
    timezone: prefs?.timezone ?? "UTC",
    userType: prefs?.userType ?? null,
    communicationStyle: prefs?.communicationStyle ?? "concise",
    memories,
  };
  const turns = history.map(
    (m): ChatTurn => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }),
  );

  // From here on the response is a stream, so errors are sent as events, not as JSON.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort(); // the browser went away or the user pressed Stop
  });

  const send = (event: unknown) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const runId = await audit(() => createRun({ userId: user.id, conversationId: conversation.id, model: MODEL_NAME }));
  let seq = 0;
  let toolCalls = 0;
  let status: "completed" | "failed" | "aborted" = "aborted";
  let failure: string | undefined;

  const record = async (type: string, payload: Record<string, unknown>) => {
    if (!runId) return;
    seq += 1;
    const n = seq;
    await audit(() => addEvent(runId, n, type, payload));
  };

  try {
    const full = await runAgent({
      userId: user.id, // always from the signed-in session, never from the model
      profile,
      history: turns,
      signal: abort.signal,
      handlers: {
        onToken: (text) => send({ type: "token", text }),
        onToolStart: async (e) => {
          send({ type: "tool_start", callId: e.callId, name: e.name, label: e.label });
          await record("tool_start", { callId: e.callId, name: e.name, label: e.label });
        },
        onToolFinish: async (e) => {
          toolCalls += 1;
          send({
            type: "tool_result",
            callId: e.callId,
            name: e.name,
            ok: e.ok,
            summary: e.summary,
            links: e.links,
          });
          await record("tool_result", {
            callId: e.callId,
            name: e.name,
            ok: e.ok,
            summary: e.summary,
            durationMs: e.durationMs,
            errorCode: e.errorCode,
          });
          if (runId) {
            await audit(() =>
              recordToolExecution({
                runId,
                userId: user.id,
                toolCallId: e.callId,
                toolName: e.name,
                input: e.input,
                status: e.ok ? "succeeded" : "failed",
                outputSummary: e.summary,
                errorCode: e.errorCode,
                errorMessage: e.errorMessage,
                sourceUrls: e.links,
                durationMs: e.durationMs,
              }),
            );
          }
        },
      },
    });
    if (abort.signal.aborted) return;
    if (!full.trim()) throw new Error("The model returned an empty reply.");

    const saved = await addMessage(conversation.id, "assistant", full);
    status = "completed";
    send({ type: "done", message: messageDto(saved) });

    // The reply is already delivered. Memory extraction is best effort and never throws.
    // It is not tied to the abort signal, so it still finishes if the user navigates away.
    const notes = await extractMemories({
      userId: user.id,
      conversationId: conversation.id,
      messageId: userMessage.id,
      message: userMessage.content,
    });
    if (notes.length > 0) send({ type: "memory", memories: notes });
  } catch (err) {
    if (!abort.signal.aborted) {
      status = "failed";
      failure = err instanceof Error ? err.message : "Unknown error";
      logger.error("Chat reply failed:", failure);
      send({ type: "error", message: describeLlmError(err) });
      await record("error", { message: failure.slice(0, 300) });
    }
  } finally {
    res.end();
    if (runId) await audit(() => finishRun(runId, { status, toolCallCount: toolCalls, error: failure }));
  }
}