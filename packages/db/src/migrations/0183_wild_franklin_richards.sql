CREATE TABLE IF NOT EXISTS "comment_wakeup_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"target_agent_id" uuid NOT NULL,
	"wakeup" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_token" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_wakeup_outbox_pending_due_idx" ON "comment_wakeup_outbox" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_wakeup_outbox_comment_target_uniq" ON "comment_wakeup_outbox" USING btree ("comment_id","target_agent_id");