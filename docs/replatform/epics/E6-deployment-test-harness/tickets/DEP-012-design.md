# DEP-012 — adapter-manager: the out-of-process networked provider host

**Epic:** E6 · **Plan node:** `docs/replatform/program-design.md`, `#### DEP-012`
**Depends on:** DEP-010 · **Size:** L (sliced; Slice 1 · Unit A first) · **Status:** Slice 1 · Unit A design (2026-08-28, post-recon @ `0e4834a27`; 4-agent adversarial review applied — §S1.10)
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

---

# Slice 1 — the wire + a component round-trip

**Status:** Unit A design (2026-08-28, post-recon @ tip `0e4834a27`). 4-agent adversarial review applied
(§S1.10). Precondition satisfied: WRK-014 (container identity) + WRK-015 (POSIX enrolment input)
shipped, so a container can enrol; and this slice is the scope's explicit **component-level** exception
(driver ↔ server in an integration test, §8 wire-F5) — it does **not** dispatch through the daemon, so it
does not "wire against an unbuilt caller."

Slice 1 as scoped (§6/§8) is **L-sized and larger than its own naive read**: the F2 redaction rule touches
security-**authoritative** code (`cleanup-authority.ts`), and it turns on a decision §8 flagged but never
settled. So Slice 1 splits at a verified seam into two build-units. This section designs **Unit A** (the
CleanupAuthority-free plumbing) in full and scopes **Unit B** (the ownership fork + redaction) for its own
design→review — the same discipline the credential fork (§3.1) got.

## S1.0 Verified terrain (recon 2026-08-28 against tip `0e4834a27`; all §8 code-claims hold, 0 refuted)

- **The authoritative per-op port** is `interface SandboxProvider` — `packages/worker-daemon/src/supervisor/provider.ts:339-388`.
  NOT the conformance `SandboxProviderDriver` (`invoke(op,args)`, `sandbox-provider-contract/src/port.ts:149`),
  a demoted surface reached only via `perOpToInvokeDriver`. Do not design the wire against the invoke shape.
- **The op set.** `PROVIDER_OPERATIONS` = 11 (`worker-protocol/src/capabilities.ts:125-137`); the 8
  `CORE_PROVIDER_OPERATIONS` (`:142-151`) = `create/execute/cancel/kill/destroy/list/inspect/reconcile_cleanup`
  are Slice 1; the 3 optional (`checkpoint/restore/health`) are capability-gated, out of scope. **`execute`
  is a core op and belongs in Slice 1** — it is unary + byte-free, so it carries no streaming cost.
- **The provider + the mock.** `E2bSandboxProvider` (`sandbox-e2b-provider/src/e2b-provider.ts:136`)
  `implements SandboxProvider`; ctor takes `{transport}` (`:159`). `MockE2bTransport` EXISTS and is truly
  key-less (`sandbox-e2b-provider/src/mock-transport.ts:53-213`, factory `:226`), already the substrate of
  `conformance.test.ts:27-31` — so `new E2bSandboxProvider({ transport: new MockE2bTransport() })` is a
  proven, no-key construction. `RealE2bTransport` (the ONLY `E2B_API_KEY`/`e2b` reader — `real-transport.ts:53,:22`)
  is the Slice-3 swap; Slice 1 never touches it.
