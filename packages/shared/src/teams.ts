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

export const TeamManifestSchema = z
  .object({
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
  })
  .superRefine((data, ctx) => {
    // Validate regex compilability for routing rules at the schema layer
    // (D2): both the route-level `validate(TeamManifestSchema)` middleware
    // and the service-level `validateManifest` now catch bad-regex rules
    // at the same point — single source of truth.
    for (let i = 0; i < data.routing.rules.length; i++) {
      const rule = data.routing.rules[i];
      try {
        new RegExp(rule.match);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["routing", "rules", i, "match"],
          message: `invalid regex: ${(err as Error).message}`,
        });
      }
    }
  });

export interface CreateTeamInput {
  name: string;
  parentProjectId: string;
  description?: string;
  manifest?: Partial<TeamManifest>;
  // P1: optional inline members. When provided, the team-create + member
  // inserts run in a single transaction so a partial-failure cannot leave an
  // orphan team with missing members. When omitted, behavior matches the
  // pre-P1 single-row insert.
  members?: Array<{ agentId: string; role: TeamRole }>;
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
  // C4: nullable so the upsert path can clear an existing description.
  // Mirrors the upsertCoordinationSchema relaxation below.
  description?: string | null;
}

// HTTP route validation schemas. Names use the prefix `teamsMember*` (plural)
// to disambiguate from `addTeamMemberSchema` / `updateTeamMemberRoleSchema`
// which already exist in packages/shared/src/validators/team.ts for the
// user/board permissions domain. Slice 1 / Task 1.10.
export const createTeamSchema = z.object({
  name: z.string().min(1).max(128),
  parentProjectId: z.string().uuid(),
  description: z.string().optional(),
  // P1: optional inline members for atomic create. The server validates
  // dept-membership + lead-uniqueness pre-transaction so partial failures
  // produce clean error messages instead of rollback artifacts.
  members: z
    .array(
      z.object({
        agentId: z.string().uuid(),
        role: TeamRoleSchema,
      }),
    )
    .optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  status: TeamStatusSchema.optional(),
});

export const addTeamsMemberSchema = z.object({
  agentId: z.string().uuid(),
  role: TeamRoleSchema,
});

export const updateTeamsMemberRoleSchema = z.object({
  role: TeamRoleSchema,
});

export const upsertCoordinationSchema = z.object({
  name: z.string().min(1).max(256),
  markdown: z.string(),
  // C4: accept null so founders can clear an existing description. The DB
  // column is `text` nullable, and `team-coordination.upsert` passes
  // `description` straight through to `set` / `values` — null persists as
  // NULL. Without `.nullable()`, `description: null` 400s at the route
  // validator before the handler runs.
  description: z.string().nullable().optional(),
});
