import { describe, it, expect } from "vitest";
import { orgCodexRowNeedsBackfill } from "../org-codex-backfill.js";

describe("orgCodexRowNeedsBackfill", () => {
  it("flags an org codex row pinned to gpt-5.3-codex", () => {
    expect(orgCodexRowNeedsBackfill({ kind: "org", adapterType: "codex_local", adapterConfig: { model: "gpt-5.3-codex" } })).toBe(true);
  });
  it("leaves a compatible org codex row alone", () => {
    expect(orgCodexRowNeedsBackfill({ kind: "org", adapterType: "codex_local", adapterConfig: { model: "gpt-5.5" } })).toBe(false);
  });
  it("ignores crew (aoa) rows — those use the crew backfill", () => {
    expect(orgCodexRowNeedsBackfill({ kind: "aoa", adapterType: "codex_local", adapterConfig: { model: "gpt-5.3-codex" } })).toBe(false);
  });
  it("ignores non-codex org rows", () => {
    expect(orgCodexRowNeedsBackfill({ kind: "org", adapterType: "claude_local", adapterConfig: { model: "gpt-5.5" } })).toBe(false);
  });
  it("leaves an org codex row that set its OWN OPENAI_API_KEY (apikey mode — gpt-5.3-codex is valid)", () => {
    expect(orgCodexRowNeedsBackfill({ kind: "org", adapterType: "codex_local", adapterConfig: { model: "gpt-5.3-codex", env: { OPENAI_API_KEY: "sk-agent" } } })).toBe(false);
  });
});
