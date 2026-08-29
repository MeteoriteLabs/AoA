# DEP-011 — The containerized worker→provider networked wire (E6-F003 successor)

**Epic:** E6 · **Plan node:** `docs/replatform/program-design.md`, `#### DEP-011`
**Depends on:** DEP-010 · **Size:** (scope only) · **Status:** scoping
**Owns:** finding **E6-F003** (`epics/E6-deployment-test-harness/findings.md`)

---

## Why this ticket exists

DEP-010 (Sprint 2) named the authoritative provider **port** (the per-op `SandboxProvider`) and
gave the **desktop/self-hosted** lane a real provider via `worker-keystore/src/bin/sandbox-provider.ts`.
It **deferred** the other half of E6-F003: the networked **wire** a *containerized* worker's provider
driver speaks to `adapter-manager`. This ticket is that successor. It is filed **now**, at DEP-010's
completion, so E6-F003 is not left `owned` by a shipped ticket — which reads as owned by nobody and
fails nothing (finding **E4-F013**). DEP-010 repoints E6-F003's manifest `ticket` to this id.

## What it must build (design written at sprint start, against the tree as it exists then)

The request/response shapes and client a container worker's provider driver speaks to
`adapter-manager` over **`control-net`** (NOT `provider-ctl-net`, which is adapter-manager-only and a
hard `PROVIDER-CONTROL VIOLATION` for a worker — and note `docker-compose.d1.yml` overloads that name
to mean the opposite; DEP-010 design §2.1). A container worker cannot use the desktop provider path,
because `E2B_API_KEY` on a worker is forbidden (§2.5), so its provider must be networked, not
key-backed.

## Precondition — when this becomes REQUIRED, not before

The moment a containerized worker under `docker-compose.staging.yml` must dispatch. Today there is no
consumer: `adapter-manager` has **zero implementation**
(`DECISION-byte-egress-and-provider-topology.md` §4 residual 4.2), and no worker dispatches (flag
default-off, no `compose:true` branch). Specifying a wire against an unimplemented peer for an unbuilt
caller is the failure this programme keeps re-learning — hence the deferral. E6-F003 stays **open**
(HIGH; a HIGH may never be `accepted`) and this ticket owns it until the wire is built.

## Status

**Design OPEN (2026-08-29).** The precondition is now SATISFIED: DEP-012 Wave β2 shipped the real
`adapter-manager` host (the fail-closed composition-root bin + the boundary guard), so the wire's peer
EXISTS and DEP-011 is unblocked. The stub above (line 30, "adapter-manager has zero implementation") is
STALE. This section is the full design, SLICED (β2's lesson: a large unit ships as small,
independently-CI-verifiable, inert slices).

---

# DEP-011 — the slice plan (2026-08-29)

DEP-011 folds in THREE coupled pieces + a deploy tail. Sliced by risk + produce-before-consume:

- **Slice 1 — the server-side MINT** (this section). Fold `signOwnedLabelsCapability` into the
  `resolveExecutionSecret` ALLOW-path reply, over the 7-field labels the server already has
  device-proof-verified (`worker-fence-context.ts` `resolveWorkerFenceContext`, already called at
  `secret-broker.ts:236`). Ships INERT — the reply carries a capability nothing consumes yet (the Unit-A
  "wire before gate" pattern). Security-critical + contained. Test CP keypair; the real one is deploy.
- **Slice 2 — the worker networked composition root + per-run provider resolver + the credential
  crossing.** The biggest slice: a container bin (boot-root-registered, resolver-posture default-none)
  reading `AOA_WORKER_PROVIDER_URL`; the supervisor's `deps.provider` → a **per-run resolver** so the
  per-run `EffectAuthority`/`CleanupAuthority` (`supervisor.ts:527-528`) wrap a per-run
  `NetworkedProviderDriver` built from the run's minted capability; `materializeRunSecrets` extended to
  carry that capability. Boundary-clean (the resolver is a function type over the frozen port; the driver
  is constructed in the OUTSIDE bin, keeping the daemon's pinned 2-dep boundary). The redeemed model key
  now crosses `create`'s `env` over the wire — `FORBIDDEN_WIRE_KEYS` cannot guard it (its forbidden key
  `env` IS the field that must cross), so #104 rests on mTLS + the per-run canary registered BEFORE the
  networked create + never logging the create payload.
