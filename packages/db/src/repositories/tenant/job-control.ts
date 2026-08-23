import { and, asc, count, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, lte, ne, notExists, notInArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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
  providerCredentials,
  workers,
  workerOperationReceipts,
  workerLeaseRejections,
  services,
  serviceInstances,
  jobArtifacts,
  jobSecretHandles,
  jobEvents,
  jobProjectionReceipts,
  jobControlCommands,
  type Job,
  type JobAttempt,
  type JobOutbox,
  type NewJob,
  type NewJobAttempt,
  type NewJobOutbox,
  type Lease,
  type WorkerOperationReceipt,
  type NewWorkerLeaseRejection,
  type JobArtifact,
  type JobSecretHandle,
  type ServiceInstance,
} from "../../schema/index.js";
import {
  isActiveFence,
  classifyFence,
  JobFenceError,
  ArtifactCommitRejection,
  PatchApplyRejection,
  OrphanQuarantineRejection,
  SecretResolveRejection,
  authorizeSecretResolve,
  TERMINAL_ATTEMPT_STATUSES,
  type ActiveFenceRequest,
  type SecretRefKind,
} from "./job-fence.js";

export interface LeaseRejectionCleanupResult {
  readonly deleted: number;
  readonly cardinalityObserved: number;
  readonly cardinalitySaturated: boolean;
}

// Payload-free certificate telemetry derived by the claim SQL itself, never inferred from the
// returned candidate array. hits/misses count eligible-shaped attempts suppressed vs not-suppressed
// by a correlated rejection certificate; cardinality counts this worker/target's certificate rows.
// Every count is a bounded probe of at most 4097 rows reported as min(count, 4096) plus a saturation
// flag, so an unbounded tenant can never widen the gauge.
export interface LeaseCertificateScanMetrics {
  readonly hitsObserved: number;
  readonly hitsSaturated: boolean;
  readonly missesObserved: number;
  readonly missesSaturated: boolean;
  readonly scanExhausted: boolean;
  readonly cardinalityObserved: number;
  readonly cardinalitySaturated: boolean;
}

export interface LeaseCandidateScanResult {
  readonly candidates: LeaseCandidate[];
  readonly certificateMetrics: LeaseCertificateScanMetrics;
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
  /** DAT-008 — the executing agent's adapter binding, for the secret-handle mint.
   * Company-scoped; returns null for an unknown agent (never an existence oracle,
   * since the caller already proved the job's tenancy under the placement lock). */
  loadAgentAdapterBinding(input: {
    companyId: string;
    agentId: string;
  }): Promise<{ adapterType: string; adapterConfig: Record<string, unknown> } | null>;
  /** DAT-008 — mint ONE opaque execution-secret handle for a job. The row carries a
   * REFERENCE only (`ref_kind`/`ref_id`); no secret value ever lands here. Idempotent
   * per (organization, job, ref): a replayed placement must not mint a second handle. */
  insertExecutionSecretHandle(input: {
    organizationId: string;
    companyId: string;
    jobId: string;
    handle: string;
    refKind: "provider_key" | "company_secret";
    refId: string;
    materialization: "env";
    usePolicy: "sandbox_local_only";
    envTarget: string;
    boundTargetGeneration: number | null;
    ownerPrincipalKind: string | null;
    ownerPrincipalId: string | null;
  }): Promise<{ handle: string; minted: boolean }>;
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
  }): Promise<LeaseCandidateScanResult>;
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
    operation: "lease_ack" | "lease_renew";
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
  // ---------------------------------------------------------------------------
  // JOB-004 — conditional lease renewal + the CLOSED governed-mutator surface.
  //
  // `renewLease` extends ONLY the active fence's expiry using a fresh SQL
  // `clock_timestamp()` inside the conditional mutation (never a transaction-start
  // or JavaScript time), matches the complete lease identity + fence, increments no
  // authority (fence/generation unchanged), and stores the renewed expiry + cancel
  // response in the operation receipt atomically. Expired/replaced → stale_fence,
  // terminal attempt → attempt_terminal (both raised as `JobFenceError`).
  //
  // The seven guarded mutators below are the CLOSED governed surface; EVERY one
  // gates on the common active-fence guard before mutating (or reading). The four
  // that have a kernel table (`job_artifacts`, `job_secret_handles`, `job_attempts`,
  // `service_instances`) do a thin real mutation; the three whose storage is not yet
  // built (events, projection receipts, control commands) are stubbed BUT STILL
  // gated — JOB-005/006/011 fill the storage behind this already-guarded interface.
  renewLease(input: ActiveFenceRequest & {
    leaseDurationMs: number;
    idempotencyKey: string;
    semanticDigest: string;
  }): Promise<{ lease: Lease; body: Record<string, unknown> }>;
  acceptEvent(
    input: ActiveFenceRequest & { batch?: AcceptEventBatchInput },
  ): Promise<GuardedFenceResult & { ingest?: EventIngestOutcome }>;
  authorizeArtifactCommit(
    input: ActiveFenceRequest & { identifier: string },
  ): Promise<JobArtifact>;
  /**
   * DAT-002 — the fenced, verified commit of a rich artifact manifest. Runs
   * `guardActiveFence` FIRST (a stale/terminal fence throws `JobFenceError` BEFORE
   * any hash/size check — the documented precedence), then verifies the manifest's
   * object-key prefix, tenant, size, and sha256 against the store-observed actuals
   * (throwing `ArtifactCommitRejection` on mismatch), computes a per-(org,job)
   * `versionNumber` under the fence lock, and inserts the `status='committed'` row
   * idempotently on the partial-unique natural key (a replay returns the existing
   * committed row unchanged). `prefixValid`/`tenantValid` are pre-evaluated by the
   * server (which owns the frozen worker-protocol prefix helper) and re-checked here
   * AFTER the guard to preserve fence-first precedence.
   */
  commitArtifactVersion(
    input: ActiveFenceRequest & {
      identifier: string;
      objectKey: string;
      contentType: string;
      kind: string;
      sensitivity: string;
      retention: string;
      declaredSizeBytes: number;
      declaredSha256: string;
      actualSizeBytes: number;
      actualSha256: string;
      prefixValid: boolean;
      tenantValid: boolean;
    },
  ): Promise<JobArtifact>;
  /**
   * DAT-003 — the fenced apply/review of a COMMITTED `workspace_patch`. Runs
   * `guardActiveFence` FIRST (a stale/terminal/revoked fence throws `JobFenceError`
   * BEFORE any patch-row read — the documented precedence). Then, under the held
   * fence lock:
   *   1. Load the committed `workspace_patch` row for (org, job, attempt, identifier);
   *      throw `PatchApplyRejection('patch_not_committed')` if absent, or
   *      `PatchApplyRejection('object_key_mismatch')` if the presented `patchObjectKey`
   *      does not equal the committed row's object key (so the parsed base/result
   *      digests are bound to the immutable committed object).
   *   2. If it is already `apply_status='applied'`, return `applied` unchanged
   *      (idempotent no-op).
   *   3. Resolve the job's currently-accepted base manifest hash (D3): the
   *      `result_manifest_hash` of the most-recent OTHER `apply_status='applied'`
   *      workspace_patch, else the committed `workspace_snapshot`'s `sha256`
   *      (== manifestHash by the canonical-upload convention), else null.
   *   4. `applied` iff the accepted base is non-null AND equals the patch's declared
   *      `patchBaseManifestHash`; otherwise `conflict_quarantined` (NEVER auto-applies).
   *      Persist `base_manifest_hash` / `result_manifest_hash` / `apply_status` on the
   *      row. On `applied`, the accepted base advances to `result_manifest_hash`.
   * The fence lock serializes concurrent applies against the same lease, so a loser
   * observing an advanced base is quarantined.
   */
  recordPatchApplyState(
    input: ActiveFenceRequest & {
      identifier: string;
      patchObjectKey: string;
      patchBaseManifestHash: string;
      patchResultManifestHash: string;
    },
  ): Promise<PatchApplyStateResult>;
  readSecretHandle(
    input: ActiveFenceRequest & { handle: string },
  ): Promise<JobSecretHandle | null>;
  /**
   * DAT-004 — the fenced, lease-scoped RESOLVE authorization of an opaque execution
   * secret handle. Runs `guardActiveFence` FIRST (a stale/terminal/revoked fence
   * throws `JobFenceError` BEFORE any handle row is read — the documented precedence).
   * Then, under the held fence lock:
   *   1. Load the WIDENED handle row for (org, job, handle); throw
   *      `SecretResolveRejection('unknown_ref_kind')` (coarse, non-disclosing) if absent.
   *   2. Re-derive the dispatching owner from the LOCKED `jobs` row
   *      (`executorPrincipalKind/Id`) — the `ActiveFenceRequest` carries NO owner.
   *   3. For an owner-bound handle, re-check the owner's ACTIVE `company_memberships`
   *      in the SAME tx (membership loss DENIES).
   *   4. `authorizeSecretResolve` re-verifies the materialization×use_policy invariant,
   *      the sandbox-local-vs-network-destination invariant, the `bound_target_generation`
   *      pin (D5) against the LIVE lease generation, and the owner binding.
   *   5. Write the audit-as-columns (last_resolved_at + resolve_count++) in the SAME tx.
   * Returns the AUTHORIZED non-secret binding ONLY — NEVER a secret value (the value is
   * resolved behind the fence by the server broker dispatch). Throws `JobFenceError`
   * (guard) or `SecretResolveRejection` (authorization).
   */
  resolveExecutionSecret(
    input: ActiveFenceRequest & { handle: string; appliedPolicyVersion?: number | null },
  ): Promise<AuthorizedSecretResolution>;
  completeAttempt(
    input: ActiveFenceRequest & { terminalStatus: TerminalCompletionStatus },
  ): Promise<JobAttempt>;
  recordServiceHealth(
    input: ActiveFenceRequest & { serviceInstanceId: string; healthStatus: ServiceHealthStatus },
  ): Promise<ServiceInstance>;
  applyProjectionReceipt(
    input: ActiveFenceRequest & { projection?: ProjectionInput },
  ): Promise<GuardedFenceResult>;
  // JOB-006 — the worker's fence-guarded ACK of a control command. Gates on the
  // active fence FIRST (bare-fence back-compat returns the guarded proof only); when
  // an `ack` is supplied it records the worker's echoed status idempotently.
  ackControlCommand(
    input: ActiveFenceRequest & { ack?: ControlCommandAckInput },
  ): Promise<GuardedFenceResult & { ackOutcome?: ControlCommandAckOutcome }>;
  /** The highest contiguous accepted event sequence for an attempt (0 = none).
   * A read used to build the cumulative ACK on the stale-fence/terminal paths;
   * NOT a governed mutator (no fence gate — it writes nothing). */
  readAcceptedThroughSeq(input: {
    organizationId: string;
    companyId: string;
    jobId: string;
    attemptId: string;
  }): Promise<number>;
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
  // ---------------------------------------------------------------------------
  // JOB-006 — cancellation + reaper/reconciliation surface. These are SERVER
  // authority (operator/system), not worker-fenced: they lock the authoritative
  // job/attempt/lease rows directly and PERMANENTLY revoke the fence. They never
  // gate on `guardActiveFence` (the reaper acts precisely when a fence is stale),
  // so they are classified UNGUARDED in the fence-surface contract.
  //
  // The cancellation transaction marks the requested state and queues a
  // monotonically-sequenced E1 cancel command bound to the current lease fence
  // (idempotent: one cancel command per lease).
  requestCancellation(input: RequestCancellationInput): Promise<CancellationOutcome>;
  /** Un-ACKed control commands for a lease, in monotonic sequence — the "return
   * pending controls until ACK" read the poll/renew path surfaces. */
  listPendingControlCommands(input: {
    organizationId: string;
    leaseId: string;
  }): Promise<QueuedControlCommand[]>;
  /** Allocate attempt N+1 for a reaped attempt under the job lock, guarded so two
   * concurrent creators produce EXACTLY one N+1 attempt + one attempt-ready row
   * (the loser observes it). Creates the uniquely-constrained attempt + its outbox
   * row with an immutable backoff, or observes an already-created successor. */
  allocateRetryAttempt(input: RetryAllocationInput): Promise<RetryAllocationResult>;
  /** The reaper: revoke expired leases' fences and converge each to a new attempt,
   * a terminal result, or a dead-letter. Bounded batch; idempotent per lease. */
  reapExpiredLeases(input: ReapExpiredLeasesInput): Promise<ReapExpiredLeasesResult>;
  /**
   * DAT-006 — record a device-authenticated ORPHAN quarantine row. UNGUARDED by
   * design: an orphan is precisely a DEAD-FENCE output, so calling `guardActiveFence`
   * (or `resolveWorkerFenceContext`) would throw `stale_fence` and defeat the purpose —
   * same species as the reaper methods above, which "act when the fence is stale".
   * Authorization is DEVICE-ONLY: an in-tx recheck of `targetId` + `deviceGeneration`
   * against the CURRENT execution-target authority (a bumped/disabled/absent target →
   * `OrphanQuarantineRejection('target_revoked')`), mirroring `guardActiveFence`'s
   * generation cutoff WITHOUT the lease/fence step. It NEVER raises `stale_fence`.
   *
   * The row carries `status='quarantined'` (excluded from the committed partial-unique,
   * so it STRUCTURALLY cannot collide-update a committed attempt) + the frozen
   * `quarantine/` object key + retained sha256/size/sensitivity/kind + the observed
   * (non-authoritative) lease/fence provenance + the frozen `QUARANTINE_REASONS` reason.
   * Idempotent on the quarantined partial-unique natural key
   * (org, job, attempt, identifier): a replayed finalize is a DO-NOTHING that returns
   * the existing quarantined row (`alreadyQuarantined:true`). `observedLeaseId` /
   * `observedFenceToken` are recorded, NEVER used for authorization.
   */
  recordOrphanQuarantine(input: OrphanQuarantineInput): Promise<OrphanQuarantineResult>;
  // ---------------------------------------------------------------------------
  // JOB-011 — SERVER-authored governance projections (approvals / runtime
  // decisions / completion policy). These gate on `guardActiveFence` FIRST (a
  // stale or old-generation fence throws before any effect), then write ONLY the
  // projection receipt / control-command row — never the aggregate (the existing
  // product/runtime authority owns that, driven by the server-side bridge). The
  // WORKER cannot reach these: they are invoked from the control-plane bridge, not
  // from any worker route, and the E1 control audience stays `control_channel`.
  /** Write ONE governance receipt linking an EXISTING aggregate to this attempt,
   * guarded by the active fence. Idempotent on the (org, company, kind, identity)
   * unique — a replay for the same identity is a DO-NOTHING no-op. */
  recordGovernedProjection(
    input: ActiveFenceRequest & { projection: GovernedProjectionInput },
  ): Promise<GovernedProjectionRecordResult>;
  /** Flip a pending governance receipt to `applied` (idempotent double-resolve safe),
   * guarded by the active fence. */
  markGovernedProjectionApplied(
    input: ActiveFenceRequest & {
      projectionKind: GovernedProjectionKind;
      sourceIdentity: string;
    },
  ): Promise<{ applied: boolean }>;
  /** Queue ONE server-authored E1 governance result control on the active fence.
   * Reuses the JOB-006 monotonic-sequence + (org, lease, command id) idempotency;
   * NEVER drives a status transition (that is the aggregate authority's job). */
  queueGovernedControlCommand(
    input: ActiveFenceRequest & { control: GovernedControlCommandInput },
  ): Promise<GovernedControlQueueResult>;
  /** Acquire the FOR UPDATE lock on the active fence's lease+attempt (via the shared
   * `guardActiveFence`) and validate the fence, WITHOUT writing anything. A guard-only
   * lock: it lets a caller serialize two concurrent same-fence critical sections whose
   * aggregate authority has no native create-dedup (the product-approval bridge uses it
   * to close a create TOCTOU before its receipt fast-path). Throws JobFenceError on a
   * stale/old-generation/terminal fence, exactly like every governed mutator. */
  lockActiveFence(input: ActiveFenceRequest): Promise<{ lease: Lease; attempt: JobAttempt }>;
}

