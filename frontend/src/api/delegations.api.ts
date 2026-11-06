import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type DelegationStatus = "active" | "paused" | "revoked" | "expired";
export type DelegationTrigger = "when_asked" | "new_email" | "before_meeting" | "schedule";
export type DelegationAuthority = "observe" | "suggest" | "execute_with_approval" | "narrow_delegation";
export type DelegationAction = "pause" | "resume" | "revoke";

export interface DelegationView {
  id: string;
  responsibility: string;
  scope: string;
  trigger: DelegationTrigger;
  authority: DelegationAuthority;
  status: DelegationStatus;
  reviewAt: string;
  createdAt: string;
  revokedAt: string | null;
  tools: string[];
  restrictions: string[];
  events: { type: string; at: string }[];
}

export interface DelegationOptions {
  tools: string[];
  triggers: DelegationTrigger[];
  authorities: DelegationAuthority[];
  narrowBlockedTools: string[];
  maxReviewDays: number;
  narrowMaxReviewDays: number;
  responsibilityMax: number;
  scopeMax: number;
  restrictionMax: number;
  restrictionsMaxCount: number;
}

export interface DelegationsResponse {
  today: string;
  delegations: DelegationView[];
  options: DelegationOptions;
}

export interface NewDelegation {
  responsibility: string;
  scope: string;
  trigger: DelegationTrigger;
  authority: DelegationAuthority;
  tools: string[];
  restrictions: string[];
  reviewAt: string;
}

export const delegationsQueryOptions = queryOptions({
  queryKey: ["delegations"],
  queryFn: () => apiFetch<DelegationsResponse>("/delegations"),
});

export function createDelegation(input: NewDelegation) {
  return apiFetch<{ delegation: DelegationView }>("/delegations", { method: "POST", data: input });
}

export function changeDelegation(id: string, action: DelegationAction) {
  return apiFetch<{ ok: true }>(`/delegations/${id}`, { method: "PATCH", data: { action } });
}

export function deleteDelegation(id: string) {
  return apiFetch<{ ok: true }>(`/delegations/${id}`, { method: "DELETE" });
}