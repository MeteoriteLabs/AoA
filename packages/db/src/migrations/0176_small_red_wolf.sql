ALTER TABLE "agent_runtime_trust_rules" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runtime_trust_rules" ADD COLUMN "grant_scope" text DEFAULT 'persistent' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runtime_trust_rules" ADD CONSTRAINT "agent_runtime_trust_rules_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_trust_rules_run_scope_idx" ON "agent_runtime_trust_rules" USING btree ("run_id","enabled");
