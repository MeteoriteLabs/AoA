CREATE TABLE "viewer_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"viewer_control_level" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discussion_entries" ADD COLUMN "output_refs" jsonb;--> statement-breakpoint
ALTER TABLE "internal_agent_config" ADD COLUMN "viewer_control_level" text DEFAULT 'own_output' NOT NULL;--> statement-breakpoint
ALTER TABLE "viewer_preferences" ADD CONSTRAINT "viewer_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_preferences" ADD CONSTRAINT "viewer_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "viewer_preferences_company_idx" ON "viewer_preferences" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "viewer_preferences_user_idx" ON "viewer_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "viewer_preferences_user_company_uq" ON "viewer_preferences" USING btree ("user_id","company_id");