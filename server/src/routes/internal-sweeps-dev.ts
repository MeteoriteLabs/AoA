import { Router } from "express";
import type { Db } from "@armyofagents/db";
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

  return router;
}
