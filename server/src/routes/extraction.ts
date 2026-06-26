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
import {
  resolveCompanyCliTool,
  probeExtractionCli,
  EXTRACTION_SUPPORTED_CLI_TOOLS,
} from "../services/extraction-engine.js";
import { hasProviderKey } from "../services/internal-agent/providers/index.js";

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
      // Only probe tools that extraction can actually drive — otherwise the
      // status would report "Local CLI ready" for e.g. an opencode-configured
      // company even though resolveExtractionEngine() treats it as unavailable
      // and falls through to API/none (P3, Codex). Keep this gate in lockstep
      // with resolveExtractionEngine.
      const tool = await resolveCompanyCliTool(db, companyId);
      const cli = EXTRACTION_SUPPORTED_CLI_TOOLS.has(tool)
        ? await probeExtractionCli(tool)
        : { available: false, tool };

      // Step 2: check whether at least one hosted provider key EXISTS. This is a
      // passive status probe (the Settings panel polls it), so use the
      // non-resolving existence check — resolving the value would write a
      // secretAccessEvents audit row + bump lastResolvedAt on every view (P2,
      // Codex). hasProviderKey checks active secret rows + env, no decrypt.
      const apiKey = (
        await Promise.all([
          hasProviderKey(db, companyId, "anthropic"),
          hasProviderKey(db, companyId, "openai"),
          hasProviderKey(db, companyId, "google"),
        ])
      ).some(Boolean);

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
