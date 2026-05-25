CREATE TABLE IF NOT EXISTS "internal_agent_runtime_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid,
	"run_id" uuid,
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" text NOT NULL,
	"params_hash_version" text DEFAULT 'v1' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"decision" text,
	"executed_at" timestamp with time zone,
	"result_summary" text,
	"result_error" text,
	"result_entity_type" text,
	"result_entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_agent_tool_trust_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"params_hash" text NOT NULL,
	"params_hash_version" text DEFAULT 'v1' NOT NULL,
	"scope" text DEFAULT 'exact_params' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "internal_agent_config" ADD COLUMN IF NOT EXISTS "runtime_approvals_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_config" ADD COLUMN IF NOT EXISTS "runtime_allow_always_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_config" ADD COLUMN IF NOT EXISTS "vendor_cli_bypass_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_agent_runtime_approvals" ADD CONSTRAINT "internal_agent_runtime_approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_agent_runtime_approvals" ADD CONSTRAINT "internal_agent_runtime_approvals_conversation_id_internal_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."internal_agent_conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_agent_runtime_approvals" ADD CONSTRAINT "internal_agent_runtime_approvals_run_id_internal_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."internal_agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_agent_tool_trust_rules" ADD CONSTRAINT "internal_agent_tool_trust_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_runtime_approvals_company_status_expiry_idx" ON "internal_agent_runtime_approvals" USING btree ("company_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_runtime_approvals_company_user_status_idx" ON "internal_agent_runtime_approvals" USING btree ("company_id","user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_runtime_approvals_run_idx" ON "internal_agent_runtime_approvals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_runtime_approvals_tool_idx" ON "internal_agent_runtime_approvals" USING btree ("tool_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ia_tool_trust_rules_exact_params_uq" ON "internal_agent_tool_trust_rules" USING btree ("company_id","user_id","tool_name","params_hash","params_hash_version","scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_tool_trust_rules_company_user_enabled_idx" ON "internal_agent_tool_trust_rules" USING btree ("company_id","user_id","enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_tool_trust_rules_company_tool_idx" ON "internal_agent_tool_trust_rules" USING btree ("company_id","tool_name");
