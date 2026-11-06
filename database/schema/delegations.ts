import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// What the user authorized Second to take care of. A record of permission only: nothing executes yet.
export const delegations = pgTable(
  "delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    responsibility: text("responsibility").notNull(),
    scope: text("scope").notNull(),
    triggerKind: text("trigger_kind").notNull(), // when_asked | new_email | before_meeting | schedule
    authority: text("authority").notNull(), // observe | suggest | execute_with_approval | narrow_delegation
    status: text("status").notNull().default("active"), // active | paused | revoked | expired
    reviewAt: date("review_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("delegations_user_status_idx").on(t.userId, t.status)],
);

// One row per authorized tool or restriction.
export const delegationRules = pgTable(
  "delegation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    delegationId: uuid("delegation_id")
      .notNull()
      .references(() => delegations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // tool | restriction
    value: text("value").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("delegation_rules_delegation_idx").on(t.delegationId),
    uniqueIndex("delegation_rules_unique_idx").on(t.delegationId, t.kind, t.value),
  ],
);

// History of what happened to each delegation. No text and no foreign keys, so the trail survives deletes.
export const delegationEvents = pgTable(
  "delegation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    delegationId: uuid("delegation_id").notNull(),
    type: text("type").notNull(), // created | paused | resumed | revoked | expired | deleted
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("delegation_events_user_delegation_idx").on(t.userId, t.delegationId, t.createdAt)],
);