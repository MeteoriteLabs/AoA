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
 * THIS FUNCTION. Every path that DERIVES a status now routes through here:
 *
 *  - create (`services/mcp-connector-create.ts`)
 *  - approve (`services/approvals.ts` → `applyConnectorApproval`, Plan 3a Task 7 —
 *    this used to set `status: "active"` directly, which was the exact defect
 *    described above re-introduced on a second path)
 *  - credential binding (`routes/mcp-connectors.ts` POST …/credentials)
 *
 * ONE writer still sets "active" without consulting this function:
 *
 *  - `routes/mcp-connectors.ts` PATCH permits status → "active", but ONLY in
 *    `local_trusted` (the handler rejects it in every other mode). That one is
 *    DELIBERATE and stays: a loopback deployment has no governance gate to
 *    bypass, and the founder is the host.
 *
 * So: in `local_trusted` a founder can still hand-set "active" via PATCH. In a
 * shared deployment, "status is active" does imply this resolver said so.
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
