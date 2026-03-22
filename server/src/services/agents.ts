import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  agentConfigRevisions,
  agentApiKeys,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  heartbeatRunEvents,
  heartbeatRuns,
  authUsers,
  companyMemberships,
  userRoles,
  projects,
} from "@paperclipai/db";
import { isUuidLike, normalizeAgentUrlKey } from "@paperclipai/shared";
import type { UnifiedOrgNode } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { normalizeAgentPermissions } from "./agent-permissions.js";
import { deduplicateAgentName, hasAgentShortnameCollision } from "./agent-shortnames.js";
import { REDACTED_EVENT_VALUE, sanitizeRecord } from "../redaction.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createToken() {
  return `pcp_${randomBytes(24).toString("hex")}`;
}

const CONFIG_REVISION_FIELDS = [
  "name",
  "role",
  "title",
  "reportsTo",
  "capabilities",
  "adapterType",
  "adapterConfig",
  "runtimeConfig",
  "budgetMonthlyCents",
  "metadata",
] as const;

type ConfigRevisionField = (typeof CONFIG_REVISION_FIELDS)[number];
type AgentConfigSnapshot = Pick<typeof agents.$inferSelect, ConfigRevisionField>;

interface RevisionMetadata {
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  source?: string;
  rolledBackFromRevisionId?: string | null;
}

interface UpdateAgentOptions {
  recordRevision?: RevisionMetadata;
}

interface AgentShortnameCollisionOptions {
  excludeAgentId?: string | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildConfigSnapshot(
  row: Pick<typeof agents.$inferSelect, ConfigRevisionField>,
): AgentConfigSnapshot {
  const adapterConfig =
    typeof row.adapterConfig === "object" && row.adapterConfig !== null && !Array.isArray(row.adapterConfig)
      ? sanitizeRecord(row.adapterConfig as Record<string, unknown>)
      : {};
  const runtimeConfig =
    typeof row.runtimeConfig === "object" && row.runtimeConfig !== null && !Array.isArray(row.runtimeConfig)
      ? sanitizeRecord(row.runtimeConfig as Record<string, unknown>)
      : {};
  const metadata =
    typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
      ? sanitizeRecord(row.metadata as Record<string, unknown>)
      : row.metadata ?? null;
  return {
    name: row.name,
    role: row.role,
    title: row.title,
    reportsTo: row.reportsTo,
    capabilities: row.capabilities,
    adapterType: row.adapterType,
    adapterConfig,
    runtimeConfig,
    budgetMonthlyCents: row.budgetMonthlyCents,
    metadata,
  };
}

function containsRedactedMarker(value: unknown): boolean {
  if (value === REDACTED_EVENT_VALUE) return true;
  if (Array.isArray(value)) return value.some((item) => containsRedactedMarker(item));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).some((entry) => containsRedactedMarker(entry));
}

function hasConfigPatchFields(data: Partial<typeof agents.$inferInsert>) {
  return CONFIG_REVISION_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field));
}

function diffConfigSnapshot(
  before: AgentConfigSnapshot,
  after: AgentConfigSnapshot,
): string[] {
  return CONFIG_REVISION_FIELDS.filter((field) => !jsonEqual(before[field], after[field]));
}

