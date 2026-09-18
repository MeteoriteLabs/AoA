// crew-batch-workload.test.ts — MIG-006 slice 1.
//
// `buildCrewBatchWorkload` maps a company's crew provider to the v1 sandbox adapter
// (`resolveCrewAdapterFor`) and delegates to the generic `buildTaskRunBatchWorkload`,
// inheriting its v1-scope gate + attributable refusals. These arms pin the crew-specific
// behaviour: which providers ride the distributed substrate, which refuse, and the
// delegated refusal reasons. The disposition matrix is fixed
// (`sandbox-coding-disposition.ts`: claude_local/codex_local = v1; gemini_local/
// opencode_local = follow_up), so the google/opencode arms are not incidental.
import { describe, expect, it } from "vitest";
import { buildCrewBatchWorkload } from "../services/internal-agent/aoa-agents/crew-batch-workload.js";

const CLAUDE_CMD = { command: "claude" } as const;
const CODEX_CMD = { command: "codex" } as const;
const PROMPT = "Implement the feature described in the task.";

describe("buildCrewBatchWorkload — MIG-006 slice 1", () => {
  it("anthropic → claude_local rides the distributed substrate (ok)", () => {
    const out = buildCrewBatchWorkload({
      provider: "anthropic",
      runtimeCommandSpec: CLAUDE_CMD,
      currentTaskMarkdown: PROMPT,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(typeof out.workload.command).toBe("string");
      expect(Array.isArray(out.workload.args)).toBe(true);
      expect(out.workload.maxRuntimeSeconds).toBeGreaterThan(0);
    }
  });

  it("openai → codex_local rides the distributed substrate (ok)", () => {
    const out = buildCrewBatchWorkload({
      provider: "openai",
      runtimeCommandSpec: CODEX_CMD,
      currentTaskMarkdown: PROMPT,
    });
    expect(out.ok).toBe(true);
  });

  it("null provider defaults to codex_local (ok) — matches resolveCrewAdapterFor's default", () => {
    const out = buildCrewBatchWorkload({
      provider: null,
      runtimeCommandSpec: CODEX_CMD,
      currentTaskMarkdown: PROMPT,
    });
    expect(out.ok).toBe(true);
  });

  it("google → gemini_local is non-v1, refuses adapter_not_v1_scope", () => {
    const out = buildCrewBatchWorkload({
      provider: "google",
      runtimeCommandSpec: CLAUDE_CMD,
      currentTaskMarkdown: PROMPT,
    });
    expect(out).toEqual({ ok: false, reason: "adapter_not_v1_scope" });
  });

  it("opencode → opencode_local is non-v1, refuses adapter_not_v1_scope", () => {
    const out = buildCrewBatchWorkload({
      provider: "opencode",
      runtimeCommandSpec: CLAUDE_CMD,
      currentTaskMarkdown: PROMPT,
    });
    expect(out).toEqual({ ok: false, reason: "adapter_not_v1_scope" });
  });

  it("empty / whitespace prompt refuses empty_prompt (delegated)", () => {
    const out = buildCrewBatchWorkload({
      provider: "anthropic",
      runtimeCommandSpec: CLAUDE_CMD,
      currentTaskMarkdown: "   ",
    });
    expect(out).toEqual({ ok: false, reason: "empty_prompt" });
  });

  it("null runtime command spec refuses no_runtime_command_spec (delegated)", () => {
    const out = buildCrewBatchWorkload({
      provider: "anthropic",
      runtimeCommandSpec: null,
      currentTaskMarkdown: PROMPT,
    });
    expect(out).toEqual({ ok: false, reason: "no_runtime_command_spec" });
  });

  it("is deterministic — identical inputs produce identical results (idempotency)", () => {
    const input = {
      provider: "anthropic" as const,
      runtimeCommandSpec: CLAUDE_CMD,
      currentTaskMarkdown: PROMPT,
    };
    expect(buildCrewBatchWorkload({ ...input })).toEqual(buildCrewBatchWorkload({ ...input }));
  });
});
