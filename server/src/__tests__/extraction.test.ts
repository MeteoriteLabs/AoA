import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
}));

vi.mock("@paperclipai/db", () => ({
  debriefs: { id: "debrief_id", companyId: "debrief_company_id" },
  briefs: {},
  briefItems: {},
  projects: { id: "project_id", name: "project_name", type: "project_type", companyId: "project_company_id" },
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { extractionService } from "../services/extraction.js";

function makeSelectChain(queue: any[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    then: vi.fn((fn: (rows: any[]) => any) => Promise.resolve(fn(queue.shift() ?? []))),
  };
}

describe("extractionService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("stores suggested layer and selected layer on extracted brief items", async () => {
    const capturedBriefItems: any[] = [];
    const selectQueue = [[
      {
        id: "debrief-1",
        companyId: "company-1",
        rawContent: "Founder preference: write in a direct tone",
        departmentId: null,
        projectId: null,
        goalId: "goal-1",
      },
    ], []];
    const db = {
      select: vi.fn(() => makeSelectChain(selectQueue)),
      transaction: vi.fn(async (fn: (tx: any) => Promise<any>) =>
        fn({
          insert: vi.fn((table: any) => ({
            values: vi.fn((values: any) => {
              if (Array.isArray(values)) {
                capturedBriefItems.push(...values);
              }
              return {
                returning: vi.fn().mockResolvedValue([{ id: "brief-1" }]),
              };
            }),
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn().mockResolvedValue(undefined),
            })),
          })),
        })),
    } as any;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                type: "preference",
                title: "Write directly",
                description: "Use a direct, concise tone.",
                department: null,
                layer: "identity",
              },
            ]),
          },
        }],
      }),
    }));

    await extractionService(db).extractFromDebrief("company-1", "debrief-1");

    expect(capturedBriefItems[0]).toEqual(
      expect.objectContaining({
        type: "preference",
        suggestedLayer: "identity",
        layer: "identity",
      }),
    );
  });
});
