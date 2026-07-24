/**
 * @fileoverview THE single place that decides whether a connector may be `active`.
 *
 * Credential state and approval state are ORTHOGONAL axes. Collapsing them into
 * one linear status is what produced an earlier defect: `approvals.ts` flipped ANY
 * non-active connector to `active` on approve, which would activate a connector
 * with no credentials.
 *
 * INVARIANT (unconditional): this function never returns "active" while
 * `requiresSecret && !hasSecret`.
 *
 * SCOPE — read this before relying on it. The invariant above is a property of
 * THIS FUNCTION, and it is the whole story only on the CREATE path, which routes
 * every status decision through here. It is NOT yet a codebase-wide guarantee
 * that a connector can only become "active" via this resolver. Two other writers
 * exist today:
 *
 *  - `services/approvals.ts` (install_mcp_connector approve) sets
 *    `status: "active"` directly, without consulting this function. That is the
 *    exact defect described above, re-introduced on a different path, and it is
 *    being closed in a following task.
 *  - `routes/mcp-connectors.ts` PATCH permits status → "active" in
 *    `local_trusted`. That one is DELIBERATE and stays: a loopback deployment
 *    has no governance gate to bypass.
 *
 * So: do not treat "status is active" as proof that credentials are bound until
 * the approval path is routed through here too.
 */

export type ConnectorStatus = "pending_approval" | "needs_credentials" | "active" | "disabled";

export function resolveConnectorStatus(input: {
  deploymentMode: string;
  approved: boolean;
  requiresSecret: boolean;
  hasSecret: boolean;
}): ConnectorStatus {
  const { deploymentMode, approved, requiresSecret, hasSecret } = input;

  // Governance axis first: a shared deployment gates on board approval (D6).
  // local_trusted is a loopback trust boundary, so it is implicitly approved.
  const governanceSatisfied = deploymentMode === "local_trusted" || approved;
  if (!governanceSatisfied) return "pending_approval";

  // Credential axis second.
  if (requiresSecret && !hasSecret) return "needs_credentials";

  return "active";
}
