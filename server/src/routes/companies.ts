import { Router, type Request } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { companies, type Db } from "@armyofagents/db";
import {
  companyPortabilityExportSchema,
  companyPortabilityImportSchema,
  companyPortabilityPreviewSchema,
  createCompanySchema,
  updateCompanySchema,
  type DeploymentMode,
} from "@armyofagents/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertRole } from "../middleware/rbac.js";
import { accessService, companyPortabilityService, companyService, logActivity } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { seedAoaNativeSkills } from "../services/internal-agent/aoa-skills-seeder.js";
import { ensureCommanderAgent } from "../services/internal-agent/aoa-agents/ensure-commander.js";
import { materializeCompanyProfileFromGlobal } from "../services/team.js";
import { logger } from "../middleware/logger.js";

export function companyRoutes(db: Db, opts: { deploymentMode: DeploymentMode }) {
  const router = Router();
  const svc = companyService(db);
  const portability = companyPortabilityService(db);
  const access = accessService(db);

  async function assertCanAssignTasks(req: Request, companyId: string) {
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowed = await access.canUser(companyId, req.actor.userId, "tasks:assign");
    if (!allowed) throw forbidden("Missing permission: tasks:assign");
  }

  router.get("/", async (req, res) => {
    // rbac: instance-admin-not-required — list endpoint with no companyId in path; result is scope-filtered inline against req.actor.companyIds.
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(result);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(result.filter((company) => allowed.has(company.id)));
  });

  router.get("/stats", async (req, res) => {
    // rbac: instance-admin-not-required — stats endpoint with no companyId in path; result is scope-filtered inline against req.actor.companyIds.
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      ? null
      : new Set(req.actor.companyIds ?? []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([companyId]) => allowed.has(companyId)));
    res.json(filtered);
  });

  // Common malformed path when companyId is empty in "/api/companies/{companyId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });

  router.get("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(company);
  });

  router.post("/:companyId/export", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/:companyId/export/preview", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await portability.previewExport(companyId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    } else {
      assertBoard(req);
    }
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.post("/import", validate(companyPortabilityImportSchema), async (req, res) => {
    assertBoard(req);
    const existingCompanyId =
      req.body.target.mode === "existing_company" ? req.body.target.companyId : null;
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(
      req.body,
      req.actor.type === "board" ? req.actor.userId : null,
      existingCompanyId
        ? async ({ requiresTaskAssignmentPermission, importsWorkflowTemplates }) => {
          if (requiresTaskAssignmentPermission) {
            await assertCanAssignTasks(req, existingCompanyId);
          }
          if (importsWorkflowTemplates) {
            await assertRole(db, req, existingCompanyId, "founder", "team_lead");
          }
        }
        : undefined,
    );
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.imported",
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
      },
    });
    res.json(result);
  });

  router.post("/", validate(createCompanySchema), async (req, res) => {
    // rbac: instance-admin-not-required — inline isInstanceAdmin check on the next line is the gate; assertCanManageInstanceSettings would be a synonym refactor.
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    // D6: local_trusted = single trust boundary (loopback); one-click approve is friction.
    // authenticated = real multi-human board; approval is multi-person accountability.
    const requireBoardApprovalForNewAgents = opts.deploymentMode !== "local_trusted";
    const company = await svc.create({ ...req.body, requireBoardApprovalForNewAgents });
    const operatorId = await access.ensureRealOperator(company.id, req.actor.userId);
    // Seed the founder's company Human Operating Profile from their GLOBAL
    // profile. Onboarding's HumanProfileStep writes only the global
    // `user_profiles` row (companyId is null at that step); without this, the
    // founder's freshly-entered title/bio/timezone/socialLinks show blank on
    // their own company Team page. The invited-approve and manual-add paths
    // already materialize via the same helper — founder-create was the gap.
    // Best-effort — never block company creation. (Codex P2)
    await materializeCompanyProfileFromGlobal(db, company.id, operatorId, operatorId).catch((err) => {
      logger.warn(
        { err, companyId: company.id, userId: operatorId },
        "company create: founder profile seeding failed (non-fatal)",
      );
    });
    await seedAoaNativeSkills(db, company.id).catch(() => {
      // Never block company creation on skill seeding failure
    });
    // QA-BUG-007 fix: re-run Commander provisioning AFTER native skills are
    // seeded so the Commander's skillKeys backfills from the now-populated
    // company_skills table. The first ensureCommanderAgent call inside
    // svc.create() runs BEFORE seedAoaNativeSkills, so installed.length is
    // 0 and the gate in ensure-commander.ts:170-200 skips writing. This
    // second call (combined with the relaxed gate in ensure-commander.ts
    // that allows re-run when skillKeys is empty AND installed > 0)
    // populates skillKeys with all seeded native skills. The function is
    // idempotent — second call only updates skillKeys and is otherwise
    // no-op against the agent row.
    await ensureCommanderAgent(db, company.id).catch(() => {
      // Never block company creation on Commander skill-init re-run failure
    });
    await logActivity(db, {
      companyId: company.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      details: { name: company.name },
    });
    res.status(201).json(company);
  });

  router.patch("/:companyId", validate(updateCompanySchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (
      "agentCompletionPolicyDefault" in req.body ||
      "agentCompletionReviewGuardrail" in req.body
    ) {
      await assertCanAssignTasks(req, companyId);
    }
    const company = await svc.update(companyId, req.body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(company);
  });

  // Founder-only toggle for the team-architecture feature flag (Slices 6 + 7).
  // Default is false; flipping to true opts the company into the teams system.
  //
  // P1: `assertBoard(req)` runs BEFORE `assertRole` because `assertRole` only
  // checks role assignments — it does not bypass agent actors. Without the
  // board guard an agent with API key + a founder role assignment could flip
  // this company-wide flag, but this toggle is documented as founder-only
  // (a founder is a human-board user). Board access is the trust boundary.
  router.patch(
    "/:companyId/enable-teams",
    validate(z.object({ enabled: z.boolean() })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");
      await db
        .update(companies)
        .set({ enableTeams: req.body.enabled, updatedAt: new Date() })
        .where(eq(companies.id, companyId));
      await logActivity(db, {
        ...getActorInfo(req),
        companyId,
        action: "company.teams_feature_toggled",
        entityType: "company",
        entityId: companyId,
        details: { enabled: req.body.enabled },
      });
      res.json({ ok: true });
    },
  );

  router.post("/:companyId/archive", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.archive(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.archived",
      entityType: "company",
      entityId: companyId,
    });
    res.json(company);
  });

  router.delete("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.remove(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
