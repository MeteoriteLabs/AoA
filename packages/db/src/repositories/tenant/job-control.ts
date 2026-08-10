import { and, asc, count, desc, eq, exists, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../../client.js";
import {
  agents,
  companies,
  companyMemberships,
  heartbeatRuns,
  internalAgentConversations,
  internalAgentMessages,
  internalAgentRuns,
  issues,
  jobAttempts,
  jobOutbox,
  jobs,
  leases,
  mcpApiKeys,
  organizationMemberships,
  organizations,
  executionTargets,
  workers,
  services,
  type Job,
  type JobAttempt,
  type JobOutbox,
  type NewJob,
  type NewJobAttempt,
  type NewJobOutbox,
  type Lease,
} from "../../schema/index.js";

export interface TenantAdmissionRecord {
  organizationExists: boolean;
  companyInOrganization: boolean;
  principalAuthorized: boolean;
  requester: { kind: SourceRequesterKind; id: string } | null;
}

export type SourceRequesterKind =
  | "founder"
  | "team_lead"
  | "team_member"
  | "agent"
  | "commander"
  | "system";

export type SourceExecutorKind =
  | "worker"
  | "sandbox"
  | "browser_worker"
  | "service_instance";

export interface SourceExecutorAuthority {
  kind: SourceExecutorKind;
  id: string;
}

export interface JobControlRepository {
  admission(input: {
    organizationId: string;
    companyId: string;
    principalKind: string;
    principalId: string;
    principalRole?: string;
  }): Promise<TenantAdmissionRecord>;
  taskSourceIsAdmitted(input: {
    companyId: string;
    runId: string;
    issueId: string;
    assigneeAgentId: string;
  }): Promise<SourceExecutorAuthority | null>;
  internalRunSourceIsAdmitted(input: {
    companyId: string;
    runId: string;
    requesterKind: SourceRequesterKind;
    requesterId: string;
    triggerSource: "crew_dispatch" | "browser_request";
  }): Promise<SourceExecutorAuthority | null>;
  commanderSourceIsAdmitted(input: {
    companyId: string;
    runId: string;
    conversationId: string;
    userId: string;
  }): Promise<SourceExecutorAuthority | null>;
  serviceSourceIsAdmitted(input: {
    organizationId: string;
    companyId: string;
    serviceId: string;
    generation: number;
  }): Promise<SourceExecutorAuthority | null>;
  insertJobOnce(values: NewJob): Promise<Job | null>;
  findSubmission(input: {
    organizationId: string;
    companyId: string;
    authenticatedPrincipalKind: string;
    authenticatedPrincipalId: string;
    authenticatedSourceKind: string;
    authenticatedSourceIdentity: string;
    idempotencyKey: string;
  }): Promise<Job | null>;
  insertAttempt(values: NewJobAttempt): Promise<JobAttempt>;
  findInitialAttempt(jobId: string): Promise<JobAttempt | null>;
  insertOutbox(values: NewJobOutbox): Promise<JobOutbox>;
  lockPlacementContext(input: {
    organizationId: string;
    companyId: string;
    jobId: string;
    attemptId: string;
  }): Promise<{ job: Job; attempt: JobAttempt } | null>;
  listPlacementCandidateSnapshots(): Promise<PlacementCandidateSnapshot[]>;
  persistPlacementDecision(input: PlacementDecisionWrite): Promise<JobAttempt | null>;
  lockWorkerLeaseAuthority(input: {
    workerId: string;
    targetId: string;
  }): Promise<LeaseWorkerAuthority | null>;
  lockEligibleLeaseCandidates(input: {
    targetId: string;
    limit?: number;
  }): Promise<LeaseCandidate[]>;
  countLiveWorkerLeases(input: { workerId: string; targetId: string }): Promise<number>;
  currentDatabaseTime(): Promise<Date>;
  offerLease(input: {
    attemptId: string;
    organizationId: string;
    companyId: string;
    jobId: string;
    attemptNumber: number;
    workerId: string;
    targetId: string;
    targetAuthorityKey: string;
    targetGeneration: number;
    profileHash: string;
    providerConstraintHash: string;
    fence: string;
    ackDeadline: Date;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<Lease | null>;
  claimReadyOutbox(input: {
    claimToken: string;
    now: Date;
    staleBefore: Date;
    limit?: number;
  }): Promise<Array<{ id: string; organizationId: string; attemptId: string }>>;
  deliverReadyOutbox(input: { claimToken: string; ids: string[]; now: Date }): Promise<number>;
}

export interface LeaseWorkerAuthority {
  worker: {
    id: string;
    scope: string;
    organizationId: string | null;
    ownerUserId: string | null;
    executionTargetId: string;
    targetAuthorityKey: string;
    devicePublicKey: string | null;
    deviceThumbprint: string | null;
    deviceGeneration: number;
    profileHash: string | null;
    profileSnapshot: Record<string, unknown> | null;
    status: string;
    revokedAt: Date | null;
    lastSeenAt: Date | null;
  };
  target: PlacementCandidateSnapshot["target"];
  ownerMembershipActive: boolean;
}

export interface LeaseCandidate {
  job: Job;
  attempt: JobAttempt;
}

export interface PlacementCandidateSnapshot {
  target: {
    id: string;
    slug: string;
    kind: string;
    trustClass: string;
    status: string;
    organizationId: string | null;
    ownerUserId: string | null;
    scope: string;
    targetAuthorityKey: string;
    deviceGeneration: number;
    registeredProfile: Record<string, unknown> | null;
    registeredProfileHash: string | null;
    providerConstraintProfile: Record<string, unknown> | null;
    capabilities: Record<string, unknown>;
    lastSeenAt: Date | null;
  };
  worker: {
    id: string;
    scope: string;
    organizationId: string | null;
    ownerUserId: string | null;
    executionTargetId: string;
    targetAuthorityKey: string;
    deviceGeneration: number;
    profileHash: string | null;
    profileSnapshot: Record<string, unknown> | null;
    lastSeenAt: Date | null;
    status: string;
  };
  ownerMembershipActive: boolean;
}

export interface PlacementDecisionWrite {
  organizationId: string;
  companyId: string;
  jobId: string;
  attemptId: string;
  placementDisposition: string;
  placementOwner: string | null;
  placementTargetId: string | null;
  placementTargetClass: string | null;
  placementTargetScope: string | null;
  placementTargetGeneration: number | null;
  placementProfileHash: string | null;
  placementProviderConstraintHash: string | null;
  placementFallbackDisposition: string;
  placementReasonCode: string;
  placementMode: string;
  placementLeaseEligible: boolean;
  placementOwnerPrincipalId: string | null;
  placementInputDigest: string;
  placementPolicyDigest: string;
  placementDecidedAt: Date;
}

const placementTargetColumns = {
  id: executionTargets.id,
  slug: executionTargets.slug,
  kind: executionTargets.kind,
  trustClass: executionTargets.trustClass,
  status: executionTargets.status,
  organizationId: executionTargets.organizationId,
  ownerUserId: executionTargets.ownerUserId,
  scope: executionTargets.scope,
  targetAuthorityKey: executionTargets.targetAuthorityKey,
  deviceGeneration: executionTargets.deviceGeneration,
  registeredProfile: executionTargets.registeredProfile,
  registeredProfileHash: executionTargets.registeredProfileHash,
  providerConstraintProfile: executionTargets.providerConstraintProfile,
  capabilities: executionTargets.capabilities,
  lastSeenAt: executionTargets.lastSeenAt,
};

const placementWorkerColumns = {
  id: workers.id,
  scope: workers.scope,
  organizationId: workers.organizationId,
  ownerUserId: workers.ownerUserId,
  executionTargetId: workers.executionTargetId,
  targetAuthorityKey: workers.targetAuthorityKey,
  deviceGeneration: workers.deviceGeneration,
  profileHash: workers.profileHash,
  profileSnapshot: workers.profileSnapshot,
  lastSeenAt: workers.lastSeenAt,
  status: workers.status,
};

export function createJobControlRepository(tx: Db): JobControlRepository {
  function requesterKindForOrganizationRole(role: string): SourceRequesterKind | null {
    if (role === "owner") return "founder";
    if (role === "admin") return "team_lead";
    if (role === "member") return "team_member";
    return null;
  }

  async function admittedUserRequester(input: {
    organizationId: string;
    companyId: string;
    userId: string;
  }): Promise<{ kind: SourceRequesterKind; id: string } | null> {
    const [orgMembership] = await tx
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, input.organizationId),
        eq(organizationMemberships.userId, input.userId),
        eq(organizationMemberships.status, "active"),
      ))
      .limit(1);
    const [companyMembership] = await tx
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.companyId, input.companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, input.userId),
        eq(companyMemberships.status, "active"),
      ))
      .limit(1);
    const kind = orgMembership ? requesterKindForOrganizationRole(orgMembership.role) : null;
    return companyMembership && kind ? { kind, id: input.userId } : null;
  }

  return {
    async admission(input) {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(and(
          eq(companies.id, input.companyId),
          eq(companies.organizationId, input.organizationId),
        ))
        .limit(1);

      let requester: { kind: SourceRequesterKind; id: string } | null = null;
      if (input.principalKind === "user") {
        requester = await admittedUserRequester({
          organizationId: input.organizationId,
          companyId: input.companyId,
          userId: input.principalId,
        });
      } else if (input.principalKind === "agent") {
        const [agent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, input.principalId), eq(agents.companyId, input.companyId)))
          .limit(1);
        requester = agent ? { kind: "agent", id: input.principalId } : null;
      } else if (input.principalKind === "mcp") {
        const [key] = await tx
          .select({ id: mcpApiKeys.id, userId: mcpApiKeys.userId })
          .from(mcpApiKeys)
          .where(and(
            eq(mcpApiKeys.id, input.principalId),
            eq(mcpApiKeys.companyId, input.companyId),
            isNull(mcpApiKeys.revokedAt),
          ))
          .limit(1);
        requester = key
          ? await admittedUserRequester({
              organizationId: input.organizationId,
              companyId: input.companyId,
              userId: key.userId,
            })
          : null;
      } else if (input.principalKind === "commander") {
        // These actors are authenticated by a company-bound run JWT or the
        // explicitly enabled local loopback identity. Re-check the admitted
        // Organization→Company edge in this transaction; neither actor has a
        // durable membership/key row of its own.
        requester = company && ["founder", "team_lead", "team_member"].includes(input.principalRole ?? "")
          ? { kind: "commander", id: input.principalId }
          : null;
      } else if (input.principalKind === "local_board") {
        requester = company ? { kind: "founder", id: input.principalId } : null;
      } else if (input.principalKind === "system") {
        requester = company ? { kind: "system", id: input.principalId } : null;
      }

      return {
        organizationExists: Boolean(organization),
        companyInOrganization: Boolean(company),
        principalAuthorized: Boolean(requester),
        requester,
      };
    },

    async taskSourceIsAdmitted(input) {
      const [row] = await tx
        .select({ agentId: heartbeatRuns.agentId })
        .from(heartbeatRuns)
        .innerJoin(
          issues,
          and(
            eq(issues.id, input.issueId),
            eq(issues.companyId, input.companyId),
            eq(issues.assigneeAgentId, input.assigneeAgentId),
            eq(issues.checkoutRunId, input.runId),
            eq(issues.executionRunId, input.runId),
          ),
        )
        .innerJoin(
          agents,
          and(eq(agents.id, input.assigneeAgentId), eq(agents.companyId, input.companyId)),
        )
        .where(and(
          eq(heartbeatRuns.id, input.runId),
          eq(heartbeatRuns.companyId, input.companyId),
          eq(heartbeatRuns.agentId, input.assigneeAgentId),
        ))
        .limit(1);
      // The admitted legacy heartbeat engine supplies the domain worker role;
      // JOB-009 may later place that work, but no concrete worker is chosen here.
      return row ? { kind: "worker", id: row.agentId } : null;
    },

    async internalRunSourceIsAdmitted(input) {
      const ownership = input.requesterKind === "agent"
        ? eq(internalAgentRuns.agentId, input.requesterId)
        : eq(internalAgentRuns.userId, input.requesterId);
      const [row] = await tx
        .select({ id: internalAgentRuns.id, agentId: internalAgentRuns.agentId })
        .from(internalAgentRuns)
        .where(and(
          eq(internalAgentRuns.id, input.runId),
          eq(internalAgentRuns.companyId, input.companyId),
          eq(internalAgentRuns.triggerSource, input.triggerSource),
          ownership,
        ))
        .limit(1);
      if (!row) return null;
      if (input.triggerSource === "browser_request") {
        return { kind: "browser_worker", id: row.id };
      }
      // Crew's admitted source engine is worker-class. Its bound agent is the
      // opaque executor identity when present; the run remains the fallback for
      // a user-owned crew source without an assigned agent. This is not placement.
      return { kind: "worker", id: row.agentId ?? row.id };
    },

    async commanderSourceIsAdmitted(input) {
      const [row] = await tx
        .select({ id: internalAgentRuns.id })
        .from(internalAgentRuns)
        .innerJoin(internalAgentMessages, eq(internalAgentMessages.runId, internalAgentRuns.id))
        .innerJoin(
          internalAgentConversations,
          eq(internalAgentConversations.id, internalAgentMessages.conversationId),
        )
        .where(and(
          eq(internalAgentRuns.id, input.runId),
          eq(internalAgentRuns.companyId, input.companyId),
          eq(internalAgentRuns.triggerType, "conversation"),
          eq(internalAgentRuns.userId, input.userId),
          eq(internalAgentConversations.id, input.conversationId),
          eq(internalAgentConversations.companyId, input.companyId),
          eq(internalAgentConversations.userId, input.userId),
        ))
        .limit(1);
      return row ? { kind: "sandbox", id: row.id } : null;
    },

    async serviceSourceIsAdmitted(input) {
      const [row] = await tx
        .select({ id: services.id })
        .from(services)
        .where(and(
          eq(services.id, input.serviceId),
          eq(services.organizationId, input.organizationId),
          eq(services.companyId, input.companyId),
          eq(services.generation, input.generation),
        ))
        .limit(1);
      return row ? { kind: "service_instance", id: row.id } : null;
    },

    async insertJobOnce(values) {
      const [row] = await tx
        .insert(jobs)
        .values(values)
        .onConflictDoNothing({
          target: [
            jobs.organizationId,
            jobs.companyId,
            jobs.authenticatedPrincipalKind,
            jobs.authenticatedPrincipalId,
            jobs.authenticatedSourceKind,
            jobs.authenticatedSourceIdentity,
            jobs.idempotencyKey,
          ],
        })
        .returning();
      return row ?? null;
    },

    async findSubmission(input) {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.companyId, input.companyId),
          eq(jobs.authenticatedPrincipalKind, input.authenticatedPrincipalKind),
          eq(jobs.authenticatedPrincipalId, input.authenticatedPrincipalId),
          eq(jobs.authenticatedSourceKind, input.authenticatedSourceKind),
          eq(jobs.authenticatedSourceIdentity, input.authenticatedSourceIdentity),
          eq(jobs.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      return row ?? null;
    },

    async insertAttempt(values) {
      const [row] = await tx.insert(jobAttempts).values(values).returning();
      return row!;
    },

    async findInitialAttempt(jobId) {
      const [row] = await tx
        .select()
        .from(jobAttempts)
        .where(and(eq(jobAttempts.jobId, jobId), eq(jobAttempts.attemptNumber, 1)))
        .limit(1);
      return row ?? null;
    },

    async insertOutbox(values) {
      const [row] = await tx.insert(jobOutbox).values(values).returning();
      return row!;
    },

    async lockPlacementContext(input) {
      const [row] = await tx
        .select({ job: jobs, attempt: jobAttempts })
        .from(jobAttempts)
        .innerJoin(jobs, and(
          eq(jobs.organizationId, jobAttempts.organizationId),
          eq(jobs.companyId, jobAttempts.companyId),
          eq(jobs.id, jobAttempts.jobId),
        ))
        .where(and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.companyId, input.companyId),
          eq(jobs.id, input.jobId),
          eq(jobAttempts.id, input.attemptId),
        ))
        .for("update")
        .limit(1);
      return row ?? null;
    },

    async listPlacementCandidateSnapshots() {
      const rows = await tx
        .select({
          target: placementTargetColumns,
          worker: placementWorkerColumns,
        })
        .from(executionTargets)
        .innerJoin(workers, and(
          eq(workers.executionTargetId, executionTargets.id),
          eq(workers.targetAuthorityKey, executionTargets.targetAuthorityKey),
        ))
        .for("share");

      const ownerUserIds = [...new Set(rows.flatMap((row) => (
        row.target.scope === "owner" && row.target.ownerUserId
          ? [row.target.ownerUserId]
          : []
      )))];
      const activeOwnerMemberships = ownerUserIds.length === 0
        ? []
        : await tx
          .select({
            organizationId: organizationMemberships.organizationId,
            userId: organizationMemberships.userId,
          })
          .from(organizationMemberships)
          .where(and(
            eq(organizationMemberships.status, "active"),
            inArray(organizationMemberships.userId, ownerUserIds),
          ));
      const activeOwnerKeys = new Set(activeOwnerMemberships.map(
        (membership) => `${membership.organizationId}:${membership.userId}`,
      ));

      return rows.map((row) => ({
        target: row.target,
        worker: row.worker,
        ownerMembershipActive: row.target.scope !== "owner" || (
          row.target.organizationId !== null
          && row.target.ownerUserId !== null
          && activeOwnerKeys.has(`${row.target.organizationId}:${row.target.ownerUserId}`)
        ),
      }));
    },

    async persistPlacementDecision(input) {
      const currentOwnerAuthority = input.placementDisposition === "selected"
        && input.placementOwner === "owner_desktop"
        ? exists(tx
            .select({ companyId: companies.id })
            .from(companies)
            .innerJoin(organizationMemberships, and(
              eq(organizationMemberships.organizationId, companies.organizationId),
              eq(organizationMemberships.organizationId, input.organizationId),
              eq(organizationMemberships.userId, input.placementOwnerPrincipalId ?? ""),
              eq(organizationMemberships.status, "active"),
            ))
            .where(and(
              eq(companies.id, input.companyId),
              eq(companies.organizationId, input.organizationId),
            )))
        : undefined;
      const [row] = await tx.update(jobAttempts).set({
        placementDisposition: input.placementDisposition,
        placementOwner: input.placementOwner,
        placementTargetId: input.placementTargetId,
        placementTargetClass: input.placementTargetClass,
        placementTargetScope: input.placementTargetScope,
        placementTargetGeneration: input.placementTargetGeneration,
        placementProfileHash: input.placementProfileHash,
        placementProviderConstraintHash: input.placementProviderConstraintHash,
        placementFallbackDisposition: input.placementFallbackDisposition,
        placementReasonCode: input.placementReasonCode,
        placementMode: input.placementMode,
        placementLeaseEligible: input.placementLeaseEligible,
        placementInputDigest: input.placementInputDigest,
        placementPolicyDigest: input.placementPolicyDigest,
        placementDecidedAt: input.placementDecidedAt,
        updatedAt: input.placementDecidedAt,
      }).where(and(
        eq(jobAttempts.organizationId, input.organizationId),
        eq(jobAttempts.companyId, input.companyId),
        eq(jobAttempts.jobId, input.jobId),
        eq(jobAttempts.id, input.attemptId),
        isNull(jobAttempts.placementDecidedAt),
        currentOwnerAuthority,
      )).returning();
      return row ?? null;
    },

    async lockWorkerLeaseAuthority(input) {
      const [worker] = await tx.select({
        id: workers.id,
        scope: workers.scope,
        organizationId: workers.organizationId,
        ownerUserId: workers.ownerUserId,
        executionTargetId: workers.executionTargetId,
        targetAuthorityKey: workers.targetAuthorityKey,
        devicePublicKey: workers.devicePublicKey,
        deviceThumbprint: workers.deviceThumbprint,
        deviceGeneration: workers.deviceGeneration,
        profileHash: workers.profileHash,
        profileSnapshot: workers.profileSnapshot,
        status: workers.status,
        revokedAt: workers.revokedAt,
        lastSeenAt: workers.lastSeenAt,
      }).from(workers).where(and(
        eq(workers.id, input.workerId),
        eq(workers.executionTargetId, input.targetId),
      )).for("update").limit(1);
      if (!worker) return null;

      const [target] = await tx.select(placementTargetColumns)
        .from(executionTargets)
        .where(and(
          eq(executionTargets.id, input.targetId),
          eq(executionTargets.targetAuthorityKey, worker.targetAuthorityKey),
        ))
        .limit(1);
      if (!target) return null;

      let ownerMembershipActive = true;
      if (worker.scope === "owner") {
        const [membership] = await tx.select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(and(
            eq(organizationMemberships.organizationId, worker.organizationId!),
            eq(organizationMemberships.userId, worker.ownerUserId!),
            eq(organizationMemberships.status, "active"),
          ))
          .limit(1);
        ownerMembershipActive = Boolean(membership);
      }
      return { worker, target, ownerMembershipActive };
    },

    async lockEligibleLeaseCandidates(input) {
      const boundedLimit = Math.max(1, Math.min(64, Math.floor(input.limit ?? 32)));
      return tx.select({ job: jobs, attempt: jobAttempts })
        .from(jobAttempts)
        .innerJoin(jobs, and(
          eq(jobs.organizationId, jobAttempts.organizationId),
          eq(jobs.companyId, jobAttempts.companyId),
          eq(jobs.id, jobAttempts.jobId),
        ))
        .where(and(
          eq(jobAttempts.status, "pending"),
          eq(jobAttempts.placementDisposition, "selected"),
          eq(jobAttempts.placementMode, "active"),
          eq(jobAttempts.placementLeaseEligible, true),
          eq(jobAttempts.placementTargetId, input.targetId),
          eq(jobs.status, "queued"),
          lte(jobs.availableAt, sql`clock_timestamp()`),
        ))
        .orderBy(asc(jobs.availableAt), desc(jobs.priority), asc(jobs.createdAt), asc(jobs.id))
        .limit(boundedLimit)
        .for("update", { of: jobAttempts, skipLocked: true });
    },

    async countLiveWorkerLeases(input) {
      const [row] = await tx.select({ value: count() }).from(leases).where(and(
        eq(leases.workerId, input.workerId),
        eq(leases.targetId, input.targetId),
        inArray(leases.status, ["offered", "active"]),
      ));
      return Number(row?.value ?? 0);
    },

    async currentDatabaseTime() {
      const rows = await tx.execute<{ value: Date | string }>(sql`SELECT clock_timestamp() AS value`);
      const [row] = rows;
      const value = row?.value;
      const parsed = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Database returned an invalid clock_timestamp() value");
      }
      return parsed;
    },

    async offerLease(input) {
      const [attempt] = await tx.update(jobAttempts).set({
        status: "offered",
        updatedAt: input.createdAt,
      }).where(and(
        eq(jobAttempts.id, input.attemptId),
        eq(jobAttempts.organizationId, input.organizationId),
        eq(jobAttempts.companyId, input.companyId),
        eq(jobAttempts.jobId, input.jobId),
        eq(jobAttempts.attemptNumber, input.attemptNumber),
        eq(jobAttempts.status, "pending"),
        eq(jobAttempts.placementDisposition, "selected"),
        eq(jobAttempts.placementMode, "active"),
        eq(jobAttempts.placementLeaseEligible, true),
        eq(jobAttempts.placementTargetId, input.targetId),
        eq(jobAttempts.placementTargetGeneration, input.targetGeneration),
        eq(jobAttempts.placementProviderConstraintHash, input.providerConstraintHash),
      )).returning({ id: jobAttempts.id });
      if (!attempt) return null;
      const [lease] = await tx.insert(leases).values({
        organizationId: input.organizationId,
        companyId: input.companyId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        attemptNumber: input.attemptNumber,
        workerId: input.workerId,
        targetId: input.targetId,
        targetAuthorityKey: input.targetAuthorityKey,
        targetGeneration: input.targetGeneration,
        profileHash: input.profileHash,
        providerConstraintHash: input.providerConstraintHash,
        status: "offered",
        fence: input.fence,
        ackDeadline: input.ackDeadline,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }).returning();
      return lease ?? null;
    },

    async claimReadyOutbox(input) {
      const boundedLimit = Math.max(1, Math.min(128, Math.floor(input.limit ?? 32)));
      const staleRows = await tx.select({ id: jobOutbox.id }).from(jobOutbox)
        .where(and(
          eq(jobOutbox.status, "claimed"),
          lte(jobOutbox.claimedAt, input.staleBefore),
        ))
        .orderBy(asc(jobOutbox.claimedAt), asc(jobOutbox.id))
        .limit(boundedLimit)
        .for("update", { skipLocked: true });
      if (staleRows.length > 0) {
        await tx.update(jobOutbox).set({
          status: "retry",
          claimToken: null,
          claimedAt: null,
          availableAt: input.now,
          lastErrorCode: "claim_visibility_timeout",
          updatedAt: input.now,
        }).where(inArray(jobOutbox.id, staleRows.map((row) => row.id)));
      }

      const ready = await tx.select({
        id: jobOutbox.id,
        organizationId: jobOutbox.organizationId,
        attemptId: jobOutbox.attemptId,
      }).from(jobOutbox).where(and(
        eq(jobOutbox.kind, "attempt_ready"),
        or(eq(jobOutbox.status, "pending"), eq(jobOutbox.status, "retry")),
        lte(jobOutbox.availableAt, input.now),
      )).orderBy(asc(jobOutbox.availableAt), asc(jobOutbox.createdAt), asc(jobOutbox.id))
        .limit(boundedLimit)
        .for("update", { skipLocked: true });
      if (ready.length === 0) return [];
      const claimed = await tx.update(jobOutbox).set({
        status: "claimed",
        claimToken: input.claimToken,
        claimedAt: input.now,
        attemptCount: sql`${jobOutbox.attemptCount} + 1`,
        lastErrorCode: null,
        updatedAt: input.now,
      }).where(and(
        inArray(jobOutbox.id, ready.map((row) => row.id)),
        or(eq(jobOutbox.status, "pending"), eq(jobOutbox.status, "retry")),
      )).returning({
        id: jobOutbox.id,
        organizationId: jobOutbox.organizationId,
        attemptId: jobOutbox.attemptId,
      });
      return claimed;
    },

    async deliverReadyOutbox(input) {
      if (input.ids.length === 0) return 0;
      const delivered = await tx.update(jobOutbox).set({
        status: "delivered",
        claimToken: null,
        claimedAt: null,
        updatedAt: input.now,
      }).where(and(
        inArray(jobOutbox.id, input.ids),
        eq(jobOutbox.status, "claimed"),
        eq(jobOutbox.claimToken, input.claimToken),
      )).returning({ id: jobOutbox.id });
      return delivered.length;
    },
  };
}
