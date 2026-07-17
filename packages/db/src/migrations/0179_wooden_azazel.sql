ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "upload_namespace" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "composer_validated" boolean DEFAULT false NOT NULL;