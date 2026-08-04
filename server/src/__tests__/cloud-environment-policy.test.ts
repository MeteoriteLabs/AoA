import { describe, expect, it } from "vitest";
import {
  assertEnvironmentRuntimeSupportedForDeployment,
  CLOUD_ENVIRONMENT_TARGET_UNAVAILABLE,
} from "../services/cloud-environment-policy.js";

describe("cloud environment runtime policy", () => {
  const e2b = { driver: "sandbox", config: { provider: "e2b", template: "base" }, target: null, executionTargetId: null };

  it("allows only an unpinned E2B provider sandbox in cloud_auth", () => {
    expect(() => assertEnvironmentRuntimeSupportedForDeployment("cloud_auth", e2b)).not.toThrow();
  });

  it.each([
    ["local", { driver: "local", config: {}, target: { type: "local" } }],
    ["docker", { driver: "sandbox", config: { provider: "sandbox-docker" }, target: { type: "sandbox-docker", image: "node:22" } }],
    ["gvisor", { driver: "sandbox", config: { provider: "gvisor", runtime: "runsc" }, target: null }],
    ["raw target", { ...e2b, target: { type: "local" } }],
    ["execution pin", { ...e2b, executionTargetId: "11111111-1111-4111-8111-111111111111" }],
  ])("rejects %s in cloud_auth", (_label, input) => {
    try {
      assertEnvironmentRuntimeSupportedForDeployment("cloud_auth", input);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        status: 422,
        details: { code: CLOUD_ENVIRONMENT_TARGET_UNAVAILABLE },
      });
    }
  });

  it.each(["local_trusted", "authenticated"] as const)("preserves %s behavior", (mode) => {
    expect(() => assertEnvironmentRuntimeSupportedForDeployment(mode, {
      driver: "local",
      target: { type: "local" },
      executionTargetId: "11111111-1111-4111-8111-111111111111",
    })).not.toThrow();
  });
});
