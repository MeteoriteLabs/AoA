// server/src/routes/provider-connections.ts
import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { providerConnections } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import { assertRole } from "../middleware/rbac.js";
import { assertCompanyAccess } from "./authz.js";
import type { CliAuthTopology } from "../services/cli-auth-topology.js";
import { providerConnectionService } from "../services/provider-connections.js";

export function providerConnectionRoutes(db: Db, topology: CliAuthTopology): Router {
  const router = Router();
  const svc = providerConnectionService(db, topology);

  router.get("/companies/:companyId/provider-connections", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId); // Phase 3: async 3-arg
    await assertRole(db, req, companyId, "founder");
    const rows = await db
      .select({
        id: providerConnections.id, provider: providerConnections.provider,
        authMethod: providerConnections.authMethod, state: providerConnections.state,
        sharingPolicy: providerConnections.sharingPolicy, ownerUserId: providerConnections.ownerUserId,
        executionTargetId: providerConnections.executionTargetId, verifiedAt: providerConnections.verifiedAt,
      })
      .from(providerConnections)
      .where(eq(providerConnections.companyId, companyId));
    res.json(rows);
  });

  router.post("/companies/:companyId/provider-connections/:id/verify", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) { res.status(401).json({ error: "authentication required" }); return; }
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId); // Phase 3: async 3-arg
    await assertRole(db, req, companyId, "founder");
    await svc.verify(companyId, req.params.id as string, actor.userId);
    res.status(204).end();
  });

  router.delete("/companies/:companyId/provider-connections/:id", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) { res.status(401).json({ error: "authentication required" }); return; }
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId); // Phase 3: async 3-arg
    await assertRole(db, req, companyId, "founder");
    const result = await svc.revoke(companyId, req.params.id as string, actor.userId);
    if (!result) { res.status(404).json({ error: "Connection not found" }); return; }
    res.json(result);
  });

  return router;
}
