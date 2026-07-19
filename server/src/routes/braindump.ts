// server/src/routes/braindump.ts — WS6 braindump ingestion API.
import { Router } from "express";
import type { Db } from "@armyofagents/db";
import { submitBraindumpSchema } from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { braindumpService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { notFound } from "../errors.js";

export function braindumpRoutes(db: Db) {
  const router = Router();
  const svc = braindumpService(db);

  // Submit (or idempotently resubmit) a braindump for a department. The
  // Librarian dispatch is attempted synchronously within this request
  // (best-effort — a dispatch failure still returns 201 with status="failed"
  // and an actionable failureReason; the client is never left guessing).
  router.post(
    "/companies/:companyId/braindumps",
    validate(submitBraindumpSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const row = await svc.submit(companyId, req.body, actor.actorId ?? null);

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "braindump.submitted",
        entityType: "braindump_capture",
        entityId: row.id,
        details: { departmentId: row.departmentId, status: row.status },
      });

      res.status(201).json(row);
    },
  );

  router.get("/companies/:companyId/braindumps", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const departmentId = req.query.departmentId as string | undefined;
    if (!departmentId) {
      res.status(400).json({ error: "departmentId query param is required" });
      return;
    }
    const rows = await svc.listByDepartment(companyId, departmentId);
    res.json(rows);
  });

  router.get("/companies/:companyId/braindumps/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const row = await svc.getById(companyId, req.params.id as string);
    if (!row) {
      throw notFound("Braindump capture not found");
    }
    res.json(row);
  });

  // Retry a failed (or stuck-pending) capture. Idempotent — see braindump.ts.
  router.post("/companies/:companyId/braindumps/:id/retry", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    const row = await svc.retry(companyId, req.params.id as string);

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "braindump.retried",
      entityType: "braindump_capture",
      entityId: row.id,
      details: { status: row.status },
    });

    res.json(row);
  });

  return router;
}
