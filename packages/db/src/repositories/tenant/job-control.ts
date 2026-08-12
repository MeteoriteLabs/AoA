import { and, asc, count, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, lte, ne, notExists, or, sql } from "drizzle-orm";
import type { JobPlacementOwner } from "@armyofagents/shared";
import type { Db } from "../../client.js";
import {
  acquirePlatformTargetAuthorityShared,
  configurePlatformTargetAuthorityLockTimeout,
} from "../../platform-target-authority-lock.js";
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
  workerOperationReceipts,
  workerLeaseRejections,
  services,
  type Job,
  type JobAttempt,
  type JobOutbox,
  type NewJob,
  type NewJobAttempt,
  type NewJobOutbox,
  type Lease,
  type WorkerOperationReceipt,
  type NewWorkerLeaseRejection,
} from "../../schema/index.js";

export interface LeaseRejectionCleanupResult {
  readonly deleted: number;
  readonly cardinalityObserved: number;
  readonly cardinalitySaturated: boolean;
}

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
    admissibleWorkloadTypes: string[];
    eligibilityVersion: number;
    limit: 256;
    placementOwner: Exclude<JobPlacementOwner, "legacy">;
    staticContextHash: string;
    targetAuthorityKey: string;
    targetClass: Exclude<JobPlacementOwner, "legacy">;
    targetGeneration: number;
    targetId: string;
    targetProfileHash: string;
    targetProviderConstraintHash: string;
    targetScope: string;
    workerId: string;
  }): Promise<LeaseCandidate[]>;
  snapshotLiveLeaseCapacity(input: {
    workerId: string;
    targetId: string;
  }): Promise<{ total: number; batch: number; browserSession: number; service: number }>;
  upsertLeaseRejectionCertificates(
    input: StaticLeaseRejectionInput[] | { certificates: NewWorkerLeaseRejection[] },
  ): Promise<number>;
  cleanupLeaseRejectionCertificates(input: {
    limit: number;
    cardinalityLimit: number;
    beforeStatement(phase: "select" | "delete" | "cardinality"): Promise<void>;
  }): Promise<LeaseRejectionCleanupResult>;
  acquirePlatformTargetAuthorityShared(targetId: string): Promise<void>;
  recheckPlatformTargetAuthority(input: {
    targetId: string;
    targetAuthorityKey: string;
    targetGeneration: number;
  }): Promise<PlacementCandidateSnapshot["target"] | null>;
  touchWorkerLeaseProfile(input: {
    workerId: string;
    targetId: string;
    targetGeneration: number;
  }): Promise<boolean>;
  currentDatabaseTime(): Promise<Date>;
  setLocalStatementTimeout(milliseconds: number): Promise<void>;
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
  cleanupExpiredOperationReceipts(expiresBefore: Date, limit?: number): Promise<number>;
  findOperationReceipt(input: {
    organizationId: string;
    workerId: string;
    targetId: string;
    targetGeneration: number;
    profileHash: string;
    operation: "lease_ack";
    idempotencyKey: string;
  }): Promise<WorkerOperationReceipt | null>;
  lockLeaseAckContext(input: {
    organizationId: string;
    workerId: string;
    targetId: string;
    targetGeneration: number;
    profileHash: string;
    leaseId: string;
    jobId: string;
    attemptNumber: number;
    fence: string;
  }): Promise<{ lease: Lease; attempt: JobAttempt } | null>;
  activateLeaseAck(input: {
    organizationId: string;
    companyId: string;
    jobId: string;
    attemptId: string;
    attemptNumber: number;
    leaseId: string;
    workerId: string;
    targetId: string;
    targetAuthorityKey: string;
    targetGeneration: number;
    profileHash: string;
    providerConstraintHash: string;
    placementProfileHash: string;
    fence: string;
    idempotencyKey: string;
    semanticDigest: string;
    receiptExpiresAt: Date;
    outcome: Record<string, unknown>;
  }): Promise<Lease | null>;
  claimReadyOutbox(input: {
    claimToken: string;
    now: Date;
    staleBefore: Date;
    limit?: number;
  }): Promise<Array<{
    id: string;
    organizationId: string;
    targetId: string;
    attemptId: string;
  }>>;
  deliverReadyOutbox(input: { claimToken: string; ids: string[] }): Promise<number>;
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
  certificateWorkerId: string;
  certificateTargetAuthorityKey: string;
  certificateEligibilityVersion: number;
}

