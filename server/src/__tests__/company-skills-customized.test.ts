import { describe, it, expect, vi } from "vitest";

vi.mock("../services/index.js", () => ({
  accessService: vi.fn(() => ({ canUser: vi.fn().mockResolvedValue(true) })),
  agentService: vi.fn(() => ({})),
  companySkillService: vi.fn(() => ({
    updateFile: vi.fn().mockResolvedValue({ id: "skill-1", path: "SKILL.md", markdown: "# New" }),
    list: vi.fn(),
  })),
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: vi.fn(),
  getActorInfo: vi.fn(() => ({ actorType: "board", actorId: "u1", agentId: null, runId: null })),
}));
vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return { companySkills: tableProxy };
});
vi.mock("drizzle-orm", () => ({ eq: () => Symbol("eq") }));

import express from "express";
import request from "supertest";
import { companySkillRoutes } from "../routes/company-skills.js";

describe("PATCH /companies/:companyId/skills/:skillId/files — sets customized = true", () => {
  it("calls db.update(companySkills).set({ customized: true }) after updateFile", async () => {
    const skillSets: any[] = [];
    const db = {
      update: (_table: any) => ({
        set: (values: any) => ({
          where: () => {
            skillSets.push(values);
            return Promise.resolve();
          },
        }),
      }),
    };

    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.actor = { type: "board", source: "local_implicit", userId: "u1", isInstanceAdmin: true };
      next();
    });
    app.use(companySkillRoutes(db as any));

    const res = await request(app)
      .patch("/companies/c1/skills/skill-1/files")
      .send({ path: "SKILL.md", content: "# Updated skill" });

    expect(res.status).toBe(200);
    expect(skillSets.some((s) => s.customized === true)).toBe(true);
  });
});
