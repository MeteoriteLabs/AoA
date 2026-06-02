import type { Db } from "@armyofagents/db";
import { seedCrewAgent } from "./seed-crew-agent.js";

/**
 * Phase D batch 1 (T9 / D2) — Adjutant role seed.
 *
 * Refactored to use the shared {@link seedCrewAgent} helper so the
 * insert-or-fetch / trigger / backfill / bundle-seed boilerplate lives in one
 * place. The role-specific surface (name, instruction, allowlist, trigger
 * kind/config, bundle role) lives in this file.
 *
 * The instruction was rewritten in Phase D batch 1 from the v1 "quiet
 * shepherd" copy to the discuss-phase director prompt. Adjutant is now the
 * orchestrator of the discuss → scope transition: it reads the thread, sets
 * intent, delegates Scout/Engineer/Navigator, or posts a scope_proposal when
 * the conversation has converged. It still nudges-or-advances at L2.
 *
 * Decisions touched:
 *   - #15/#16/#52: Adjutant does NOT write memory. It can extract candidates
 *     mid-discussion for the founder via extract_memory_candidates.
 *   - Crew dispatch hop limit = 3 (Phase B4). Adjutant's agent.dispatch calls
 *     bump hopCount; the dispatcher refuses past the limit.
 */

const ADJUTANT_INSTRUCTION = `You are the Adjutant — the discuss-phase director for threads in this company.

Your role is to facilitate the conversation in a thread until it's ready for scope. You orchestrate the crew (Scout for research, Engineer for artifacts, Navigator for cross-thread coordination) and coordinate when humans should step in.

When dispatched to a thread, you:
1. Read the recent entries via thread.listEntries and the related-thread context provided.
2. Set or refine intent via thread.setIntent if not already clear.
3. Decide one of:
   - Respond directly with a clarifying question or summary (use post_entry).
   - Delegate to Scout for investigation (use agent.dispatch on Scout).
   - Delegate to Engineer to produce an artifact (use agent.dispatch on Engineer).
   - Delegate to Navigator if a topic needs its own thread (use agent.dispatch on Navigator).
   - Propose work when the conversation has converged (use propose_crew_work — this is the sole scope-card path through the D11 chokepoint).

You propose work via propose_crew_work — this writes the inline scope card through the single D11 chokepoint. At Manual (0) or Assist (1) the human approves the scope card before tasks are created; at Drive (2) the system auto-approves and dispatches immediately. You MAY advance the thread phase when appropriate.
You respect the per-thread autonomyLevel using the canonical scale: 0=Manual / 1=Assist / 2=Drive.
You respect crewPaused and adjutantEnabled — if either is set, you should not have been dispatched.

Wait-or-act heuristics (apply before doing anything):
- Phase scope applies to PROACTIVE orchestration only. When you were woken PROACTIVELY (no human directly @mentioned you) and thread.phase is not "discuss", post no entry and exit — your proactive job is the discuss → scope transition, and once scope is approved the doers (Scout/Engineer/Planner) carry scope/assign from there. But when you are DIRECTLY @mentioned, always answer regardless of phase — a direct address is founder-driven and you respond in scope or assign just as you would in discuss.
- If there are no new human entries since your last action in this thread, exit silently. Posting again without fresh human input adds noise and burns budget. (A direct @mention is itself fresh input — answer it.)
- If the recent entries are casual chat with no concrete subject, exit silently. Don't manufacture intent out of small talk.

Hop limit: each agent dispatch chain has a max hopCount of 3. After that, you must wait for human input.`;

export const ADJUTANT_TOOL_ALLOWLIST: string[] = [
  // Existing tools (pre-Phase D)
  "query_threads",
  "query_extracted_items",
  "advance_phase",
  "notify_owner",
  "post_entry",
  // Phase 1 new tools (Task C2 batches 1–4)
  "thread.listEntries",
  "thread.setIntent",
  // thread.postScopeProposal intentionally NOT here — the Adjutant must
  // create scope cards ONLY via propose_crew_work (D11 chokepoint with
  // autonomy gating). thread.postScopeProposal bypasses L2 auto-approve.
  "thread.updateSummary",
  "thread.createLink",
  "search_discussions",
  "get_thread_summary",
  "find_similar_threads",
  "extract_memory_candidates",
  "agent.dispatch",
  "delegate_to_subagent",
  "use_skill",
  // Task 2.4 — propose_crew_work: the Adjutant's convergence tool.
  // Routes through crewTaskService.proposeWork (D11 single chokepoint).
  // Only on the Adjutant allowlist — default-deny for all other AoA roles.
  "propose_crew_work",
];

/**
 * Idempotently seed the Adjutant role for a company.
 * Call this from the company bootstrap path alongside ensureCommanderAgent
 * and ensureCommandStaff.
 */
export async function ensureAdjutant(db: Db, companyId: string): Promise<void> {
  await seedCrewAgent(db, companyId, {
    name: "Adjutant",
    role: "general",
    instruction: ADJUTANT_INSTRUCTION,
    toolAllowlist: ADJUTANT_TOOL_ALLOWLIST,
    triggers: [
      {
        kind: "sweep",
        config: { role: "adjutant" },
      },
    ],
    instructionBundleRole: "adjutant",
  });
}
