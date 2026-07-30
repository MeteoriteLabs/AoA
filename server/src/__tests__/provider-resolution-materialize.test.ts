// server/src/__tests__/provider-resolution-materialize.test.ts
import { describe, it, expect } from "vitest";
import { materializeEnvPatch } from "../services/provider-resolution.js";

describe("materializeEnvPatch", () => {
  it("api_key → provider env var carries the resolved secret value", () => {
    const patch = materializeEnvPatch({
      authMethod: "api_key",
      provider: "anthropic",
      envVar: "ANTHROPIC_API_KEY",
      secretValue: "sk-real",
      config: {},
      subscriptionEnv: null,
    });
    expect(patch).toEqual({ ANTHROPIC_API_KEY: "sk-real" });
  });

  it("enterprise_gateway → base URL + token in the DEFAULT token env var", () => {
    const patch = materializeEnvPatch({
      authMethod: "enterprise_gateway",
      provider: "anthropic",
      envVar: "ANTHROPIC_API_KEY",
      secretValue: "gw-token",
      config: { baseUrl: "https://gw/v1" },
      subscriptionEnv: null,
    });
    expect(patch).toEqual({ ANTHROPIC_BASE_URL: "https://gw/v1", ANTHROPIC_AUTH_TOKEN: "gw-token" });
  });

  it("enterprise_gateway honors a per-connection config.tokenEnvVar in the allowlist", () => {
    const patch = materializeEnvPatch({
      authMethod: "enterprise_gateway", provider: "anthropic", envVar: "ANTHROPIC_API_KEY",
      secretValue: "gw-token", config: { baseUrl: "https://gw/v1", tokenEnvVar: "ANTHROPIC_API_KEY" },
      subscriptionEnv: null,
    });
    expect(patch).toEqual({ ANTHROPIC_BASE_URL: "https://gw/v1", ANTHROPIC_API_KEY: "gw-token" });
  });

  it("enterprise_gateway clamps an out-of-allowlist tokenEnvVar back to the default", () => {
    const patch = materializeEnvPatch({
      authMethod: "enterprise_gateway", provider: "anthropic", envVar: "ANTHROPIC_API_KEY",
      secretValue: "gw-token", config: { baseUrl: "https://gw/v1", tokenEnvVar: "EVIL_EXFIL_URL" },
      subscriptionEnv: null,
    });
    expect(patch).toEqual({ ANTHROPIC_BASE_URL: "https://gw/v1", ANTHROPIC_AUTH_TOKEN: "gw-token" });
  });

  it("personal_subscription → passes through the resolved home env, never a token", () => {
    const patch = materializeEnvPatch({
      authMethod: "personal_subscription",
      provider: "anthropic",
      envVar: "ANTHROPIC_API_KEY",
      secretValue: null,
      config: {},
      subscriptionEnv: { HOME: "/root/.aoa/x", CLAUDE_CONFIG_DIR: "/root/.aoa/x/anthropic" },
    });
    expect(patch).toEqual({ HOME: "/root/.aoa/x", CLAUDE_CONFIG_DIR: "/root/.aoa/x/anthropic" });
    expect(patch.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("empty api_key secret injects NOTHING (preserves secrets.ts:970-973 invariant)", () => {
    const patch = materializeEnvPatch({
      authMethod: "api_key",
      provider: "anthropic",
      envVar: "ANTHROPIC_API_KEY",
      secretValue: "",
      config: {},
      subscriptionEnv: null,
    });
    expect(patch).toEqual({});
  });
});
