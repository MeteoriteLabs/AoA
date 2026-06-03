ALTER TABLE "issues" DROP CONSTRAINT "issues_checkout_run_id_heartbeat_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "issues" DROP CONSTRAINT "issues_execution_run_id_heartbeat_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "discussions" ADD COLUMN "routing_terms" jsonb;--> statement-breakpoint
ALTER TABLE "internal_agent_config" ADD COLUMN "inbound_routing_level" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_status" text DEFAULT 'pending_route' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_error_code" text;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "navigator_wakeup_id" uuid;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "suggested_thread_title" text;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_card_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_inbox_items_company_dedup_idx" ON "thread_inbox_items" USING btree ("company_id","dedup_key");