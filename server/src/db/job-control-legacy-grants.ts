export type TablePrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

/**
 * Corrective E2 prerequisite (E3-F001): the operation-level aoa_app allowlist
 * traced from the existing JOB-010..014 engines. This is deliberately not broad
 * DML: each privilege corresponds to a current query in checkout/heartbeat,
 * approvals/runtime-decision, budget/cost, concurrency, or output-summary code.
 * New legacy access must be added by a reviewed trace, never by an owner fallback.
 */
export const JOB_CONTROL_LEGACY_GRANTS = Object.freeze({
  issues: ["SELECT", "UPDATE"],
  agents: ["SELECT", "UPDATE"],
  task_dependencies: ["SELECT"],
  issue_labels: ["SELECT"],
  labels: ["SELECT"],
  notifications: ["SELECT", "INSERT", "UPDATE"],
  user_roles: ["SELECT"],
  company_memberships: ["SELECT"],
  notification_preferences: ["SELECT"],
  notification_digest_items: ["SELECT", "INSERT"],
  hub_counter_snapshots: ["SELECT", "UPDATE"],
  hub_audit: ["INSERT"],
  heartbeat_runs: ["SELECT", "INSERT", "UPDATE"],
  agent_wakeup_requests: ["SELECT", "INSERT", "UPDATE"],
  discussion_entries: ["SELECT", "UPDATE"],
  internal_agent_runs: ["SELECT", "INSERT", "UPDATE"],
  thread_orchestration_state: ["SELECT", "UPDATE"],
  internal_agent_conversations: ["SELECT"],
  internal_agent_messages: ["SELECT"],
  internal_agent_config: ["SELECT"],
  companies: ["SELECT", "UPDATE"],
  organizations: ["SELECT"],
  approvals: ["SELECT", "INSERT", "UPDATE"],
  agent_runtime_decisions: ["SELECT", "INSERT", "UPDATE"],
  agent_runtime_trust_rules: ["SELECT", "INSERT", "UPDATE"],
  internal_agent_runtime_approvals: ["SELECT", "INSERT", "UPDATE"],
  internal_agent_tool_trust_rules: ["SELECT", "INSERT", "UPDATE"],
  budget_policies: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  budget_incidents: ["SELECT", "INSERT", "UPDATE"],
  cost_events: ["SELECT", "INSERT"],
  activity_log: ["SELECT", "INSERT"],
  projects: ["SELECT"],
  task_outputs: ["SELECT", "INSERT", "UPDATE"],
  issue_comments: ["INSERT"],
  artifacts: ["SELECT"],
  artifact_versions: ["SELECT"],
  assets: ["SELECT"],
  execution_workspaces: ["SELECT"],
  workspace_runtime_services: ["SELECT"],
} satisfies Readonly<Record<string, readonly TablePrivilege[]>>);

/** Columns needed to revalidate the already-authenticated MCP key in-transaction. */
export const APP_MCP_API_KEY_COLUMN_GRANTS = Object.freeze([
  "id",
  "company_id",
  "user_id",
  "revoked_at",
] as const);

/**
 * Existing E2 new-path DML retained by aoa_app after the corrective ACL reset.
 * Kept separate from the legacy trace so the two authorization seams stay
 * reviewable independently.
 */
export const JOB_CONTROL_NEW_PATH_GRANTS = Object.freeze({
  jobs: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  job_attempts: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  leases: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  workers: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  services: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  service_instances: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  job_artifacts: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  job_secret_handles: ["SELECT", "INSERT", "UPDATE", "DELETE"],
} satisfies Readonly<Record<string, readonly TablePrivilege[]>>);

/** JOB-001-only legacy reads, versioned away from the immutable 0213/0214 inputs. */
export const JOB_SUBMISSION_LEGACY_GRANTS = Object.freeze({
  organization_memberships: ["SELECT"],
} satisfies Readonly<Record<string, readonly TablePrivilege[]>>);

/** JOB-001-only new-path authority introduced after the immutable 0214 artifact. */
export const JOB_SUBMISSION_NEW_PATH_GRANTS = Object.freeze({
  job_outbox: ["SELECT", "INSERT", "UPDATE", "DELETE"],
} satisfies Readonly<Record<string, readonly TablePrivilege[]>>);

