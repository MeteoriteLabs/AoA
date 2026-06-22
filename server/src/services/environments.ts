import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { environmentLeases, environments } from "@armyofagents/db";
import type {
  CreateEnvironmentInput,
  EnvironmentLeaseCleanupStatus,
  EnvironmentLeasePolicy,
  EnvironmentLeaseStatus,
  UpdateEnvironmentInput,
} from "@armyofagents/shared";

export type EnvironmentService = ReturnType<typeof environmentService>;

export function environmentService(db: Db) {
  return {
    list: async (companyId: string) => {
      return db.select().from(environments).where(eq(environments.companyId, companyId));
    },

    get: async (companyId: string, id: string) => {
      const rows = await db
        .select()
        .from(environments)
        .where(and(eq(environments.id, id), eq(environments.companyId, companyId)));
      return rows[0] ?? null;
    },

    create: async (companyId: string, input: CreateEnvironmentInput) => {
      const [env] = await db
        .insert(environments)
        .values({ companyId, ...input })
        .returning();
      return env ?? null;
    },

    update: async (companyId: string, id: string, input: UpdateEnvironmentInput) => {
      const rows = await db
        .update(environments)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(environments.id, id), eq(environments.companyId, companyId)))
        .returning();
      return rows[0] ?? null;
    },

    delete: async (companyId: string, id: string) => {
      const [deleted] = await db
        .delete(environments)
        .where(and(eq(environments.id, id), eq(environments.companyId, companyId)))
        .returning();
      return deleted ?? null;
    },

    acquireLease: async (input: {
      companyId: string;
      environmentId: string;
      executionWorkspaceId?: string | null;
      issueId?: string | null;
      heartbeatRunId?: string | null;
      leasePolicy?: EnvironmentLeasePolicy;
      provider?: string | null;
      providerLeaseId?: string | null;
      expiresAt?: Date | null;
      metadata?: Record<string, unknown> | null;
    }) => {
      const [environment] = await db
        .select()
        .from(environments)
        .where(and(eq(environments.id, input.environmentId), eq(environments.companyId, input.companyId)));
      if (!environment) {
        throw new Error("Environment not found for company");
      }

      const now = new Date();
      const [lease] = await db
        .insert(environmentLeases)
        .values({
          companyId: input.companyId,
          environmentId: input.environmentId,
          executionWorkspaceId: input.executionWorkspaceId ?? null,
          issueId: input.issueId ?? null,
          heartbeatRunId: input.heartbeatRunId ?? null,
          status: "active",
          leasePolicy: input.leasePolicy ?? "ephemeral",
          provider: input.provider ?? null,
          providerLeaseId: input.providerLeaseId ?? null,
          acquiredAt: now,
          lastUsedAt: now,
          expiresAt: input.expiresAt ?? null,
          releasedAt: null,
          failureReason: null,
          cleanupStatus: null,
          metadata: input.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!lease) {
        throw new Error("Failed to acquire environment lease");
      }
      return lease;
    },

    releaseLease: async (
      id: string,
      status: Extract<EnvironmentLeaseStatus, "released" | "expired" | "failed" | "retained"> = "released",
      options?: {
        failureReason?: string;
        cleanupStatus?: EnvironmentLeaseCleanupStatus;
      },
    ) => {
      const now = new Date();
      const [lease] = await db
        .update(environmentLeases)
        .set({
          status,
          releasedAt: status === "retained" ? null : now,
          lastUsedAt: now,
          updatedAt: now,
          ...(options?.failureReason !== undefined ? { failureReason: options.failureReason } : {}),
          ...(options?.cleanupStatus !== undefined ? { cleanupStatus: options.cleanupStatus } : {}),
        })
        .where(eq(environmentLeases.id, id))
        .returning();
      return lease ?? null;
    },

    listActiveLeasesForRun: async (heartbeatRunId: string) => {
      return db
        .select()
        .from(environmentLeases)
        .where(and(eq(environmentLeases.heartbeatRunId, heartbeatRunId), eq(environmentLeases.status, "active")));
    },

    releaseLeasesForRun: async (
      heartbeatRunId: string,
      status: Extract<EnvironmentLeaseStatus, "released" | "expired" | "failed"> = "released",
    ) => {
      const now = new Date();
      const leases = await db
        .update(environmentLeases)
        .set({
          status,
          releasedAt: now,
          lastUsedAt: now,
          updatedAt: now,
        })
        .where(and(eq(environmentLeases.heartbeatRunId, heartbeatRunId), eq(environmentLeases.status, "active")))
        .returning();
      return leases;
    },
  };
}
