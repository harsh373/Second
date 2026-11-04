import { apiFetch } from "./client";

export type ReadinessResponse = {
  status: "ok" | "degraded";
  checks: { database: "up" | "down" };
  timestamp: string;
};

export const getReadiness = () => apiFetch<ReadinessResponse>("/health/ready");