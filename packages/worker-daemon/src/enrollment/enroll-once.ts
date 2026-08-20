// packages/worker-daemon/src/enrollment/enroll-once.ts
//
// DSK-001 — the enrolment coordinator (I3, I6, I7, I13).
//
// This is the piece whose failure mode is PERMANENT. If a device ever enrols
// under a second identity the server denies it at BOTH of its denial sites
// (`worker-enrollment.ts:418-423` for a bound worker, `:453-458` for a globally
// known workerId), and `findWorkerForBinding` filters on
// scope / target / organization / owner with NO status predicate — so even the
// revoked row keeps matching forever and there is no reset route.
//
// FIVE ORDERINGS ARE LOAD-BEARING, and four are inversions of the obvious:
//
//  1. The store verdict precedes any read of the ticket. A fault-store boot must
//     never materialize a live single-use credential in memory — and, with the
//     reader's non-local-path rejection, must perform no file or network I/O for
//     it either.
//  2. A device already holding BOTH an identity and a receipt short-circuits
//     before reading the ticket. After one successful enrolment the device never
//     reads the code and never contacts the control plane again, which makes the
//     ten-minute code TTL, the rebind rule and the retry traps all unreachable on
//     the ordinary boot path.
//  3. PERSIST STRICTLY BEFORE THE NETWORK CALL. The mint-then-enrol-then-persist
//     shape is the lockout generator: crash after the server commits but before
//     the persist, and the next boot mints a second workerId that is denied
//     forever.
//  4. A lost compare-and-set DISCARDS what this process minted and adopts the
//     winner's COMPLETE record — workerId and key together — so two processes
//     never present two identities.
//  5. The key is re-derived from the PERSISTED bytes even on the freshly-minted
//     path, so both paths run identical code and an envelope round-trip bug
//     surfaces on the first run, before the server has committed anything.
//
// AND IT CALLS `renew()`, NOT `enroll()`. `enroll()` mints a fresh idempotency
// key per call (`enroll.ts:230`) and only RETURNS it — nothing persists it — so a
// lost response across a restart hits
// `stored.semanticIdempotencyKey !== request.idempotencyKey`
// (`worker-enrollment.ts:325-327`) and becomes a terminal 400 on a code that can
// never be re-consumed. `renew()` accepts a caller-supplied key and `submit`
// builds a byte-identical body either way; the server decides fresh-vs-replay
// from `consumedAt`.

import { createEnroller, type Enroller } from "./enroll.js";
import type { ControlPlaneClient } from "../transport/client.js";
import { buildDesktopHello } from "./desktop-hello.js";
import { deriveEnrollmentIdempotencyKey } from "./idempotency.js";
import type { EnrollmentInput } from "./enrollment-input.js";
import {
  deviceKeyFromPkcs8Der,
  exportDevicePrivateKeyPkcs8Der,
  generateDeviceKey,
  type DeviceKey,
} from "../identity/device-key.js";
import {
  frozenDeviceKeyView,
  type DeviceEnrollmentReceipt,
  type DeviceIdentityRecord,
  type DeviceRecordStore,
} from "../identity/device-identity-store.js";

export class EnrollOnceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrollOnceError";
  }
}

export interface EnrollOnceDeps {
  readonly identityStore: DeviceRecordStore<DeviceIdentityRecord>;
  readonly receiptStore: DeviceRecordStore<DeviceEnrollmentReceipt>;
  readonly client: ControlPlaneClient;
  /** Already-resolved ticket, or a reader invoked only when one is needed. */
  readonly input?: EnrollmentInput;
  readonly readInput?: () => EnrollmentInput;
  readonly platform: string;
  readonly arch: string;
  /** Injected SPECIFICALLY so mint-once is proven by counting calls (I7). */
  readonly randomWorkerId?: () => string;
  readonly generateKey?: () => DeviceKey;
  /**
   * Injected so the coordinator's ordering can be tested without standing up a
   * fake HTTP control plane. The no-mint property it relies on is proven
   * separately and directly against `frozenDeviceKeyView`, which is pure — so
   * injecting here does not weaken I3.
   */
  readonly createEnrollerFn?: (deps: { keyStore: ReturnType<typeof frozenDeviceKeyView>; client: ControlPlaneClient }) => Enroller;
}

/**
 * The outcome. A frozen object with a fixed key allowlist and NO session or token
 * key — I13. `EnrollResult` is a plain object literal containing `session.token`,
 * so a single `logger.info({ result })` would put a live bearer token in the
 * logs. Nothing downstream can log what it never receives.
 */
