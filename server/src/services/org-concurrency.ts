import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { companies, heartbeatRuns, organizations } from "@armyofagents/db";
import { ORG_MAX_CONCURRENT_RUNS_DEFAULT, ORG_MAX_CONCURRENT_RUNS_MAX } from "@armyofagents/shared";

// Phase 5, Task 10 — mirrors heartbeat.ts's normalizeMaxConcurrentRuns /
// countRunningRunsForAgent per-agent clamp, layered one level up at the
// Organization. See the Paperclip Divergence Points section (D5) in CLAUDE.md
// for the sibling per-agent clamp this deliberately mirrors (light default, real max).

export function normalizeOrgConcurrencyCap(value: unknown): number {
  if (value === null || value === undefined) return ORG_MAX_CONCURRENT_RUNS_DEFAULT;
  const parsed = Math.floor(typeof value === "number" ? value : Number(value));
  if (!Number.isFinite(parsed)) return ORG_MAX_CONCURRENT_RUNS_DEFAULT;
  return Math.max(1, Math.min(ORG_MAX_CONCURRENT_RUNS_MAX, parsed));
}

export function orgAvailableSlots(input: { cap: number; running: number }): number {
  return Math.max(0, input.cap - input.running);
}

/**
 * Claim mirrors are post-commit observability/state mirrors, not the execution
 * correctness boundary. Isolate each failure so one event listener or wakeup
 * update cannot prevent already-committed runs from being launched.
 */
export async function runClaimMirrorsBestEffort<T>(
  claims: readonly T[],
  mirror: (claim: T) => Promise<void>,
  onError: (error: unknown, claim: T) => void,
): Promise<void> {
  for (const claim of claims) {
    try {
      await mirror(claim);
    } catch (error) {
      try {
        onError(error, claim);
      } catch {
        // Error reporting must not restore the launch-blocking failure mode.
      }
    }
  }
}

/** Resolve the immutable Company -> Organization ownership edge. */
export async function resolveCompanyOrganizationId(db: Db, companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: companies.organizationId })
    .from(companies)
    .where(eq(companies.id, companyId));
  return row?.organizationId ?? null;
}

/**
 * Return agents with queued work in oldest-work-first order for one
 * Organization. Capacity belongs to the Organization, so a completion by one
 * agent must be able to wake queued work owned by another agent.
 */
export async function listQueuedAgentIdsForOrg(db: Db, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({
      agentId: heartbeatRuns.agentId,
      oldestQueuedAt: sql<Date>`min(${heartbeatRuns.createdAt})`,
    })
    .from(heartbeatRuns)
    .innerJoin(companies, eq(companies.id, heartbeatRuns.companyId))
    .where(and(eq(companies.organizationId, organizationId), eq(heartbeatRuns.status, "queued")))
    .groupBy(heartbeatRuns.agentId)
    .orderBy(sql`min(${heartbeatRuns.createdAt})`, asc(heartbeatRuns.agentId));
  return rows.map((row) => row.agentId);
}

/** Dispatch queued agents oldest-first, continuing past agents that cannot claim. */
export async function dispatchQueuedAgentsForOrg<T>(
  db: Db,
  organizationId: string,
  dispatchAgent: (agentId: string) => Promise<readonly T[]>,
): Promise<T[]> {
  const dispatched: T[] = [];
  for (const agentId of await listQueuedAgentIdsForOrg(db, organizationId)) {
    dispatched.push(...await dispatchAgent(agentId));
  }
  return dispatched;
}

/** Count running heartbeat runs across every company in the organization. */
export async function countRunningRunsForOrg(db: Db, organizationId: string): Promise<number> {
  const companyRows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.organizationId, organizationId));
  const ids = companyRows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(heartbeatRuns)
    .where(and(inArray(heartbeatRuns.companyId, ids), eq(heartbeatRuns.status, "running")));
  return Number(row?.count ?? 0);
}

/**
 * Reads the org's real concurrency dial (organizations.concurrency_cap, P1),
 * normalized/clamped via normalizeOrgConcurrencyCap. NULL (unset) defaults to
 * ORG_MAX_CONCURRENT_RUNS_DEFAULT.
 */
export async function resolveOrgConcurrencyCap(db: Db, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ concurrencyCap: organizations.concurrencyCap })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return normalizeOrgConcurrencyCap(row?.concurrencyCap ?? null);
}

/**
 * Atomically claim queued runs without exceeding either the per-agent or
 * per-Organization concurrency ceiling.
 *
 * The transaction-scoped advisory lock is the cross-process correctness
 * boundary. The heartbeat service's in-memory per-agent lock remains a useful
 * local optimization, but cannot serialize two agents in one Organization or
 * callers running on different server replicas.
 */
export async function claimQueuedRunsWithOrgCapacity(
  db: Db,
  input: {
    organizationId: string;
    agentId: string;
    perAgentCap: number;
  },
): Promise<Array<typeof heartbeatRuns.$inferSelect>> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('aoa:heartbeat-org-start'), hashtext(${input.organizationId}))`,
    );

    // Re-read both occupancies only after acquiring the org lock. Counting
    // before the lock would preserve the cross-agent check-then-act race.
    const [agentRunningRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.status, "running")));
    const agentSlots = Math.max(0, input.perAgentCap - Number(agentRunningRow?.count ?? 0));

    const orgCap = await resolveOrgConcurrencyCap(txDb, input.organizationId);
    const orgRunning = await countRunningRunsForOrg(txDb, input.organizationId);
    const effectiveSlots = Math.min(agentSlots, orgAvailableSlots({ cap: orgCap, running: orgRunning }));
    if (effectiveSlots <= 0) return [];

    const queuedRuns = await tx
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.status, "queued")))
      .orderBy(asc(heartbeatRuns.createdAt))
      .limit(effectiveSlots);

    const claimedAt = new Date();
    const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];
    for (const run of queuedRuns) {
      const claimed = await tx
        .update(heartbeatRuns)
        .set({
          status: "running",
          startedAt: run.startedAt ?? claimedAt,
          updatedAt: claimedAt,
        })
        .where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "queued")))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (claimed) claimedRuns.push(claimed);
    }
    return claimedRuns;
  });
}
