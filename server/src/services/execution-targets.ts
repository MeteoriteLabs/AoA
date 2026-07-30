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
 * List execution targets visible to an org: system/shared rows
 * (organizationId null) plus the org's own dedicated/pooled rows. Mirrors the
 * same select-all-then-filter-in-JS shape execution-target-resolver.ts already
 * uses for the run-routing read path (small table; no pagination yet).
 */
export async function listExecutionTargets(db: Db, organizationId: string | null) {
  const rows = await db.select().from(executionTargets);
  return rows.filter((r) => r.organizationId == null || r.organizationId === organizationId);
}
