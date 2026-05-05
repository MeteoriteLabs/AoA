import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("openai", () => {
  const createMock = vi.fn();
  const listModelsMock = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: createMock } },
      models: { list: listModelsMock },
    })),
    __createMock: createMock,
  };
});

vi.mock("../adapters/api-common.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    resolveApiKey: vi.fn().mockResolvedValue("sk-test-key"),
  };
});

import { execute } from "../adapters/openai-api/execute.js";
import { resolveApiKey } from "../adapters/api-common.js";

const OpenAI = (await import("openai")) as any;
const createMock = OpenAI.__createMock as ReturnType<typeof vi.fn>;

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", adapterType: "openai_api" } as any,
    runtime: {} as any,
    config: { model: "gpt-4o", ...overrides },
    context: {
      company: { name: "Test Co" },
      issueTitle: "Write docs",
    },
    onLog: vi.fn().mockResolvedValue(undefined),
    onMeta: vi.fn().mockResolvedValue(undefined),
  };
}

describe("openai_api execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveApiKey as any).mockResolvedValue("sk-test-key");
  });

  it("returns successful result with usage data", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "Documentation here..." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 300, completion_tokens: 150 },
    });

    const result = await execute(makeCtx());

    expect(result.exitCode).toBe(0);
    expect(result.usage?.inputTokens).toBe(300);
    expect(result.usage?.outputTokens).toBe(150);
    expect(result.provider).toBe("openai");
    expect(result.billingType).toBe("api");
  });

  it("maps prompt_tokens to inputTokens correctly", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    });

    const result = await execute(makeCtx());
    expect(result.usage?.inputTokens).toBe(1000);
    expect(result.usage?.outputTokens).toBe(500);
  });

  it("handles missing API key", async () => {
    const err = new Error("Configure your OpenAI API key in Settings > LLM Providers");
    (err as any).errorCode = "missing_api_key";
    (resolveApiKey as any).mockRejectedValue(err);

    const result = await execute(makeCtx());
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("missing_api_key");
  });
});
