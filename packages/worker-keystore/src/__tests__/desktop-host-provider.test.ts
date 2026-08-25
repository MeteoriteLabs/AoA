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
import { runDesktopHost } from "../bin/desktop-host.js";

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
});
