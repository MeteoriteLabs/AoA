CREATE TABLE IF NOT EXISTS "mcp_connector_oauth_refresh_leases" (
	"secret_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_token" uuid NOT NULL,
	"fencing_token" bigint NOT NULL,
	"expected_secret_version" integer NOT NULL,
	"phase" text DEFAULT 'acquired' NOT NULL,
	"request_started_at" timestamp with time zone,
	"leased_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_mcp_connectors" ADD COLUMN IF NOT EXISTS "catalog_entry_id" text;--> statement-breakpoint
ALTER TABLE "company_mcp_connectors" ADD COLUMN IF NOT EXISTS "oauth_policy_version" integer;--> statement-breakpoint
ALTER TABLE "mcp_connector_oauth_flows" ADD COLUMN IF NOT EXISTS "catalog_entry_id" text;--> statement-breakpoint
ALTER TABLE "mcp_connector_oauth_flows" ADD COLUMN IF NOT EXISTS "oauth_policy_version" integer;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mcp_connector_oauth_refresh_leases" ADD CONSTRAINT "mcp_connector_oauth_refresh_leases_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mcp_connector_oauth_refresh_leases" ADD CONSTRAINT "mcp_connector_oauth_refresh_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_mcp_connectors_company_catalog_entry_uq" ON "company_mcp_connectors" USING btree ("company_id","catalog_entry_id") WHERE "company_mcp_connectors"."catalog_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_connector_oauth_flows_status_expires_idx" ON "mcp_connector_oauth_flows" USING btree ("status","expires_at");
