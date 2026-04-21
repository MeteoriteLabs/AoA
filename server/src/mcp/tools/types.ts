import type { Db } from "@paperclipai/db";
import type {
  agentService,
  approvalService,
  artifactService,
  companyService,
  debriefService,
  extractionService,
  goalService,
  issueApprovalService,
  issueService,
  mcpService,
  memoryService,
  permissionService,
  projectService,
} from "../../services/index.js";
import type { getActorInfo } from "../../routes/authz.js";

export type McpUserScope =
  | { kind: "founder"; userId: string }
  | { kind: "scoped"; userId: string; projectIds: Set<string> };

export type ProtocolActor = {
  userId: string;
  companyId: string | null;
  keyId: string | null;
  source: "mcp" | "board";
};

export interface ToolServices {
  issuesSvc: ReturnType<typeof issueService>;
  goalsSvc: ReturnType<typeof goalService>;
  memorySvc: ReturnType<typeof memoryService>;
  artifactsSvc: ReturnType<typeof artifactService>;
  debriefsSvc: ReturnType<typeof debriefService>;
  extractionSvc: ReturnType<typeof extractionService>;
  companiesSvc: ReturnType<typeof companyService>;
  mcpSvc: ReturnType<typeof mcpService>;
  permissionsSvc: ReturnType<typeof permissionService>;
  agentsSvc: ReturnType<typeof agentService>;
  projectsSvc: ReturnType<typeof projectService>;
  approvalsSvc: ReturnType<typeof approvalService>;
  issueApprovalsSvc: ReturnType<typeof issueApprovalService>;
}

export interface ToolContext {
  db: Db;
  companyId: string;
  actor: ProtocolActor;
  scope: McpUserScope;
  services: ToolServices;
  actorInfo: ReturnType<typeof getActorInfo>;
  resolveRole: (companyId: string, userId: string) => Promise<string>;
  resolveScopedAgentIds: (
    companyId: string,
    scope: McpUserScope,
  ) => Promise<Set<string> | null>;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: number; message: string };

export type ToolHandler = (
  ctx: ToolContext,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export const ok = (data: unknown): ToolResult => ({ ok: true, data });

export const err = (status: number, code: number, message: string): ToolResult => ({
  ok: false,
  status,
  code,
  message,
});

export const notFoundResult = (message: string): ToolResult => err(404, -32004, message);
export const forbiddenResult = (message: string): ToolResult => err(403, -32003, message);
