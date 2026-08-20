// DSK-001 — the composition host.
//
// The only file in the repo that names both packages, and the only caller of
// `clear()`. Two properties are worth more than the wiring:
//
//   AN UNRESOLVABLE LOCATION IS A REFUSAL, NEVER A GUESS. Guessing is how a
//   device ends up with a second identity in a second place — and the server
//   denies a re-minted identity permanently.
//
//   THE RESET ORDER IS RECEIPT-FIRST, IDENTITY-SECOND. If the process dies
//   between the two, receipt-first leaves an identity with no receipt, which the
//   coordinator treats as "enrolled but unconfirmed" and can retry. The reverse
//   leaves a RECEIPT WITH NO IDENTITY — a device claiming an enrolment whose key
//   is gone, which nothing can recover.

import { describe, expect, it, vi } from "vitest";
import { runDesktopHost, RESET_IDENTITY_FLAG } from "../bin/desktop-host.js";

const LOCAL = "C:\\Users\\t\\AppData\\Local";

function fakeProc() {
  const exitCodes: number[] = [];
  return { exitCodes, proc: { once: () => {}, exit: (c: number) => { exitCodes.push(c); } } };
}

const okRunner = () => ({ run: () => ({
  exitCode: 0, signal: null, stdout: new Uint8Array(), stderr: "", absenceSignalled: true,
}) });

describe("DSK-001 — an unresolvable location is a refusal", () => {
  it("exits non-zero and NEVER bootstraps when LOCALAPPDATA is absent", async () => {
    const { exitCodes, proc } = fakeProc();
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const out = await runDesktopHost({
      env: {}, proc: proc as never, platform: "win32", argv: [],
      createRunner: okRunner as never, bootstrap: bootstrap as never, log: () => {},
    });
    expect(out.ok).toBe(false);
    expect(exitCodes).toEqual([1]);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("exits non-zero on a non-Windows platform rather than inventing a path", async () => {
    const { exitCodes, proc } = fakeProc();
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const out = await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL }, proc: proc as never, platform: "linux", argv: [],
      createRunner: okRunner as never, bootstrap: bootstrap as never, log: () => {},
    });
    expect(out.ok).toBe(false);
    expect(exitCodes).toEqual([1]);
    expect(bootstrap).not.toHaveBeenCalled();
  });
});

describe("DSK-001 — the host injects BOTH stores into the daemon", () => {
  it("passes an identity store and a receipt store", async () => {
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL }, proc: proc as never, platform: "win32", argv: [],
      createRunner: okRunner as never, bootstrap: bootstrap as never, log: () => {},
    });
    const passed = bootstrap.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed.identityStore).toBeDefined();
    expect(passed.receiptStore).toBeDefined();
    // Two DISTINCT stores — sharing one would make the receipt overwrite the key.
    expect(passed.identityStore).not.toBe(passed.receiptStore);
  });
});

describe("DSK-001 — reset is deliberate, ordered, and honest about failure", () => {
  it("does NOT clear anything on a normal boot", async () => {
    const cleared: string[] = [];
    const runner = { run: (plan: { blobPath: string; stdin: string }) => {
      if (plan.stdin === "none") cleared.push(plan.blobPath);
      return { exitCode: 0, signal: null, stdout: new Uint8Array(), stderr: "", absenceSignalled: true };
    } };
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL }, proc: proc as never, platform: "win32", argv: [],
      createRunner: (() => runner) as never, bootstrap: (async () => ({ ok: true })) as never, log: () => {},
    });
    // A normal boot must never reach a delete plan.
    expect(cleared).toEqual([]);
  });

  it("clears the RECEIPT before the IDENTITY", async () => {
    // The order is the recoverability property. Identity-first would leave a
    // receipt with no key — an unrecoverable claim of an enrolment.
    //
    // Observed through the REAL stores via the runner's delete plans rather than
    // through injected fakes: the two blobs have distinct paths, so the order is
    // visible without inventing a test-only seam, and this proves the actual
    // constructed stores are cleared in order.
    const deleted: string[] = [];
    const runner = {
      run: (plan: { blobPath: string; stdin: string }) => {
        deleted.push(plan.blobPath);
        return {
          exitCode: 0, signal: null, stdout: new Uint8Array(),
          stderr: "", absenceSignalled: true,
        };
      },
    };
    const { proc } = fakeProc();
    const out = await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL }, proc: proc as never, platform: "win32",
      argv: [RESET_IDENTITY_FLAG],
      createRunner: (() => runner) as never,
      bootstrap: (async () => ({ ok: true })) as never,
      log: () => {},
    });
    expect(out.ok).toBe(true);
    expect(deleted).toHaveLength(2);
    expect(deleted[0]).toContain("device-enrollment");
    expect(deleted[1]).toContain("device-identity");
  });

  it("does not bootstrap when resetting", async () => {
    const bootstrap = vi.fn(async () => ({ ok: true }));
    const { proc } = fakeProc();
    await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL }, proc: proc as never, platform: "win32",
      argv: [RESET_IDENTITY_FLAG],
      createRunner: okRunner as never, bootstrap: bootstrap as never, log: () => {},
    });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("reports a FAILED wipe as a failure, never as success", async () => {
    // A half-wiped device reporting "reset" is worse than one reporting an error
    // an operator can act on.
    const runner = { run: () => ({
      exitCode: 5, signal: null, stdout: new Uint8Array(),
      stderr: "Access is denied.", absenceSignalled: false,
    }) };
    const { exitCodes, proc } = fakeProc();
    const out = await runDesktopHost({
      env: { LOCALAPPDATA: LOCAL }, proc: proc as never, platform: "win32",
      argv: [RESET_IDENTITY_FLAG],
      createRunner: (() => runner) as never,
      bootstrap: (async () => ({ ok: true })) as never,
      log: () => {},
    });
    expect(out.ok).toBe(false);
    expect(exitCodes).toEqual([1]);
  });
});