function configPatchFromSnapshot(snapshot: unknown): Partial<typeof agents.$inferInsert> {
  if (!isPlainRecord(snapshot)) throw unprocessable("Invalid revision snapshot");

  if (typeof snapshot.name !== "string" || snapshot.name.length === 0) {
    throw unprocessable("Invalid revision snapshot: name");
  }
  if (typeof snapshot.role !== "string" || snapshot.role.length === 0) {
    throw unprocessable("Invalid revision snapshot: role");
  }
  if (typeof snapshot.adapterType !== "string" || snapshot.adapterType.length === 0) {
    throw unprocessable("Invalid revision snapshot: adapterType");
  }
  if (typeof snapshot.budgetMonthlyCents !== "number" || !Number.isFinite(snapshot.budgetMonthlyCents)) {
    throw unprocessable("Invalid revision snapshot: budgetMonthlyCents");
  }

  return {
    name: snapshot.name,
    role: snapshot.role,
    title: typeof snapshot.title === "string" || snapshot.title === null ? snapshot.title : null,
    reportsTo:
      typeof snapshot.reportsTo === "string" || snapshot.reportsTo === null ? snapshot.reportsTo : null,
    capabilities:
      typeof snapshot.capabilities === "string" || snapshot.capabilities === null
        ? snapshot.capabilities
        : null,
    adapterType: snapshot.adapterType,
    adapterConfig: isPlainRecord(snapshot.adapterConfig) ? snapshot.adapterConfig : {},
    runtimeConfig: isPlainRecord(snapshot.runtimeConfig) ? snapshot.runtimeConfig : {},
    budgetMonthlyCents: Math.max(0, Math.floor(snapshot.budgetMonthlyCents)),
    metadata: isPlainRecord(snapshot.metadata) || snapshot.metadata === null ? snapshot.metadata : null,
  };
}

export { deduplicateAgentName, hasAgentShortnameCollision } from "./agent-shortnames.js";

const USER_ROLE_PRIORITY: Record<string, number> = { founder: 3, team_lead: 2, team_member: 1 };

function isValidParentType(value: unknown): value is "agent" | "user" {
  return value === "agent" || value === "user";
}

