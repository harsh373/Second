import { and, eq, inArray } from "drizzle-orm";
import { db } from "../utility/db";
import {
  integrations,
  integrationScopes,
  integrationSyncStates,
} from "../../../database/schema/index";

export type Integration = typeof integrations.$inferSelect;

export async function getIntegration(userId: string, provider: string): Promise<Integration | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

export async function listIntegrationsWithScopes(userId: string) {
  const rows = await db.select().from(integrations).where(eq(integrations.userId, userId));
  if (rows.length === 0) return [];

  const scopeRows = await db
    .select()
    .from(integrationScopes)
    .where(inArray(integrationScopes.integrationId, rows.map((r) => r.id)));

  return rows.map((integration) => ({
    integration,
    scopes: scopeRows.filter((s) => s.integrationId === integration.id).map((s) => s.scope),
  }));
}

// Creates the connection, or replaces it if this user is reconnecting.
export async function saveGoogleConnection(input: {
  userId: string;
  accountId: string;
  accountEmail: string;
  refreshTokenEncrypted: string;
  accessTokenEncrypted: string;
  accessTokenExpiresAt: Date | null;
  scopes: string[];
}): Promise<Integration> {
  return db.transaction(async (tx) => {
    const values = {
      accountId: input.accountId,
      accountEmail: input.accountEmail,
      refreshTokenEncrypted: input.refreshTokenEncrypted,
      accessTokenEncrypted: input.accessTokenEncrypted,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      status: "active",
    };

    const [row] = await tx
      .insert(integrations)
      .values({ userId: input.userId, provider: "google", ...values })
      .onConflictDoUpdate({
        target: [integrations.userId, integrations.provider],
        set: { ...values, connectedAt: new Date(), updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Failed to save integration");

    // Replace the granted permissions with whatever Google just reported.
    await tx.delete(integrationScopes).where(eq(integrationScopes.integrationId, row.id));
    if (input.scopes.length > 0) {
      await tx.insert(integrationScopes).values(input.scopes.map((scope) => ({ integrationId: row.id, scope })));
    }

    // Reconnecting may mean a different Google account, so sync cursors start fresh.
    await tx.delete(integrationSyncStates).where(eq(integrationSyncStates.integrationId, row.id));
    await tx.insert(integrationSyncStates).values([
      { integrationId: row.id, resource: "gmail" },
      { integrationId: row.id, resource: "calendar" },
    ]);

    return row;
  });
}

export async function saveRefreshedTokens(
  integrationId: string,
  tokens: {
    accessTokenEncrypted?: string;
    accessTokenExpiresAt?: Date;
    refreshTokenEncrypted?: string;
  },
): Promise<void> {
  await db
    .update(integrations)
    .set({ ...tokens, updatedAt: new Date() })
    .where(eq(integrations.id, integrationId));
}

export async function markIntegrationStatus(integrationId: string, status: "active" | "needs_reconnect") {
  await db.update(integrations).set({ status, updatedAt: new Date() }).where(eq(integrations.id, integrationId));
}

// Scopes and sync states are removed automatically (ON DELETE CASCADE).
export async function deleteIntegration(integrationId: string): Promise<void> {
  await db.delete(integrations).where(eq(integrations.id, integrationId));
}