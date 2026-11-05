import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, messages } from "./conversations";
import { users } from "./users";

// One durable fact about the user per row.
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // identity | preferences | goals | relationships | responsibilities | history
    content: text("content").notNull(),
    normalized: text("normalized").notNull(), // lowercased text, used to block exact duplicates
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("memories_user_normalized_idx").on(t.userId, t.normalized),
    index("memories_user_category_idx").on(t.userId, t.category),
  ],
);

// Where a memory came from. If the chat is deleted, the memory stays and the link is cleared.
export const memorySources = pgTable(
  "memory_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(), // chat_message | manual
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    excerpt: text("excerpt"), // the user's own words, shortened
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("memory_sources_memory_idx").on(t.memoryId)],
);

// Audit trail. It deliberately stores NO memory text and has no foreign key to memories,
// so deleting a memory really removes its content.
export const memoryEvents = pgTable(
  "memory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id").notNull(),
    type: text("type").notNull(), // created | updated | deleted
    actor: text("actor").notNull(), // user | second
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("memory_events_user_idx").on(t.userId, t.createdAt)],
);