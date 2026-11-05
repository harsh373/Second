import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ChatMessage[];
}

// One tool call as shown in the timeline.
export interface ToolCallView {
  callId: string;
  name: string;
  label: string;
  status: "running" | "done" | "error";
  summary?: string;
  links: string[];
}

// A memory Second saved (or updated) after a reply.
export interface SavedMemoryNote {
  id: string;
  category: string;
  content: string;
  action: "created" | "updated";
}

export const getConversations = () => apiFetch<{ conversations: ConversationSummary[] }>("/conversations");

export const createConversation = () =>
  apiFetch<{ conversation: ConversationSummary }>("/conversations", { method: "POST", data: {} });

export const getConversation = (id: string) => apiFetch<ConversationDetail>(`/conversations/${id}`);

export const deleteConversation = (id: string) => apiFetch<void>(`/conversations/${id}`, { method: "DELETE" });

export const conversationsQueryOptions = queryOptions({
  queryKey: ["conversations"],
  queryFn: getConversations,
  retry: 1,
});

export const conversationKey = (id: string) => ["conversation", id] as const;

// staleTime and no refocus refetch: the page writes into this cache while a reply streams,
// and a background refetch in the middle would overwrite those local updates.
export const conversationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: conversationKey(id),
    queryFn: () => getConversation(id),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

type StreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; callId: string; name: string; label: string }
  | { type: "tool_result"; callId: string; name: string; ok: boolean; summary: string; links: string[] }
  | { type: "memory"; memories: SavedMemoryNote[] }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };

// Sends a message (or, with no content, retries the unanswered one) and streams the reply.
// onDone fires as soon as the reply is complete. The stream may stay open a little longer
// for a "memory" event, which is optional: problems after onDone are ignored.
export async function streamReply(args: {
  conversationId: string;
  content?: string | undefined;
  token: string;
  signal: AbortSignal;
  onToken: (text: string) => void;
  onToolStart: (e: { callId: string; name: string; label: string }) => void;
  onToolResult: (e: { callId: string; ok: boolean; summary: string; links: string[] }) => void;
  onDone: (message: ChatMessage) => void;
  onMemory: (notes: SavedMemoryNote[]) => void;
}): Promise<void> {
  const res = await fetch(`/api/conversations/${args.conversationId}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify(args.content === undefined ? {} : { content: args.content }),
    signal: args.signal,
  });

  if (!res.ok) {
    let message = "Something went wrong.";
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code;
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, message, code);
  }
  if (!res.body) throw new ApiError(502, "The server did not stream a response.", "NO_STREAM");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let gotDone = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (line) {
          const event = JSON.parse(line.slice(6)) as StreamEvent;
          if (event.type === "token") args.onToken(event.text);
          else if (event.type === "tool_start") args.onToolStart(event);
          else if (event.type === "tool_result") args.onToolResult(event);
          else if (event.type === "memory") args.onMemory(event.memories);
          else if (event.type === "done") {
            gotDone = true;
            args.onDone(event.message);
          } else if (event.type === "error") {
            if (gotDone) return;
            throw new ApiError(502, event.message, "STREAM_ERROR");
          }
          // any other event type is ignored on purpose, so the server can add new ones safely
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if (gotDone) return; // the reply is complete; only the optional memory note was lost
    throw err;
  }

  if (!gotDone) throw new ApiError(502, "The connection closed before the reply finished.", "STREAM_INTERRUPTED");
}