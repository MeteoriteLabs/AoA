ALTER TABLE "artifact_versions" ADD COLUMN IF NOT EXISTS "filename" text;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN IF NOT EXISTS "content_type" text;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN IF NOT EXISTS "extension" text;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN IF NOT EXISTS "storage_kind" text DEFAULT 'inline' NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN IF NOT EXISTS "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN IF NOT EXISTS "byte_size" integer;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN IF NOT EXISTS "sha256" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
