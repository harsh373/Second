import { eq } from "drizzle-orm";
import { db } from "../utility/db";
import { agentEvents, agentRuns, toolExecutions } from "../../../database/schema/index";

export async function createRun(input: { userId: string; conversationId: string; model: string }): Promise<string> {
  const [row] = await db
    .insert(agentRuns)
    .values({ userId: input.userId, conversationId: input.conversationId, model: input.model })
    .returning({ id: agentRuns.id });
  if (!row) throw new Error("Failed to create agent run");
  return row.id;
}

export async function finishRun(
  runId: string,
  input: { status: "completed" | "failed" | "aborted"; toolCallCount: number; error?: string | undefined },
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status: input.status,
      toolCallCount: input.toolCallCount,
      error: input.error?.slice(0, 500) ?? null,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId));
}

export async function addEvent(
  runId: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(agentEvents).values({ runId, seq, type, payload });
}

export async function recordToolExecution(input: {
  runId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  status: "succeeded" | "failed";
  outputSummary: string;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  sourceUrls: string[];
  durationMs: number;
}): Promise<void> {
  await db.insert(toolExecutions).values({
    runId: input.runId,
    userId: input.userId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    input: input.input,
    status: input.status,
    outputSummary: input.outputSummary,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage?.slice(0, 500) ?? null,
    sourceUrls: input.sourceUrls,
    durationMs: input.durationMs,
  });
}