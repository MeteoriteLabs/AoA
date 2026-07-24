/**
 * @fileoverview THE single place that decides whether a connector may be `active`.
 *
 * Credential state and approval state are ORTHOGONAL axes. Collapsing them into
 * one linear status is what produced an earlier defect: `approvals.ts` flipped ANY
 * non-active connector to `active` on approve, which would activate a connector
 * with no credentials.
 *
 * INVARIANT: this function never returns "active" while `requiresSecret &&
 * !hasSecret`. Nothing else in the codebase may write "active" to a connector.
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
