/**
 * W3a (D4) — Composed crew run-outcome side-effects.
 *
 * When a CREW agent (kind='aoa') finishes a task, its result must post back
 * into the originating discussion thread (loopback) AND get a run-summary
 * comment on the task — the treatment ORG agents already get from heartbeat.
 * These are the composed functions the crew runner calls as ONE best-effort
 * call per outcome, so the exact SEQUENCE the runner runs is a single tested
 * unit (D4) rather than loose calls scattered in runner.ts:
 *   - postCrewRunSuccess: relay ("Completed: …")   THEN success run-summary.
 *   - postCrewRunFailure: failure card ("… could not complete …", crew_thread
 *     origin only) THEN failure run-summary.
 *
 * Best-effort granularity: each sub-step (relay/card, summary) is wrapped in its
 * OWN try/catch inside the composed function, so a relay failure does NOT skip
 * the summary (and vice-versa). The runner then wraps the whole call in one
 * more try/catch as defence-in-depth. Neither the sub-steps nor the composed
 * function ever throws.
 *
 * Acyclic imports: this module imports only leaves —
 *   - run-summary-comment.js  (imports run-summary.js + adapters/utils.js + logger)
 *   - crew-result-relay.js    (imports live-events.js + logger)
 *   - crew-failure-card.js    (imports live-events.js + logger)
 * — and the runner dynamic-imports THIS module. No cycle.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { issues } from "@armyofagents/db";
import { logger } from "../../../middleware/logger.js";
import { relayCrewResult } from "../../crew-result-relay.js";
import { postCrewFailureCard } from "../../crew-failure-card.js";
import {
  postRunSummaryComment,
  type PostRunSummaryCommentInput,
} from "../../run-summary-comment.js";

const log = logger.child({ svc: "crew-run-outcome" });

export interface CrewRunSuccessInput {
  companyId: string;
  issueId: string;
  agentName: string;
  /** The agent's runtimeConfig object; autoRunSummary===false opts out of the summary. */
  runtimeConfig: Record<string, unknown> | null | undefined;
  startedAtMs: number;
  nowMs: number;
  adapterUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  costCents: number | null;
  runId?: string;
}

/**
 * PURE mapper: runner locals → the shared writer's input. Exported so the
 * costCents→USD + null-token mappings are unit-tested independently of the
 * composed side-effect. `detectedFiles` is always [] for crew runs until W3b
 * (workspace diff) lands — formatRunSummary renders an empty list cleanly.
 */
export function resolveCrewRunSummaryArgs(input: {
  companyId: string;
  issueId: string;
  agentName: string;
  runtimeConfig: Record<string, unknown> | null | undefined;
  outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
  startedAtMs: number;
  nowMs: number;
  adapterUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  costCents: number | null;
  errorMessage: string | null;
  runId?: string;
}): PostRunSummaryCommentInput {
  return {
    companyId: input.companyId,
    issueId: input.issueId,
    agentName: input.agentName,
    runtimeConfig: input.runtimeConfig,
    outcome: input.outcome,
    runId: input.runId,
    durationMs: input.nowMs - input.startedAtMs,
    inputTokens: input.adapterUsage?.inputTokens ?? null,
    outputTokens: input.adapterUsage?.outputTokens ?? null,
    costUsd: input.costCents != null ? input.costCents / 100 : null,
    errorMessage: input.errorMessage,
    detectedFiles: [],
  };
}

/**
 * Injectable seams for the two sub-steps so the composition is unit-testable
 * without a live DB. Production callers omit `deps` → the real relay + writer.
 */
export interface CrewRunSuccessDeps {
  relay: (db: Db, params: { issueId: string }) => Promise<{ posted: boolean }>;
  summarize: (db: Db, input: PostRunSummaryCommentInput) => Promise<{ posted: boolean }>;
}

/**
 * SUCCESS: loopback (crew_thread-guarded INSIDE relayCrewResult, so a
 * non-discussion task is a no-op) THEN the run-summary comment. Each sub-step
 * best-effort + isolated. Returns which sub-steps posted (for the unit test and
 * for any future caller telemetry). NEVER throws.
 */
export async function postCrewRunSuccess(
  db: Db,
  input: CrewRunSuccessInput,
  deps: CrewRunSuccessDeps = { relay: relayCrewResult, summarize: postRunSummaryComment },
): Promise<{ relayed: boolean; summarized: boolean }> {
  let relayed = false;
  let summarized = false;

  // ── Sub-step 1: thread loopback ("Completed: …" agent entry) ──────────────
  try {
    const result = await deps.relay(db, { issueId: input.issueId });
    relayed = result.posted;
  } catch (err) {
    log.warn(
      { err, issueId: input.issueId, runId: input.runId },
      "W3a crew result relay failed (non-fatal)",
    );
  }

  // ── Sub-step 2: run-summary comment on the task ───────────────────────────
  try {
    const result = await deps.summarize(
      db,
      resolveCrewRunSummaryArgs({
        companyId: input.companyId,
        issueId: input.issueId,
        agentName: input.agentName,
        runtimeConfig: input.runtimeConfig,
        outcome: "succeeded",
        startedAtMs: input.startedAtMs,
        nowMs: input.nowMs,
        adapterUsage: input.adapterUsage,
        costCents: input.costCents,
        errorMessage: null,
        runId: input.runId,
      }),
    );
    summarized = result.posted;
  } catch (err) {
    log.warn(
      { err, issueId: input.issueId, runId: input.runId },
      "W3a crew run summary failed (non-fatal)",
    );
  }

  return { relayed, summarized };
}

