CREATE TABLE "loop_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"loop_id" uuid,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_loops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"thread_id" text NOT NULL,
	"trigger_message_id" text NOT NULL,
	"trigger_at" timestamp with time zone NOT NULL,
	"counterpart" text,
	"subject" text NOT NULL,
	"source_url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"snoozed_until" date,
	"resolved_at" timestamp with time zone,
	"resolved_reason" text,
	"resolved_by" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loop_events" ADD CONSTRAINT "loop_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_loops" ADD CONSTRAINT "open_loops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loop_events_user_idx" ON "loop_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "open_loops_trigger_idx" ON "open_loops" USING btree ("user_id","thread_id","kind","trigger_message_id");--> statement-breakpoint
CREATE INDEX "open_loops_user_status_idx" ON "open_loops" USING btree ("user_id","status");