CREATE TABLE "action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"source_url" text,
	"reason" text,
	"delegation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_ref" uuid,
	"error_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_events_user_approval_idx" ON "action_events" USING btree ("user_id","approval_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_user_status_idx" ON "approvals" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_user_hash_live_idx" ON "approvals" USING btree ("user_id","payload_hash") WHERE status in ('pending','executing','executed');