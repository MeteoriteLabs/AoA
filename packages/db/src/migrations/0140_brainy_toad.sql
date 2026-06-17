CREATE TABLE IF NOT EXISTS "thread_agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"run_id" uuid,
	"agent_id" uuid,
	"action_type" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"freshness" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocked_reason" text,
	"committed_entry_id" uuid,
	"committed_scope_version_id" uuid,
	"committed_scope_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_agent_actions" ADD CONSTRAINT "thread_agent_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_agent_actions" ADD CONSTRAINT "thread_agent_actions_thread_id_discussions_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_agent_actions" ADD CONSTRAINT "thread_agent_actions_run_id_internal_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."internal_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_agent_actions" ADD CONSTRAINT "thread_agent_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_agent_actions" ADD CONSTRAINT "thread_agent_actions_committed_entry_id_discussion_entries_id_fk" FOREIGN KEY ("committed_entry_id") REFERENCES "public"."discussion_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_agent_actions" ADD CONSTRAINT "thread_agent_actions_committed_scope_version_id_thread_scope_versions_id_fk" FOREIGN KEY ("committed_scope_version_id") REFERENCES "public"."thread_scope_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_agent_actions" ADD CONSTRAINT "thread_agent_actions_committed_scope_item_id_thread_scope_items_id_fk" FOREIGN KEY ("committed_scope_item_id") REFERENCES "public"."thread_scope_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_agent_actions_company_thread_status_idx" ON "thread_agent_actions" USING btree ("company_id","thread_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_agent_actions_run_idx" ON "thread_agent_actions" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thread_agent_actions_company_idempotency_uq" ON "thread_agent_actions" USING btree ("company_id","idempotency_key");
