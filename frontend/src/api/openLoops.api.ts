import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type LoopKind = "needs_reply" | "waiting_on";
export type LoopState = "active" | "snoozed" | "resolved" | "dismissed";

export interface OpenLoopItem {
  id: string;
  kind: LoopKind;
  subject: string;
  counterpart: string | null;
  sourceUrl: string;
  triggerAt: string;
  daysSince: number;
  state: LoopState;
  snoozedUntil: string | null; // YYYY-MM-DD
  resolvedAt: string | null;
  resolvedReason: string | null;
  resolvedBy: string | null; // gmail | user
}

export interface OpenLoopsData {
  today: string;
  lastScanAt: string | null;
  loops: OpenLoopItem[];
}

export interface ScanSummary {
  checked: number;
  resolved: number;
  created: number;
  skippedAtLimit: boolean;
  found: { needsReply: number; waitingOn: number };
  scanned: { inboxThreads: number; sentThreads: number };
}

export type LoopAction =
  | { action: "resolve" }
  | { action: "dismiss" }
  | { action: "reopen" }
  | { action: "snooze"; until: string };

export const getOpenLoops = () => apiFetch<OpenLoopsData>("/open-loops");

export const scanOpenLoops = () => apiFetch<ScanSummary>("/open-loops/scan", { method: "POST", data: {} });

export const updateOpenLoop = (id: string, change: LoopAction) =>
  apiFetch<void>(`/open-loops/${id}`, { method: "PATCH", data: change });

export const openLoopsQueryOptions = queryOptions({
  queryKey: ["open-loops"],
  queryFn: getOpenLoops,
  retry: 1,
});