import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import {
  createEnvironmentSchema,
  updateEnvironmentSchema,
} from "@armyofagents/shared";
import { environmentService, type EnvironmentService } from "../services/environments.js";
import { secretService } from "../services/secrets.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

interface RoutesOptions {
  // Test seam: callers can inject a pre-built service. Production uses `db`.
  db?: Db;
  svc?: EnvironmentService;
}

export function environmentRoutes(opts: RoutesOptions) {
  const router = Router();
  const svc = opts.svc ?? environmentService(opts.db!);
  const secretsSvc = opts.db ? secretService(opts.db) : null;

  // GET list
  router.get(
    "/companies/:companyId/environments",
    async (req: Request, res: Response, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertBoard(req);
        assertCompanyAccess(req, companyId);
        const list = await svc.list(companyId);
        res.json(list);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET detail
  router.get(
    "/companies/:companyId/environments/:id",
    async (req: Request, res: Response, next) => {
      try {
        const companyId = req.params.companyId as string;
        const id = req.params.id as string;
        assertBoard(req);
        assertCompanyAccess(req, companyId);
        const env = await svc.get(companyId, id);
        if (!env) {
          res.status(404).json({ error: "Environment not found" });
          return;
        }
        res.json(env);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST create
  router.post(
    "/companies/:companyId/environments",
    async (req: Request, res: Response, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertBoard(req);
        assertCompanyAccess(req, companyId);
        const parsed = createEnvironmentSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        const normalizedEnvVars = secretsSvc
          ? await secretsSvc.normalizeEnvConfigForPersistence(companyId, parsed.data.envVars, { strictMode: true })
          : parsed.data.envVars;
        const input = { ...parsed.data, envVars: normalizedEnvVars };
        const created = await svc.create(companyId, input);
        if (secretsSvc) {
          await secretsSvc.syncEnvBindingsForTarget(companyId, {
            targetType: "environment",
            targetId: created!.id,
            pathPrefix: "env",
          }, normalizedEnvVars ?? {});
        }
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH update
  router.patch(
    "/companies/:companyId/environments/:id",
    async (req: Request, res: Response, next) => {
      try {
        const companyId = req.params.companyId as string;
        const id = req.params.id as string;
        assertBoard(req);
        assertCompanyAccess(req, companyId);
        const parsed = updateEnvironmentSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        const normalizedEnvVars = secretsSvc && parsed.data.envVars !== undefined
          ? await secretsSvc.normalizeEnvConfigForPersistence(companyId, parsed.data.envVars, { strictMode: true })
          : parsed.data.envVars;
        const input = parsed.data.envVars === undefined
          ? parsed.data
          : { ...parsed.data, envVars: normalizedEnvVars };
        const updated = await svc.update(companyId, id, input);
        if (!updated) {
          res.status(404).json({ error: "Environment not found" });
          return;
        }
        if (secretsSvc && parsed.data.envVars !== undefined) {
          await secretsSvc.syncEnvBindingsForTarget(companyId, {
            targetType: "environment",
            targetId: updated.id,
            pathPrefix: "env",
          }, normalizedEnvVars ?? {});
        }
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE
  router.delete(
    "/companies/:companyId/environments/:id",
    async (req: Request, res: Response, next) => {
      try {
        const companyId = req.params.companyId as string;
        const id = req.params.id as string;
        assertBoard(req);
        assertCompanyAccess(req, companyId);
        const deleted = await svc.delete(companyId, id);
        if (!deleted) {
          res.status(404).json({ error: "Environment not found" });
          return;
        }
        if (secretsSvc) {
          await secretsSvc.syncEnvBindingsForTarget(companyId, {
            targetType: "environment",
            targetId: id,
            pathPrefix: "env",
          }, {});
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
