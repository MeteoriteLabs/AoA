import { describe, expect, it, vi } from "vitest";

// Mock @armyofagents/db and drizzle-orm before importing the tool (dynamic imports inside execute)
vi.mock("@armyofagents/db", () => ({
  companySkills: new Proxy({}, {
    get: (_t, k) => `companySkills.${String(k)}`,
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}));

import { useSkillTool } from "../services/internal-agent/tools/skill-tools.js";

function makeCtx(selectResult: any[]) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => selectResult,
          }),
        }),
      }),
    },
    companyId: "comp-1",
    userId: "user-1",
    userRole: "team_member",
  } as any;
}

describe("useSkillTool.execute", () => {
  it("returns success with key, name, content when skill is found", async () => {
    const skill = {
      key: "brainstorming",
      name: "Brainstorming",
      description: "Before building new features",
      markdown: "# Brainstorming\nUse this before any build.",
    };
    const ctx = makeCtx([skill]);
    const result = await useSkillTool.execute({ key: "brainstorming" }, ctx);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      key: "brainstorming",
      name: "Brainstorming",
      content: "# Brainstorming\nUse this before any build.",
    });
  });

  it("returns INVALID_PARAMS when key is undefined", async () => {
    const ctx = makeCtx([]);
    const result = await useSkillTool.execute({} as any, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when key is empty string", async () => {
    const ctx = makeCtx([]);
    const result = await useSkillTool.execute({ key: "" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND when DB query returns empty array", async () => {
    const ctx = makeCtx([]);
    const result = await useSkillTool.execute({ key: "nonexistent-skill" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
  });

  it("returns INTERNAL when DB throws", async () => {
    const ctx = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                throw new Error("Connection refused");
              },
            }),
          }),
        }),
      },
      companyId: "comp-1",
      userId: "user-1",
      userRole: "team_member",
    } as any;
    const result = await useSkillTool.execute({ key: "brainstorming" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INTERNAL");
  });

  it("summary includes the skill name when skill is found", async () => {
    const skill = {
      key: "review",
      name: "Code Review",
      description: null,
      markdown: "# Review\nDo reviews.",
    };
    const ctx = makeCtx([skill]);
    const result = await useSkillTool.execute({ key: "review" }, ctx);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Code Review");
  });
});
