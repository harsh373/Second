import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface DeskApproval {
  id: string;
  kind: "send" | "draft" | "commitment";
  title: string;
  detail: string | null;
  expiresAt: string;
  blocked: boolean;
}

export interface DeskCommitment {
  id: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  overdue: boolean;
  status: string;
  waitingOn: string | null;
  band: string | null;
}

export interface DeskLoop {
  id: string;
  subject: string;
  counterpart: string | null;
  daysSince: number;
  sourceUrl: string;
}

export interface DeskDelegation {
  id: string;
  responsibility: string;
  status: string;
  reviewAt: string;
  daysLeft: number;
}

export interface DeskData {
  today: string;
  approvals: { total: number; items: DeskApproval[] };
  commitments: { total: number; items: DeskCommitment[] };
  loops: {
    lastScanAt: string | null;
    needsReplyTotal: number;
    waitingOnTotal: number;
    snoozedHidden: number;
    needsReply: DeskLoop[];
    waitingOn: DeskLoop[];
  };
  delegations: { total: number; items: DeskDelegation[] };
  briefing: { id: string; kind: string; title: string; generatedAt: string } | null;
}

export const deskQueryOptions = queryOptions({
  queryKey: ["desk"],
  queryFn: () => apiFetch<DeskData>("/desk"),
  retry: 1,
});