- **Slice 3 — the `(compose)` CleanupAuthority variant + the reconcile idempotent-inversion guard.** A
  no-op/trust cleanup variant (the worker-side `labelsEqual` is vacuous own-vs-own — the server gate owns
  the decision), plus guarding `reconcile.ts:93` against a gate-thrown `ResourceNotAvailableError` (an
  already-gone id INVERTS from a returned `CleanupResult` to a throw over the gate, aborting the sweep).
- **Slice 5 (= DEP-012 Slice 5, the user's "next")** — deploy: the AM image, the compose
  `AOA_WORKER_PROVIDER_URL` + control-plane-public-key env, amending `checkDispatchDefaultOff` at go-live,
  mTLS on the worker→AM control-net hop, and the real control-plane keypair.

---

# Slice 1 — the server-side owned-labels-capability mint (in the resolve reply)

**Status:** design (2026-08-29) — **3-agent adversarial review COMPLETE; all findings verified against source
and folded in below.** Ships INERT. The review reshaped Slice 1: it is NOT just "add a mint call" — it needs
(a) a PACKAGING extraction (the pure primitive → a leaf, or the control-plane image closure reds), (b) the mint
sited INSIDE the broker tenant-tx closure (the reply assembler can't build 2 of the 7 labels), (c) a fresh
7-field object literal (a `{...fenceIdentity}` spread leaks the FENCE TOKEN), (d) `ResolvedFenceContext` extended
to surface the lease deadline, (e) NO `DEP-011-*-result.md` (it would red `check-finding-ownership`). The review
outcome is §1.12.

## 1.1 — verified terrain (corrected against source)

- **The resolve reply** (`server/src/services/execution-secret-resolve.ts`): the ALLOW outcome is
  `{ outcome:"resolved", envTarget, value }`; every refusal is the coarse `{ outcome:"denied", reason }`
  (`:95-133`, `:27-29`). ★ But the reply ASSEMBLER `admitSandboxLocalResolution` (`:110-134`) is PURE — it
  receives only the broker `SecretResolveOutcome`, and the request schema (`:44-56`) has NO
  `targetId`/`targetGeneration`. So the fence labels are NOT in scope at the assembler (review H4).
- **The mint site is the broker tenant-tx closure, not the reply assembler.** `resolveWorkerFenceContext`
  (`worker-fence-context.ts`) returns `ResolvedFenceContext = { fenceIdentity, companyId, authorityNow }`
  (`:25-31`) — the device-proof-verified identity lives ONLY inside `createSecretBrokerService.resolve`'s
  `runInTenant` closure (`secret-broker.ts:234-258`), and the redeemed `value` materializes there too
  (after `dispatchResolvedSecret`, `:264-273`). `secret-broker.ts:236` ALREADY calls
  `resolveWorkerFenceContext`. So the mint is sited at the broker FINALIZE point; the capability rides the
  `resolved` `SecretResolveOutcome` arm out through the pure assembler untouched.
- **★ `fenceIdentity` is `ActiveFenceRequest` — it carries TWO secrets beyond the 7 labels** (review H2):
  `fence` (the live per-attempt bearer TOKEN, `job-fence.ts:447`), `targetAuthorityKey`, `profileHash`,
  `providerConstraintHash`, `companyId`, `attemptId` (`:434-448`). `labelsEqual` compares ONLY the 7 named
  fields with `===` (subset-blind, `provider.ts:131-142`); the signed canonical picks only the 7
  (`capability.ts:65-74`). So a `{...fenceIdentity}` spread would leak the fence token into `ownedLabels`
  → into the worker reply, and EVERY test in the naive suite (labelsEqual, a value-only scan) stays green.
- **★ The field NAMES differ** (review H1): `ActiveFenceRequest` has `attemptNumber` + `targetGeneration`
  (+ a decoy `attemptId: string`), NOT `attempt`/`deviceGeneration` (`job-fence.ts:438-444`). The target
  `ResourceLabels` needs `attempt`/`deviceGeneration`. The map is `attempt ← attemptNumber`,
  `deviceGeneration ← targetGeneration`.
- **★ The lease deadline is NOT surfaced** (review H3): `resolveWorkerFenceContext` checks
  `context.lease.expiresAt` (`:109`) then DISCARDS it — `ResolvedFenceContext` returns only `authorityNow`
  (a DB clock, `:30`). Bounding the expiry (§1.4) REQUIRES extending that return to carry the deadline.
- **The mint primitive** `signOwnedLabelsCapability(fields, privateKey)` (`capability.ts:84`) — Ed25519
  over the ordered tuple; REJECTS a non-integer `expiresAt` (`:92-94`). NO production caller today — Slice
  1 is the FIRST; it is NOT a gate-clause-wiring symbol. ★ It lives in `@armyofagents/provider-wire`,
  whose RUNTIME deps are `worker-daemon` + `sandbox-e2b-provider` + `worker-protocol`
  (`provider-wire/package.json:35-38`) — see §1.2.0 (the packaging problem, review H5).
- **The verify side already ships** (β2): `adapter-manager` accepts the optional injected
  `controlPlanePublicKey` + fail-closes; the create-gate (β1) enforces
  `labelsEqual(spec.resourceLabels, cap.ownedLabels)`. ★ Verify RE-canonicalizes the received `ownedLabels`
  (`capability-verify.ts:65`), so a drifted-but-self-consistent tuple still VERIFIES — a coercion/field
  drift is caught ONLY at the gate's `labelsEqual` against the WORKER's tuple, never at verify. §1.9 must
  assert BOTH.
- **The parity target** — the worker's `labelsFor(handoff)` (`supervisor.ts:205-214`, a closure-local
  inner function, NOT exported) is the EXACT tuple that becomes `spec.resourceLabels`: `organizationId:
  String(job.organizationId)`, `targetId: identity.targetId`, `workerId: String(offer.workerId)`, `jobId:
  String(job.jobId)`, `attempt: job.attempt` (a NUMBER), `leaseId: handoff.leaseId`, `deviceGeneration:
  identity.deviceGeneration` (a NUMBER). Value-parity across the two stores rests on the ack-current pins
  `worker.deviceGeneration === auth.targetGeneration === target.deviceGeneration` (`job-leasing.ts:256-268`),
  not on the mint (review E).

## 1.2.0 — ★ THE PACKAGING PROBLEM (review H5 — do this FIRST)

The server (the CONTROL-PLANE image) cannot import `signOwnedLabelsCapability` from `provider-wire`: that
edge drags `worker-daemon` + `sandbox-e2b-provider` into the control-plane runtime closure, which
`docker/control-plane/Dockerfile` deliberately excludes ("server + UI ONLY … NO worker daemon", `:3,:8`)
and `check-image-deps-stages.mjs` enforces exact ("no fewer, and NO MORE", `:6-13`). So Slice 1 FIRST
EXTRACTS the PURE primitive — the `OwnedLabelsCapability` type + the version/audience consts +
`buildOwnedLabelsCapabilityCanonical` + `signOwnedLabelsCapability` (runtime dep = `node:crypto` ONLY;
`ResourceLabels` is a TYPE-only import → `worker-daemon` a devDep, never a runtime dep) — into a NEW LEAF
package `@armyofagents/provider-capability`. `provider-wire/capability.ts` + `adapter-manager`'s
`capability-verify.ts` RE-IMPORT from the leaf (behavior-preserving — the ONE shared canonical is
preserved, so mint↔verify parity holds); the SERVER imports the leaf directly. The control-plane image
deps-stage then COPIES exactly ONE new workspace pkg (the leaf, closure = node:crypto), never
worker-daemon. This is a mechanical RE-HOME of the B1-frozen primitive (same bytes, same behavior — a
mint↔verify byte-parity test proves it), NOT a schema change. Touch-points: a new `packages/provider-capability/`
(+ `projects[]`, tsconfig refs), the two re-import edits, `server/package.json` gains the leaf as a runtime
dep + `provider-wire` stays put, the `docker/control-plane/Dockerfile` deps-stage COPY + `check-image-deps-stages`.

## 1.2 — what Slice 1 builds

INSIDE `createSecretBrokerService.resolve`'s tenant-tx closure, at the finalize point (`secret-broker.ts:264-273`)
after `dispatchResolvedSecret`, on the outcome that is EXACTLY `resolved ∧ seam === "sandbox_local_only"`
(review M2 — NOT "not denied"; `device_handoff` and the network seams carry NO capability): mint an
`OwnedLabelsCapability` over a FRESH 7-field object literal built from `ctx.fenceIdentity` (§1.3) +
`expiresAt = min(authorityNow + TTL, leaseDeadline)` (§1.4), signed with an INJECTED control-plane Ed25519
private key (on the `createSecretBrokerService` constructor, `worker-control.ts:157`; a TEST keypair for the
component, the REAL key deploy-owed). Carry the capability on the `resolved` `SecretResolveOutcome` arm →
widen `admitSandboxLocalResolution` + the route JSON to pass it through UNTOUCHED. When NO key is configured
the capability is OMITTED — NEVER fail the resolve. Ships INERT (the worker reads the reply as a plain
record and ignores unknown keys — `secret-redemption.ts:87-102`, verified; the server reply has NO response
schema — `worker-control.ts:749-755`).

## 1.3 — ★ THE MINT ≡ labelsFor PARITY INVARIANT + the fresh-literal rule (central correctness + containment)

The gate enforces `labelsEqual(spec.resourceLabels, cap.ownedLabels)`, and `spec.resourceLabels` IS
`labelsFor(handoff)`. So the minted `ownedLabels` MUST equal `labelsFor` field-for-field, or the gate
rejects EVERY networked create (silent, total dispatch failure). Build it as a **FRESH 7-field object
literal — NEVER `{...ctx.fenceIdentity}`, NEVER `as ResourceLabels`** (the cast silences excess-property
checking and leaks the fence token, review H2). The exact map + coercions:
```
{ organizationId: String(fenceIdentity.organizationId),
  targetId:       fenceIdentity.targetId,
  workerId:       String(fenceIdentity.workerId),
  jobId:          String(fenceIdentity.jobId),
  attempt:        fenceIdentity.attemptNumber,      // NUMBER — do NOT String()
  leaseId:        fenceIdentity.leaseId,
  deviceGeneration: fenceIdentity.targetGeneration } // NUMBER — do NOT String()
```
(String the same three the worker does; keep `attempt`/`deviceGeneration` numeric; `labelsEqual` is strict
`===`, `provider.ts:131-142`, so a number/string drift is fatal.) The anti-drift proof is an INTEGRATION
harness (review M1 — `labelsFor` is not importable): drive ONE real `createSupervisor` `create` against the
existing recording fake (`__tests__/support/fake-provider.ts`), CAPTURE `spec.resourceLabels` (which
`createSpecFor` passes to `provider.create`, `supervisor.ts:229-235,371`), build the server `fenceIdentity`
from the SAME job/lease/target row, and assert `labelsEqual(minted.ownedLabels, capturedSpec.resourceLabels)`.
Use DISTINCT per-field fixture values (esp. `attempt != deviceGeneration`, both numbers; org/target/worker/
job/lease all different) so a field-swap / wrong-source mutation is actually killed (the "identity map diffed
a copy of itself" trap).

## 1.4 — expiry bounding (requires extending ResolvedFenceContext)

`expiresAt = min(authorityNow.getTime() + shortTtlMs, leaseDeadline)` — finite integer (the primitive
rejects otherwise) AND clamped to the lease deadline (a token must not outlive the lease it authorizes).
`authorityNow` (a DB `currentDatabaseTime()` Date, `:76`) is the injected clock; the lease deadline is NOT
in scope today, so Slice 1 ADDS `leaseDeadline: context.lease.expiresAt` (Date→ms) to `ResolvedFenceContext`
(`worker-fence-context.ts:25-31,:135`) — a small change to a shared DAT-002 function (also used by
artifact-commit / transfer-grant; additive, no behavior change to them). Test: a lease with deadline D →
`expiresAt <= D.getTime()`; a too-long TTL is clamped to D (not `now+TTL`). Pinning to D also makes the N
per-handle mints (§1.7) byte-identical, so Slice 2's dedup is trivial (review L1/M-per-handle).

## 1.5 — the positive mint gate + no leak on the refusal paths

The mint fires on EXACTLY `outcome.outcome === "resolved" && outcome.seam === "sandbox_local_only"` (review
M2) — the SAME predicate `admitSandboxLocalResolution` admits (`execution-secret-resolve.ts:116,119`). The
THIRD outcome `device_handoff` (the desktop keystore path, `secret-broker.ts:115-118`) and the `fence_proxy`/
`remote_server_fenced` seams carry NO capability. Every `denied`/`malformed` carries none (coarse refusal
preserved). `check-secret-resolve-vectors` re-derives only the DECISION (never the reply/capability,
`:79-233`) → unperturbed, no fixture change (review F6, SOUND).

## 1.6 — Decision #104 (TWO secrets in scope, not one)

The mint site has BOTH the redeemed model `value` AND the fence bearer token (`fenceIdentity.fence`) +
`targetAuthorityKey`/`profileHash`/`providerConstraintHash` in scope. The capability is signed over the 7
LABELS ONLY (`capability.ts:65-73`); the fresh-literal rule (§1.3) keeps everything else out of
`ownedLabels`; `sig`/`value`/the token are never logged. The token authorizes; the redeemed `value` (Slice
2) rides `create`'s `env` — independent, same reply.

## 1.7 — per-handle multiplicity (resolved)

The resolve route is hit once per secret handle (`secret-redemption.ts:119-123`), so a run mints N times.
With `expiresAt` pinned to the lease deadline (§1.4) all N mints are BYTE-IDENTICAL; the worker (Slice 2)
uses any. A real coding run has ≥1 model-key handle (`PROVIDER_AUTH_ENV_TARGETS`), so N≥1 and the
zero-handle gap is out-of-scope for the E7-1 journey. Ordering is safe: `materializeRunSecrets` (step 0)
runs BEFORE `provider.create` (step 1) (`supervisor.ts:335-371`), so the capability is in hand before the
gated create (review SOUND).

## 1.8 — fences (what Slice 1 does NOT touch)

The worker/daemon (Slice 2); the `NetworkedProviderDriver` (built); the `adapter-manager` server/gates/
ledger (β1/β2); the CleanupAuthority variant + reconcile guard (Slice 3); the frozen worker-protocol +
`SandboxProvider` port; the capability SCHEMA/CANONICAL/SIGNER BEHAVIOR (`v:1`, B1 — §1.2.0 is a RE-HOME,
not a change). NO real control-plane keypair (deploy/Slice 5 — injected key, absent ⇒ inert). NO mTLS, NO
compose change. NO worker-side change. **NO `DEP-011-*-result.md`** (review H6 — it would mark DEP-011
"shipped" and red `check-finding-ownership`; the Slice-1 result is captured in this design doc + the go-book
+ memory). E6-F003 stays OPEN + owned by DEP-011.

## 1.9 — TDD + component test (inert, fail-first)

1. Packaging (§1.2.0) FIRST: extract the leaf; RED a mint↔verify byte-parity test (the leaf's canonical ≡
   the prior output); re-home the two re-imports; `check-image-deps-stages` green (control-plane closure
   grew by the leaf ONLY, no worker-daemon).
2. RED: on the resolve ALLOW path (`resolved ∧ sandbox_local_only`) with an injected test CP key, the
   `resolved` reply carries a capability that (a) VERIFIES against the test CP public key, AND (b) has
   `ownedLabels` `labelsEqual` to the CAPTURED real `spec.resourceLabels` (§1.3 harness — assert BOTH; verify
   alone is subset/self-consistent-blind), (c) `Object.keys(ownedLabels).sort()` === the exact 7-key set
   (backstops labelsEqual's subset-blindness — kills the fence-token leak), (d) finite `expiresAt <= the
   real lease deadline`, (e) ABSENT when no CP key is configured (inert), (f) ABSENT on `device_handoff` /
   `denied` / `malformed`.
3. #104 containment (SERVER-side, review M3): spy the resolve-path logger — assert it NEVER receives the
   reply/capability/`sig`/`value`; assert the audit columns exclude the capability (the audit UPDATE runs
   BEFORE the mint, `job-control.ts` mutator — verified-safe, the test locks it); assert the capability
   bytes contain NEITHER the redeemed `value` NOR the fence token / `targetAuthorityKey` / `profileHash` /
   `providerConstraintHash`. (Do NOT rely on the worker event-body scan — wrong side of the wire.)
4. Mutation sweep: `{...fenceIdentity}` spread (the 7-key + token-scan tests kill it); drop a `String()` /
   stringify `attempt` (the labelsEqual harness kills); `deviceGeneration ← attemptNumber` swap (distinct
   fixtures kill); mint on `device_handoff`/denied (the absence tests kill); `now+TTL` unclamped (the
   deadline test kills); a capability logged (the logger spy kills).

## 1.10 — guards (run the WHOLE set — β2's lesson: the design's own list missed two)

- **`check-image-deps-stages`** — the reason for §1.2.0. WITHOUT the leaf extraction, the server→provider-wire
  edge reds the control-plane closure. WITH it, green (closure grows by the node:crypto-only leaf). MUST be
  planned, not disclaimed.
- **`check-finding-ownership`** — Slice 1 ships NO `DEP-011-*-result.md` (else `successor_missing` on E6-F003,
  which has `ownerStillOpen` + no `successor`, `finding-ownership.json:9-13`). DEP-011 stays uncompleted.
- **`check-secret-resolve-vectors`** (green, decision-only, unperturbed); **`check-gate-clause-wiring`**
  (`signOwnedLabelsCapability` not a gated symbol; NO `E2bSandboxProvider` named → E7-1 stays `unwired` at 4);
  **`check-test-inventory`** (--write re-pin for the new server + leaf tests); a NEW package →
  `projects[]`/tsconfig graph coverage. NOT boot-roots (no worker boot). Run the WHOLE policy set locally.

## 1.11 — result note (BUILT 2026-08-29 — IN THIS DOC, not a -result.md; E6-F003 stays OPEN + owned)

**Slice 1 SHIPPED INERT, CI-verified.** The control plane now mints a signed Ed25519
`OwnedLabelsCapability` on the `resolved ∧ sandbox_local_only` `resolveExecutionSecret` reply,
behind an INJECTED control-plane key. No key is wired in `app.ts` today (deploy/Slice 5), so the
reply is byte-identical to pre-DEP-011 and nothing consumes the capability yet (Slice 2).

**What landed:**
- **Packaging (§1.2.0):** new leaf `@armyofagents/provider-capability` (`packages/provider-capability/`,
  runtime dep = `node:crypto` ONLY; `ResourceLabels` a TYPE-only devDep on worker-daemon). The B1
  primitive (schema + `buildOwnedLabelsCapabilityCanonical` + `signOwnedLabelsCapability` + version/
  audience consts) was moved VERBATIM; `provider-wire/src/capability.ts` now RE-EXPORTS the leaf, so
  the ONE shared canonical is preserved (a byte-parity anchor test pins the exact canonical string).
  Server gains the leaf as a RUNTIME dep + a `docker/control-plane/Dockerfile` deps-stage COPY;
  `check-image-deps-stages` GREEN (control-plane closure grew by the leaf ONLY — never worker-daemon).
- **The mint (§1.2–§1.6):** `server/src/services/owned-labels-mint.ts` — `ownedLabelsFromFenceIdentity`
  (a FRESH 7-field literal, field-name map `attempt←attemptNumber`/`deviceGeneration←targetGeneration`,
  String() the three the worker strings, numeric attempt/deviceGeneration) + `applyOwnedLabelsCapability`
  (the positive gate: mints ONLY on `resolved ∧ sandbox_local_only` with a key; never throws) +
  `mintOwnedLabelsCapability` (expiry = `min(now+TTL, leaseDeadline)`, a finite integer). Wired into the
  broker tenant-tx finalize point (`secret-broker.ts`), carried on the `resolved` `SecretResolveOutcome`
  arm, passed through `admitSandboxLocalResolution` + the route JSON UNTOUCHED (present only when minted).
- **Expiry (§1.4):** `ResolvedFenceContext` extended with `leaseDeadline: context.lease.expiresAt`
  (additive; artifact-commit / transfer-grant ignore it).
- **Key injection:** optional `controlPlaneSigningKey` threaded `workerControlRoutes` opts → broker.
  `app.ts` unchanged (key undefined ⇒ inert).

**Tests + mutation:** leaf 15 (incl. byte-parity anchor) · provider-wire 28 · adapter-manager 99 (incl. an
explicit leaf-minted→verify crossing) · server `owned-labels-mint.test.ts` 11 · worker
`supervisor-labels-parity.test.ts` 1 (captures the REAL `labelsFor` from a live `createSupervisor` create).
Mutation sweep 6/6 killed: `{...fenceIdentity}` spread (5 fail — 7-key + #104 scan + parity + verify);
stringified `attempt` (3 fail); `deviceGeneration←attemptNumber` swap (3 fail); dropped seam guard (1 fail);
unclamped `now+TTL` (1 fail); device_handoff/denied mint (absence tests). Whole `policy` set GREEN
(`check-image-deps-stages`, `check-secret-resolve-vectors` unperturbed, `check-gate-clause-wiring` untripped +
E7-1 stays `unwired` at 4, `check-finding-ownership` GREEN with NO result doc, `check-adapter-manager-boundary`,
`check-dependency-graph`, `check-test-inventory` re-pinned). Full graph typecheck GREEN.

**Parity harness — realized as TWO anchored halves (deviation from §1.3's single-test wording, see §1.13).**
The recording fake is worker-daemon test-support (NOT barrel-exported) and worker-daemon's 2-dep boundary
forbids importing the server mapping, so the single cross-package `labelsEqual(minted, capturedSpec)` test
§1.3 describes is not importable as written. Instead: a worker test CAPTURES the real `spec.resourceLabels`
from a live supervisor create and pins it to an explicit DISTINCT-valued tuple (`attempt=1 != deviceGeneration=7`,
both numbers; org/target/worker/job/lease all different); the server test proves `ownedLabelsFromFenceIdentity`
reproduces the SAME tuple from a full `ActiveFenceRequest`. A field-swap on EITHER side diverges from the
anchor. Byte-parity of the leaf re-home is separately proven (the exact-canonical-string anchor + the 99
adapter-manager verify tests + an explicit leaf-mint→AM-verify test).

## 1.13 — build deviations from the design (repo contradicted §1.2.0/§1.3; reported, not papered over)

1. **`capability-verify.ts` kept on the `@armyofagents/provider-wire/capability` SUBPATH, not re-homed to
   the leaf directly.** §1.2.0 said re-home both consumers to the leaf. But the β2 `check-adapter-manager-boundary`
   guard (shipped AFTER §1.2.0 was written) enforces adapter-manager's runtime `dependencies` as an EXACT set
   {provider-wire, sandbox-e2b-provider, worker-daemon} AND forbids any new runtime import in its source — so a
   direct leaf import RED-ed policy. The design's INTENT is nonetheless fully met: `provider-wire/capability.ts`
   now re-exports the leaf VERBATIM, so verify resolves to the ONE leaf `buildOwnedLabelsCapabilityCanonical`
   (same function object — mint↔verify parity holds), the subpath still avoids loading the codec/driver, and the
   SERVER (the packaging target) imports the leaf directly. The leaf is an adapter-manager DEVdependency for the
   component test only. Net: no security allow-list widened, boundary unchanged, one-canonical preserved.
2. **Parity harness split into two anchored halves** (see §1.11) — the fake-provider is not barrel-exported and
   worker-daemon cannot import the db-typed server mapping.

Both are STRICTLY SAFER than the literal design and preserve every security invariant (PARITY, #104,
fresh-literal, FROZEN behavior, inertness). No capability behavior changed; §1.2.0 stayed a pure re-home.

## 1.12 — review outcome (3 agents, 2026-08-29, every finding verified against source)

Three reviewers (parity/expiry; #104/no-leak; mint-site/inertness/guards). The two highest-value checks
PASSED: **inertness is genuinely sound** (no strict worker-side schema; the server reply has none) and the
**mint math** (parity, #104, injected key, ordering) is fundamentally right. But 6 HIGH + 3 MED reshaped the
build, all folded above:
- **H1 field-name trap** (`attemptNumber`/`targetGeneration`, not `attempt`/`deviceGeneration`) → §1.1/§1.3 explicit map.
- **H2 fence-token leak** (a `{...fenceIdentity}` spread leaks `fence`/`targetAuthorityKey`/hashes; labelsEqual + a value-scan miss it) → §1.3 fresh-literal rule + §1.9 exact-7-key + widened token scan.
- **H3 lease deadline not surfaced** → §1.4 extend `ResolvedFenceContext` + clamp.
- **H4 mint site** (targetId/targetGeneration absent at the pure reply assembler) → §1.2 mint in the broker tenant-tx closure; carry on the `resolved` arm.
- **H5 packaging** (server→provider-wire drags worker-daemon into the control-plane image) → §1.2.0 extract the pure primitive to a leaf.
- **H6 result-doc trap** (a `DEP-011-*-result.md` reds `check-finding-ownership`) → §1.8/§1.10 no result doc.
- **M1 anti-drift** (`labelsFor` not importable; value-collision masking) → §1.3 integration harness + distinct fixtures.
- **M2 positive gate** (`device_handoff` must carry none) → §1.5 `resolved ∧ sandbox_local_only`.
- **M3 containment surface** (server reply/logger/audit, not the worker event stream) → §1.9.3.

**Confirmed SOUND:** inertness; `materializeRunSecrets`-before-create ordering; the injected-key story;
`check-secret-resolve-vectors` unperturbed; `check-gate-clause-wiring` untripped + E7-1 stays unwired; the
single shared canonical; `labelsEqual` strict; #104 label/value separation in principle.

**Design is GO for the §9 build prompt** (with §1.2.0's leaf extraction as step 0).