// ────────────────────────────────────────────────────────────────────────────
// FAILURE side (Task 3)
// ────────────────────────────────────────────────────────────────────────────

export interface CrewRunFailureInput {
  companyId: string;
  issueId: string;
  agentId: string;
  agentName: string;
  /** The agent's runtimeConfig object; autoRunSummary===false opts out of the summary. */
  runtimeConfig: Record<string, unknown> | null | undefined;
  startedAtMs: number;
  nowMs: number;
  errorMessage: string;
  runId?: string;
}

/** The minimal issue shape the failure card needs (crew_thread gate + title + thread). */
export interface CrewFailureIssueRow {
  title: string | null;
  originKind: string | null;
  sourceDiscussionId: string | null;
}

/**
 * Injectable seams for the three failure sub-steps so the composition is
 * unit-testable without a live DB. Production callers omit `deps` → the real
 * issue fetch + failure card + summary writer.
 */
export interface CrewRunFailureDeps {
  fetchIssue: (db: Db, issueId: string) => Promise<CrewFailureIssueRow | null>;
  failureCard: (
    db: Db,
    params: {
      threadId: string;
      companyId: string;
      issueId: string;
      agentId: string;
      agentName: string;
      taskTitle: string;
      error: string;
    },
  ) => Promise<void>;
  summarize: (db: Db, input: PostRunSummaryCommentInput) => Promise<{ posted: boolean }>;
}

/** Default issue fetch: the exact select the failure card gate needs. */
async function defaultFetchIssue(db: Db, issueId: string): Promise<CrewFailureIssueRow | null> {
  const [row] = await db
    .select({
      title: issues.title,
      originKind: issues.originKind,
      sourceDiscussionId: issues.sourceDiscussionId,
    })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);
  return row ?? null;
}

/**
 * FAILURE: fetch the issue → if it is crew_thread-origin with a source thread,
 * post the failure card ("… could not complete …") to that thread; THEN post a
 * failure run-summary comment on the task. Each sub-step best-effort + isolated
 * (a card failure still lets the summary post, and vice-versa). Usage/cost are
 * unreliable on a thrown run, so the summary carries undefined usage + null
 * cost. Returns which sub-steps posted (for the unit test). NEVER throws.
 */
export async function postCrewRunFailure(
  db: Db,
  input: CrewRunFailureInput,
  deps: CrewRunFailureDeps = {
    fetchIssue: defaultFetchIssue,
    failureCard: postCrewFailureCard,
    summarize: postRunSummaryComment,
  },
): Promise<{ carded: boolean; summarized: boolean }> {
  let carded = false;
  let summarized = false;

  // ── Sub-step 1: failure card into the originating thread (crew_thread only) ─
  try {
    const issue = await deps.fetchIssue(db, input.issueId);
    if (issue?.originKind === "crew_thread" && issue.sourceDiscussionId) {
      await deps.failureCard(db, {
        threadId: issue.sourceDiscussionId,
        companyId: input.companyId,
        issueId: input.issueId,
        agentId: input.agentId,
        agentName: input.agentName,
        taskTitle: issue.title ?? "(untitled task)",
        error: input.errorMessage,
      });
      carded = true;
    }
  } catch (err) {
    log.warn(
      { err, issueId: input.issueId, runId: input.runId },
      "W3a crew failure card failed (non-fatal)",
    );
  }

  // ── Sub-step 2: failure run-summary comment on the task ────────────────────
  try {
    const result = await deps.summarize(
      db,
      resolveCrewRunSummaryArgs({
        companyId: input.companyId,
        issueId: input.issueId,
        agentName: input.agentName,
        runtimeConfig: input.runtimeConfig,
        outcome: "failed",
        startedAtMs: input.startedAtMs,
        nowMs: input.nowMs,
        adapterUsage: undefined, // usage is unreliable on a thrown run
        costCents: null,
        errorMessage: input.errorMessage,
        runId: input.runId,
      }),
    );
    summarized = result.posted;
  } catch (err) {
    log.warn(
      { err, issueId: input.issueId, runId: input.runId },
      "W3a crew failure run summary failed (non-fatal)",
    );
  }

  return { carded, summarized };
}
