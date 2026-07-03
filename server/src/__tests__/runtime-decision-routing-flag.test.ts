/**
 * Tests for resolveRuntimeDecisionRoutingEnabled — pure flag resolver.
 * All four conditions must hold to return true.
 */

import { describe, it, expect } from "vitest";
import { resolveRuntimeDecisionRoutingEnabled } from "../services/runtime-decision-routing-flag.js";

const BASE_TRUE: Parameters<typeof resolveRuntimeDecisionRoutingEnabled>[0] = {
  instanceEnv: { AOA_RUNTIME_DECISION_ROUTING: "1" },
  adapterType: "claude_local",
  executionTargetType: "local",
  agentRuntimeConfig: { runtimeDecisionRoutingEnabled: true },
};

describe("resolveRuntimeDecisionRoutingEnabled", () => {
  // ── Kill-switch (env var) ──────────────────────────────────────────────────

  it("returns false when AOA_RUNTIME_DECISION_ROUTING is unset (even with everything else true)", () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        instanceEnv: {},
      }),
    ).toBe(false);
  });

  it('returns false when AOA_RUNTIME_DECISION_ROUTING is "0"', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        instanceEnv: { AOA_RUNTIME_DECISION_ROUTING: "0" },
      }),
    ).toBe(false);
  });

  it('returns false when AOA_RUNTIME_DECISION_ROUTING is "true" (not the magic string "1")', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        instanceEnv: { AOA_RUNTIME_DECISION_ROUTING: "true" },
      }),
    ).toBe(false);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("returns true when env=1 + agent flag true + claude_local + local", () => {
    expect(resolveRuntimeDecisionRoutingEnabled(BASE_TRUE)).toBe(true);
  });

  // ── Per-agent opt-in ───────────────────────────────────────────────────────

  it("returns false when agentRuntimeConfig is null", () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        agentRuntimeConfig: null,
      }),
    ).toBe(false);
  });

  it("returns false when agentRuntimeConfig is undefined", () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        agentRuntimeConfig: undefined,
      }),
    ).toBe(false);
  });

  it("returns false when runtimeDecisionRoutingEnabled is missing from config", () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        agentRuntimeConfig: { contextMode: "standard" },
      }),
    ).toBe(false);
  });

  it("returns false when runtimeDecisionRoutingEnabled is false", () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        agentRuntimeConfig: { runtimeDecisionRoutingEnabled: false },
      }),
    ).toBe(false);
  });

  it("returns false when runtimeDecisionRoutingEnabled is 1 (number, not boolean true)", () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        agentRuntimeConfig: { runtimeDecisionRoutingEnabled: 1 },
      }),
    ).toBe(false);
  });

  // ── Adapter guard ──────────────────────────────────────────────────────────

  it('returns false when adapterType is "codex_local"', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        adapterType: "codex_local",
      }),
    ).toBe(false);
  });

  it('returns false when adapterType is "claude_api"', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        adapterType: "claude_api",
      }),
    ).toBe(false);
  });

  it('returns false when adapterType is "process"', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        adapterType: "process",
      }),
    ).toBe(false);
  });

  it('returns false when adapterType is "" (empty string)', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        adapterType: "",
      }),
    ).toBe(false);
  });

  // ── Execution-target guard ─────────────────────────────────────────────────

  it('returns false when executionTargetType is "sandbox-docker"', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        executionTargetType: "sandbox-docker",
      }),
    ).toBe(false);
  });

  it('returns false when executionTargetType is "provider-sandbox"', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        executionTargetType: "provider-sandbox",
      }),
    ).toBe(false);
  });

  it('returns false when executionTargetType is "remote-ssh"', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        executionTargetType: "remote-ssh",
      }),
    ).toBe(false);
  });

  it('returns false when executionTargetType is "" (empty string)', () => {
    expect(
      resolveRuntimeDecisionRoutingEnabled({
        ...BASE_TRUE,
        executionTargetType: "",
      }),
    ).toBe(false);
  });
});
