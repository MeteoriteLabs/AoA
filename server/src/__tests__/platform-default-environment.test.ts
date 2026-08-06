import { describe, expect, it } from "vitest";
import { resolvePlatformDefaultEnvironment } from "../services/platform-default-environment.js";

const COMPANY = "00000000-0000-0000-0000-000000000001";

describe("resolvePlatformDefaultEnvironment", () => {
  it("synthesizes a cloud e2b platform environment when E2B_API_KEY is set", () => {
    const env = resolvePlatformDefaultEnvironment({
      companyId: COMPANY,
      deploymentMode: "cloud_auth",
      env: { E2B_API_KEY: "op-key", E2B_TEMPLATE: "aoa-base", E2B_DOMAIN: "e2b.aoa.internal" },
    });
    expect(env).not.toBeNull();
    expect(env!.driver).toBe("sandbox");
    expect(env!.companyId).toBe(COMPANY);
    expect(env!.config).toMatchObject({ provider: "e2b", template: "aoa-base", domain: "e2b.aoa.internal" });
    expect(env!.target).toBeNull();
    expect(env!.executionTargetId).toBeNull();
  });

  it("returns null off-cloud (desktop/local_trusted keeps host execution)", () => {
    expect(
      resolvePlatformDefaultEnvironment({
        companyId: COMPANY,
        deploymentMode: "local_trusted",
        env: { E2B_API_KEY: "op-key" },
      }),
    ).toBeNull();
  });

  it("returns null on cloud when no operator E2B_API_KEY is configured", () => {
    expect(
      resolvePlatformDefaultEnvironment({
        companyId: COMPANY,
        deploymentMode: "cloud_auth",
        env: {},
      }),
    ).toBeNull();
  });

  it("does NOT leak operator secrets into the synthesized config", () => {
    const env = resolvePlatformDefaultEnvironment({
      companyId: COMPANY,
      deploymentMode: "cloud_auth",
      env: { E2B_API_KEY: "op-key" },
    });
    expect(JSON.stringify(env!.config)).not.toContain("op-key");
  });
});
