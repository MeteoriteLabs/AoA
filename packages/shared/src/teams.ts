import { z } from "zod";

export type TeamRole = "lead" | "member";
export type TeamStatus = "active" | "archived";
export type TeamCoordinationStatus = "draft" | "published" | "archived";

export const TeamRoleSchema = z.enum(["lead", "member"]);
export const TeamStatusSchema = z.enum(["active", "archived"]);

export interface FileInventoryEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface TeamManifestRoutingRule {
  match: string;     // regex pattern
  mention: string;   // "@alice"
}

export interface TeamManifestRouting {
  defaultLead?: string;
  rules: TeamManifestRoutingRule[];
}

export interface TeamManifestAgentInline {
  name: string;
  role: TeamRole;
  skillKeys: string[];
  instructionsTemplate?: string;
}

export interface TeamManifestAgentRef {
  $ref: string;          // "@aoa/agent-name@1.0.0"
  localName: string;
  role: TeamRole;
}

export type TeamManifestAgent = TeamManifestAgentInline | TeamManifestAgentRef;

export interface TeamManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  agents: TeamManifestAgent[];
  routing: TeamManifestRouting;
  skillDeps?: string[];
  pluginDeps?: string[];
  workflowTemplates?: Array<{ $ref: string }>;
  memoryItems?: Array<{ layer: string; title: string; body: string }>;
}

export const TeamManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver"),
  displayName: z.string().optional(),
  description: z.string().optional(),
  agents: z.array(z.union([
    z.object({
      name: z.string().min(1),
      role: TeamRoleSchema,
      skillKeys: z.array(z.string()),
      instructionsTemplate: z.string().optional(),
    }),
    z.object({
      $ref: z.string().regex(/^@[\w-]+\/[\w-]+@\d+\.\d+\.\d+$/),
      localName: z.string().min(1),
      role: TeamRoleSchema,
    }),
  ])),
  routing: z.object({
    defaultLead: z.string().optional(),
    rules: z.array(z.object({
      match: z.string(),
      mention: z.string(),
    })),
  }),
  skillDeps: z.array(z.string()).optional(),
  pluginDeps: z.array(z.string()).optional(),
  workflowTemplates: z.array(z.object({ $ref: z.string() })).optional(),
  memoryItems: z.array(z.object({
    layer: z.string(),
    title: z.string(),
    body: z.string(),
  })).optional(),
});

export interface CreateTeamInput {
  name: string;
  parentProjectId: string;
  description?: string;
  manifest?: Partial<TeamManifest>;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  manifest?: TeamManifest;
  status?: TeamStatus;
}

export interface AddTeamMemberInput {
  agentId: string;
  role: TeamRole;
}

export interface CreateTeamCoordinationInput {
  teamId: string;
  name: string;
  markdown: string;
  description?: string;
}