/** JOB-004 terminal attempt statuses a governed completion may drive an attempt to. */
export type TerminalCompletionStatus = "succeeded" | "failed" | "cancelled" | "expired";

/** JOB-004 non-`pending` service-instance health a governed health record may set. */
export type ServiceHealthStatus = "healthy" | "stopped" | "lost" | "interrupted";

/** The result of a governed mutator whose durable storage is not yet built
 * (JOB-005/006/011). It proves ONLY that the active-fence guard admitted the
 * caller; no governed row is written or read. */
export interface GuardedFenceResult {
  leaseId: string;
  attemptId: string;
  guarded: true;
}

/** DAT-003 — the disposition of a fenced `recordPatchApplyState`. `applyStatus` is
 * the control-plane outcome; `resolvedBaseManifestHash` is the job's accepted base
 * the patch was revalidated against (null when the job has no committed base yet);
 * `resultManifestHash` is the base the accepted chain advances to on `applied`;
 * `alreadyApplied` marks an idempotent no-op re-apply. */
export interface PatchApplyStateResult {
  applyStatus: "applied" | "conflict_quarantined";
  resolvedBaseManifestHash: string | null;
  resultManifestHash: string;
  alreadyApplied: boolean;
}

/** DAT-004 — the AUTHORIZED non-secret resolution the guarded mutator returns to the
 * server broker dispatch. It carries the handle's non-secret binding + the LOCKED
 * lease's company (the broker dispatch scope) + the post-increment audit count.
 * There is NO value field — a secret value is NEVER returned by the control plane;
 * the server resolves it behind the fence via the legacy brokers (invariants #1/#3/#4). */
export interface AuthorizedSecretResolution {
  handleId: string;
  refKind: SecretRefKind;
  refId: string;
  materialization: "proxy" | "env" | "file";
  usePolicy: "fence_proxy" | "remote_server_fenced" | "sandbox_local_only";
  destination: string | null;
  ownerPrincipalKind: string | null;
  ownerPrincipalId: string | null;
  boundTargetGeneration: number | null;
  /** The LOCKED lease's company — the scope the broker dispatch resolves the value in. */
  companyId: string;
  /** Post-increment resolve audit count (control-plane metadata only). */
  resolveCount: number;
}

// ---------------------------------------------------------------------------
// JOB-006 — cancellation, control commands, and reaper/retry types.

/** The control-command kinds JOB-006/JOB-011 queue (a subset of the frozen E1
 * CONTROL_COMMAND_KINDS). JOB-006 issues `cancel`/`drain`/`graceful_stop` from the
 * reaper/cancellation; JOB-011 queues the SERVER-authored `product_approval_result`
 * / `runtime_decision_result` when the existing product/runtime authority resolves. */
export type JobControlCommandKind =
  | "cancel"
  | "drain"
  | "graceful_stop"
  | "product_approval_result"
  | "runtime_decision_result";

/** JOB-011 — the SERVER-authored governance projection kinds. A `product_approval`
 * links an `approvals` row, a `runtime_decision` links an `agent_runtime_decisions`
 * row, and a `completion_policy` links the issue completion-policy snapshot. Distinct
 * from the JOB-005 worker projection kinds (attempt_started/attempt_terminal). */
export type GovernedProjectionKind =
  | "product_approval"
  | "runtime_decision"
  | "completion_policy"
  // JOB-012 — links a `cost_events` row (the authoritative, server-priced charge for
  // one accepted worker usage event) to the distributed attempt. Keyed for idempotency
  // by (projectionKind, sourceIdentity=`cost:{company}:{eventId}`); written `applied` in
  // the SAME tenant transaction as the charge.
  | "authoritative_cost"
  // JOB-013 — links an `activity_log` row (the transactional audit for one accepted
  // state/control/accounting mutation) to the distributed attempt; written `applied`
  // in the SAME tenant tx as the activity insert. sourceIdentity=`activity:{company}:{eventId}`.
  | "activity_audit"
  // JOB-014 — links a `task_outputs` row (the EXISTING task-output projection for one
  // accepted artifact/result event) to the distributed attempt; written `applied` in the
  // SAME tenant tx as the upsert. sourceIdentity=`output:{company}:{acceptedEventId}`.
  | "output_projection"
  // JOB-014 — the terminal-winner-once guard. Links the run-summary `issue_comments` row
  // when a summary is posted (aggregateKind `issue_comments`), else the attempt itself
  // (aggregateKind `job_attempts`, targetAggregateId=attemptId) for a null-issue/opt-out
  // winner. It is the REPLAY guard consulted BEFORE completeAttempt (which makes the
  // attempt terminal, so a legitimate winner-retry can no longer pass the fence).
  // sourceIdentity=`task_terminal:{company}:{terminalEventId}`.
  | "task_terminal";

/** ONE server-authored governance projection linking an EXISTING product/runtime
 * aggregate to a distributed attempt. Keyed for idempotency by (projectionKind,
 * sourceIdentity); `status` is `pending` until the authority resolves (then
 * `markGovernedProjectionApplied` flips it), or `applied` directly for a
 * synchronously-resolved decision. `aggregateKind` names the linked aggregate table. */
export interface GovernedProjectionInput {
  projectionKind: GovernedProjectionKind;
  aggregateKind: string;
  sourceIdentity: string;
  sourceDigest: string;
  targetAggregateId: string;
  status: "pending" | "applied";
}

/** The E1 result a JOB-011 governance control carries. The body is validated with
 * the frozen `controlCommandV1Schema` BEFORE insert (fail-closed) by the caller. */
export interface GovernedControlCommandInput {
  commandId: string;
  commandKind: "product_approval_result" | "runtime_decision_result";
  /** The already-validated, reconstructable E1 control command body. */
  commandBody: Record<string, unknown>;
  now: Date;
}

export type GovernedProjectionRecordResult = { receiptId: string | null; applied: boolean };
export type GovernedControlQueueResult = { command: QueuedControlCommand | null; queued: boolean };

/** The closed worker-ACK statuses (frozen E1 CONTROL_ACK_STATUSES). */
export type ControlCommandAckStatus = "accepted" | "completed" | "rejected" | "stale";

/** A durable control command queued for a fenced run. `command` is the
 * reconstructable frozen wire body; the columns are the authoritative facts. */
export interface QueuedControlCommand {
  id: string;
  organizationId: string;
  companyId: string;
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  leaseId: string;
  commandId: string;
  commandSeq: number;
  commandKind: JobControlCommandKind;
  fenceToken: string;
  reason: string | null;
  graceful: boolean | null;
  command: Record<string, unknown>;
  ackStatus: ControlCommandAckStatus | null;
}

/** The worker's echoed ACK for a control command, applied by `ackControlCommand`. */
export interface ControlCommandAckInput {
  commandId: string;
  status: ControlCommandAckStatus;
  observedAt: Date;
  detail: string | null;
}

export interface ControlCommandAckOutcome {
  applied: boolean;
  status: ControlCommandAckStatus;
}

export interface RequestCancellationInput {
  organizationId: string;
  companyId: string;
  jobId: string;
  reason: string;
  graceful: boolean;
  /** Caller-supplied command id — a retried cancellation with the SAME id replays
   * the queued command (idempotent), never a second command. */
  commandId: string;
  now: Date;
}

export type CancellationStatus =
  | "queued"
  | "already_requested"
  | "cancelled"
  | "no_active_lease"
  | "job_terminal"
  | "not_found";

export interface CancellationOutcome {
  status: CancellationStatus;
  command: QueuedControlCommand | null;
}

export interface RetryAllocationInput {
  organizationId: string;
  companyId: string;
  jobId: string;
  /** The reaped attempt this retry succeeds. Retry allocation is a no-op unless
   * this is still the LATEST attempt (max == reapedAttemptNumber). */
  reapedAttemptId: string;
  reapedAttemptNumber: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  now: Date;
  /**
   * DEP-009 capacity-claim TRANSFER. When the reaped attempt HELD an Organization
   * capacity slot, the successor attempt N+1 must inherit `capacity_claim_state='held'`
   * so `resolveOrgCapacityUsage` (which counts only 'held' attempts) preserves org
   * occupancy across the reap→retry boundary — otherwise N+1 is minted 'unclaimed'
   * (schema default) and, because offer-time capacity enforcement is DEFERRED, leases
   * and runs UNCOUNTED, exceeding the org cap. Race-safe: the reaper releases attempt N
   * and re-claims on N+1 in ONE txn under `pg_advisory_xact_lock('aoa:org-capacity')`,
   * so a concurrent admit never observes the gap. Omitted/false ⇒ N+1 stays 'unclaimed'
   * (flag-off submits and the public allocateRetryAttempt path preserve prior behavior).
   */
  inheritCapacityHeld?: boolean;
}

export type RetryAllocationStatus = "created" | "observed" | "not_latest" | "job_missing";

export interface RetryAllocationResult {
  status: RetryAllocationStatus;
  attemptNumber: number | null;
  attemptId: string | null;
  backoffUntil: Date | null;
}

