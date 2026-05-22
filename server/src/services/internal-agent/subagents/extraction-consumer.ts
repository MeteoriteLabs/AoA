import type { Db } from "@armyofagents/db";
import { runAoaAgent } from "../aoa-agents/runner.js";

/**
 * Sub-agent #1 extraction consumer — now a thin delegator.
 *
 * @deprecated The run-record / atomic-claim / cost / hard-error-boundary
 * mechanics this file used to own (M3 design) were moved WHOLESALE into the
 * AoA runner (`runAoaAgent`, A7 — Plan A / Decision #100). The runner is the
 * single execution path: #99/M2 atomic claim, adapter+bridge execution,
 * internal_agent_runs lifecycle, platform-scoped cost_event, and the
 * never-rethrow isolation guarantee all live there now (and are asserted in
 * `aoa-runner.test.ts`).
 *
 * The exported name + exact 4-arg signature `(db, companyId, entryId,
 * agentId)` are preserved deliberately: the A6 dispatcher
 * (`aoa-agents/dispatcher.ts`) imports and calls this with 4 args, so
 * collapsing it to a delegator must not change the surface. `agentId` is the
 * `kind='aoa'` extraction agent resolved by `ensureExtractionAgent` (the
 * dispatcher passes it as the 4th arg; older code called this slot
 * `platformAgentId` — same value).
 *
 * Never rethrows — isolation is enforced inside `runAoaAgent` (its hard error
 * boundary), so addEntry/chat/the dispatcher tick remain unaffected.
 */
export async function runExtractionConsumer(
  db: Db,
  companyId: string,
  entryId: string,
  agentId: string,
): Promise<void> {
  await runAoaAgent(db, agentId, {
    entryId,
    companyId,
    source: "discussion_entry_pending",
  });
}
