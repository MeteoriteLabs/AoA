// DEP-010 (Sprint 2) — the desktop composition root can inject a sandbox provider.
//
// `desktop-host.ts` is the root E4-D01 forces to live OUTSIDE `worker-daemon` (the daemon
// defines the `SandboxProvider` port and cannot import an implementation), so it is where a
// real provider is composed for the desktop/self-hosted lane. Step 3 gives it a `provider`
// pass-through; Step 4 locks the shipped default (no provider); Steps 6–8 add the resolver
// and prove that even a provider-bearing boot composes no supervisor and no poll loop.
//
// The provider PASSES THROUGH untouched — the root never calls a provider method — so a
// sentinel object suffices to prove it reaches `bootstrap`.

import { describe, expect, it, vi } from "vitest";
import {
  bootstrapWorkerDaemon,
  type Env,
  type Logger,
  type HealthServerHandle,
  type ProcessLike,
} from "@armyofagents/worker-daemon";
import {
  runDesktopHost,
  RESET_IDENTITY_FLAG,
  RESET_ACKNOWLEDGEMENT_FLAG,
} from "../bin/desktop-host.js";
import { E2bSandboxProvider, createMockE2bTransport } from "@armyofagents/sandbox-e2b-provider";
import type { ProviderModule, ProviderModuleLoader } from "../bin/sandbox-provider.js";

const LOCAL = "C:\\Users\\t\\AppData\\Local";

function fakeProc() {
  const exitCodes: number[] = [];
  return { exitCodes, proc: { once: () => {}, exit: (c: number) => { exitCodes.push(c); } } };
}

const okRunner = () => ({
  run: () => ({ exitCode: 0, signal: null, stdout: new Uint8Array(), stderr: "", absenceSignalled: true }),
});

describe("DEP-010 — the desktop root forwards an explicitly-injected provider", () => {
  it("passes a directly-injected provider through to bootstrap", async () => {
    const provider = { __sentinel: "sandbox-provider" } as never;
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL },
      proc: proc as never,
      platform: "win32",
      argv: [],
      createRunner: okRunner as never,
      bootstrap: bootstrap as never,
      log: () => {},
      provider,
    });
    const passed = bootstrap.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed.provider).toBe(provider);
  });

  // ─── Step 4 — LOCK the shipped default ──────────────────────────────────────────
  // These pass the moment they are written; they earn their place through the mutation
  // check (design §7): (a) forwarding `deps.provider ?? ({} as SandboxProvider)` breaks
  // the first; (b) `compose-dispatch.ts` `if (!input.provider)` -> `if (false)` breaks the
  // second (via a rebuilt worker-daemon dist, which is how worker-keystore resolves it).

  it("★ the SHIPPED shape passes NO provider to bootstrap", async () => {
    // The default `bin/aoa-worker-desktop` boot: `deps.provider` is absent, so bootstrap
    // is handed `undefined`. `?? {}`-style defaulting would smuggle a truthy object here.
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL },
      proc: proc as never,
      platform: "win32",
      argv: [],
      createRunner: okRunner as never,
      bootstrap: bootstrap as never,
      log: () => {},
    });
    const passed = bootstrap.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed.provider).toBeUndefined();
  });

  it("★ a REAL bootstrapWorkerDaemon on the shipped env reports no_provider", async () => {
    // The lock that matters: the daemon this root feeds, booted for real with no provider,
    // refuses dispatch with `no_provider` through a real logger — not silence, and not some
    // other reason. This is the daemon-side half of "the shipped default constructs no
    // provider" (E4-F011 / go-book §8 D-3 condition c).
    const { reasons } = await bootDaemon(daemonEnv());
    expect(reasons).toContain("no_provider");
  });
});

// The shipped daemon env the desktop root forwards. `mounted_secret` custody keeps the
// enrolment (os_keychain) branch out of the path, so no network or store is needed to reach
// the dispatch decision — exactly the worker-daemon suite's own boot shape.
function daemonEnv(overrides: Env = {}): Env {
  return {
    AOA_WORKER_CONTROL_PLANE_URL: "https://control.example.com",
    AOA_WORKER_ENROLLMENT_CODE_FILE: "/run/secrets/enrollment-code",
    AOA_WORKER_KEY_STORE_MODE: "mounted_secret",
    AOA_WORKER_TARGET_SCOPE: "organization",
    ...overrides,
  };
}