/**
 * Current heartbeat execution-target resolver projection for aoa_app. This is
 * column-level because the table also stores worker_token_hash and unrelated
 * enrollment/ownership metadata that the tenant-serving path must not read.
 */
export const APP_EXECUTION_TARGET_COLUMN_GRANTS = Object.freeze([
  "id",
  "slug",
  "kind",
  "trust_class",
  "status",
  "organization_id",
  "config",
] as const);

/**
 * E2-D06 operator-read seam. Enrollment credentials, ownership, routing config,
 * status/revocation mutations, and all DELETE authority remain deferred to
 * JOB-002; the current operator is metadata-read-only.
 */
export const OPERATOR_METADATA_COLUMN_GRANTS = Object.freeze({
  workers: [
    "id",
    "scope",
    "organization_id",
    "label",
    "status",
    "created_at",
    "updated_at",
  ],
  execution_targets: [
    "id",
    "organization_id",
    "slug",
    "kind",
    "trust_class",
    "status",
    "capabilities",
    "last_seen_at",
    "created_at",
    "updated_at",
  ],
} satisfies Readonly<Record<string, readonly string[]>>);

/** JOB-002 tenant authority, versioned after the immutable E2/JOB-001 grants. */
export const WORKER_ENROLLMENT_APP_GRANTS = Object.freeze({
  worker_enrollment_code_routes: ["SELECT", "INSERT", "DELETE"],
  worker_enrollment_codes: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  worker_proof_replays: ["SELECT", "INSERT", "DELETE"],
} satisfies Readonly<Record<string, readonly TablePrivilege[]>>);

/** JOB-002 platform metadata authority; RLS restricts every mutable row to null-Org. */
export const WORKER_ENROLLMENT_OPERATOR_GRANTS = Object.freeze({
  workers: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  worker_enrollment_code_routes: ["SELECT", "INSERT", "DELETE"],
  worker_enrollment_codes: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  worker_proof_replays: ["SELECT", "INSERT", "DELETE"],
} satisfies Readonly<Record<string, readonly TablePrivilege[]>>);

/** Tenant target metadata needed to issue/consume enrollment and retire bootstrap auth. */
export const APP_ENROLLMENT_TARGET_SELECT_COLUMNS = Object.freeze([
  "id", "organization_id", "owner_user_id", "scope", "target_authority_key",
  "status", "device_generation", "capabilities",
] as const);
export const APP_ENROLLMENT_TARGET_UPDATE_COLUMNS = Object.freeze([
  "worker_token_hash", "device_generation", "status", "last_seen_at", "updated_at",
] as const);

/** Platform target projection keeps config and bootstrap hashes unreadable. */
export const OPERATOR_ENROLLMENT_TARGET_SELECT_COLUMNS = Object.freeze([
  "id", "organization_id", "owner_user_id", "slug", "kind", "trust_class",
  "status", "capabilities", "scope", "target_authority_key", "device_generation",
  "last_seen_at", "created_at", "updated_at",
] as const);
export const OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS = Object.freeze([
  "worker_token_hash", "device_generation", "status", "last_seen_at", "updated_at",
] as const);

/**
 * JOB-009 placement profile authority. These columns contain only the
 * server-registered capability and provider ceilings used to place an attempt;
 * enrollment secrets, worker tokens, routing config, and job details remain
 * outside both projections.
 */
export const APP_JOB_PLACEMENT_TARGET_SELECT_COLUMNS = Object.freeze([
  "slug", "kind", "trust_class", "last_seen_at", "registered_profile",
  "registered_profile_hash", "provider_constraint_profile",
] as const);
export const OPERATOR_JOB_PLACEMENT_TARGET_SELECT_COLUMNS = Object.freeze([
  "registered_profile", "registered_profile_hash", "provider_constraint_profile",
] as const);
export const APP_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS = Object.freeze([
  "registered_profile", "registered_profile_hash", "provider_constraint_profile", "updated_at",
] as const);
export const OPERATOR_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS = APP_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS;
