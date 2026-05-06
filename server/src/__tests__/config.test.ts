import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

// loadConfig() reads process.env directly — preserve and restore around each
// test so cross-file ordering can't leak AOA_TRUST_PROXY between cases.
const ORIGINAL = process.env.AOA_TRUST_PROXY;

describe("loadConfig — trustProxy", () => {
  beforeEach(() => {
    delete process.env.AOA_TRUST_PROXY;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.AOA_TRUST_PROXY;
    } else {
      process.env.AOA_TRUST_PROXY = ORIGINAL;
    }
  });

  it("defaults to false when env var is unset", () => {
    expect(loadConfig().trustProxy).toBe(false);
  });

  it("defaults to false when env var is empty string", () => {
    process.env.AOA_TRUST_PROXY = "";
    expect(loadConfig().trustProxy).toBe(false);
  });

  it('parses "true" → true', () => {
    process.env.AOA_TRUST_PROXY = "true";
    expect(loadConfig().trustProxy).toBe(true);
  });

  it('parses "false" → false', () => {
    process.env.AOA_TRUST_PROXY = "false";
    expect(loadConfig().trustProxy).toBe(false);
  });

  it('parses integer string → number (hop count)', () => {
    process.env.AOA_TRUST_PROXY = "2";
    expect(loadConfig().trustProxy).toBe(2);
  });

  it("parses comma-separated CIDR list → array", () => {
    process.env.AOA_TRUST_PROXY = "10.0.0.0/8,192.168.0.0/16";
    expect(loadConfig().trustProxy).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });

  it("trims whitespace in CIDR list entries", () => {
    process.env.AOA_TRUST_PROXY = " 10.0.0.0/8 , 192.168.0.0/16 ";
    expect(loadConfig().trustProxy).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });

  it("rejects malformed input with an error naming the env var", () => {
    process.env.AOA_TRUST_PROXY = "not-a-number-or-cidr";
    expect(() => loadConfig()).toThrow(/AOA_TRUST_PROXY/);
  });
});
