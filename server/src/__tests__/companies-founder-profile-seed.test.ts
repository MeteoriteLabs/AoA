import express from "express";
import request from "supertest";
import { describe, beforeEach, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";

// Codex P2: founder company-create must materialize the founder's company
// Human Operating Profile from their global profile (onboarding's
// HumanProfileStep only writes the global user_profiles row). This test locks
// the wiring: the shared helper is called with the operator id after
// ensureRealOperator, and a failure never blocks company creation.

const mockCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "co-test",
    name: "TestCo",
    requireBoardApprovalForNewAgents: false,
  }),
);
const ensureRealOperatorMock = vi.hoisted(() => vi.fn().mockResolvedValue("operator-user-id"));
const materializeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/index.js", () => ({
  companyService: () => ({
    list: vi.fn(),
    stats: vi.fn(),
    getById: vi.fn(),
    create: mockCreate,
    update: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  }),
  companyPortabilityService: () => ({
    exportBundle: vi.fn(),
    previewExport: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  accessService: () => ({
    canUser: vi.fn(),
    ensureMembership: vi.fn().mockResolvedValue(undefined),
    ensureRealOperator: ensureRealOperatorMock,
  }),
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/team.js", () => ({
  materializeCompanyProfileFromGlobal: materializeMock,
}));

vi.mock("../services/internal-agent/aoa-skills-seeder.js", () => ({
  seedAoaNativeSkills: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({
  ensureCommanderAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const db = { __sentinel: true } as unknown;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: false,
      userId: null,
      companyIds: [],
    };
    next();
  });
  app.use("/api/companies", companyRoutes(db as any, { deploymentMode: "local_trusted" }));
  return app;
}

describe("POST /api/companies — founder company profile seeding", () => {
  beforeEach(() => {
    mockCreate.mockClear();
    ensureRealOperatorMock.mockClear();
    materializeMock.mockReset();
    materializeMock.mockResolvedValue(undefined);
  });

  it("materializes the founder's company profile from their global profile using the operator id", async () => {
    const res = await request(makeApp()).post("/api/companies").send({ name: "TestCo" });

    expect(res.status).toBe(201);
    expect(ensureRealOperatorMock).toHaveBeenCalledOnce();
    // Called with the db handle, the new company id, and the operator id for
    // BOTH the target user and the attribution (the operator seeds their own
    // profile).
    expect(materializeMock).toHaveBeenCalledWith(db, "co-test", "operator-user-id", "operator-user-id");
  });

  it("never fails company creation when profile materialization throws (best-effort)", async () => {
    materializeMock.mockRejectedValue(new Error("boom"));

    const res = await request(makeApp()).post("/api/companies").send({ name: "TestCo" });

    expect(res.status).toBe(201);
    expect(materializeMock).toHaveBeenCalledOnce();
  });
});
