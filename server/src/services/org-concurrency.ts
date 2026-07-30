import { and, eq, inArray, sql } from "drizzle-orm";
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
