CREATE TABLE IF NOT EXISTS "discussion_mention_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"discussion_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"mentions" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discussion_mention_outbox_pending_due_idx" ON "discussion_mention_outbox" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discussion_mention_outbox_entry_idx" ON "discussion_mention_outbox" USING btree ("entry_id");