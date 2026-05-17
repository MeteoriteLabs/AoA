import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, budgetPolicies } from "@armyofagents/db";

/**
 * The reserved per-company Commander-team platform agent.
 *
 * It is a real `agents` row (forced by the cost_events.agentId FK) but
 * kind='platform', so it is excluded from every user-facing enumeration
 * (see agentService.list / orgForCompany / dashboard / home / companies /
 * mention-resolution — T1.3/T1.4) and is structurally non-dispatchable:
 * runtimeConfig.heartbeat={enabled:false,intervalSec:0} makes heartbeat
 * tickTimers() skip it via the existing `intervalSec<=0` gate.
 *
 * It owns an (inactive) budget_policies row so Commander-team spend can be
 * scoped/capped via the existing budget system — seeded unlimited-until-
 * configured (isActive=false → no hard stop until a founder sets a real cap).
 */
export const PLATFORM_AGENT_NAME = "Commander Team";

/** Idempotently ensure the platform agent + its budget policy exist for a
 *  company. Safe to call repeatedly (no duplicates). Returns the agent id. */
export async function ensurePlatformAgent(
  db: Db,
  companyId: string,
): Promise<string> {
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "platform")))
    .then((rows: { id: string }[]) => rows[0] ?? null);
  if (existing) return existing.id;

  const [created] = await db
    .insert(agents)
    .values({
      companyId,
      name: PLATFORM_AGENT_NAME,
      kind: "platform",
      role: "general",
      status: "idle",
      adapterType: "process",
      // Structurally non-dispatchable: heartbeat tickTimers() skips
      // intervalSec<=0 (and !enabled) — defense-in-depth, cannot be forgotten.
      runtimeConfig: { heartbeat: { enabled: false, intervalSec: 0 } },
    })
    .returning();

  await db.insert(budgetPolicies).values({
    companyId,
    scopeType: "agent",
    scopeId: created.id,
    amountCents: 0, // unlimited-until-configured
    isActive: false, // no hard stop until a founder activates + sets a real cap
  });

  return created.id;
}
