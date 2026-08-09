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

// --- wire-safety.ts: forbidden-key + secret-canary helpers (runtime values) --
export {
  FORBIDDEN_WIRE_KEYS,
  normalizeWireKey,
  findForbiddenWireKeys,
  addForbiddenWireKeyIssues,
  registerSecretCanaries,
  clearRegisteredSecretCanaries,
  getRegisteredSecretCanaries,
  visitWireStrings,
  findSecretCanaryStringMatches,
  createSeededRng,
  generateWireStringSample,
} from "./wire-safety.js";

// --- wire-safety.ts: inferred types ------------------------------------------
export type { WireStringSample } from "./wire-safety.js";

// --- source.ts: principals + execution-source union (runtime values) ---------
export {
  PRINCIPAL_TYPES,
  principalTypeSchema,
  principalV1Schema,
  ONE_SHOT_OPERATION_KINDS,
  oneShotOperationKindSchema,
  EXECUTION_SOURCE_KINDS,
  taskRunSourceSchema,
  commanderTurnSourceSchema,
  crewRunSourceSchema,
  oneShotSourceSchema,
  browserRequestSourceSchema,
  serviceReconcileSourceSchema,
  executionSourceV1Schema,
} from "./source.js";

// --- source.ts: inferred types -----------------------------------------------
export type {
  PrincipalType,
  PrincipalV1,
  OneShotOperationKind,
  ExecutionSourceKind,
  TaskRunSource,
  CommanderTurnSource,
  CrewRunSource,
  OneShotSource,
  BrowserRequestSource,
  ServiceReconcileSource,
  ExecutionSourceV1,
} from "./source.js";

// --- job.ts: placement vocabulary, envelopes, and lease payloads (values) ----
export {
  timestampV1Schema,
  TARGET_CLASSES,
  targetClassSchema,
  TARGET_SCOPES,
  targetScopeSchema,
  TRUST_CLASSES,
  trustClassSchema,
  CREDENTIAL_KINDS,
  credentialKindSchema,
  DATA_LOCALITIES,
  dataLocalitySchema,
  FALLBACK_MODES,
  fallbackModeSchema,
  PLACEMENT_MATRIX,
  isTargetPlacementAllowed,
  KNOWN_CRITICAL_EXTENSION_NAMESPACES,
  wireExtensionSchema,
  providerConstraintRefV1Schema,
  targetRequirementsV1Schema,
  placementV1Schema,
  adapterRefV1Schema,
  workspaceV1Schema,
  resourceLimitsV1Schema,
  networkPolicyRefV1Schema,
  OFFLINE_POLICIES,
  offlinePolicySchema,
  batchWorkloadV1Schema,
  browserWorkloadV1Schema,
  serviceWorkloadV1Schema,
  jobEnvelopeV1Schema,
  leaseOfferV1Schema,
  leaseAckV1Schema,
  leaseRenewRequestV1Schema,
  leaseRenewResponseV1Schema,
} from "./job.js";

// --- job.ts: inferred types --------------------------------------------------
export type {
  PlacementMatrixRow,
  TargetClass,
  TargetScope,
  TrustClass,
  CredentialKind,
  DataLocality,
  FallbackMode,
  WireExtension,
  ProviderConstraintRefV1,
  TargetRequirementsV1,
  PlacementV1,
  AdapterRefV1,
  WorkspaceV1,
  ResourceLimitsV1,
  NetworkPolicyRefV1,
  OfflinePolicy,
  BatchWorkloadV1,
  BrowserWorkloadV1,
  ServiceWorkloadV1,
  JobEnvelopeV1,
  LeaseOfferV1,
  LeaseAckV1,
  LeaseRenewRequestV1,
  LeaseRenewResponseV1,
} from "./job.js";