export interface ReapExpiredLeasesInput {
  organizationId: string;
  now: Date;
  limit: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

/**
 * MIG-002 convergence: one attempt the reaper drove to a TERMINAL job outcome.
 *
 * `onAttemptTerminal` has exactly one producer (the worker's accepted event batch), so a
 * reaped attempt leaves its heartbeat run pinned at `running`. The sweeper projects a run
 * terminal for each of these through the existing `canary-terminal-projection` handler — one
 * projection, two triggers, so the ownership predicate is never duplicated.
 *
 * Listed ONLY when the JOB reached a terminal state. A reaped lease whose attempt expired but
 * whose job was RETRIED is deliberately absent: that job is about to run again, and projecting
 * a run terminal for it would leave two executors.
 */
export interface ReapedTerminalAttempt {
  readonly companyId: string;
  readonly jobId: string;
  readonly attemptId: string;
  /** Frozen `TerminalEventStatus` vocabulary: succeeded | failed | cancelled | expired. */
  readonly terminalStatus: "succeeded" | "failed" | "cancelled" | "expired";
}

export interface ReapExpiredLeasesResult {
  scanned: number;
  revoked: number;
  retried: number;
  deadLettered: number;
  cancelled: number;
  finalized: number;
  /** ADDITIVE (MIG-002). Existing consumers read only the counts and are unchanged. */
  terminalized: ReapedTerminalAttempt[];
}

/** DAT-006 — the device-authenticated orphan quarantine record input. All identity is
 * device-scoped (targetId + deviceGeneration re-derived from the current authority);
 * `observedLeaseId`/`observedFenceToken` are recorded as observed provenance only. */
export interface OrphanQuarantineInput {
  organizationId: string;
  targetId: string;
  deviceGeneration: number;
  jobId: string;
  attemptNumber: number;
  identifier: string;
  quarantineObjectKey: string;
  sha256: string;
  sizeBytes: number;
  sensitivity: string;
  kind: string;
  /** A member of the frozen `QUARANTINE_REASONS`. */
  reason: string;
  observedLeaseId: string;
  observedFenceToken: string;
}

/** DAT-006 — the outcome of recording an orphan quarantine row. `alreadyQuarantined`
 * marks an idempotent DO-NOTHING replay (the existing row is returned unchanged). */
export interface OrphanQuarantineResult {
  artifact: JobArtifact;
  alreadyQuarantined: boolean;
}

/** Exponential retry backoff (ms) for the Nth reaped attempt, bounded by `maxMs`. */
export function computeRetryBackoffMs(
  reapedAttemptNumber: number,
  baseMs: number,
  maxMs: number,
): number {
  const base = Math.max(0, Math.floor(baseMs));
  const ceiling = Math.max(base, Math.floor(maxMs));
  if (base === 0) return 0;
  const exponent = Math.max(0, reapedAttemptNumber - 1);
  // Cap the shift so 2 ** exponent never overflows before the min() clamp.
  const factor = exponent >= 30 ? 2 ** 30 : 2 ** exponent;
  return Math.min(ceiling, base * factor);
}

// ---------------------------------------------------------------------------
// JOB-005 — fenced event ingest + projection idempotency (behind acceptEvent /
// applyProjectionReceipt, which STILL gate on the active fence first).

/** ONE server-validated worker event, ready for durable append. `recomputedDigest`
 * is the server's SHA-256 of the RFC 8785 canonical bytes (E1) — the repo never
 * recomputes it. `terminalStatus` is set only for a `terminal` event. */
export interface AcceptEventInput {
  eventId: string;
  sequence: number;
  eventType: string;
  fenceToken: string;
  suppliedDigest: string;
  recomputedDigest: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  terminalStatus: TerminalCompletionStatus | null;
}

/** A contiguous, in-order batch (validated + digest-checked by the service). */
export interface AcceptEventBatchInput {
  events: readonly AcceptEventInput[];
}

/** The cumulative-ACK-shaped outcome of a fenced batch append. `stale_fence` and
 * `terminal` are NOT produced here — they surface as a thrown `JobFenceError` from
 * the guard, which the ingest service maps into the cumulative ACK. */
export interface EventIngestOutcome {
  status: "accepted" | "gap" | "hash_mismatch";
  acceptedThroughSeq: number;
  rejectedEventId?: string;
}

/** The job/attempt transition an accepted state-changing event drives. */
export type ProjectionTransition =
  | { kind: "attempt_started" }
  | { kind: "attempt_terminal"; terminalStatus: TerminalCompletionStatus };

/** ONE projection driven by ONE accepted event, keyed for idempotency by
 * (projectionKind, sourceIdentity) with the driving event digest pinned. */
export interface ProjectionInput {
  projectionKind: "attempt_started" | "attempt_terminal";
  sourceIdentity: string;
  sourceDigest: string;
  targetAggregateId: string;
  transition: ProjectionTransition;
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

  // JOB-004 — THE common active-fence guard every governed mutator gates on.
  //
  // Locks the lease + its attempt by the COMPLETE presented identity + fence and
  // evaluates expiry against a FRESH database `clock_timestamp()` in the SAME locked
  // read (never transaction-start or JavaScript time). A superseded fence, re-homed
  // worker/target, or bumped generation matches no row (→ stale_fence); a terminal
  // attempt is `attempt_terminal`; a non-active or freshly-expired lease is
  // `stale_fence`. The shared pure predicate `isActiveFence` is the final authority
  // on admission; `classifyFence` supplies the closed refusal code.
  async function guardActiveFence(
    request: ActiveFenceRequest,
  ): Promise<{ lease: Lease; attempt: JobAttempt }> {
    // JOB-007 — locked current-generation recheck. The lease+attempt are locked FOR
    // UPDATE; the target is LEFT-joined (read only, NEVER locked here — the revocation
    // authority locks the target, so locking it here would invert the target->lease
    // order and risk a deadlock). A revocation cutoff bumps
    // execution_targets.device_generation, so a lease whose stored target_generation no
    // longer equals the target's LIVE generation (or whose target is disabled/gone) is
    // refused `target_revoked` — the instant the cutoff commits, BEFORE the per-Org
    // fanout marks the lease `revoked`. This is why a crash after the cutoff but before
    // fanout still denies every old-generation governed effect: the recheck is the gate,
    // the fanout is only convergence.
    const [row] = await tx
      .select({
        lease: leases,
        attempt: jobAttempts,
        expiresFresh: sql<boolean>`(${leases.expiresAt} > clock_timestamp())`,
        targetCurrentGeneration: executionTargets.deviceGeneration,
        targetStatus: executionTargets.status,
      })
      .from(leases)
      .innerJoin(jobAttempts, and(
        eq(jobAttempts.organizationId, leases.organizationId),
        eq(jobAttempts.companyId, leases.companyId),
        eq(jobAttempts.jobId, leases.jobId),
        eq(jobAttempts.id, leases.attemptId),
      ))
      .leftJoin(executionTargets, and(
        eq(executionTargets.id, leases.targetId),
        eq(executionTargets.targetAuthorityKey, leases.targetAuthorityKey),
      ))
      .where(and(
        eq(leases.organizationId, request.organizationId),
        eq(leases.companyId, request.companyId),
        eq(leases.jobId, request.jobId),
        eq(leases.attemptId, request.attemptId),
        eq(leases.attemptNumber, request.attemptNumber),
        eq(leases.id, request.leaseId),
        eq(leases.workerId, request.workerId),
        eq(leases.targetId, request.targetId),
        eq(leases.targetAuthorityKey, request.targetAuthorityKey),
        eq(leases.targetGeneration, request.targetGeneration),
        eq(leases.profileHash, request.profileHash),
        eq(leases.providerConstraintHash, request.providerConstraintHash),
        eq(leases.fence, request.fence),
      ))
      .for("update", { of: [leases, jobAttempts] })
      .limit(1);
    if (!row) throw new JobFenceError("stale_fence");
    // The generation cutoff is the dominant fact: a bumped/disabled/absent target
    // revokes the fence immediately, regardless of attempt status. `target_generation`
    // in the lease was matched above, so comparing the target's LIVE generation to the
    // lease's stored one is the cutoff test.
    if (
      row.targetCurrentGeneration === null ||
      row.targetCurrentGeneration !== request.targetGeneration ||
      row.targetStatus === "disabled"
    ) {
      throw new JobFenceError("target_revoked");
    }
    const snapshot = {
      leaseStatus: row.lease.status,
      attemptStatus: row.attempt.status,
      expiresFresh: row.expiresFresh === true,
    };
    const refusal = classifyFence(snapshot);
    if (refusal) throw new JobFenceError(refusal);
    // Defense in depth: the shared predicate must agree with the classification.
    if (!isActiveFence(snapshot)) throw new JobFenceError("stale_fence");
    return { lease: row.lease, attempt: row.attempt };
  }

