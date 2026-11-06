import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface PersonThread {
  threadId: string;
  subject: string;
  lastMessageAt: string;
  direction: "from" | "to"; // from = they wrote last, to = you wrote last
  messageCount: number;
  sourceUrl: string;
  openLoop: "needs_reply" | "waiting_on" | null;
}

export interface Person {
  id: string;
  name: string | null;
  email: string | null;
  relationship: { label: string; source: "chat" | "manual"; excerpt: string | null } | null;
  interactionCount: number; // saved threads, at most 20
  lastContactAt: string | null;
  lastDirection: "from" | "to" | null;
  openLoopCount: number;
  interactions: PersonThread[];
}

export interface RefreshSummary {
  threadsScanned: number;
  capped: boolean;
  sinceDays: number;
  peopleSeen: number;
  added: number;
  updated: number;
  skippedRemoved: number;
  skippedLimit: number;
}

export const getPeople = () => apiFetch<{ people: Person[] }>("/people");

// Live Gmail read: can take several seconds, so the timeout is generous.
export const refreshPeople = () =>
  apiFetch<RefreshSummary>("/people/refresh", { method: "POST", data: {}, timeout: 120_000 });

// label null clears the relationship. Returns the label it had before.
export const setPersonLabel = (id: string, label: string | null) =>
  apiFetch<{ previousLabel: string | null }>(`/people/${id}/label`, { method: "PUT", data: { label } });

export const deletePerson = (id: string) => apiFetch<void>(`/people/${id}`, { method: "DELETE" });

export const peopleQueryOptions = queryOptions({
  queryKey: ["people"],
  queryFn: getPeople,
  retry: 1,
});