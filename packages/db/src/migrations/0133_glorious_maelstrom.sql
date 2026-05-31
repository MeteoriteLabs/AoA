ALTER TABLE "discussions" ADD COLUMN "routing_terms" jsonb;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "suggested_thread_title" text;--> statement-breakpoint
ALTER TABLE "thread_inbox_items" ADD COLUMN "routing_card_snapshot" jsonb;