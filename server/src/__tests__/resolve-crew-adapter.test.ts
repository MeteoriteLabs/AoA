// server/src/__tests__/resolve-crew-adapter.test.ts
//
// Task 5 (Unit B): Verify that the persisted bad default model `gpt-5.3-codex`
// has been removed from resolveCrewAdapterFor and that needsAdapterBackfill
// correctly flags existing bad codex rows for self-healing backfill.
//
// Companion to resolve-crew-adapter-opencode.test.ts (same import/mock pattern).

import { describe, it, expect } from "vitest";
import { resolveCrewAdapterFor, needsAdapterBackfill, mergeAdapterConfig } from "../services/internal-agent/aoa-agents/resolve-crew-adapter.js";
import { DEFAULT_CODEX_CHAT_MODEL } from "../services/internal-agent/codex-model.js";

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
  it("is a stable fixpoint: a codex row rewritten to the default is not re-flagged", () => {
    expect(needsAdapterBackfill("codex_local", { model: DEFAULT_CODEX_CHAT_MODEL })).toBe(false);
  });

  // Codex P2: a founder may intentionally run codex_local in api-key mode (where
  // gpt-5.3-codex is valid — resolveModel's apikey branch). A per-agent
  // OPENAI_API_KEY signals that intent; don't "self-heal" (rewrite) it.
  it("backfill does NOT flag an intentional apikey codex row (has its own OPENAI_API_KEY)", () => {
    expect(needsAdapterBackfill("codex_local", { model: "gpt-5.3-codex", env: { OPENAI_API_KEY: "sk-founder" } })).toBe(false);
  });
  it("backfill still flags a bad codex row with no per-agent key", () => {
    expect(needsAdapterBackfill("codex_local", { model: "gpt-5.3-codex", env: {} })).toBe(true);
  });
  it("backfill ignores a blank per-agent OPENAI_API_KEY (still flags)", () => {
    expect(needsAdapterBackfill("codex_local", { model: "gpt-5.3-codex", env: { OPENAI_API_KEY: "  " } })).toBe(true);
  });

  // Codex P2: a backfill rewrite must preserve the founder's per-agent settings —
  // only the resolved model (+ bypass flags from `next`) should change.
  it("mergeAdapterConfig preserves per-agent env/cwd/command/extraArgs while rewriting the model", () => {
    const merged = mergeAdapterConfig(
      { model: "gpt-5.3-codex", env: { OPENAI_API_KEY: "sk-x" }, cwd: "/w", command: "codex", extraArgs: ["--foo"] },
      { model: "gpt-5.5", dangerouslyBypassApprovalsAndSandbox: true },
    );
    expect(merged.model).toBe("gpt-5.5");
    expect(merged.dangerouslyBypassApprovalsAndSandbox).toBe(true);
    expect(merged.env).toEqual({ OPENAI_API_KEY: "sk-x" });
    expect(merged.cwd).toBe("/w");
    expect(merged.command).toBe("codex");
    expect(merged.extraArgs).toEqual(["--foo"]);
  });
  it("mergeAdapterConfig still preserves instructions* fields", () => {
    const merged = mergeAdapterConfig({ instructionsFilePath: "/i.md", model: "old" }, { model: "gpt-5.5" });
    expect(merged.instructionsFilePath).toBe("/i.md");
    expect(merged.model).toBe("gpt-5.5");
  });
});