  // JOB-005 — apply ONE accepted event's job/attempt projection idempotently.
  // The caller has ALREADY passed the active-fence guard (which holds the attempt
  // row lock), so the transitions here are the legal, single-winner moves:
  //   * attempt_started → attempt leased->running + job queued->running.
  //   * attempt_terminal → attempt (any non-terminal) -> the terminal status.
  // Every transition is CONDITIONAL on the current status, so a replay or an
  // in-batch attempt_started→terminal pair is a safe no-op. The projection receipt
  // (unique per (kind, source_identity)) records the applied projection; a replay
  // conflicts DO NOTHING (the ingest also rejects a changed digest upstream as
  // hash_mismatch, so a same-identity/different-digest receipt never reaches here).
  async function applyProjectionForFence(
    fence: ActiveFenceRequest,
    projection: ProjectionInput,
  ): Promise<void> {
    if (projection.transition.kind === "attempt_started") {
      await tx.update(jobAttempts).set({
        status: "running",
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobAttempts.organizationId, fence.organizationId),
        eq(jobAttempts.companyId, fence.companyId),
        eq(jobAttempts.jobId, fence.jobId),
        eq(jobAttempts.id, fence.attemptId),
        eq(jobAttempts.status, "leased"),
      ));
      await tx.update(jobs).set({
        status: "running",
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobs.organizationId, fence.organizationId),
        eq(jobs.companyId, fence.companyId),
        eq(jobs.id, fence.jobId),
        eq(jobs.status, "queued"),
      ));
    } else {
      await tx.update(jobAttempts).set({
        status: projection.transition.terminalStatus,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobAttempts.organizationId, fence.organizationId),
        eq(jobAttempts.companyId, fence.companyId),
        eq(jobAttempts.jobId, fence.jobId),
        eq(jobAttempts.id, fence.attemptId),
        notInArray(jobAttempts.status, [...TERMINAL_ATTEMPT_STATUSES]),
      ));
    }
    await tx.insert(jobProjectionReceipts).values({
      organizationId: fence.organizationId,
      companyId: fence.companyId,
      projectionKind: projection.projectionKind,
      sourceIdentity: projection.sourceIdentity,
      sourceDigest: projection.sourceDigest,
      jobId: fence.jobId,
      attemptId: fence.attemptId,
      sourceFence: fence.fence,
      status: "applied",
      targetAggregateId: projection.targetAggregateId,
      appliedAt: sql`clock_timestamp()`,
      createdAt: sql`clock_timestamp()`,
    }).onConflictDoNothing({
      target: [
        jobProjectionReceipts.organizationId,
        jobProjectionReceipts.companyId,
        jobProjectionReceipts.projectionKind,
        jobProjectionReceipts.sourceIdentity,
      ],
    });
  }

  // JOB-006 job aggregate terminal states (distinct from attempt terminal states).
  const JOB_TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "dead_letter"] as const;

  // JOB-007 — release the attempt's Organization capacity slot with ONE conditional
  // 'held' -> 'released' transition. Called from every terminal convergence path
  // (worker completion, reaper, cancellation); exactly-once because only the first
  // caller that observes 'held' flips it. A no-op when the attempt never held a slot.
  async function releaseAttemptCapacitySlot(input: {
    organizationId: string;
    attemptId: string;
  }): Promise<void> {
    await tx.update(jobAttempts).set({
      capacityClaimState: "released",
      capacityReleasedAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(jobAttempts.organizationId, input.organizationId),
      eq(jobAttempts.id, input.attemptId),
      eq(jobAttempts.capacityClaimState, "held"),
    ));
  }

  function toQueuedControlCommand(
    row: typeof jobControlCommands.$inferSelect,
  ): QueuedControlCommand {
    return {
      id: row.id,
      organizationId: row.organizationId,
      companyId: row.companyId,
      jobId: row.jobId,
      attemptId: row.attemptId,
      attemptNumber: row.attemptNumber,
      leaseId: row.leaseId,
      commandId: row.commandId,
      commandSeq: row.commandSeq,
      commandKind: row.commandKind as JobControlCommandKind,
      fenceToken: row.fenceToken,
      reason: row.reason,
      graceful: row.graceful,
      command: row.command,
      ackStatus: row.ackStatus as ControlCommandAckStatus | null,
    };
  }

  // JOB-006 — allocate attempt N+1 for a reaped attempt UNDER the job lock.
  //
  // ONE-WINNER RACE: the job row is locked FOR UPDATE first, then `max(attempt_number)`
  // is read under that lock. The allocation proceeds ONLY when the reaped attempt is
  // still the latest (max == reapedAttemptNumber) — a concurrent creator that already
  // advanced the chain leaves max > reapedAttemptNumber, so the second caller observes
  // the successor instead of minting a spurious N+2. The unique
  // (organization_id, company_id, job_id, attempt_number) constraint is the backstop:
  // a losing INSERT is a no-op (ON CONFLICT DO NOTHING) and reports `observed`. The
  // attempt-ready outbox row is created in the SAME transaction (unique per attempt),
  // and the backoff is written once (immutable) onto the new attempt.
  async function allocateRetry(input: RetryAllocationInput): Promise<RetryAllocationResult> {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.organizationId, input.organizationId),
      eq(jobs.companyId, input.companyId),
      eq(jobs.id, input.jobId),
    )).for("update").limit(1);
    if (!job) return { status: "job_missing", attemptNumber: null, attemptId: null, backoffUntil: null };

    const [{ maxNum }] = await tx.select({
      maxNum: sql<number>`COALESCE(MAX(${jobAttempts.attemptNumber}), 0)`,
    }).from(jobAttempts).where(and(
      eq(jobAttempts.organizationId, input.organizationId),
      eq(jobAttempts.companyId, input.companyId),
      eq(jobAttempts.jobId, input.jobId),
    ));
    const latest = Number(maxNum);
    if (latest !== input.reapedAttemptNumber) {
      // A successor already exists (or the reaped attempt is not the head) — observe.
      return { status: "not_latest", attemptNumber: latest, attemptId: null, backoffUntil: null };
    }

    const [reaped] = await tx.select().from(jobAttempts).where(and(
      eq(jobAttempts.organizationId, input.organizationId),
      eq(jobAttempts.companyId, input.companyId),
      eq(jobAttempts.jobId, input.jobId),
      eq(jobAttempts.id, input.reapedAttemptId),
    )).limit(1);
    if (!reaped) return { status: "job_missing", attemptNumber: null, attemptId: null, backoffUntil: null };

    const nextNumber = input.reapedAttemptNumber + 1;
    const backoffMs = computeRetryBackoffMs(
      input.reapedAttemptNumber,
      input.baseBackoffMs,
      input.maxBackoffMs,
    );
    const backoffUntil = new Date(input.now.getTime() + backoffMs);

    // DEP-009 capacity-claim TRANSFER. If the reaped attempt held an Organization
    // capacity slot, mint N+1 already 'held' so org occupancy is conserved across the
    // reap→retry boundary. The `job_attempts_capacity_claim_check` CHECK requires a
    // 'held' row to carry a non-null workload type + claimed_at (and null released_at),
    // so copy the reaped attempt's workload type (guaranteed non-null when it was held —
    // release keeps the workload type) and stamp a fresh claim instant. When the reaped
    // attempt was 'unclaimed' (flag-off submit), leave N+1 at the schema default so a
    // never-counted slot is not over-counted.
    const capacityTransfer = input.inheritCapacityHeld
      ? {
          capacityClaimState: "held" as const,
          capacityWorkloadType: reaped.capacityWorkloadType,
          capacityClaimedAt: input.now,
        }
      : {};

    const [insertedAttempt] = await tx.insert(jobAttempts).values({
      organizationId: input.organizationId,
      companyId: input.companyId,
      jobId: input.jobId,
      attemptNumber: nextNumber,
      status: "pending",
      ...capacityTransfer,
      // Copy the reaped attempt's immutable placement snapshot verbatim so N+1 is
      // dispatchable to the same target (re-placement is JOB-009, out of scope).
      placementDisposition: reaped.placementDisposition,
      placementOwner: reaped.placementOwner,
      placementTargetId: reaped.placementTargetId,
      placementTargetClass: reaped.placementTargetClass,
      placementTargetScope: reaped.placementTargetScope,
      placementTargetGeneration: reaped.placementTargetGeneration,
      placementProfileHash: reaped.placementProfileHash,
      placementProviderConstraintHash: reaped.placementProviderConstraintHash,
      placementFallbackDisposition: reaped.placementFallbackDisposition,
      placementReasonCode: reaped.placementReasonCode,
      placementMode: reaped.placementMode,
      placementLeaseEligible: reaped.placementLeaseEligible,
      placementInputDigest: reaped.placementInputDigest,
      placementPolicyDigest: reaped.placementPolicyDigest,
      placementDecidedAt: reaped.placementDecidedAt,
      backoffUntil,
      createdAt: input.now,
      updatedAt: input.now,
    }).onConflictDoNothing({
      target: [
        jobAttempts.organizationId,
        jobAttempts.companyId,
        jobAttempts.jobId,
        jobAttempts.attemptNumber,
      ],
    }).returning({ id: jobAttempts.id });
    if (!insertedAttempt) {
      return { status: "observed", attemptNumber: nextNumber, attemptId: null, backoffUntil: null };
    }

    // Reset the job to queued at the backoff instant and enqueue the attempt-ready
    // outbox row (unique per attempt) — both idempotent against a terminal job.
    await tx.update(jobs).set({
      status: "queued",
      availableAt: backoffUntil,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(jobs.organizationId, input.organizationId),
      eq(jobs.companyId, input.companyId),
      eq(jobs.id, input.jobId),
      notInArray(jobs.status, [...JOB_TERMINAL_STATUSES]),
    ));
    await tx.insert(jobOutbox).values({
      organizationId: input.organizationId,
      companyId: input.companyId,
      jobId: input.jobId,
      attemptId: insertedAttempt.id,
      kind: "attempt_ready",
      status: "pending",
      payload: {
        organizationId: input.organizationId,
        companyId: input.companyId,
        jobId: input.jobId,
        attemptId: insertedAttempt.id,
        sourceKind: "retry",
      },
      availableAt: backoffUntil,
    }).onConflictDoNothing({
      target: [jobOutbox.organizationId, jobOutbox.attemptId, jobOutbox.kind],
    });

    return { status: "created", attemptNumber: nextNumber, attemptId: insertedAttempt.id, backoffUntil };
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
      // Lock the target BEFORE the worker so an overlapping poll and revoke acquire the two rows in
      // the same target->worker order (revokeTargetAuthority disables the target first, then the
      // workers); an inverted worker->target order here would let the two operations form a lock
      // cycle and deadlock. targetAuthorityKey is immutable for a target, so an unlocked one-column
      // probe is only used to choose the lock mode before the real, ordered lock is taken.
      const [targetProbe] = await tx.select({
        targetAuthorityKey: executionTargets.targetAuthorityKey,
      }).from(executionTargets).where(eq(executionTargets.id, input.targetId)).limit(1);
      if (!targetProbe) return null;

      const targetQuery = tx.select(placementTargetColumns)
        .from(executionTargets)
        .where(and(
          eq(executionTargets.id, input.targetId),
          eq(executionTargets.targetAuthorityKey, targetProbe.targetAuthorityKey),
        ))
        .limit(1);
      // aoa_app deliberately has SELECT-only visibility over null-Org platform
      // targets. The Decision #124 shared advisory handoff supplies the cutoff
      // guard; requesting FOR UPDATE here would require forbidden global DML.
      const [target] = targetProbe.targetAuthorityKey === "platform"
        ? await targetQuery
        : await targetQuery.for("update");
      if (!target) return null;

      // Revalidate the worker against the just-locked target's authority key (and its organization
      // via the row's own columns); a mismatch means the worker was re-homed and is not authorized.
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
        eq(workers.targetAuthorityKey, target.targetAuthorityKey),
      )).for("update").limit(1);
      if (!worker) return null;

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
      const emptyMetrics: LeaseCertificateScanMetrics = {
        hitsObserved: 0,
        hitsSaturated: false,
        missesObserved: 0,
        missesSaturated: false,
        scanExhausted: false,
        cardinalityObserved: 0,
        cardinalitySaturated: false,
      };
      if (input.admissibleWorkloadTypes.length === 0) {
        return { candidates: [], certificateMetrics: emptyMetrics };
      }

      // Global-head candidate claim: exact static-certificate anti-join (notExists), one immutable
      // ordered head, FOR UPDATE SKIP LOCKED. Written inline (no extracted where builder) so the
      // frozen anti-join contract can read the exact conjunct set from this one .where(and(...)).
      const candidates = await tx.select({
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

      // Payload-free telemetry probe. A separate read (no FOR UPDATE, never contends with the claim)
      // over the same eligibility MINUS the certificate anti-join, tagging each of at most 4097
      // eligible-shaped rows with whether an existing certificate would suppress it. hits + misses
      // are counted in memory and reported as min(count, 4096) plus a saturation flag.
      const probeRows = await tx.select({
        suppressed: sql<boolean>`${exists(tx.select({ value: sql<number>`1` })
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
          )))}`,
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
        ))
        .limit(4097);
      const hitsRaw = probeRows.reduce((total, row) => total + (row.suppressed === true ? 1 : 0), 0);
      const missesRaw = probeRows.length - hitsRaw;

      // Bounded cardinality probe: at most 4097 of this worker/target/authority's certificate rows.
      const cardinalityRows = await tx.select({ one: sql<number>`1` })
        .from(workerLeaseRejections)
        .where(and(
          eq(workerLeaseRejections.workerId, input.workerId),
          eq(workerLeaseRejections.targetId, input.targetId),
          eq(workerLeaseRejections.targetAuthorityKey, input.targetAuthorityKey),
          eq(workerLeaseRejections.eligibilityVersion, input.eligibilityVersion),
          eq(workerLeaseRejections.staticContextHash, input.staticContextHash),
        ))
        .limit(4097);

      const certificateMetrics: LeaseCertificateScanMetrics = {
        hitsObserved: Math.min(hitsRaw, 4096),
        hitsSaturated: hitsRaw > 4096,
        missesObserved: Math.min(missesRaw, 4096),
        missesSaturated: missesRaw > 4096,
        scanExhausted: candidates.length === 256,
        cardinalityObserved: Math.min(cardinalityRows.length, 4096),
        cardinalitySaturated: cardinalityRows.length > 4096,
      };
      return { candidates, certificateMetrics };
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
      if (!Number.isSafeInteger(input.limit) || input.limit <= 0 ||
          !Number.isSafeInteger(input.cardinalityLimit) || input.cardinalityLimit <= 0) {
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

    // ---- JOB-004 conditional renewal ---------------------------------------
    async renewLease(input) {
      // Gate on the common active-fence guard (locks the lease+attempt, classifies
      // stale_fence/attempt_terminal). Then extend ONLY the expiry using a FRESH SQL
      // clock inside the conditional mutation — never a transaction-start or
      // JavaScript time. The WHERE re-asserts `status = 'active'` and
      // `expires_at > clock_timestamp()` so a lease that expires WHILE the
      // transaction runs (clock advances past a fixed stored expiry) renews zero
      // rows → stale_fence. No authority column (fence/generation/target) is touched.
      await guardActiveFence(input);
      const renewInterval = Math.max(1, Math.floor(input.leaseDurationMs));
      const [lease] = await tx.update(leases).set({
        expiresAt: sql`clock_timestamp() + make_interval(secs => ${renewInterval}::double precision / 1000)`,
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
        eq(leases.status, "active"),
        gt(leases.expiresAt, sql`clock_timestamp()`),
      )).returning();
      if (!lease || !lease.expiresAt) throw new JobFenceError("stale_fence");
      // JOB-006 — surface a queued, un-ACKed cancel/graceful_stop control command to
      // the worker through the frozen renew response. The worker learns of a pending
      // control on renewal and drains gracefully; the durable command remains for the
      // explicit control-ACK path. Only an un-ACKed cancel/graceful_stop drives the
      // frozen `cancelRequested` flag.
      const [pendingCancel] = await tx.select({
        reason: jobControlCommands.reason,
      }).from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, input.leaseId),
        inArray(jobControlCommands.commandKind, ["cancel", "graceful_stop"]),
        isNull(jobControlCommands.ackStatus),
      )).orderBy(asc(jobControlCommands.commandSeq)).limit(1);
      // The exact renewed response body — stored in the receipt AND returned, so a
      // lost-response replay reproduces this exact renewal and cannot extend twice.
      const body: Record<string, unknown> = {
        protocolVersion: 1,
        workerId: input.workerId,
        jobId: input.jobId,
        attempt: input.attemptNumber,
        leaseId: input.leaseId,
        fenceToken: input.fence,
        expiresAt: lease.expiresAt.toISOString(),
        cancelRequested: Boolean(pendingCancel),
        cancelReason: pendingCancel?.reason ?? null,
        extensions: [],
      };
      await tx.insert(workerOperationReceipts).values({
        organizationId: input.organizationId,
        companyId: input.companyId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        leaseId: input.leaseId,
        operation: "lease_renew",
        workerId: input.workerId,
        targetId: input.targetId,
        targetAuthorityKey: input.targetAuthorityKey,
        targetGeneration: input.targetGeneration,
        profileHash: input.profileHash,
        idempotencyKey: input.idempotencyKey,
        semanticDigest: input.semanticDigest,
        outcome: body,
        expiresAt: lease.expiresAt,
        createdAt: sql`clock_timestamp()`,
      });
      return { lease, body };
    },

    // ---- JOB-004 closed governed-mutator surface ---------------------------
    // Every method below gates on `guardActiveFence` BEFORE touching (or reading) a
    // governed row. The four with a kernel table do a thin real mutation; the three
    // whose storage is not yet built are stubbed but STILL gated.
    async acceptEvent(input) {
      // Fence FIRST (throws stale_fence / attempt_terminal), then durable append.
      // The ingest service maps a thrown JobFenceError into the cumulative ACK
      // (stale_fence / terminal); this method only returns accepted/gap/hash.
      const { lease, attempt } = await guardActiveFence(input);
      if (!input.batch) return { leaseId: lease.id, attemptId: attempt.id, guarded: true };
      const events = input.batch.events;
      const guarded = { leaseId: lease.id, attemptId: attempt.id, guarded: true as const };

      // Prior accepted state for THIS attempt, read under the guard's attempt lock
      // (no concurrent appender can interleave: guardActiveFence holds FOR UPDATE).
      // Stored sequences are always a contiguous 1..N (we never leave a gap), so the
      // cumulative acceptedThroughSeq is simply MAX(sequence).
      const priorRows = await tx.select({
        seq: jobEvents.sequence,
        eventId: jobEvents.eventId,
        digest: jobEvents.eventDigest,
      }).from(jobEvents).where(and(
        eq(jobEvents.organizationId, input.organizationId),
        eq(jobEvents.attemptId, input.attemptId),
      ));
      const acceptedThroughSeq = priorRows.reduce((max, row) => Math.max(max, row.seq), 0);
      const storedBySeq = new Map(priorRows.map((row) => [row.seq, row]));

      // (1) Per-event digest integrity: a supplied digest disagreeing with the
      // server recomputation is hash_mismatch, before any persistence.
      for (const event of events) {
        if (event.suppliedDigest !== event.recomputedDigest) {
          return { ...guarded, ingest: { status: "hash_mismatch", acceptedThroughSeq, rejectedEventId: event.eventId } };
        }
      }

      // (2) Gap: the batch head is beyond the next contiguous sequence.
      const firstSeq = events[0]!.sequence;
      if (firstSeq > acceptedThroughSeq + 1) {
        return { ...guarded, ingest: { status: "gap", acceptedThroughSeq } };
      }

      // (3) Replay-region integrity: any event overlapping an already-accepted
      // sequence must match the stored id + digest exactly, else hash_mismatch.
      for (const event of events) {
        if (event.sequence > acceptedThroughSeq) break; // events are contiguous ascending
        const stored = storedBySeq.get(event.sequence);
        if (!stored || stored.eventId !== event.eventId || stored.digest !== event.recomputedDigest) {
          return { ...guarded, ingest: { status: "hash_mismatch", acceptedThroughSeq, rejectedEventId: event.eventId } };
        }
      }

      // (4) New tail (seq > acceptedThroughSeq): contiguous by batch validation and
      // starting exactly at acceptedThroughSeq+1. Append idempotently, then project.
      const newEvents = events.filter((event) => event.sequence > acceptedThroughSeq);
      if (newEvents.length > 0) {
        // Reject a REUSED eventId in the new tail BEFORE any write. The (org,event_id)
        // unique is org-wide, and the guard's FOR UPDATE lock guarantees a genuine new
        // event never pre-exists (a legitimate crash-replay lands in the replay region
        // at seq <= acceptedThroughSeq, handled above) — so any existing id here is
        // reuse. An untargeted ON CONFLICT DO NOTHING would silently drop the row while
        // the projection loop + cumulative ACK still advanced, wedging the stream on a
        // phantom sequence; instead fail the whole batch as hash_mismatch with no write.
        const existingTail = await tx.select({ eventId: jobEvents.eventId }).from(jobEvents).where(and(
          eq(jobEvents.organizationId, input.organizationId),
          inArray(jobEvents.eventId, newEvents.map((event) => event.eventId)),
        ));
        if (existingTail.length > 0) {
          return { ...guarded, ingest: { status: "hash_mismatch", acceptedThroughSeq, rejectedEventId: existingTail[0]!.eventId } };
        }
        await tx.insert(jobEvents).values(newEvents.map((event) => ({
          organizationId: input.organizationId,
          companyId: input.companyId,
          jobId: input.jobId,
          attemptId: input.attemptId,
          attemptNumber: input.attemptNumber,
          leaseId: input.leaseId,
          eventId: event.eventId,
          sequence: event.sequence,
          eventType: event.eventType,
          fenceToken: event.fenceToken,
          eventDigest: event.recomputedDigest,
          event: event.payload,
          occurredAt: event.occurredAt,
        })));
        for (const event of newEvents) {
          if (event.eventType === "attempt_started") {
            await applyProjectionForFence(input, {
              projectionKind: "attempt_started",
              sourceIdentity: event.eventId,
              sourceDigest: event.recomputedDigest,
              targetAggregateId: input.attemptId,
              transition: { kind: "attempt_started" },
            });
          } else if (event.eventType === "terminal" && event.terminalStatus) {
            await applyProjectionForFence(input, {
              projectionKind: "attempt_terminal",
              sourceIdentity: event.eventId,
              sourceDigest: event.recomputedDigest,
              targetAggregateId: input.attemptId,
              transition: { kind: "attempt_terminal", terminalStatus: event.terminalStatus },
            });
          }
        }
      }
      const newAcceptedThroughSeq = newEvents.length > 0
        ? events[events.length - 1]!.sequence
        : acceptedThroughSeq;
      return { ...guarded, ingest: { status: "accepted", acceptedThroughSeq: newAcceptedThroughSeq } };
    },

    async authorizeArtifactCommit(input) {
      await guardActiveFence(input);
      const [row] = await tx.insert(jobArtifacts).values({
        organizationId: input.organizationId,
        jobId: input.jobId,
        identifier: input.identifier,
      }).returning();
      return row!;
    },

    async commitArtifactVersion(input) {
      // Fence FIRST: a stale/terminal/revoked fence throws JobFenceError here,
      // BEFORE any verification — so `stale_fence` always precedes hash/size/prefix.
      await guardActiveFence(input);
      // Verification (fence is active). Order is stable: prefix → tenant → size → sha.
      if (!input.prefixValid) throw new ArtifactCommitRejection("wrong_prefix");
      if (!input.tenantValid) throw new ArtifactCommitRejection("tenant_mismatch");
      if (input.declaredSizeBytes !== input.actualSizeBytes) throw new ArtifactCommitRejection("size_mismatch");
      if (input.declaredSha256 !== input.actualSha256) throw new ArtifactCommitRejection("hash_mismatch");

      // Best-effort per-(org,job) ordinal, computed under the held fence lock. Not a
      // DB uniqueness constraint (concurrent attempts of one job may share a number).
      const [{ next } = { next: 1 }] = await tx
        .select({ next: sql<number>`COALESCE(MAX(${jobArtifacts.versionNumber}), 0) + 1` })
        .from(jobArtifacts)
        .where(and(
          eq(jobArtifacts.organizationId, input.organizationId),
          eq(jobArtifacts.jobId, input.jobId),
          eq(jobArtifacts.status, "committed"),
        ));

      // Idempotent committed insert on the partial-unique natural key
      // (organization_id, job_id, attempt, identifier) WHERE status='committed'.
      const inserted = await tx.insert(jobArtifacts).values({
        organizationId: input.organizationId,
        jobId: input.jobId,
        identifier: input.identifier,
        objectKey: input.objectKey,
        sha256: input.actualSha256,
        sizeBytes: input.actualSizeBytes,
        contentType: input.contentType,
        kind: input.kind,
        sensitivity: input.sensitivity,
        retention: input.retention,
        attempt: input.attemptNumber,
        leaseId: input.leaseId,
        fenceToken: input.fence,
        versionNumber: Number(next),
        status: "committed",
        committedAt: sql`clock_timestamp()`,
      }).onConflictDoNothing({
        target: [jobArtifacts.organizationId, jobArtifacts.jobId, jobArtifacts.attempt, jobArtifacts.identifier],
        where: sql`status = 'committed'`,
      }).returning();
      if (inserted[0]) return inserted[0];

      // Conflict → the artifact was already committed (idempotent replay): return the
      // existing committed row unchanged (same result, no second version).
      const [existing] = await tx.select().from(jobArtifacts).where(and(
        eq(jobArtifacts.organizationId, input.organizationId),
        eq(jobArtifacts.jobId, input.jobId),
        eq(jobArtifacts.attempt, input.attemptNumber),
        eq(jobArtifacts.identifier, input.identifier),
        eq(jobArtifacts.status, "committed"),
      )).limit(1);
      if (!existing) throw new ArtifactCommitRejection("tenant_mismatch");
      return existing;
    },

    async recordPatchApplyState(input) {
      // Fence FIRST: a stale/terminal/revoked fence throws JobFenceError here,
      // BEFORE any patch-row read — so `stale_fence` always precedes the apply
      // decision, and no content is probed against a dead fence.
      await guardActiveFence(input);

      // Load the target committed workspace_patch row under the held fence lock.
      const [target] = await tx.select().from(jobArtifacts).where(and(
        eq(jobArtifacts.organizationId, input.organizationId),
        eq(jobArtifacts.jobId, input.jobId),
        eq(jobArtifacts.attempt, input.attemptNumber),
        eq(jobArtifacts.identifier, input.identifier),
        eq(jobArtifacts.kind, "workspace_patch"),
        eq(jobArtifacts.status, "committed"),
      )).limit(1);
      if (!target) throw new PatchApplyRejection("patch_not_committed");
      // Bind the parsed base/result digests to the immutable committed object: the
      // presented object key MUST equal the committed row's key.
      if (target.objectKey !== input.patchObjectKey) throw new PatchApplyRejection("object_key_mismatch");

      // Idempotent no-op: an already-applied patch returns `applied` unchanged.
      if (target.applyStatus === "applied") {
        return {
          applyStatus: "applied",
          resolvedBaseManifestHash: target.baseManifestHash,
          resultManifestHash: target.resultManifestHash ?? input.patchResultManifestHash,
          alreadyApplied: true,
        };
      }
      // Sticky quarantine: a conflict-quarantined patch NEVER auto-flips to applied
      // on re-invocation — "mismatched base never auto-applies" means it requires an
      // explicit review/re-submission, not a silent re-decision if the accepted base
      // later happens to coincide with its declared base.
      if (target.applyStatus === "conflict_quarantined") {
        return {
          applyStatus: "conflict_quarantined",
          resolvedBaseManifestHash: null,
          resultManifestHash: target.resultManifestHash ?? input.patchResultManifestHash,
          alreadyApplied: false,
        };
      }

      // Resolve the job's currently-accepted base manifest hash (D3): the
      // result_manifest_hash of the most-recent OTHER applied workspace_patch, else
      // the committed workspace_snapshot's sha256 (== manifestHash by the canonical
      // upload convention). Job-scoped (the base chain spans attempts).
      const [appliedBase] = await tx
        .select({ hash: jobArtifacts.resultManifestHash })
        .from(jobArtifacts)
        .where(and(
          eq(jobArtifacts.organizationId, input.organizationId),
          eq(jobArtifacts.jobId, input.jobId),
          eq(jobArtifacts.kind, "workspace_patch"),
          eq(jobArtifacts.applyStatus, "applied"),
          ne(jobArtifacts.identifier, input.identifier),
        ))
        .orderBy(desc(jobArtifacts.committedAt), desc(jobArtifacts.versionNumber))
        .limit(1);

      // `resolvedBaseManifestHash` is the INFORMATIVE current accepted base surfaced on
      // a quarantine (latest applied patch result, else the most-recent committed
      // snapshot). The apply DECISION is computed separately: in the applied-chain it
      // is equality with that head; at bootstrap it is EXISTENCE of the DECLARED base
      // among the job's committed snapshots — a job may commit >1 snapshot (a retry
      // re-captures a base), so a "most-recent snapshot" decision would wrongly
      // over-reject a clean apply whose base is an earlier committed snapshot.
      let resolvedBaseManifestHash: string | null = appliedBase?.hash ?? null;
      let applyMatch = resolvedBaseManifestHash !== null && input.patchBaseManifestHash === resolvedBaseManifestHash;
      if (appliedBase?.hash == null) {
        const [mostRecentSnapshot] = await tx
          .select({ hash: jobArtifacts.sha256 })
          .from(jobArtifacts)
          .where(and(
            eq(jobArtifacts.organizationId, input.organizationId),
            eq(jobArtifacts.jobId, input.jobId),
            eq(jobArtifacts.kind, "workspace_snapshot"),
            eq(jobArtifacts.status, "committed"),
          ))
          .orderBy(desc(jobArtifacts.committedAt), desc(jobArtifacts.versionNumber))
          .limit(1);
        resolvedBaseManifestHash = mostRecentSnapshot?.hash ?? null;
        const [declaredSnapshot] = await tx
          .select({ hash: jobArtifacts.sha256 })
          .from(jobArtifacts)
          .where(and(
            eq(jobArtifacts.organizationId, input.organizationId),
            eq(jobArtifacts.jobId, input.jobId),
            eq(jobArtifacts.kind, "workspace_snapshot"),
            eq(jobArtifacts.status, "committed"),
            eq(jobArtifacts.sha256, input.patchBaseManifestHash),
          ))
          .limit(1);
        applyMatch = declaredSnapshot != null;
      }

      // decideApply: a matched base applies; a mismatched (or absent) base is
      // conflict-quarantined and NEVER auto-applies.
      const applyStatus: "applied" | "conflict_quarantined" = applyMatch ? "applied" : "conflict_quarantined";

      await tx.update(jobArtifacts).set({
        baseManifestHash: input.patchBaseManifestHash,
        resultManifestHash: input.patchResultManifestHash,
        applyStatus,
        updatedAt: sql`clock_timestamp()`,
      }).where(eq(jobArtifacts.id, target.id));

      return {
        applyStatus,
        resolvedBaseManifestHash,
        resultManifestHash: input.patchResultManifestHash,
        alreadyApplied: false,
      };
    },

    async readSecretHandle(input) {
      // A secret-handle READ is a governed surface too: a stale fence must not read.
      await guardActiveFence(input);
      const [row] = await tx.select().from(jobSecretHandles).where(and(
        eq(jobSecretHandles.organizationId, input.organizationId),
        eq(jobSecretHandles.jobId, input.jobId),
        eq(jobSecretHandles.handle, input.handle),
      )).limit(1);
      return row ?? null;
    },

    async loadAgentAdapterBinding(input) {
      const [row] = await tx
        .select({ adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)))
        .limit(1);
      return row ?? null;
    },

    async insertExecutionSecretHandle(input) {
      // Idempotent per (organization, job, ref_kind, ref_id) over ACTIVE rows. A
      // placement replay must not mint a second handle for the same reference: the
      // envelope would then carry two handles for one env var, and the frozen
      // duplicate-handle check only catches a repeated handle ID, not a repeated ref.
      const [existing] = await tx
        .select({ handle: jobSecretHandles.handle })
        .from(jobSecretHandles)
        .where(and(
          eq(jobSecretHandles.organizationId, input.organizationId),
          eq(jobSecretHandles.jobId, input.jobId),
          eq(jobSecretHandles.refKind, input.refKind),
          eq(jobSecretHandles.refId, input.refId),
          eq(jobSecretHandles.status, "active"),
        ))
        .limit(1);
      if (existing) return { handle: existing.handle, minted: false };

      await tx.insert(jobSecretHandles).values({
        organizationId: input.organizationId,
        jobId: input.jobId,
        handle: input.handle,
        refKind: input.refKind,
        refId: input.refId,
        materialization: input.materialization,
        materializationTarget: input.envTarget,
        usePolicy: input.usePolicy,
        // A `sandbox_local_only` handle may NEVER bind a network destination — the
        // resolver re-checks this, and minting one would be the coercion DAT-004's
        // own review already had to fix once.
        destination: null,
        boundTargetGeneration: input.boundTargetGeneration,
        ownerPrincipalKind: input.ownerPrincipalKind,
        ownerPrincipalId: input.ownerPrincipalId,
        status: "active",
        resolveCount: 0,
      });
      return { handle: input.handle, minted: true };
    },

    async resolveExecutionSecret(input) {
      // Fence FIRST: a stale/terminal/revoked fence throws JobFenceError here, BEFORE
      // any handle row is read or any owner/membership/broker access — so `stale_fence`/
      // `target_revoked`/`attempt_terminal` always precede the resolve decision (the
      // DAT-002 no-early-probe + fence-first precedence). The guard proves the LIVE
      // target generation (equal to the lease's stored one) and holds the lease lock.
      // Every tenant field (org/company/job/attempt/target-generation) is proven by the
      // guard's locking identity match, so `input.*` are authoritative below.
      await guardActiveFence(input);

      // Load the WIDENED handle row for (org, job, handle). company + attempt are proven
      // solely by the fence guard (matches readSecretHandle — do not loosen).
      const [row] = await tx.select().from(jobSecretHandles).where(and(
        eq(jobSecretHandles.organizationId, input.organizationId),
        eq(jobSecretHandles.jobId, input.jobId),
        eq(jobSecretHandles.handle, input.handle),
      )).limit(1);
      // A missing handle is a coarse, NON-DISCLOSING refusal (never reveals whether a
      // foreign handle exists) — mapped to `malformed` at the wire, like every reject.
      if (!row) throw new SecretResolveRejection("unknown_ref_kind");

      // Re-derive the dispatching owner from the LOCKED `jobs` row — the ActiveFenceRequest
      // carries NO owner. Scoped to the fence's org + the LOCKED lease's company (the
      // company↔org seam: job_secret_handles is org-scoped, provider_credentials is
      // company-scoped; the job binds them, resolved here, never trusted from the wire).
      const [jobRow] = await tx
        .select({
          executorPrincipalKind: jobs.executorPrincipalKind,
          executorPrincipalId: jobs.executorPrincipalId,
        })
        .from(jobs)
        .where(and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.companyId, input.companyId),
          eq(jobs.id, input.jobId),
        ))
        .limit(1);
      // The fence guard already proved the lease's (org, company, job) identity, so the
      // job row must exist; a missing row is a non-disclosing refusal, never an oracle.
      if (!jobRow) throw new SecretResolveRejection("unknown_ref_kind");

      // For an owner-bound handle, re-check the owner's ACTIVE company membership in the
      // SAME tx (membership loss DENIES — re-check-at-resolve, invariant #5). `null` when
      // the handle is not owner-bound (no membership query needed).
      const ownerBound = !!(row.ownerPrincipalKind && row.ownerPrincipalId);
      let ownerMembershipActive: boolean | null = null;
      if (ownerBound) {
        const [membership] = await tx
          .select({ id: companyMemberships.id })
          .from(companyMemberships)
          .where(and(
            eq(companyMemberships.companyId, input.companyId),
            eq(companyMemberships.principalType, row.ownerPrincipalKind!),
            eq(companyMemberships.principalId, row.ownerPrincipalId!),
            eq(companyMemberships.status, "active"),
          ))
          .limit(1);
        ownerMembershipActive = membership != null;
      }

      // DSK-001 Lane B (D12/3 + D12/4) — the device credential, read in THIS transaction,
      // as a sibling of the owner-membership re-check above.
      //
      // Only for `device_local`: every other ref_kind performs no query at all, so this
      // costs nothing on the paths that do not need it. The lookup is scoped by the
      // LOCKED lease's company — `provider_credentials` is company-scoped while
      // `job_secret_handles` is org-scoped, and the job is what binds them — so a handle
      // can never reach across companies by naming a foreign credential id.
      //
      // The read is NOT locked, deliberately: neither `handle.status` nor
      // `ownerMembershipActive` is either, and for all three revocation takes effect on
      // the NEXT resolve. Taking `FOR SHARE` on a company-scoped credentials table from
      // inside a transaction already holding the lease/attempt locks would add a new
      // lock-ordering surface for a strictly narrower window than the mechanism already
      // tolerates. Recorded as a decision (Lane B design D-B5), not an oversight.
      let deviceCredential: {
        state: string | null;
        ownerUserId: string | null;
        executionTargetId: string | null;
      } | null = null;
      if (row.refKind === "device_local" && row.refId) {
        const [credential] = await tx
          .select({
            state: providerCredentials.state,
            ownerUserId: providerCredentials.ownerUserId,
            executionTargetId: providerCredentials.executionTargetId,
          })
          .from(providerCredentials)
          .where(and(
            eq(providerCredentials.id, row.refId),
            eq(providerCredentials.companyId, input.companyId),
          ))
          .limit(1);
        deviceCredential = credential ?? null;
      }

      // The PURE decision (D6): re-verify the materialization×use_policy invariant, the
      // sandbox-local-vs-network-destination invariant, the bound_target_generation pin
      // (D5) against the LIVE lease generation, revocation, and the owner binding.
      const decision = authorizeSecretResolve({
        handle: {
          status: row.status ?? "",
          refKind: row.refKind,
          refId: row.refId,
          materialization: row.materialization,
          usePolicy: row.usePolicy,
          destination: row.destination,
          boundTargetGeneration: row.boundTargetGeneration,
          ownerPrincipalKind: row.ownerPrincipalKind,
          ownerPrincipalId: row.ownerPrincipalId,
        },
        jobOwner: {
          executorPrincipalKind: jobRow.executorPrincipalKind,
          executorPrincipalId: jobRow.executorPrincipalId,
        },
        // The guard proved lease.targetGeneration === input.targetGeneration === the
        // LIVE execution_targets.device_generation (else target_revoked), so the
        // request's generation IS the live one (and is non-null typed).
        ownerMembershipActive,
        liveTargetGeneration: input.targetGeneration,
        // The device the job is actually placed on. `guardActiveFence` already proved
        // this is the LIVE target under lock, so it is authoritative here.
        liveTargetId: input.targetId,
        deviceCredential,
      });
      if (decision !== "admit") throw new SecretResolveRejection(decision);

      // Audit-as-columns (D4): record the authorized resolution in the SAME tx — NEVER a
      // value. resolve_count is a monotonic control-plane counter (COALESCE for the
      // additive-widen null seam); last_resolved_at is a fresh DB clock. DAT-005-D3:
      // when a governed egress resolve supplies the network-policy version, persist it in
      // the SAME audit UPDATE (`applied_policy_version`) — an unrecordable version fails
      // the tx and DENIES the egress (fail-closed). A non-egress resolve omits it and the
      // column is left unchanged.
      const auditSet: Record<string, unknown> = {
        lastResolvedAt: sql`clock_timestamp()`,
        resolveCount: sql`COALESCE(${jobSecretHandles.resolveCount}, 0) + 1`,
        updatedAt: sql`clock_timestamp()`,
      };
      if (input.appliedPolicyVersion !== undefined && input.appliedPolicyVersion !== null) {
        auditSet.appliedPolicyVersion = input.appliedPolicyVersion;
      }
      const [audited] = await tx.update(jobSecretHandles).set(auditSet)
        .where(eq(jobSecretHandles.id, row.id))
        .returning({ resolveCount: jobSecretHandles.resolveCount });

      // `authorizeSecretResolve` proved these enum/ref fields non-null + in-range.
      return {
        handleId: row.handle,
        refKind: row.refKind as SecretRefKind,
        refId: row.refId ?? "",
        materialization: row.materialization as "proxy" | "env" | "file",
        usePolicy: row.usePolicy as "fence_proxy" | "remote_server_fenced" | "sandbox_local_only",
        destination: row.destination,
        ownerPrincipalKind: row.ownerPrincipalKind,
        ownerPrincipalId: row.ownerPrincipalId,
        boundTargetGeneration: row.boundTargetGeneration,
        companyId: input.companyId,
        resolveCount: Number(audited?.resolveCount ?? 0),
      };
    },

    async completeAttempt(input) {
      const { attempt } = await guardActiveFence(input);
      // The guard proved the attempt is non-terminal and holds its row lock, so the
      // conditional update pins the exact locked status (no double-complete race).
      const [row] = await tx.update(jobAttempts).set({
        status: input.terminalStatus,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobAttempts.organizationId, input.organizationId),
        eq(jobAttempts.companyId, input.companyId),
        eq(jobAttempts.jobId, input.jobId),
        eq(jobAttempts.id, input.attemptId),
        eq(jobAttempts.status, attempt.status),
      )).returning();
      if (!row) throw new JobFenceError("attempt_terminal");
      // JOB-007: the attempt reached a terminal state — release its capacity slot.
      await releaseAttemptCapacitySlot({ organizationId: input.organizationId, attemptId: input.attemptId });
      return row;
    },

    async recordServiceHealth(input) {
      await guardActiveFence(input);
      const [row] = await tx.update(serviceInstances).set({
        status: input.healthStatus,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(serviceInstances.organizationId, input.organizationId),
        eq(serviceInstances.id, input.serviceInstanceId),
      )).returning();
      if (!row) throw new Error("service_instance_not_found");
      return row;
    },

    async applyProjectionReceipt(input) {
      // Fence FIRST, then (when a projection is supplied) apply it idempotently.
      // A bare fence identity (JOB-004 back-compat) just proves the guarded seam.
      const { lease, attempt } = await guardActiveFence(input);
      if (input.projection) await applyProjectionForFence(input, input.projection);
      return { leaseId: lease.id, attemptId: attempt.id, guarded: true };
    },

    async readAcceptedThroughSeq(input) {
      const [row] = await tx.select({
        maxSeq: sql<number>`COALESCE(MAX(${jobEvents.sequence}), 0)`,
      }).from(jobEvents).where(and(
        eq(jobEvents.organizationId, input.organizationId),
        eq(jobEvents.attemptId, input.attemptId),
      ));
      return Number(row?.maxSeq ?? 0);
    },

    async ackControlCommand(input) {
      // Fence FIRST (throws stale_fence / attempt_terminal). A bare-fence call (no
      // `ack`) is the JOB-004 back-compat proof that the guarded seam admitted.
      const { lease, attempt } = await guardActiveFence(input);
      if (!input.ack) return { leaseId: lease.id, attemptId: attempt.id, guarded: true };
      // Record the worker's echoed ACK idempotently. First terminal ACK wins: an
      // 'accepted' may progress to any status, but a stored terminal
      // (completed/rejected/stale) is never overwritten, and a replay of the same
      // status is a no-op re-write.
      const [row] = await tx.update(jobControlCommands).set({
        ackStatus: input.ack.status,
        ackObservedAt: input.ack.observedAt,
        ackDetail: input.ack.detail,
        ackedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, input.leaseId),
        eq(jobControlCommands.commandId, input.ack.commandId),
        or(
          isNull(jobControlCommands.ackStatus),
          eq(jobControlCommands.ackStatus, "accepted"),
          eq(jobControlCommands.ackStatus, input.ack.status),
        ),
      )).returning({ id: jobControlCommands.id });
      return {
        leaseId: lease.id,
        attemptId: attempt.id,
        guarded: true,
        ackOutcome: { applied: Boolean(row), status: input.ack.status },
      };
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

    // ---- JOB-006 cancellation + reaper/reconciliation ----------------------
    async requestCancellation(input) {
      // GLOBAL lock order lease -> attempt -> job (the job is locked LAST) — identical to
      // the reaper (reapExpiredLeases: lease -> attempt -> job) and the worker
      // event-ingest/projection path (guardActiveFence locks lease+attempt FOR UPDATE;
      // applyProjectionForFence then UPDATEs the job). Locking the job FIRST here would
      // form a wait-for cycle and deadlock (40P01) with a concurrent reap or terminal-event
      // flush on the same job. Lock the one live lease FIRST (at most one offered/active per
      // job — leases_active_per_attempt_idx partial unique).
      const [liveLease] = await tx.select().from(leases).where(and(
        eq(leases.organizationId, input.organizationId),
        eq(leases.companyId, input.companyId),
        eq(leases.jobId, input.jobId),
        inArray(leases.status, ["offered", "active"]),
      )).orderBy(desc(leases.createdAt)).for("update").limit(1);

      // Then the attempt: the live lease's attempt if present, else the latest attempt.
      const [attempt] = liveLease
        ? await tx.select().from(jobAttempts).where(and(
          eq(jobAttempts.organizationId, input.organizationId),
          eq(jobAttempts.companyId, input.companyId),
          eq(jobAttempts.jobId, input.jobId),
          eq(jobAttempts.id, liveLease.attemptId),
        )).for("update").limit(1)
        : await tx.select().from(jobAttempts).where(and(
          eq(jobAttempts.organizationId, input.organizationId),
          eq(jobAttempts.companyId, input.companyId),
          eq(jobAttempts.jobId, input.jobId),
        )).orderBy(desc(jobAttempts.attemptNumber)).for("update").limit(1);

      // Finally the job (LAST).
      const [job] = await tx.select().from(jobs).where(and(
        eq(jobs.organizationId, input.organizationId),
        eq(jobs.companyId, input.companyId),
        eq(jobs.id, input.jobId),
      )).for("update").limit(1);
      if (!job) return { status: "not_found", command: null };
      if ((JOB_TERMINAL_STATUSES as readonly string[]).includes(job.status)) {
        return { status: "job_terminal", command: null };
      }

      const lease = liveLease;
      if (!lease || !attempt || !lease.workerId || !lease.attemptNumber) {
        // No fenced worker to drain: the reaper's expired-lease scan never reaches an
        // unleased attempt (a queued/pending job, or a retry N+1 still in backoff), and
        // claimReadyOutbox will not dispatch a cancel_requested job — so it would hang
        // forever in cancel_requested. Finalize the cancellation DIRECTLY (all-or-nothing,
        // notInArray-terminal so a concurrent winner is never overwritten) under the locks
        // we already hold.
        if (attempt) {
          await tx.update(jobAttempts).set({
            status: "cancelled",
            updatedAt: sql`clock_timestamp()`,
          }).where(and(
            eq(jobAttempts.organizationId, input.organizationId),
            eq(jobAttempts.companyId, input.companyId),
            eq(jobAttempts.jobId, input.jobId),
            eq(jobAttempts.id, attempt.id),
            notInArray(jobAttempts.status, [...TERMINAL_ATTEMPT_STATUSES]),
          ));
        }
        await tx.update(jobs).set({
          status: "cancelled",
          updatedAt: sql`clock_timestamp()`,
        }).where(and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.companyId, input.companyId),
          eq(jobs.id, input.jobId),
          notInArray(jobs.status, [...JOB_TERMINAL_STATUSES]),
        ));
        // JOB-007: this directly-finalized attempt is terminal → release its slot.
        if (attempt) {
          await releaseAttemptCapacitySlot({ organizationId: input.organizationId, attemptId: attempt.id });
        }
        return { status: "cancelled", command: null };
      }

      // A fenced worker holds the lease: mark cancel_requested (conditional on non-terminal
      // → idempotent) and queue ONE cancel command; the worker ACKs + the reaper finalizes
      // when the lease expires or completes.
      await tx.update(jobs).set({
        status: "cancel_requested",
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobs.organizationId, input.organizationId),
        eq(jobs.companyId, input.companyId),
        eq(jobs.id, input.jobId),
        inArray(jobs.status, ["queued", "running", "cancel_requested"]),
      ));
      await tx.update(jobAttempts).set({
        status: "cancel_requested",
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobAttempts.organizationId, input.organizationId),
        eq(jobAttempts.companyId, input.companyId),
        eq(jobAttempts.jobId, input.jobId),
        eq(jobAttempts.id, attempt.id),
        inArray(jobAttempts.status, ["pending", "offered", "leased", "running", "cancel_requested"]),
      ));

      // Idempotent: one cancel command per lease. A prior cancel replays as-is.
      const [existing] = await tx.select().from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, lease.id),
        eq(jobControlCommands.commandKind, "cancel"),
      )).orderBy(asc(jobControlCommands.commandSeq)).limit(1);
      if (existing) return { status: "already_requested", command: toQueuedControlCommand(existing) };

      // Allocate the next monotonic per-lease sequence under the lease lock.
      const [{ maxSeq }] = await tx.select({
        maxSeq: sql<number>`COALESCE(MAX(${jobControlCommands.commandSeq}), 0)`,
      }).from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, lease.id),
      ));
      const commandSeq = Number(maxSeq) + 1;
      const commandBody: Record<string, unknown> = {
        protocolVersion: 1,
        audience: "control_channel",
        commandId: input.commandId,
        commandSeq,
        idempotencyKey: input.commandId,
        issuedAt: input.now.toISOString(),
        nonce: randomUUID(),
        organizationId: input.organizationId,
        companyId: input.companyId,
        workerId: lease.workerId,
        jobId: input.jobId,
        attempt: lease.attemptNumber,
        leaseId: lease.id,
        fenceToken: lease.fence,
        commandKind: "cancel",
        reason: input.reason,
        graceful: input.graceful,
      };
      const [inserted] = await tx.insert(jobControlCommands).values({
        organizationId: input.organizationId,
        companyId: input.companyId,
        jobId: input.jobId,
        attemptId: attempt.id,
        attemptNumber: lease.attemptNumber,
        leaseId: lease.id,
        commandId: input.commandId,
        commandSeq,
        commandKind: "cancel",
        fenceToken: lease.fence,
        reason: input.reason,
        graceful: input.graceful,
        command: commandBody,
      }).onConflictDoNothing({
        target: [
          jobControlCommands.organizationId,
          jobControlCommands.leaseId,
          jobControlCommands.commandId,
        ],
      }).returning();
      if (inserted) return { status: "queued", command: toQueuedControlCommand(inserted) };
      // Lost the (org, lease, command_id) race — re-read the winning row.
      const [row] = await tx.select().from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, lease.id),
        eq(jobControlCommands.commandId, input.commandId),
      )).limit(1);
      return { status: "already_requested", command: row ? toQueuedControlCommand(row) : null };
    },

    async listPendingControlCommands(input) {
      const rows = await tx.select().from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, input.leaseId),
        isNull(jobControlCommands.ackStatus),
      )).orderBy(asc(jobControlCommands.commandSeq));
      return rows.map(toQueuedControlCommand);
    },

    async allocateRetryAttempt(input) {
      return allocateRetry(input);
    },

    async reapExpiredLeases(input) {
      const bounded = Math.max(1, Math.min(128, Math.floor(input.limit)));
      const result: ReapExpiredLeasesResult = {
        scanned: 0, revoked: 0, retried: 0, deadLettered: 0, cancelled: 0, finalized: 0,
        terminalized: [],
      };
      const terminalAttempt = [...TERMINAL_ATTEMPT_STATUSES];

      // Claim a bounded batch of EXPIRED leases (offered past ack deadline, or any
      // offered/active past expiry). SKIP LOCKED so a concurrent tick/worker never
      // double-processes the same lease.
      const expired = await tx.select({
        id: leases.id,
        companyId: leases.companyId,
        jobId: leases.jobId,
        attemptId: leases.attemptId,
        attemptNumber: leases.attemptNumber,
      }).from(leases).where(and(
        eq(leases.organizationId, input.organizationId),
        inArray(leases.status, ["offered", "active"]),
        or(
          lte(leases.expiresAt, sql`clock_timestamp()`),
          and(eq(leases.status, "offered"), lte(leases.ackDeadline, sql`clock_timestamp()`)),
        ),
      )).orderBy(asc(leases.expiresAt), asc(leases.id))
        .limit(bounded)
        .for("update", { skipLocked: true });

      for (const lease of expired) {
        result.scanned += 1;
        if (!lease.companyId || !lease.jobId) continue;

        // Lock attempt THEN job (attempt→job order matches the worker projection
        // path, so the reaper never forms a lock cycle with a governed mutation).
        const [attempt] = await tx.select().from(jobAttempts).where(and(
          eq(jobAttempts.organizationId, input.organizationId),
          eq(jobAttempts.companyId, lease.companyId),
          eq(jobAttempts.jobId, lease.jobId),
          eq(jobAttempts.id, lease.attemptId),
        )).for("update").limit(1);
        if (!attempt) continue;
        const [job] = await tx.select().from(jobs).where(and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.companyId, lease.companyId),
          eq(jobs.id, lease.jobId),
        )).for("update").limit(1);
        if (!job) continue;

        const cancelling = job.status === "cancel_requested";
        const succeeded = attempt.status === "succeeded";
        const newLeaseStatus = succeeded ? "released" : cancelling ? "revoked" : "expired";

        // PERMANENTLY revoke the fence (conditional → idempotent if another reaper
        // already converged this lease). A losing update handled the outcome.
        const [revoked] = await tx.update(leases).set({
          status: newLeaseStatus,
          releasedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        }).where(and(
          eq(leases.organizationId, input.organizationId),
          eq(leases.id, lease.id),
          inArray(leases.status, ["offered", "active"]),
        )).returning({ id: leases.id });
        if (!revoked) continue;
        result.revoked += 1;
        // DEP-009: capture whether this attempt HELD an Organization capacity slot
        // BEFORE the release flips it to 'released'. Only a genuinely-held slot is
        // transferred to the retry successor (below) — a never-claimed ('unclaimed')
        // attempt must not mint a counted slot on N+1.
        const reapedHeldCapacity = attempt.capacityClaimState === "held";
        // JOB-007: the reaped lease's attempt is terminal-bound → release its
        // Organization capacity slot (idempotent, exactly-once across reaper/cancel/
        // revocation/cost paths that may all race on the same attempt).
        await releaseAttemptCapacitySlot({ organizationId: input.organizationId, attemptId: attempt.id });

        const finalizeJob = async (status: "succeeded" | "cancelled") => {
          await tx.update(jobs).set({
            status,
            updatedAt: sql`clock_timestamp()`,
          }).where(and(
            eq(jobs.organizationId, input.organizationId),
            eq(jobs.companyId, lease.companyId!),
            eq(jobs.id, lease.jobId!),
            notInArray(jobs.status, [...JOB_TERMINAL_STATUSES]),
          ));
        };

        if (succeeded) {
          // Worker committed a winning terminal then vanished: finalize, never retry.
          await finalizeJob("succeeded");
          result.finalized += 1;
          result.terminalized.push({
            companyId: lease.companyId, jobId: lease.jobId, attemptId: attempt.id,
            terminalStatus: "succeeded",
          });
        } else if (attempt.status === "cancelled" || cancelling) {
          await tx.update(jobAttempts).set({
            status: "cancelled",
            updatedAt: sql`clock_timestamp()`,
          }).where(and(
            eq(jobAttempts.organizationId, input.organizationId),
            eq(jobAttempts.companyId, lease.companyId),
            eq(jobAttempts.jobId, lease.jobId),
            eq(jobAttempts.id, attempt.id),
            notInArray(jobAttempts.status, terminalAttempt),
          ));
          await finalizeJob("cancelled");
          result.cancelled += 1;
          result.terminalized.push({
            companyId: lease.companyId, jobId: lease.jobId, attemptId: attempt.id,
            terminalStatus: "cancelled",
          });
        } else {
          // Abandoned mid-flight (or a worker-reported failure): fail this attempt,
          // then retry under the job lock or dead-letter on exhaustion.
          await tx.update(jobAttempts).set({
            status: "expired",
            updatedAt: sql`clock_timestamp()`,
          }).where(and(
            eq(jobAttempts.organizationId, input.organizationId),
            eq(jobAttempts.companyId, lease.companyId),
            eq(jobAttempts.jobId, lease.jobId),
            eq(jobAttempts.id, attempt.id),
            notInArray(jobAttempts.status, terminalAttempt),
          ));
          if (attempt.attemptNumber < job.maxAttempts) {
            const alloc = await allocateRetry({
              organizationId: input.organizationId,
              companyId: lease.companyId,
              jobId: lease.jobId,
              reapedAttemptId: attempt.id,
              reapedAttemptNumber: attempt.attemptNumber,
              baseBackoffMs: input.baseBackoffMs,
              maxBackoffMs: input.maxBackoffMs,
              now: input.now,
              // DEP-009: transfer the released capacity slot to the successor so the
              // reap→retry boundary conserves org occupancy (release + re-claim commit
              // atomically in this one reaper txn under the org-capacity advisory lock).
              inheritCapacityHeld: reapedHeldCapacity,
            });
            // DELIBERATELY NOT listed in `terminalized`: the job runs again, so its run has no
            // terminal yet. Projecting one here would leave two executors.
            if (alloc.status === "created") result.retried += 1;
          } else {
            await tx.update(jobs).set({
              status: "dead_letter",
              deadLetterReason: "retry_exhausted",
              updatedAt: sql`clock_timestamp()`,
            }).where(and(
              eq(jobs.organizationId, input.organizationId),
              eq(jobs.companyId, lease.companyId),
              eq(jobs.id, lease.jobId),
              notInArray(jobs.status, [...JOB_TERMINAL_STATUSES]),
            ));
            result.deadLettered += 1;
            result.terminalized.push({
              companyId: lease.companyId, jobId: lease.jobId, attemptId: attempt.id,
              terminalStatus: "failed",
            });
          }
        }
      }
      return result;
    },

    async recordOrphanQuarantine(input) {
      // DEVICE-ONLY authority recheck (NO guardActiveFence — an orphan is a dead-fence
      // output; guarding would throw stale_fence and defeat the purpose). Mirror the
      // generation-cutoff test in guardActiveFence, but WITHOUT the lease/fence join:
      // read the CURRENT execution-target authority and refuse if the target is gone,
      // disabled, or its live device_generation no longer equals the presented one.
      // NEVER stale_fence — refusals are target_revoked.
      const [target] = await tx
        .select({
          deviceGeneration: executionTargets.deviceGeneration,
          status: executionTargets.status,
        })
        .from(executionTargets)
        .where(eq(executionTargets.id, input.targetId))
        .limit(1);
      if (
        !target
        || target.deviceGeneration === null
        || target.deviceGeneration !== input.deviceGeneration
        || target.status === "disabled"
      ) {
        throw new OrphanQuarantineRejection("target_revoked");
      }

      // The (org, job) must exist in THIS tenant (RLS-scoped). The composite
      // job_artifacts_org_job_fk would otherwise raise a raw FK error; pre-checking
      // keeps the refusal coarse + non-disclosing (a foreign/absent job reads the same
      // as missing → unknown_job → the service maps it to `malformed`).
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.id, input.jobId),
        ))
        .limit(1);
      if (!job) throw new OrphanQuarantineRejection("unknown_job");

      // Bind the orphan to the caller's OWN target: the presented attempt must have been
      // PLACED on this device's target (jobAttempts.placementTargetId === the verified
      // device target). RLS is org-grain, but DAT-006 desktop/dedicated targets are
      // OWNER-scoped, so without this a fully-enrolled worker T_b could fabricate
      // dead-fence "orphan output" against ANOTHER owner's job/attempt in the same org.
      // A missing attempt or a foreign placement reads the SAME as an absent job →
      // coarse, non-disclosing unknown_job (the service maps it to `malformed`), never
      // revealing whether the foreign attempt exists.
      const [attempt] = await tx
        .select({ placementTargetId: jobAttempts.placementTargetId })
        .from(jobAttempts)
        .where(and(
          eq(jobAttempts.organizationId, input.organizationId),
          eq(jobAttempts.jobId, input.jobId),
          eq(jobAttempts.attemptNumber, input.attemptNumber),
        ))
        .limit(1);
      if (!attempt || attempt.placementTargetId !== input.targetId) {
        throw new OrphanQuarantineRejection("unknown_job");
      }

      // Idempotent orphan insert on the quarantined partial-unique natural key
      // (org, job, attempt, identifier) WHERE status='quarantined'. This index is
      // DISJOINT from the committed one, so an orphan NEVER collide-updates a committed
      // attempt row (Rule #7 / immutable-artifact invariant); a replayed finalize is a
      // DO-NOTHING that returns the existing quarantined row. A concurrent same-tenant
      // job delete can race the (org, job) precheck → the composite FK raises 23503;
      // normalize it to the coarse rejection (never a raw 500 / disclosing error).
      let inserted: Array<typeof jobArtifacts.$inferSelect>;
      try {
        inserted = await tx.insert(jobArtifacts).values({
          organizationId: input.organizationId,
          jobId: input.jobId,
          identifier: input.identifier,
          objectKey: input.quarantineObjectKey,
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          sensitivity: input.sensitivity,
          kind: input.kind,
          attempt: input.attemptNumber,
          status: "quarantined",
          orphanDisposition: "quarantined",
          quarantineReason: input.reason,
          observedLeaseId: input.observedLeaseId,
          observedFenceToken: input.observedFenceToken,
        }).onConflictDoNothing({
          target: [jobArtifacts.organizationId, jobArtifacts.jobId, jobArtifacts.attempt, jobArtifacts.identifier],
          where: sql`status = 'quarantined'`,
        }).returning();
      } catch (error) {
        if (error && typeof error === "object" && (error as { code?: string }).code === "23503") {
          throw new OrphanQuarantineRejection("unknown_job");
        }
        throw error;
      }
      if (inserted[0]) return { artifact: inserted[0], alreadyQuarantined: false };

      // Conflict → the orphan was already quarantined (idempotent replay): return the
      // existing quarantined row unchanged (no second row, no committed-row mutation).
      const [existing] = await tx.select().from(jobArtifacts).where(and(
        eq(jobArtifacts.organizationId, input.organizationId),
        eq(jobArtifacts.jobId, input.jobId),
        eq(jobArtifacts.attempt, input.attemptNumber),
        eq(jobArtifacts.identifier, input.identifier),
        eq(jobArtifacts.status, "quarantined"),
      )).limit(1);
      if (!existing) throw new OrphanQuarantineRejection("unknown_job");
      return { artifact: existing, alreadyQuarantined: true };
    },

    async recordGovernedProjection(input) {
      // Fence FIRST — a stale/old-generation fence throws before ANY effect, so the
      // server never links a governance aggregate to a dead attempt. Then write ONLY
      // the receipt (never a job/attempt transition — the aggregate authority owns
      // status). The (org, company, kind, source_identity) unique makes a replay a
      // DO-NOTHING no-op: on a redelivery the SAME aggregate is re-linked, never a
      // second one. This is the sole dedup guard for a non-idempotent aggregate
      // create (approvals.create has none), so the bridge reads the receipt BEFORE
      // driving the authority.
      await guardActiveFence(input);
      const { projection } = input;
      const [inserted] = await tx.insert(jobProjectionReceipts).values({
        organizationId: input.organizationId,
        companyId: input.companyId,
        projectionKind: projection.projectionKind,
        sourceIdentity: projection.sourceIdentity,
        sourceDigest: projection.sourceDigest,
        jobId: input.jobId,
        attemptId: input.attemptId,
        sourceFence: input.fence,
        status: projection.status,
        targetAggregateId: projection.targetAggregateId,
        aggregateKind: projection.aggregateKind,
        appliedAt: projection.status === "applied" ? sql`clock_timestamp()` : null,
        createdAt: sql`clock_timestamp()`,
      }).onConflictDoNothing({
        target: [
          jobProjectionReceipts.organizationId,
          jobProjectionReceipts.companyId,
          jobProjectionReceipts.projectionKind,
          jobProjectionReceipts.sourceIdentity,
        ],
      }).returning({ id: jobProjectionReceipts.id });
      if (inserted) return { receiptId: inserted.id, applied: projection.status === "applied" };
      // Conflict — the receipt already exists (idempotent replay). Re-read it so the
      // caller can reconcile to the ALREADY-linked aggregate without a second create.
      const [existing] = await tx.select({
        id: jobProjectionReceipts.id,
        status: jobProjectionReceipts.status,
      }).from(jobProjectionReceipts).where(and(
        eq(jobProjectionReceipts.organizationId, input.organizationId),
        eq(jobProjectionReceipts.companyId, input.companyId),
        eq(jobProjectionReceipts.projectionKind, projection.projectionKind),
        eq(jobProjectionReceipts.sourceIdentity, projection.sourceIdentity),
      )).limit(1);
      return {
        receiptId: existing?.id ?? null,
        applied: existing?.status === "applied",
      };
    },

    async markGovernedProjectionApplied(input) {
      await guardActiveFence(input);
      const [row] = await tx.update(jobProjectionReceipts).set({
        status: "applied",
        appliedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(jobProjectionReceipts.organizationId, input.organizationId),
        eq(jobProjectionReceipts.companyId, input.companyId),
        eq(jobProjectionReceipts.projectionKind, input.projectionKind),
        eq(jobProjectionReceipts.sourceIdentity, input.sourceIdentity),
        eq(jobProjectionReceipts.status, "pending"),
      )).returning({ id: jobProjectionReceipts.id });
      if (row) return { applied: true };
      // Idempotent double-resolve: a receipt already `applied` is still success.
      const [existing] = await tx.select({ status: jobProjectionReceipts.status })
        .from(jobProjectionReceipts).where(and(
          eq(jobProjectionReceipts.organizationId, input.organizationId),
          eq(jobProjectionReceipts.companyId, input.companyId),
          eq(jobProjectionReceipts.projectionKind, input.projectionKind),
          eq(jobProjectionReceipts.sourceIdentity, input.sourceIdentity),
        )).limit(1);
      return { applied: existing?.status === "applied" };
    },

    async queueGovernedControlCommand(input) {
      // Fence FIRST (throws stale_fence / attempt_terminal / target_revoked). The
      // guard returns the LOCKED lease + attempt, so the monotonic sequence below is
      // allocated under the lease lock — identical to `requestCancellation`, minus
      // the cancel status transitions (this control carries a resolved decision, it
      // does not itself change job/attempt state).
      const { lease } = await guardActiveFence(input);
      const { control } = input;
      // Idempotent: at most one command per (org, lease, command id). A retried queue
      // with the SAME command id replays the queued row, never a second command.
      const [existing] = await tx.select().from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, input.leaseId),
        eq(jobControlCommands.commandId, control.commandId),
      )).limit(1);
      if (existing) return { command: toQueuedControlCommand(existing), queued: false };

      const [{ maxSeq }] = await tx.select({
        maxSeq: sql<number>`COALESCE(MAX(${jobControlCommands.commandSeq}), 0)`,
      }).from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, input.leaseId),
      ));
      const commandSeq = Number(maxSeq) + 1;
      // Stamp the lease-allocated sequence into the already-validated E1 body so the
      // stored jsonb agrees with the command_seq column (any positive seq still
      // satisfies the frozen schema the bridge validated against).
      const commandBody = { ...control.commandBody, commandSeq };
      const [inserted] = await tx.insert(jobControlCommands).values({
        organizationId: input.organizationId,
        companyId: input.companyId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        attemptNumber: input.attemptNumber,
        leaseId: input.leaseId,
        commandId: control.commandId,
        commandSeq,
        commandKind: control.commandKind,
        fenceToken: input.fence,
        command: commandBody,
      }).onConflictDoNothing({
        target: [
          jobControlCommands.organizationId,
          jobControlCommands.leaseId,
          jobControlCommands.commandId,
        ],
      }).returning();
      if (inserted) return { command: toQueuedControlCommand(inserted), queued: true };
      // Lost the (org, lease, command id) race — re-read the winning row.
      const [row] = await tx.select().from(jobControlCommands).where(and(
        eq(jobControlCommands.organizationId, input.organizationId),
        eq(jobControlCommands.leaseId, input.leaseId),
        eq(jobControlCommands.commandId, control.commandId),
      )).limit(1);
      return { command: row ? toQueuedControlCommand(row) : null, queued: false };
    },

    async lockActiveFence(input) {
      // Read-only guard: acquire the lease+attempt FOR UPDATE lock and validate the fence
      // (throws JobFenceError on stale/old-generation/terminal), writing NOTHING. Callers
      // use it to serialize concurrent same-fence critical sections (e.g. the
      // product-approval create TOCTOU) before a non-idempotent aggregate authority runs.
      return guardActiveFence(input);
    },
  };
}
