import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// One row per connected provider per user. Tokens are stored encrypted, never in plain text.
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "google"
    accountId: text("account_id").notNull(), // the provider's own id for the account
    accountEmail: text("account_email").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    status: text("status").notNull().default("active"), // active | needs_reconnect
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("integrations_user_provider_unique").on(t.userId, t.provider)],
);

// The permissions the user actually granted. Google lets people untick individual permissions.
export const integrationScopes = pgTable(
  "integration_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("integration_scopes_unique").on(t.integrationId, t.scope)],
);

// Gmail and Calendar sync bookkeeping. Features 04 and 05 will fill in the cursors.
export const integrationSyncStates = pgTable(
  "integration_sync_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(), // gmail | calendar
    cursor: text("cursor"),
    status: text("status").notNull().default("idle"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("integration_sync_states_unique").on(t.integrationId, t.resource)],
);