/** Boot the REAL daemon with a capturing logger and a stubbed health server, and return the
 * structured `reason` fields it logged (the dispatch refusal is a FIELD, not only prose). */
async function bootDaemon(env: Env, provider?: unknown) {
  const records: Array<{ fields: unknown }> = [];
  const logger = {
    info: (fields: unknown) => { records.push({ fields }); },
    warn: () => {}, error: () => {}, flush: async () => {},
  } as unknown as Logger;
  const health = { close: async () => {} } as unknown as HealthServerHandle;
  const proc: ProcessLike = { once: () => {}, exit: () => {} };
  await bootstrapWorkerDaemon({
    env,
    proc,
    provider: provider as never,
    createLogger: () => logger,
    startHealth: vi.fn(async () => health) as never,
  } as never);
  const reasons = records
    .map((r) => (r.fields as { reason?: string } | undefined)?.reason)
    .filter((r): r is string => typeof r === "string");
  return { reasons };
}

// ─── Step 7 — the root resolves and injects a provider, AFTER control and reset ──────────────
//
// The injected module seam pairs the REAL provider with a MOCK transport, so no case reaches the
// e2b credential path. The env opts in; a control command or a reset must NOT resolve at all.

const OPT_IN = { AOA_WORKER_SANDBOX_PROVIDER: "e2b", AOA_WORKER_E2B_TEMPLATE: "base" };

function providerSeam(over: Partial<ProviderModule> = {}): ProviderModuleLoader {
  return async () => ({
    E2bSandboxProvider: E2bSandboxProvider as never,
    createRealE2bTransport: (() => createMockE2bTransport()) as never,
    ...over,
  });
}

const controlDeps = {
  authorize: () => ({ allowed: true }),
  resolveTarget: async () => ({ ok: true, pid: 42 }),
  signal: async () => {},
  readStatus: async () => ({ running: true }),
  readLogTail: async () => "a log line",
};

describe("DEP-010 — the desktop root resolves and injects a provider", () => {
  it("resolves a provider from the env and injects the REAL one into bootstrap", async () => {
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL, ...OPT_IN },
      proc: proc as never, platform: "win32", argv: [],
      createRunner: okRunner as never, bootstrap: bootstrap as never, log: () => {},
      loadProviderModule: providerSeam(),
    });
    const passed = bootstrap.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed.provider).toBeInstanceOf(E2bSandboxProvider);
  });

  it("REFUSES to boot when an explicitly-requested provider cannot be built", async () => {
    // An opt-in that cannot be honoured is a refusal, never a degrade. The propagated message
    // names the credential (asserted only here, in a .test.ts the boundary scanner skips).
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const { proc, exitCodes } = fakeProc();
    const logs: string[] = [];
    const out = await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL, ...OPT_IN },
      proc: proc as never, platform: "win32", argv: [],
      createRunner: okRunner as never, bootstrap: bootstrap as never, log: (m) => logs.push(m),
      loadProviderModule: providerSeam({
        createRealE2bTransport: (() => {
          throw new Error("RealE2bTransport requires E2B_API_KEY (provider-control credential)");
        }) as never,
      }),
    });
    expect(out.ok).toBe(false);
    expect(exitCodes).toEqual([1]);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("E2B_API_KEY");
  });

  it("a CONTROL command does NOT construct a provider — the resolve runs AFTER it", async () => {
    const load = vi.fn(providerSeam());
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL, ...OPT_IN },
      proc: proc as never, platform: "win32", argv: ["status", "--token=t"],
      createRunner: okRunner as never, bootstrap: (async () => ({ ok: true })) as never, log: () => {},
      loadProviderModule: load,
      control: controlDeps as never,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("--reset-identity does NOT construct a provider — the resolve runs AFTER it", async () => {
    const load = vi.fn(providerSeam());
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL, ...OPT_IN },
      proc: proc as never, platform: "win32",
      argv: [RESET_IDENTITY_FLAG, RESET_ACKNOWLEDGEMENT_FLAG],
      createRunner: okRunner as never, bootstrap: (async () => ({ ok: true })) as never, log: () => {},
      loadProviderModule: load,
    });
    expect(load).not.toHaveBeenCalled();
  });
});
