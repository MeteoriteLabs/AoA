ALTER TABLE "internal_agent_config" ADD COLUMN "inbound_routing_level" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_status" text DEFAULT 'pending_route' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_error_code" text;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "navigator_wakeup_id" uuid;--> statement-breakpoint
-- Durable cross-status dedup guard: prevents re-delivered inbound items from
-- producing a second row after status moves pending→attached (Codex #8).
-- Non-partial (no WHERE) by design. IF NOT EXISTS per C14 idempotency rule.
CREATE UNIQUE INDEX IF NOT EXISTS "thread_inbox_items_company_dedup_idx" ON "thread_inbox_items" USING btree ("company_id","dedup_key");