// WRK-008 slice 2b Step 8a — the CONTAINER boot root still refuses.
//
// The Wave-4 plan named this the largest single risk in the wave: composing the loop turns
// dispatch on for every daemon running the build the moment it merges. 2a showed the risk did
// not arise because no provider could be acquired; 2b adds the missing pieces, so the question
// is live again and deserves an ARTIFACT rather than an argument. The env is read from
// `docker-compose.d1.yml`, so it cannot drift.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { bootstrapWorkerDaemon, type BootstrapDeps } from "../bin/worker-daemon.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { generateDeviceKey, exportDevicePrivateKeyPkcs8Der } from "../identity/device-key.js";

const composePath = fileURLToPath(new URL("../../../../docker-compose.d1.yml", import.meta.url));

/** Extract a service's `environment:` block from the compose file — genuinely parsed, so a
 * value drift (or a hardcoded env) is caught by the fixture assertion below. */
function d1WorkerEnv(service: string): Record<string, string> {
  const lines = readFileSync(composePath, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start < 0) throw new Error(`service ${service} not found in compose file`);
  const env: Record<string, string> = {};
  let inEnv = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^  \S/.test(line)) break; // next 2-space service — done
    if (/^    environment:\s*$/.test(line)) { inEnv = true; continue; }
    if (inEnv && /^    \S/.test(line)) break; // next 4-space key under the service — env done
    if (inEnv) {
      const m = /^      ([A-Z0-9_]+):\s*"?([^"#]*?)"?\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!;
    }
  }
  return env;
}

function bootDeps(env: Record<string, string>, over: Partial<BootstrapDeps> = {}) {
  const records: Array<{ fields: Record<string, unknown> }> = [];
  const composeDispatch = vi.fn(async () => { throw new Error("composeDispatch must not be reached"); });
  const exitCodes: number[] = [];
  const deps = {
    env,
    proc: { once: () => {}, exit: (c: number) => exitCodes.push(c) },
    createLogger: () => ({ info: (f: Record<string, unknown>) => records.push({ fields: f }), warn: () => {}, error: (f: Record<string, unknown>) => records.push({ fields: f }), flush: async () => {} }),
    startHealth: async () => ({ port: 1, close: async () => {} }),
    composeDispatch,
    ...over,
  } as unknown as BootstrapDeps;
  return { deps, composeDispatch, exitCodes, reasons: () => records.map((r) => (r.fields as { reason?: string }).reason).filter((r): r is string => typeof r === "string") };
}

