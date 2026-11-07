import type { RequestHandler } from "express";
import { z } from "zod";
import {
  deleteIntegration,
  getIntegration,
  listIntegrationsWithScopes,
  saveGoogleConnection,
  type Integration,
} from "../model/integration.model";
import { AppError } from "../utility/AppError";
import { createOAuthState, decrypt, encrypt, verifyOAuthState } from "../utility/crypto";
import {
  buildAuthUrl,
  exchangeCode,
  revokeGoogleToken,
  SCOPE_CALENDAR,
  SCOPE_GMAIL,
  SCOPE_GMAIL_COMPOSE,
  verifyGoogleAccess,
} from "../utility/google";
import { logger } from "../utility/logger";

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// What the frontend is allowed to see. Tokens never leave the server.
function toSummary(integration: Integration, scopes: string[]) {
  return {
    provider: "google" as const,
    status: integration.status,
    accountEmail: integration.accountEmail,
    connectedAt: integration.connectedAt,
    permissions: {
      gmail: scopes.includes(SCOPE_GMAIL),
      gmailDrafts: scopes.includes(SCOPE_GMAIL_COMPOSE),
      calendar: scopes.includes(SCOPE_CALENDAR),
    },
  };
}

export const listIntegrations: RequestHandler = async (req, res) => {
  const items = await listIntegrationsWithScopes(req.user!.id);
  res.json({ integrations: items.map(({ integration, scopes }) => toSummary(integration, scopes)) });
};

export const startGoogleConnect: RequestHandler = (req, res) => {
  res.json({ url: buildAuthUrl(createOAuthState(req.user!.id)) });
};

export const completeGoogleConnect: RequestHandler = async (req, res) => {
  const { code, state } = callbackSchema.parse(req.body);

  // The state must have been issued to the user who is signed in right now.
  const stateUserId = verifyOAuthState(state);
  if (!stateUserId || stateUserId !== req.user!.id) {
    throw new AppError(400, "This connection link is invalid or expired. Please try again.", "INVALID_OAUTH_STATE");
  }

  const google = await exchangeCode(code);
  const integration = await saveGoogleConnection({
    userId: req.user!.id,
    accountId: google.accountId,
    accountEmail: google.accountEmail,
    refreshTokenEncrypted: encrypt(google.refreshToken),
    accessTokenEncrypted: encrypt(google.accessToken),
    accessTokenExpiresAt: google.accessTokenExpiresAt,
    scopes: google.scopes,
  });

  res.json(toSummary(integration, google.scopes));
};

export const verifyGoogle: RequestHandler = async (req, res) => {
  const integration = await verifyGoogleAccess(req.user!.id);
  res.json({ ok: true, accountEmail: integration.accountEmail });
};

export const disconnectGoogle: RequestHandler = async (req, res) => {
  const integration = await getIntegration(req.user!.id, "google");
  if (integration) {
    // Best effort: ask Google to revoke. Local deletion happens either way.
    try {
      await revokeGoogleToken(decrypt(integration.refreshTokenEncrypted));
    } catch (err) {
      logger.warn("Google token revocation failed (continuing with local delete):", err instanceof Error ? err.message : err);
    }
    await deleteIntegration(integration.id);
  }
  res.status(204).end();
};