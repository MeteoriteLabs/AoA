import { describe, it, expect } from "vitest";
import {
  createEnvironmentSchema,
  updateEnvironmentSchema,
} from "../validators/environment.js";
import type { Environment } from "../types/environment.js";

describe("createEnvironmentSchema", () => {
  it("accepts valid payload", () => {
    const result = createEnvironmentSchema.safeParse({
      name: "production",
      envVars: { API_KEY: "abc123" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = createEnvironmentSchema.safeParse({ envVars: {} });
    expect(result.success).toBe(false);
  });

  it("defaults envVars to empty object when omitted", () => {
    const result = createEnvironmentSchema.safeParse({ name: "staging" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.envVars).toEqual({});
  });

  it("accepts connectionTarget", () => {
    const result = createEnvironmentSchema.safeParse({
      name: "staging",
      envVars: {},
      connectionTarget: { host: "localhost" },
    });
    expect(result.success).toBe(true);
  });
});

describe("updateEnvironmentSchema", () => {
  it("accepts partial update", () => {
    const result = updateEnvironmentSchema.safeParse({ name: "renamed" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = updateEnvironmentSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("Environment type", () => {
  it("shape check", () => {
    const env: Environment = {
      id: "00000000-0000-0000-0000-000000000001",
      companyId: "00000000-0000-0000-0000-000000000002",
      name: "production",
      envVars: { KEY: "val" },
      connectionTarget: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(env.name).toBe("production");
  });
});
