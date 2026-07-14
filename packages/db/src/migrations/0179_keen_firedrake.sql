ALTER TABLE "heartbeat_runs" ALTER COLUMN "active_execution_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ALTER COLUMN "human_question_wait_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ALTER COLUMN "runtime_permission_wait_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ALTER COLUMN "total_wall_clock_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ALTER COLUMN "active_execution_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ALTER COLUMN "human_question_wait_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ALTER COLUMN "runtime_permission_wait_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ALTER COLUMN "total_wall_clock_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "work_questions" ADD COLUMN "sla_notifications_completed_at" timestamp with time zone;