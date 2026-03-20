CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_versions" ALTER COLUMN "version_number" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_roles_company_user_idx" ON "user_roles" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_company_user_project_uq" ON "user_roles" USING btree ("company_id","user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_trust_scores_company_agent_uq" ON "agent_trust_scores" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_artifact_version_uq" ON "artifact_versions" USING btree ("artifact_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_item_versions_item_version_uq" ON "memory_item_versions" USING btree ("memory_item_id","version_number");