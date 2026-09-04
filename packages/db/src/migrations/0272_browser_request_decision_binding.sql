ALTER TABLE "agent_runtime_decisions" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runtime_decisions" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runtime_decisions" ADD CONSTRAINT "agent_runtime_decisions_legacy_binding_all_or_nothing" CHECK ((agent_id is null) = (run_id is null));