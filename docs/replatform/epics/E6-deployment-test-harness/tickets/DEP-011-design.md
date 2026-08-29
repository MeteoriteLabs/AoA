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
- **Slice 2 — the worker networked composition root + per-run provider factory + the credential
  crossing.** The biggest slice — **SUB-SLICED 2a/2b** (recon 2026-08-29):
  - **2a (the meat, security-critical, CI-verifiable inert):** an additive `makeRunProvider?` per-run
    provider FACTORY (a TYPE in worker-daemon; the impl comes from the outside root) + the worker-side
    capability threading (`classifyResolveResponse` reads the minted cap Slice 1 now puts on the reply →
    `synthesiseRunSecrets`/`materializeRunSecrets` carry + **dedup N→1** → the supervisor builds a per-run
    `NetworkedProviderDriver` + BOTH authorities **inside `runLifecycle` AFTER redemption**, because the
    capability does not exist at `buildRun`) + the credential crossing (#104) — proven on an IN-PROCESS
    loopback gated `createProviderServer` inside a worker-daemon `.test.ts`. Ships INERT (worker-daemon
    still passes nothing). Flips no gate.
  - **2b (composition root + guards):** a NEW package `packages/worker-networked-host` + bin reading
    `AOA_WORKER_PROVIDER_URL`, building the factory of `NetworkedProviderDriver`s (worker-keystore CANNOT —
    its 3-dep pin forbids importing `provider-wire`); extend `BIN_DIRS` + register in
    `boot-roots-expectation.json` (resolver-posture default-none); document the env. Depends on 2a.
  Boundary-clean throughout (worker-daemon sees only the factory TYPE; the driver + root live OUTSIDE the
  daemon's pinned 2-dep boundary). The redeemed model key crosses `create`'s `env` over the wire —
  `FORBIDDEN_WIRE_KEYS` cannot guard it (its forbidden key `env` IS the field that must cross), so #104
  rests on the per-run canary registered BEFORE the networked create + never logging the create payload;
  mTLS is Slice 5.
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

---

# Slice 2a — the per-run provider factory + capability threading + the credential crossing (worker side)

**Status:** design (2026-08-29) — **3-agent adversarial review COMPLETE; all 9 findings verified against source
and folded in; the teardown fork RESOLVED → Option A (server owns reaping).** The review found the first-cut
design was NOT safe (the lease-clamped capability can't authorize teardown → a live-sandbox strand silently
reported as "success"; the "unset authorities" late-binding NPE'd; a type import of the capability tripped the
daemon boundary). The reshaped 2a below is honest-cleanup-only; the server-side reaper is the NEXT slice. Ships
INERT (worker-daemon passes nothing for the shipped binary; the loopback driver lives only in a `.test.ts`).
Review outcome + the fork rationale: §2a.12.

## 2a.0 — the teardown model (Option A) + the one structural idea

**Option A — the adapter-manager (the E2B key-holder, the sandbox OWNER) owns reclamation.** An ephemeral worker
cannot be trusted to clean up after itself (it crashes / is killed / loses its lease, after which its lease-bound
capability is — correctly — dead). So a live tenant sandbox is ALWAYS reclaimable only via a server-side
reconcile reaper. 2a's job on the worker side is HONEST cleanup: tear down promptly while the cap is VALID, and
when the cap is EXPIRED record an honest orphan (NEVER a false "success") and trust the server to reap. **The
server-side reaper is the NEXT slice** (net-new — the review confirmed the existing MIG-002 sweeper reaps DB rows
ONLY, never a provider `destroy`); until it lands the bounded E2B create-TTL is the honestly-stated interim
backstop. Re-mint-on-renewal (prompt worker teardown of LONG runs) is a deferred COST optimization, not a
correctness requirement under A.

**The structural idea.** The capability is PER-RUN (`ownedLabels` = `labelsFor(handoff)`, gate-enforced
`labelsEqual`) and a `NetworkedProviderDriver` binds its capability at CONSTRUCTION (`driver.ts:86-90`, readonly;
the `SandboxProvider` port has no per-op capability slot — frozen, E4-F002). But the capability does not exist
when the authorities are first built: `accept` → `buildRun` (builds `new EffectAuthority(deps.provider,fence)` +
`new CleanupAuthority({provider: deps.provider,…})`, `supervisor.ts:527-528`) → `runLifecycle` → step 0
`materializeRunSecrets` (yields env AND the capability) → `create`. So 2a builds the networked per-run driver +
its REAL authorities INSIDE `runLifecycle` after redemption — but `buildRun` must NOT leave the authorities unset
(§2a.3).

## 2a.1 — verified terrain

- **The wire ALREADY carries the capability from the real server; only the worker's parser drops it.**
  `execution-secret-resolve.ts:94-107,:140` returns `ownedLabelsCapability?` on the `resolved` arm;
  `classifyResolveResponse` (`secret-redemption.ts:87-102`) reads only `outcome`/`envTarget`/`value`/`reason`.
- **The per-run secret flow** `materializeRunSecrets` (`dispatch-runtime.ts:134-151`) → `synthesiseRunSecrets`
  (`secret-redemption.ts:113-132`) → `{env,canaries}`, in `runLifecycle` step 0 BEFORE `create`. The canary is
  seeded BEFORE create (`supervisor.ts:367` < `:378`); 2a preserves that on the networked branch.
- **★ The daemon boundary rejects even a TYPE import of the capability (review HIGH-1).** `check-worker-daemon-boundary`
  scans every non-`*.test.ts` file under `src/` and the extractor has NO `import type` awareness
  (`worker-protocol-boundary.mjs:355-381`), so `import type { OwnedLabelsCapability } from
  "@armyofagents/provider-capability"` in daemon runtime source is a "forbidden runtime import". And
  `isValidCapability` is module-PRIVATE (`codec.ts:210`, not exported). So worker-daemon must treat the capability
  as OPAQUE — a LOCAL structural type + a locally-vendored shape-guard (§2a.2). The `.test.ts` IS excluded, so it
  may import the real type + `provider-wire`/`adapter-manager`/`provider-capability` as DEVdeps (a first for
  worker-daemon; `evaluateManifest` pins only RUNTIME deps; no tsc project-reference cycle — neither package uses
  `references`).
- **Frozen:** worker-protocol (10-op list closed); the `SandboxProvider` port (no capability slot); the daemon
  2-dep RUNTIME pin (the daemon names only the factory TYPE; the driver + root live OUTSIDE it).

## 2a.2 — what 2a builds

1. **The additive `makeRunProvider?` factory — a LOCAL type in worker-daemon.** `makeRunProvider?: (input: {
   handoff: LeaseHandoff; capability?: OwnedLabelsCapabilityLike }) => SandboxProvider`, where
   `OwnedLabelsCapabilityLike` is a LOCAL structural interface (`{ readonly v:number; readonly audience:string;
   readonly ownedLabels: ResourceLabels; readonly expiresAt:number; readonly sig:string }`, the LOCAL
   `ResourceLabels`) — worker-daemon NEVER imports the leaf's type (review HIGH-1). The outside root (2b) supplies
   the impl; structural assignability bridges the two. Thread it additively through `SupervisorDeps` +
   `ComposeDispatchRuntimeDeps` alongside `deps.provider?`. **★ Precedence (review F4):** exactly one of
   `provider`/`makeRunProvider` may be set — `makeSupervisor`/`composeDispatchRuntime` FAIL FAST if both are
   present. **★ And `makeRunProvider` REQUIRES `materializeRunSecrets` (review F5)** — the post-redemption rebuild
   only runs inside the `if (deps.materializeRunSecrets)` block (`supervisor.ts:341`), so `makeRunProvider` without
   it would leave the no-op authorities in place forever (a silent misconfig, fail-safe but wrong) — fail fast at
   construction pairing them. The gates become `!provider && !makeRunProvider ⇒ no_provider` in BOTH `decideDispatchComposition`
   (`compose-dispatch.ts:88`) AND `shouldComposeSession` (`:115-120`); the `:112-113` "same-provider" invariant
   comment is updated; `provider` moves from required to optional in both dep shapes.
2. **The worker-side capability threading + dedup-on-labels.** `ResolveClassification.resolved` widens with
   `ownedLabelsCapability?: OwnedLabelsCapabilityLike`; `classifyResolveResponse` reads
   `body.ownedLabelsCapability` through a LOCALLY-VENDORED shape-guard (mirroring `isValidCapability`, pinned by a
   contract test — the "vendor + pin" pattern `secret-redemption.ts:17-18` already uses). `synthesiseRunSecrets`
   returns `{env,canaries,capability?}`. **★ Dedup on `ownedLabels`, NOT the whole cap (review MED-3):** the N
   per-handle caps share one fence identity so their `ownedLabels` are provably identical, but `expiresAt`/`sig`
   can differ by a few ms (`min(authorityNow+TTL, D)` with a fresh `authorityNow` per handle when the TTL — not
   the deadline — binds). Dedup + fail-closed on the `ownedLabels`/`v`/`audience` tuple ONLY; keep any one
   non-expired cap. Treat all-absent (desktop, no key) as a NO-OP so a future keyed desktop run never fails
   (§2a.8).
3. **The supervisor branch — NO-OP null-object authorities at `buildRun`, REAL authorities post-redemption (review
   HIGH-2).** `ActiveRun.effect`/`.cleanup` become MUTABLE (drop `readonly`, `supervisor.ts:172-173`), NEVER unset.
   In-process/desktop (`deps.provider`): build the real authorities at `buildRun` — BYTE-IDENTICAL. Networked
   (`deps.makeRunProvider`): `buildRun` builds NO-OP null-object `EffectAuthority`/`CleanupAuthority` (over a no-op
   provider — `withdraw()` is a safe flag, `list()`→[], effectful ops throw only if wrongly reached); then
   `runLifecycle`, after `materializeRunSecrets` yields the capability, REBUILDS `run.effect`/`run.cleanup` over
   the real per-run driver `deps.makeRunProvider({handoff, capability})`. **★ The networked `CleanupAuthority` is
   the honest TRUST variant (Option A), NOT the standard gated `converge`** (§2a.5). NO `!` non-null assertions on
   `run.effect`/`run.cleanup` (a `!` would compile green and reship the NPE).

## 2a.3 — ★ the late-binding / null-object invariant (review HIGH-2 — the first-cut "unset" design NPE'd)

The authorities are touched UNCONDITIONALLY before any post-redemption bind — the review enumerated the sites the
first cut missed: `run.effect.withdraw()` in `accept`'s `finally` (`supervisor.ts:560`, EVERY exit),
`escalateCleanup`'s first line `run.effect.withdraw()` (`:253`) + `run.cleanup.list()` (`:262`) reached from the
secret-failure paths AND from `cancel`/`onLeaseLost` (`:565-574`, which do NOT try/catch escalateCleanup) firing
during the `await materializeRunSecrets` window (default 5s). "Unset" ⇒ a bare `TypeError` (`withdraw` of
undefined) → `runs.delete` skipped (a permanent map leak) + `accept` rejects (violating its never-reject
contract). FIX: NO-OP null-object authorities from `buildRun` make every one of those sites total and safe
("nothing created ⇒ withdraw is a no-op, list is []"); the real per-run authorities REPLACE them post-redemption.
**★ The SYNCHRONOUS-SWAP invariant (review F4):** the two reassignments (`run.effect`, `run.cleanup`) MUST be
synchronous with NO `await` between them (`makeRunProvider` is typed sync), so a concurrent `cancel`/`onLeaseLost`
(which reaches `escalateCleanup` with no try/catch, `:565-574`) during the rebuild sees EITHER both no-op OR both
real — never a half-swap. A builder who inserts an `await` between the assignments opens a half-swapped window.
**★ A known, ACCEPTED divergence (review F4):** a cancel arriving during `await materializeRunSecrets` withdraws
the DISCARDED no-op effect; the freshly-rebuilt real effect (`#active=true`) then lets `create` (`:378`) proceed,
and the sandbox is promptly reclaimed by the `if (run.cancelled)` check at `:398` (with a valid just-minted cap).
So the networked branch spins up + reclaims a sandbox for a run cancelled pre-create; desktop (real effect at
`buildRun`) throws `EffectAuthorityWithdrawnError` and never creates one. No strand; acceptable (prompt reclaim) —
recorded so §2a.8's "desktop byte-identical" is not read as networked parity on this concurrent edge.

## 2a.4 — parity (unchanged hazard, on the live wire)

The driver's `create` carries exactly `labelsFor(handoff)` (`createSpecFor`, `supervisor.ts:229-235`), which must
equal the capability's `ownedLabels` — the two-sided anchor test from Slice 1 (`supervisor-labels-parity.test.ts`
+ `owned-labels-mint.test.ts`) already guards mint≡labelsFor; 2a keeps the driver honest. Same total-dispatch-
failure hazard as Slice 1, now live.

## 2a.5 — ★ the honest TRUST cleanup variant (Option A — replaces the first cut's masked strand)

**The defect (verified):** the first cut wired the STANDARD `CleanupAuthority` around the cap-gated networked
driver. On teardown with an EXPIRED cap the gate refuses with the uniform `ResourceNotAvailableError`, and
`#convergeOne` reads RNA as "already gone → `return "success"`" (`cleanup-authority.ts:281,:300`) → a LIVE,
billing tenant sandbox reported cleaned-up, metric `success`, ZERO signal. And because the cap is minted once,
clamped to the FIRST lease deadline, and never re-minted on renewal (`lease-renewal.ts` has no mint path), this
fires on the PURE HAPPY PATH for any run longer than the cap TTL — every real (>5min) coding run.

**The fix (Option A) — CLOCK-FIRST, with an RNA re-check; the orphan is a METRIC LABEL, not a new status.**
The worker HOLDS the cap and its `expiresAt`, and has the supervisor `now` clock. The decision is the worker's,
NOT the gate's ambiguous RNA:
- **Before each gated networked teardown op, check `expiresAt > now` (worker clock).** EXPIRED ⇒ skip the gate
  entirely and record an orphan (a doomed round-trip is pointless). VALID ⇒ attempt the teardown.
- **On a returned uniform RNA from an attempted (valid-at-issue) op, RE-READ the clock (review F2 — skew-safe):**
  the gate checks `expiresAt > now` on the ADAPTER-MANAGER's clock (`capability-verify.ts:85`), the worker on its
  own. If the cap expired DURING the round-trip (worker↔AM skew) ⇒ orphan (do NOT read RNA as "gone"). If still
  valid on re-read ⇒ the sandbox is genuinely gone ⇒ `success`. This is the ONLY point RNA is consulted, and only
  after the clock says the cap should still work.
- **The orphan encoding (review F1 — the frozen-type mechanism).** `CleanupStatus` is the CLOSED union
  `"success"|"failed"` (`provider.ts`) and `SupervisorRunStatus` is frozen (`supervisor.ts:155`) — so the orphan
  is NOT a new status and NOT a run terminal (the run terminal is already legitimately emitted, e.g. `succeeded`
  at `:488`, BEFORE the `:492` destroy strands the sandbox — a new "orphan terminal" would CORRUPT it). Instead
  the networked-expired branch emits a DISTINCT `CLEANUP_OUTCOME_METRIC { outcome: "orphaned" }` label (the label
  is an open string, `supervisor.ts:296`) + a distinct `escalateCleanup` log field, WITHOUT calling the
  RNA-means-gone `converge`. "Orphaned" is measurable + distinct from BOTH `success` AND `failed` — the leak-rate
  signal the deferred reaper consumes.
- **The happy-path teardown site (review F2).** `run.effect.destroy` at `supervisor.ts:492` (the EffectAuthority,
  NOT `run.cleanup`) is the happy reclaim. For a SHORT run (cap valid) it succeeds through the gate. For a LONG
  run the cap is expired: add a PROACTIVE `expiresAt > now` check at `:492` so it records an orphan directly
  (no doomed gated round-trip) rather than throwing RNA into the `:509` catch → `escalateCleanup`.

**The three timescales (review F3 — state them, don't conflate).** (1) the cap TTL = `min(now + shortTtlMs,
firstLeaseDeadline)` (`owned-labels-mint.ts:92`); (2) the SANDBOX TTL = the create op's `ctx.deadlineMs` =
`opDeadlineMs` (`e2b-provider.ts:182-184,:205,:210`), set ONCE at create, **no keepalive/refresh**; (3) the run
length. The masked-strand scenario needs the sandbox ALIVE at run-end (so `opDeadlineMs ≥ run length`), and the
"bounded orphan window" is then EXACTLY `opDeadlineMs` (finite — `#ttl` always returns a value, so no UNBOUNDED
leak). 2a states this bound honestly; a run that outlives `opDeadlineMs` via lease renewal WITHOUT a matching
sandbox-TTL refresh is a NAMED separate gap (the refresh, like re-mint-on-renewal, is the deferred optimization).

