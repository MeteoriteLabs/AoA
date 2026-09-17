CREATE TABLE "universe_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"destination_kind" text NOT NULL,
	"destination_id" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"attachment_asset_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "universe_drafts_company_user_idx" ON "universe_drafts" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "universe_drafts_owner_destination_uq" ON "universe_drafts" USING btree ("user_id","company_id","conversation_id","destination_kind","destination_id");