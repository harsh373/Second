import { google } from "googleapis";
import { env } from "../config/env";
import {
  getIntegration,
  markIntegrationStatus,
  saveRefreshedTokens,
  type Integration,
} from "../model/integration.model";
import { AppError } from "./AppError";
import { decrypt, encrypt } from "./crypto";
import { logger } from "./logger";

export const SCOPE_EMAIL = "https://www.googleapis.com/auth/userinfo.email";
export const SCOPE_GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
export const SCOPE_GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
export const SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.readonly";

// gmail.compose lets Second create reply drafts after you approve them. Google describes it as
// "manage drafts and send emails", so the permission can also send. Second has no code that sends.
export const GOOGLE_SCOPES = ["openid", SCOPE_EMAIL, SCOPE_GMAIL, SCOPE_GMAIL_COMPOSE, SCOPE_CALENDAR];

export function createOAuthClient() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function buildAuthUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline", // asks Google for a refresh token
    prompt: "consent", // makes Google return the refresh token on every connect
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function exchangeCode(code: string) {
  const client = createOAuthClient();

  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (err) {
    logger.warn("Google code exchange failed:", err instanceof Error ? err.message : err);
    throw new AppError(400, "Google rejected the connection. Please try connecting again.", "GOOGLE_EXCHANGE_FAILED");
  }

  if (!tokens.refresh_token || !tokens.access_token || !tokens.id_token) {
    throw new AppError(502, "Google did not return the expected credentials.", "GOOGLE_INCOMPLETE_RESPONSE");
  }

  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const identity = ticket.getPayload();
  if (!identity?.email || !identity.sub) {
    throw new AppError(502, "Could not read your Google account email.", "GOOGLE_NO_IDENTITY");
  }

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    accountId: identity.sub,
    accountEmail: identity.email,
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
  };
}

// Returns a Google client for this user. Whenever Google issues a new access token, it is
// encrypted and saved automatically. Gmail and Calendar features will call this.
export async function getAuthorizedClient(userId: string, options: { forceRefresh?: boolean } = {}) {
  const integration = await getIntegration(userId, "google");
  if (!integration) throw new AppError(404, "Google is not connected.", "GOOGLE_NOT_CONNECTED");
  if (integration.status !== "active") {
    throw new AppError(409, "Google needs to be reconnected.", "GOOGLE_RECONNECT_REQUIRED");
  }

  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: decrypt(integration.refreshTokenEncrypted),
    // With only a refresh token set, the next call is guaranteed to fetch a fresh access token.
    ...(options.forceRefresh || !integration.accessTokenEncrypted
      ? {}
      : {
          access_token: decrypt(integration.accessTokenEncrypted),
          expiry_date: integration.accessTokenExpiresAt?.getTime(),
        }),
  });

  client.on("tokens", (tokens) => {
    saveRefreshedTokens(integration.id, {
      accessTokenEncrypted: tokens.access_token ? encrypt(tokens.access_token) : undefined,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      refreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
    }).catch((err) => logger.error("Failed to save refreshed Google tokens:", err));
  });

  return { client, integration };
}

function isInvalidGrant(err: unknown): boolean {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === "invalid_grant" || (err instanceof Error && err.message.includes("invalid_grant"));
}

// Forces a real refresh round trip to Google. If Google says the grant is dead (the user revoked
// access, or a testing-mode token expired), the connection is flagged for reconnection.
export async function verifyGoogleAccess(userId: string): Promise<Integration> {
  const { client, integration } = await getAuthorizedClient(userId, { forceRefresh: true });
  try {
    await client.getAccessToken();
  } catch (err) {
    if (isInvalidGrant(err)) {
      await markIntegrationStatus(integration.id, "needs_reconnect");
      throw new AppError(409, "Google access was revoked or expired. Please reconnect.", "GOOGLE_RECONNECT_REQUIRED");
    }
    logger.error("Google verification failed:", err);
    throw new AppError(502, "Could not reach Google. Try again in a moment.", "GOOGLE_UNAVAILABLE");
  }
  return integration;
}

export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  await createOAuthClient().revokeToken(refreshToken);
}