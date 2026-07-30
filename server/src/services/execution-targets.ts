import type { Db } from "@armyofagents/db";
import { executionTargets } from "@armyofagents/db";

/**
 * M5: idempotent only because execution_targets_org_slug_uq is NULLS NOT DISTINCT
 * (Task 4). With default NULLS DISTINCT this onConflict target would never match a
 * system row (organization_id = NULL) and would insert a duplicate every boot.
 */
export async function ensureControlPlaneExecutionTarget(db: Db): Promise<void> {
  await db
    .insert(executionTargets)
    .values({
      organizationId: null,
      slug: "control-plane",
      kind: "local_host",
      trustClass: "local_trusted",
      status: "active",
      capabilities: { runtimes: ["runc"], adapters: ["claude_local", "codex_local", "process"] },
      config: { transport: "local_host" },
    })
    .onConflictDoNothing({ target: [executionTargets.organizationId, executionTargets.slug] });
}
