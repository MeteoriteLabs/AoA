/**
 * Memory route — approval-decision status gate (Codex #201 P1 / R5).
 *
 * PR #199 made `canApproveMemory` founder-only for `domain` (leads → active_context
 * only). But the create/update routes accept a client-supplied `status` and gate only
 * on `canAccessMemory` (which lets a lead write `domain` in their dept), so a lead
 * could POST a `domain` item already "approved" or PATCH a pending one to approved —
 * bypassing the founder gate. The fix routes any `approved`/`rejected` status through
 * `assertMemoryApproval`.
 *
 * These tests assert the WIRING (the gate fires with the right layer/dept iff the
 * requested status is an approval decision, and a rejection becomes a 403). The
 * approval DECISION itself (lead cannot approve domain) is unit-tested in
 * permissions.test.ts; here `assertMemoryApproval` is a controllable spy.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTableProxy } from "./helpers/drizzle-mock.js";

// @armyofagents/db / drizzle are not exercised at runtime (services + middleware are
// mocked below), but the middleware barrel's import graph can touch them — a catch-all
// proxy keeps any transitive load from resolving to undefined.
vi.mock("@armyofagents/db", () => ({
  __esModule: true,
  default: {},
  ...new Proxy(
    {},
    {
      get: (_t, prop: string) => (typeof prop === "string" ? makeTableProxy(prop) : undefined),
    },
  ),
}));

const mockMemoryService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));
const mockAssertMemoryApproval = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/index.js", () => ({
  memoryService: () => mockMemoryService,
  companyBrainGraphService: () => ({}),
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middleware/rbac.js", () => ({
  assertMemoryAccess: vi.fn().mockResolvedValue(undefined),
  assertMemoryApproval: mockAssertMemoryApproval,
}));

// Passthrough validate — the gate reads req.body directly; schema coverage lives
// elsewhere. Avoids constructing fully schema-valid enum bodies here.
vi.mock("../middleware/validate.js", () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("./authz.js", () => ({
  assertCompanyAccess: vi.fn(),
  getActorInfo: vi.fn(() => ({ actorType: "board", actorId: "u-lead", agentId: null, runId: null })),
}));

import { memoryRoutes } from "../routes/memory.js";
import { errorHandler } from "../middleware/index.js";
import { forbidden } from "../errors.js";

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "11111111-1111-4111-8111-111111111111";

const boardActor = {
  type: "board" as const,
  source: "session" as const,
  userId: "u-lead",
  companyIds: [COMPANY_ID],
  isInstanceAdmin: false,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = boardActor;
    next();
  });
  app.use("/api", memoryRoutes({} as never));
  app.use(errorHandler);
  return app;
}

const basePost = {
  title: "t",
  content: "c",
  category: "coding",
  source: "founder",
  layer: "domain",
  departmentId: "dep-a",
};

describe("memory routes — approval-decision status gate (Codex #201 P1 / R5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertMemoryApproval.mockResolvedValue(undefined);
    mockMemoryService.create.mockResolvedValue({
      id: ITEM_ID,
      title: "t",
      category: "coding",
      source: "founder",
      status: "approved",
    });
    mockMemoryService.getById.mockResolvedValue({
      id: ITEM_ID,
      layer: "domain",
      departmentId: "dep-a",
      visibility: "scoped",
    });
    mockMemoryService.update.mockResolvedValue({ id: ITEM_ID, title: "t" });
  });

  // ── POST /memory ──────────────────────────────────────────────────────────
  it("POST status=approved → approval gate fires with the requested layer/dept", async () => {
    await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/memory`)
      .send({ ...basePost, status: "approved" })
      .expect(201);
    expect(mockAssertMemoryApproval).toHaveBeenCalledTimes(1);
    expect(mockAssertMemoryApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      COMPANY_ID,
      { layer: "domain", departmentId: "dep-a" },
    );
  });

  it("POST status=approved → 403 when the actor cannot approve that layer (gate throws); create not called", async () => {
    mockAssertMemoryApproval.mockRejectedValue(forbidden("Insufficient permissions to approve/reject memory items"));
    await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/memory`)
      .send({ ...basePost, status: "approved" })
      .expect(403);
    expect(mockMemoryService.create).not.toHaveBeenCalled();
  });

  it("POST status=rejected → approval gate fires (rejection is also an approval decision)", async () => {
    await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/memory`)
      .send({ ...basePost, status: "rejected" })
      .expect(201);
    expect(mockAssertMemoryApproval).toHaveBeenCalledTimes(1);
  });

  it("POST status=pending → approval gate NOT fired", async () => {
    await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/memory`)
      .send({ ...basePost, status: "pending" })
      .expect(201);
    expect(mockAssertMemoryApproval).not.toHaveBeenCalled();
  });

  it("POST with no status → approval gate NOT fired", async () => {
    await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/memory`)
      .send({ ...basePost })
      .expect(201);
    expect(mockAssertMemoryApproval).not.toHaveBeenCalled();
  });

  // ── PATCH /memory/:id ─────────────────────────────────────────────────────
  it("PATCH status=approved → gate fires with the EXISTING item's layer/dept", async () => {
    await request(makeApp())
      .patch(`/api/companies/${COMPANY_ID}/memory/${ITEM_ID}`)
      .send({ status: "approved" })
      .expect(200);
    expect(mockAssertMemoryApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      COMPANY_ID,
      { layer: "domain", departmentId: "dep-a" },
    );
  });

  it("PATCH status=approved → 403 when gate throws; update not called", async () => {
    mockAssertMemoryApproval.mockRejectedValue(forbidden("Insufficient permissions to approve/reject memory items"));
    await request(makeApp())
      .patch(`/api/companies/${COMPANY_ID}/memory/${ITEM_ID}`)
      .send({ status: "approved" })
      .expect(403);
    expect(mockMemoryService.update).not.toHaveBeenCalled();
  });

  it("PATCH status=approved with a re-specified layer → gate uses the effective (patch) layer", async () => {
    await request(makeApp())
      .patch(`/api/companies/${COMPANY_ID}/memory/${ITEM_ID}`)
      .send({ layer: "active_context", status: "approved" })
      .expect(200);
    expect(mockAssertMemoryApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      COMPANY_ID,
      { layer: "active_context", departmentId: "dep-a" },
    );
  });

  it("PATCH status=pending → approval gate NOT fired", async () => {
    await request(makeApp())
      .patch(`/api/companies/${COMPANY_ID}/memory/${ITEM_ID}`)
      .send({ content: "x", status: "pending" })
      .expect(200);
    expect(mockAssertMemoryApproval).not.toHaveBeenCalled();
  });
});
