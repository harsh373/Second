import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, messages } from "./conversations";
import { users } from "./users";

// An ongoing area of the user's life, like "DBMS exam". Commitments are grouped under it.
export const matters = pgTable(
  "matters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    normalized: text("normalized").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("matters_user_normalized_idx").on(t.userId, t.normalized)],
);

// One specific thing the user must do, owes, or is waiting on someone else for.
export const commitments = pgTable(
  "commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    normalized: text("normalized").notNull(),
    status: text("status").notNull().default("open"), // open | waiting | done
    waitingOn: text("waiting_on"), // who owes the user something, only when status is waiting
    dueDate: date("due_date", { mode: "string" }), // YYYY-MM-DD, no time zone games
    impact: text("impact").notNull().default("normal"), // low | normal | high
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("commitments_user_status_idx").on(t.userId, t.status),
    index("commitments_user_normalized_idx").on(t.userId, t.normalized),
    index("commitments_matter_idx").on(t.matterId),
  ],
);

// Typed links between commitments. "from" DEPENDS_ON "to" means: finish "to" first.
// Only DEPENDS_ON is used for now. The other types (BLOCKS, WAITING_FOR, RELATED_TO,
// PROMISED_TO, REQUIRES_RESPONSE, DERIVED_FROM) will be added when a feature needs them.
export const commitmentEdges = pgTable(
  "commitment_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromId: uuid("from_id")
      .notNull()
      .references(() => commitments.id, { onDelete: "cascade" }),
    toId: uuid("to_id")
      .notNull()
      .references(() => commitments.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("commitment_edges_unique_idx").on(t.fromId, t.toId, t.type),
    index("commitment_edges_user_idx").on(t.userId),
    index("commitment_edges_to_idx").on(t.toId),
  ],
);

// Where a commitment came from. If the chat is deleted, the commitment stays and the link is cleared.
export const commitmentSources = pgTable(
  "commitment_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commitmentId: uuid("commitment_id")
      .notNull()
      .references(() => commitments.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(), // chat_message | manual
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    excerpt: text("excerpt"), // the user's own words, shortened
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("commitment_sources_commitment_idx").on(t.commitmentId)],
);

// Audit trail. Stores NO commitment text and has no foreign key to commitments,
// so deleting a commitment really removes its content.
export const commitmentEvents = pgTable(
  "commitment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commitmentId: uuid("commitment_id").notNull(),
    type: text("type").notNull(), // created | updated | completed | deleted
    actor: text("actor").notNull(), // user | second
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("commitment_events_user_idx").on(t.userId, t.createdAt)],
);