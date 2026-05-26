import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers, discussions, agentWakeupRequests } from "@armyofagents/db";

/**
 * Periodic sweep driver for the Adjutant role (P3.3).
 *
 * Each tick: for every company that has an active Adjutant with an enabled
 * "sweep" trigger, enqueue one wakeup request per active thread (phase != done,
 * crewPaused = false). The Adjutant then checks each thread for phase-advance
 * readiness.
 *
 * Wakeup payload: { threadId, role: "adjutant" }
 * Source: "sweep.adjutant"
 */
export async function runAdjutantSweep(db: Db): Promise<void> {
  // T1.4: filter sweep triggers by config.role='adjutant'. Pre-T1.4 this
  // driver matched ANY kind='sweep' trigger, which was fine when Adjutant
  // was the only role with a sweep. T1.4 adds Memory Keeper sweep (also
  // kind='sweep'); without the role filter, this driver would cross-fire
  // MK's triggers as Adjutant wakeups. Filtering in JS (not SQL) keeps the
  // mocks simple — volume is trivial.
  const allSweepTriggers = await db
    .select({
      agentId: aoaAgentTriggers.agentId,
      companyId: aoaAgentTriggers.companyId,
      config: aoaAgentTriggers.config,
    })
    .from(aoaAgentTriggers)
    .innerJoin(agents, eq(agents.id, aoaAgentTriggers.agentId))
    .where(
      and(
        eq(aoaAgentTriggers.kind, "sweep"),
        eq(aoaAgentTriggers.enabled, true),
        ne(agents.status, "paused"),
        ne(agents.status, "terminated"),
      ),
    );

  // T1.4 role filter — pre-T1.4 fixtures may have omitted config.role; treat
  // missing role as ADJUTANT for back-compat (the only sweep role pre-T1.4).
  // ensure-adjutant.ts already seeds config: { role: 'adjutant' }; the
  // back-compat branch protects already-seeded companies that haven't run a
  // migration yet.
  const sweepTriggers = allSweepTriggers.filter((t: { config: Record<string, unknown> | null }) => {
    const role = (t.config as Record<string, unknown> | null)?.role;
    return role === undefined || role === "adjutant";
  });

  if (sweepTriggers.length === 0) return;

  for (const trigger of sweepTriggers) {
    // Find active threads for this company (not done, crew not paused)
    const activeThreads = await db
      .select({ id: discussions.id })
      .from(discussions)
      .where(
        and(
          eq(discussions.companyId, trigger.companyId),
          ne(discussions.phase, "done"),
          eq(discussions.crewPaused, false),
        ),
      );

    for (const thread of activeThreads) {
      await db.insert(agentWakeupRequests).values({
        companyId: trigger.companyId,
        agentId: trigger.agentId,
        source: "sweep.adjutant",
        reason: "adjutant_sweep",
        payload: { threadId: thread.id, role: "adjutant" },
        status: "queued",
      });
    }
  }
}
