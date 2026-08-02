CREATE INDEX IF NOT EXISTS "mcp_connector_oauth_flows_status_updated_idx" ON "mcp_connector_oauth_flows" USING btree ("status","updated_at");
