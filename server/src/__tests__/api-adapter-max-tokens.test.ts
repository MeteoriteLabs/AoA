import { describe, expect, it, vi, beforeEach } from "vitest";

// --- OpenAI mocks ---
vi.mock("openai", () => {
  const createMock = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: createMock } },
    })),
    __createMock: createMock,
  };
});

// --- Gemini mocks ---
vi.mock("@google/generative-ai", () => {
  const generateContentMock = vi.fn();
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: generateContentMock,
      }),
    })),
    __generateContentMock: generateContentMock,
  };
});

vi.mock("../adapters/api-common.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    resolveApiKey: vi.fn().mockResolvedValue("test-key"),
  };
});

import { execute as executeOpenAI } from "../adapters/openai-api/execute.js";
import { execute as executeGemini } from "../adapters/gemini-api/execute.js";

const OpenAI = (await import("openai")) as any;
const openaiCreateMock = OpenAI.__createMock as ReturnType<typeof vi.fn>;

const GeminiSDK = (await import("@google/generative-ai")) as any;
const geminiGenerateMock = GeminiSDK.__generateContentMock as ReturnType<typeof vi.fn>;

function makeCtx(adapterType: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", adapterType } as any,
    runtime: {} as any,
    config: { model: undefined, ...overrides },
    context: {
      company: { name: "Test Co" },
      issueTitle: "Test task",
    },
    onLog: vi.fn().mockResolvedValue(undefined),
    onMeta: vi.fn().mockResolvedValue(undefined),
  };
}

describe("OpenAI max_tokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes config.maxTokens as max_tokens", async () => {
    openaiCreateMock.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await executeOpenAI(makeCtx("openai_api", { maxTokens: 2048 }));

    expect(openaiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048 }),
    );
  });

  it("omits max_tokens when not configured", async () => {
    openaiCreateMock.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await executeOpenAI(makeCtx("openai_api"));

    const callArgs = openaiCreateMock.mock.calls[0][0];
    expect(callArgs.max_tokens).toBeUndefined();
  });
});

describe("Gemini maxOutputTokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes config.maxTokens as maxOutputTokens in generationConfig", async () => {
    geminiGenerateMock.mockResolvedValue({
      response: {
        text: () => "ok",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    });

    await executeGemini(makeCtx("gemini_api", { maxTokens: 2048 }));

    expect(geminiGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: { maxOutputTokens: 2048 },
      }),
    );
  });

  it("omits maxOutputTokens when not configured", async () => {
    geminiGenerateMock.mockResolvedValue({
      response: {
        text: () => "ok",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    });

    await executeGemini(makeCtx("gemini_api"));

    const callArgs = geminiGenerateMock.mock.calls[0][0];
    expect(callArgs.generationConfig).toEqual({});
  });
});
