import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const CATEGORY_ORDER = [
  "identity",
  "preferences",
  "goals",
  "relationships",
  "responsibilities",
  "history",
] as const;

export type MemoryCategory = (typeof CATEGORY_ORDER)[number];

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: "Identity",
  preferences: "Preferences",
  goals: "Goals",
  relationships: "Relationships",
  responsibilities: "Responsibilities",
  history: "Relevant history",
};

export interface MemoryItem {
  id: string;
  category: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  source: {
    type: string; // chat_message | manual
    conversationId: string | null;
    excerpt: string | null;
    createdAt: string | null;
  } | null;
}

export const getMemories = () => apiFetch<{ memories: MemoryItem[] }>("/memories");

export const addMemory = (input: { category: MemoryCategory; content: string }) =>
  apiFetch<{ memory: { id: string } }>("/memories", { method: "POST", data: input });

export const deleteMemory = (id: string) => apiFetch<void>(`/memories/${id}`, { method: "DELETE" });

export const memoriesQueryOptions = queryOptions({
  queryKey: ["memories"],
  queryFn: getMemories,
  retry: 1,
});