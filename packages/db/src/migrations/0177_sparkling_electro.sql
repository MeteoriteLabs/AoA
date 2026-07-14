ALTER TABLE "heartbeat_runs" ADD COLUMN "active_execution_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "human_question_wait_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "runtime_permission_wait_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "total_wall_clock_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "active_execution_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "human_question_wait_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "runtime_permission_wait_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "total_wall_clock_ms" integer DEFAULT 0 NOT NULL;