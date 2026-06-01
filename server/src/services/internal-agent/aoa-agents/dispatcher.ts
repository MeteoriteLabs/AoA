import { and, eq, lt, inArray, notInArray, sql, gt } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries, discussions, internalAgentRuns, agentWakeupRequests, agents, internalAgentConfig } from "@armyofagents/db";
import { listEnabledOutboxAgents } from "./triggers.js";
import { ensureExtractionAgent } from "./ensure-extraction-agent.js";
import { runExtractionConsumer } from "../subagents/extraction-consumer.js";
import { runAoaAgent } from "./runner.js";
import { createLimiter } from "../subagents/concurrency-limiter.js";
import { publishLiveEvent } from "../../live-events.js";
import { logger } from "../../../middleware/logger.js";
import { isRoleActiveAtAutonomy, ROLE_MIN_AUTONOMY, type CrewRole } from "./autonomy.js";
import { resolveCrewRole } from "./resolve-crew-role.js";
import { isCrewPaused } from "./kill-switch.js";
import { runRateExceeded, resolveRoleModel, DEFAULT_CREW_RATE_LIMIT } from "../cost-caps.js";
// A3: pre-spend budget hard-stop. budgets.ts lives at services/ root (sibling
// of live-events.ts, imported as ../../live-events.js above), so from
// internal-agent/aoa-agents/ it resolves up TWO levels: ../../budgets.js.
import { budgetService } from "../../budgets.js";

