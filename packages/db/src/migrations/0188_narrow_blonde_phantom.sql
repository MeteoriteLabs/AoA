CREATE TABLE IF NOT EXISTS "mcp_connector_oauth_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"state" text NOT NULL,
	"pkce_verifier" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"authorization_endpoint" text NOT NULL,
	"token_endpoint" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_connector_oauth_flows" ADD CONSTRAINT "mcp_connector_oauth_flows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connector_oauth_flows" ADD CONSTRAINT "mcp_connector_oauth_flows_connector_id_company_mcp_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."company_mcp_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_connector_oauth_flows_state_idx" ON "mcp_connector_oauth_flows" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_connector_oauth_flows_connector_idx" ON "mcp_connector_oauth_flows" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_connector_oauth_flows_company_idx" ON "mcp_connector_oauth_flows" USING btree ("company_id");