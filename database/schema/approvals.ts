import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export interface CommitmentPayload {
  title: string;
  dueDate: string | null;
  impact: string;
}

// A reply draft. to, subject, inReplyTo and references are computed by the backend from the Gmail thread, never by the AI.
export interface DraftPayload {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
}

// Sending a draft that an earlier approval created. It is a copy of exactly what the user approved, so the
// backend can re-read the Gmail draft and refuse to send if anything differs.
export interface SendPayload {
  draftId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
  sourceApprovalId: string; // the executed gmail_create_draft approval this send belongs to
}

export type ApprovalPayload = CommitmentPayload | DraftPayload | SendPayload;

// One row per action the agent proposed. Nothing runs until the user approves it.
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(), // create_commitment | gmail_create_draft | gmail_send
    payload: jsonb("payload").$type<ApprovalPayload>().notNull(),
    payloadHash: text("payload_hash").notNull(), // SHA-256 of the action type and payload fields, also the idempotency key
    sourceUrl: text("source_url"),
    reason: text("reason"),
    delegationId: uuid("delegation_id"), // delegation that allowed it at approval time (no FK, trail survives deletes)
    status: text("status").notNull().default("pending"), // pending | executing | executed | failed | rejected | expired
    resultRef: text("result_ref"), // commitment id, the Gmail draft id, or the Gmail id of the sent message (no FK)
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [
    index("approvals_user_status_idx").on(t.userId, t.status, t.createdAt),
    // The same proposal cannot be live twice. Rejected, failed and expired ones can be proposed again.
    uniqueIndex("approvals_user_hash_live_idx")
      .on(t.userId, t.payloadHash)
      .where(sql`status in ('pending','executing','executed')`),
  ],
);

// History of what happened to each approval. No text and no foreign keys, like the other event tables.
export const actionEvents = pgTable(
  "action_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    approvalId: uuid("approval_id").notNull(),
    type: text("type").notNull(), // created | approved | rejected | expired | executing | executed | failed
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("action_events_user_approval_idx").on(t.userId, t.approvalId, t.createdAt)],
);