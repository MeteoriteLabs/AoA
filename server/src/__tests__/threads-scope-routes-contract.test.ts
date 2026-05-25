import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const getPlanSteps = vi.fn();
const updatePlanSteps = vi.fn();
const getById = vi.fn();

vi.mock("../services/index.js", () => ({
  discussionService: () => ({ getById }),
  permissionService: () => ({ getEffectiveRole: vi.fn().mockResolvedValue("founder") }),
}));
vi.mock("../services/threads.js", () => ({
  threadService: () => ({ getPlanSteps, updatePlanSteps, advancePhase: vi.fn(), claim: vi.fn(), assignScopeItems: vi.fn(), transferOwnership: vi.fn(), addParticipant: vi.fn(), promoteToGoal: vi.fn() }),
  parseMentions: vi.fn(() => []),
  processMentions: vi.fn(),
}));
vi.mock("./authz.js", () => ({
  assertCompanyAccess: vi.fn(),
  getActorInfo: () => ({ actorId: "u1", actorType: "user", agentId: null }),
}));
vi.mock("../middleware/rbac.js", () => ({ assertRole: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/internal-agent/aoa-agents/router-recommendation.js", () => ({
  recommendDepartment: vi.fn(() => ({ departmentId: "eng", departmentName: "Engineering", itemCount: 1 })),
}));
vi.mock("@armyofagents/db", () => ({
  projects: { id: "p_id", name: "p_name", type: "p_type", companyId: "p_co" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
  and: vi.fn((...a: any[]) => a),
}));

import { discussionRoutes } from "../routes/discussions.js";

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.actor = { type: "board", source: "local_implicit", isInstanceAdmin: true };
    next();
  });
  a.use(discussionRoutes({} as any));
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /companies/:companyId/discussions/:discussionId/scope", () => {
  it("returns summary + planSteps + items + recommendation", async () => {
    getById.mockResolvedValue({
      id: "t1",
      summaryText: "Summary here",
      summaryNext: "Next steps",
      entries: [
        {
          extractedItems: [
            { id: "i1", type: "task", title: "Build it", suggestedDepartmentId: "eng", departmentId: null, status: "approved" },
          ],
        },
      ],
    });
    getPlanSteps.mockResolvedValue([{ id: "p1", stepOrder: 0, title: "Spec" }]);

    const res = await request(makeApp()).get("/companies/co1/discussions/t1/scope");
    expect(res.status).toBe(200);
    expect(res.body.summaryText).toBe("Summary here");
    expect(res.body.planSteps[0].title).toBe("Spec");
    expect(res.body.items[0].type).toBe("task");
    expect(res.body.recommendation.departmentId).toBe("eng");
  });

  it("returns 404 when discussion not found", async () => {
    getById.mockResolvedValue(null);
    const res = await request(makeApp()).get("/companies/co1/discussions/missing/scope");
    expect(res.status).toBe(404);
  });
});

describe("PUT /companies/:companyId/discussions/:discussionId/scope/plan", () => {
  it("replaces the plan and returns the count", async () => {
    updatePlanSteps.mockResolvedValue({ count: 2 });
    const res = await request(makeApp())
      .put("/companies/co1/discussions/t1/scope/plan")
      .send({ steps: [{ title: "A" }, { title: "B" }] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(updatePlanSteps).toHaveBeenCalledWith(
      "co1", "t1",
      [{ title: "A" }, { title: "B" }],
      expect.anything(),
    );
  });

  it("rejects malformed body (missing title) with 400", async () => {
    const res = await request(makeApp())
      .put("/companies/co1/discussions/t1/scope/plan")
      .send({ steps: [{ notTitle: 1 }] });
    expect(res.status).toBe(400);
  });
});
