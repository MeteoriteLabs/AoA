// DSK-001 / I3 + I6 + I7 — the enrolment coordinator.
//
// This is the piece whose failure mode is PERMANENT. If a device ever enrols
// under a second identity, the server denies it at BOTH of its denial sites, and
// `findWorkerForBinding` has no status predicate — so the stale row keeps
// matching forever and there is no reset route. Every test below exists because
// some ordering would otherwise produce that.
//
// The proofs are by COUNTING, not by reasoning: `randomWorkerId` and
// `generateKey` are injected spies, so "minted at most once" is an assertion
// about call counts rather than an argument about control flow. No module
// mocking anywhere.

import { describe, expect, it, vi } from "vitest";
import { enrollOnce, type EnrollOnceDeps } from "../enrollment/enroll-once.js";
import { DeviceKeyStoreError } from "../identity/key-store.js";
import { generateDeviceKey, exportDevicePrivateKeyPkcs8Der } from "../identity/device-key.js";
import type { DeviceIdentityRecord, DeviceRecordStore } from "../identity/device-identity-store.js";

const TARGET_ID = "a3000000-0000-4000-8000-000000000003";
const WORKER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CODE = "aoa_enr_" + "A".repeat(22) + "." + "B".repeat(43);

const realKey = generateDeviceKey();
const realDer = exportDevicePrivateKeyPkcs8Der(realKey);

const record = (over: Partial<DeviceIdentityRecord> = {}): DeviceIdentityRecord => ({
  v: 1,
  workerId: WORKER_ID,
  targetId: TARGET_ID,
  deviceGeneration: 1,
  privateKeyPkcs8Der: realDer,
  ...over,
});

/** An in-memory record store with real compare-and-set semantics. */
function memoryStore<T>(initial: T | null = null) {
  let value = initial;
  const store: DeviceRecordStore<T> & { peek: () => T | null } = {
    load: () => value,
    saveIfAbsent: (r: T) => {
      if (value !== null) return "already_present";
      value = r;
      return "stored";
    },
    clear: () => { value = null; },
    peek: () => value,
  };
  return store;
}

function deps(over: Partial<EnrollOnceDeps> = {}): EnrollOnceDeps & {
  randomWorkerId: ReturnType<typeof vi.fn>;
  generateKey: ReturnType<typeof vi.fn>;
  renew: ReturnType<typeof vi.fn>;
} {
  const randomWorkerId = vi.fn(() => WORKER_ID);
  const generateKey = vi.fn(() => realKey);
  const renewSpy = vi.fn(async () => ({
    outcome: "enrolled" as const,
    workerId: WORKER_ID,
    targetId: TARGET_ID,
    deviceGeneration: 1,
    providerConstraints: null,
    session: { token: "SESSION-TOKEN-MUST-NOT-ESCAPE", expiresAt: "2026-01-01T00:00:00.000Z" },
    deviceThumbprint: "tp-1",
    replay: false,
  }));
  return {
    identityStore: memoryStore<DeviceIdentityRecord>(),
    receiptStore: memoryStore(),
    input: { targetId: TARGET_ID, enrollmentCode: CODE },
    client: {} as unknown as EnrollOnceDeps["client"],
    createEnrollerFn: () => ({
      enroll: async () => { throw new Error("enrollOnce must call renew(), never enroll()"); },
      renew: renewSpy,
    }),
    randomWorkerId,
    generateKey,
    renew: renewSpy,
    platform: "win32",
    arch: "x64",
    ...over,
  } as never;
}

describe("DSK-001/I3 — a store that cannot open NEVER produces an identity", () => {
  it("refuses when the identity store throws, with ZERO mints", async () => {
    const d = deps({
      identityStore: {
        load: () => { throw new DeviceKeyStoreError("locked"); },
        saveIfAbsent: () => { throw new Error("must not be reached"); },
        clear: () => {},
      },
    });
    await expect(enrollOnce(d)).rejects.toThrow();
    expect(d.randomWorkerId).not.toHaveBeenCalled();
    expect(d.generateKey).not.toHaveBeenCalled();
  });

  it("never reads the enrollment code when the store faults", async () => {
    // S4a before S4d: a fault-store boot must not materialize a live single-use
    // credential in memory at all.
    const readInput = vi.fn(() => ({ targetId: TARGET_ID, enrollmentCode: CODE }));
    const d = deps({
      identityStore: {
        load: () => { throw new DeviceKeyStoreError("locked"); },
        saveIfAbsent: () => "stored",
        clear: () => {},
      },
      readInput,
    });
    await expect(enrollOnce(d)).rejects.toThrow();
    expect(readInput).not.toHaveBeenCalled();
  });

  it("never contacts the control plane when the store faults", async () => {
    const d = deps({
      identityStore: {
        load: () => { throw new DeviceKeyStoreError("denied"); },
        saveIfAbsent: () => "stored",
        clear: () => {},
      },
    });
    await expect(enrollOnce(d)).rejects.toThrow();
    expect(d.renew).not.toHaveBeenCalled();
  });
});

