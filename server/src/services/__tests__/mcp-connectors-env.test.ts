import { describe, expect, it } from "vitest";
import { buildConnectorProcessEnv, mergeConnectorEnv } from "../mcp-connectors-env.js";

// mergeConnectorEnv is the PURE half — takes an already-scrubbed base so it can
// be unit-tested with synthetic input. Real scrubbing is buildScrubbedCliEnv,
// which reads process.env internally and is exercised by the thin wrapper.
describe("mergeConnectorEnv", () => {
  it("includes connector token vars", () => {
    const env = mergeConnectorEnv({ PATH: "/usr/bin" }, { AOA_MCP_NOTION_TOKEN: "secret-abc" });
    expect(env.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
  });

  it("preserves PATH from the scrubbed base so npx-based stdio connectors resolve", () => {
    const env = mergeConnectorEnv({ PATH: "/usr/bin" }, {});
    expect(env.PATH).toBe("/usr/bin");
  });

  it("drops undefined values from the scrubbed base", () => {
    const env = mergeConnectorEnv({ PATH: "/usr/bin", EMPTY: undefined }, {});
    expect(env).not.toHaveProperty("EMPTY");
  });

  it("never lets a connector var overwrite PATH", () => {
    const env = mergeConnectorEnv({ PATH: "/usr/bin" }, { PATH: "/evil" });
    expect(env.PATH).toBe("/usr/bin");
  });

  it("builds a null-prototype result", () => {
    const env = mergeConnectorEnv({ PATH: "/usr/bin" }, {});
    expect(Object.getPrototypeOf(env)).toBe(null);
  });
});

describe("buildConnectorProcessEnv", () => {
  it("preserves real PATH (or Windows Path) from process.env so a spawned stdio connector can resolve npx/node", () => {
    const env = buildConnectorProcessEnv({});
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
    expect(pathKey).toBeDefined();
    expect(env[pathKey as string]).toBeTruthy();
  });

  it("does not leak AoA/infra secrets from process.env into the connector env", () => {
    const savedDbUrl = process.env.DATABASE_URL;
    const savedAoa = process.env.AOA_TEST_SECRET_PROBE;
    process.env.DATABASE_URL = "postgres://should-not-leak";
    process.env.AOA_TEST_SECRET_PROBE = "should-not-leak";
    try {
      const env = buildConnectorProcessEnv({});
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.AOA_TEST_SECRET_PROBE).toBeUndefined();
    } finally {
      if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDbUrl;
      if (savedAoa === undefined) delete process.env.AOA_TEST_SECRET_PROBE;
      else process.env.AOA_TEST_SECRET_PROBE = savedAoa;
    }
  });
});
