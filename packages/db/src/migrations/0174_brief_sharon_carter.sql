ALTER TABLE "work_questions" ADD COLUMN "producer_invocation_id" text;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "producer_payload_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_questions_producer_invocation_uq" ON "work_questions" USING btree ("company_id","originating_run_kind","originating_run_id","producer_invocation_id") WHERE producer_invocation_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_questions_open_payload_fingerprint_uq" ON "work_questions" USING btree ("company_id","originating_run_kind","originating_run_id","producer_payload_fingerprint") WHERE status = 'open' AND producer_payload_fingerprint IS NOT NULL;
