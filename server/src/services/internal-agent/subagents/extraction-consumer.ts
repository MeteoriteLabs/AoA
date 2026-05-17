import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { internalAgentRuns, discussionEntries } from "@armyofagents/db";
import { extractionService } from "../../extraction.js";
import { costService } from "../../costs.js";
import { logger } from "../../../middleware/logger.js";

/**
 * Sub-agent #1 runtime consumer — trigger/executor-agnostic.
 *
 * Receives `(companyId, entryId, platformAgentId)`, does the work, writes a
 * run record. Invoked by the durable sweeper (T4) OR directly (contract test).
 * It does NOT know how it was triggered or where it runs (see spec §3.4).
 *
 * Guarantees:
 *  - Hard error boundary: any failure is caught + recorded; it NEVER rethrows,
 *    so the caller (sweeper tick) and, transitively, addEntry/chat are never
 *    slowed or broken by extraction.
 *  - Observable: every execution writes an internal_agent_runs row
 *    (running → completed|failed) and links discussionEntries.extractionRunId.
 *  - Budget-bound: emits a platform-agent-scoped cost_event so the existing
 *    budgetService.evaluateCostEvent enforcement applies. v1 amounts are
 *    ZEROED by design (callLLM returns no token usage today — accurate
 *    accounting is deferred, spec §16.3); this proves the budget PATH.
 */
export async function runExtractionConsumer(
  db: Db,
  companyId: string,
  entryId: string,
  platformAgentId: string,
): Promise<void> {
  const log = logger.child({ subagent: "extraction-consumer", companyId, entryId });
  const startedAt = Date.now();
  let runId: string | null = null;

  try {
    const inserted = await db
      .insert(internalAgentRuns)
      .values({
        companyId,
        triggerType: "sub_agent",
        triggerSource: "discussion_entry",
        status: "running",
        relatedEntityType: "discussion",
        relatedEntityId: entryId,
        userId: null,
      })
      .returning();
    runId = inserted[0]?.id ?? null;

    // Link the entry to its CURRENT run immediately (before extraction), so a
    // 'processing' entry always points to the run actively working it. The
    // sweeper's orphan signal keys on this linked run — without the link it
    // would have to match ANY historical run and could false-reclaim a
    // healthily-reprocessing entry (see RESUME-BRIEF §4).
    if (runId) {
      await db
        .update(discussionEntries)
        .set({ extractionRunId: runId })
        .where(eq(discussionEntries.id, entryId));
    }

    await extractionService(db).extractFromDiscussionEntry(companyId, entryId);

    if (runId) {
      await db
        .update(internalAgentRuns)
        .set({
          status: "completed",
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
        })
        .where(eq(internalAgentRuns.id, runId));
      // (extraction_run_id was already linked at run creation, above.)
    }

    // Platform-scoped cost_event → existing budgetService.evaluateCostEvent
    // applies automatically (mirrors worker-agent cost path). v1 zeroed.
    await costService(db).createEvent(companyId, {
      agentId: platformAgentId,
      provider: "anthropic",
      model: process.env.EXTRACTION_MODEL || "claude-sonnet-4-20250514",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      occurredAt: new Date(),
    });
  } catch (err) {
    log.error({ err }, "extraction consumer failed (isolated — not rethrown)");
    if (runId) {
      // Best-effort failure record. Wrapped in its own try/catch (NOT a
      // builder .catch() — Drizzle query builders are thenables without a
      // .catch method) so the failure-recorder can itself never throw.
      try {
        await db
          .update(internalAgentRuns)
          .set({
            status: "failed",
            errorMessage: String((err as Error)?.message ?? err),
            durationMs: Date.now() - startedAt,
            completedAt: new Date(),
          })
          .where(eq(internalAgentRuns.id, runId));
      } catch {
        /* swallow — never let the failure-recorder throw */
      }
    }
    // Swallow: failure MUST NOT bubble into the sweeper / addEntry / chat.
  }
}
