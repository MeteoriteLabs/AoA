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
  // Find all companies that have an enabled sweep trigger for any AoA agent
  const sweepTriggers = await db
    .select({
      agentId: aoaAgentTriggers.agentId,
      companyId: aoaAgentTriggers.companyId,
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