The **server-side reconcile reaper** (the adapter-manager reclaiming orphaned sandboxes) is the **NEXT slice** —
honestly net-new (the MIG-002 sweeper reaps DB rows only, never a provider `destroy`; β1.6 is the deferral MARKER,
not a mechanism). **This absorbs what the recon had penciled as a separate Slice-3 cleanup variant** (the review
proved `escalateCleanup` routes EVERY non-happy exit through `run.cleanup`, so 2a MUST wire a networked cleanup).

## 2a.6 — fail-closed on redemption failure + zero-capability (reviews F4/F5 → handled by the null-object)

On secret-redemption FAILURE (`materializeRunSecrets` throws, `supervisor.ts:341-362`) the networked branch never
rebuilt the real authorities, so the NO-OP null-object ones handle `escalateCleanup`/`accept`-finally safely
(nothing created ⇒ nothing to withdraw/list) — no `TypeError`, no strand, terminal preserved. **★ Zero-capability
(review F5):** a networked run that resolves handles but gets NO capability (redemption succeeded, N=0 or a
`sandbox_local_only` handle with no cap) must FAIL CLOSED with a diagnosable terminal — NEVER construct a driver
with `capability: undefined` (it would be refused at the gate on every op, a mis-labeled `create_failed`). On
desktop N=0 is benign (`env={}`); the networked branch treats "no capability" as an explicit fail-closed reason.

