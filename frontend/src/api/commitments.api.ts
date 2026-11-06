import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type CommitmentStatus = "open" | "waiting" | "done";
export type Impact = "low" | "normal" | "high";

export interface PriorityFactor {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface LinkedCommitment {
  id: string;
  title: string;
  status: CommitmentStatus;
}

export interface CommitmentItem {
  id: string;
  title: string;
  status: CommitmentStatus;
  waitingOn: string | null;
  dueDate: string | null; // YYYY-MM-DD
  impact: Impact;
  matter: { id: string; title: string } | null;
  createdAt: string;
  completedAt: string | null;
  source: {
    type: string; // chat_message | manual
    conversationId: string | null;
    excerpt: string | null;
    createdAt: string;
  } | null;
  dependsOn: LinkedCommitment[]; // must be finished first
  dependents: LinkedCommitment[]; // waiting on this one
  priority: { score: number; band: "high" | "medium" | "low"; factors: PriorityFactor[] } | null;
}

export interface CommitmentPatch {
  status?: CommitmentStatus;
  impact?: Impact;
  dueDate?: string | null;
}

export const getCommitments = () =>
  apiFetch<{ today: string; commitments: CommitmentItem[] }>("/commitments");

export const addCommitment = (input: {
  title: string;
  dueDate?: string | undefined;
  impact?: Impact | undefined;
  matter?: string | undefined;
}) => apiFetch<{ commitment: { id: string } }>("/commitments", { method: "POST", data: input });

export const updateCommitment = (id: string, patch: CommitmentPatch) =>
  apiFetch<void>(`/commitments/${id}`, { method: "PATCH", data: patch });

export const deleteCommitment = (id: string) => apiFetch<void>(`/commitments/${id}`, { method: "DELETE" });

export const commitmentsQueryOptions = queryOptions({
  queryKey: ["commitments"],
  queryFn: getCommitments,
  retry: 1,
});

// "Fri, 6 Nov" from "2026-11-06".
export function formatDue(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}