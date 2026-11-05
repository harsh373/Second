import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface GoogleIntegration {
  provider: "google";
  status: "active" | "needs_reconnect";
  accountEmail: string;
  connectedAt: string;
  permissions: { gmail: boolean; calendar: boolean };
}

export const getIntegrations = () => apiFetch<{ integrations: GoogleIntegration[] }>("/integrations");

export const startGoogleConnect = () =>
  apiFetch<{ url: string }>("/integrations/google/connect", { method: "POST" });

export const completeGoogleConnect = (input: { code: string; state: string }) =>
  apiFetch<GoogleIntegration>("/integrations/google/callback", { method: "POST", data: input });

export const verifyGoogle = () =>
  apiFetch<{ ok: true; accountEmail: string }>("/integrations/google/verify", { method: "POST" });

export const disconnectGoogle = () => apiFetch<void>("/integrations/google", { method: "DELETE" });

export const integrationsQueryOptions = queryOptions({
  queryKey: ["integrations"],
  queryFn: getIntegrations,
  retry: 1,
});