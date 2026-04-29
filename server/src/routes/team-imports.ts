import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Db } from "@armyofagents/db";
import { teamImportService, logActivity } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertRole, assertDepartmentAccess } from "../middleware/rbac.js";
import { badRequest } from "../errors.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ route: "team-imports" });

/**
 * HTTP routes for team import (Slice 8 / Task 8.3).
 *
 * Mounted under the same global API prefix as the rest of the company-scoped
 * routes; final paths are:
 *
 *   POST /companies/:companyId/teams/_imports/preview
 *   POST /companies/:companyId/teams/_imports/install
 *
 * The `_imports` segment is intentional: it can never collide with a real
 * team UUID, so there's no path-ambiguity with `/teams/:tid` routes
 * elsewhere in `routes/teams.ts`.
 *
 * Conventions followed (canonical pattern from `routes/teams.ts`):
 *  - Factory exports `teamImportsRoutes(db)` returning an Express Router.
 *  - No try/catch in handlers — `HttpError` propagates to the global
 *    error middleware.
 *  - Auth: `assertCompanyAccess(req, companyId)` for tenant scope plus
 *    `assertRole(db, req, companyId, "team_lead")` for company-level write
 *    permission, plus `assertDepartmentAccess(db, req, companyId,
 *    parentProjectId)` so a team_lead can only import into their own
 *    department. Founder + local_trusted + instance_admin short-circuit
 *    inside both helpers (`rbac.ts`). Gated identically to
 *    `POST /companies/:companyId/teams`.
 *  - JSON body validation via the `validate(zodSchema)` middleware.
 *  - Activity logging on install via `logActivity` (Convention C-7).
 */
export function teamImportsRoutes(db: Db) {
  const router = Router();
  const importSvc = teamImportService(db);

  // Multer for the preview endpoint. 5 MB cap is generous for a YAML
  // manifest (typical is well under 50 KB) but small enough to reject
  // accidental uploads of unrelated bundles. Memory storage avoids any
  // disk-write side effect — we only need the bytes for parsing.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  const importInstallSchema = z.object({
    yamlContent: z.string().min(1),
    collisions: z.record(z.enum(["rename", "replace", "skip"])),
    parentProjectId: z.string().uuid(),
    renames: z.record(z.string()).optional(),
  });

  // POST /companies/:companyId/teams/_imports/preview
  //
  // Accepts EITHER a `multipart/form-data` upload with field `file`
  // containing the manifest YAML, OR a JSON body `{ yamlContent: string }`
  // for direct paste from the UI. The forgiving multer middleware below
  // does not 4xx when there is no file — that case falls through to the
  // JSON-body branch.
  router.post(
    "/companies/:companyId/teams/_imports/preview",
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          return next(badRequest(`upload error: ${err.message}`));
        }
        if (err) return next(err);
        next();
      });
    },
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "team_lead");

      // Task 4 (P1-A): preview is read-only but still discloses
      // existing-agent name collisions across the company. Gate by the
      // intended target department so a team_lead in dept A can't probe
      // dept B's agent roster by uploading any manifest. The manifest
      // itself does not carry a target dept — the founder/lead picks
      // it. We accept it via `parentProjectId` (multipart form field or
      // JSON field). The install route already requires it.
      const body = (req.body ?? {}) as {
        yamlContent?: unknown;
        parentProjectId?: unknown;
      };
      const parentProjectId =
        typeof body.parentProjectId === "string" ? body.parentProjectId : null;
      if (!parentProjectId) {
        throw badRequest("missing 'parentProjectId' field");
      }
      await assertDepartmentAccess(db, req, companyId, parentProjectId);

      const fileBuf = req.file?.buffer;
      const bodyYaml = body.yamlContent;
      const yaml = fileBuf
        ? fileBuf.toString("utf8")
        : typeof bodyYaml === "string"
          ? bodyYaml
          : null;

      if (!yaml) {
        throw badRequest(
          "missing 'file' upload or 'yamlContent' body field",
        );
      }

      const result = await importSvc.preview(companyId, yaml);
      res.json(result);
    },
  );

  // POST /companies/:companyId/teams/_imports/install
  //
  // JSON-only. Body shape: { yamlContent, collisions, parentProjectId,
  // renames? }. The service runs `preview` internally first to surface
  // missing-skill / >1-lead / slug-collision errors with clean messages
  // before entering the transactional cascade.
  router.post(
    "/companies/:companyId/teams/_imports/install",
    validate(importInstallSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "team_lead");
      await assertDepartmentAccess(db, req, companyId, req.body.parentProjectId);

      const team = await importSvc.install(companyId, req.body.yamlContent, {
        collisions: req.body.collisions,
        parentProjectId: req.body.parentProjectId,
        renames: req.body.renames,
      });

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "team.imported",
        entityType: "team",
        entityId: team.id,
        details: {
          slug: team.slug,
          name: team.name,
          parentProjectId: team.parentProjectId,
        },
      });

      log.info(
        { companyId, teamId: team.id, slug: team.slug },
        "imported team",
      );

      res.status(201).json(team);
    },
  );

  return router;
}
