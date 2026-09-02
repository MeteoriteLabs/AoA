ALTER TABLE "legacy_resource_reconciliation" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legacy_resource_reconciliation" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "legacy_resource_reconciliation" ADD COLUMN "resolution_reason" text;