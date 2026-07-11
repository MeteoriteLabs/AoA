CREATE TABLE IF NOT EXISTS "work_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"asking_agent_id" uuid NOT NULL,
	"originating_run_kind" text,
	"originating_run_id" uuid,
	"execution_workspace_id" uuid,
	"source_discussion_id" uuid,
	"source_discussion_entry_id" uuid,
	"primary_recipient_user_id" text NOT NULL,
	"current_recipient_user_id" text NOT NULL,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"context" jsonb,
	"options" jsonb,
	"blocking" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" jsonb,
	"answer_idempotency_key" text,
	"answered_by_user_id" text,
	"answered_at" timestamp with time zone,
	"continuation_status" text DEFAULT 'not_needed' NOT NULL,
	"continuation_run_kind" text,
	"continuation_run_id" uuid,
	"continuation_error" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_completion_policy_default" text DEFAULT 'review_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_completion_review_guardrail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "reviewer_source" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "agent_completion_policy" text DEFAULT 'review_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "agent_completion_policy_override" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "agent_completion_policy_source" text DEFAULT 'legacy_backfill' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "agent_completion_policy_source_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "agent_completion_policy_resolved_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "agent_completion_policy_default" text;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "agent_completion_policy_override" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "agent_completion_policy_override" text;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_asking_agent_id_agents_id_fk" FOREIGN KEY ("asking_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_source_discussion_id_discussions_id_fk" FOREIGN KEY ("source_discussion_id") REFERENCES "public"."discussions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_source_discussion_entry_id_discussion_entries_id_fk" FOREIGN KEY ("source_discussion_entry_id") REFERENCES "public"."discussion_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_primary_recipient_user_id_user_id_fk" FOREIGN KEY ("primary_recipient_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_current_recipient_user_id_user_id_fk" FOREIGN KEY ("current_recipient_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_questions" ADD CONSTRAINT "work_questions_answered_by_user_id_user_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_company_recipient_status_idx" ON "work_questions" USING btree ("company_id","current_recipient_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_issue_status_created_idx" ON "work_questions" USING btree ("issue_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_source_discussion_created_idx" ON "work_questions" USING btree ("source_discussion_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_workspace_created_idx" ON "work_questions" USING btree ("execution_workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_originating_run_idx" ON "work_questions" USING btree ("originating_run_kind","originating_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_questions_continuation_status_idx" ON "work_questions" USING btree ("continuation_status","updated_at");
