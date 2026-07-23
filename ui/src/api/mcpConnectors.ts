import { api } from "./client";

/**
 * OUTBOUND MCP connectors — external MCP servers this company's agents call.
 * Sibling of the INBOUND MCP API-keys client (`./mcp.ts`), which is the opposite
 * direction (clients calling AoA). Backed by `server/src/routes/mcp-connectors.ts`.
 *
 * Paths carry NO `/api` prefix — `client.ts` prepends `BASE = "/api"`.
 */
export interface McpConnector {
  id: string;
  companyId: string;
  serverName: string;
  displayName: string;
  transport: "http" | "stdio";
  url: string | null;
  command: string | null;
  args: string[];
  headerTemplate: Record<string, string>;
  envTemplate: Record<string, string>;
  secretRef: string | null;
  source: "byo" | "catalog";
  status: "pending_approval" | "active" | "disabled";
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectorInput {
  serverName: string;
  displayName: string;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  headerTemplate?: Record<string, string>;
  envTemplate?: Record<string, string>;
  secretRef?: string;
}

export const mcpConnectorsApi = {
  list: (companyId: string) =>
    api.get<McpConnector[]>(`/companies/${companyId}/mcp-connectors`),
  create: (companyId: string, body: CreateConnectorInput) =>
    api.post<McpConnector & { approvalId?: string | null }>(
      `/companies/${companyId}/mcp-connectors`,
      body,
    ),
  update: (companyId: string, id: string, body: { displayName?: string; status?: string }) =>
    api.patch<McpConnector>(`/companies/${companyId}/mcp-connectors/${id}`, body),
  remove: (companyId: string, id: string) =>
    api.delete<McpConnector>(`/companies/${companyId}/mcp-connectors/${id}`),
  setAgents: (companyId: string, id: string, agentIds: string[]) =>
    api.put<{ connectorId: string; agentIds: string[] }>(
      `/companies/${companyId}/mcp-connectors/${id}/agents`,
      { agentIds },
    ),
};
