// packages/worker-keystore/src/command-runner.ts
//
// DSK-001 (D2) — THE ONLY FILE IN THIS PACKAGE PERMITTED TO SPAWN A SUBPROCESS.
//
// `scripts/check-worker-keystore-boundary.mjs` enforces that mechanically, in the
// always-on `policy` job: any other runtime source importing `node:child_process`
// is a build failure. The confinement is what lets every decision that matters —
// the planner, the outcome classifier, the envelope codec, the store — stay pure
// and OS-free, and therefore provable on the ubuntu-only REQUIRED CI lane rather
// than on an advisory Windows one that cannot gate a merge.
//
// This file deliberately contains NO policy. It runs the plan it is handed and
// reports what happened. Every interpretation lives in `classifyStoreOutcome`.
//
// Two things here are load-bearing:
//
//   1. `execFileSync` with `input:` delivers the private key on STDIN. The port
//      this ultimately satisfies is synchronous (`DeviceKeyStore.load(): DeviceKey
//      | null`), so an async runner is not an option, and `input:` is how the sync
//      form preserves the "never on argv" property (I5).
//
//   2. **Absence is decided HERE, by the filesystem, and nowhere else.** On
//      Windows the blob file is the absence oracle: `ENOENT` means never enrolled.
//      An unprotect failure is ALWAYS a fault. This matters because the crypto
//      layer cannot tell the two apart — the same CryptographicException was
//      measured as exit 0 under `-File` and exit 1 under `-EncodedCommand`, with
//      identical empty stdout. So the runner probes the file first and sets
//      `absenceSignalled` explicitly; the classifier never infers it.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import type { VaultCommandPlan } from "./command-plan.js";
import type { CommandRunner } from "./identity-store.js";
import type { StoreCommandResult } from "./outcome.js";

/** Generous enough for an envelope, bounded so a runaway child cannot exhaust us. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

interface ExecFileSyncError {
  status?: number | null;
  signal?: string | null;
  stdout?: Buffer | null;
  stderr?: Buffer | null;
  message?: string;
}

function isExecError(err: unknown): err is ExecFileSyncError {
  return typeof err === "object" && err !== null;
}

/**
 * The production runner.
 *
 * `fileExists` is injectable purely so the absence oracle can be exercised in a
 * unit test without touching a real filesystem; it defaults to the real check.
 */
export function createCommandRunner(deps: { fileExists?: (path: string) => boolean } = {}): CommandRunner {
  const fileExists = deps.fileExists ?? existsSync;

  return {
    run(plan: VaultCommandPlan, stdin?: Uint8Array): StoreCommandResult {
      // (1) THE ABSENCE ORACLE. Only a `load` may be absent: a `store` that finds
      // no file is the normal first enrolment, and a `delete` of nothing is
      // handled by the store as success. Deciding absence here — from the
      // filesystem — is what keeps `classifyStoreOutcome` free to treat every
      // crypto-layer failure as a fault.
      if (plan.stdin === "none" && !fileExists(plan.blobPath)) {
        return {
          exitCode: null,
          signal: null,
          stdout: new Uint8Array(),
          stderr: "",
          absenceSignalled: true,
        };
      }

      try {
        const stdout = execFileSync(plan.argv[0]!, plan.argv.slice(1), {
          input: stdin ? Buffer.from(stdin) : undefined,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          // stdio must NOT inherit: a child that inherits this process's stderr
          // could interleave its diagnostics into our logs, and inheriting stdin
          // would hand it whatever the daemon's stdin happens to be.
          stdio: ["pipe", "pipe", "pipe"],
        });
        return {
          exitCode: 0,
          signal: null,
          stdout: new Uint8Array(stdout),
          stderr: "",
          absenceSignalled: false,
        };
      } catch (err) {
        // A non-zero exit throws here. That is NOT an error condition to swallow —
        // it is the script's deliberate report (exit 3 locked, exit 4 already
        // present), and the classifier needs the raw numbers.
        if (!isExecError(err)) {
          return {
            exitCode: null, signal: null, stdout: new Uint8Array(),
            stderr: String(err), absenceSignalled: false,
          };
        }
        return {
          exitCode: typeof err.status === "number" ? err.status : null,
          signal: err.signal ?? null,
          stdout: err.stdout ? new Uint8Array(err.stdout) : new Uint8Array(),
          stderr: (err.stderr ? err.stderr.toString() : "") || err.message || "",
          absenceSignalled: false,
        };
      }
    },
  };
}
