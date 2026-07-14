ALTER TABLE "agent_wakeup_requests" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_wakeup_requests_processing_lease_idx" ON "agent_wakeup_requests" USING btree ("status","lease_expires_at");
