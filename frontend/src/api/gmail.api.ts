import { apiFetch } from "./client";

type Params = Record<string, string>;

export const debugSearchThreads = (params: Params) => apiFetch<unknown>("/gmail/threads", { params });
export const debugGetThread = (threadId: string) =>
  apiFetch<unknown>(`/gmail/threads/${encodeURIComponent(threadId)}`);
export const debugByPerson = (params: Params) => apiFetch<unknown>("/gmail/by-person", { params });
export const debugUnanswered = (params: Params) => apiFetch<unknown>("/gmail/unanswered", { params });