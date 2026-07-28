ALTER TABLE "provider_readiness_status" ADD COLUMN "execution_target_id" text;--> statement-breakpoint
ALTER TABLE "provider_readiness_status" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
ALTER TABLE "provider_readiness_status" ADD COLUMN "stale_at" timestamp with time zone;