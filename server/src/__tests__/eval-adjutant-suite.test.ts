import { describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures } from "../eval/fixture-loader.js";
import {
  buildAdjutantScopeSuite,
  type AdjutantClassification,
  type AdjutantThreadFixture,
} from "../eval/adjutant-scope-readiness/suite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "eval", "adjutant-scope-readiness", "fixtures");

function makeClassifierResponse(category: AdjutantClassification["category"], reasoning = "ok") {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: { content: JSON.stringify({ category, reasoning }) },
        },
      ],
    }),
  };
}

describe("loadFixtures", () => {
  it("loads all 15 Adjutant fixture cases sorted lexicographically", async () => {
    const cases = await loadFixtures<AdjutantThreadFixture, AdjutantClassification>(FIXTURES_DIR);
    expect(cases).toHaveLength(15);
    expect(cases.map((c) => c.id)).toEqual([
      "01-clearly-not-ready",
      "02-empty-thread",
      "03-pure-greetings",
      "04-phase-not-discuss",
      "05-only-agent-replies",
      "06-just-a-link",
      "07-medium-clarity",
      "08-vague-intent",
      "09-multiple-conflicting-ideas",
      "10-missing-constraints",
      "11-stalled-after-question",
      "12-full-alignment",
      "13-extensive-conversation",
      "14-rich-with-research",
      "15-obviously-ready",
    ]);
  });

  it("returns properly shaped EvalCase records", async () => {
    const cases = await loadFixtures<AdjutantThreadFixture, AdjutantClassification>(FIXTURES_DIR);
    for (const c of cases) {
      expect(typeof c.id).toBe("string");
      expect(c.input.thread).toBeDefined();
      expect(["exact", "contains", "llm-graded"]).toContain(c.expected.type);
    }
  });
});

describe("buildAdjutantScopeSuite", () => {
  it("resolves to a suite named 'adjutant-scope-readiness' with 15 cases", async () => {
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: vi.fn() as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    expect(suite.name).toBe("adjutant-scope-readiness");
    expect(suite.cases).toHaveLength(15);
    expect(suite.concurrency).toBe(5);
  });

  it("balances exact vs llm-graded across the fixture set (roughly 50/50)", async () => {
    const cases = await loadFixtures<AdjutantThreadFixture, AdjutantClassification>(FIXTURES_DIR);
    const exact = cases.filter((c) => c.expected.type === "exact").length;
    const graded = cases.filter((c) => c.expected.type === "llm-graded").length;
    expect(exact + graded).toBe(15);
    // Each side should have at least 5 cases so a single grading mode can't dominate.
    expect(exact).toBeGreaterThanOrEqual(5);
    expect(graded).toBeGreaterThanOrEqual(5);
  });

  it("covers all three categories with five fixtures each", async () => {
    const cases = await loadFixtures<AdjutantThreadFixture, AdjutantClassification>(FIXTURES_DIR);
    const counts: Record<string, number> = { wait: 0, "ask-clarifying": 0, "propose-scope": 0 };
    for (const c of cases) {
      const category = (c.expected.value as AdjutantClassification).category;
      counts[category] = (counts[category] ?? 0) + 1;
    }
    expect(counts).toEqual({ wait: 5, "ask-clarifying": 5, "propose-scope": 5 });
  });
});

