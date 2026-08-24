// WRK-008 slice 2 — `AOA_WORKER_DISPATCH_ENABLED`.
//
// ★ THE PARSE IS STRICT ON PURPOSE, and the third test is the reason. The worst outcome
// for a flag that turns on LIVE WORK DISPATCH is not "it failed to start" — it is an
// operator writing `=true`, reading no error, and believing dispatch is on when it is
// silently off. So exactly `"1"` enables, unset/empty disables, and anything else is a
// startup error. That matches how this config file already treats an invalid enum or a
// non-loopback health host: refuse to boot rather than quietly reinterpret.

import { describe, expect, it } from "vitest";

import { loadWorkerConfig, ENV } from "../config/config.js";

const BASE: Record<string, string> = {
  [ENV.controlPlaneUrl]: "https://control.example",
  [ENV.enrollmentCodeEnv]: "code-abc",
  [ENV.keyStoreMode]: "mounted_secret",
  [ENV.targetScope]: "organization",
};

const load = (extra: Record<string, string> = {}) => loadWorkerConfig({ ...BASE, ...extra });

describe("WRK-008 slice 2 — dispatch flag", () => {
  it("defaults to DISABLED when unset", () => {
    expect(load().dispatchEnabled).toBe(false);
  });

  it('enables on exactly "1"', () => {
    expect(load({ [ENV.dispatchEnabled]: "1" }).dispatchEnabled).toBe(true);
  });

  it("★ REFUSES to boot on a truthy-looking value rather than reading it as off", () => {
    // The silent-misread failure this strictness exists to prevent.
    // NOTE "0 " is deliberately NOT here: it trims to "0", an explicit disable. Having
    // listed it first was a defect in this test, not in the parser.
    for (const value of ["true", "yes", "on", "TRUE", "enabled", "2", "1x"]) {
      expect(() => load({ [ENV.dispatchEnabled]: value })).toThrow(/AOA_WORKER_DISPATCH_ENABLED/);
    }
  });

  it('accepts an explicit "0" as disabled — writing it out is not an error', () => {
    expect(load({ [ENV.dispatchEnabled]: "0" }).dispatchEnabled).toBe(false);
    expect(load({ [ENV.dispatchEnabled]: " 0 " }).dispatchEnabled).toBe(false);
  });

  it("treats empty/whitespace as unset, like the other optional vars here", () => {
    expect(load({ [ENV.dispatchEnabled]: "" }).dispatchEnabled).toBe(false);
    expect(load({ [ENV.dispatchEnabled]: "   " }).dispatchEnabled).toBe(false);
  });

  it("is surfaced in the ENV name map so it is documented, never logged with a value", () => {
    expect(ENV.dispatchEnabled).toBe("AOA_WORKER_DISPATCH_ENABLED");
  });
});
