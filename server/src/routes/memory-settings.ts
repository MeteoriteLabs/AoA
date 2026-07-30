import { Router } from "express";
import type { Db } from "@armyofagents/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";
import { memorySettingsService } from "../services/memory-settings.js";

/**
 * Settings → Memory governance routes (enterprise memory model, P1-T10).
 *
 * Reads are open to any company member; writes (upsert + override delete) are
 * founder/team_lead gated via `assertRole`. `memory_settings.autonomyLevel` is the
 * AutonomyLevel text enum — a distinct dial from `internal_agent_config.crew_autonomy_level`.
 */
const upsertSchema = z.object({
  departmentId: z.string().uuid().nullable().default(null),
  autonomyLevel: z.enum(["manual", "supervised", "trusted", "policy"]).optional(),
  activeContextTier: z.enum(["ephemeral", "durable", "protected"]).optional(),
});

export function memorySettingsRoutes(db: Db) {
  const router = Router();
  const svc = memorySettingsService(db);

  router.get("/companies/:companyId/memory-settings", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.list(companyId));
  });

  router.put(
    "/companies/:companyId/memory-settings",
    validate(upsertSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");
      const { departmentId, ...patch } = req.body as z.infer<typeof upsertSchema>;
      res.json(await svc.upsert(companyId, departmentId, patch));
    },
  );

  router.delete(
    "/companies/:companyId/memory-settings/departments/:departmentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const departmentId = req.params.departmentId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");
      await svc.deleteOverride(companyId, departmentId);
      res.status(204).end();
    },
  );

  return router;
}
