import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  deleteArtifact: vi.fn(),
  getEffectiveRole: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mocks.logActivity,
}));

vi.mock("../services/permissions.js", () => ({
  permissionService: () => ({ getEffectiveRole: mocks.getEffectiveRole }),
}));

vi.mock("../services/index.js", () => ({
  artifactService: () => ({
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    addVersion: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    deleteArtifact: mocks.deleteArtifact,
    getIssueCompanyId: vi.fn(),
    getByIssueId: vi.fn(),
  }),
  permissionService: () => ({ getEffectiveRole: mocks.getEffectiveRole }),
  logActivity: mocks.logActivity,
}));

import { errorHandler } from "../middleware/error-handler.js";
import { artifactRoutes } from "../routes/artifacts.js";
import { artifactService } from "../services/artifacts.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const artifactId = "22222222-2222-4222-8222-222222222222";

function makeApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { actor: Record<string, unknown> }).actor = actor;
    next();
  });
  app.use("/api", artifactRoutes({} as never));
  app.use(errorHandler);
  return app;
}

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(resolve(here, "../routes/artifacts.ts"), "utf8");

describe("artifact archive route authz contract", () => {
  it("requires a board actor before founder RBAC for archive and unarchive routes", () => {
    expect(routeSource).toContain('import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js"');
    expect(routeSource).toMatch(/\/artifacts\/:id\/archive[\s\S]*await assertCompanyAccess\(db, req, existing\.companyId\);\s*assertBoard\(req\);\s*await assertRole\(db, req, existing\.companyId, "founder"\);/);
    expect(routeSource).toMatch(/\/artifacts\/:id\/unarchive[\s\S]*await assertCompanyAccess\(db, req, existing\.companyId\);\s*assertBoard\(req\);\s*await assertRole\(db, req, existing\.companyId, "founder"\);/);
  });

  it("requires assertBoard and founder RBAC for DELETE /companies/:companyId/artifacts/:id route", () => {
    expect(routeSource).toMatch(/\/companies\/:companyId\/artifacts\/:id[\s\S]*await assertCompanyAccess\(db, req, companyId\);\s*assertBoard\(req\);\s*await assertRole\(db, req, companyId, "founder"\);/);
  });
});

describe("DELETE /api/companies/:companyId/artifacts/:id authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds for founders and calls deleteArtifact service method", async () => {
    mocks.getEffectiveRole.mockResolvedValue("founder");
    const mockDeletedArtifact = { id: artifactId, companyId, title: "Test Artifact" };
    mocks.deleteArtifact.mockResolvedValue(mockDeletedArtifact);

    const res = await request(
      makeApp({
        type: "board",
        source: "session",
        userId: "founder-user-1",
        companyIds: [companyId],
        isInstanceAdmin: false,
      }),
    ).delete(`/api/companies/${companyId}/artifacts/${artifactId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockDeletedArtifact);
    expect(mocks.getEffectiveRole).toHaveBeenCalledWith(companyId, "founder-user-1");
    expect(mocks.deleteArtifact).toHaveBeenCalledWith(companyId, artifactId, {
      actorType: "user",
      actorId: "founder-user-1",
      agentId: null,
      runId: null,
    });
  });

  it("fails with 403 for non-founders (e.g. team_member)", async () => {
    mocks.getEffectiveRole.mockResolvedValue("team_member");

    const res = await request(
      makeApp({
        type: "board",
        source: "session",
        userId: "member-user-1",
        companyIds: [companyId],
        isInstanceAdmin: false,
      }),
    ).delete(`/api/companies/${companyId}/artifacts/${artifactId}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Requires one of: founder");
    expect(mocks.deleteArtifact).not.toHaveBeenCalled();
  });

  it("fails with 403 for non-board actors (e.g. agent actor)", async () => {
    const res = await request(
      makeApp({
        type: "agent",
        source: "agent_key",
        agentId: "agent-1",
        companyId,
      }),
    ).delete(`/api/companies/${companyId}/artifacts/${artifactId}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Board access required");
    expect(mocks.deleteArtifact).not.toHaveBeenCalled();
  });

  it("returns 404 when artifact is not found", async () => {
    mocks.getEffectiveRole.mockResolvedValue("founder");
    mocks.deleteArtifact.mockResolvedValue(null);

    const res = await request(
      makeApp({
        type: "board",
        source: "session",
        userId: "founder-user-1",
        companyIds: [companyId],
        isInstanceAdmin: false,
      }),
    ).delete(`/api/companies/${companyId}/artifacts/${artifactId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Artifact not found");
  });
});

describe("deleteArtifact service method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs delete_artifact activity and permanently removes artifact when record exists", async () => {
    const existingArtifact = { id: artifactId, companyId, title: "Report Doc" };

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingArtifact]),
        }),
      }),
      transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
        return callback(tx);
      }),
    };

    const svc = artifactService(mockDb as never);
    const actor = { actorType: "user" as const, actorId: "founder-1", agentId: null, runId: null };

    const result = await svc.deleteArtifact(companyId, artifactId, actor);

    expect(result).toEqual(existingArtifact);
    expect(mocks.logActivity).toHaveBeenCalledWith(mockDb, {
      companyId,
      actorType: "user",
      actorId: "founder-1",
      agentId: null,
      runId: null,
      action: "delete_artifact",
      entityType: "artifact",
      entityId: artifactId,
      details: { title: "Report Doc" },
    });
  });

  it("returns null without logging activity if artifact does not exist", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const svc = artifactService(mockDb as never);
    const actor = { actorType: "user" as const, actorId: "founder-1", agentId: null, runId: null };

    const result = await svc.deleteArtifact(companyId, artifactId, actor);

    expect(result).toBeNull();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });
});
