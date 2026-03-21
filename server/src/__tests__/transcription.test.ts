import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribe } from "../services/transcription.js";

const originalFetch = globalThis.fetch;

describe("transcription service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Whisper API with correct parameters and returns text", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Hello, this is a test transcription." }),
    });

    const buffer = Buffer.from("fake audio data");
    const result = await transcribe(buffer, "audio/webm", "sk-test-key");

    expect(result).toBe("Hello, this is a test transcription.");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer sk-test-key" },
      }),
    );
  });

  it("throws on Whisper API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const buffer = Buffer.from("fake audio data");
    await expect(
      transcribe(buffer, "audio/webm", "bad-key"),
    ).rejects.toThrow("Whisper API error 401");
  });

  it("throws on empty transcription result", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "" }),
    });

    const buffer = Buffer.from("silence");
    await expect(
      transcribe(buffer, "audio/webm", "sk-test-key"),
    ).rejects.toThrow("Whisper returned empty transcription");
  });

  it("maps mime types to correct file extensions", async () => {
    let capturedFormData: FormData | null = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedFormData = opts.body;
      return { ok: true, json: async () => ({ text: "test" }) };
    });

    const buffer = Buffer.from("data");
    await transcribe(buffer, "audio/mp4", "sk-test-key");

    // The FormData should contain a file named recording.mp4
    const fileEntry = capturedFormData?.get("file") as File | null;
    expect(fileEntry?.name).toBe("recording.mp4");

    // Verify model is whisper-1
    expect(capturedFormData?.get("model")).toBe("whisper-1");
  });
});
