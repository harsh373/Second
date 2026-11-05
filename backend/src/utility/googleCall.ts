import { listIntegrationsWithScopes, markIntegrationStatus } from "../model/integration.model";
import { AppError } from "./AppError";
import { SCOPE_CALENDAR, SCOPE_GMAIL, getAuthorizedClient } from "./google";
import { logger } from "./logger";

export type AuthorizedGoogle = Awaited<ReturnType<typeof getAuthorizedClient>>;

const REQUIRED = {
  gmail: { scope: SCOPE_GMAIL, label: "Gmail" },
  calendar: { scope: SCOPE_CALENDAR, label: "Calendar" },
} as const;

interface GoogleErrorShape {
  code?: unknown;
  status?: unknown;
  message?: string;
  errors?: { reason?: string }[];
  response?: {
    status?: number;
    data?: { error?: string | { message?: string; errors?: { reason?: string }[] } };
  };
}

// Google errors carry the HTTP status in different places depending on the library version.
export function googleStatus(err: unknown): number | undefined {
  const e = err as GoogleErrorShape;
  for (const candidate of [e?.response?.status, e?.status, e?.code]) {
    const n = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate) : NaN;
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  return undefined;
}

function googleReasons(err: unknown): string[] {
  const e = err as GoogleErrorShape;
  const data = e?.response?.data?.error;
  const nested = typeof data === "object" && data ? data.errors : undefined;
  return [...(e?.errors ?? []), ...(nested ?? [])].map((x) => x.reason ?? "").filter(Boolean);
}

function googleMessage(err: unknown): string {
  const e = err as GoogleErrorShape;
  const data = e?.response?.data?.error;
  if (typeof data === "object" && data?.message) return data.message;
  return e?.message ?? "unknown error";
}

function isInvalidGrant(err: unknown): boolean {
  const e = err as GoogleErrorShape;
  return e?.response?.data?.error === "invalid_grant" || (e?.message ?? "").includes("invalid_grant");
}

async function mapGoogleError(err: unknown, integrationId: string): Promise<AppError> {
  if (err instanceof AppError) return err;

  const status = googleStatus(err);
  const reasons = googleReasons(err);

  if (isInvalidGrant(err) || status === 401) {
    await markIntegrationStatus(integrationId, "needs_reconnect");
    return new AppError(409, "Google access was revoked or expired. Please reconnect.", "GOOGLE_RECONNECT_REQUIRED");
  }
  if (status === 429 || reasons.some((r) => /ratelimit|quota/i.test(r))) {
    return new AppError(429, "Google is rate limiting requests. Try again in a moment.", "GOOGLE_RATE_LIMITED");
  }
  if (status === 403) {
    return new AppError(
      403,
      "Google refused access. A permission was probably not granted. Reconnect Google and allow it.",
      "GOOGLE_SCOPE_MISSING",
    );
  }
  if (status === 404) return new AppError(404, "Google could not find that item.", "GOOGLE_NOT_FOUND");
  if (status === 400) {
    return new AppError(400, `Google rejected the request: ${googleMessage(err)}`, "GOOGLE_BAD_REQUEST");
  }

  logger.error("Google call failed:", googleMessage(err));
  return new AppError(502, "Could not reach Google. Try again in a moment.", "GOOGLE_UNAVAILABLE");
}

// Every Gmail/Calendar read goes through here.
export async function callGoogle<T>(
  userId: string,
  resource: "gmail" | "calendar",
  fn: (auth: AuthorizedGoogle) => Promise<T>,
): Promise<T> {
  const connections = await listIntegrationsWithScopes(userId);
  const found = connections.find((c) => c.integration.provider === "google");
  if (!found) throw new AppError(404, "Google is not connected.", "GOOGLE_NOT_CONNECTED");
  if (found.integration.status !== "active") {
    throw new AppError(409, "Google needs to be reconnected.", "GOOGLE_RECONNECT_REQUIRED");
  }

  const need = REQUIRED[resource];
  if (!found.scopes.includes(need.scope)) {
    throw new AppError(
      403,
      `${need.label} access was not granted. Reconnect Google and allow it.`,
      "GOOGLE_SCOPE_MISSING",
    );
  }

  const auth = await getAuthorizedClient(userId);
  try {
    return await fn(auth);
  } catch (err) {
    throw await mapGoogleError(err, auth.integration.id);
  }
}