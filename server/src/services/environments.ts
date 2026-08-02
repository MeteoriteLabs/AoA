import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { companies, environmentLeases, environments, executionTargets } from "@armyofagents/db";
import type {
  CreateEnvironmentInput,
  EnvironmentLeaseCleanupStatus,
  EnvironmentLeasePolicy,
  EnvironmentLeaseStatus,
  UpdateEnvironmentInput,
} from "@armyofagents/shared";
import { unprocessable } from "../errors.js";

export type EnvironmentService = ReturnType<typeof environmentService>;

const EXECUTION_TARGET_UNAVAILABLE = "Execution target is unavailable for this company";

/**
 * A company may pin a system/shared target or a target owned by its own
 * Organization. Missing tenant context fails closed.
 */
export function mayCompanyPinExecutionTarget(
  companyOrganizationId: string | null,
  targetOrganizationId: string | null,
): boolean {
  return targetOrganizationId === null || (
    companyOrganizationId !== null && companyOrganizationId === targetOrganizationId
  );
}

export function environmentService(db: Db) {
  async function assertExecutionTargetAvailableToCompany(
    companyId: string,
    executionTargetId: string | null | undefined,
  ): Promise<void> {
    // `null` explicitly clears a pin and `undefined` leaves an update unchanged.
    if (executionTargetId == null) return;

    // Production create/update calls this service with the transaction handle
    // supplied by routes/environments.ts. KEY SHARE keeps both ownership rows
    // stable until the environment FK write commits without blocking unrelated
    // reads or non-key updates.
    const [company] = await db
      .select({ organizationId: companies.organizationId })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for("key share");
    const [target] = await db
      .select({ organizationId: executionTargets.organizationId })
      .from(executionTargets)
      .where(eq(executionTargets.id, executionTargetId))
      .for("key share");

    if (
      !company ||
      !target ||
      !mayCompanyPinExecutionTarget(company.organizationId, target.organizationId)
    ) {
      // Deliberately identical for missing and foreign targets so this mutation
      // cannot be used to enumerate another Organization's fleet inventory.
      throw unprocessable(EXECUTION_TARGET_UNAVAILABLE);
    }
  }

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
      await assertExecutionTargetAvailableToCompany(companyId, input.executionTargetId);
      const [env] = await db
        .insert(environments)
        .values({ companyId, ...input })
        .returning();
      return env ?? null;
    },

    update: async (companyId: string, id: string, input: UpdateEnvironmentInput) => {
      await assertExecutionTargetAvailableToCompany(companyId, input.executionTargetId);
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