export function agentService(db: Db) {
  function withUrlKey<T extends { id: string; name: string }>(row: T) {
    return {
      ...row,
      urlKey: normalizeAgentUrlKey(row.name) ?? row.id,
    };
  }

  function normalizeAgentRow(row: typeof agents.$inferSelect) {
    return withUrlKey({
      ...row,
      permissions: normalizeAgentPermissions(row.permissions, row.role),
    });
  }

  async function getById(id: string) {
    const row = await db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .then((rows) => rows[0] ?? null);
    return row ? normalizeAgentRow(row) : null;
  }

  async function ensureManager(companyId: string, managerId: string) {
    const manager = await getById(managerId);
    if (!manager) throw notFound("Manager not found");
    if (manager.companyId !== companyId) {
      throw unprocessable("Manager must belong to same company");
    }
    return manager;
  }

  async function assertNoCycle(agentId: string, reportsTo: string | null | undefined) {
    if (!reportsTo) return;
    if (reportsTo === agentId) throw unprocessable("Agent cannot report to itself");

    let cursor: string | null = reportsTo;
    while (cursor) {
      if (cursor === agentId) throw unprocessable("Reporting relationship would create cycle");
      const next = await getById(cursor);
      cursor = next?.reportsTo ?? null;
    }
  }

  async function assertCompanyShortnameAvailable(
    companyId: string,
    candidateName: string,
    options?: AgentShortnameCollisionOptions,
  ) {
    const candidateShortname = normalizeAgentUrlKey(candidateName);
    if (!candidateShortname) return;

    const existingAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
      })
      .from(agents)
      .where(eq(agents.companyId, companyId));

    const hasCollision = hasAgentShortnameCollision(candidateName, existingAgents, options);
    if (hasCollision) {
      throw conflict(
        `Agent shortname '${candidateShortname}' is already in use in this company`,
      );
    }
  }

  async function updateAgent(
    id: string,
    data: Partial<typeof agents.$inferInsert>,
    options?: UpdateAgentOptions,
  ) {
    const existing = await getById(id);
    if (!existing) return null;

    if (existing.status === "terminated" && data.status && data.status !== "terminated") {
      throw conflict("Terminated agents cannot be resumed");
    }
    if (
      existing.status === "pending_approval" &&
      data.status &&
      data.status !== "pending_approval" &&
      data.status !== "terminated"
    ) {
      throw conflict("Pending approval agents cannot be activated directly");
    }

    if (data.reportsTo !== undefined) {
      if (data.reportsTo) {
        await ensureManager(existing.companyId, data.reportsTo);
      }
      await assertNoCycle(id, data.reportsTo);
    }

    if (data.name !== undefined) {
      const previousShortname = normalizeAgentUrlKey(existing.name);
      const nextShortname = normalizeAgentUrlKey(data.name);
      if (previousShortname !== nextShortname) {
        await assertCompanyShortnameAvailable(existing.companyId, data.name, { excludeAgentId: id });
      }
    }

    const normalizedPatch = { ...data } as Partial<typeof agents.$inferInsert>;
    if (data.permissions !== undefined) {
      const role = (data.role ?? existing.role) as string;
      normalizedPatch.permissions = normalizeAgentPermissions(data.permissions, role);
    }

    const shouldRecordRevision = Boolean(options?.recordRevision) && hasConfigPatchFields(normalizedPatch);
    const beforeConfig = shouldRecordRevision ? buildConfigSnapshot(existing) : null;

    const updated = await db
      .update(agents)
      .set({ ...normalizedPatch, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning()
      .then((rows) => rows[0] ?? null);
    const normalizedUpdated = updated ? normalizeAgentRow(updated) : null;

    if (normalizedUpdated && shouldRecordRevision && beforeConfig) {
      const afterConfig = buildConfigSnapshot(normalizedUpdated);
      const changedKeys = diffConfigSnapshot(beforeConfig, afterConfig);
      if (changedKeys.length > 0) {
        await db.insert(agentConfigRevisions).values({
          companyId: normalizedUpdated.companyId,
          agentId: normalizedUpdated.id,
          createdByAgentId: options?.recordRevision?.createdByAgentId ?? null,
          createdByUserId: options?.recordRevision?.createdByUserId ?? null,
          source: options?.recordRevision?.source ?? "patch",
          rolledBackFromRevisionId: options?.recordRevision?.rolledBackFromRevisionId ?? null,
          changedKeys,
          beforeConfig: beforeConfig as unknown as Record<string, unknown>,
          afterConfig: afterConfig as unknown as Record<string, unknown>,
        });
      }
    }

    return normalizedUpdated;
  }

  return {
    list: async (companyId: string, options?: { includeTerminated?: boolean }) => {
      const conditions = [eq(agents.companyId, companyId)];
      if (!options?.includeTerminated) {
        conditions.push(ne(agents.status, "terminated"));
      }
      const rows = await db.select().from(agents).where(and(...conditions));
      return rows.map(normalizeAgentRow);
    },

    getById,

    create: async (companyId: string, data: Omit<typeof agents.$inferInsert, "companyId">) => {
      if (data.reportsTo) {
        await ensureManager(companyId, data.reportsTo);
      }

      await assertCompanyShortnameAvailable(companyId, data.name);

      const role = data.role ?? "general";
      const normalizedPermissions = normalizeAgentPermissions(data.permissions, role);
      const created = await db
        .insert(agents)
        .values({ ...data, companyId, role, permissions: normalizedPermissions })
        .returning()
        .then((rows) => rows[0]);

      return normalizeAgentRow(created);
    },

    update: updateAgent,

    pause: async (id: string) => {
      const existing = await getById(id);
      if (!existing) return null;
      if (existing.status === "terminated") throw conflict("Cannot pause terminated agent");

      const updated = await db
        .update(agents)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(agents.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return updated ? normalizeAgentRow(updated) : null;
    },

    resume: async (id: string) => {
      const existing = await getById(id);
      if (!existing) return null;
      if (existing.status === "terminated") throw conflict("Cannot resume terminated agent");
      if (existing.status === "pending_approval") {
        throw conflict("Pending approval agents cannot be resumed");
      }

      const updated = await db
        .update(agents)
        .set({ status: "idle", updatedAt: new Date() })
        .where(eq(agents.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return updated ? normalizeAgentRow(updated) : null;
    },

    terminate: async (id: string) => {
      const existing = await getById(id);
      if (!existing) return null;

      await db
        .update(agents)
        .set({ status: "terminated", updatedAt: new Date() })
        .where(eq(agents.id, id));

      await db
        .update(agentApiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(agentApiKeys.agentId, id));

      return getById(id);
    },

    remove: async (id: string) => {
      const existing = await getById(id);
      if (!existing) return null;

      return db.transaction(async (tx) => {
        await tx.update(agents).set({ reportsTo: null }).where(eq(agents.reportsTo, id));
        await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.agentId, id));
        await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.agentId, id));
        await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.agentId, id));
        await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, id));
        await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, id));
        await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.agentId, id));
        const deleted = await tx
          .delete(agents)
          .where(eq(agents.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        return deleted ? normalizeAgentRow(deleted) : null;
      });
    },

    activatePendingApproval: async (id: string) => {
      const existing = await getById(id);
      if (!existing) return null;
      if (existing.status !== "pending_approval") return existing;

      const updated = await db
        .update(agents)
        .set({ status: "idle", updatedAt: new Date() })
        .where(eq(agents.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);

      return updated ? normalizeAgentRow(updated) : null;
    },

    updatePermissions: async (id: string, permissions: { canCreateAgents: boolean }) => {
      const existing = await getById(id);
      if (!existing) return null;

      const updated = await db
        .update(agents)
        .set({
          permissions: normalizeAgentPermissions(permissions, existing.role),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);

      return updated ? normalizeAgentRow(updated) : null;
    },

    listConfigRevisions: async (id: string) =>
      db
        .select()
        .from(agentConfigRevisions)
        .where(eq(agentConfigRevisions.agentId, id))
        .orderBy(desc(agentConfigRevisions.createdAt)),

    getConfigRevision: async (id: string, revisionId: string) =>
      db
        .select()
        .from(agentConfigRevisions)
        .where(and(eq(agentConfigRevisions.agentId, id), eq(agentConfigRevisions.id, revisionId)))
        .then((rows) => rows[0] ?? null),

    rollbackConfigRevision: async (
      id: string,
      revisionId: string,
      actor: { agentId?: string | null; userId?: string | null },
    ) => {
      const revision = await db
        .select()
        .from(agentConfigRevisions)
        .where(and(eq(agentConfigRevisions.agentId, id), eq(agentConfigRevisions.id, revisionId)))
        .then((rows) => rows[0] ?? null);
      if (!revision) return null;
      if (containsRedactedMarker(revision.afterConfig)) {
        throw unprocessable("Cannot roll back a revision that contains redacted secret values");
      }

      const patch = configPatchFromSnapshot(revision.afterConfig);
      return updateAgent(id, patch, {
        recordRevision: {
          createdByAgentId: actor.agentId ?? null,
          createdByUserId: actor.userId ?? null,
          source: "rollback",
          rolledBackFromRevisionId: revision.id,
        },
      });
    },

    createApiKey: async (id: string, name: string) => {
      const existing = await getById(id);
      if (!existing) throw notFound("Agent not found");
      if (existing.status === "pending_approval") {
        throw conflict("Cannot create keys for pending approval agents");
      }
      if (existing.status === "terminated") {
        throw conflict("Cannot create keys for terminated agents");
      }

      const token = createToken();
      const keyHash = hashToken(token);
      const created = await db
        .insert(agentApiKeys)
        .values({
          agentId: id,
          companyId: existing.companyId,
          name,
          keyHash,
        })
        .returning()
        .then((rows) => rows[0]);

      return {
        id: created.id,
        name: created.name,
        token,
        createdAt: created.createdAt,
      };
    },

    listKeys: (id: string) =>
      db
        .select({
          id: agentApiKeys.id,
          name: agentApiKeys.name,
          createdAt: agentApiKeys.createdAt,
          revokedAt: agentApiKeys.revokedAt,
        })
        .from(agentApiKeys)
        .where(eq(agentApiKeys.agentId, id)),

    revokeKey: async (keyId: string) => {
      const rows = await db
        .update(agentApiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(agentApiKeys.id, keyId))
        .returning();
      return rows[0] ?? null;
    },

    orgForCompany: async (companyId: string): Promise<UnifiedOrgNode[]> => {
      // Two parallel queries: agents + users
      const [agentRows, userRows] = await Promise.all([
        db
          .select()
          .from(agents)
          .where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated"))),
        db
          .select({
            userId: companyMemberships.principalId,
            email: authUsers.email,
            displayName: authUsers.displayName,
            avatarUrl: authUsers.avatarUrl,
            name: authUsers.name,
            parentType: companyMemberships.parentType,
            parentId: companyMemberships.parentId,
            role: userRoles.role,
            departmentId: userRoles.projectId,
            departmentName: projects.name,
          })
          .from(companyMemberships)
          .innerJoin(authUsers, eq(companyMemberships.principalId, authUsers.id))
          .leftJoin(
            userRoles,
            and(eq(userRoles.companyId, companyId), eq(userRoles.userId, companyMemberships.principalId)),
          )
          .leftJoin(projects, eq(userRoles.projectId, projects.id))
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.status, "active"),
            ),
          ),
      ]);

      // Deduplicate users by highest role (a user may have multiple user_roles rows)
      const userMap = new Map<
        string,
        {
          userId: string;
          email: string;
          displayName: string | null;
          avatarUrl: string | null;
          name: string;
          parentType: string | null;
          parentId: string | null;
          role: string | null;
          departmentId: string | null;
          departmentName: string | null;
        }
      >();
      for (const row of userRows) {
        const existing = userMap.get(row.userId);
        if (!existing || (USER_ROLE_PRIORITY[row.role ?? ""] ?? 0) > (USER_ROLE_PRIORITY[existing.role ?? ""] ?? 0)) {
          userMap.set(row.userId, row);
        }
      }

      // Build a parentKey → children map for the unified tree
      // Key format: "agent:<id>" or "user:<id>" or "root" for nodes without a parent
      type NodeEntry = { node: UnifiedOrgNode; parentKey: string };
      const entries: NodeEntry[] = [];
      const nodeById = new Map<string, UnifiedOrgNode>();

      // Convert agents to unified nodes
      for (const row of agentRows) {
        // Determine parent: prefer parentType/parentId, fallback to reportsTo
        let parentKey = "root";
        if (row.parentType && row.parentId) {
          parentKey = `${row.parentType}:${row.parentId}`;
        } else if (row.reportsTo) {
          parentKey = `agent:${row.reportsTo}`;
        }

        const node: UnifiedOrgNode = {
          id: row.id,
          name: row.name,
          role: row.role,
          status: row.status,
          nodeType: "agent",
          adapterType: row.adapterType,
          icon: row.icon ?? undefined,
          children: [],
        };
        entries.push({ node, parentKey });
        nodeById.set(`agent:${row.id}`, node);
      }

      // Convert users to unified nodes
      for (const [userId, row] of userMap) {
        let parentKey = "root";
        if (row.parentType && row.parentId) {
          parentKey = `${row.parentType}:${row.parentId}`;
        }

        const node: UnifiedOrgNode = {
          id: userId,
          name: row.displayName ?? row.name,
          role: row.role ?? "team_member",
          status: "active",
          nodeType: "user",
          email: row.email,
          userRole: (row.role as UnifiedOrgNode["userRole"]) ?? "team_member",
          departmentName: row.departmentName ?? undefined,
          avatarUrl: row.avatarUrl ?? undefined,
          children: [],
        };
        entries.push({ node, parentKey });
        nodeById.set(`user:${userId}`, node);
      }

      // Assemble tree: attach children to parents
      const roots: UnifiedOrgNode[] = [];
      for (const { node, parentKey } of entries) {
        if (parentKey === "root") {
          roots.push(node);
        } else {
          const parent = nodeById.get(parentKey);
          if (parent) {
            parent.children.push(node);
          } else {
            // Parent not found (terminated/missing) → promote to root
            roots.push(node);
          }
        }
      }

      return roots;
    },

    getChainOfCommand: async (agentId: string, companyId?: string) => {
      const chain: { id: string; name: string; role: string; title: string | null; nodeType: "agent" | "user" }[] =
        [];
      const visited = new Set<string>([`agent:${agentId}`]);
      const start = await getById(agentId);
      if (!start) return chain;

      // Determine first parent: prefer parentType/parentId, fallback to reportsTo
      const startParentType = start.parentType === "agent" || start.parentType === "user" ? start.parentType : null;
      let currentType: "agent" | "user" = startParentType ?? "agent";
      let currentId: string | null = start.parentId ?? start.reportsTo ?? null;

      while (currentId && chain.length < 50) {
        const visitKey = `${currentType}:${currentId}`;
        if (visited.has(visitKey)) break;
        visited.add(visitKey);

        if (currentType === "agent") {
          const mgr = await getById(currentId);
          if (!mgr) break;
          chain.push({ id: mgr.id, name: mgr.name, role: mgr.role, title: mgr.title ?? null, nodeType: "agent" });
          // Walk up: prefer parentType/parentId, fallback to reportsTo
          if (isValidParentType(mgr.parentType) && mgr.parentId) {
            currentType = mgr.parentType;
            currentId = mgr.parentId;
          } else {
            currentType = "agent";
            currentId = mgr.reportsTo ?? null;
          }
        } else {
          // User node — look up via company_memberships
          if (!companyId) break;
          const rows = await db
            .select({
              principalId: companyMemberships.principalId,
              parentType: companyMemberships.parentType,
              parentId: companyMemberships.parentId,
              displayName: authUsers.displayName,
              name: authUsers.name,
            })
            .from(companyMemberships)
            .innerJoin(authUsers, eq(companyMemberships.principalId, authUsers.id))
            .where(
              and(
                eq(companyMemberships.companyId, companyId),
                eq(companyMemberships.principalType, "user"),
                eq(companyMemberships.principalId, currentId),
                eq(companyMemberships.status, "active"),
              ),
            )
            .limit(1);
          const user = rows[0];
          if (!user) break;

          // Get user's highest role for display
          const roleRows = await db
            .select({ role: userRoles.role })
            .from(userRoles)
            .where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, currentId)));
          let bestRole = "team_member";
          for (const r of roleRows) {
            if ((USER_ROLE_PRIORITY[r.role] ?? 0) > (USER_ROLE_PRIORITY[bestRole] ?? 0)) bestRole = r.role;
          }

          chain.push({
            id: user.principalId,
            name: user.displayName ?? user.name,
            role: bestRole,
            title: null,
            nodeType: "user",
          });

          // Walk up
          if (isValidParentType(user.parentType) && user.parentId) {
            currentType = user.parentType;
            currentId = user.parentId;
          } else {
            currentId = null;
          }
        }
      }
      return chain;
    },

    runningForAgent: (agentId: string) =>
      db
        .select()
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, ["queued", "running"]))),

    resolveByReference: async (companyId: string, reference: string) => {
      const raw = reference.trim();
      if (raw.length === 0) {
        return { agent: null, ambiguous: false } as const;
      }

      if (isUuidLike(raw)) {
        const byId = await getById(raw);
        if (!byId || byId.companyId !== companyId) {
          return { agent: null, ambiguous: false } as const;
        }
        return { agent: byId, ambiguous: false } as const;
      }

      const urlKey = normalizeAgentUrlKey(raw);
      if (!urlKey) {
        return { agent: null, ambiguous: false } as const;
      }

      const rows = await db.select().from(agents).where(eq(agents.companyId, companyId));
      const matches = rows
        .map(normalizeAgentRow)
        .filter((agent) => agent.urlKey === urlKey && agent.status !== "terminated");
      if (matches.length === 1) {
        return { agent: matches[0] ?? null, ambiguous: false } as const;
      }
      if (matches.length > 1) {
        return { agent: null, ambiguous: true } as const;
      }
      return { agent: null, ambiguous: false } as const;
    },
  };
}
