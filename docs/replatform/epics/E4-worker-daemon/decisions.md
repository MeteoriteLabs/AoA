# E4 Worker daemon — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

## E4-D10 — Device-key custody and target scope are orthogonal; the worker enforces no config-load coupling

**Date:** 2026-08-12 · **Ticket:** WRK-001 · **Status:** locked.

The WRK-001 implementation plan listed "an inconsistent trust/scope combination
throws in `loadWorkerConfig`" as a failure mode but never defined the coupling.
An initial implementation invented `os_keychain ⟹ owner` and `mounted_secret ⇏
owner` — which the WRK-001 adversarial review (finding S3) showed contradicts the
authoritative model:

- worker-enrollment **scope** is a property of the enrollment CODE (`server/src/
  services/worker-enrollment.ts` — `scope: "organization" | "owner"`), validated
  by the control plane at enrollment/placement;
- `execution_targets` scope is defined purely by organization/owner nullability;
- `workerPlatformSchema` (`packages/worker-protocol/src/capabilities.ts`) carries
  **no** key-custody dimension.

**Decision:** `keyStoreMode` (device-key CUSTODY, a deployment-mode property) and
`targetScope` are ORTHOGONAL. `loadWorkerConfig` validates each field
independently against its own closed enum and enforces **no** custody↔scope
coupling. Every combination (e.g. a desktop `os_keychain` worker enrolling under
`organization` scope, or a container `mounted_secret` worker under `owner` scope)
is accepted at config load; scope validity remains the control plane's
responsibility. Plan §3 step 5 makes a scope-model contradiction a STOP; this
decision resolves it. Enforced by `config.ts` and the rewritten
`config.test.ts` / `config-matrix.test.ts` cases.