export interface DispatchOptions {
  /** Max simultaneous extractions per dispatch tick. */
  limiterMax: number;
  /** A 'processing' entry whose LINKED run has been 'running' (non-terminal)
   *  longer than this is treated as orphaned (crash between the M2 atomic
   *  claim and a terminal status). Must be conservatively larger than the
   *  longest legitimate extraction so healthy in-flight is never reset. */
  staleMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// @deprecated — Phase 1 (Task C1): autonomous Scribe outbox drain is OFF by
// default. The pre-existing Phase-2 code path below (per-company outbox-trigger
// gated dispatch of pending discussion entries through `runExtractionConsumer`)
// is preserved for rollback safety and for the existing aoa-dispatcher tests
// that pin its mechanism, but it does NOT fire in production.
//
// Rationale: extraction is now invoked via tools by Memory Keeper (at
// phase=done sweep) and Adjutant (optional, mid-discussion). Firing the LLM
// on every entry was burning calls on entries that no role needed.
//
// Reactivate by setting `AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED=true`. Tests that
// assert legacy autonomous-drain behaviour MUST set this in `beforeEach`.
// When the new tool path is fully exercised in production the gated block can
// be deleted (and the related Phase-1 / Phase-4 reclaim phases — which only
// matter when entries reach 'processing' via the autonomous consumer — can be
// reassessed). Until then we keep all of them intact.
// ─────────────────────────────────────────────────────────────────────────────
function isScribeAutonomousDrainEnabled(): boolean {
  const raw = process.env.AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * AoA Dispatcher — the generalized durable poll (transactional-outbox
 * pattern), not an event listener. Generalizes the battle-tested
 * Decision-#99 extraction sweeper: the committed row
 * `discussion_entries.extractionStatus='pending'` IS the work item, so no
 * event can be "lost" (spec §6.2). Each tick:
 *
 *  1. RECLAIM orphans (spec §6.3) — VERBATIM the #99 linked-run reclaim.
 *     Orphan = entry `processing` AND its **linked current run**
 *     (`extraction_run_id`, set by the consumer at run creation) is still
 *     `running` and older than staleMs. Reclaim atomically: (a) terminalize
 *     that linked run → `failed` so it can never re-trigger reclaim (no
 *     zombie `running` rows, no perpetual re-reclaim of a healthily-
 *     reprocessing entry — the bug the prior join-on-any-running design
 *     produced); (b) reset the entry → `pending`, `extraction_run_id=null`.
 *     Both guarded so they are safe under concurrency with the consumer /
 *     the untouched reprocess path. Using the LINKED run means a stale
 *     leftover run from a *previous* attempt cannot condemn an entry that a
 *     *fresh* run is healthily processing. (Identical predicates to the
 *     extraction sweeper; only the reclaim error message differs.)
 *
 *  2. DRAIN pending (incl. just-reclaimed), GATED PER COMPANY. A pending
 *     entry is only dispatched if its company has an enabled `outbox`
 *     trigger (`listEnabledOutboxAgents`). Companies with no enabled outbox
 *     agent are SKIPPED — they have not opted into the durable extraction
 *     pipeline. For gated-in companies the extraction agent is resolved
 *     (memoized per company) and the consumer invoked under a bounded
 *     limiter. The Milestone-2 atomic claim inside extractFromDiscussionEntry
 *     guarantees at-most-one extraction per entry even under concurrent
 *     pickup.
 *
 * Memoizes BOTH the per-company enabled-outbox check and the per-company
 * extraction agent id once per tick.
 */
export async function runAoaDispatch(db: Db, opts: DispatchOptions): Promise<void> {
  const staleCutoff = new Date(Date.now() - opts.staleMs);

  // ── Phase 1: reclaim orphaned 'processing' entries (#99 verbatim) ──────────
  const orphanRows: Array<{ id: string; runId: string | null }> = await db
    .select({
      id: discussionEntries.id,
      runId: discussionEntries.extractionRunId,
    })
    .from(discussionEntries)
    .leftJoin(
      internalAgentRuns,
      eq(internalAgentRuns.id, discussionEntries.extractionRunId),
    )
    .where(
      // Orphan = a CONSUMER-driven 'processing' entry whose LINKED run is
      // still 'running' and older than the stale window. The consumer links
      // extraction_run_id *before* the atomic claim, so every consumer-driven
      // 'processing' entry has a non-null linked run — there is no consumer
      // path that yields (processing, run_id NULL). The only producer of
      // (processing, run_id NULL) is the untouched reprocess direct-call path
      // (Q2-b), which is HEALTHY in-flight work; a NULL-guard branch would
      // false-reclaim it and cause double extraction. Reprocess-crash
      // recovery is a deferred follow-up (spec §16.1), not in scope here.
      and(
        eq(discussionEntries.extractionStatus, "processing"),
        eq(internalAgentRuns.status, "running"),
        lt(internalAgentRuns.createdAt, staleCutoff),
      ),
    )
    .then((r: Array<{ id: string; runId: string | null }>) => r);

  if (orphanRows.length > 0) {
    const orphanIds = [...new Set(orphanRows.map((o) => o.id))];
    const staleRunIds = [
      ...new Set(
        orphanRows
          .map((o) => o.runId)
          .filter((v): v is string => typeof v === "string"),
      ),
    ];

    // (a) Terminalize the stale linked runs so they can never re-trigger
    //     reclaim. Guarded on status='running' so an already-terminal run is
    //     never clobbered.
    if (staleRunIds.length > 0) {
      await db
        .update(internalAgentRuns)
        .set({
          status: "failed",
          errorMessage: "reclaimed: orphaned (aoa-dispatcher)",
          completedAt: new Date(),
        })
        .where(
          and(
            inArray(internalAgentRuns.id, staleRunIds),
            eq(internalAgentRuns.status, "running"),
          ),
        );
    }

    // (b) Reset the entries → pending. Guarded on status='processing' so it
    //     is safe even if state changed between the select and the update.
    await db
      .update(discussionEntries)
      .set({ extractionStatus: "pending", extractionRunId: null })
      .where(
        and(
          inArray(discussionEntries.id, orphanIds),
          eq(discussionEntries.extractionStatus, "processing"),
        ),
      );
  }

  // ── Phase 2 & Phase 3 SELECTS issued first, in the original positional
  //    order (Phase-2 pending-select THEN Phase-3 wakeup-select), then the two
  //    DRAIN loops run CONCURRENTLY (M4/FX5) ──────────────────────────────────
  //
  // M4: previously Phase-2 (extraction backlog, up to 200/tick) was fully
  // `await`ed before Phase-3 (the @mention / delegate_to_subagent wakeup
  // queue) was even queried, and BOTH shared a single limiter. Under an
  // extraction backlog every wakeup waited behind the entire extraction batch
  // each tick and one noisy company could starve others — a liveness defect
  // for the delegation/@mention path. Phase-2 and Phase-3 have NO data
  // dependency (disjoint tables/rows: pending discussion entries vs the
  // agent_wakeup_requests queue), so their DRAINS now overlap via
  // Promise.all, each under its OWN limiter so an extraction backlog cannot
  // consume the slots the wakeup drain needs. Phase-1 still runs first and
  // fully awaited (ordering invariant: it resets orphans → 'pending', which
  // Phase-2's pending-select below must see). The two SELECT queries are
  // still issued synchronously here in the original order (Phase-2 then
  // Phase-3) — only the drain loops are parallelized, so the positional
  // select order other suites depend on is unchanged. No double-processing:
  // Phase-2 is keyed by entry + the M2 atomic claim; Phase-3 by the
  // per-wakeup atomic queued→processing claim — both already idempotent and
  // they touch disjoint rows, so overlapping them changes nothing there.
  const rows: Array<{ id: string; companyId: string }> = await db
    .select({ id: discussionEntries.id, companyId: discussions.companyId })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    // P1-T7 defense-in-depth: never feed a scope_proposal entry to the LLM
    // extractor. Proposals carry their approval lifecycle in proposalStatus and
    // are inserted extractionStatus="skipped" so this filter is normally moot,
    // but excluding by inputType here guarantees that even a mis-inserted
    // proposal (extractionStatus="pending") can't be claimed by the drain and
    // have its approval state clobbered (pending -> processing -> completed).
    .where(
      and(
        eq(discussionEntries.extractionStatus, "pending"),
        notInArray(discussionEntries.inputType, ["scope_proposal"]),
      ),
    )
    .limit(200)
    .then((r: Array<{ id: string; companyId: string }>) => r);

  // T1.2 (codex F6): also read agentWakeupRequests.source so the dispatcher
  // can pass the ORIGINAL trigger source through to runAoaAgent — previously
  // hardcoded "wakeup" in the runAoaAgent call below, which made the prompt's
  // trigger-context block lie about what actually triggered the run.
  const wakeupRows: Array<{ id: string; agentId: string; companyId: string; source: string; payload: Record<string, unknown> | null }> = await db
    .select({
      id: agentWakeupRequests.id,
      agentId: agentWakeupRequests.agentId,
      companyId: agentWakeupRequests.companyId,
      source: agentWakeupRequests.source,
      payload: agentWakeupRequests.payload,
    })
    .from(agentWakeupRequests)
    .innerJoin(agents, eq(agents.id, agentWakeupRequests.agentId))
    .where(
      and(
        eq(agentWakeupRequests.status, "queued"),
        eq(agents.kind, "aoa"),
        notInArray(agents.status, ["paused", "terminated"]),
      ),
    )
    .limit(200)
    .then((r) => r);

  // Each phase gets its OWN limiter so an extraction backlog (Phase-2) cannot
  // exhaust every slot the wakeup drain (Phase-3) needs — the whole point of
  // the M4 fix. limiterMax / its call-site value are unchanged.
  const p2Limiter = createLimiter(opts.limiterMax);
  const p3Limiter = createLimiter(opts.limiterMax);

  const drainPhase2 = async (): Promise<void> => {
    if (rows.length === 0) return;
    // ── Phase 1 (Task C1): autonomous Scribe drain gated OFF by default ──────
    // The SELECT above still runs so the positional-select order other suites
    // depend on is byte-stable (slot 1 = pending-drain) and so the legacy
    // Phase-1 / Phase-4 reclaim phases can still observe what is or isn't
    // pending. Only the dispatch through `runExtractionConsumer` is gated.
    //
    // When the flag is OFF, Memory Keeper (phase=done sweep) and Adjutant
    // (optional, mid-discussion) own extraction — they call the tool-callable
    // functions in `services/extraction.ts` (extractMemoryCandidates, etc.).
    // Set `AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED=true` to reactivate the legacy
    // outbox drain (tests that pin its mechanism do this in `beforeEach`).
    if (!isScribeAutonomousDrainEnabled()) return;

    // Per-company memoization within this tick: the enabled-outbox gate result
    // (true = has an enabled outbox agent) and the resolved extraction agent id.
    const outboxByCompany = new Map<string, boolean>();
    const agentByCompany = new Map<string, string>();

    await Promise.allSettled(
      rows.map((row) =>
        p2Limiter.run(async () => {
          // Gate: only dispatch if the company has an enabled `outbox` trigger.
          let gated = outboxByCompany.get(row.companyId);
          if (gated === undefined) {
            const enabled = await listEnabledOutboxAgents(db, row.companyId);
            gated = enabled.length > 0;
            outboxByCompany.set(row.companyId, gated);
          }
          if (!gated) return; // no outbox trigger for this company → skip

          let agentId = agentByCompany.get(row.companyId);
          if (!agentId) {
            agentId = await ensureExtractionAgent(db, row.companyId);
            agentByCompany.set(row.companyId, agentId);
          }
          await runExtractionConsumer(db, row.companyId, row.id, agentId);
        }),
      ),
    );
  };

  // Per-company config memoization within this tick (autonomy + kill-switch + model + routing dial).
  const configByCompany = new Map<string, { autonomyLevel: number; crewPaused: boolean; model: string; inboundRoutingLevel: string }>();
  async function resolveCompanyConfig(companyId: string): Promise<{ autonomyLevel: number; crewPaused: boolean; model: string; inboundRoutingLevel: string }> {
    if (configByCompany.has(companyId)) return configByCompany.get(companyId)!;
    const [cfg] = await db
      .select({ autonomyLevel: internalAgentConfig.autonomyLevel, crewPaused: internalAgentConfig.crewPaused, model: internalAgentConfig.model, inboundRoutingLevel: internalAgentConfig.inboundRoutingLevel })
      .from(internalAgentConfig)
      .where(eq(internalAgentConfig.companyId, companyId))
      .limit(1);
    const config = {
      autonomyLevel: cfg?.autonomyLevel ?? 0,
      crewPaused: cfg?.crewPaused ?? false,
      model: (cfg?.model ?? "claude-sonnet-4-6") as string,
      // D4: inbound routing has its own dial, distinct from crew autonomy.
      // Default 'off' when no config row exists — teams opt-in explicitly.
      inboundRoutingLevel: (cfg?.inboundRoutingLevel ?? "off") as string,
    };
    configByCompany.set(companyId, config);
    return config;
  }
  const drainPhase3 = async (): Promise<void> => {
    if (wakeupRows.length === 0) return;
    await Promise.allSettled(
      wakeupRows.map((w) =>
        p3Limiter.run(async () => {
          const companyCfg = await resolveCompanyConfig(w.companyId);

          // D4: inbox-routing wakeups are gated on the routing dial
          // (inboundRoutingLevel), NOT on crew autonomy. The Navigator must
          // be dispatchable to route inbound items even when autonomyLevel=0.
          // #4: the payload deliberately omits threadId so the thread-level
          // pause/controller skips cannot silently swallow the escalation.
          const isInboxRouting = w.source === "inbox.routing_ambiguous";
          // Chronicler is always-on infrastructure (autonomy 0): it maintains
          // each thread's routing card regardless of the strangler controller
          // path or crew-pause. Like inbox-routing, its sweep wakeups must NOT
          // be swallowed by the thread-level crewPaused / useControllerPath
          // gates below — otherwise cards never refresh on modern
          // (useControllerPath=true) threads and the routing redesign is inert.
          // It STILL passes through the autonomy gate (chronicler:0 → always on).
          const isInfraSweep = w.source === "sweep.chronicler";
          if (isInboxRouting) {
            if (companyCfg.inboundRoutingLevel === "off") {
              await db
                .update(agentWakeupRequests)
                .set({ status: "skipped_routing_off", finishedAt: new Date() })
                .where(eq(agentWakeupRequests.id, w.id));
              logger.child({ subagent: "aoa-dispatcher" }).info(
                { wakeupId: w.id, companyId: w.companyId },
                "aoa wakeup skipped: inbound routing dial off",
              );
              return;
            }
            // suggest / auto_attach / full_auto → fall through to rate-brake,
            // atomic claim, and runAoaAgent dispatch below.
          }

          // Plan 3 Task 8: kill-switch gate — check company pause first.
          // Thread-level pause is read live from discussions.crewPaused so a
          // founder's pause/resume is reflected immediately, even for wakeups
          // that were already queued before the pause. Payload-based
          // threadCrewPaused is NOT used — nothing populates it at enqueue
          // time, so reading it would make the gate permanently inert.
          //
          // UAT iteration 2 fix: the wakeup payload uses `threadId` (set by
          // the mention parser in threads.ts, sweep-adjutant, sweep-memory-
          // keeper, notify-owner-tool) — NOT `discussionId`. Reading
          // `discussionId` made this gate silently inert because the lookup
          // key never matched. `threads` and `discussions` are the same
          // table; `threadId` IS the discussion's primary key.
          //
          // #3 / #4: inbox-routing wakeups have no threadId (by design) and
          // must NOT be gated by thread-level pause or controller-path checks.
          // The isInboxRouting branch above returns early on 'off', so by the
          // time we reach here, inbox-routing wakeups have inboundRoutingLevel
          // != 'off' and must fall straight through to dispatch.
          // Infra sweeps (Chronicler) bypass the thread-level pause/controller
          // gates, so we don't need the threadRow lookup for them.
          const threadIdInPayload = (w.payload as Record<string, unknown> | null)?.threadId;
          const threadRow = !isInboxRouting && !isInfraSweep && typeof threadIdInPayload === "string" && threadIdInPayload.length > 0
            ? await db
                .select({ crewPaused: discussions.crewPaused, useControllerPath: discussions.useControllerPath })
                .from(discussions)
                .where(eq(discussions.id, threadIdInPayload))
                .then((rows: Array<{ crewPaused: boolean | null; useControllerPath: boolean | null }>) => rows[0] ?? null)
            : null;
          // Thread-level pause + controller-path gates: skipped for inbox-routing
          // (#3/#4) AND infra sweeps (Chronicler), both of which must run on every
          // thread regardless of the strangler controller path.
          if (!isInboxRouting && !isInfraSweep) {
            const threadPaused = Boolean(threadRow?.crewPaused);
            if (isCrewPaused({ companyPaused: companyCfg.crewPaused, threadPaused })) {
              // P2 fix: distinct terminal status so the wakeup table tells you
              // WHY a wakeup ended, not just that it ended. Was collapsed into
              // 'done' which made silent failures invisible.
              await db
                .update(agentWakeupRequests)
                .set({ status: "skipped_paused", finishedAt: new Date() })
                .where(eq(agentWakeupRequests.id, w.id));
              logger.child({ subagent: "aoa-dispatcher" }).info(
                { agentId: w.agentId, companyId: w.companyId, threadPaused },
                "aoa wakeup skipped: crew kill-switch active",
              );
              return;
            }

            // P1-T11: Defense-in-depth gate — controller-path threads are driven
            // by the orchestration controller, not the peer-wake pipeline. Any
            // wakeup that slipped through (e.g. from a pre-T11 row) is skipped.
            if (threadRow?.useControllerPath) {
              logger.child({ subagent: "aoa-dispatcher" }).debug(
                { wakeupId: w.id },
                "aoa wakeup skipped: controller-path thread (peer-wake dormant)",
              );
              return;
            }
          }

          // Autonomy gate applies to all non-inbox-routing wakeups (including
          // the Chronicler, which passes at chronicler:0).
          if (!isInboxRouting) {
            // Plan 3 Task 4: autonomyLevel gate — agentic crew roles (router,
            // planner, dispatcher) require autonomyLevel ≥ 2. Core roles
            // (scribe, memory_keeper, curator) are always active (min = 0).
            //
            // UAT iteration 2 contract: ALL wakeup enqueue sites populate
            // payload.role with the crew role key (router/planner/maker/...).
            // - Sweeps: sweep-adjutant + sweep-memory-keeper already do this.
            // - Mentions: threads.ts processMentions now does this too (looks
            //   up aoaAgentTriggers.config.role). Without that, every @Router
            //   / @Planner / @Dispatcher mention bypassed the gate.
            // runtimeConfig.aoa.role is NOT the source — that field is always
            // the literal string "member" (a template default, never
            // specialized per agent). Don't read it.
            // A2 — FAIL CLOSED. The pre-fix gate only fired
            // `if (payloadRole && !isRoleActiveAtAutonomy(...))`, so a wakeup
            // with NO payload.role skipped the gate and ran regardless of the
            // dial (the live bug). Now resolve the role — payload.role first
            // (only if it's a KNOWN crew role), else the durable
            // aoaAgentTriggers lookup (resolveCrewRole). An unresolved/unknown
            // role must NOT be a free pass: treat it as Drive-only (the most
            // restrictive default — only autonomyLevel ≥ 2 runs it).
            const payloadRole = (w.payload as Record<string, unknown> | null)?.role as string | undefined;
            const resolvedRole = (payloadRole && (Object.keys(ROLE_MIN_AUTONOMY) as string[]).includes(payloadRole))
              ? (payloadRole as CrewRole)
              : await resolveCrewRole(db, w.agentId);
            const roleActive = resolvedRole
              ? isRoleActiveAtAutonomy(resolvedRole, companyCfg.autonomyLevel)
              : companyCfg.autonomyLevel >= 2; // no role → only at Drive
            if (!roleActive) {
              // P2 fix: distinct terminal status (was 'done'). The wakeup was
              // correctly queued but the autonomy level prevents execution for
              // agentic roles. Mark explicitly so the wakeup table is debuggable.
              await db
                .update(agentWakeupRequests)
                .set({ status: "skipped_autonomy", finishedAt: new Date() })
                .where(eq(agentWakeupRequests.id, w.id));
              logger.child({ subagent: "aoa-dispatcher" }).info(
                { agentId: w.agentId, role: resolvedRole ?? null, autonomy: companyCfg.autonomyLevel, companyId: w.companyId },
                "aoa wakeup skipped: autonomy gate (fail-closed)",
              );
              return;
            }
          }

          // T1.1: rate-brake counts only PAID runs (costCents > 0). Fast-
          // failing $0 runs (e.g. broken adapter exiting in <1s) don't
          // contribute to the LLM-spend safety net — the brake's actual
          // purpose. A separate failure-storm brake (T1.9) catches runaway
          // failure loops independently of cost. Codex finding #3+#5.
          const windowStart = new Date(Date.now() - DEFAULT_CREW_RATE_LIMIT.windowMinutes * 60_000);
          const windowRuns = await db
            .select({ id: internalAgentRuns.id })
            .from(internalAgentRuns)
            .where(and(
              eq(internalAgentRuns.companyId, w.companyId),
              gt(internalAgentRuns.createdAt, windowStart),
              gt(internalAgentRuns.costCents, 0), // T1.1: only paid runs
            ))
            .then((r: Array<{ id: string }>) => r.length);
          if (runRateExceeded(windowRuns, DEFAULT_CREW_RATE_LIMIT.maxRunsPerWindow)) {
            // P2 fix: distinct terminal status (was 'done'). Rate-limit skips
            // were the dominant cause of "wakeup vanished" symptoms before
            // P1-B was fixed — now they're visible in the wakeup table.
            await db
              .update(agentWakeupRequests)
              .set({ status: "skipped_rate_limit", finishedAt: new Date() })
              .where(eq(agentWakeupRequests.id, w.id));
            logger.child({ subagent: "aoa-dispatcher" }).warn(
              { agentId: w.agentId, windowRuns, limit: DEFAULT_CREW_RATE_LIMIT.maxRunsPerWindow, companyId: w.companyId },
              "aoa wakeup skipped: run-rate brake (D3)",
            );
            return;
          }

          // Plan 3 Task 9: resolve per-role model (role config > company default).
          // The resolved model is passed in the payload so runner.ts can use it.
          const agentRow = await db
            .select({ runtimeConfig: agents.runtimeConfig, adapterConfig: agents.adapterConfig })
            .from(agents)
            .where(eq(agents.id, w.agentId))
            .then((r: Array<{ runtimeConfig: unknown; adapterConfig: unknown }>) => r[0] ?? null);
          const agentRc = (agentRow?.runtimeConfig as Record<string, unknown>) ?? {};
          const agentAdapterCfg = (agentRow?.adapterConfig as Record<string, unknown>) ?? {};
          const roleModel = resolveRoleModel({
            roleModel: (agentRc.model ?? agentAdapterCfg.model ?? null) as string | null,
            companyDefault: companyCfg.model,
          });

          // A3: pre-spend budget hard-stop (per-agent + company). Returns a reason
          // string when blocked, null when clear. Runs as the LAST gate before the
          // atomic claim so we never spend on a run the budget policy forbids.
          const budgetBlock = await budgetService(db).getInvocationBlock(w.agentId, w.companyId);
          if (budgetBlock) {
            await db.update(agentWakeupRequests)
              .set({ status: "skipped_budget", finishedAt: new Date() })
              .where(eq(agentWakeupRequests.id, w.id));
            logger.child({ subagent: "aoa-dispatcher" }).warn(
              { agentId: w.agentId, companyId: w.companyId, reason: budgetBlock },
              "aoa wakeup skipped: budget hard-stop",
            );
            return;
          }

          // Atomic claim: queued → processing
          const claimed = await db
            .update(agentWakeupRequests)
            .set({ status: "processing", claimedAt: new Date() })
            .where(and(eq(agentWakeupRequests.id, w.id), eq(agentWakeupRequests.status, "queued")))
            .returning({ id: agentWakeupRequests.id });
          if (claimed.length === 0) return; // already claimed by concurrent tick

          // D10: compute effectiveAutonomy = threadLevel ?? companyLevel
          const wkPayload = (w.payload ?? {}) as Record<string, unknown>;
          let effectiveAutonomy: number | null = companyCfg.autonomyLevel;
          if (typeof wkPayload.threadId === "string") {
            const thread = await db
              .select({ autonomyLevel: discussions.autonomyLevel })
              .from(discussions)
              .where(eq(discussions.id, wkPayload.threadId))
              .then((rows: Array<{ autonomyLevel: number | null }>) => rows[0] ?? null);
            if (thread) {
              effectiveAutonomy = thread.autonomyLevel ?? companyCfg.autonomyLevel;
            }
          }

          try {
            // T1.0: runAoaAgent now returns AoaRunResult. The wakeup row
            // reflects the actual outcome (succeeded/failed) the runner
            // reports, not just whether it threw. Cost/usage already
            // persisted to internal_agent_runs by the runner itself.
            const result = await runAoaAgent(db, w.agentId, {
              companyId: w.companyId,
              // T1.2 (codex F6): pass the wakeup's ORIGINAL source (e.g.
              // 'thread_mention', 'sweep.adjutant', 'phase-advance') NOT the
              // hardcoded 'wakeup'. The runner's role-aware trigger prompt
              // shows the LLM exactly what triggered this run.
              source: w.source,
              wakeupId: w.id,
              resolvedModel: roleModel, // Plan 3 Task 9: pass resolved model to runner
              effectiveAutonomy,
              ...(w.payload ?? {}),
            });
            // P2 + T1.0: status reflects what the runner actually saw.
            // 'succeeded' = adapter exited cleanly with no errorMessage.
            // 'failed' = adapter exitCode != 0, errorMessage set, or a
            // runner guard tripped (e.g. silent-failure guard from T1.5).
            await db
              .update(agentWakeupRequests)
              .set({
                status: result.status,
                error: result.errorMessage ?? null,
                finishedAt: new Date(),
              })
              .where(eq(agentWakeupRequests.id, w.id));
          } catch (err: unknown) {
            await db
              .update(agentWakeupRequests)
              .set({
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                finishedAt: new Date(),
              })
              .where(eq(agentWakeupRequests.id, w.id));
          }
        }),
      ),
    );
  };

  // Drains overlap; selects above already ran in the original order.
  await Promise.all([drainPhase2(), drainPhase3()]);

  // ── Phase 4 (FX1/B1): disjoint reclaim — 'processing' entries whose LINKED
  //    run is already 'failed' ────────────────────────────────────────────────
  // Phase 1 handles entries whose linked run is still 'running' & stale (crash
  // mid-flight) → reset to 'pending' for a retry. This phase handles a
  // DIFFERENT terminal case: the runner's catch terminalized the RUN →
  // 'failed' but (pre-FX1) left the entry stuck 'processing' forever — silent
  // permanent loss. The run already failed, so retrying is wrong — terminalize
  // the ENTRY → 'failed' (NOT 'pending') + emit the
  // discussion.extraction.failed LiveEvent. Mirrors extraction.ts's failure
  // branch (status + sourceInfo.extractionError + event; NO notification).
  // Disjoint from Phase 1 (linked run 'running' vs 'failed' are mutually
  // exclusive) and from the runner's own in-process terminalizer (this is the
  // durable safety net for a run that died before it could run its catch —
  // e.g. SIGKILL). Runs LAST: it neither feeds Phase 2 (output is terminal
  // 'failed', not 'pending') nor interacts with the Phase 3 wakeup queue, so
  // ordering is irrelevant to correctness. Each transition individually
  // guarded; per-entry best-effort so one failure can't abort the tick.
  const failedRunRows: Array<{
    id: string;
    discussionId: string;
    companyId: string;
  }> = await db
    .select({
      id: discussionEntries.id,
      discussionId: discussionEntries.discussionId,
      companyId: discussions.companyId,
    })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .leftJoin(
      internalAgentRuns,
      eq(internalAgentRuns.id, discussionEntries.extractionRunId),
    )
    .where(
      and(
        eq(discussionEntries.extractionStatus, "processing"),
        eq(internalAgentRuns.status, "failed"),
      ),
    )
    .limit(200)
    .then(
      (
        r: Array<{ id: string; discussionId: string; companyId: string }>,
      ) => r,
    );

  if (failedRunRows.length > 0) {
    const reclaimErr = "reclaimed: extraction run failed (aoa-dispatcher)";
    for (const fr of failedRunRows) {
      // Guarded on status='processing' so a concurrent transition is never
      // clobbered.
      await db
        .update(discussionEntries)
        .set({
          extractionStatus: "failed",
          sourceInfo: sql`jsonb_set(COALESCE(${discussionEntries.sourceInfo}, '{}'::jsonb), '{extractionError}', ${JSON.stringify(reclaimErr)}::jsonb)`,
        })
        .where(
          and(
            eq(discussionEntries.id, fr.id),
            eq(discussionEntries.extractionStatus, "processing"),
          ),
        )
        .catch((updateErr: unknown) => {
          logger
            .child({ subagent: "aoa-dispatcher" })
            .error(
              { err: updateErr, entryId: fr.id },
              "Phase-4: failed to terminalize entry with failed linked run",
            );
        });
      publishLiveEvent({
        companyId: fr.companyId,
        type: "discussion.extraction.failed",
        payload: {
          discussionId: fr.discussionId,
          entryId: fr.id,
          error: reclaimErr,
        },
      });
    }
  }

  logger
    .child({ subagent: "aoa-dispatcher" })
    .info(
      {
        reclaimed: orphanRows.length,
        failedRunReclaimed: failedRunRows.length,
        drained: rows.length,
        wakeups: wakeupRows.length,
      },
      "aoa dispatch complete",
    );
}
