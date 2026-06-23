// server/src/__tests__/resolve-crew-adapter.test.ts
//
// Task 5 (Unit B): Verify that the persisted bad default model `gpt-5.3-codex`
// has been removed from resolveCrewAdapterFor and that needsAdapterBackfill
// correctly flags existing bad codex rows for self-healing backfill.
//
// Companion to resolve-crew-adapter-opencode.test.ts (same import/mock pattern).

import { describe, it, expect } from "vitest";
import { resolveCrewAdapterFor, needsAdapterBackfill } from "../services/internal-agent/aoa-agents/resolve-crew-adapter.js";

describe("resolve-crew-adapter (provider-switching fixes)", () => {
  it("codex default is no longer the API-key-only gpt-5.3-codex", () => {
    const a = resolveCrewAdapterFor("openai");
    expect(a.adapterType).toBe("codex_local");
    expect(a.adapterConfig.model).not.toBe("gpt-5.3-codex"); // empty or gpt-5.5
  });
  it("opencode default is a valid provider/model slash id, not a bare codex id", () => {
    const a = resolveCrewAdapterFor("opencode");
    expect(String(a.adapterConfig.model)).toMatch(/\//);
  });
  it("backfill flags an existing codex row pinned to gpt-5.3-codex", () => {
    expect(needsAdapterBackfill("codex_local", { model: "gpt-5.3-codex" })).toBe(true);
  });
  it("backfill leaves a compatible codex row alone", () => {
    expect(needsAdapterBackfill("codex_local", { model: "gpt-5.5" })).toBe(false);
  });
});
