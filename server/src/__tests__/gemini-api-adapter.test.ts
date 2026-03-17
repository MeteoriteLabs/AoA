import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@google/generative-ai", () => {
  const generateContentMock = vi.fn();
  const countTokensMock = vi.fn();
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: generateContentMock,
        countTokens: countTokensMock,
      }),
    })),
    __generateContentMock: generateContentMock,
    __countTokensMock: countTokensMock,
  };
});

vi.mock("../adapters/api-common.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    resolveApiKey: vi.fn().mockResolvedValue("AIza-test-key"),
  };
});

import { execute } from "../adapters/gemini-api/execute.js";
import { resolveApiKey } from "../adapters/api-common.js";

const GeminiSDK = (await import("@google/generative-ai")) as any;
const generateContentMock = GeminiSDK.__generateContentMock as ReturnType<typeof vi.fn>;

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", adapterType: "gemini_api" } as any,
    runtime: {} as any,
    config: { model: "gemini-2.0-flash", ...overrides },
    context: {
      company: { name: "Test Co" },
      issueTitle: "Analyze data",
    },
    onLog: vi.fn().mockResolvedValue(undefined),
    onMeta: vi.fn().mockResolvedValue(undefined),
  };
}

describe("gemini_api execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveApiKey as any).mockResolvedValue("AIza-test-key");
  });

  it("returns successful result with usage data", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () => "Analysis results here...",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
      },
    });

    const result = await execute(makeCtx());

    expect(result.exitCode).toBe(0);
    expect(result.usage?.inputTokens).toBe(200);
    expect(result.usage?.outputTokens).toBe(100);
    expect(result.provider).toBe("google");
    expect(result.billingType).toBe("api");
  });

  it("handles safety filter block", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () => "",
        candidates: [{ finishReason: "SAFETY" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0 },
      },
    });

    const result = await execute(makeCtx());
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("safety_block");
  });

  it("handles missing API key", async () => {
    const err = new Error("Configure your Google API key in Settings > LLM Providers");
    (err as any).errorCode = "missing_api_key";
    (resolveApiKey as any).mockRejectedValue(err);

    const result = await execute(makeCtx());
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("missing_api_key");
  });
});
