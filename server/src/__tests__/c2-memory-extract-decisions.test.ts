// server/src/__tests__/c2-memory-extract-decisions.test.ts
//
// Task C2 batch 3 — extract_decisions tool tests.
// Verifies: wraps the C1 named export, passes companyId + sinceEntryId,
// returns array of decisions, EXTRACTION_LLM_UNAVAILABLE on provider miss.

import { describe, expect, it, vi } from "vitest";

vi.mock("../services/extraction.js", () => ({
  extractDecisions: vi.fn(),
}));

import { extractDecisions } from "../services/extraction.js";
import { extractDecisionsTool } from "../services/internal-agent/tools/memory-extract-decisions.js";
import type { ToolContext } from "../services/internal-agent/types.js";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    companyId: "co-1",
    userId: "u-1",
    userRole: "team_member",
    enabledCapabilities: [],
    db: {} as any,
    services: {} as any,
    ...overrides,
  } as unknown as ToolContext;
}

describe("extract_decisions tool (C2 batch 3)", () => {
  it("metadata: name=extract_decisions, category=memory", () => {
    expect(extractDecisionsTool.name).toBe("extract_decisions");
    expect(extractDecisionsTool.category).toBe("memory");
    expect(extractDecisionsTool.requiredRole).toBe("team_member");
    expect(extractDecisionsTool.requiresConfirmation).toBe(false);
  });

  it("returns INVALID_PARAMS when threadId is missing", async () => {
    const result = await extractDecisionsTool.execute({}, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(extractDecisions as any).not.toHaveBeenCalled();
  });

  it("wraps extractDecisions and returns filtered list", async () => {
    const decisions = [
      { type: "decision", title: "Pick Postgres", description: null, suggestedLayer: "domain", suggestedPriority: null, suggestedDepartment: null },
    ];
    (extractDecisions as any).mockResolvedValueOnce(decisions);

    const llm = { generate: vi.fn() };
    const ctx = makeCtx({ services: { extraction: { llm } } as any });

    const result = await extractDecisionsTool.execute(
      { threadId: "th-1", sinceEntryId: "e-3" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(decisions);
    expect(result.summary).toContain("1");
    expect(extractDecisions).toHaveBeenCalledWith(
      ctx.db,
      llm,
      expect.objectContaining({ companyId: "co-1", threadId: "th-1", sinceEntryId: "e-3" }),
    );
  });

  it("returns EXTRACTION_LLM_UNAVAILABLE when provider resolution fails", async () => {
    (extractDecisions as any).mockRejectedValueOnce(
      new Error("No LLM provider configured"),
    );
    const result = await extractDecisionsTool.execute(
      { threadId: "th-1" },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("EXTRACTION_LLM_UNAVAILABLE");
    expect(result.data).toEqual([]);
  });
});