- **`execute` is byte-free** — opaque `stdoutRef`/`stderrRef` **synthesized from `sandboxId`**
  (`ref:stdout:${sandboxId}`), NOT captured-then-discarded: `execute` passes NO stream handlers to the
  transport (`e2b-provider.ts:215-259`, refs `:249-250`, no handlers at `:235`; "No customer bytes cross this
  boundary (E5)" ~`:248`). The property is airtight — the wire carries the refs, never bytes.
- **`ProviderOpContext`** = `{ deadlineMs: number; idempotencyKey: string }` (`provider.ts:180-183`, both
  non-optional). The provider short-circuits `deadlineMs <= 0` → `timedOut:true` (`e2b-provider.ts:224-233`):
  the **driver-owned zero-deadline verdict** (§3.4) the wire must preserve on the CLIENT side (short-circuit
  before the RPC), not round-trip.
- **`create`/`execute` shapes.** `create`: `CreateSandboxSpec{resourceLabels,command,args,env,workloadType}`
  (`:185`) → `CreateResult{sandboxId,providerOpId,resourceLabels}` (`:194`). `execute`:
  `ExecuteInput{sandboxId,command,args,env}` (`:200`) → `ExecuteResult{providerOpId,exitCode,signal,timedOut,stdoutRef,stderrRef}`
  (`:212`). Neither result is a sensitive projection — `create` echoes the caller's OWN labels; `execute` is
  byte-free.
- **`#idempotency` is in-memory** — `Map` keyed by `ctx.idempotencyKey` (`e2b-provider.ts:156`, read `:187`,
  write `:211`). Durability is a Slice-3 concern (§8 F3); Unit A's replay test must be **in-process only**.
- **Error vocab** (duck-typed by `.name`): `UnsupportedProviderOperation{.operation}` (`provider.ts:306`),
  `SandboxNotFoundError` (`:320`), `SandboxEgressDeniedError{.destinationClass}` (e2b-local `errors.ts:32`).
- **The worker-daemon import boundary** (`scripts/lib/worker-daemon-boundary.mjs:5-12`): `@armyofagents/worker-daemon`
  may import only `worker-protocol` + `pino` + Node built-ins + in-`src` relatives. **So the networked driver
  is injected from OUTSIDE worker-daemon** — exactly as the desktop provider is (`worker-keystore/src/bin/desktop-host.ts`
  injects `E2bSandboxProvider` via `deps.provider`) — never imported by the daemon. `AOA_WORKER_PROVIDER_URL`
  is present-but-dead (`scripts/d1-dispatch-expectation.json:17,25`); the live switch is `AOA_WORKER_SANDBOX_PROVIDER`.
- **Greenfield confirmed** — no `adapter-manager`/networked-driver/provider-client code anywhere in `packages/`.

## S1.1 The seam — the security axis is "needs a wire ownership gate," NOT "touches CleanupAuthority"

**The 3-agent review (S1.10-R1) refuted the first draft's axis.** Partitioning by "touches `CleanupAuthority`"
is a **false negative for `execute`** — the axis that matters is: *does this op need a server-side ownership
gate once it crosses the wire?* Partition the 8 core ops by THAT:

- **Gate-free — `create`.** It makes a NEW sandbox; the caller owns the result (`CreateResult` echoes the
  caller's OWN `resourceLabels`, `e2b-provider.ts:212`). Nothing to own-check.
- **Gate-REQUIRED, byte-free result — `execute`.** Its result is non-sensitive (opaque refs), but its
  ownership safety is **structural in-process and evaporates over the wire**: at the provider `execute` has
  NO ownership check — `EffectAuthority.execute` gates on the **active fence only, not the sandbox**
  (`effect-authority.ts:87-90,:78-80`), `CleanupAuthority` *denies* execute outright (`cleanup-authority.ts:130`),
  and the supervisor is today the sole caller, always on its **own** just-created id (`supervisor.ts:417`).
  Over the wire an untrusted worker crafts the `sandboxId` itself, so an ungated `execute` route is BOTH an
  existence oracle (run vs `SandboxNotFoundError`) AND a **cross-tenant code-execution** vector (run a command
  in another worker's sandbox) — strictly worse than the teardown/inspect oracle. It needs a server-side
  `#requireOwned`-equivalent before it faces >1 worker.
- **Gate-REQUIRED, sensitive result — `cancel/kill/destroy/reconcileCleanup`** (each gates through
  `#requireOwned`, `cleanup-authority.ts:219-231`) **+ `inspect`/`list`** (which return the sensitive
  `InspectResult`/`ResourceSummary` carrying raw labels + `env`, `:154-205`).

Every gate-required op forces the decision §8's F2 note offered two answers to but never settled: **where does
the ownership authority live in the networked topology?**

- **(P) Server-relocate.** The authority computes the owned/not-owned verdict AM-local (in-process, raw
  labels) and returns only a redacted projection + verdict; the untrusted worker holds no raw labels. Faithful
  to the boundary thesis, and — decisively — the **only** option that can gate `execute` server-side against a
  *misbehaving* worker. Cost: a security authority relocates, and the wire carries the authenticated worker
  identity so the server instantiates a per-worker authority.
- **(Q) Client-hash.** The authority stays on the worker; the wire returns
  `RedactedResourceProjection{…,resourceLabelsHash}` (`provider.ts:394`) and the check compares
  `hashResourceLabels(this.#resourceLabels)` (`provider.ts:158`) + generation instead of raw `labelsEqual`.
  Smaller relocation for teardown/inspect — **but it cannot gate `execute`** (a misbehaving worker would be
  checking itself). So `execute` on the gate-required side is a concrete argument for **(P)**.

All gate-required work edits security-authoritative `cleanup-authority.ts` and must preserve the
**existence-oracle collapse** (today `SandboxNotFoundError` and an owned-mismatch BOTH map to one
`ResourceNotAvailableError`, `cleanup-authority.ts:159,164`; a wire that round-trips `SandboxNotFoundError`
distinctly re-grants the "exists but not yours" oracle). This is a fork on the level of the credential
decision (§3.1) — its own design→review→sign-off.

**So the seam is PLUMBING vs the SECURITY GATE — not "CleanupAuthority-free vs gated":**

- **Unit A** builds the transport plumbing for `create` + `execute` — the whole serialization / network-hop /
  idempotency-replay / **error-vocab** de-risk (`execute` is the ONLY op that produces the domain error vocab
  over the wire, so it earns its place). Unit A's `execute` route ships **without an ownership gate** and is
  therefore **component-test-only / NOT deploy-safe** (S1.4) — admissible solely because Unit A's artifact is a
  single-tenant loopback vitest with no deploy, no daemon, no mTLS. It stands up no reachable oracle.
- **Unit B** settles the ownership fork (P/Q) and builds the server-side gate for **`execute` + the six
  gate-required ops** + redaction — its own reviewed unit, and the one that makes the server safe to face >1
  worker. It MUST land before Slice 3 (real multi-tenant) or Slice 5 (deploy).

Unit A de-risks everything Unit B builds on (does the wire work; does the error vocab survive) without gating
on the fork.

## S1.2 Unit A — components

1. **A new leaf `packages/adapter-manager/`** — the server. `createProviderServer({ provider })` mounts an
   HTTP listener; per request it routes a per-op path, deserializes `{args, ctx}`, calls
   `provider.<op>(args, ctx)`, and serializes `{ ok: result }` or `{ err: <coded> }`. Unit A wires only
   `create` + `execute` (+ `/healthz`, reuse the D1 healthcheck shape `docker-compose.d1.yml:388`). It hosts
   `new E2bSandboxProvider({ transport: new MockE2bTransport() })`. **★ Import via SUBPATHS, not the barrel**
   (review R4, landmine 7): `sandbox-e2b-provider`'s barrel (`index.ts:34`) statically re-exports
   `RealE2bTransport`, which `import`s the `e2b` SDK (`real-transport.ts:22`) — a barrel import drags `e2b`
   into Unit A's key-less closure and contradicts the S1.4 "no RealE2bTransport" fence at module scope. Import
   `E2bSandboxProvider` from `sandbox-e2b-provider/e2b-provider.js` and `MockE2bTransport` from
   `…/mock-transport.js` (the `worker-keystore/src/bin/sandbox-provider.ts:10-13` dynamic-import trap, avoided
   structurally). Each new package carries its own `package.json` with `build`/`typecheck` scripts (so `pnpm -r`
   reaches it); adapter-manager need NOT declare `e2b` if the subpath imports keep `real-transport` out of the
   closure — confirm in Step 0. **No mTLS/peer-allowlist/net-seg yet** — Slice-5 deploy hardening; NOTE in code
   that the real topology (`control-net`, mutual-auth, peer-allowlist) requires them.
2. **A shared, non-frozen wire package (`packages/provider-wire/`, NOT in `worker-protocol`)** — the
   per-op request/response envelopes + (de)serialization + the error-vocab codec, imported by BOTH the server
   and the driver. **The op-shapes are ALREADY exported** (review R3, verified): `@armyofagents/worker-daemon`
   re-exports `CreateSandboxSpec`/`CreateResult`/`ExecuteInput`/`ExecuteResult`/`ProviderOpContext` from its
   barrel (`index.ts:380-410`, deliberately so a downstream package can `implements SandboxProvider` without
   copying the shape). So the wire package just does `import type { … } from "@armyofagents/worker-daemon"` —
   zero worker-daemon edit, zero re-declaration drift. (The first-draft "add exports OR re-declare" fork is
   moot; and its "types don't count as runtime imports" rationale was imprecise — the worker-daemon boundary
   polices the specifier *target*, not type-ness. Irrelevant here because these are already-existing
   relative-inside-`src` re-exports, and the wire package is not under `worker-daemon/src` so the boundary
   never scans it.)
3. **The networked driver** — a class presenting the per-op `SandboxProvider` (Unit A implements `create`+`execute`;
   the other six throw the AUTHORITATIVE `UnsupportedProviderOperation` — the worker-daemon class at
   `provider.ts:306`, re-exported via `sandbox-e2b-provider/errors.ts`, NOT the same-named conformance-package
   copy at `sandbox-provider-contract/src/port.ts:133` — until Unit B). **`execute` (only)** applies the
   **driver-owned zero-deadline short-circuit** first (`deadlineMs <= 0` → the deterministic `timedOut`
   verdict, no RPC); **`create` does NOT** (review R2: `CreateResult` has no `timedOut` field; `create`
   substitutes `defaultTtlMs` via `#ttl`, `e2b-provider.ts:182-184` — it has no short-circuit to mirror). Each
   method then POSTs `{args, ctx}` and deserializes `{ok|err}`. Lives in `provider-wire` (outside worker-daemon),
   injected later by a container composition root (DEP-011) via `deps.provider` — so worker-daemon stays
   boundary-clean. Unit A uses Node's global `fetch`; NOTE the eventual daemon injection (DEP-011) must keep
   the daemon's import closure to Node built-ins (no `require`/`createRequire` bridge either — the boundary
   forbids it).
4. **A component integration test** (vitest, in-process, loopback HTTP): stand up the mock-backed server + the
   driver and exercise `create`/`execute` **over the wire** (not the provider directly — the novelty is the
   network hop: serialization, error mapping). Prove:
   - `create` round-trip (the spec's labels are echoed in `CreateResult`);
   - **create-idempotency replay** — two `create`s with the same `ctx.idempotencyKey` → the same `sandboxId`,
     **in-process only** (no server restart; cross-restart durability is Slice 3 — testing it here would look
     like a bug, landmine 6);
   - `execute` byte-free (opaque `stdoutRef`/`stderrRef`, no bytes on the wire);
   - the **zero-deadline verdict** (driver short-circuits, server never called);
   - the **error-vocab** — a mock-directed `create`/`execute` fault (via `mock-transport` directives) →
     the right error CLASS (`.name` + discriminant) survives the wire round-trip.

## S1.3 Unit A — TDD order (fail-first; write each RED test, confirm it fails for the right reason, then implement)

1. Wire codec: a `create` request/response serializes + round-trips (RED: no codec) → implement the envelope.
2. Server: `POST /op/create` → `provider.create` → `{ok:CreateResult}` (RED: no server) → implement the route.
3. Driver: `driver.create(spec, ctx)` posts + deserializes → `CreateResult` (RED) → implement; the
   integration test asserts the label echo end-to-end.
4. Idempotency replay (in-process): same key → same `sandboxId` (RED until create is wired through) → assert.
5. `execute`: byte-free round-trip + the zero-deadline short-circuit (assert the server is NOT hit when
   `deadlineMs<=0`, e.g. a fetch spy / a server call-counter) → implement.
6. Error-vocab: a directed transport fault → the mapped error class crosses (RED: naive JSON drops the class)
   → implement the error codec. Include a **negative** case: an unknown/garbled error payload maps to a
   generic wire error, never silently to success.
7. Mutation sweep (§5-style, per this programme): delete each codec/short-circuit guard, confirm a test
   kills it; mutate each OR-arm of the error-class discriminator individually (the "mutate each ARM"
   lesson, [[wrk-015-posix-validator]]).

## S1.4 Unit A — fences (what it is NOT)

- **★ Unit A's `execute` route has NO ownership gate and is NOT deploy-safe** (review R1). Admissible ONLY in
  the single-tenant loopback component test; it MUST NOT face >1 label-set (Slice 3) or any deploy (Slice 5)
  until the Unit-B `execute` ownership gate exists — an ungated `execute` over a reachable wire is an existence
  oracle + a cross-tenant code-execution vector (S1.1). Unit A builds `execute`'s PLUMBING, not its gate.
- **No ownership GATE, no `cleanup-authority.ts` change, none of `cancel/kill/destroy/reconcile/inspect/list`** —
  Unit B (which also adds `execute`'s gate).
- **No redaction** — `create`/`execute` results carry no sensitive projection (that is the point of the
  plumbing seam).
- **No real E2B, no `E2B_API_KEY`** — Slice 3. And **no `real-transport` in the closure** — a module-scope
  claim held by the SUBPATH imports (S1.2.1), which keep the `e2b`-loading module out of Unit A entirely.
- **No credential crossing** — Slice 4 (settled (i)).
- **No streaming** — deleted (execute byte-free; live output rides the frozen `event_upload` outbox).
- **No Docker image, no deploy, no mTLS/peer-allowlist/net-seg** — Slice 5. Unit A is a vitest component test,
  so it adds no `docker/images` `IMAGES` entry and does not trip `check-image-deps-stages`.
- **NOT through the daemon** — no `deps.provider` inject, no dispatch gate, no `AOA_WORKER_PROVIDER_URL`
  consumer, no new `AOA_WORKER_SANDBOX_PROVIDER` kind (all DEP-011).

## S1.5 Unit B — scoping (SUPERSEDED — Unit B is now fully designed at "# Slice 1 · Unit B" below; fork RESOLVED → A · signed capability)

> **Note:** the bullets below are the early Unit-A-era scoping. Unit B's real design is the `# Slice 1 · Unit B`
> section (B0–B10). In particular, "edit `cleanup-authority.ts:154-205` per the fork" is now a **B2** concern
> (under A, B1's execute gate leaves `cleanup-authority.ts` untouched — see the B1 cross-lane rule).

- **Settle the ownership fork (P server-relocate vs Q client-hash)** with a 3-agent adversarial review +
  human sign-off, as the credential fork got. **The fork must cover `execute`, not just teardown/inspect/list**
  (review R1): option (Q) cannot gate `execute` server-side against a misbehaving worker, so `execute`'s
  presence is a concrete argument for (P). It gates the wire shape and edits security-authoritative code.
- Build the server-side ownership gate for **`execute`** (resolve the authenticated caller's owned labels;
  refuse a non-matching `sandboxId` with the **uniform** `ResourceNotAvailableError`, preserving the collapse)
  **+ `cancel/kill/destroy/reconcileCleanup`** (ownership-gated) **+ `inspect`/`list`** returning
  **`RedactedResourceProjection`** ONLY (the `{sandboxId,resourceLabelsHash,generation,state,providerOpId}`
  shape at `provider.ts:394` — NOT the conformance `ProviderResourceProjection`/`PROVIDER_PROJECTION_KEYS`,
  a different surface; conflating them is a category error, landmine 2).
- **Preserve the existence-oracle collapse** across the wire for every gated op (owned-check first, uniform
  `ResourceNotAvailableError` out).
- The edit to `cleanup-authority.ts:154-205` (hash-based or AM-local) per the fork.
- **Slice-3 idempotency ledger namespaced by authenticated worker identity** (review R1 item-1) + verify the
  returned `resourceLabels` belong to the caller, so a replayed/forged `idempotencyKey` cannot echo another
  worker's `sandboxId` + raw labels.
- **Slice-5 ordering invariant** (review R1 item-4, [[checks-that-nothing-runs]]): a deploy test ASSERTS the
  `execute` route sits behind the ownership gate — a foreign-labeled `sandboxId` to `execute` yields the
  uniform not-available error — so "gate before deploy" is enforced, not assumed.

## S1.6 Guards (run the WHOLE set — the WRK-014 missed-guard lesson, [[checks-that-nothing-runs]])

- **★ Register the new package(s) in `vitest.config.ts` `projects[]`** (review R3+R4 — the HIGH catch). A new
  `packages/adapter-manager` (+ `packages/provider-wire` if it owns specs) with `*.test.ts` but absent from the
  root `projects[]` (`vitest.config.ts:24`, an explicit enumeration, NO glob) makes `check-execution-census`
  red (`vitest_project_missing` / `vitest_config_not_in_projects`, `execution-census.mjs:115-120,:135-139`) —
  and, worse, its tests **run nowhere** while a naive "tests pass" reads green (the [[checks-that-nothing-runs]]
  class). Give each new package its own `vitest.config.ts` AND append its path to root `projects[]`.
- The five registers: `check-ticket-graph-coverage` (the one `#### DEP-012` node suffices — R4 verified the
  regex parses `DEP-012-unit-a-result.md` → `{DEP-012}`), `check-finding-ownership`, `check-guard-inventory`,
  `check-gate-clause-wiring`, `check-execution-census` (see the registration above).
- `check-worker-daemon-boundary` — the new packages are OUTSIDE `worker-daemon/src`, so the guard never scans
  them, and worker-daemon gains no new import/export (the op-shapes are already exported, S1.2.2). Confirm it
  still passes (untouched).
- `check-test-inventory` — pin the new test files (bump via `--write`; do not over-reach into unrelated floor
  trees, the DSK-003 lesson).
- `check-boot-roots-provider-free` — verified NO action for Unit A: the guard scans only
  `worker-daemon/src/bin` + `worker-keystore/src/bin` for `bootstrapWorkerDaemon` (`:24-28,:44`);
  adapter-manager's server bin is in neither and names no such identifier. (DEP-011's container composition
  root WILL need a `boot-roots-expectation.json` entry — that is DEP-011, not Unit A.)
- **NOT** `check-image-deps-stages` and **NOT** the Dockerfile-static test — Unit A adds no image/Dockerfile
  (both fire at Slice 5). Note this explicitly in the result so a green run is not mistaken for coverage.

## S1.7 Acceptance (Unit A)

The driver ↔ server integration test is green: `create` round-trips with label echo; the same idempotency
key returns the same sandbox in-process; `execute` crosses byte-free; the zero-deadline verdict is
driver-owned (server not hit); and each Unit-A error class survives the wire (with a negative unknown-payload
case). No sensitive projection crosses (there is none in `create`/`execute` — assert the wire types contain
no `env`/`secrets`/`command`/`logs`). The full guard set is green. **`DEP-012-unit-a-result.md`** (unit-suffixed
so it does not collide with Unit B's future doc; the graph regex parses it to `DEP-012` — never a 3-digit
slice number after `012`) records Unit A + the mutation table + the Unit-B fork left open + every claim not
proven.

## S1.8 Status

Unit A design complete + **4-agent adversarial review applied (§S1.10)**, all verified against source: the
seam axis refolded (R1 — `execute` is gate-required), the vitest-`projects[]` registration (R3/R4), the
`e2b`-barrel subpath imports (R4), the zero-deadline `execute`-only scope (R2), and the
`DEP-012-unit-a-result.md` filename (R4) folded in. Unit B is scoped, not designed. The provider-topology
CONTRACT (§8) is settled and not re-opened; the ownership fork (P/Q) is a Unit-B decision this design
deliberately leaves open.

## S1.9 Open questions for the 3-agent adversarial review

1. **Is the A/B seam truly clean?** Does `create` returning its own `resourceLabels` count as a sensitive
   crossing (I claim no — the caller supplied them), and is `execute` genuinely CleanupAuthority-free at the
   provider level (verify no `#requireOwned` on the execute path)?
2. **Does deferring the ownership fork leave an Unit-A latent oracle?** `execute` against an unknown/foreign
   `sandboxId` → `SandboxNotFoundError`; round-tripping that distinctly — is it an existence oracle before
   ownership gating exists (Unit B), and if so must Unit A already collapse it or refuse cross-worker ids?
3. **Where do the wire schema + driver live** to keep worker-daemon boundary-clean AND avoid re-declaring the
   op shapes — does `@armyofagents/worker-daemon` export `CreateSandboxSpec`/`CreateResult`/`ExecuteInput`/`ExecuteResult`/`ProviderOpContext`
   today, or is a type-only export needed (and does it stay boundary-clean)?
4. **Is `packages/adapter-manager` the right home** for the server, or does a provider host belong elsewhere?
   Does adding it trip `check-execution-census` / `check-boot-roots-provider-free` / any register?
5. **Is the in-process idempotency-replay test honest** (no cross-restart) and does it actually exercise the
   WIRE (serialization + the network hop), not just the provider object?
6. **Does `check-ticket-graph-coverage` need a node per build-unit**, or is the one `#### DEP-012` node
   enough — and what must a `DEP-012-*-result.md` filename be so the guard parses the id correctly (the
   WRK-015 filename-id lesson)?

## S1.10 Review round — 4-agent adversarial pass (2026-08-28), all verified against source

**R1 — seam/oracle (the load-bearing catch).** The first-draft axis ("CleanupAuthority-free ⇒ safe to defer")
is a **false negative for `execute`**. `execute` is CleanupAuthority-free (`cleanup-authority.ts:130` denies
it) yet needs a server-side ownership gate — its in-process safety is purely structural (`EffectAuthority`
fence-only guard `effect-authority.ts:87-90` + the supervisor-calls-own-id invariant `supervisor.ts:417`),
which evaporates over the wire, making an ungated `execute` route an existence oracle + a cross-tenant
code-execution vector. Applied: S1.1 refolded to the wire-gate axis; S1.4 fences `execute` as
component-test-only/not-deploy-safe; S1.5 folds `execute` into the Unit-B fork (+ the Slice-5 ordering
invariant + Slice-3 ledger namespacing). Confirmed: Unit A stays safe to BUILD (loopback, single mock, no
deploy) — the gap is latent (Slice 3/5), not live in Unit A.

**R2 — terrain skeptic.** All 11 S1.0 claims re-derived from source, **0 refuted**. Caught (all applied): the
zero-deadline short-circuit is `execute`-ONLY (`create` has no `timedOut`, uses `defaultTtlMs`) — S1.2.3; name
the AUTHORITATIVE `UnsupportedProviderOperation` (worker-daemon `provider.ts:306`, not the conformance copy) —
S1.2.3; "stream discarded" tightened to the synthesized-refs wording — S1.0.

**R3 — architecture/boundary.** The injected-driver model (desktop precedent, `deps.provider`) and the
`packages/adapter-manager` home are boundary-safe. The op-shapes are **ALREADY exported** (`index.ts:380-410`)
so the export fork is moot — `import type` only (S1.2.2). HIGH: register the new package in `vitest.config.ts`
`projects[]` or its tests run nowhere (S1.6). `check-boot-roots-provider-free` confirmed NO-action for Unit A.

**R4 — completeness/tracking.** The ticket-graph regex `/^([A-Z]{2,5})-(\d{3})((?:-\d{3})*)/` parses
`DEP-012-unit-a-result.md` → `{DEP-012}` (one node suffices; avoid a 3-digit slice number) — S1.7. Landmine 7
(barrel drags `e2b`) → subpath imports (S1.2.1). The `#### DEP-012` node Acceptance ("no result doc until the
server lands") was stale → per-unit-result-doc wording (applied to `program-design.md`). **Slice-5
forward-notes** (for that author): do NOT reuse D1's `provider-ctl-net` semantics (`findings.md:36-46` — reuse
D1 hardening patterns only); adding `docker/adapter-manager/Dockerfile` needs new entries in
`check-image-deps-stages` `IMAGES` + `dockerfile-static.test`, or the image ships deps-unchecked; and the wire
SPEC lands in DEP-012 (provider-wire) while E6-F003 (worker-side consumption) stays owned by DEP-011.

---

# Slice 1 · Unit B — the ownership gate + redaction (the security unit)

**Status:** design (2026-08-28, post-recon + **fork DECIDED**). Ownership fork RESOLVED → **A · signed
capability** (founder sign-off 2026-08-28). Sub-sliced: this section designs **B1** (the capability +
`execute`'s server-side gate — the worst hole) in full and scopes **B2** (teardown + redaction). **4-agent
adversarial review applied (§B10)** — the capability reshaped hash→ordered-tuple (field-wise gate), made
mandatory/fail-closed, both collapse arms + symmetric codec, the mint-cost corrected, cross-lane framing fixed.
Precondition: Unit A shipped (the wire plumbing exists).

## B0 — the resolved fork (recon 2026-08-28, verified against source)

The first-draft "P vs Q" collapsed under recon. **Pure client-side Q is REFUTED:** it cannot gate `execute`
(fence-only at `effect-authority.ts:87-90`, denied by `cleanup-authority.ts:130`; a client-side check runs on
the worker *before* the request, so a misbehaving worker omits it and sends a foreign `sandboxId` the ungated
server runs — cross-tenant code exec), and it cannot collapse the existence oracle over the wire (the server
can't decide "found-but-not-yours" without the caller's labels). **So the gate is server-side — forced.**

The real trade was *how `adapter-manager` learns whose sandbox is whose*:
- **(A) Signed capability [CHOSEN].** The control plane mints a short-lived signed token binding the worker's
  own ordered label TUPLE; `adapter-manager` verifies ONE signature (control-plane public key) — no DB, no
  session keys. Proven-identity, unforgeable, keeps the credential host minimal, cleanly namespaces the
  idempotency ledger (Slice 3). *(The sane form of the original "P" — P-delegate.)*
- (B) Asserted owned-hash — **rejected**: authorizes on the worker *knowing* its own labels (defense-by-secrecy),
  sound only while raw labels never leak. Cheaper, fragile.
- (C) Relocate the full auth + tenant DB onto `adapter-manager` — **rejected**: imports the control-plane trust
  surface onto the isolated credential host, defeating the boundary.

**The identity crux (recon):** `adapter-manager` cannot know the caller's owned labels today — the wire is
`{args, ctx}` with zero identity (`provider-wire/src/codec.ts:41-44`), and it has no DB/session key by design.
The server CAN derive owned labels from an authenticated worker (`worker-fence-context.ts:120-134` builds an
`ActiveFenceRequest` — a SUPERSET from which the `ResourceLabels` tuple is derived) — but only inside a tenant DB
transaction behind a JWT + Ed25519 device-proof (`worker-operation-proof.ts:34-76`). A is the delegate form: the
control plane (which already holds the fence/labels) signs them into a capability; `adapter-manager` verifies
with just a public key. **The VERIFY is a cheap, DB-free ~15-line `node:crypto` check + a pure `labelsEqual`
(review R1 CONFIRMED — no auth-surface import); the MINT is the real cost — a NET-NEW control-plane Ed25519
keypair + provisioning/rotation (there is NO reusable control-plane signer; NOT "reuse"), deferred to
DEP-011/deploy. This mint delta does NOT flip A-vs-B (B saves only the keypair and keeps its secrecy weakness).**

## B0.1 — verified terrain (recon 2026-08-28)

- **`#requireOwned`** (`cleanup-authority.ts:154-167`): `inspect(sandboxId)` → `labelsEqual(detail.resourceLabels,
  #resourceLabels) && detail.generation === #targetGeneration` → full detail (never leaves the CleanupAuthority
  unredacted); `SandboxNotFoundError` OR mismatch → the **uniform** `ResourceNotAvailableError` (`:159,:164`). The per-worker
  "owned" state is the constructor's `#resourceLabels` + `#targetGeneration` (`:99-100`).
- **`ResourceLabels`** = `{organizationId, targetId, workerId, jobId, attempt, leaseId, deviceGeneration}`
  (`provider.ts:113-121`); `labelsEqual` is field-wise (`:131-141`); `hashResourceLabels` is an unsalted keyless
  SHA-256 over the tuple (`:158-169`).
- **`execute` is fence-only** (`effect-authority.ts:87-90`) — a server-side gate reuses `#requireOwned`'s
  inspect+compare AM-local (the provider exposes the target's raw labels + generation via `inspect`,
  `e2b-provider.ts:319-343`). The ONLY missing input is the caller's owned identity → the capability supplies it.
- **`RedactedResourceProjection`** = `{sandboxId, resourceLabelsHash, generation, state, providerOpId}`
  (`provider.ts:394-400`) — the shape `inspect`/`list` must cross as (B2).
- **The wire has NO identity slot** (`codec.ts:41-44`) and NO `ResourceNotAvailableError` in its vocab
  (`codec.ts:116-157`) — both are net-new in Unit B.
- **`cleanup-authority.ts` stays UNTOUCHED for B1** — under A the execute gate is NEW `adapter-manager` code. But
  `CleanupAuthority` is lane-AGNOSTIC (`supervisor.ts:528`, not just the desktop lane); B1 is clean only because
  `execute` bypasses it (fence-only `EffectAuthority`; `CleanupAuthority` denies execute, `:130`). B2's teardown
  coexistence still needs resolving — **landmine 6 DEFERS to B2, it does not dissolve** (see the cross-lane rule).

## B0.2 — sub-slice plan

Unit B is L-sized (net-new capability infra + 6 gated ops + redaction). It splits:
- **B1 (this design) — the capability + `execute`'s server-side gate.** Closes the WORST hole (cross-tenant
  code exec) and builds the shared security infra: the capability verify, the AM-local owned-check, the uniform
  wire error, the server-side oracle-collapse. Component-tested.
- **B2 (scoped, §B7) — the teardown ops + redaction.** `cancel/kill/destroy/reconcile_cleanup` gated (reuse
  B1's capability) + `inspect`/`list` redacted to `RedactedResourceProjection` server-side + `list` re-homing.

## B1 — what it builds

1. **The owned-labels capability** (a new `provider-wire` schema type). A signed token
   `{ v: 1, audience: "adapter-manager", ownedLabels: ResourceLabels, expiresAt, sig }` — it carries the caller's
   OWN ordered label TUPLE (not a hash), so the gate compares FIELD-WISE like `#requireOwned` (review R2: gating
   on the space-joined `hashResourceLabels` is a canonicalization bypass — two tuples with a space in a field
   collide; the hash was built for logging, not authz). The caller's own labels in a SIGNED token are no
   disclosure (F2 redaction concerns OTHER workers' labels via inspect/list). The `v` discriminant is MANDATORY
   forward-compat (review R4: B2 extends the capability with coarse identity for `list`; a bare canonical-struct
   signature is not additive-tolerant — version it now or every B1 token breaks at B2). Signed with a **NET-NEW
   control-plane Ed25519 keypair** (review R1: there is NO reusable control-plane signer — the session signer is
   symmetric HMAC, the device-proof signer is the WORKER's + transport-bound; author a fresh detached-Ed25519
   signer from the in-repo `node:crypto` primitives — `device-key.ts:61` `generateKeyPairSync("ed25519")`,
   `sign(null,·)`/`verify(null,·)`, the `device-proof.ts` canonicalizer pattern). **Unit B builds VERIFY + a TEST
   keypair only** — the real keypair + provisioning/rotation + the mint (in the fenced `resolveExecutionSecret`
   reply where JWT+device-proof-verified labels already exist, `secret-redemption.ts:160-187`) are DEP-011/deploy
   cost: real, deferred, and NOT "reuse."
2. **The verify path on `adapter-manager`** (a fresh ~15-line `node:crypto` fn, DB-free — review R1 CONFIRMED
   cheap + separable, no auth-surface import): load the pinned control-plane PUBLIC key once
   (`createPublicKey({format:"der",type:"spki"})`, assert `ed25519`); rebuild the canonical over ALL signed
   fields (`v`,`audience`,`ownedLabels`,`expiresAt` — an UNAMBIGUOUS serialization: length-prefixed or
   `JSON.stringify` of a fixed field order, NEVER a space-join); `verify(null, canonical, pub, sig)`; check
   `audience === "adapter-manager"` + `expiresAt > now`. Fail-closed (bad sig / expired / wrong audience →
   refuse) **BEFORE any provider call** — the ordering is load-bearing (review R2: a verify failure must be
   identical for own/foreign/not-found ids so it leaks nothing).
3. **`execute`'s server-side gate** — after verify, before dispatch: `provider.inspect(sandboxId)` AM-local (the
   server's in-process provider, NOT a wire op) → the target's raw labels + generation; then MIRROR
   `#requireOwned` FIELD-FOR-FIELD (`cleanup-authority.ts:154-167`): `labelsEqual(target.resourceLabels,
   cap.ownedLabels) && target.generation === cap.ownedLabels.deviceGeneration` → allow; **reproduce BOTH collapse
   arms** — a `SandboxNotFoundError` from `inspect` maps to the SAME uniform `ResourceNotAvailableError` as a
   label/generation mismatch (`:159` and `:164`), so a foreign-but-existing sandbox is indistinguishable from
   not-found. Collapse ALL `inspect` throws to the uniform error (review R2: `#requireOwned` rethrows non-NotFound
   at `:160`; over the wire a distinct transient-fault error is existence-orthogonal, but collapse it for
   airtightness — and keep `serializeError`'s verbatim `message` forwarding from leaking transport detail).
4. **The MANDATORY capability field + the uniform wire error.** The capability is a **first-class, REQUIRED**
   field on `OpRequestEnvelope` (`codec.ts:41-44`) validated in `decodeOpRequest` (`:65-76`); `execute` **REFUSES
   with the uniform error when it is absent or unverifiable — NEVER dispatches on absence** (review R2 the
   fall-open: today `decodeOpRequest` silently DROPS extra fields, so a gate that engages only when a capability
   is present is bypassed by a Unit-A-shaped envelope carrying none). Add `ResourceNotAvailableError`
   **SYMMETRICALLY** to `serializeError` AND `reconstructError` (`codec.ts:116-157`) — it is the authoritative
   worker-daemon class (`cleanup-authority.ts:65`) already re-exported from the codec's existing import site
   (`@armyofagents/sandbox-e2b-provider/errors.js:20`); miss the `reconstructError` case and it silently degrades
   to `WireProtocolError` on decode, breaking the uniform error.
5. **The driver carries the capability** — sourced OUT-OF-BAND (the port `execute(input, ctx)` has no capability
   slot, `provider.ts:347`; inject via the driver constructor/config, NOT the `EffectAuthority` caller). The
   capability is an **OPTIONAL** envelope field so `create`'s `{args, ctx}` stays byte-identical (Unit A's 17
   tests green): `create` omits it (gate-free), `execute` requires it. B2 attaches it to the gated ops.
6. **The component test** — mints a TEST capability (test keypair); proves: own-sandbox `execute` allowed;
   **foreign-sandbox `execute` → uniform `ResourceNotAvailableError`, byte-identical to not-found (the
   oracle-collapse), transport NOT hit** (a spy — gate before dispatch); **MISSING capability → REFUSED (the
   fall-open guard), not dispatched**; bad-sig / expired / wrong-audience → refused; the no-sensitive-crossing
   assertion extended (the capability carries the caller's OWN labels — signed, non-secret — never another's).

## B1 — where things live + the cross-lane rule (review R4 — corrected)

- The capability schema lives in `provider-wire` (shared); the verify + gate live in `adapter-manager`.
- **`cleanup-authority.ts` is UNTOUCHED FOR B1 — but this is B1-scoped, not a general claim.**
  `CleanupAuthority` is constructed LANE-AGNOSTICALLY (`supervisor.ts:528`, wrapping `deps.provider` every run) —
  the networked lane does NOT bypass it. B1 is safe because `execute` routes through the fence-only
  `EffectAuthority` (`supervisor.ts:417`, `effect-authority.ts:87-90`) and `CleanupAuthority` *denies* execute
  outright (`cleanup-authority.ts:130`) — so B1's execute gate is genuinely net-new `adapter-manager` code and
  the worker-side execute path is unchanged. **This does NOT generalize to B2:** `#requireOwned` needs a FULL
  `InspectResult` (raw labels for `labelsEqual`, `:162`) the F2 redacting wire will NOT carry — so B2/DEP-011
  must EITHER edit `cleanup-authority.ts` to hash-compare via the `resourceLabelsHash` getter (`:110-112`) OR
  change the networked supervisor composition so teardown does not re-check ownership worker-side. (This
  supersedes S1.5's bare "edit `cleanup-authority.ts:154-205` per the fork" — under A that edit is a B2 concern,
  not B1; **landmine 6 DEFERS to B2, it does not dissolve.**)
- The control-plane keypair + real mint are DEP-011/deploy — B1 is verify-only + a test mint (the
  component-level posture Unit A used).
- **Decision #104:** the capability carries owned LABELS (the caller's own identity) + expiry, never a
  provider/model key or a redeemed secret; the codec must not log the `sig`.

## B1 — TDD (fail-first)

1. Capability schema + a test signer/verifier: sign→verify round-trips over the canonical of ALL fields; a
   tampered field (any of `v`/`audience`/`ownedLabels`/`expiresAt`) fails verify (RED: no verify).
2. `adapter-manager` verify: valid → `ownedLabels`; bad-sig / expired / wrong-audience → refuse (RED).
3. Codec: `ResourceNotAvailableError` round-trips SYMMETRICALLY (encode→decode preserves the class) (RED: decode
   maps it to `WireProtocolError`); the capability is a REQUIRED envelope field (`decodeOpRequest` rejects an
   `execute` request carrying none) (RED: extras silently dropped).
4. `execute` gate — own sandbox: capability `ownedLabels` `labelsEqual` the created sandbox → allowed (RED).
5. `execute` gate — foreign sandbox: `ownedLabels` ≠ target labels → uniform `ResourceNotAvailableError`,
   transport NOT hit (spy) (RED).
6. `execute` gate — MISSING capability → refused with the uniform error, NOT dispatched (the fall-open guard)
   (RED).
7. Oracle-collapse: foreign-existing, genuinely-not-found, AND a non-NotFound inspect fault all yield the SAME
   `ResourceNotAvailableError`, byte-identical (RED: distinct errors) → the server-side collapse.
8. Mutation sweep: mutate EACH gate/verify clause individually (labelsEqual, generation, expiry, audience,
   sig-verify, the missing-capability guard, EACH collapse arm) → a test kills each ("mutate each arm",
   [[wrk-015-posix-validator]]).

## B1 — fences (what it is NOT)

- **No real control-plane mint + no real keypair** — B1 verifies + tests with a test-minted capability; the real
  keypair/provisioning/rotation + the mint are DEP-011/deploy.
- **No teardown ops, no redaction** — `cancel/kill/destroy/reconcile/inspect/list` stay throwing
  `UnsupportedProviderOperation` (Unit A's state) → B2.
- **`cleanup-authority.ts` + worker-daemon UNTOUCHED FOR B1** — the execute gate is new `adapter-manager` code
  (see the cross-lane rule; the B2 teardown coexistence is B2/DEP-011's, not B1's).
- **★ The `execute` gate is NOT atomic with dispatch (TOCTOU) — a Slice-3 must-fix, not live in B1** (review R2).
  `inspect` then `execute` is check-then-act across two round-trips. Against the mock it is safe (ids are
  monotonic, never reused — `mock-transport.ts:81-83`; labels are immutable-at-create, no relabel path; a
  re-lease mints a NEW id, orphaning the old with its original labels). The residual is real-provider `sandboxId`
  REUSE (validated-as-mine, destroyed, reassigned to a foreign tenant before dispatch): B1 STATES the
  id-non-reuse assumption; closing it (provider-atomic compare-and-execute, or a per-`sandboxId` lease/lock, or a
  proven non-reuse invariant) + the §S1.5 Slice-5 ordering assertion (foreign id → uniform error) is a Slice-3
  must-fix.
- **No mTLS/peer-allowlist/net-seg** — Slice 5. A transport peer check ≠ the application-layer capability.
- **No real E2B** — MockE2bTransport (Slice 3 swaps it).
- **NOT through the daemon** — component-level (DEP-011).

## B2 — scoping (its own design→review, at B2 sprint start)

- `cancel/kill/destroy/reconcile_cleanup` gated (reuse B1's capability + the AM-local owned-check + the uniform
  error + the collapse).
- `inspect`/`list` return `RedactedResourceProjection` ONLY, redacted server-side (the full `InspectResult` /
  raw `ResourceSummary` never cross); `list`'s `ownershipSelector` needs the caller's COARSE identity
  (`organizationId/targetId/workerId`) — so B2 EXTENDS the capability to carry those (a NEW `v:2`, additive over
  B1's ordered `ownedLabels`; the `v` discriminant B1 mandates makes this a clean bump, not a break).
- **★ Resolve the worker-side `CleanupAuthority` coexistence (review R4):** under A the networked lane's teardown
  either edits `cleanup-authority.ts:154-205` to hash-compare (`resourceLabelsHash` getter `:110-112`) OR changes
  the networked supervisor composition so teardown does not re-check ownership worker-side (the server gate is
  authoritative). B2/DEP-011's decision — its own design→review.
- Apply the uniform-`ResourceNotAvailableError` collapse to every gated op.
- Slice-3 idempotency ledger namespaced by the capability's authenticated identity.

## B8 — guards (run the WHOLE set)

- B1 extends `provider-wire` + `adapter-manager` (NO new package) → **no new `vitest.config.ts` `projects[]`
  entry and no new root-`Dockerfile` deps-stage `COPY`** (the Unit-A CI-miss lesson applies only to a NEW
  package — R4 CONFIRMED both packages already in `vitest.config.ts:24` + `Dockerfile:72-73`). The five
  registers + `check-worker-daemon-boundary` (untouched — assert) + `check-sandbox-e2b-provider-boundary` +
  `check-test-inventory` (B1 adds NEW test files → an inventory `--write` re-pin IS required; do not over-reach,
  the DSK-003 lesson) + `check-boot-roots-provider-free`. NOT `check-image-deps-stages` / `dockerfile-static`
  (no image). **But re-run the inline `policy` "Validate Dockerfile deps stage" mentally** — it only fires for a
  new package, which B1 does not add.

## B9 — open questions for the 3-agent adversarial review

1. **The capability format + the SPECIFIC signer** to reuse (the Ed25519 device-proof signer? the session-JWT
   signer?) — verifiable by `adapter-manager` with just a public key, WITHOUT importing the control-plane auth
   surface? Is a compact detached-signature-over-a-canonical-struct feasible with the existing infra?
2. **Granularity** — per-request capability (stateless server, simplest) vs per-connection handshake (fewer
   bytes, needs connection state). B1 proposes per-request; is that sound for the real transport?
3. **TOCTOU** — `inspect(sandboxId)` then `execute`: can the target's labels/generation change between the check
   and the dispatch (a re-lease / generation bump) such that a stale-but-valid capability executes in a
   now-foreign sandbox? Does the check need to be atomic with dispatch?
4. **Oracle-collapse airtightness** — does ANY error path (transport fault, egress-denied, a capability-verify
   failure) leak existence distinct from `ResourceNotAvailableError`? Enumerate every server response for a
   foreign vs not-found vs own sandbox.
5. **Regression** — does adding `ResourceNotAvailableError` to the codec + the capability field break Unit A's
   17 tests or the no-sensitive-crossing (the capability carries a HASH + generation — confirm no raw labels /
   no secret)?
6. **Is the hash-only capability strong enough** — `hashResourceLabels` is unsalted keyless SHA-256; the
   capability's unforgeability rests on the SIGNATURE (not the hash's secrecy), so a known hash is fine. Confirm
   the signature is what gates, and a replayed capability is bounded by `expiresAt` (+ audience).

## B10 — Review round — 4-agent adversarial pass (2026-08-28), all verified against source

**R1 — capability feasibility (the crux, protecting the A decision).** CONFIRMED A's core premise: the VERIFY is
a cheap, DB-free ~15-line `node:crypto` Ed25519 check + a pure label compare, importable into `adapter-manager`
with no new dep and no auth-surface/DB reach (guard-enforced). REFUTED the "reuse the existing signer" language:
there is NO reusable control-plane signer (session = symmetric HMAC; device-proof = the worker's, transport-bound)
— A needs a NET-NEW control-plane Ed25519 keypair + provisioning, deferred to DEP-011/deploy. Verdict: **A stands**
(the mint delta does not flip A-vs-B). Applied: B0 mint-cost corrected; B1 item 1 net-new-keypair language + the
in-repo primitives to author the signer.

**R2 — gate security (the hardening).** Directionally sound (forgery + replay denied, collapse achievable), with
real must-fixes, all applied: (1) the space-joined `hashResourceLabels` gate is a canonicalization BYPASS →
capability now carries the ORDERED TUPLE, gate is FIELD-WISE `labelsEqual` (B1 items 1/3); (2) missing-capability
FALL-OPEN (the codec drops extras) → capability MANDATORY, `execute` refuses on absence (B1 item 4); (3) both
collapse arms (`SandboxNotFoundError` → uniform) + collapse ALL inspect throws (B1 item 3); (4)
`ResourceNotAvailableError` SYMMETRIC in `serializeError` + `reconstructError` (B1 item 4); (5) TOCTOU — not live
in B1 (mock ids monotonic, labels immutable), the real-provider id-reuse residual stated + deferred to Slice 3
(B1 fences); (6) pin the signed struct — every field inside the sig (B1 item 2).

**R3 — terrain.** All 7 terrain claims CONFIRMED. The two-generations question resolved (`InspectResult.generation`
is derived from `deviceGeneration`, so the field-wise gate is faithful); `cleanup-authority.ts`-untouchable
verified via the export chain (`ResourceNotAvailableError`/`hashResourceLabels`/`labelsEqual` all already
exported; the error flows through the codec's existing import site). Applied the two wording tightenings
(never-leaves→unredacted; 1:1→superset). The hash-canonicalization note dissolved by R2's field-wise fix.

**R4 — scope/cross-lane.** CONFIRMED B1's sub-slice coherence (the gate uses in-process `provider.inspect`, no
B2 wire op) + the guards (both packages already registered from Unit A → no new `projects[]`/Dockerfile COPY).
Two must-fixes applied: (1) the "cleanup-authority untouched" framing over-reached — `CleanupAuthority` is
lane-AGNOSTIC (`supervisor.ts:528`), so B1's claim is B1-scoped and landmine 6 DEFERS to B2 (B0.1 + cross-lane
rule + B2 corrected; S1.5 reconciled); (2) capability VERSIONING — a `v` discriminant added now so B2's
coarse-identity extension is a clean `v:2` bump (B1 item 1). Nice-to-haves folded: out-of-band capability
injection + the optional envelope field (item 5), the `check-test-inventory` re-pin (B8).
