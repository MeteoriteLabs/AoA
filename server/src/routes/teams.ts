import { Router } from "express";
import type { Db } from "@armyofagents/db";
import {
  createTeamSchema,
  updateTeamSchema,
  addTeamsMemberSchema,
  updateTeamsMemberRoleSchema,
  upsertCoordinationSchema,
} from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import {
  teamsService,
  teamCoordinationService,
  teamScaffolderService,
  logActivity,
} from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ route: "teams" });

/**
 * HTTP routes for the new departmental Teams domain (Slice 1 / Task 1.10).
 *
 * Naming note: this factory is exported as `teamsRoutes` (plural) to
 * disambiguate from the pre-existing `teamRoutes` (singular) factory at
 * `server/src/routes/team.ts`, which serves the user/board permissions
 * domain. Both files coexist; they cover different domains. The plural
 * naming convention is also applied to the Zod schemas
 * (`addTeamsMemberSchema`, `updateTeamsMemberRoleSchema`).
 *
 * The service-layer `getById` (Task 1.8) throws `notFound` itself when a
 * team does not exist, so route handlers below trust that throw and do
 * NOT add a redundant `if (!team) throw notFound(...)` check. The thrown
 * `HttpError` is converted to a JSON response by the global error
 * middleware.
 */
export function teamsRoutes(db: Db) {
  const router = Router();
  const svc = teamsService(db);
  const coordSvc = teamCoordinationService(db);

  // GET /companies/:companyId/teams
  router.get("/companies/:companyId/teams", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const projectId = req.query.projectId as string | undefined;
    const result = await svc.list(companyId, projectId);
    res.json({ items: result });
  });

  // POST /companies/:companyId/teams
  router.post(
    "/companies/:companyId/teams",
    validate(createTeamSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");
      const result = await svc.create(companyId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "team.created",
        entityType: "team",
        entityId: result.id,
        details: {
          name: result.name,
          parentProjectId: result.parentProjectId,
        },
      });
      res.status(201).json(result);
    },
  );

  // GET /teams/:id
  router.get("/teams/:id", async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    assertCompanyAccess(req, team.companyId);
    res.json(team);
  });

  // PATCH /teams/:id
  router.patch(
    "/teams/:id",
    validate(updateTeamSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      assertCompanyAccess(req, existing.companyId);
      await assertRole(db, req, existing.companyId, "founder", "team_lead");
      const result = await svc.update(id, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "team.updated",
        entityType: "team",
        entityId: id,
        details: req.body,
      });
      res.json(result);
    },
  );

  // DELETE /teams/:id (archives — soft delete)
  router.delete("/teams/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    assertCompanyAccess(req, existing.companyId);
    await assertRole(db, req, existing.companyId, "founder", "team_lead");
    await svc.archive(id);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "team.archived",
      entityType: "team",
      entityId: id,
    });
    res.status(204).end();
  });

  // GET /teams/:id/members
  router.get("/teams/:id/members", async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    assertCompanyAccess(req, team.companyId);
    const result = await svc.listMembers(id);
    res.json({ items: result });
  });

  // POST /teams/:id/members
  router.post(
    "/teams/:id/members",
    validate(addTeamsMemberSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const team = await svc.getById(id);
      assertCompanyAccess(req, team.companyId);
      await assertRole(db, req, team.companyId, "founder", "team_lead");
      const result = await svc.addMember(id, req.body.agentId, req.body.role);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: team.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "team.member_added",
        entityType: "team",
        entityId: id,
        details: { agentId: req.body.agentId, role: req.body.role },
      });
      res.status(201).json(result);
    },
  );

  // DELETE /teams/:id/members/:agentId
  router.delete("/teams/:id/members/:agentId", async (req, res) => {
    const id = req.params.id as string;
    const agentId = req.params.agentId as string;
    const team = await svc.getById(id);
    assertCompanyAccess(req, team.companyId);
    await assertRole(db, req, team.companyId, "founder", "team_lead");
    await svc.removeMember(id, agentId);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: team.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "team.member_removed",
      entityType: "team",
      entityId: id,
      details: { agentId },
    });
    res.status(204).end();
  });

  // PATCH /teams/:id/members/:agentId  (change role)
  router.patch(
    "/teams/:id/members/:agentId",
    validate(updateTeamsMemberRoleSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const agentId = req.params.agentId as string;
      const team = await svc.getById(id);
      assertCompanyAccess(req, team.companyId);
      await assertRole(db, req, team.companyId, "founder", "team_lead");
      const result = await svc.updateMemberRole(id, agentId, req.body.role);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: team.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "team.member_role_changed",
        entityType: "team",
        entityId: id,
        details: { agentId, role: req.body.role },
      });
      res.json(result);
    },
  );

  // GET /teams/:id/coordination
  router.get("/teams/:id/coordination", async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    assertCompanyAccess(req, team.companyId);
    const result = await coordSvc.getByTeam(id);
    res.json(result);
  });

  // PUT /teams/:id/coordination
  router.put(
    "/teams/:id/coordination",
    validate(upsertCoordinationSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const team = await svc.getById(id);
      assertCompanyAccess(req, team.companyId);
      await assertRole(db, req, team.companyId, "founder", "team_lead");
      const result = await coordSvc.upsert(team.companyId, {
        teamId: id,
        ...req.body,
      });
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: team.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "team.coordination_updated",
        entityType: "team",
        entityId: id,
      });
      res.json(result);
    },
  );

  // POST /teams/:id/coordination/regenerate
  //
  // If no coordination row exists yet for the team, scaffold the full
  // initial markdown via `teamScaffolderService.scaffoldInitial` and
  // create the row via `coordSvc.upsert`.
  // If a coordination row already exists, regenerate just the auto:*
  // section contents and apply via `coordSvc.regenerateAutoSections`.
  router.post("/teams/:id/coordination/regenerate", async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    assertCompanyAccess(req, team.companyId);
    await assertRole(db, req, team.companyId, "founder", "team_lead");

    const scaffolder = teamScaffolderService(db);
    const existing = await coordSvc.getByTeam(id);
    const actor = getActorInfo(req);

    if (!existing) {
      const initial = await scaffolder.scaffoldInitial(id);
      const created = await coordSvc.upsert(team.companyId, {
        teamId: id,
        name: `${team.name} Coordination`,
        markdown: initial,
      });
      await logActivity(db, {
        companyId: team.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "team.coordination_scaffolded",
        entityType: "team",
        entityId: id,
      });
      res.json(created);
      return;
    }

    const sections = await scaffolder.regenerateAutoContent(id);
    const updated = await coordSvc.regenerateAutoSections(existing.id, sections);
    await logActivity(db, {
      companyId: team.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "team.coordination_regenerated",
      entityType: "team",
      entityId: id,
    });
    res.json(updated);
  });

  return router;
}
