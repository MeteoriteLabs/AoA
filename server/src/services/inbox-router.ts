// server/src/services/inbox-router.ts
//
// Task 1.2 (Inbound Dirty-Data Routing) — pure routing gate functions.
// Task 1.3 (Inbound Dirty-Data Routing) — routeInboxItem orchestrator +
//   enqueueNavigatorRoutingWakeup.
//
// Gate functions (1.2):
//
//   classifyRouting — converts scored similarity results into one of 4 outcomes,
//     using the top-1-vs-top-2 ambiguity gap (Codex #10) so near-ties are
//     never auto-filed as confident matches.
//
//   resolveRoutingAction — maps (outcome × company routing dial) to the action
//     to take.  Fail-closed on uncomputable (D2), Navigator-escalation on
//     ambiguous (D3), auto-create only at full_auto (D2).
//
// Orchestrator (1.3):
//
//   enqueueNavigatorRoutingWakeup — inserts an agentWakeupRequests row addressed
//     to the company's Navigator (kind='aoa', name='Navigator') with
//     source='inbox.routing_ambiguous'. Candidates go in payload.candidateThreadIds
//     (Codex #4 — payload.threadId triggers dispatcher skips; MUST NOT be set).
//
//   routeInboxItem — the routing heart. Loads the inbox item + company dial,
//     runs findSimilarThreadsScored, classifies, resolves the action, writes
//     lifecycle columns, performs the action (attach/create/escalate/suggest/human),
//     logs activity (Codex #12), and returns {action, outcome}. Idempotent on
//     already-routed/escalated/failed items.

import { and, eq, ne } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  threadInboxItems,
  internalAgentConfig,
} from "@armyofagents/db";
import type { Db } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";
import {
  ATTACH_CONFIDENCE,
  AMBIGUITY_MARGIN,
  type RoutingOutcome,
  type RoutingAction,
} from "./inbound-routing-constants.js";
import { findSimilarThreadsScored } from "./internal-agent/tools/thread-find-similar.js";
import { attachInboxItemToThread, promoteInboxItemToNewThread } from "./inbox-attach.js";
import { logActivity } from "./activity-log.js";

const log = logger.child({ service: "inbox-router" });

// ── SYSTEM_ACTOR ──────────────────────────────────────────────────────────────

/** System actor shape used by all system-initiated services (mirrors heartbeat/deps pattern). */
const SYSTEM_ACTOR = {
  actorId: "system",
  actorType: "system" as const,
  agentId: null,
};

// ─── classifyRouting ──────────────────────────────────────────────────────────

export interface ClassifyRoutingArgs {
  /** Whether the embedding service is available. */
  available: boolean;
  /** Scored results from findSimilarThreadsScored, ordered by distance ascending. */
  results: Array<{ threadId: string; distance: number }>;
}

export interface ClassifyRoutingResult {
  outcome: RoutingOutcome;
  /** The thread recommended for attachment (null when no candidate). */
  suggestedThreadId: string | null;
  /** 1 - top.distance, or null when there is no candidate. */
  confidence: number | null;
}

/**
 * Turn scored similarity results into one of 4 routing outcomes.
 *
 * Decision flow:
 * 1. !available → uncomputable (embedding service unavailable; fail-closed, D2).
 * 2. results.length === 0 → explicit_no_match (vector search returned nothing).
 * 3. top.distance <= ATTACH_CONFIDENCE (candidate zone):
 *    a. gap (top-2 distance − top-1 distance) >= AMBIGUITY_MARGIN → attach_confident.
 *    b. gap < AMBIGUITY_MARGIN (near-tie) → ambiguous (D3, Navigator decides).
 * 4. top.distance > ATTACH_CONFIDENCE → explicit_no_match.
 */
export function classifyRouting(args: ClassifyRoutingArgs): ClassifyRoutingResult {
  const { available, results } = args;

  // Step 1 — fail-closed: embedding unavailable.
  if (!available) {
    return { outcome: "uncomputable", suggestedThreadId: null, confidence: null };
  }

  // Step 2 — no candidates from vector search.
  if (results.length === 0) {
    return { outcome: "explicit_no_match", suggestedThreadId: null, confidence: null };
  }

  const top = results[0];
  const second = results[1];

  // Step 3 — top result is in the candidate zone.
  if (top.distance <= ATTACH_CONFIDENCE) {
    // No runner-up → gap is infinite (unambiguously the best match).
    const gap = second ? second.distance - top.distance : Infinity;

    if (gap >= AMBIGUITY_MARGIN) {
      return {
        outcome: "attach_confident",
        suggestedThreadId: top.threadId,
        confidence: 1 - top.distance,
      };
    }

    // Near-tie: Navigator must decide (Codex #10, D3).
    return {
      outcome: "ambiguous",
      suggestedThreadId: top.threadId,
      confidence: 1 - top.distance,
    };
  }

  // Step 4 — top result is outside the threshold: no usable match.
  return { outcome: "explicit_no_match", suggestedThreadId: null, confidence: null };
}