export interface StaticLeaseRejectionInput {
  candidate: LeaseCandidate;
  reasonCode: "static_requirements_mismatch";
  staticContextHash: string;
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
        : sql`true`;
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

      const targetQuery = tx.select(placementTargetColumns)
        .from(executionTargets)
        .where(and(
          eq(executionTargets.id, input.targetId),
          eq(executionTargets.targetAuthorityKey, worker.targetAuthorityKey),
        ))
        .limit(1);
      // aoa_app deliberately has SELECT-only visibility over null-Org platform
      // targets. The Decision #124 shared advisory handoff supplies the cutoff
      // guard; requesting FOR UPDATE here would require forbidden global DML.
      const [target] = worker.targetAuthorityKey === "platform"
        ? await targetQuery
        : await targetQuery.for("update");
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
          .for("share")
          .limit(1);
        ownerMembershipActive = Boolean(membership);
      }
      return { worker, target, ownerMembershipActive };
    },

    async lockEligibleLeaseCandidates(input) {
      if (input.limit !== 256) throw new Error("Lease candidate limit must be 256");
      if (input.admissibleWorkloadTypes.length === 0) return [];
      return tx.select({
        job: jobs,
        attempt: jobAttempts,
        certificateWorkerId: sql<string>`${input.workerId}`,
        certificateTargetAuthorityKey: sql<string>`${input.targetAuthorityKey}`,
        certificateEligibilityVersion: sql<number>`${input.eligibilityVersion}`,
      })
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
          eq(jobAttempts.placementOwner, input.placementOwner),
          eq(jobAttempts.placementTargetId, input.targetId),
          eq(jobAttempts.placementTargetClass, input.targetClass),
          eq(jobAttempts.placementTargetScope, input.targetScope),
          eq(jobAttempts.placementTargetGeneration, input.targetGeneration),
          eq(jobAttempts.placementProfileHash, input.targetProfileHash),
          eq(jobAttempts.placementProviderConstraintHash, input.targetProviderConstraintHash),
          eq(jobs.status, "queued"),
          inArray(jobs.workloadType, input.admissibleWorkloadTypes),
          lte(jobs.availableAt, sql`statement_timestamp()`),
          notExists(tx.select({ value: sql<number>`1` })
            .from(workerLeaseRejections)
            .where(and(
              eq(workerLeaseRejections.organizationId, jobAttempts.organizationId),
              eq(workerLeaseRejections.companyId, jobAttempts.companyId),
              eq(workerLeaseRejections.jobId, jobAttempts.jobId),
              eq(workerLeaseRejections.attemptId, jobAttempts.id),
              eq(workerLeaseRejections.workerId, input.workerId),
              eq(workerLeaseRejections.targetId, input.targetId),
              eq(workerLeaseRejections.targetAuthorityKey, input.targetAuthorityKey),
              eq(workerLeaseRejections.workloadType, jobs.workloadType),
              eq(workerLeaseRejections.placementOwner, jobAttempts.placementOwner),
              eq(workerLeaseRejections.placementTargetClass, jobAttempts.placementTargetClass),
              eq(workerLeaseRejections.placementTargetScope, jobAttempts.placementTargetScope),
              eq(workerLeaseRejections.placementTargetGeneration, jobAttempts.placementTargetGeneration),
              eq(workerLeaseRejections.placementProfileHash, jobAttempts.placementProfileHash),
              eq(workerLeaseRejections.placementProviderConstraintHash, jobAttempts.placementProviderConstraintHash),
              eq(workerLeaseRejections.placementInputDigest, jobAttempts.placementInputDigest),
              eq(workerLeaseRejections.placementPolicyDigest, jobAttempts.placementPolicyDigest),
              eq(workerLeaseRejections.eligibilityVersion, input.eligibilityVersion),
              eq(workerLeaseRejections.staticContextHash, input.staticContextHash),
            ))),
        ))
        .orderBy(asc(jobs.availableAt), desc(jobs.priority), asc(jobs.createdAt), asc(jobs.id))
        .limit(256)
        .for("update", { of: jobAttempts, skipLocked: true });
    },

    async snapshotLiveLeaseCapacity(input) {
      const [row] = await tx.select({
        total: count(),
        batch: sql<number>`COUNT(*) FILTER (WHERE workload_type = 'batch')`,
        browserSession: sql<number>`COUNT(*) FILTER (WHERE workload_type = 'browser_session')`,
        service: sql<number>`COUNT(*) FILTER (WHERE workload_type = 'service')`,
      }).from(leases).innerJoin(jobs, and(
        eq(jobs.organizationId, leases.organizationId),
        eq(jobs.companyId, leases.companyId),
        eq(jobs.id, leases.jobId),
      )).where(and(
        eq(leases.workerId, input.workerId),
        eq(leases.targetId, input.targetId),
        inArray(leases.status, ["offered", "active"]),
      ));
      return {
        total: Number(row?.total ?? 0),
        batch: Number(row?.batch ?? 0),
        browserSession: Number(row?.browserSession ?? 0),
        service: Number(row?.service ?? 0),
      };
    },

    async upsertLeaseRejectionCertificates(input) {
      const certificates: NewWorkerLeaseRejection[] = [];
      if ("certificates" in input) {
        for (let index = 0; index < input.certificates.length; index += 1) {
          certificates[index] = input.certificates[index]!;
        }
      } else {
        for (let index = 0; index < input.length; index += 1) {
            const { candidate, reasonCode, staticContextHash } = input[index]!;
            const { job, attempt } = candidate;
            if (!attempt.placementOwner || !attempt.placementTargetId ||
                !attempt.placementTargetClass || !attempt.placementTargetScope ||
                !attempt.placementTargetGeneration || !attempt.placementProfileHash ||
                !attempt.placementProviderConstraintHash || !attempt.placementInputDigest ||
                !attempt.placementPolicyDigest) {
              throw new Error("Static lease rejection candidate has incomplete placement facts");
            }
            certificates[index] = {
              organizationId: job.organizationId,
              companyId: job.companyId,
              jobId: job.id,
              attemptId: attempt.id,
              workerId: candidate.certificateWorkerId,
              targetId: attempt.placementTargetId,
              targetAuthorityKey: candidate.certificateTargetAuthorityKey,
              eligibilityVersion: candidate.certificateEligibilityVersion,
              staticContextHash,
              workloadType: job.workloadType,
              placementOwner: attempt.placementOwner,
              placementTargetClass: attempt.placementTargetClass,
              placementTargetScope: attempt.placementTargetScope,
              placementTargetGeneration: attempt.placementTargetGeneration,
              placementProfileHash: attempt.placementProfileHash,
              placementProviderConstraintHash: attempt.placementProviderConstraintHash,
              placementInputDigest: attempt.placementInputDigest,
              placementPolicyDigest: attempt.placementPolicyDigest,
              reasonCode,
            };
        }
      }
      if (certificates.length === 0) return 0;
      const rows = await tx.insert(workerLeaseRejections).values(certificates)
        .onConflictDoUpdate({
          target: [
            workerLeaseRejections.organizationId,
            workerLeaseRejections.workerId,
            workerLeaseRejections.attemptId,
          ],
          set: {
            companyId: sql`excluded.company_id`,
            jobId: sql`excluded.job_id`,
            targetId: sql`excluded.target_id`,
            targetAuthorityKey: sql`excluded.target_authority_key`,
            eligibilityVersion: sql`excluded.eligibility_version`,
            staticContextHash: sql`excluded.static_context_hash`,
            workloadType: sql`excluded.workload_type`,
            placementOwner: sql`excluded.placement_owner`,
            placementTargetClass: sql`excluded.placement_target_class`,
            placementTargetScope: sql`excluded.placement_target_scope`,
            placementTargetGeneration: sql`excluded.placement_target_generation`,
            placementProfileHash: sql`excluded.placement_profile_hash`,
            placementProviderConstraintHash: sql`excluded.placement_provider_constraint_hash`,
            placementInputDigest: sql`excluded.placement_input_digest`,
            placementPolicyDigest: sql`excluded.placement_policy_digest`,
            reasonCode: sql`excluded.reason_code`,
            updatedAt: sql`clock_timestamp()`,
          },
        }).returning({ attemptId: workerLeaseRejections.attemptId });
      return rows.length;
    },

    async cleanupLeaseRejectionCertificates(input) {
      // Bounds are validated before any beforeStatement wrapper or SQL runs; an invalid limit or
      // cardinality bound rolls the tenant transaction back before select/delete/cardinality fire.
      const isBound = (value: number) => Number.isSafeInteger(value) && value > 0;
      if (!isBound(input.limit) || !isBound(input.cardinalityLimit)) {
        throw new Error("lease_rejection_cleanup_bound");
      }
      const boundedLimit = input.limit;
      const cardinalityLimit = input.cardinalityLimit;
      const terminal = ["succeeded", "failed", "cancelled", "dead_letter"];

      await input.beforeStatement("select");
      // LEFT joins so a certificate whose parent job/attempt/worker/target was deleted, cascaded,
      // or drifted still appears in the candidate set. A row is eligible only for a correctness
      // reason (missing/terminal/retired/revoked/offline authority or placement drift), never age;
      // updated_at is ordering only.
      const candidates = await tx.select({
        organizationId: workerLeaseRejections.organizationId,
        workerId: workerLeaseRejections.workerId,
        attemptId: workerLeaseRejections.attemptId,
      }).from(workerLeaseRejections)
        .leftJoin(jobs, and(
          eq(jobs.organizationId, workerLeaseRejections.organizationId),
          eq(jobs.companyId, workerLeaseRejections.companyId),
          eq(jobs.id, workerLeaseRejections.jobId),
        ))
        .leftJoin(jobAttempts, and(
          eq(jobAttempts.organizationId, workerLeaseRejections.organizationId),
          eq(jobAttempts.companyId, workerLeaseRejections.companyId),
          eq(jobAttempts.jobId, workerLeaseRejections.jobId),
          eq(jobAttempts.id, workerLeaseRejections.attemptId),
        ))
        .leftJoin(workers, and(
          eq(workers.organizationId, workerLeaseRejections.organizationId),
          eq(workers.id, workerLeaseRejections.workerId),
        ))
        .leftJoin(executionTargets, eq(executionTargets.id, workerLeaseRejections.targetId))
        .where(or(
          isNull(jobAttempts.id),
          ne(jobAttempts.status, "pending"),
          isNull(jobs.id),
          inArray(jobs.status, terminal),
          isNull(workers.id),
          eq(workers.status, "revoked"),
          ne(workers.targetAuthorityKey, workerLeaseRejections.targetAuthorityKey),
          ne(workers.executionTargetId, workerLeaseRejections.targetId),
          isNull(executionTargets.id),
          inArray(executionTargets.status, ["offline", "disabled"]),
          ne(executionTargets.targetAuthorityKey, workerLeaseRejections.targetAuthorityKey),
          ne(workerLeaseRejections.placementTargetGeneration, executionTargets.deviceGeneration),
          ne(workerLeaseRejections.placementProfileHash, executionTargets.registeredProfileHash),
          ne(
            workerLeaseRejections.placementProviderConstraintHash,
            sql`${executionTargets.providerConstraintProfile} ->> 'digest'`,
          ),
          ne(workerLeaseRejections.workloadType, jobs.workloadType),
          ne(workerLeaseRejections.placementOwner, jobAttempts.placementOwner),
          ne(workerLeaseRejections.placementTargetClass, jobAttempts.placementTargetClass),
          ne(workerLeaseRejections.placementTargetScope, jobAttempts.placementTargetScope),
          ne(workerLeaseRejections.placementTargetGeneration, jobAttempts.placementTargetGeneration),
          ne(workerLeaseRejections.placementProfileHash, jobAttempts.placementProfileHash),
          ne(workerLeaseRejections.placementProviderConstraintHash, jobAttempts.placementProviderConstraintHash),
          ne(workerLeaseRejections.placementInputDigest, jobAttempts.placementInputDigest),
          ne(workerLeaseRejections.placementPolicyDigest, jobAttempts.placementPolicyDigest),
        ))
        .orderBy(
          asc(workerLeaseRejections.updatedAt),
          asc(workerLeaseRejections.workerId),
          asc(workerLeaseRejections.attemptId),
        )
        .limit(boundedLimit)
        .for("update", { of: workerLeaseRejections, skipLocked: true });

      let deleted = 0;
      if (candidates.length > 0) {
        await input.beforeStatement("delete");
        // Delete only the exact selected (organization_id, worker_id, attempt_id) primary-key
        // tuples via an OR-of-AND predicate — never independent IN lists, which would expand a
        // Cartesian set of unselected rows. The exact-tuple RETURNING is the sole affected count;
        // a return beyond the requested bound rolls back rather than clamping with Math.min.
        const removed = await tx.delete(workerLeaseRejections).where(or(
          ...candidates.map((candidate) => and(
            eq(workerLeaseRejections.organizationId, candidate.organizationId),
            eq(workerLeaseRejections.workerId, candidate.workerId),
            eq(workerLeaseRejections.attemptId, candidate.attemptId),
          )),
        )).returning({ attemptId: workerLeaseRejections.attemptId });
        if (removed.length > boundedLimit) throw new Error("lease_rejection_cleanup_bound");
        deleted = removed.length;
      }

      await input.beforeStatement("cardinality");
      // Bounded truthful probe of this tenant's remaining certificates: at most
      // cardinalityLimit + 1 keys, never a global owner scan.
      const remaining = await tx.select({ one: sql<number>`1` })
        .from(workerLeaseRejections)
        .limit(cardinalityLimit + 1);
      return {
        deleted,
        cardinalityObserved: Math.min(remaining.length, cardinalityLimit),
        cardinalitySaturated: remaining.length > cardinalityLimit,
      };
    },

    async acquirePlatformTargetAuthorityShared(targetId) {
      await configurePlatformTargetAuthorityLockTimeout(tx);
      await acquirePlatformTargetAuthorityShared(tx, targetId);
    },

    async recheckPlatformTargetAuthority(input) {
      const [target] = await tx.select(placementTargetColumns)
        .from(executionTargets)
        .where(and(
          eq(executionTargets.id, input.targetId),
          eq(executionTargets.scope, "platform"),
          isNull(executionTargets.organizationId),
          isNull(executionTargets.ownerUserId),
          eq(executionTargets.targetAuthorityKey, input.targetAuthorityKey),
          eq(executionTargets.deviceGeneration, input.targetGeneration),
        ))
        .limit(1);
      return target ?? null;
    },

    async touchWorkerLeaseProfile(input) {
      const rows = await tx.update(workers).set({
        lastSeenAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(workers.id, input.workerId),
        eq(workers.executionTargetId, input.targetId),
        eq(workers.deviceGeneration, input.targetGeneration),
        ne(workers.status, "revoked"),
      )).returning({ id: workers.id });
      return rows.length === 1;
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

    async setLocalStatementTimeout(milliseconds) {
      const bounded = Math.max(1, Math.min(30_000, Math.floor(milliseconds)));
      await tx.execute(sql`SELECT set_config('statement_timeout', ${String(bounded)}, true)`);
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
      try {
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
      } catch {
        // PostgreSQL marks this transaction failed. Returning null lets the
        // service raise its private head-restart sentinel, guaranteeing outer
        // rollback before a fresh bounded attempt reports internal_unavailable.
        return null;
      }
    },

    async cleanupExpiredOperationReceipts(expiresBefore, limit = 100) {
      const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
      const expired = await tx.select({ id: workerOperationReceipts.id })
        .from(workerOperationReceipts)
        .where(lte(workerOperationReceipts.expiresAt, expiresBefore))
        .orderBy(asc(workerOperationReceipts.expiresAt), asc(workerOperationReceipts.id))
        .limit(boundedLimit)
        .for("update", { skipLocked: true });
      if (expired.length === 0) return 0;
      const removed = await tx.delete(workerOperationReceipts)
        .where(inArray(workerOperationReceipts.id, expired.map((row) => row.id)))
        .returning({ id: workerOperationReceipts.id });
      return removed.length;
    },

    async findOperationReceipt(input) {
      const exactIdentity = and(
        eq(workerOperationReceipts.organizationId, input.organizationId),
        eq(workerOperationReceipts.workerId, input.workerId),
        eq(workerOperationReceipts.targetId, input.targetId),
        eq(workerOperationReceipts.targetGeneration, input.targetGeneration),
        eq(workerOperationReceipts.profileHash, input.profileHash),
        eq(workerOperationReceipts.operation, input.operation),
        eq(workerOperationReceipts.idempotencyKey, input.idempotencyKey),
      );
      // Semantic replay validity is independent of bounded housekeeping. Remove
      // only this exact expired collision using fresh DB time, then read only a
      // still-current receipt. An unexpired receipt is never deleted/replaced.
      await tx.delete(workerOperationReceipts).where(and(
        exactIdentity,
        lte(workerOperationReceipts.expiresAt, sql`clock_timestamp()`),
      ));
      const [receipt] = await tx.select().from(workerOperationReceipts).where(and(
        exactIdentity,
        gt(workerOperationReceipts.expiresAt, sql`clock_timestamp()`),
      )).limit(1);
      return receipt ?? null;
    },

    async lockLeaseAckContext(input) {
      const [context] = await tx.select({ lease: leases, attempt: jobAttempts })
        .from(leases)
        .innerJoin(jobAttempts, and(
          eq(jobAttempts.organizationId, leases.organizationId),
          eq(jobAttempts.companyId, leases.companyId),
          eq(jobAttempts.jobId, leases.jobId),
          eq(jobAttempts.id, leases.attemptId),
        ))
        .where(and(
          eq(leases.organizationId, input.organizationId),
          eq(leases.id, input.leaseId),
          eq(leases.jobId, input.jobId),
          eq(leases.attemptNumber, input.attemptNumber),
          eq(leases.workerId, input.workerId),
          eq(leases.targetId, input.targetId),
          eq(leases.targetGeneration, input.targetGeneration),
          eq(leases.profileHash, input.profileHash),
          eq(leases.fence, input.fence),
        ))
        .for("update")
        .limit(1);
      return context ?? null;
    },

    async activateLeaseAck(input) {
      const [lease] = await tx.update(leases).set({
        status: "active",
        activatedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(leases.organizationId, input.organizationId),
        eq(leases.companyId, input.companyId),
        eq(leases.jobId, input.jobId),
        eq(leases.attemptId, input.attemptId),
        eq(leases.attemptNumber, input.attemptNumber),
        eq(leases.id, input.leaseId),
        eq(leases.workerId, input.workerId),
        eq(leases.targetId, input.targetId),
        eq(leases.targetAuthorityKey, input.targetAuthorityKey),
        eq(leases.targetGeneration, input.targetGeneration),
        eq(leases.profileHash, input.profileHash),
        eq(leases.providerConstraintHash, input.providerConstraintHash),
        eq(leases.fence, input.fence),
        eq(leases.status, "offered"),
        gte(leases.ackDeadline, sql`clock_timestamp()`),
        gte(leases.expiresAt, sql`clock_timestamp()`),
      )).returning();
      if (!lease) return null;

      const [attempt] = await tx.update(jobAttempts).set({
        status: "leased",
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobAttempts.organizationId, input.organizationId),
        eq(jobAttempts.companyId, input.companyId),
        eq(jobAttempts.jobId, input.jobId),
        eq(jobAttempts.id, input.attemptId),
        eq(jobAttempts.attemptNumber, input.attemptNumber),
        eq(jobAttempts.status, "offered"),
        eq(jobAttempts.placementDisposition, "selected"),
        eq(jobAttempts.placementMode, "active"),
        eq(jobAttempts.placementLeaseEligible, true),
        eq(jobAttempts.placementTargetId, input.targetId),
        eq(jobAttempts.placementTargetGeneration, input.targetGeneration),
        eq(jobAttempts.placementProfileHash, input.placementProfileHash),
        eq(jobAttempts.placementProviderConstraintHash, input.providerConstraintHash),
      )).returning({ id: jobAttempts.id });
      if (!attempt) throw new Error("Lease ACK attempt authority changed");

      await tx.insert(workerOperationReceipts).values({
        organizationId: input.organizationId,
        companyId: input.companyId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        leaseId: input.leaseId,
        operation: "lease_ack",
        workerId: input.workerId,
        targetId: input.targetId,
        targetAuthorityKey: input.targetAuthorityKey,
        targetGeneration: input.targetGeneration,
        profileHash: input.profileHash,
        idempotencyKey: input.idempotencyKey,
        semanticDigest: input.semanticDigest,
        outcome: input.outcome,
        expiresAt: input.receiptExpiresAt,
        createdAt: sql`clock_timestamp()`,
      });
      return lease;
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
        targetId: jobAttempts.placementTargetId,
      }).from(jobOutbox)
        .innerJoin(jobAttempts, and(
          eq(jobAttempts.organizationId, jobOutbox.organizationId),
          eq(jobAttempts.companyId, jobOutbox.companyId),
          eq(jobAttempts.jobId, jobOutbox.jobId),
          eq(jobAttempts.id, jobOutbox.attemptId),
        ))
        .innerJoin(jobs, and(
          eq(jobs.organizationId, jobAttempts.organizationId),
          eq(jobs.companyId, jobAttempts.companyId),
          eq(jobs.id, jobAttempts.jobId),
        ))
        .where(and(
          eq(jobOutbox.kind, "attempt_ready"),
          or(eq(jobOutbox.status, "pending"), eq(jobOutbox.status, "retry")),
          lte(jobOutbox.availableAt, sql`statement_timestamp()`),
          eq(jobAttempts.status, "pending"),
          eq(jobAttempts.placementDisposition, "selected"),
          eq(jobAttempts.placementMode, "active"),
          eq(jobAttempts.placementLeaseEligible, true),
          isNotNull(jobAttempts.placementTargetId),
          eq(jobs.status, "queued"),
          lte(jobs.availableAt, sql`statement_timestamp()`),
        )).orderBy(asc(jobOutbox.availableAt), asc(jobOutbox.createdAt), asc(jobOutbox.id))
        .limit(boundedLimit)
        .for("update", { of: [jobOutbox, jobAttempts], skipLocked: true });
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
      const targetByOutboxId = new Map(ready.map((row) => [row.id, row.targetId!]));
      return claimed.map((row) => ({
        ...row,
        targetId: targetByOutboxId.get(row.id)!,
      }));
    },

    async deliverReadyOutbox(input) {
      if (input.ids.length === 0) return 0;
      const delivered = await tx.update(jobOutbox).set({
        status: "delivered",
        claimToken: null,
        claimedAt: null,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        inArray(jobOutbox.id, input.ids),
        eq(jobOutbox.status, "claimed"),
        eq(jobOutbox.claimToken, input.claimToken),
      )).returning({ id: jobOutbox.id });
      return delivered.length;
    },
  };
}
