import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Proof-that-migrations-work table. Safe to delete once real tables exist.
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