// ─── resolveRoutingAction ─────────────────────────────────────────────────────

export interface ResolveRoutingActionArgs {
  /** Company routing dial setting. */
  level: "off" | "suggest" | "auto_attach" | "full_auto";
  /** Outcome from classifyRouting. */
  outcome: RoutingOutcome;
}

/**
 * Map (outcome × routing dial level) → action.
 *
 * Decision table (rows = outcome, cols = level):
 *
 * | outcome            | off   | suggest            | auto_attach        | full_auto   |
 * |--------------------|-------|--------------------|--------------------|-------------|
 * | uncomputable       | human | human              | human              | human       |
 * | attach_confident   | human | suggest            | auto_attach        | auto_attach |
 * | ambiguous          | human | escalate_navigator | escalate_navigator | escalate_navigator |
 * | explicit_no_match  | human | human              | human              | auto_create |
 *
 * Invariants:
 * - uncomputable → always human (fail-closed, D2).
 * - ambiguous → always escalate_navigator unless off (D3 — Navigator decides).
 * - explicit_no_match + auto_create only at full_auto (D2).
 */
export function resolveRoutingAction(args: ResolveRoutingActionArgs): RoutingAction {
  const { level, outcome } = args;

  // Fail-closed: embedding was unavailable; human must route.
  if (outcome === "uncomputable") {
    return "human";
  }

  // Level "off": human handles everything.
  if (level === "off") {
    return "human";
  }

  switch (outcome) {
    case "attach_confident":
      // suggest → show suggestion, human confirms.
      // auto_attach / full_auto → silently file.
      if (level === "suggest") return "suggest";
      return "auto_attach"; // auto_attach or full_auto

    case "ambiguous":
      // Any non-off level → Navigator decides (D3).
      return "escalate_navigator";

    case "explicit_no_match":
      // Auto-create a new thread only at full_auto (D2); otherwise human.
      if (level === "full_auto") return "auto_create";
      return "human";
  }
}

// ─── enqueueNavigatorRoutingWakeup ────────────────────────────────────────────

export interface EnqueueNavigatorRoutingWakeupArgs {
  companyId: string;
  inboxItemId: string;
  /** Ordered by distance ascending (closest first). Goes in payload.candidateThreadIds
   *  — NOT payload.threadId (Codex #4: threadId in payload triggers dispatcher skips). */
  candidateThreadIds: string[];
  /** Raw cosine distances corresponding to candidateThreadIds. */
  distances: number[];
  /** top-2 distance minus top-1 distance, or null when fewer than 2 candidates. */
  gap: number | null;
}

export interface EnqueueNavigatorRoutingWakeupResult {
  wakeupId: string;
}

/**
 * Look up the company's Navigator agent (kind='aoa', name='Navigator') and
 * insert an agentWakeupRequests row for routing disambiguation.
 *
 * IMPORTANT (Codex #4): candidates go in `payload.candidateThreadIds`, NOT
 * `payload.threadId`. A threadId in the payload activates the dispatcher's
 * thread-level pause/controller-path skip logic — wrong context here.
 *
 * @throws {Error} "NAVIGATOR_NOT_FOUND" when the company has no active Navigator.
 */
