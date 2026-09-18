ALTER TABLE "internal_agent_runs" ADD COLUMN "execution_owner" text;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "distributed_job_id" uuid;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "distributed_attempt_id" uuid;