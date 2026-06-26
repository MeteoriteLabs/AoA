// Structural lock for the crew-runner binding-resolution fix (Codex P2).
//
// runAoaAgent is a large integration function with no unit harness, so — like
// heartbeat-provider-resolution.test.ts pins the resolveRunScopedModel ordering
// from source — this pins the invariant the fix establishes:
//
//   the crew runner MUST resolve adapterConfig env bindings (secret_ref/plain →
//   string) BEFORE provider-status detection + model resolution + spawn, and
//   those consumers must use the RESOLVED config — not the raw persisted config.
//
// Without this, a per-agent OPENAI_API_KEY stored as a binding object is detected
// as apikey but never reaches the codex child (codex-local copies only string env),
// so api-key-only models are kept while the run has no key.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "runner.ts"), "utf8");

describe("crew runner resolves env bindings before provider-status/model-resolution (Codex P2)", () => {
  const iResolve = src.indexOf("resolveAdapterConfigForRuntime(");
  const iStatus = src.indexOf("getProviderStatus(");
  const iModel = src.indexOf("applyModelResolutionToConfig(");

  it("calls resolveAdapterConfigForRuntime in the crew run path", () => {
    expect(iResolve).toBeGreaterThan(-1);
  });
  it("resolves BEFORE provider-status detection", () => {
    expect(iStatus).toBeGreaterThan(-1);
    expect(iResolve).toBeLessThan(iStatus);
  });
  it("resolves BEFORE model resolution", () => {
    expect(iModel).toBeGreaterThan(-1);
    expect(iResolve).toBeLessThan(iModel);
  });
  it("feeds the RESOLVED config (runtimeBaseConfig) into provider-status, not the raw baseConfig", () => {
    expect(src).toMatch(/adapterConfig:\s*runtimeBaseConfig/);
  });
  it("feeds the RESOLVED config (runtimeBaseConfig) into model resolution, not the raw baseConfig", () => {
    // applyModelResolutionToConfig(agent.adapterType, runtimeBaseConfig, ...)
    expect(src).toMatch(/applyModelResolutionToConfig\(\s*agent\.adapterType,\s*runtimeBaseConfig/);
  });
});