export async function enqueueNavigatorRoutingWakeup(
  db: Db,
  args: EnqueueNavigatorRoutingWakeupArgs,
): Promise<EnqueueNavigatorRoutingWakeupResult> {
  const { companyId, inboxItemId, candidateThreadIds, distances, gap } = args;

  // Resolve the company's Navigator (kind='aoa', name='Navigator').
  // Mirror memory-extraction-on-close.ts: exclude terminated agents.
  const [nav] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(agents.kind, "aoa"),
        eq(agents.name, "Navigator"),
        ne(agents.status, "terminated"),
      ),
    )
    .limit(1);

  if (!nav) {
    throw new Error(
      `NAVIGATOR_NOT_FOUND: no active Navigator agent for company ${companyId}`,
    );
  }

  // Codex #4: DO NOT put a threadId in the payload at top-level.
  // The dispatcher reads payload.threadId to apply thread-level pauses and
  // controller-path skip logic. Routing-ambiguous wakeups are not thread-scoped,
  // so we use candidateThreadIds instead.
  const result = await db
    .insert(agentWakeupRequests)
    .values({
      companyId,
      agentId: nav.id,
      source: "inbox.routing_ambiguous",
      reason: "routing_ambiguous",
      payload: {
        inboxItemId,
        candidateThreadIds,
        distances,
        gap,
      } as Record<string, unknown>,
      status: "queued",
    })
    .returning({ id: agentWakeupRequests.id });

  const row = result[0];
  if (!row?.id) {
    throw new Error("enqueueNavigatorRoutingWakeup: insert returned no id");
  }

  return { wakeupId: row.id };
}

// ─── routeInboxItem ──────────────────────────────────────────────────────────

export interface RouteInboxItemArgs {
  inboxItemId: string;
  /** Async embedding function; pass `undefined` when the service is absent. */
  embedText?: ((text: string) => Promise<number[]>) | null;
}

export interface RouteInboxItemResult {
  action: RoutingAction;
  outcome: RoutingOutcome;
}

/**
 * The routing orchestrator.
 *
 * Loads the inbox item + company routing dial, runs similarity scoring,
 * classifies the outcome, resolves the action, writes lifecycle columns,
 * performs the action, logs activity, and returns {action, outcome}.
 *
 * Idempotent: if routingStatus is already not 'pending_route' OR status is not
 * 'pending', returns a no-op result immediately (the sweep + async trigger may
 * both call this).
 *
 * Error containment: if the action step throws, sets routingStatus='failed' +
 * routingErrorCode and returns — never crashes the caller.
 */
