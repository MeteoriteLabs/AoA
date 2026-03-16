import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the SDK before importing execute
vi.mock("@anthropic-ai/sdk", () => {
  const createMock = vi.fn();
  const listModelsMock = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: createMock },
      models: { list: listModelsMock },
    })),
    __createMock: createMock,
    __listModelsMock: listModelsMock,
  };
});

// Mock api-common's resolveApiKey
vi.mock("../adapters/api-common.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    resolveApiKey: vi.fn().mockResolvedValue("sk-ant-test-key"),
  };
});

import { execute } from "../adapters/claude-api/execute.js";
import { resolveApiKey } from "../adapters/api-common.js";

// Access mocked SDK methods
const Anthropic = (await import("@anthropic-ai/sdk")) as any;
const createMock = Anthropic.__createMock as ReturnType<typeof vi.fn>;

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", adapterType: "claude_api" } as any,
    runtime: {} as any,
    config: { model: "claude-sonnet-4-6", ...overrides },
    context: {
      company: { name: "Test Co", description: "Testing" },
      issueTitle: "Write tests",
      issueDescription: "Write unit tests for the adapter",
    },
    onLog: vi.fn().mockResolvedValue(undefined),
    onMeta: vi.fn().mockResolvedValue(undefined),
  };
}

describe("claude_api execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveApiKey as any).mockResolvedValue("sk-ant-test-key");
  });

  it("returns successful result with usage data", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Here are the tests..." }],
      usage: { input_tokens: 500, output_tokens: 200 },
      stop_reason: "end_turn",
    });

    const result = await execute(makeCtx());

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.usage?.inputTokens).toBe(500);
    expect(result.usage?.outputTokens).toBe(200);
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.billingType).toBe("api");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("passes response text to onLog", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Response text here" }],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: "end_turn",
    });

    const ctx = makeCtx();
    await execute(ctx);

    expect(ctx.onLog).toHaveBeenCalledWith("stdout", "Response text here");
  });

  it("uses specified model from config", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    });

    await execute(makeCtx({ model: "claude-haiku-4-5-20251001" }));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001" }),
    );
  });

  it("handles missing API key", async () => {
    const err = new Error("Configure your Anthropic API key in Settings > LLM Providers");
    (err as any).errorCode = "missing_api_key";
    (resolveApiKey as any).mockRejectedValue(err);

    const result = await execute(makeCtx());

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("missing_api_key");
  });

  it("handles empty response", async () => {
    createMock.mockResolvedValue({
      content: [],
      usage: { input_tokens: 100, output_tokens: 0 },
      stop_reason: "end_turn",
    });

    const result = await execute(makeCtx());

    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("empty");
  });
});