## 2a.7 — #104 on the crossing (review: SOUND)

The redeemed key (`spec.env`) + the cap `sig` cross the provider-wire `create` (`encodeOpRequest` bare
`JSON.stringify`, `codec.ts:73-78`) — that IS the crossing. `FORBIDDEN_WIRE_KEYS` (`wire-safety.ts:18-31`) is the
worker-PROTOCOL wire, a different codec — inapplicable by construction. The review CONFIRMED no new log/event
surface leaks it: `NetworkedProviderDriver.#post` never logs (`driver.ts:181-196`); the AM op handler never logs
the body on success or error (`server.ts:176-234`); `gateCreate`/the ledger record only `{sandboxId,
resourceLabels}` (`create-gate.ts:83-84`); the supervisor logs only `resourceLabelsHash`/`leaseId` and discards
`err` (`:379-384`). The canary is seeded before create (§2a.1) so the value is scrubbed from both event streams;
the `sig` is never emitted. The create carries ONLY value + labels + sig + expiry — never the fence token (Slice
1's fresh-literal). mTLS/net-seg = Slice 5. The test asserts value + sig ABSENT from worker logs + events
(present in the create REQUEST is correct).

## 2a.8 — fences

The desktop/in-process lane is BYTE-IDENTICAL (real authorities at `buildRun`; `composed-journey` unchanged; the
dedup treats all-absent as a no-op so a future keyed desktop run never fails). Frozen: worker-protocol, the
`SandboxProvider` port, the daemon 2-dep runtime pin (daemon names only the LOCAL factory type). NO container bin
/ new package / `AOA_WORKER_PROVIDER_URL` / boot-root (2b). NO `checkDispatchDefaultOff` change (Slice 5). NO real
control-plane keypair. NO server-side reaper (the NEXT slice). NO re-mint-on-renewal (deferred optimization).
Ships INERT. NO `DEP-011-*-result.md` (E6-F003 open + owned; result note in this doc).

## 2a.9 — the component test (worker-daemon `.test.ts`) + mutation sweep

Mint the capability IN THE `.test.ts` (`signOwnedLabelsCapability` over the fixture `labelsFor(handoff)`, a TEST
keypair — `support/fake-control-plane.ts` is boundary-scanned + cannot import the mint; extend its
`seedSecretResolution` + `handleExecutionSecretResolve` with an OPAQUE one-field echo). Drive a real
`composeDispatchRuntime` with `makeRunProvider = ({capability}) => new NetworkedProviderDriver({baseUrl,
capability, fetch})` → an in-process GATED `createProviderServer({ provider: E2bSandboxProvider(MockE2bTransport),
controlPlanePublicKey: TEST_PUBLIC })` (`E2bSandboxProvider` named ONLY in the `.test.ts`, which
`check-gate-clause-wiring` excludes — E7-1 stays at 4). Assert: (a) create SUCCEEDS ⇒ cap verified; (b) env
CROSSES (`provider.peek`); (c) value + `sig` ABSENT from events AND worker logs (extend the `:223-224` scan + a
LOGGER SPY) + a positive control; (d) FAIL-CLOSED: denied redeem → no cap → no driver → `create` callCount 0,
`activeRunCount()===0` (catches the map leak the swallowing wrappers hide, review F2), no `TypeError` (logger/
process spy); (e) **cancel / lease-loss delivered MID-REDEMPTION** on the networked branch → no throw, no strand
(the null-object path); (f) **expired-cap teardown → `CLEANUP_OUTCOME_METRIC { outcome:"orphaned" }`
— a label PRESENT and DISTINCT from BOTH `"success"` AND `"failed"` (review F1), the run terminal untouched, and
the RNA-means-gone `converge` NEVER called** (the strand-masking regression test); (g) a genuinely-gone sandbox
(cap still valid on re-read) → `success`, NOT a false orphan (review F2). Mutation sweep: driver at `buildRun`
(create refused → killed); the naive "unset" authorities (mid-redemption cancel → `TypeError` → killed by (e));
expired-cap teardown routed through `converge` (masked success → killed by (f)); an RNA read as orphan WITHOUT the
clock re-check (a genuinely-gone sandbox mislabeled orphan → killed by (g)); the orphan encoded as `"failed"`
(indistinguishable from a real failure → killed by (f)'s distinctness assertion); dedup on the whole cap incl.
`expiresAt` (a 2-key run's ms delta → false fail-closed → killed); log the create payload (containment → killed);
both `provider`+`makeRunProvider` set (no fail-fast → killed).

## 2a.10 — guards (review: §2a.2's list corrected)

**★ `check-worker-daemon-boundary`** — the reason the capability is a LOCAL type + vendored guard (§2a.2): a leaf
type import in daemon runtime source REDS it (no `import type` awareness). MUST pass with the opaque-local
approach. `check-test-inventory` (--write re-pin for the new `.test.ts` + the vendored-guard contract test);
`check-gate-clause-wiring` (`makeRunProvider`/`NetworkedProviderDriver` not gated symbols; `E2bSandboxProvider`
named ONLY in a `.test.ts` → excluded from the caller count → E7-1 stays `unwired` at 4); `check-finding-ownership`
(NO result doc). NOT boot-roots / image guards (2b). Run the WHOLE policy set (the combined-root-Dockerfile inline
awk is N/A — no new package in 2a; that's 2b).

## 2a.11 — result note (BUILT 2026-08-29 — IN THIS DOC, not a -result.md; E6-F003 stays OPEN + owned)

**Slice 2a SHIPPED INERT, CI-verified.** The worker now consumes the Slice-1 minted capability: a
container worker's per-run `NetworkedProviderDriver` is built INSIDE `runLifecycle` after redemption,
carrying that run's capability, and torn down HONESTLY (orphans measured, never masked). Ships INERT —
worker-daemon passes NOTHING for the shipped binary (`decideDispatchComposition` still refuses
`no_provider`); the loopback driver + gated server live ONLY in the new `.test.ts`.

**What landed (all in `packages/worker-daemon`, boundary-clean):**
- **The local capability + guard (§2a.1/§2a.2):** `src/lease/owned-labels-capability.ts` — a LOCAL
  structural `OwnedLabelsCapabilityLike` (`v:number`/`audience:string`, WIDER than the leaf's literals) +
  a VENDORED `isOwnedLabelsCapabilityShape` (a faithful mirror of `codec.ts`'s PRIVATE `isValidCapability`)
  + `ownedLabelsCapabilityIdentity` (the dedup tuple). worker-daemon runtime source NEVER imports the leaf
  type. `owned-labels-capability-guard.contract.test.ts` PINS the guard against a REAL minted cap (the
  `.test.ts` may import `@armyofagents/provider-capability` — a first devDep for worker-daemon).
- **Capability threading + dedup (§2a.2):** `ResolveClassification.resolved` widens with
  `ownedLabelsCapability?`; `classifyResolveResponse` reads it through the guard (a malformed cap ⇒ ABSENT,
  never carried); `synthesiseRunSecrets` returns `{env, canaries, capability?}` — DEDUP + fail-closed on the
  `ownedLabels`/`v`/`audience` identity ONLY (a benign `expiresAt`/`sig` ms-delta keeps the longer-lived cap;
  a divergent `ownedLabels` throws), all-absent ⇒ `undefined` (desktop no-op). `dispatch-runtime.ts`
  `materializeRunSecrets` carries `capability?`.
- **The factory type + gates (§2a.2):** `SupervisorDeps.makeRunProvider?` + `ComposeDispatchRuntimeDeps.makeRunProvider?`
  added, `provider?` now optional; the provider gate becomes `!provider && !makeRunProvider ⇒ no_provider` in
  BOTH `decideDispatchComposition` AND `shouldComposeSession`; FAIL-FAST at `createSupervisor`: both set ⇒
  throw, `makeRunProvider` without `materializeRunSecrets` ⇒ throw.
- **The supervisor structural change (§2a.3/§2a.5/§2a.6):** `ActiveRun.effect`/`.cleanup` MUTABLE (+ `fence`,
  `networked`, `capExpiresAt`); `buildRun` builds REAL authorities on the desktop branch (BYTE-IDENTICAL) and
  NO-OP null-object authorities over `src/supervisor/noop-provider.ts` on the networked branch; `runLifecycle`
  REBUILDS the real authorities over `makeRunProvider({handoff, capability})` after redemption — SYNCHRONOUSLY
  (no `await` between the two reassignments); zero-capability ⇒ explicit `no_run_capability` fail-closed
  terminal. The networked teardown is the HONEST TRUST variant: a PROACTIVE `expiresAt > now` check at the
  happy `run.effect.destroy` records an orphan directly, and `convergeNetworked` is clock-first with an RNA
  skew re-check (expired-in-flight ⇒ orphan; still-valid + RNA ⇒ genuinely gone ⇒ success), NEVER the
  gate-masking `converge`.

**The honest orphan (§2a.5) — DEVIATION from the design's "open string" wording (reported, not papered over).**
§2a.5 F1 said the orphan label rides `supervisor.ts:296`'s "open string" `outcome`. Against the repo that is
FALSE: `metrics.ts`'s `outcome` key is a CLOSED per-key value allow-list (`CLOSED_LABEL_VALUES.outcome`), so
`inc(CLEANUP_OUTCOME_METRIC, {outcome:"orphaned"})` would THROW on an unregistered value. Fix: register
`"orphaned"` in that closed set (additive, low-risk, fully preserves the design's intent — a DISTINCT
`cleanup_outcome{outcome="orphaned"}` label, distinct from BOTH `success` AND `failed`). The run terminal
(`SupervisorRunStatus`) is untouched (frozen); the orphan is a cleanup-outcome metric + a distinct
`orphaned`/`cleanupStatus:"orphaned"` log field, never a new status/terminal.

**Test harness — DEVIATION from §2a.9's single-drive wording (reported).** §2a.9 drives everything through one
`composeDispatchRuntime`. The reshaped test splits by what each assertion needs: **PART A** drives the FULL
`composeDispatchRuntime` → `makeRunProvider` → `NetworkedProviderDriver` → an in-process GATED
`createProviderServer({ provider: E2bSandboxProvider(MockE2bTransport), controlPlanePublicKey })` for the live
crossing — (a) cap VERIFIES at the gate, (b) the model key CROSSES into the provider create env (a capturing
mock transport — the "provider.peek"), (c) value+sig ABSENT from the drained events AND a logger spy (+ positive
controls), (d) a denied redeem ⇒ no cap ⇒ the factory is NEVER called ⇒ no create crosses. **PART B** drives
`createSupervisor` DIRECTLY (injected clock + deferred redemption) for the timing-sensitive supervisor logic —
fail-fast, driver-built-post-redemption, zero-capability fail-closed, (e) cancel MID-REDEMPTION (null-object, no
`TypeError`, `activeRunCount()===0`), (f) expired-cap happy-destroy → `orphaned` (converge never called), (f2)
expired-cap escalateCleanup → `orphaned` CLOCK-FIRST, (g) genuinely-gone (cap valid on re-read) → `success`. Both
are worker-daemon `.test.ts` files and `E2bSandboxProvider` is named ONLY there (excluded from
`check-gate-clause-wiring` → E7-1 stays `unwired` at 4). This is STRICTLY safer/more deterministic than one
compose drive and preserves every assertion.

**Tests + mutation.** New: `owned-labels-capability-guard.contract.test.ts` (4), `dep-011-slice-2a.component.test.ts`
(10). Extended: `secret-redemption.test.ts` (+7 for classify/synthesise threading+dedup), `compose-dispatch.test.ts`
(+3 for the `makeRunProvider` gate). Whole worker-daemon suite GREEN (145 files / 898 tests, 1 pre-existing skip);
`composed-journey` + `supervisor-happy` + `supervisor-secret-materialization` UNCHANGED (desktop byte-identical).
Mutation sweep 6/6 killed against source: driver-at-buildRun (factory-call assertions), broken null-object /
"unset" authorities (e→TypeError), escalateCleanup routed through the masking converge (f2→false success),
RNA-without-clock-re-check (g→false orphan), proactive-check removed (f), dedup-on-whole-cap (synthesise
fail-closed); plus fail-fast (both-set) and log-the-payload (c) by construction.

**Guards (WHOLE policy set GREEN).** `check-worker-daemon-boundary` PASS (local-type + vendored guard; NO leaf
import in runtime source — devDeps don't count, `evaluateManifest` pins only runtime deps); `check-gate-clause-wiring`
OK (E7-1 stays dormant at 4 — `E2bSandboxProvider` named only in `.test.`); `check-finding-ownership` OK (NO
result doc — E6-F003 stays open + owned by DEP-011); `check-test-inventory --write` re-pinned; `check-dependency-graph`,
`check-adapter-manager-boundary`, `check-sandbox-e2b-provider-boundary`, `check-secret-resolve-vectors` (unperturbed),
`check-execution-census`, `check-image-deps-stages` (N/A — no new package in 2a) all GREEN. Graph typecheck GREEN for
worker-daemon + provider-wire + adapter-manager + provider-capability + sandbox-e2b-provider.

**Fences honoured.** No container bin / new package / `AOA_WORKER_PROVIDER_URL` / boot-root (2b); no
`checkDispatchDefaultOff` change / mTLS / real keypair (Slice 5); no server-side reaper (next slice — 2a RECORDS
orphans, bounded by the E2B create-TTL `opDeadlineMs`, and does not reap); no re-mint-on-renewal (deferred); no
new run terminal; no `!` on the authorities; no create-payload log; worker-daemon still ships passing nothing.

## 2a.12 — review outcome (3 agents, 2026-08-29, every finding verified against source)

Three reviewers (ordering/late-binding; cleanup-strand/fail-closed; #104/dedup/guards). The first-cut 2a was NOT
safe; **the teardown fork was resolved → Option A (server owns reaping).** Findings, all folded above:
- **HIGH — the expired-cap strand masked as "success"** (cleanup-F1, ordering-F3): the standard `CleanupAuthority`
  reads a gate RNA as "gone → success"; the lease-clamped, never-re-minted cap dies before a real run ends → every
  long run's happy-path destroy strands a live sandbox, silently. → §2a.5 the honest TRUST variant.
- **HIGH — the "unset authorities" late-binding NPE** (ordering-F1, cleanup-F4, guards-HIGH-2): `:560`/`:253`/`:262`
  + the concurrent-cancel window deref the authorities before the bind → `TypeError` + map leak. → §2a.3 NO-OP
  null-object at `buildRun`, real authorities post-redemption (mutable fields, no `!`).
- **HIGH — the daemon boundary rejects a capability TYPE import** (guards-HIGH-1): no `import type` awareness;
  `isValidCapability` private. → §2a.2 LOCAL structural type + vendored guard; only the `.test.ts` imports the real
  type.
- **HIGH — the deferred reaper reaps DB rows, not sandboxes** (cleanup-F2): the MIG-002 sweeper never issues a
  provider `destroy`; β1.6 is the deferral marker. → §2a.0/§2a.5 the server reaper is the NEXT slice (net-new);
  the E2B TTL is the honestly-stated interim backstop.
- **MED — dedup fails-closed on a benign `expiresAt`/`sig` delta** (guards-MED-3): a 2-key run mints 2 caps
  differing by ms. → §2a.2 dedup on `ownedLabels`/`v`/`audience` only.
- **MED — both `provider`+`makeRunProvider` precedence unspecified** (ordering-F4). → §2a.2 fail-fast.
- **MED — networked zero-capability → doomed driver** (ordering-F5). → §2a.6 explicit fail-closed.
- **MED — the fail-closed test can't catch the map leak** (ordering-F2): `accept`'s rejection is swallowed. →
  §2a.9 assert `activeRunCount()===0` + a logger spy.
- **LOW — §2a.10 wording** (guards-LOW-4): 2a DOES name `E2bSandboxProvider` (in the `.test.ts`); the guard
  excludes `.test.` paths, so the count stays 4. → §2a.9/§2a.10 corrected.

**Confirmed SOUND:** #104 on the crossing (no new log/event surface; canary scrub preserved; even a create error
discards `err`); inertness (shipped bin passes nothing ⇒ `no_provider`); desktop byte-identical; the devDep
allowance + no tsc/package cycle.

### Focused re-review of the reshaped cleanup (4th agent, 2026-08-29) — the prior HIGH fixes HELD; 5 refinements folded:
- **F1 (HIGH, was design-blocking) — the honest orphan was asserted, not mechanized.** `CleanupStatus`/the run
  terminal are frozen closed unions, so the orphan is NOT a new status/terminal — it is a distinct
  `CLEANUP_OUTCOME_METRIC { outcome:"orphaned" }` label + log field on a networked-expired branch that skips
  `converge` (the run terminal stays `succeeded`/etc.). → §2a.5, §2a.9(f).
- **F2 (MED-HIGH) — clock-vs-RNA contradiction.** The rule is CLOCK-FIRST (`expiresAt > now` before each gated
  teardown) with an RNA RE-CHECK for worker↔AM skew (expired-during-round-trip → orphan; still-valid → genuinely
  gone → success); the happy `destroy` is `run.effect.destroy` (`:492`), which gets a proactive expiry check. →
  §2a.5, §2a.9(g).
- **F3 (MED) — the three timescales** (cap TTL / sandbox TTL = `opDeadlineMs` set-once / run length) stated; the
  bounded-orphan window is exactly `opDeadlineMs` (finite, no unbounded leak); the no-refresh-on-renewal gap
  named. → §2a.5.
- **F4 (LOW-MED) — the synchronous-swap invariant** (no `await` between the two reassignments) + the accepted
  mid-redemption-cancel create-then-reclaim divergence. → §2a.3.
- **F5 (LOW) — the no-op provider's full-port obligation + the `makeRunProvider`⟹`materializeRunSecrets`
  fail-fast.** → §2a.2, §2a.3.
The re-review CONFIRMED sound: the masked-strand diagnosis, the null-object NPE fix, the compose-dispatch
plumbing, zero-capability fail-closed, and the short-run happy path.

**Design is GO for the §9 build prompt** — 2a is honest-cleanup-only (orphans measured, never masked); the
server-side reaper is the next scoped slice.