export async function routeInboxItem(
  db: Db,
  args: RouteInboxItemArgs,
): Promise<RouteInboxItemResult> {
  const { inboxItemId, embedText } = args;

  // ── 1. Load the inbox item ─────────────────────────────────────────────────
  const itemRows = await db
    .select({
      id: threadInboxItems.id,
      companyId: threadInboxItems.companyId,
      rawContent: threadInboxItems.rawContent,
      status: threadInboxItems.status,
      routingStatus: threadInboxItems.routingStatus,
    })
    .from(threadInboxItems)
    .where(eq(threadInboxItems.id, inboxItemId))
    .limit(1);

  const item = itemRows[0] ?? null;
  if (!item) {
    // Item not found — nothing to route.
    log.warn({ inboxItemId }, "routeInboxItem: item not found — no-op");
    return { action: "human", outcome: "uncomputable" };
  }

  // ── 2. Idempotency guard (Codex #9) ───────────────────────────────────────
  // The sweep + the async trigger may both call this. If the item is already
  // routed/escalated/failed, return without doing anything.
  if (item.routingStatus !== "pending_route" || item.status !== "pending") {
    log.debug(
      { inboxItemId, routingStatus: item.routingStatus, status: item.status },
      "routeInboxItem: already processed — no-op",
    );
    return { action: "human", outcome: "uncomputable" };
  }

  const { companyId, rawContent } = item;

  // ── 3. Load the company routing dial ──────────────────────────────────────
  const configRows = await db
    .select({ inboundRoutingLevel: internalAgentConfig.inboundRoutingLevel })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId))
    .limit(1);

  // Default 'off' when not yet configured (mirrors D5 teaching default).
  const level = (configRows[0]?.inboundRoutingLevel ?? "off") as
    | "off"
    | "suggest"
    | "auto_attach"
    | "full_auto";

  // ── 4. Similarity scoring ─────────────────────────────────────────────────
  const scored = await findSimilarThreadsScored({
    db,
    embedText,
    companyId,
    text: rawContent,
    limit: 5,
  });

  // ── 5. Classify + resolve ─────────────────────────────────────────────────
  const { outcome, suggestedThreadId, confidence } = classifyRouting(scored);
  const action = resolveRoutingAction({ level, outcome });

  // ── 6. Write routing fields (pre-action) ──────────────────────────────────
  // Always write routerConfidence, routerDecision, suggestedThreadId.
  // routingStatus and routedAt are set per-action below.
  await db
    .update(threadInboxItems)
    .set({
      routerConfidence: confidence,
      routerDecision: action,
      suggestedThreadId: suggestedThreadId ?? null,
    })
    .where(eq(threadInboxItems.id, inboxItemId));

  // ── 7. Perform action ─────────────────────────────────────────────────────
  try {
    switch (action) {
      case "auto_attach": {
        // attachInboxItemToThread handles status='attached' + routingStatus='routed'
        // inside its own transaction. We also set these fields here to ensure
        // the lifecycle columns are always written even if attach's tx sets them.
        await attachInboxItemToThread(db, {
          companyId,
          inboxItemId,
          threadId: suggestedThreadId!,
          actor: SYSTEM_ACTOR,
        });
        // attach sets status='attached' + routingStatus='routed' internally,
        // but we also explicitly write the lifecycle fields to be self-contained.
        await db
          .update(threadInboxItems)
          .set({ routingStatus: "routed", routedAt: new Date() })
          .where(eq(threadInboxItems.id, inboxItemId));
        break;
      }

      case "auto_create": {
        await promoteInboxItemToNewThread(db, {
          companyId,
          inboxItemId,
          actor: SYSTEM_ACTOR,
        });
        // promote sets status='attached' + routingStatus='routed' internally.
        await db
          .update(threadInboxItems)
          .set({ routingStatus: "routed", routedAt: new Date() })
          .where(eq(threadInboxItems.id, inboxItemId));
        break;
      }

      case "escalate_navigator": {
        // Compute gap: top-2 distance minus top-1 distance.
        const gap =
          scored.results.length >= 2
            ? scored.results[1].distance - scored.results[0].distance
            : null;

        const { wakeupId } = await enqueueNavigatorRoutingWakeup(db, {
          companyId,
          inboxItemId,
          candidateThreadIds: scored.results.map((r) => r.threadId),
          distances: scored.results.map((r) => r.distance),
          gap,
        });

        // Item stays status='pending' (Navigator hasn't acted yet).
        // routingStatus='escalated' so the sweep knows not to re-route.
        await db
          .update(threadInboxItems)
          .set({
            routingStatus: "escalated",
            routedAt: new Date(),
            navigatorWakeupId: wakeupId,
          })
          .where(eq(threadInboxItems.id, inboxItemId));
        break;
      }

      case "suggest": {
        // Router did its job: wrote routerDecision='suggest' + suggestedThreadId.
        // Human confirms attachment from Inbox. Item stays status='pending'.
        await db
          .update(threadInboxItems)
          .set({ routingStatus: "routed" })
          .where(eq(threadInboxItems.id, inboxItemId));
        break;
      }

      case "human": {
        // No suggestion; item stays status='pending' for manual triage.
        await db
          .update(threadInboxItems)
          .set({ routingStatus: "routed" })
          .where(eq(threadInboxItems.id, inboxItemId));
        break;
      }
    }
  } catch (err: unknown) {
    // Action step threw — mark failed so the sweep won't retry without
    // intervention. Never crash the caller.
    const errorCode =
      err instanceof Error && err.message.startsWith("NAVIGATOR_NOT_FOUND")
        ? "NAVIGATOR_NOT_FOUND"
        : err instanceof Error && err.message.startsWith("COMPANY_MISMATCH")
          ? "COMPANY_MISMATCH"
          : "UNKNOWN";

    log.error(
      { err, inboxItemId, action, outcome },
      "routeInboxItem: action step failed — marking routingStatus=failed",
    );

    await db
      .update(threadInboxItems)
      .set({ routingStatus: "failed", routingErrorCode: errorCode })
      .where(eq(threadInboxItems.id, inboxItemId))
      .catch((updateErr) => {
        log.error(
          { updateErr, inboxItemId },
          "routeInboxItem: could not write routingStatus=failed",
        );
      });

    return { action, outcome };
  }

  // ── 8. Activity log (Codex #12) ───────────────────────────────────────────
  await logActivity(db, {
    companyId,
    actorType: "system",
    actorId: "system",
    action: "thread.inbox_item.routed",
    entityType: "thread_inbox_item",
    entityId: inboxItemId,
    details: { outcome, action, suggestedThreadId },
  }).catch((err) => {
    // Activity log failure must never block routing.
    log.warn({ err, inboxItemId }, "routeInboxItem: logActivity failed — continuing");
  });

  return { action, outcome };
}
