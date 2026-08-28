# DEP-012 — adapter-manager: the out-of-process networked provider host

**Epic:** E6 · **Plan node:** `docs/replatform/program-design.md`, `#### DEP-012`
**Depends on:** DEP-010 · **Size:** (scope only) · **Status:** scoping
**Contract of record:** [`qa/2026-08-28-adapter-manager-scope.md`](../../../qa/2026-08-28-adapter-manager-scope.md) §8 (the SETTLED provider-topology decision — credential=(i), out-of-process, redacted-projection wire, no streaming slice, durable idempotency ledger)
**Seam partner:** DEP-011 (the worker-side networked driver — one seam, two ends)

---

## Why this ticket exists

The chain's seventh link (`WAVE-4-RESEQUENCE.md` §3.7): the real `E2bSandboxProvider` **may not run
in the worker container**. This is not a design preference — it is machine-enforced.
`scripts/lib/staging-manifest-invariants.mjs` `checkProviderControlBoundary` (`:436`) requires
`E2B_API_KEY` (`PROVIDER_CONTROL_CRED_ENV`, `:120`) and `provider-ctl-net` membership to be EXACTLY
the `adapter-manager` service (`ADAPTER_MANAGER_SERVICE`, `:29`), and forbids that credential on
every other surface across `environment`/`env_file`/`secrets`/`configs`/mounts. So the containerized
worker's `deps.provider` must be a **networked driver** (DEP-011) that RPCs each op to a separate host
that holds the key — `adapter-manager`.

`docker-compose.staging.yml:316` DECLARES that service (image `aoa-adapter-manager:staging`, `:317`;
`E2B_API_KEY` injected, `:322`; on `provider-ctl-net`, `:345`) — but **no build produces that image.**
There is no source directory, no Dockerfile, no wire schema, and no worker-side client. It is a
manifest fiction the invariant guards but nothing implements. DEP-011 (the worker-side wire) was filed
as a stub deferred precisely because "specifying a wire against an unimplemented peer for an unbuilt
caller is the failure this programme keeps re-learning" — its peer is this ticket. **adapter-manager
had no owning ticket; this node is it.** DEP-011 is repointed onto it (`Depends on: DEP-010, DEP-012`).

## What it must build (design written at sprint start, against the tree as it exists then)

The [adapter-manager scope](../../../qa/2026-08-28-adapter-manager-scope.md) §2/§6/§8 is the contract:
a new **server** that hosts `new E2bSandboxProvider({ transport })` (the same authoritative per-op
`SandboxProvider` port DEP-010 named — this is the desktop in-process construction moved across a
process boundary), holds `E2B_API_KEY`, listens on `control-net`, and exposes `/healthz` + mutual-auth
+ peer-allowlist. Its non-frozen wire (NOT in `worker-protocol`) serves the 11 `PROVIDER_OPERATIONS`
unchanged. Settled in §8, do not relitigate: the credential crossing is **(i)** (worker redeems, sends
the bearer over the mutually-authenticated internal hop); `inspect`/`list` cross as **redacted
projections only** (the full `InspectResult` never crosses — the F2 wire rule); there is **no streaming
slice** (`execute` is unary/byte-free; live output rides the frozen `event_upload` outbox); a **durable
idempotency ledger** replaces the in-memory `#idempotency` map. Slice plan: §6 (wire+round-trip over
`MockE2bTransport` → real `E2bSandboxProvider`/`RealE2bTransport` → conformance + DEP-008 isolation →
credential crossing → deploy). Conformance reuses `sandbox-provider-contract`.

## Precondition — when this becomes REQUIRED, not before

The moment a containerized worker under `docker-compose.staging.yml` must dispatch to real E2B — i.e.
the Tier-0 BUILD step of the worker-dispatch chain, AFTER the earlier links are built (WAVE-4-RESEQUENCE
§5: container identity → session → matchable hello → self-model → loop composition, most of which are
now owned; see [`qa/2026-08-28-worker-dispatch-chain-reconciled.md`](../../../qa/2026-08-28-worker-dispatch-chain-reconciled.md)).
Building Slice 1 before a container can enrol (WRK-014) and before a worker dispatches (flag default-off,
no `compose:true` reachable on a container root) would wire against an unbuilt caller — the same failure
DEP-011 was deferred to avoid. Its per-op fidelity is component-testable earlier (driver ↔ server in an
integration test, scope §8 wire-F5), but the through-the-daemon dispatch belongs to DEP-011/worker-daemon.

## Status

Scoping stub. No design steps and no result doc yet — deliberately. The full design (terrain, TDD steps,
mutation table, acceptance mapping, the 5-slice sequence) is written at sprint start per the go-book's
"write the plan at sprint start" rule; the provider-topology CONTRACT it builds against is already
settled in the adapter-manager scope §8 and is not re-opened here.