describe("DSK-001/I7 — minted at most once, proven by counting", () => {
  it("mints exactly once on a first enrolment", async () => {
    const d = deps();
    const out = await enrollOnce(d);
    expect(out.minted).toBe(true);
    expect(d.randomWorkerId).toHaveBeenCalledTimes(1);
    expect(d.generateKey).toHaveBeenCalledTimes(1);
  });

  it("mints ZERO times on the second run — and never contacts the server again", async () => {
    // S4c: after one successful enrolment the device is in steady state. It does
    // not read the code, and it does not call the control plane, ever again.
    const identityStore = memoryStore<DeviceIdentityRecord>();
    const receiptStore = memoryStore();
    const first = deps({ identityStore, receiptStore });
    await enrollOnce(first);

    const second = deps({ identityStore, receiptStore });
    const out = await enrollOnce(second);
    expect(out.skipped).toBe(true);
    expect(second.randomWorkerId).not.toHaveBeenCalled();
    expect(second.generateKey).not.toHaveBeenCalled();
    expect(second.renew).not.toHaveBeenCalled();
  });

  it("keeps the SAME workerId after a FAILED enroll and a restart", async () => {
    // The scenario that motivates the whole ordering: the server rejects, the
    // process restarts, and the device must present the identity it already
    // persisted rather than minting a second one.
    const identityStore = memoryStore<DeviceIdentityRecord>();
    const receiptStore = memoryStore();

    const failing = deps({
      identityStore,
      receiptStore,
      createEnrollerFn: () => ({
        enroll: async () => { throw new Error("never"); },
        renew: async () => { throw new Error("401 unauthorized"); },
      }),
    });
    await expect(enrollOnce(failing)).rejects.toThrow();
    expect(failing.randomWorkerId).toHaveBeenCalledTimes(1);
    const persisted = identityStore.peek();
    expect(persisted).not.toBeNull();

    const retry = deps({ identityStore, receiptStore });
    const out = await enrollOnce(retry);
    expect(retry.randomWorkerId).not.toHaveBeenCalled();
    expect(retry.generateKey).not.toHaveBeenCalled();
    expect(out.workerId).toBe(persisted!.workerId);
  });

  it("adopts the WINNER's record when the CAS is lost, never a second identity", async () => {
    // S4f: the loser discards what it minted and reloads the winner's COMPLETE
    // record — workerId and key together — so two processes never present two
    // identities.
    const winner = record({ workerId: "11111111-1111-4111-8111-111111111111" });
    const identityStore: DeviceRecordStore<DeviceIdentityRecord> = {
      load: vi.fn()
        .mockReturnValueOnce(null)      // first look: nothing yet
        .mockReturnValue(winner),        // after the lost CAS: the winner's record
      saveIfAbsent: () => "already_present",
      clear: () => {},
    };
    const d = deps({ identityStore });
    const out = await enrollOnce(d);
    expect(out.minted).toBe(false);
    expect(out.workerId).toBe(winner.workerId);
  });

  it("THROWS rather than re-minting when a lost CAS is followed by an empty load", async () => {
    // A contradiction — the store said "already present" and then produced
    // nothing. Re-minting here is the lockout; refusing is recoverable.
    const identityStore: DeviceRecordStore<DeviceIdentityRecord> = {
      load: () => null,
      saveIfAbsent: () => "already_present",
      clear: () => {},
    };
    const d = deps({ identityStore });
    await expect(enrollOnce(d)).rejects.toThrow();
    expect(d.randomWorkerId).toHaveBeenCalledTimes(1); // minted once, then discarded
  });
});

describe("DSK-001 — the enroller is handed a view that cannot mint", () => {
  it("never calls generateDeviceKey inside the enroller, even on a fresh device", async () => {
    // `loadOrCreateKey` mints whenever the store returns null. The coordinator
    // resolves the key itself and passes a FROZEN view whose load() always
    // answers, so that branch is unreachable — I3 by construction, not by luck.
    const d = deps();
    await enrollOnce(d);
    expect(d.generateKey).toHaveBeenCalledTimes(1); // the coordinator's own mint, not the enroller's
  });
});

describe("DSK-001/I13 — the session token never escapes", () => {
  it("is absent from the outcome entirely", async () => {
    const out = await enrollOnce(deps());
    expect(JSON.stringify(out)).not.toContain("SESSION-TOKEN-MUST-NOT-ESCAPE");
    expect(Object.keys(out)).not.toContain("session");
    expect(Object.keys(out)).not.toContain("token");
  });

  it("returns a frozen object with a fixed key allowlist", async () => {
    const out = await enrollOnce(deps());
    expect(Object.isFrozen(out)).toBe(true);
    for (const key of Object.keys(out)) {
      expect([
        "enrolled", "minted", "skipped", "workerId", "targetId",
        "deviceGeneration", "deviceThumbprint",
      ]).toContain(key);
    }
  });
});

describe("DSK-001 — a target mismatch is refused, not silently re-enrolled", () => {
  it("refuses when the persisted identity belongs to a different target", async () => {
    const identityStore = memoryStore<DeviceIdentityRecord>(
      record({ targetId: "b3000000-0000-4000-8000-000000000009" }),
    );
    const d = deps({ identityStore });
    await expect(enrollOnce(d)).rejects.toThrow(/target/i);
    expect(d.randomWorkerId).not.toHaveBeenCalled();
  });
});
