ALTER TABLE "memory_items" ADD COLUMN "owner_type" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "provenance_kind" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "trust" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "effective_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "effective_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "invalidated_at" timestamp with time zone;