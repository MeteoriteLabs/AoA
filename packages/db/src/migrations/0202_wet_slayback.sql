CREATE TABLE "memory_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"department_id" uuid,
	"autonomy_level" text DEFAULT 'supervised' NOT NULL,
	"active_context_tier" text DEFAULT 'durable' NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"run_miner_enabled" boolean DEFAULT true NOT NULL,
	"run_miner_budget_cents" integer,
	"external_screening_enabled" boolean DEFAULT true NOT NULL,
	"private_memory_enabled" boolean DEFAULT true NOT NULL,
	"working_memory_ttl_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "owner_type" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "provenance_kind" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "trust" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "effective_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "effective_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_department_id_projects_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_settings_company_dept_uq" ON "memory_settings" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_settings_company_default_uq" ON "memory_settings" USING btree ("company_id") WHERE "memory_settings"."department_id" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_settings_company_idx" ON "memory_settings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_items_identity_mirror_uq" ON "memory_items" USING btree ("company_id","title") WHERE "memory_items"."layer" = 'identity' AND "memory_items"."source_context" = 'company:identity';