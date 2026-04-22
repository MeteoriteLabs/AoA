import { Router } from "express";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity, secretService } from "../services/index.js";

const SECRET_NAME = "github_pat";
const setPatSchema = z.object({ pat: z.string().min(1) });

export function githubRoutes(db: Db) {
  const router = Router();
  const svc = secretService(db);

  /**
   * Save a GitHub PAT for this company. Verifies the PAT via Octokit before
   * storing. Any existing PAT row is deleted first so re-saves are idempotent.
   * The PAT itself is never echoed back — only `{configured, githubUser}`.
   */
  router.post("/companies/:companyId/github/pat", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = setPatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    let githubUser: string;
    try {
      const octokit = new Octokit({ auth: parsed.data.pat });
      const { data } = await octokit.users.getAuthenticated();
      githubUser = data.login;
    } catch {
      res.status(400).json({ error: "Invalid GitHub PAT" });
      return;
    }

    // Replace any existing PAT (idempotent — `delete` returns false when none).
    await svc.delete(companyId, SECRET_NAME);
    const created = await svc.create(
      companyId,
      {
        name: SECRET_NAME,
        provider: "local_encrypted",
        value: parsed.data.pat,
        description: `GitHub PAT for ${githubUser}`,
        externalRef: githubUser,
      },
      { userId: req.actor.userId ?? "board", agentId: null },
    );

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "github.pat.connected",
      entityType: "secret",
      entityId: created.id,
      details: { githubUser },
    });

    res.json({ configured: true, githubUser });
  });

  /** Remove the stored GitHub PAT. Idempotent. */
  router.delete("/companies/:companyId/github/pat", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const removed = await svc.delete(companyId, SECRET_NAME);
    if (removed) {
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "github.pat.disconnected",
        entityType: "secret",
        entityId: SECRET_NAME,
        details: {},
      });
    }
    res.json({ configured: false, removed });
  });

  /** Read whether a PAT is configured — never returns the PAT itself. */
  router.get("/companies/:companyId/github/pat/status", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const row = await svc.getByName(companyId, SECRET_NAME);
    if (!row) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      githubUser: row.externalRef ?? null,
      createdAt: row.createdAt,
    });
  });

  return router;
}
