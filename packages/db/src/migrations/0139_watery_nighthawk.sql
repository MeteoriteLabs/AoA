ALTER TABLE "issue_context_bundles" ALTER COLUMN "source_issue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_context_bundles" ADD COLUMN "source_discussion_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_context_bundles" ADD COLUMN "source_scope_version_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_context_bundles" ADD COLUMN "source_scope_item_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_context_bundles" ADD COLUMN "source_kind" text DEFAULT 'issue' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_context_bundles" ADD CONSTRAINT "issue_context_bundles_source_discussion_id_discussions_id_fk" FOREIGN KEY ("source_discussion_id") REFERENCES "public"."discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_context_bundles" ADD CONSTRAINT "issue_context_bundles_source_scope_version_id_thread_scope_versions_id_fk" FOREIGN KEY ("source_scope_version_id") REFERENCES "public"."thread_scope_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_context_bundles" ADD CONSTRAINT "issue_context_bundles_source_scope_item_id_thread_scope_items_id_fk" FOREIGN KEY ("source_scope_item_id") REFERENCES "public"."thread_scope_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_context_bundles_company_source_discussion_idx" ON "issue_context_bundles" USING btree ("company_id","source_discussion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_context_bundles_company_scope_version_idx" ON "issue_context_bundles" USING btree ("company_id","source_scope_version_id");
