import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: ISSUE-003 (2026-05-25). extractFromDebrief (the MCP debrief-push
// extraction path) called callLLM(prompt, content) WITHOUT db/companyId, so it
// skipped the company_secrets (Settings UI) key lookup and only checked env
// vars → "No LLM API key configured" → debrief processing_failed. This test
// configures ONLY a Settings/db key (no env), so it fails if the db/companyId
// args are dropped again.

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => ({
  debriefs: { id: "debrief_id", companyId: "debrief_company_id" },
  briefs: {},
  briefItems: {},
  projects: {
    id: "project_id",
    name: "project_name",
    type: "project_type",
    companyId: "project_company_id",
  },
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) },
}));

const getKeyMock = vi.fn();
vi.mock("../services/internal-agent/providers/index.js", () => ({
  getProviderApiKey: (...a: unknown[]) => getKeyMock(...a),
  createProvider: vi.fn(),
  resolveAvailableProvider: vi.fn(),
}));

import { extractionService } from "../services/extraction.js";

function makeSelectChain(queue: unknown[][]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    then: vi.fn((fn: (rows: unknown[]) => unknown) =>
      Promise.resolve(fn(queue.shift() ?? [])),
    ),
  };
}

describe("extractFromDebrief — Settings provider key (ISSUE-003)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    // Only an OpenAI key is configured in Settings (company_secrets via db) —
    // no env keys. callLLM must reach this via getProviderApiKey(db, companyId).
    getKeyMock.mockImplementation(
      (_db: unknown, _cid: string, provider: string) =>
        provider === "openai"
          ? Promise.resolve("settings-openai-key")
          : Promise.reject(new Error("no key")),
    );
  });

  it("extracts using the db/companyId-resolved key when no env key is present", async () => {
    const capturedBriefItems: Record<string, unknown>[] = [];
    const selectQueue: unknown[][] = [
      [
        {
          id: "debrief-1",
          companyId: "company-1",
          rawContent: "Decision: ship it. Task: do the thing.",
          departmentId: null,
          projectId: null,
          goalId: null,
        },
      ],
      [],
    ];
    const db = {
      select: vi.fn(() => makeSelectChain(selectQueue)),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: vi.fn(() => ({
            values: vi.fn((v: unknown) => {
              if (Array.isArray(v)) capturedBriefItems.push(...v);
              return { returning: vi.fn().mockResolvedValue([{ id: "brief-1" }]) };
            }),
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
          })),
        }),
      ),
    } as unknown as Parameters<typeof extractionService>[0];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { type: "task", title: "Ship it", description: "x", department: null },
                ]),
              },
            },
          ],
        }),
      }),
    );

    await extractionService(db).extractFromDebrief("company-1", "debrief-1");

    // The db/companyId path was used (rejects "no key" → would fail if dropped).
    expect(getKeyMock).toHaveBeenCalledWith(
      expect.anything(),
      "company-1",
      "openai",
    );
    // Extraction succeeded (items produced) rather than processing_failed.
    expect(capturedBriefItems.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });
});