describe("shipped-binary-refuses (8a) — the container root", () => {
  it("the parsed D1 env is REAL (mounted_secret), so these assertions are not fixtures asserting themselves", () => {
    // Guards the "hardcode d1WorkerEnv" mutant: a hardcoded env would assert its own values.
    expect(d1WorkerEnv("worker-a").AOA_WORKER_KEY_STORE_MODE).toBe("mounted_secret");
    expect(d1WorkerEnv("worker-a").AOA_WORKER_DISPATCH_ENABLED).toBeUndefined();
    expect(d1WorkerEnv("worker-b").AOA_WORKER_KEY_STORE_MODE).toBe("mounted_secret");
  });

  it("the REAL production invocation refuses — composeDispatch at 0 calls", async () => {
    const { deps, composeDispatch } = bootDeps(d1WorkerEnv("worker-a"));
    await bootstrapWorkerDaemon(deps);
    expect(composeDispatch).not.toHaveBeenCalled();
  });

  it.each(["worker-a", "worker-b"])("%s refuses with EXACTLY no_provider", async (service) => {
    const { deps, reasons } = bootDeps(d1WorkerEnv(service));
    await bootstrapWorkerDaemon(deps);
    expect(reasons()).toEqual(["no_provider"]);
  });

  it("D1 with the flag FORCED ON still refuses (no provider)", async () => {
    const { deps, reasons } = bootDeps({ ...d1WorkerEnv("worker-a"), AOA_WORKER_DISPATCH_ENABLED: "1" });
    await bootstrapWorkerDaemon(deps);
    expect(reasons()).toEqual(["no_provider"]);
  });

  it("D1 + a provider + the flag STILL refuses — no_worker_identity (mounted_secret, no stores)", async () => {
    const { deps, reasons } = bootDeps(
      { ...d1WorkerEnv("worker-a"), AOA_WORKER_DISPATCH_ENABLED: "1", AOA_WORKER_EVENT_OUTBOX_PATH: "/tmp/o.db" },
      { provider: createFakeSandboxProvider({}) },
    );
    await bootstrapWorkerDaemon(deps);
    expect(reasons()).toContain("no_worker_identity");
  });

  it("★ POSITIVE CONTROL: the SAME composeDispatch spy IS reached once every gate is satisfied", async () => {
    // Without this the four refusal assertions would pass against an UNREACHABLE spy — "provably
    // inert" would be indistinguishable from "never wired". Full gates: os_keychain + stores +
    // provider + flag + outbox + a live session + a self-model.
    const { deps, composeDispatch } = bootDeps(
      { AOA_WORKER_CONTROL_PLANE_URL: "https://cp", AOA_WORKER_ENROLLMENT_CODE_ENV: "C", C: "x", AOA_WORKER_KEY_STORE_MODE: "os_keychain", AOA_WORKER_TARGET_SCOPE: "organization", AOA_WORKER_DISPATCH_ENABLED: "1", AOA_WORKER_EVENT_OUTBOX_PATH: "/tmp/o.db" },
      {
        provider: createFakeSandboxProvider({}),
        identityStore: { load: () => ({ v: 1, workerId: "00000000-0000-4000-8000-000000000001", targetId: "b0000000-0000-4000-8000-000000000003", deviceGeneration: 1, privateKeyPkcs8Der: exportDevicePrivateKeyPkcs8Der(generateDeviceKey()) }), save: () => {}, clear: () => {} } as never,
        receiptStore: { load: () => null, save: () => {}, clear: () => {} } as never,
        enrollOnceFn: (async () => ({ skipped: true, workerId: "w", targetId: "t", deviceGeneration: 1, deviceThumbprint: "tp" })) as never,
        createLifecycleFn: (() => ({ store: { current: () => ({ token: "s", workerId: "w", targetId: "t", deviceGeneration: 1, obtainedAtMs: 0, ttlMs: 1, expiresAtMs: 1 }), ensureFresh: async () => ({ token: "s" }), forceRefresh: async () => ({ token: "s" }), isStopped: () => false, set: () => {} }, onSessionMinted: () => {} })) as never,
        composeDispatch: vi.fn(async () => ({ leasing: { stopLeasing: () => {}, drain: async () => {} }, renewal: { stop: () => {} }, eventOutbox: { stopDrain: () => {}, flush: async () => {}, closeStore: () => {} }, self: {} as never, measure: () => ({}) as never, loopSupervisorSeam: { accept: () => {} }, limiter: {} as never, start: () => {}, pollLoop: {} as never })),
      },
    );
    // Give the read a live self-model so gate 6 passes.
    const fullDeps = { ...deps, createClient: () => ({ baseUrl: "http://f", selfModelReadPath: "/api/execution-targets/self/placement-profile", selfHelloRefreshPath: "/api/execution-targets/self/hello", selfModelRead: async () => ({ status: 200, body: readFixture() }), selfHelloRefresh: async () => ({ status: 200, body: {}, sessionHeader: "s2" }) }) } as unknown as BootstrapDeps;
    await bootstrapWorkerDaemon(fullDeps);
    expect(fullDeps.composeDispatch).toHaveBeenCalledTimes(1);
  });
});

function readFixture() {
  const f = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../tests/fixtures/worker-provisioned-target.json", import.meta.url)), "utf8")) as { registeredProfile: unknown; providerConstraintProfile: unknown };
  return { registeredProfile: f.registeredProfile, providerConstraintProfile: f.providerConstraintProfile };
}
