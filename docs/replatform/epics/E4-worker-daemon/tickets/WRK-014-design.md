# WRK-014 — Container device identity: a `mounted_secret` custody key-load + enrolment path

**Epic:** E4 · **Plan node:** `docs/replatform/program-design.md`, `#### WRK-014`
**Depends on:** WRK-002 · **Size:** (scope only) · **Status:** scoping
**Terrain of record:** [`WAVE-4-RESEQUENCE.md`](../../../WAVE-4-RESEQUENCE.md) §3.1 · [`SPIKE-worker-walking-skeleton.md`](../../../SPIKE-worker-walking-skeleton.md) F1
**Reconciliation:** [`qa/2026-08-28-worker-dispatch-chain-reconciled.md`](../../../qa/2026-08-28-worker-dispatch-chain-reconciled.md) (link 3.1 — confirmed STILL unowned at tip)

---

## Why this ticket exists

The chain's first BUILD link, and the hard gate on every later one (WAVE-4-RESEQUENCE §5 step 2). A
shipped **container** worker holds **no device identity and no key** — re-verified from source at tip:

- `MountedSecretKeyStore` (`packages/worker-daemon/src/identity/key-store.ts:61`) has **zero production
  constructors** — every `new MountedSecretKeyStore(...)` is under `__tests__/` (`key-store.test.ts`,
  `key-store-corrupt.test.ts`). The `mounted_secret` mode has no runtime key-**load** path.
- The only production `DeviceRecordStore` is `createOsRecordStore`
  (`packages/worker-keystore/src/identity-store.ts:114`), injected only by `desktop-host.ts:133,139`.
  The worker image (`docker/worker/Dockerfile`, runtime closure = `worker-daemon + worker-protocol +
  pino`, line 6) **never copies `worker-keystore`** and runs `node dist/bin/worker-daemon.js` (`:112`).
- `bin/worker-daemon.ts` boots in `mounted_secret` (every deployed compose file uses it, `:281`); the
  enrolment block is gated `config.keyStoreMode === "os_keychain" && deps.identityStore &&
  deps.receiptStore` (`:304`), so a container **never enters it** — no enrolment, no `generateDeviceKey`,
  no identity. `resolveCustody("mounted_secret", undefined, undefined)` passes only because the mode is
  a config label with no custody behind it (WAVE-4-RESEQUENCE §3.1: "a config label whose only runtime
  effect is passing `resolveCustody`").

No ticket owns giving a container an identity: WRK-002/DSK-001..004/WRK-008/010/011 all compose ON TOP
of an existing `os_keychain` identity. Without this, nothing downstream can run — enrolment input (3.2),
session (3.3), hello (3.4) and the composed loop (3.6) are all reachable only once a container has a key.

## What it must build (design written at sprint start, against the tree as it exists then)

A production `mounted_secret` custody path: construct/inject the `MountedSecretKeyStore` (or the
equivalent container `DeviceRecordStore`) from the mounted-secret material at boot, and reach the
enrolment path from a container root — so a first-boot container generates/loads its device key and a
`DeviceIdentityRecord`, and a re-boot re-loads it. Must preserve the I11 custody-verdict split
(pre-socket) and the I13 session-drop (until the enrolment sink, WRK-010 slice 2). The exact seam
(a `sandbox-provider.ts`-style container host that injects stores into `bootstrapWorkerDaemon`, vs a
`mounted_secret` branch inside the bin) is a design decision for sprint start; note `bin/worker-daemon.ts`
has no store resolver today (DEP-010 wired only the desktop lane), so a container root or a bin branch
is net-new.

## Precondition — when this becomes REQUIRED, not before

It is the FIRST build of the live-worker-dispatch chain the E7-1 cloud campaign needs (WAVE-4-RESEQUENCE
§5). Required before the campaign; not before, because the downstream links are already composed behind
the default-off flag and only get EXERCISED for real once a container can enrol. Blocks nothing shipped
today (the flag is off; the legacy in-process path is unaffected).

## Status

Scoping stub. No design steps and no result doc yet — deliberately. Filed so the dependency graph can
SEE the chain's hard gate (it was invisible: no ticket, no node — WAVE-4-RESEQUENCE §4). Its full design
is written at sprint start per the go-book rule.
