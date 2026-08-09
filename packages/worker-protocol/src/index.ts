// Explicit public exports only (no `export *`) so every wire-surface change is
// visible in review. Runtime values use `export { … }`; type-only aliases use
// `export type { … }` (the root tsconfig sets `isolatedModules: true`).

export { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "./version.js";

// --- ids.ts: branded identity schemas (runtime values) -----------------------
export {
  organizationIdSchema,
  companyIdSchema,
  agentIdSchema,
  runIdSchema,
  issueIdSchema,
  internalAgentRunIdSchema,
  conversationIdSchema,
  crewRunIdSchema,
  oneShotOperationIdSchema,
  browserRequestIdSchema,
  reconciliationIdSchema,
  jobIdSchema,
  workerIdSchema,
  targetIdSchema,
  leaseIdSchema,
  eventIdSchema,
  artifactIdSchema,
  secretHandleIdSchema,
  serviceIdSchema,
  serviceInstanceIdSchema,
  principalIdSchema,
  sandboxIdSchema,
  attemptNumberSchema,
  eventSequenceSchema,
  fenceTokenSchema,
  sha256DigestSchema,
} from "./ids.js";

// --- ids.ts: inferred identity types -----------------------------------------
export type {
  OrganizationId,
  CompanyId,
  AgentId,
  RunId,
  IssueId,
  InternalAgentRunId,
  ConversationId,
  CrewRunId,
  OneShotOperationId,
  BrowserRequestId,
  ReconciliationId,
  JobId,
  WorkerId,
  TargetId,
  LeaseId,
  EventId,
  ArtifactId,
  SecretHandleId,
  ServiceId,
  ServiceInstanceId,
  PrincipalId,
  SandboxId,
  FenceToken,
  Sha256Digest,
} from "./ids.js";

// --- states.ts: workload/lifecycle constants, schemas, predicates ------------
export {
  WORKLOAD_TYPES,
  workloadTypeSchema,
  JOB_STATUSES,
  jobStatusSchema,
  JOB_TRANSITION_REASONS,
  jobTransitionReasonSchema,
  canTransitionJobStatus,
  ATTEMPT_STATUSES,
  attemptStatusSchema,
  canTransitionAttemptStatus,
  LEASE_STATUSES,
  leaseStatusSchema,
  canTransitionLeaseStatus,
  BROWSER_SESSION_STATUSES,
  browserSessionStatusSchema,
  canTransitionBrowserSessionStatus,
  SERVICE_DESIRED_STATES,
  serviceDesiredStateSchema,
  canTransitionServiceDesiredState,
  SERVICE_INSTANCE_STATUSES,
  serviceInstanceStatusSchema,
  canTransitionServiceInstanceStatus,
} from "./states.js";

// --- states.ts: inferred workload/lifecycle types ----------------------------
export type {
  WorkloadType,
  JobStatus,
  JobTransitionReason,
  AttemptStatus,
  LeaseStatus,
  BrowserSessionStatus,
  ServiceDesiredState,
  ServiceInstanceStatus,
} from "./states.js";
