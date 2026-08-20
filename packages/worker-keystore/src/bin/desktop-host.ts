// packages/worker-keystore/src/bin/desktop-host.ts
//
// DSK-001 — the composition host. THE ONLY FILE IN THE REPO THAT NAMES BOTH
// `@armyofagents/worker-daemon` AND this package's OS custody.
//
// That is the whole point of the arrangement. `scripts/check-worker-daemon-boundary.mjs`
// walks `packages/worker-daemon/src` and rejects a bare specifier the moment a
// file there names something outside the two-dependency pin — so the daemon
// declares the custody SHAPE and this file supplies an implementation. The
// dependency arrow points keystore → daemon and never back.
//
// **This is a developer host, not a product.** DSK-003 owns packaging, signing,
// notarization, autostart and uninstall. What this provides is a real production
// consumer for the adapter, so the custody path is exercised by something other
// than a test.
//
// It also owns the ONLY caller of `clear()`. Wiping a device identity is
// irreversible in the way that matters: the server denies a re-minted identity
// permanently and `findWorkerForBinding` has no status predicate, so a wipe that
// happens by accident is a machine that can never enrol again. It is therefore a
// deliberate, explicitly-named subcommand and never part of a normal boot.

import {
  bootstrapWorkerDaemon,
  type BootstrapResult,
  type ProcessLike,
} from "@armyofagents/worker-daemon";

import { resolveVaultRefs } from "../blob-path.js";
import { createCommandRunner } from "../command-runner.js";
import { createOsRecordStore, type CommandRunner } from "../identity-store.js";
import { decodeIdentityEnvelope, encodeIdentityEnvelope } from "../envelope.js";
import { decodeEnrollmentReceipt, encodeEnrollmentReceipt } from "../receipt-envelope.js";

/** The subcommand that wipes a device identity. Deliberately verbose. */
export const RESET_IDENTITY_FLAG = "--reset-identity";

export interface DesktopHostDeps {
  readonly env: Record<string, string | undefined>;
  readonly proc: ProcessLike;
  readonly platform: NodeJS.Platform | string;
  readonly argv: readonly string[];
  readonly createRunner?: () => CommandRunner;
  readonly bootstrap?: typeof bootstrapWorkerDaemon;
  readonly log?: (message: string) => void;
}

export async function runDesktopHost(deps: DesktopHostDeps): Promise<{ ok: boolean }> {
  const log = deps.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const runner = (deps.createRunner ?? (() => createCommandRunner()))();
  const bootstrap = deps.bootstrap ?? bootstrapWorkerDaemon;

  let refs;
  try {
    refs = resolveVaultRefs(deps.env, deps.platform);
  } catch (err) {
    // A location we cannot resolve is a refusal, never a guess: guessing is how a
    // device ends up with a second identity in a second place.
    log(`desktop host: ${(err as Error).message}`);
    deps.proc.exit(1);
    return { ok: false };
  }

  const identityStore = createOsRecordStore({
    runner,
    ref: refs.identity,
    platform: deps.platform,
    codec: { encode: encodeIdentityEnvelope, decode: decodeIdentityEnvelope },
  });
  const receiptStore = createOsRecordStore({
    runner,
    ref: refs.receipt,
    platform: deps.platform,
    codec: { encode: encodeEnrollmentReceipt, decode: decodeEnrollmentReceipt },
  });

  // The ONLY `clear()` caller, behind an explicit subcommand.
  //
  // The receipt is cleared FIRST and the identity SECOND. That order matters: if
  // the process dies between them, the device is left holding an identity with no
  // receipt, which the coordinator treats as "enrolled but unconfirmed" and can
  // retry. The reverse order would leave a receipt with no identity — a state
  // claiming an enrolment whose key is gone, which nothing can recover.
  if (deps.argv.includes(RESET_IDENTITY_FLAG)) {
    try {
      receiptStore.clear();
      identityStore.clear();
    } catch (err) {
      // A failed wipe must not report success: a half-wiped device that reports
      // "reset" is worse than one that reports a failure an operator can act on.
      log(`desktop host: identity reset FAILED: ${(err as Error).message}`);
      deps.proc.exit(1);
      return { ok: false };
    }
    log("desktop host: device identity reset; the next start will enrol afresh");
    return { ok: true };
  }

  const result: BootstrapResult = await bootstrap({
    env: deps.env,
    proc: deps.proc,
    identityStore,
    receiptStore,
  } as never);

  return { ok: result.ok };
}
