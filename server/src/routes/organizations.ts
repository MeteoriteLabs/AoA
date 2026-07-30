import { Router } from "express";
import { z } from "zod";
import type { Db } from "@armyofagents/db";
import { validate } from "../middleware/validate.js";
import { assertBoard } from "./authz.js";
import { forbidden } from "../errors.js";
import { organizationAccessService } from "../services/organization-access.js";
import { createSelfServeOrganization } from "../services/organizations.js";

const createOrgSchema = z.object({ name: z.string().min(1) });

export function organizationRoutes(db: Db): Router {
  const router = Router();
  const orgAccess = organizationAccessService(db);

  // Self-serve org creation: any signed-in board user may create an org and
  // becomes its owner. NO instance_admin gate — this is the multi-tenant thesis.
  // rbac: instance-admin-not-required — org-level endpoint with no companyId in path; there is no existing company/org scope to check against (the org is being CREATED by this call), so "authenticated board user" is the entire authorization surface by design.
  router.post("/", validate(createOrgSchema), async (req, res) => {
    assertBoard(req);
    if (!req.actor.userId) throw forbidden("Sign in to create an organization");
    const org = await createSelfServeOrganization(db, { name: req.body.name, ownerUserId: req.actor.userId }, orgAccess);
    res.status(201).json(org);
  });

  // Caller's own org memberships (for the Lobby org switcher).
  // rbac: instance-admin-not-required — no companyId in path; result is scope-filtered inline against req.actor.userId (listOrgMemberships), mirroring companies.ts:67's list-endpoint idiom.
  router.get("/", async (req, res) => {
    assertBoard(req);
    if (!req.actor.userId) {
      res.json([]);
      return;
    }
    res.json(await orgAccess.listOrgMemberships(req.actor.userId));
  });

  return router;
}
