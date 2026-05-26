import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers, agentWakeupRequests } from "@armyofagents/db";
import { runAdjutantSweep } from "../services/internal-agent/aoa-agents/sweep-adjutant.js";
import { runMemoryKeeperSweep } from "../services/internal-agent/aoa-agents/sweep-memory-keeper.js";
import { logger } from "../middleware/logger.js";

/**
 * Dev-only HTTP endpoints that manually fire the periodic crew sweeps.
 *
 * WHY THIS EXISTS:
 * Two of the eight crew agents run on a schedule (setInterval in index.ts),
 * not in response to user actions:
 *   - Adjutant       — every 15 min (checks each thread for phase-advance readiness)
 *   - Memory Keeper  — every 4 hr  (proposes memory items from active threads)
 *
 * During UAT, waiting 15 min per ARC B test cycle or 4 hr for one Memory
 * Keeper proposal would balloon UAT to 5-6 hours. These endpoints expose
 * the same sweep functions via HTTP so UAT can fire them on demand. They
 * call exactly the same functions the setInterval ticks call — no
 * test-only behavior, just a different way to invoke the same code path.
 *
 * SAFETY GATE:
 * Mounted in app.ts ONLY when `opts.uiMode === "vite-dev"`, which itself
 * is gated on `AOA_UI_DEV_MIDDLEWARE=true`. In production deployments
 * (cloud_auth / authenticated mode), this env var is never set, so the
 * routes never mount. Defense-in-depth: even if a misconfiguration leaked
 * the routes, the worst they can do is fire a sweep early — which is
 * idempotent (sweeps debounce internally) and doesn't expose any data.
 *
 * USAGE:
 *   curl -X POST http://localhost:3102/api/internal/sweep/adjutant
 *   curl -X POST http://localhost:3102/api/internal/sweep/memory-keeper
 *
 * Returns 200 with { ok: true, sweep, durationMs } on success;
 * 500 with { ok: false, sweep, error } on failure.
 */
export function internalSweepsDevRoutes(db: Db): Router {
  const router = Router();

  router.post("/internal/sweep/adjutant", async (_req, res) => {
    const log = logger.child({ svc: "internal-sweep-dev", sweep: "adjutant" });
    log.info("manual sweep trigger received");
    const startedAt = Date.now();
    try {
      await runAdjutantSweep(db);
      const durationMs = Date.now() - startedAt;
      log.info({ durationMs }, "manual adjutant sweep completed");
      res.json({ ok: true, sweep: "adjutant", durationMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, "manual adjutant sweep failed");
      res.status(500).json({ ok: false, sweep: "adjutant", error: message });
    }
  });

  router.post("/internal/sweep/memory-keeper", async (_req, res) => {
    const log = logger.child({ svc: "internal-sweep-dev", sweep: "memory-keeper" });
    log.info("manual sweep trigger received");
    const startedAt = Date.now();
    try {
      await runMemoryKeeperSweep(db);
      const durationMs = Date.now() - startedAt;
      log.info({ durationMs }, "manual memory keeper sweep completed");
      res.json({ ok: true, sweep: "memory-keeper", durationMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, "manual memory keeper sweep failed");
      res.status(500).json({ ok: false, sweep: "memory-keeper", error: message });
    }
  });

  // GET /api/internal/triggers/:companyId — dev-only diagnostic. Returns the
  // current trigger configuration for a company's crew agents. Used by UAT
  // pre-flight to verify T1.4's outbox→sweep migration landed for Memory
  // Keeper, and to assert each crew agent has the right kind+config.
  router.get("/internal/triggers/:companyId", async (req, res) => {
    const companyId = req.params.companyId;
    try {
      const rows = await db
        .select({
          name: agents.name,
          agentId: aoaAgentTriggers.agentId,
          kind: aoaAgentTriggers.kind,
          enabled: aoaAgentTriggers.enabled,
          config: aoaAgentTriggers.config,
        })
        .from(aoaAgentTriggers)
        .innerJoin(agents, eq(agents.id, aoaAgentTriggers.agentId))
        .where(eq(aoaAgentTriggers.companyId, companyId));
      res.json({ companyId, triggers: rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/internal/wakeups/:agentId?limit=10 — dev-only diagnostic. Returns
  // the most recent wakeup rows for an agent, so UAT can assert
  // status='succeeded'/'failed'/'skipped_*' after a triggering action.
  router.get("/internal/wakeups/:agentId", async (req, res) => {
    const agentId = req.params.agentId;
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10) || 10, 100);
    try {
      const rows = await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, agentId))
        .orderBy(desc(agentWakeupRequests.createdAt))
        .limit(limit);
      res.json({ agentId, wakeups: rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
