import { beforeEach, describe, expect, it, vi } from "vitest";

// Guard imports the app logger; stub it so importing the module has no side
// effects. The tests inject their own `log`, so this stub is belt-and-suspenders.
vi.mock("../middleware/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn() }) },
}));

import {
  assertUnsandboxedMultitenantAllowed,
  isUnsandboxedLocalTarget,
  resetUnsandboxedMultitenantWarning,
  UNSANDBOXED_MULTITENANT_OPT_IN_ENV,
} from "../services/unsandboxed-multitenant-guard.js";

describe("assertUnsandboxedMultitenantAllowed (D1)", () => {
  beforeEach(() => resetUnsandboxedMultitenantWarning());

  const local = { type: "local" as const };
  const dockerSandbox = { type: "sandbox-docker" as const, image: "node:22" };
  const providerSandbox = {
    type: "provider-sandbox" as const,
    provider: "modal",
    providerLeaseId: "lease-1",
    remoteCwd: "/workspace",
    shell: "sh" as const,
    env: {},
    runner: { execute: async () => ({}) } as any,
  };
  const noEnv: NodeJS.ProcessEnv = {};
  const optedIn: NodeJS.ProcessEnv = { [UNSANDBOXED_MULTITENANT_OPT_IN_ENV]: "1" };

  it("throws on cloud_auth (isolation enforced) + local target + no opt-in", () => {
    expect(() =>
      assertUnsandboxedMultitenantAllowed(local, { tenantIsolationEnforced: true, sink: "org agent", env: noEnv }),
    ).toThrow(/AOA_ALLOW_UNSANDBOXED_MULTITENANT/);
    expect(() =>
      assertUnsandboxedMultitenantAllowed(local, { tenantIsolationEnforced: true, sink: "org agent", env: noEnv }),
    ).toThrow(/org agent/);
  });

  it("throws on cloud_auth + null/undefined target (treated as local) + no opt-in", () => {
    expect(() =>
      assertUnsandboxedMultitenantAllowed(null, { tenantIsolationEnforced: true, sink: "crew agent", env: noEnv }),
    ).toThrow(/AOA_ALLOW_UNSANDBOXED_MULTITENANT/);
    expect(() =>
      assertUnsandboxedMultitenantAllowed(undefined, { tenantIsolationEnforced: true, sink: "Commander", env: noEnv }),
    ).toThrow();
  });

  it("allows (no throw) and warns ONCE on cloud_auth + local + opt-in", () => {
    const log = { warn: vi.fn() };
    expect(() =>
      assertUnsandboxedMultitenantAllowed(local, { tenantIsolationEnforced: true, sink: "org agent", env: optedIn, log }),
    ).not.toThrow();
    // second call in the same process must NOT warn again
    assertUnsandboxedMultitenantAllowed(local, { tenantIsolationEnforced: true, sink: "org agent", env: optedIn, log });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][1]).toContain(UNSANDBOXED_MULTITENANT_OPT_IN_ENV);
  });

  it("is a no-op when tenant isolation is NOT enforced (self-hosted local_trusted / authenticated)", () => {
    const log = { warn: vi.fn() };
    // A plain self-hosted install...
    expect(() =>
      assertUnsandboxedMultitenantAllowed(local, { tenantIsolationEnforced: false, sink: "org agent", env: noEnv, log }),
    ).not.toThrow();
    // ...and an `authenticated` self-host (multi_tenant boundary but NOT cloud_auth):
    // still allowed — this is the whole point of gating on cloud_auth, not trustBoundary.
    expect(() =>
      assertUnsandboxedMultitenantAllowed(null, { tenantIsolationEnforced: false, sink: "org agent", env: noEnv, log }),
    ).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("is a no-op on cloud_auth when the target is already sandboxed", () => {
    const log = { warn: vi.fn() };
    expect(() =>
      assertUnsandboxedMultitenantAllowed(dockerSandbox, { tenantIsolationEnforced: true, sink: "org agent", env: noEnv, log }),
    ).not.toThrow();
    expect(() =>
      assertUnsandboxedMultitenantAllowed(providerSandbox, { tenantIsolationEnforced: true, sink: "org agent", env: noEnv, log }),
    ).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("isUnsandboxedLocalTarget classifies targets", () => {
    expect(isUnsandboxedLocalTarget(local)).toBe(true);
    expect(isUnsandboxedLocalTarget(null)).toBe(true);
    expect(isUnsandboxedLocalTarget(undefined)).toBe(true);
    expect(isUnsandboxedLocalTarget(dockerSandbox)).toBe(false);
    expect(isUnsandboxedLocalTarget(providerSandbox)).toBe(false);
  });
});
