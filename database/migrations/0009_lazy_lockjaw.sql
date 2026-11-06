CREATE TABLE "delegation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delegation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"responsibility" text NOT NULL,
	"scope" text NOT NULL,
	"trigger_kind" text NOT NULL,
	"authority" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"review_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delegation_rules" ADD CONSTRAINT "delegation_rules_delegation_id_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_rules" ADD CONSTRAINT "delegation_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegation_events_user_delegation_idx" ON "delegation_events" USING btree ("user_id","delegation_id","created_at");--> statement-breakpoint
CREATE INDEX "delegation_rules_delegation_idx" ON "delegation_rules" USING btree ("delegation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_rules_unique_idx" ON "delegation_rules" USING btree ("delegation_id","kind","value");--> statement-breakpoint
CREATE INDEX "delegations_user_status_idx" ON "delegations" USING btree ("user_id","status");