export interface EnrollmentOutcome {
  readonly enrolled: boolean;
  readonly minted: boolean;
  readonly skipped: boolean;
  readonly workerId: string;
  readonly targetId: string;
  readonly deviceGeneration: number;
  readonly deviceThumbprint?: string;
}

const FIRST_GENERATION = 1;

export async function enrollOnce(deps: EnrollOnceDeps): Promise<EnrollmentOutcome> {
  const randomWorkerId = deps.randomWorkerId ?? (() => crypto.randomUUID());
  const generateKey = deps.generateKey ?? generateDeviceKey;

  // (1) THE STORE VERDICT FIRST. A throw here is fatal and deliberate: zero
  // mints, and the ticket is still unread.
  let identity = deps.identityStore.load();
  const receipt = deps.receiptStore.load();

  // (2) Steady state. No ticket read, no network — ever again.
  if (identity && receipt) {
    return Object.freeze({
      enrolled: true,
      minted: false,
      skipped: true,
      workerId: receipt.workerId,
      targetId: receipt.targetId,
      deviceGeneration: receipt.deviceGeneration,
      deviceThumbprint: receipt.deviceThumbprint,
    });
  }

  // (3) Only now does a live credential enter memory.
  const input = deps.input ?? deps.readInput?.();
  if (!input) throw new EnrollOnceError("no enrollment input available");

  // (4) A persisted identity for a DIFFERENT target is a refusal, never a
  // re-enrolment: re-minting here would be the lockout, and silently enrolling
  // the old identity against a new target would misattribute the device.
  if (identity && identity.targetId !== input.targetId) {
    throw new EnrollOnceError(
      "persisted identity belongs to a different target; refusing to re-enrol",
    );
  }

  let minted = false;
  if (identity === null) {
    const workerId = randomWorkerId();
    const key = generateKey();
    const candidate: DeviceIdentityRecord = {
      v: 1,
      workerId,
      targetId: input.targetId,
      deviceGeneration: FIRST_GENERATION,
      privateKeyPkcs8Der: exportDevicePrivateKeyPkcs8Der(key),
    };

    // THE DURABILITY POINT — strictly before the network call.
    if (deps.identityStore.saveIfAbsent(candidate) === "stored") {
      identity = candidate;
      minted = true;
    } else {
      // Lost the race. DISCARD what we minted and adopt the winner's complete
      // record. Never reuse the local candidate: that is how two identities
      // reach the server.
      identity = deps.identityStore.load();
      if (identity === null) {
        // The store said "already present" and then produced nothing. Minting
        // again here is the permanent lockout; refusing is recoverable.
        throw new EnrollOnceError(
          "identity store reported an existing record but returned none; refusing to mint again",
        );
      }
      minted = false;
    }
  }

  // (5) Re-derive from the PERSISTED bytes on both paths, so a round-trip bug
  // surfaces on the first run rather than after the server has committed.
  const key = deviceKeyFromPkcs8Der(identity.privateKeyPkcs8Der);

  const hello = buildDesktopHello({
    workerId: identity.workerId,
    targetId: identity.targetId,
    deviceGeneration: identity.deviceGeneration,
    platform: deps.platform,
    arch: deps.arch,
  });
  const idempotencyKey = deriveEnrollmentIdempotencyKey(
    identity.workerId,
    identity.targetId,
    identity.deviceGeneration,
  );

  // THE NETWORK POINT. `renew`, not `enroll` — see the header note.
  const makeEnroller = deps.createEnrollerFn ?? createEnroller;
  const enroller = makeEnroller({ keyStore: frozenDeviceKeyView(key), client: deps.client });
  const result = await enroller.renew({
    hello,
    code: input.enrollmentCode,
    idempotencyKey,
  });

  deps.receiptStore.saveIfAbsent({
    v: 1,
    workerId: identity.workerId,
    targetId: identity.targetId,
    deviceGeneration: identity.deviceGeneration,
    deviceThumbprint: result.deviceThumbprint,
  });

  // `result.session` is dropped here and never returned (I13).
  return Object.freeze({
    enrolled: true,
    minted,
    skipped: false,
    workerId: identity.workerId,
    targetId: identity.targetId,
    deviceGeneration: identity.deviceGeneration,
    deviceThumbprint: result.deviceThumbprint,
  });
}
