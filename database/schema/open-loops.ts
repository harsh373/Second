import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// One unfinished email thread. It stores references only (ids, subject, dates, link), never email bodies.
// Gmail stays the source of truth.
export const openLoops = pgTable(
  "open_loops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // needs_reply | waiting_on
    threadId: text("thread_id").notNull(),
    triggerMessageId: text("trigger_message_id").notNull(), // the message that made this a loop
    triggerAt: timestamp("trigger_at", { withTimezone: true }).notNull(),
    counterpart: text("counterpart"), // who wrote to you, or who you are waiting on (display text)
    subject: text("subject").notNull(),
    sourceUrl: text("source_url").notNull(),
    status: text("status").notNull().default("active"), // active | resolved | dismissed
    snoozedUntil: date("snoozed_until", { mode: "string" }), // YYYY-MM-DD; hidden until that day
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedReason: text("resolved_reason"),
    resolvedBy: text("resolved_by"), // gmail | user
    checkedAt: timestamp("checked_at", { withTimezone: true }), // last time it was re-read from Gmail
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // A given trigger message can only ever create one loop, so a dismissed loop is never re-created by a scan.
    uniqueIndex("open_loops_trigger_idx").on(t.userId, t.threadId, t.kind, t.triggerMessageId),
    index("open_loops_user_status_idx").on(t.userId, t.status),
  ],
);

// Audit trail. Stores NO subjects or addresses and has no foreign key to open_loops.
// A "scan" event has no loop id and is how the app knows when the last scan happened.
export const loopEvents = pgTable(
  "loop_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    loopId: uuid("loop_id"),
    type: text("type").notNull(), // created | resolved | dismissed | snoozed | reopened | scan
    actor: text("actor").notNull(), // user | gmail | scan
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("loop_events_user_idx").on(t.userId, t.createdAt)],
);