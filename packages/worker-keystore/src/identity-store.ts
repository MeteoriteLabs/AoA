// packages/worker-keystore/src/identity-store.ts
//
// DSK-001 (D5, I2, I4) — the command-driven device identity store.
//
// This is where the classifier's six outcomes become behaviour. It holds no OS
// code itself: the `CommandRunner` is injected, so every invariant below is
// provable on the ubuntu-only REQUIRED lane. `command-runner.ts` is the single
// file in this package permitted to import `node:child_process` (D2), and it is
// mechanically confined by `scripts/check-worker-keystore-boundary.mjs` rather
// than by review.
//
// The store is SYNCHRONOUS because the port it ultimately satisfies is:
// `DeviceKeyStore.load(): DeviceKey | null`
// (`packages/worker-daemon/src/identity/key-store.ts:32-40`).
//
// I2 — every outcome other than `present`/`absent` throws `DeviceKeyStoreError`.
//      `load()` never returns a key it could not authenticate, and never returns
//      `null` for a fault. `null` means NEVER ENROLLED to `loadOrCreateKey`
//      (`enrollment/enroll.ts:131-136`), which mints a fresh key and enrols a new
//      identity the server refuses forever.
//
// I4 — `saveIfAbsent` is compare-and-set, resolved by the OS via an exclusive
//      `CreateNew` open rather than by a check-then-act this code would have to
//      win. Two racing enrollers therefore yield exactly one surviving envelope.

import { classifyStoreOutcome, type StoreCommandResult } from "./outcome.js";
import { planVaultCommand, type VaultCommandPlan, type VaultRef } from "./command-plan.js";
import { decodeIdentityEnvelope, encodeIdentityEnvelope, type DeviceIdentityRecord } from "./envelope.js";

/**
 * Mirrors `DeviceKeyStoreError` from the worker-daemon port by NAME rather than
 * by import, so this package does not drag the daemon's module graph into a pure
 * unit test. The daemon's fail-closed handling keys on the name.
 */
export class DeviceKeyStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceKeyStoreError";
  }
}

/** Runs one planned command. The ONLY seam through which an OS call happens. */
export interface CommandRunner {
  run(plan: VaultCommandPlan, stdin?: Uint8Array): StoreCommandResult;
}

export interface DeviceIdentityStore {
  /** The stored identity, or `null` ONLY when the platform signalled absence. */
  load(): DeviceIdentityRecord | null;
  /** Compare-and-set. `already_present` means someone else won the race. */
  saveIfAbsent(record: DeviceIdentityRecord): "stored" | "already_present";
  /** Remove any stored identity. Throws on a fault — a failed wipe is not success. */
  clear(): void;
}

/** Base64 without depending on Node's Buffer, so the module stays runtime-neutral. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function createOsIdentityStore(deps: {
  runner: CommandRunner;
  ref: VaultRef;
  platform: NodeJS.Platform | string;
}): DeviceIdentityStore {
  const { runner, ref, platform } = deps;

  return {
    load() {
      const outcome = classifyStoreOutcome(runner.run(planVaultCommand("load", ref, platform)));
      switch (outcome.kind) {
        case "absent":
          // The ONLY route to null. Everything below is a fault.
          return null;
        case "present":
          break;
        default:
          // I2. Softening any of these to `null` is the lockout bug.
          throw new DeviceKeyStoreError(
            `device identity store unusable (${outcome.kind}): ${outcome.detail}`,
          );
      }

      // The envelope arrived authenticated by the OS; it must still be a complete
      // record. A decode failure is a FAULT, never absence (I6).
      try {
        return decodeIdentityEnvelope(fromBase64(new TextDecoder().decode(outcome.envelope)));
      } catch (err) {
        throw new DeviceKeyStoreError(
          `device identity envelope is unusable: ${(err as Error).message}`,
        );
      }
    },

    saveIfAbsent(record) {
      const plan = planVaultCommand("store", ref, platform);
      // The record crosses STDIN (I5). `planVaultCommand` never sees it, so it
      // cannot appear in argv where a same-user process listing would read it.
      const stdin = new TextEncoder().encode(toBase64(encodeIdentityEnvelope(record)));
      const result = runner.run(plan, stdin);

      // The exclusive-create refusal is a DISTINCT exit code, checked before the
      // generic classification: "someone else got here first" is a normal race
      // outcome, while every other non-zero exit is a genuine fault that must
      // throw. Conflating them would silently drop an enrollment and leave the
      // device unenrolled while reporting success.
      if (result.exitCode === plan.exitCodes.alreadyExists) return "already_present";

      const outcome = classifyStoreOutcome(result);
      if (outcome.kind === "present") return "stored";
      // `store` writes nothing to stdout, so a clean success classifies as
      // `corrupt` ("success but no envelope bytes") — expected here, and the one
      // place that shape is legitimate.
      if (outcome.kind === "corrupt" && result.exitCode === plan.exitCodes.ok) return "stored";
      throw new DeviceKeyStoreError(
        `device identity store could not save (${outcome.kind}): ` +
          ("detail" in outcome ? outcome.detail : ""),
      );
    },

    clear() {
      const plan = planVaultCommand("delete", ref, platform);
      const result = runner.run(plan);
      const outcome = classifyStoreOutcome(result);
      // Deleting what is not there is success, not a fault.
      if (outcome.kind === "absent") return;
      if (outcome.kind === "present") return;
      if (outcome.kind === "corrupt" && result.exitCode === plan.exitCodes.ok) return;
      throw new DeviceKeyStoreError(
        `device identity store could not clear (${outcome.kind}): ` +
          ("detail" in outcome ? outcome.detail : ""),
      );
    },
  };
}
