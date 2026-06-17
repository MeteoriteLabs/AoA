CREATE TABLE IF NOT EXISTS "thread_scope_artifact_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_version_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_version_id" uuid,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_scope_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_version_id" uuid NOT NULL,
	"item_order" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted_item_id" uuid,
	"target_issue_id" uuid,
	"result_issue_id" uuid,
	"result_memory_id" uuid,
	"artifact_id" uuid,
	"artifact_version_id" uuid,
	"applied_by_user_id" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_scope_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_start_seq" integer NOT NULL,
	"source_end_seq" integer NOT NULL,
	"base_version_id" uuid,
	"proposal_entry_id" uuid,
	"summary" text NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_by_agent_id" uuid,
	"accepted_by_user_id" text,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "scope_version_id" uuid;--> statement-breakpoint
ALTER TABLE "thread_scope_artifact_links" ADD CONSTRAINT "thread_scope_artifact_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_artifact_links" ADD CONSTRAINT "thread_scope_artifact_links_scope_version_id_thread_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."thread_scope_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_artifact_links" ADD CONSTRAINT "thread_scope_artifact_links_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_artifact_links" ADD CONSTRAINT "thread_scope_artifact_links_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_scope_version_id_thread_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."thread_scope_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_extracted_item_id_discussion_extracted_items_id_fk" FOREIGN KEY ("extracted_item_id") REFERENCES "public"."discussion_extracted_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_target_issue_id_issues_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_result_issue_id_issues_id_fk" FOREIGN KEY ("result_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_result_memory_id_memory_items_id_fk" FOREIGN KEY ("result_memory_id") REFERENCES "public"."memory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_items" ADD CONSTRAINT "thread_scope_items_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_versions" ADD CONSTRAINT "thread_scope_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_versions" ADD CONSTRAINT "thread_scope_versions_thread_id_discussions_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_versions" ADD CONSTRAINT "thread_scope_versions_base_version_id_thread_scope_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."thread_scope_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_versions" ADD CONSTRAINT "thread_scope_versions_proposal_entry_id_discussion_entries_id_fk" FOREIGN KEY ("proposal_entry_id") REFERENCES "public"."discussion_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_scope_versions" ADD CONSTRAINT "thread_scope_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_scope_artifact_links_scope_version_idx" ON "thread_scope_artifact_links" USING btree ("scope_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_scope_artifact_links_artifact_idx" ON "thread_scope_artifact_links" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_scope_items_scope_version_idx" ON "thread_scope_items" USING btree ("scope_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_scope_items_kind_status_idx" ON "thread_scope_items" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_scope_items_target_issue_idx" ON "thread_scope_items" USING btree ("target_issue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_scope_items_result_issue_idx" ON "thread_scope_items" USING btree ("result_issue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_scope_versions_company_thread_idx" ON "thread_scope_versions" USING btree ("company_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thread_scope_versions_thread_version_uq" ON "thread_scope_versions" USING btree ("thread_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thread_scope_versions_one_draft_uq" ON "thread_scope_versions" USING btree ("thread_id") WHERE "thread_scope_versions"."status" = 'draft';--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_scope_version_id_thread_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."thread_scope_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_scope_version_idx" ON "issues" USING btree ("scope_version_id");