describe("buildAdjutantScopeSuite.runOne", () => {
  it("calls fetch with the right body shape (model, system+user messages, json_object, temperature 0)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeClassifierResponse("wait", "nothing here"));
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });

    const first = suite.cases[0];
    const actual = await suite.runOne(first.input);
    expect(actual.category).toBe("wait");
    expect(actual.reasoning).toBe("nothing here");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Adjutant");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("Thread phase:");
    expect(body.messages[1].content).toContain("Entries (oldest first):");
  });

  it("throws 'no OPENAI_API_KEY configured' when no key is supplied", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    // Force-clear process.env fallback for this test.
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const suite = await buildAdjutantScopeSuite({
        fetchImpl,
        fixturesDir: FIXTURES_DIR,
      });
      await expect(suite.runOne(suite.cases[0].input)).rejects.toThrow(/no OPENAI_API_KEY/);
    } finally {
      if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("throws 'invalid category' when the classifier returns gibberish", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ category: "banana", reasoning: "?" }) } }],
      }),
    });
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    await expect(suite.runOne(suite.cases[0].input)).rejects.toThrow(/invalid category/);
  });

  it("throws when fetch returns non-ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    await expect(suite.runOne(suite.cases[0].input)).rejects.toThrow(/500/);
  });

  it("throws when the response is missing content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: null } }] }),
    });
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    await expect(suite.runOne(suite.cases[0].input)).rejects.toThrow(/empty content/);
  });
});

describe("buildAdjutantScopeSuite.grade", () => {
  it("returns exact match when categories match", async () => {
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: vi.fn() as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    const grade = await suite.grade(
      { category: "wait", reasoning: "" },
      { type: "exact", value: { category: "wait" } },
    );
    expect(grade.pass).toBe(true);
    expect(grade.score).toBe(1);
    expect(grade.reason).toContain("wait");
  });

  it("returns pass:false with 'expected X, got Y' helper text on exact mismatch", async () => {
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: vi.fn() as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    const grade = await suite.grade(
      { category: "wait", reasoning: "humans still chatting" },
      { type: "exact", value: { category: "propose-scope" } },
    );
    expect(grade.pass).toBe(false);
    expect(grade.score).toBe(0);
    expect(grade.reason).toContain("expected propose-scope");
    expect(grade.reason).toContain("got wait");
    // The classifier reasoning should be surfaced so failures are debuggable
    // from CI output without re-running the case.
    expect(grade.reason).toContain("humans still chatting");
  });

  it("delegates to the LLM grader for llm-graded cases (no-key sentinel path)", async () => {
    // No API key path — gradeWithRubric returns the sentinel without
    // calling fetch, which is exactly the signal we want CI to surface.
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const suite = await buildAdjutantScopeSuite({
        fetchImpl: vi.fn() as unknown as typeof fetch,
        fixturesDir: FIXTURES_DIR,
      });
      const grade = await suite.grade(
        { category: "propose-scope", reasoning: "looks good" },
        {
          type: "llm-graded",
          value: { category: "propose-scope" },
          rubric: "should converge into a scope",
        },
      );
      expect(grade.pass).toBe(false);
      expect(grade.reason).toContain("no OPENAI_API_KEY");
    } finally {
      if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("delegates to the LLM grader for llm-graded cases (mocked fetch path)", async () => {
    const graderFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ pass: true, score: 0.9, reason: "rubric satisfied" }),
            },
          },
        ],
      }),
    });
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: graderFetch as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    const grade = await suite.grade(
      { category: "ask-clarifying", reasoning: "vague" },
      {
        type: "llm-graded",
        value: { category: "ask-clarifying" },
        rubric: "should ask a focused question",
      },
    );
    expect(grade.pass).toBe(true);
    expect(grade.score).toBe(0.9);
    expect(grade.reason).toBe("rubric satisfied");
    expect(graderFetch).toHaveBeenCalledTimes(1);
  });

  it("handles 'contains' grading by checking the category appears in the expected value", async () => {
    const suite = await buildAdjutantScopeSuite({
      apiKey: "sk-test",
      fetchImpl: vi.fn() as unknown as typeof fetch,
      fixturesDir: FIXTURES_DIR,
    });
    const positive = await suite.grade(
      { category: "wait", reasoning: "" },
      { type: "contains", value: { allowed: ["wait", "ask-clarifying"] } },
    );
    expect(positive.pass).toBe(true);

    const negative = await suite.grade(
      { category: "propose-scope", reasoning: "" },
      { type: "contains", value: { allowed: ["wait", "ask-clarifying"] } },
    );
    expect(negative.pass).toBe(false);
    expect(negative.reason).toContain("propose-scope");
  });
});
