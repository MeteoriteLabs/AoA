import { eq } from "drizzle-orm";
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

// M6: heartbeat is scoped to the authenticated worker's TARGET ID, never the
// slug. slug is unique only per (organization_id, slug), so a slug-scoped update
// would let org-1's worker token flip org-2's identically-slugged pool row. The
// worker token resolves to exactly one target id; update by that id only.
export async function registerWorkerHeartbeat(
  db: Db,
  input: { targetId: string; status?: "active" | "draining" | "offline"; capabilities?: Record<string, unknown> },
): Promise<{ updated: number }> {
  const rows = await db
    .update(executionTargets)
    .set({
      lastSeenAt: new Date(),
      status: input.status ?? "active",
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      updatedAt: new Date(),
    })
    .where(eq(executionTargets.id, input.targetId))
    .returning({ id: executionTargets.id });
  return { updated: rows.length };
}

/**
 * List execution targets an org ADMIN may see/manage: ONLY the org's own rows.
 *
 * SECURITY (P5 review, finding #1): this list must NOT include system/shared rows
 * (organizationId = NULL — the seeded control-plane target + operator-registered
 * pool targets). Their primary-key UUID doubles as the worker bearer token
 * (routes/execution-targets.ts:16-27), so returning a system row to a tenant admin
 * hands them a credential to mutate/offline an operator-owned target they do not
 * own (cross-tenant DoS). The run-routing read path (execution-target-resolver.ts
 * resolveExecutionTargetForRun) reads system rows SEPARATELY and never exposes
 * their ids to a caller, so routing to the shared pool is unaffected.
 */
export async function listExecutionTargets(db: Db, organizationId: string | null) {
  const rows = await db.select().from(executionTargets);
  // organizationId is required to see any target; a null org sees nothing here.
  if (organizationId == null) return [];
  return rows.filter((r) => r.organizationId === organizationId);
}
