CREATE TABLE IF NOT EXISTS "task_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text DEFAULT 'aoa' NOT NULL,
	"external_id" text,
	"artifact_id" uuid,
	"artifact_version_id" uuid,
	"asset_id" uuid,
	"execution_workspace_id" uuid,
	"runtime_service_id" uuid,
	"url" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"review_state" text DEFAULT 'none' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"summary" text,
	"metadata" jsonb,
	"created_by_run_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_runtime_service_id_workspace_runtime_services_id_fk" FOREIGN KEY ("runtime_service_id") REFERENCES "public"."workspace_runtime_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_outputs" ADD CONSTRAINT "task_outputs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_outputs_company_issue_type_idx" ON "task_outputs" USING btree ("company_id","issue_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_outputs_company_issue_primary_idx" ON "task_outputs" USING btree ("company_id","issue_id","is_primary");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_outputs_company_workspace_type_idx" ON "task_outputs" USING btree ("company_id","execution_workspace_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_outputs_company_runtime_service_idx" ON "task_outputs" USING btree ("company_id","runtime_service_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_outputs_company_artifact_idx" ON "task_outputs" USING btree ("company_id","artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_outputs_company_issue_provider_external_uq" ON "task_outputs" USING btree ("company_id","issue_id","provider","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_outputs_company_updated_idx" ON "task_outputs" USING btree ("company_id","updated_at");
