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
// deliberate, explicitly-named subcommand, never part of a normal boot, and
// GUARDED — it names the identity it would destroy, states the permanence, and
// requires a second acknowledgement argument unless the slot is provably empty.

import {
  bootstrapWorkerDaemon,
  type BootstrapResult,
  type ProcessLike,
} from "@armyofagents/worker-daemon";

import { resolveVaultRefs } from "../blob-path.js";
import { createCommandRunner } from "../command-runner.js";
import { createOsRecordStore, type CommandRunner } from "../identity-store.js";
import {
  decodeIdentityEnvelope,
  encodeIdentityEnvelope,
  type DeviceIdentityRecord,
} from "../envelope.js";
import { decodeEnrollmentReceipt, encodeEnrollmentReceipt } from "../receipt-envelope.js";

/** The subcommand that wipes a device identity. Deliberately verbose.
 *
 * DECLARED IN `desktop-invocation.ts` and re-exported here. Which argv means what is
 * a ROUTING concern, and the router must test for this flag; two declarations of the
 * same flag are two things to keep in step, which is the drift argued against for the
 * acknowledgement flag. Re-exported so every existing importer is unaffected. */
import { RESET_IDENTITY_FLAG } from "./desktop-invocation.js";

// Re-exported so every existing importer of this module is unaffected by the move.
export { RESET_IDENTITY_FLAG };

/**
 * The second argument the wipe requires (plan §3/I7 point 4).
 *
 * Long and unpleasant to type ON PURPOSE. `--reset-identity` is what an operator
 * reaches for when a start fails, and on the same target the reset IS the
 * permanent lockout: the server denies the re-minted `workerId` as
 * `worker_transfer_denied` (`worker-enrollment.ts:418-423`) and
 * `findWorkerForBinding` carries no status predicate, so the stale row keeps
 * matching forever with no reset route. A one-argument path to that is a trap.
 */
export const RESET_ACKNOWLEDGEMENT_FLAG = "--i-understand-this-is-permanent";

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

  // The ONLY `clear()` caller, behind an explicit, guarded subcommand.
  if (deps.argv.includes(RESET_IDENTITY_FLAG)) {
    // Read what is about to be destroyed BEFORE destroying it. A warning that
    // cannot name the identity is a warning an operator clicks through.
    let identity: DeviceIdentityRecord | null = null;
    let unreadable: string | null = null;
    try {
      identity = identityStore.load();
    } catch (err) {
      // A NARROW catch, and the reason it is safe here does NOT generalize.
      // `identity-store.ts` warns that the fail-closed property of a store fault
      // comes entirely from the throw being uncaught — nothing checks
      // `err.name` — so a broad catch around the ENROLLER would silently
      // reinstate the mint-a-second-identity bug (I3). This branch never mints,
      // never reaches the network, and turns the fault into a REFUSAL rather
      // than into a "no key" verdict. It is the strictest possible reading of
      // the failure, not a softening of it.
      unreadable = (err as Error).message;
    }

    // The one relaxation, and it rests on the single signal this package trusts:
    // `absent` arrives only through the platform's own ENOENT oracle and is never
    // inferred. With nothing stored there is provably nothing to make
    // unenrollable, and demanding the acknowledgement here would train operators
    // to paste it reflexively — which is how a guard stops being one.
    //
    // DEFERRED, deliberately: plan §3/I7 point 4 also relaxes for a G2(ii) crash
    // (identity slot PRESENT but zero-length, receipt absent). That state is not
    // distinguishable with the current outcome vocabulary — `ReadAllBytes` on a
    // zero-length blob yields an empty array, `Unprotect` throws, `harden` reports
    // exit 3, and the classifier says `locked`, exactly as it does for a genuinely
    // locked or ACL-denied slot holding a PERFECTLY GOOD key. Relaxing on `locked`
    // would drop the guard precisely where the lockout is real. Splitting the
    // vocabulary would take a distinct empty-slot exit code; that buys only a
    // friendlier message in one bricked state and is not worth a seventh outcome
    // kind on the package's most dangerous decision.
    const provablyAbsent = identity === null && unreadable === null;

    if (!provablyAbsent && !deps.argv.includes(RESET_ACKNOWLEDGEMENT_FLAG)) {
      const subject = identity
        ? `identity: workerId=${identity.workerId} targetId=${identity.targetId}`
        : `the identity slot could not be read (${unreadable}) — it may hold a working enrolment`;
      log(
        [
          "desktop host: REFUSING to reset the device identity. This is PERMANENT.",
          `  ${subject}`,
          "  Wiping the local key does NOT un-enrol this device. The server keeps the",
          "  worker bound to its target, denies any re-minted identity as",
          "  worker_transfer_denied, and the bound row keeps matching with no reset",
          "  route — so this machine can never enrol against that target again.",
          "  If a start is failing and an identity is present, do NOT reset: repair",
          "  the store or the OS profile instead.",
          `  To proceed anyway: ${RESET_IDENTITY_FLAG} ${RESET_ACKNOWLEDGEMENT_FLAG}`,
        ].join("\n"),
      );
      deps.proc.exit(1);
      return { ok: false };
    }

    // The receipt is cleared FIRST and the identity SECOND. That order matters: if
    // the process dies between them, the device is left holding an identity with no
    // receipt, which the coordinator treats as "enrolled but unconfirmed" and can
    // retry. The reverse order would leave a receipt with no identity — a state
    // claiming an enrolment whose key is gone, which nothing can recover.
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
    log(
      provablyAbsent
        ? "desktop host: no device identity was stored; cleared any leftover enrollment receipt"
        : `desktop host: device identity reset${
            identity ? ` (workerId=${identity.workerId} targetId=${identity.targetId})` : ""
          }; this machine can no longer enrol against that target`,
    );
    return { ok: true };
  }

  // NO CAST. An earlier version wrote `as never` here, which erased a genuine
  // record-shape mismatch: the keystore's identity record was missing `v`,
  // `targetId` and `deviceGeneration`. The compiler had been reporting exactly
  // that and the cast silenced it. Keeping this call uncast makes the
  // type-checker the standing guard against the two shapes diverging again.
  const result: BootstrapResult = await bootstrap({
    env: deps.env,
    proc: deps.proc,
    identityStore,
    receiptStore,
  });

  return { ok: result.ok };
}
