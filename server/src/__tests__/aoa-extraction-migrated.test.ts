// A8 — extraction routed through the AoA runner. The M3 consumer
// (insert run + link + extractFromDiscussionEntry + cost + error boundary)
// has been SUPERSEDED: runAoaAgent (A7) now owns every one of those
// mechanics (asserted in aoa-runner.test.ts). runExtractionConsumer is now a
// thin, signature-preserving delegator so the A6 dispatcher (which imports &
// calls it with 4 args) is unaffected. This test pins the delegation
// contract: same args in → forwarded to runAoaAgent with the trigger-agnostic
// payload; never rethrows (the isolation guarantee now lives in the runner).
import { describe, expect, it, vi } from "vitest";

const { runAoaMock } = vi.hoisted(() => ({
  runAoaMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({
  runAoaAgent: runAoaMock,
}));

import { runExtractionConsumer } from "../services/internal-agent/subagents/extraction-consumer.js";

describe("runExtractionConsumer delegates to the AoA runner (A8)", () => {
  it("delegates extraction to the AoA runner, never rethrows", async () => {
    const db: any = {};
    await expect(
      runExtractionConsumer(db, "co-1", "e1", "ext-1"),
    ).resolves.toBeUndefined();
    expect(runAoaMock).toHaveBeenCalledWith(db, "ext-1", {
      entryId: "e1",
      companyId: "co-1",
      source: "discussion_entry_pending",
    });
  });
});
