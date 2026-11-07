import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type ApprovalStatus = "pending" | "executing" | "executed" | "failed" | "rejected" | "expired";

export interface ApprovalView {
  id: string;
  actionType: string;
  commitment: { title: string; dueDate: string | null; impact: string } | null;
  draft: { to: string; subject: string; body: string } | null;
  send: { to: string; subject: string; body: string; draftApprovalId: string } | null;
  sendOfDraft: { approvalId: string; status: ApprovalStatus } | null;
  sourceUrl: string | null;
  reason: string | null;
  status: ApprovalStatus;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  delegation: { responsibility: string; scope: string; authority: string; restrictions: string[] } | null;
  events: { type: string; at: string }[];
}

export const approvalsQueryOptions = queryOptions({
  queryKey: ["approvals"],
  queryFn: () => apiFetch<{ approvals: ApprovalView[] }>("/approvals"),
});

export function approveApproval(id: string) {
  return apiFetch<{ approval: ApprovalView }>(`/approvals/${id}/approve`, { method: "POST" });
}

export function rejectApproval(id: string) {
  return apiFetch<{ ok: true }>(`/approvals/${id}/reject`, { method: "POST" });
}

// Creates a send PROPOSAL for an executed draft. Nothing is sent until that proposal is approved separately.
export function proposeSend(draftApprovalId: string) {
  return apiFetch<{ approvalId: string; duplicate: boolean; status: string }>(`/approvals/${draftApprovalId}/send`, {
    method: "POST",
  });
}