/**
 * Extraction routes — company-scoped endpoints for the keyless extraction feature.
 *
 * Currently exposes:
 *   GET /companies/:companyId/extraction/engine-status
 *
 * Returns the active extraction engine (cli / api / none) plus the raw CLI probe
 * result and a boolean indicating whether at least one hosted provider API key is
 * configured. Never throws — unknown/missing CLI or provider is reported in the
 * response body as `engine: "none"`.
 */

import { Router } from "express";
import type { Db } from "@armyofagents/db";
import type { ExtractionEngineStatusResponse } from "@armyofagents/shared";
import { assertCompanyAccess } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";
import { resolveCompanyCliTool, probeExtractionCli } from "../services/extraction-engine.js";
import { resolveAvailableProvider } from "../services/internal-agent/providers/index.js";

export function extractionRoutes(db: Db) {
  const router = Router();

  /**
   * GET /companies/:companyId/extraction/engine-status
   *
   * Reports which extraction engine is active for this company:
   *   "cli"  — a local CLI binary is on PATH (keyless).
   *   "api"  — no CLI but a hosted provider API key is configured.
   *   "none" — neither; extraction will fail until one is set up.
   *
   * Auth: requires founder or team_lead role (same as other company-scoped
   * settings endpoints that read configuration).
   */
  router.get(
    "/companies/:companyId/extraction/engine-status",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      // Step 1: resolve the CLI tool configured for this company and probe it.
      const tool = await resolveCompanyCliTool(db, companyId);
      const cli = await probeExtractionCli(tool);

      // Step 2: check whether at least one hosted provider key is reachable.
      // resolveAvailableProvider throws when no key exists anywhere — catch that.
      let apiKey = false;
      try {
        await resolveAvailableProvider(db, companyId);
        apiKey = true;
      } catch {
        // No key configured — apiKey stays false.
      }

      // Step 3: derive the active engine (same priority order as
      // resolveExtractionEngine, but without throwing — "none" is valid here).
      const engine: ExtractionEngineStatusResponse["engine"] = cli.available
        ? "cli"
        : apiKey
          ? "api"
          : "none";

      const body: ExtractionEngineStatusResponse = {
        engine,
        cli: { available: cli.available, tool: cli.tool },
        apiKey,
      };

      res.json(body);
    },
  );

  return router;
}
