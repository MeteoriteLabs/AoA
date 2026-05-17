import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { aoaAgentTriggers, agents } from "@armyofagents/db";

/** Agent ids in `companyId` that have an enabled `outbox`
 *  (discussion_entry_pending) trigger and are not paused/terminated.
 *  v1 implements outbox only; routine/event/mention are recognized
 *  kinds with no evaluator yet (the seam exists, later plans extend). */
export async function listEnabledOutboxAgents(db: Db, companyId: string): Promise<string[]> {
  const rows = await db
    .select({ agentId: aoaAgentTriggers.agentId, status: agents.status })
    .from(aoaAgentTriggers)
    .innerJoin(agents, eq(agents.id, aoaAgentTriggers.agentId))
    .where(and(
      eq(aoaAgentTriggers.companyId, companyId),
      eq(aoaAgentTriggers.kind, "outbox"),
      eq(aoaAgentTriggers.enabled, true),
    ))
    .then((r: Array<{ agentId: string; status: string }>) => r);
  return rows.filter((r) => r.status !== "paused" && r.status !== "terminated").map((r) => r.agentId);
}
