import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock drizzle-orm and db to avoid ESM cycle issues
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@paperclipai/db", () => ({
  memoryItems: {
    id: "id",
    companyId: "company_id",
    status: "status",
    embedding: "embedding",
    content: "content",
  },
}));

// Mock logger before importing module under test
vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Mock resolveApiKey
vi.mock("../adapters/api-common.js", () => ({
  resolveApiKey: vi.fn(),
}));

import { generateEmbedding, generateEmbeddingsBatch } from "../services/embeddings.js";

describe("Embedding Generation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeFakeEmbedding(dim = 1536): number[] {
    return Array.from({ length: dim }, (_, i) => i * 0.001);
  }

  describe("generateEmbedding", () => {
    it("calls OpenAI API and returns 1536-dim vector", async () => {
      const fakeEmbedding = makeFakeEmbedding();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: fakeEmbedding }] }),
      });

      const result = await generateEmbedding("Hello world", "sk-test-key");

      expect(result).toEqual(fakeEmbedding);
      expect(result).toHaveLength(1536);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer sk-test-key",
            "Content-Type": "application/json",
          }),
        }),
      );

      // Verify the body contains correct model and dimensions
      const call = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.dimensions).toBe(1536);
      expect(body.input).toBe("Hello world");
    });

    it("throws on empty text", async () => {
      await expect(generateEmbedding("", "sk-test")).rejects.toThrow(
        "Cannot generate embedding for empty text",
      );
      await expect(generateEmbedding("   ", "sk-test")).rejects.toThrow(
        "Cannot generate embedding for empty text",
      );
    });

    it("throws on API error response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      await expect(generateEmbedding("test", "sk-test")).rejects.toThrow(
        "OpenAI Embeddings API error 429: Rate limit exceeded",
      );
    });

    it("throws on invalid embedding response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await expect(generateEmbedding("test", "sk-test")).rejects.toThrow(
        "Invalid embedding response from OpenAI",
      );
    });

    it("throws on wrong dimension embedding", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      });

      await expect(generateEmbedding("test", "sk-test")).rejects.toThrow(
        "Invalid embedding response from OpenAI",
      );
    });
  });

  describe("generateEmbeddingsBatch", () => {
    it("generates embeddings for multiple texts in one API call", async () => {
      const emb1 = makeFakeEmbedding();
      const emb2 = makeFakeEmbedding();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { embedding: emb1, index: 0 },
            { embedding: emb2, index: 1 },
          ],
        }),
      });

      const result = await generateEmbeddingsBatch(["hello", "world"], "sk-test");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(emb1);
      expect(result[1]).toEqual(emb2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("returns empty array for empty input", async () => {
      const result = await generateEmbeddingsBatch([], "sk-test");
      expect(result).toEqual([]);
    });

    it("filters out empty strings", async () => {
      const emb1 = makeFakeEmbedding();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: emb1, index: 0 }],
        }),
      });

      const result = await generateEmbeddingsBatch(["hello", "", "  "], "sk-test");

      expect(result).toHaveLength(1);
      const call = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.input).toEqual(["hello"]);
    });

    it("sorts results by index to maintain order", async () => {
      const emb1 = makeFakeEmbedding();
      const emb2 = makeFakeEmbedding();
      // API returns out of order
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { embedding: emb2, index: 1 },
            { embedding: emb1, index: 0 },
          ],
        }),
      });

      const result = await generateEmbeddingsBatch(["first", "second"], "sk-test");

      expect(result[0]).toEqual(emb1);
      expect(result[1]).toEqual(emb2);
    });

    it("throws on API error", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });

      await expect(
        generateEmbeddingsBatch(["test"], "sk-test"),
      ).rejects.toThrow("OpenAI Embeddings API error 500");
    });
  });
});
