import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // morning | weekly | pre_meeting
    title: text("title").notNull(),
    eventId: text("event_id"), // only for pre_meeting
    content: jsonb("content").notNull(), // sections and items, each item carries its own source link
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("briefings_user_generated_idx").on(t.userId, t.generatedAt)],
);