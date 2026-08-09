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
  notifications: ["SELECT", "UPDATE"],
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
