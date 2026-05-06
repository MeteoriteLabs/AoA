ALTER TABLE "plugin_config" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_version_snapshots" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plugins" ALTER COLUMN "company_id" SET NOT NULL;