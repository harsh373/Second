import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// A person in the user's world. Either found in Gmail headers (has an email) or named by the user in chat (name only).
// "Removing" a Gmail person keeps only the email with hidden = true, so a refresh does not recreate them.
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    normalizedName: text("normalized_name"),
    email: text("email"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("people_user_email_unique").on(t.userId, t.email),
    index("people_user_name_idx").on(t.userId, t.normalizedName),
  ],
);

// How the user says this person relates to them. Only ever written from the user's own words or hand edits.
export const userRelationships = pgTable(
  "user_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sourceType: text("source_type").notNull(), // chat_message | manual
    excerpt: text("excerpt"), // the user's own words, max 200 chars
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_relationships_person_unique").on(t.personId)],
);

// One row per (person, Gmail thread). References only: subject, date, direction and a link. No message text.
export const interactions = pgTable(
  "interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    subject: text("subject").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    lastDirection: text("last_direction").notNull(), // from (they wrote last) | to (the user wrote last)
    messageCount: integer("message_count").notNull(),
    sourceUrl: text("source_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("interactions_person_thread_unique").on(t.personId, t.threadId),
    index("interactions_user_person_idx").on(t.userId, t.personId),
  ],
);