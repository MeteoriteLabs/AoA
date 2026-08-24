# DEP-010 — The provider seam: one authoritative port and a composition root that supplies it

**Epic:** E6 · **Plan node:** `docs/replatform/program-design.md` (`#### DEP-010`)
**Depends on:** DEP-000, WRK-004, CLI-001 (all shipped) · **Size:** M · **Status:** design
**Sprint:** 2 (see `docs/replatform/GO-BOOK.md`)

---

## 0. Grounded by — every load-bearing claim re-verified

| Claim | Verified at |
|---|---|
| worker-daemon DEFINES a per-op `SandboxProvider`, implements it **zero** times | `packages/worker-daemon/src/supervisor/provider.ts:330`; the only `implements` in-package is the test double `src/__tests__/support/fake-provider.ts` |
| The port is declared authoritative **in worker-daemon**, deliberately not relocated | `provider.ts:10-14` — "The port stays authoritative HERE in worker-daemon" |
| The port is **transport-agnostic**, so a networked driver can bind it later | `provider.ts:16-21` |
| The contract package defines a **structurally different** port | `packages/sandbox-provider-contract/src/port.ts:146` (`SandboxProviderDriver`, one `invoke(op,args)`), mismatch spelled out at `:14-26`, tracked as E6-F008 |
| The only production implementation is `E2bSandboxProvider` | `packages/sandbox-e2b-provider/src/e2b-provider.ts:136` |
| …in a package that **depends on** worker-daemon | `packages/sandbox-e2b-provider/package.json:26` |
| …so the daemon importing it is an **E4-D01 breach AND a cycle** | `packages/worker-daemon/src/lifecycle/compose-dispatch.ts:9-17` |
| `@armyofagents/sandbox-e2b-provider` is in **no other** package.json dependency list | `grep -rn "sandbox-e2b-provider" --include=package.json .` returns only its own `name` |
| The bridge between the two ports **already exists and is shipped** | `packages/sandbox-e2b-provider/src/per-op-adapter.ts:112` — `perOpToInvokeDriver`, header "CLOSES finding E6-F008" |
| The fake implements the **contract** port structurally, importing neither | `packages/sandbox-fake-provider/src/fake-driver.ts:5-8` |
| A composition root **already exists** and passes no provider | `packages/worker-keystore/src/bin/desktop-host.ts:101`, `:254-260` |
| …and its deps are daemon + protocol only | `packages/worker-keystore/package.json:27-30` |
| The daemon already has the `provider` seam and refuses without it | `bin/worker-daemon.ts:159`, `:338`; `compose-dispatch.ts:62` |
| The daemon boundary pins deps to exactly two | `scripts/lib/worker-daemon-boundary.mjs:52` |
| The **keystore** boundary pins deps to two and calls any addition a **STOP** | `scripts/lib/worker-keystore-boundary.mjs:47-60`, `:94-97`, `:71` (`SUBPROCESS_HOST_PATH` precedent) |
| The fake/contract boundary pins deps to exactly two | `scripts/lib/sandbox-fake-provider-boundary.mjs:45` |
| `AOA_WORKER_DISPATCH_ENABLED` is default-OFF, refuses an unrecognised value | `packages/worker-daemon/src/config/config.ts:69,142-162` |
| The `compose:true` branch **does not exist** — that is WRK-008 slice 2b | `bin/worker-daemon.ts:331-350` |
| `hasSelfModelReader` is hardcoded `false`, so a real boot can never reach `compose:true` | `bin/worker-daemon.ts:344` |
| Staging forbids `E2B_API_KEY` on every worker; it lives only on `adapter-manager` | `docker-compose.staging.yml:23-28,316-323`; `scripts/lib/staging-manifest-invariants.mjs:120,436-470` |
| `adapter-manager` has **zero implementation** | `docs/replatform/DECISION-byte-egress-and-provider-topology.md` §4.2 |
| The findings register is CI-enforced; a stale entry FAILS | `scripts/lib/finding-ownership.mjs:129-136`; `.github/workflows/pr.yml` |

**The one-sentence problem.** A port with zero implementations, an implementation no process can construct, and a root that never asks for one: three independently-correct pieces and nothing that joins them.

---

## 1. DECISION D1 — worker-daemon's per-op `SandboxProvider` is THE authoritative port

**`packages/worker-daemon/src/supervisor/provider.ts:330` is the provider port. There is no other.**

1. **It is what the consumer consumes.** The supervisor programs against the per-op surface; `SupervisorDeps.provider` is typed to it and is required. Nothing in production calls `invoke(op, args)`. A port the security core does not speak is a second vocabulary, not the authority.
2. **It is what the only real implementation implements.** Declaring the other port authoritative would orphan the only real provider in the repo.
3. **It carries the security semantics.** `ResourceLabels` + `hashResourceLabels` (`:104-160`), the deliberately-sensitive `InspectResult` that makes cleanup redaction non-vacuous (`:244-262`), the byte-free `ArtifactUploadGrantV1`/`ArtifactExportResult` pair (`:358-378`), `UnsupportedProviderOperation`, `SandboxNotFoundError`. The driver's `ProviderOpArgs` is an opaque `params` bag (`port.ts:58-65`) carrying none of it — correct for a *neutral* conformance harness, wrong for a security core.
4. **The tree already says so twice in prose.** DEP-010's contribution is to make it a decision of record, enforced in the findings register, rather than a comment two files repeat and a third contradicts.

### D2 — the contract driver port is KEPT, demoted to a conformance-harness surface, reached through the shipped adapter

`SandboxProviderDriver` is **not retired and not authoritative**. It is retained as the surface the two conformance suites drive (`runSandboxProviderContract` DEP-000, `runSandboxIsolationConformance` DEP-008) and nothing else.

- **Not retired** — retiring means rewriting both suites and the fake against a port whose `ProviderOpContext` has no `params` channel for the fault vocabulary they depend on (`withdrawEffectAuthority`, `authority:"cleanup"`, `lifecycleFault`, `targetGeneration`, `egress.classification` — `per-op-adapter.ts:14-33`). Large, risky, buys a tidier diagram.
- **Not authoritative** — nothing in production calls it.
- **The bridge is `perOpToInvokeDriver`** (`per-op-adapter.ts:112`): generic, provider-agnostic, already tested, already green on both suites against `perOpToInvokeDriver(new E2bSandboxProvider(mockTransport))` (`docs/replatform/current-main-crosswalk.md:26`).

Direction is now single and stated: **authoritative per-op port → adapter → harness driver port.** Never the reverse.

**Structural residual, named:** the adapter lives in `packages/sandbox-e2b-provider`, so a *non-E2B* provider wanting harness conformance would depend on the E2B package for a file with nothing to do with E2B. DEP-010 does **not** move it — a package move for a provider that does not exist is speculative. Recorded in §8.

---

## 2. Findings disposition — all three, explicitly

| Finding | Disposition |
|---|---|
| **E6-F008** — two structurally distinct ports | **RESOLVED.** D1 names the authority; D2 states the driver's retained role; the mechanism shipped in CLI-001. Status `open → resolved`; entry **deleted** from `scripts/finding-ownership.json`. |
| **E6-F004** — where the fake imports the port from | **RESOLVED, with the OPPOSITE answer to the one proposed.** The finding said the fake should import the port from worker-daemon and the boundary should allow it. **Rejected.** The fake implements the *harness* port, so it needs no import; it stays structural and `sandbox-fake-provider-boundary.mjs:45` stays **exactly** `["@armyofagents/worker-protocol","zod"]`. Widening it would put the daemon's whole surface inside a leaf whose entire point is that it has none. |
| **E6-F003** — the networked driver API | **EXPLICITLY DEFERRED.** Half is answered by D1 and recorded; half is not, and this ticket does not pretend otherwise. See §2.1. |

### 2.1 E6-F003 in full — because "deferred" without a reason is how it got orphaned once already

**What D1 answers.** Which port a networked worker→provider driver speaks: the per-op `SandboxProvider`, transport-agnostic by construction (`provider.ts:16-21`). The networked driver is a **binding of the authoritative port**, not a third port. That removes the entanglement with E6-F008/F004 that made all four one question.

**What DEP-010 does NOT answer.** The wire itself — request/response shapes a worker's provider driver speaks to `adapter-manager` over `provider-ctl-net`. No transport, no schema, no client.

**Why deferring is correct, not convenient.** There is no consumer: `adapter-manager` is declared and enforced against but has **zero implementation**; no worker dispatches (flag default-off, no `compose:true` branch). Specifying a wire against an unimplemented peer for an unbuilt caller is the failure this programme keeps re-learning.

**Its precondition, written down.** E6-F003 becomes *required* the moment a containerized worker under `docker-compose.staging.yml` must dispatch — because §2.5 forbids `E2B_API_KEY` on any worker surface, so that worker's provider **cannot** be key-backed and **must** be networked. **DEP-010 therefore wires the desktop/self-hosted lane only**, and §3.3 states that as a consequence, not an oversight.

**Register action.** Stays `open`/`unowned` (permitted for HIGH; may never be `accepted`). Its `reason` is rewritten to the narrowed question, the removed entanglement, and the precondition.

---

## 3. DECISION D3 — the root is the existing `desktop-host.ts`; the provider package is confined to one new file

### 3.1 The constraint that decides the shape

`scripts/lib/worker-keystore-boundary.mjs:47-60` pins `worker-keystore` to **exactly** `{worker-daemon, worker-protocol}` and says in the file: *"Adding anything is a STOP for controller approval — a native keychain binding must never arrive here by accident, because this package is injected INTO the daemon's process."* `ALLOWED_BARE` (`:94-97`) rejects every other bare specifier in runtime source, **including `import type`** (the scanner is lexical) and **including a literal dynamic import**.

There is no clever way in. **Adding the provider package to this package IS a controller STOP**, and this design asks for it explicitly (Step 0).

### 3.2 Pay for the widening by making the guard tighter than it was

The concern is real: the provider package transitively pulls the `e2b` network SDK into the process that holds the device private key. So the widening is **paired with a new one-path confinement**, modelled on `SUBPROCESS_HOST_PATH` (`:71`) — whose own history (a basename check that let any `command-runner.ts` inherit permission) is why it keys on the full package-relative path:

- `REQUIRED_RUNTIME_DEPENDENCIES` → the three-element sorted list.
- `ALLOWED_BARE` gains the specifier.
- **New:** `PROVIDER_HOST_PATH = "src/bin/sandbox-provider.ts"` — the provider package may be named from **exactly one path**; every other runtime file is rejected, with the reason in the error text.

Net: one more allowed specifier, one more confinement rule. The dangerous capability lands in one reviewable file instead of becoming ambient.

- **Lazy load.** `sandbox-provider.ts` uses a **literal dynamic** `import(...)`. A static import would load the SDK on **every** boot including the default boot that constructs nothing (`index.ts` statically re-exports `real-transport.js`, which imports `e2b` at module scope).
- **The credential never crosses the root.** `createRealE2bTransport()` is called with no `apiKey`; it reads `E2B_API_KEY` itself (`real-transport.ts:46-59`), the DEP-006 confinement point. `worker-keystore` never names the credential.

### 3.3 Dependency-direction consequences

1. **New arrow `worker-keystore → sandbox-e2b-provider`.** With the existing `sandbox-e2b-provider → worker-daemon`, the graph stays a DAG. No cycle.
2. **`worker-keystore` becomes the only package naming daemon + OS custody + a provider.** The DSK-001 arrangement extended by one.
3. **The daemon's arrow is untouched.** `worker-daemon-boundary.mjs:52` is not edited; Step 9 proves it with positive controls.
4. **The fake's arrow is untouched** — that is E6-F004's answer.
5. **The desktop artifact grows.** The DSK-003 staging manifest hashes the shipped file set, so the `e2b` closure appears in it. Regenerated by the build, so nothing drifts silently — but the artifact is materially larger and its supply-chain surface wider.
6. **This is the desktop/self-hosted lane ONLY.** A staging containerized worker cannot use it: `E2B_API_KEY` on a worker is a hard `PROVIDER-CONTROL VIOLATION`. The containerized lane needs E6-F003. The boundary of this ticket, not a gap in it.

### 3.4 Alternatives rejected

| Alternative | Why not |
|---|---|
| New package `@armyofagents/worker-desktop-host` owning the bin | Moves `bin/aoa-worker-desktop` out of `worker-keystore/package.json:15`, reaching DSK-003 install layout, autostart `execPath`, and the staging manifest. Far larger blast radius to avoid one reviewed guard edit — and it writes a root when one already exists. **Reconsider if Step 0 is refused.** |
| Relocate the per-op port to a shared leaf (E6-F008 option (a)) | Contradicts the explicit E4-F003 choice at `provider.ts:10-14`; churns the port every consumer imports; buys nothing, since the adapter already bridges. |
| Make the fake the daemon's provider | It implements the other port. Adapting it would ship a fabricating provider on a production path — the WRK-009 defect shape. |
| Fall back to `MockE2bTransport` when no key is present | A worker that fabricates provider success is byte-identical to a real one on every gate. Never in production. |
| Degrade to "no provider" when an explicitly-requested provider cannot be built | The operator would see `no_provider` — the message for a build that *cannot* have one — and rebuild something that is fine. An explicit opt-in that cannot be honoured is a **refusal**. |

---

## 4. What this ticket does NOT do — and how that is proven

DEP-010 wires the **seam** and the **root**. It does **not** turn dispatch on. Three independent facts keep the shipped default inert; Steps 7/8/10 prove each:

1. **`AOA_WORKER_SANDBOX_PROVIDER` unset by default** → resolver returns `{kind:"none"}` → `provider: undefined` → `no_provider`. The `e2b` SDK is never loaded (Step 7 asserts the loader is called zero times).
2. **`AOA_WORKER_DISPATCH_ENABLED` stays default-off**, unset in every deployment surface; Step 10 makes setting it on a staging worker a CI failure.
3. **The `compose:true` branch does not exist.** `hasSelfModelReader` is hardcoded `false` (`bin/worker-daemon.ts:344`), so **even a provider-bearing daemon with the flag on cannot reach `compose:true`** — it reports `no_self_model_reader`. Step 8 asserts exactly that against the real `bootstrapWorkerDaemon`.

---

## 5. Files

| File | Change |
|---|---|
| `epics/E6-deployment-test-harness/findings.md` | E6-F008 + E6-F004 → `resolved`; E6-F003 body rewritten to the narrowed question |
| `scripts/finding-ownership.json` | delete E6-F008, E6-F004; rewrite E6-F003 reason |
| `packages/worker-daemon/src/index.ts` | **additive export** of `decideDispatchComposition` + `DISPATCH_REFUSAL_MESSAGES` + types. No new import, no new dependency |
| `packages/worker-daemon/src/supervisor/provider.ts` | header only: name the authority decision, point at the adapter |
| `packages/sandbox-provider-contract/src/port.ts` | header only: `:14-26` rewritten from "OPEN item" to the settled demotion |
| `packages/worker-keystore/src/bin/sandbox-provider.ts` | **new** — the ONLY file permitted to name the provider package |
| `packages/worker-keystore/src/bin/desktop-host.ts` | `DesktopHostDeps.provider` + `.loadProviderModule`; resolve-then-inject before `bootstrap(...)` |
| `packages/worker-keystore/package.json` | add the provider dep |
| `scripts/lib/worker-keystore-boundary.mjs` | +1 dep, +1 bare, **+`PROVIDER_HOST_PATH` confinement** |
| `scripts/check-worker-keystore-boundary.test.mjs` | +4 cases |
| `scripts/lib/staging-manifest-invariants.mjs` | **new invariant**: dispatch/provider switches absent from every worker |
| `scripts/check-staging-manifest.test.mjs` | +2 cases |
| `packages/worker-keystore/src/__tests__/sandbox-provider.test.ts` | **new** |
| `packages/worker-keystore/src/__tests__/desktop-host-provider.test.ts` | **new** |
| **Untouched, deliberately** | `worker-daemon-boundary.mjs`, `sandbox-fake-provider-boundary.mjs`, `worker-daemon/package.json`, `compose-dispatch.ts`, frozen `worker-protocol` |

---

## 6. Implementation — bite-sized TDD steps

Every step: **write the failing test → run it and read the failure → minimal implementation → run it → commit.**

### Step 0 — STOP: controller approval for the keystore widening
No code. Present §3.1–§3.3 (the widening, the paired `PROVIDER_HOST_PATH` confinement, the lazy load, artifact-size and supply-chain consequences) and obtain approval. **If refused, stop and re-plan as §3.4's new-package alternative.** Steps 1–4 are independent and may proceed regardless.

### Step 1 — the findings register records the decision (RED comes from the guard)
**RED.** Edit `findings.md` first: E6-F008 → `RESOLVED` with the D1/D2 text; E6-F004 → `RESOLVED` with the rejection of its own proposed fix; E6-F003 stays `open`, body rewritten.

Run `node scripts/check-finding-ownership.mjs` → **FAIL** twice with `stale_declaration` (`finding-ownership.mjs:129-136`).

**GREEN.** Delete both entries from `scripts/finding-ownership.json`; rewrite `E6-F003.reason` to the narrowed question + the §2.1 precondition. Re-run → **PASS**.

**Mutation.** Re-add E6-F008 → must fail `stale_declaration`. Flip E6-F004 back to `open` in `findings.md` → must fail `undeclared_finding`. Both directions, then restore.

**Commit:** `DEP-010: name the authoritative provider port; resolve E6-F008/E6-F004, narrow E6-F003`

### Step 2 — the dispatch decision joins worker-daemon's public surface
**Why.** The root lives outside the package and supplies the `provider` input; today it cannot import the decision, so "the root works" would be a claim about a private function.

**RED.** `packages/worker-daemon/src/__tests__/public-surface-dispatch.test.ts` importing `decideDispatchComposition`, `DISPATCH_REFUSAL_MESSAGES` from `../index.js`; assert `{provider: undefined, dispatchEnabled: true, hasSelfModelReader: true, selfModel: null}` → `{compose:false, reason:"no_provider"}`, and that with a fake provider the flag toggles `compose:true` / `dispatch_disabled`. Run → **FAIL** (no such export).

**GREEN.** Append to `index.ts` a re-export of the function, the frozen message map, and the three types, with a comment stating why it is public (the root is outside the package by E4-D01). Run → **PASS**. Then `node scripts/check-worker-daemon-boundary.mjs` → **PASS** (nothing imported; `index.ts` already re-exports from `./lifecycle/…`).

**Commit:** `DEP-010: export decideDispatchComposition so a composition root can assert it`

### Step 3 — the root gets a provider path (no new dependency)
**RED.** `desktop-host-provider.test.ts` with a `capturingBootstrap()` that records `deps.provider`; assert a directly-injected provider reaches bootstrap. Run → **FAIL**.

**GREEN.** Widen the `@armyofagents/worker-daemon` import with `type SandboxProvider`; add `readonly provider?: SandboxProvider` to `DesktopHostDeps` with a comment stating it is **absent for the shipped binary**; pass `provider: deps.provider` in the `bootstrap({...})` call. Run → **PASS**; boundary checker → **PASS** (already-allowed specifier).

**Commit:** `DEP-010: give the desktop composition root a provider pass-through`

### Step 4 — LOCK the shipped default (green on arrival → mutation-checked)
**Honesty note: these pass the moment they are written.** They are regression locks, not REDs, and earn their place only through the mutation check.

Add: the shipped shape passes **no** provider; and a **real** `bootstrapWorkerDaemon` booted from the shipped env reports `no_provider` through a real logger.

**Mutation (both must fail, then revert):** (a) `provider: deps.provider ?? ({} as SandboxProvider)` → first test fails. (b) `compose-dispatch.ts` `if (!input.provider)` → `if (false)` → second fails.

**Commit:** `DEP-010: lock the shipped default — no provider, no dispatch`

### Step 5 — the boundary guard: widen by one, confine to one path (TDD on the guard)
**RED.** Add four cases to `check-worker-keystore-boundary.test.mjs`: allowed from `src/bin/sandbox-provider.ts`; **rejected** from `bin/desktop-host.ts`, `identity-store.ts`, and **`bin/nested/sandbox-provider.ts`** (the exact hole the `SUBPROCESS_HOST_PATH` history taught); manifest must declare three deps. Run → **FAIL**.

**GREEN.** In `worker-keystore-boundary.mjs`: three-element `REQUIRED_RUNTIME_DEPENDENCIES`, the specifier in `ALLOWED_BARE`, and a new `PROVIDER_HOST_PATH` check in `evaluateRuntimeSourceImports` after the `SUBPROCESS_SPECIFIERS` block, whose error text names the reason (the `e2b` SDK entering the key-holding process). Run → **PASS**; real checker → **FAIL** (manifest still two) → add the dep, `pnpm install`, re-run → **PASS**.

**Mutation.** (a) Drop `PROVIDER_HOST_PATH` from the comparison → the rejected-elsewhere case must fail. (b) Remove the specifier from `ALLOWED_BARE` → the allow-at-path case must fail. Revert both.

**Commit:** `DEP-010: allow the provider package in worker-keystore, confined to one path`

### Step 6 — `sandbox-provider.ts`: resolve or refuse, never guess
**RED.** `sandbox-provider.test.ts` pairing the **real** `E2bSandboxProvider` with `createMockE2bTransport()` through the injected module seam (so the mock is never reachable from production code). Cases: gate unset → `{kind:"none"}` **and the loader is never called**; explicit `"none"` → same; unrecognised value → `refused` (not off); `e2b` with no template → `refused`; opted-in with a template → **real** `E2bSandboxProvider` whose `advertisedOperations.has("create")` is true (non-vacuity); transport throws → `refused` mentioning `E2B_API_KEY`; and **the default loader really is the provider package** (no injection, no key → refuses, proving the seam is not vacuous). Run → **FAIL**.

**GREEN.** Create the file. Exports `PROVIDER_ENV = "AOA_WORKER_SANDBOX_PROVIDER"`, `TEMPLATE_ENV = "AOA_WORKER_E2B_TEMPLATE"`, `PROVIDER_KINDS`, `ProviderResolution` (`none` | `provider` | `refused`), a **structural** `ProviderModule` interface, `loadProviderModule` using a **literal dynamic** import, and `resolveSandboxProvider(env, load)`. Header states: why it is confined, why the import is dynamic (checker requires a literal; a static one would load the SDK on every boot), why the credential is not named here (the transport reads it — DEP-006 confinement), and why a bad configuration is a refusal.

**Mutation.** (a) unrecognised-value branch → `{kind:"none"}` → its test fails. (b) missing template → `templateId ?? "base"` → its test fails. (c) `catch` → `{kind:"none"}` → both the throw test and the default-loader test fail. Revert all.

**Commit:** `DEP-010: the one file that may construct a sandbox provider`

### Step 7 — wire the resolver into the root, after the control and reset branches
**RED.** Add: resolves from env and hands a real provider to bootstrap; **refuses to boot** when an explicitly requested provider cannot be built (`ok:false`, `exit(1)`, bootstrap **never called**, message mentions `E2B_API_KEY`); **a control command must NOT construct a provider**; **`--reset-identity` must NOT construct a provider**. Run → **FAIL**.

**GREEN.** Add `loadProviderModule?: ProviderModuleLoader` to deps; insert the resolve block **immediately before** `bootstrap(...)` — after the control branch and after the reset branch, both of which return early. A direct `deps.provider` wins; a `refused` resolution logs, `exit(1)`, returns `{ok:false}`.

**Mutation.** Move the resolve block **above** the control branch → the two "must NOT construct" tests must fail. Revert.

**Commit:** `DEP-010: the desktop host resolves and injects a real sandbox provider`

### Step 8 — acceptance: `compose:true` iff provider AND flag; and the real boot still refuses
**RED/verify.** Boot the root, capture what it produced, feed **that** into the real decision:
- root-produced provider + flag on → `{compose:true}`; flag off → `dispatch_disabled`.
- shipped shape → provider `undefined` → `no_provider` for **both** flag values.
- **★★ the strongest form:** a **real** `bootstrapWorkerDaemon` with the root-produced provider **and** `AOA_WORKER_DISPATCH_ENABLED=1` still reports **`no_self_model_reader`**, and **not** `no_provider` (the provider did arrive). That is this ticket's "does not turn dispatch on", proven against the real bootstrap rather than asserted.

**Mutation.** Flip `hasSelfModelReader: false` → `true` at `bin/worker-daemon.ts:344` → the `★★` case must fail. Revert.

**Commit:** `DEP-010: prove compose:true needs a root-produced provider, and that the build still refuses`

### Step 9 — the daemon still cannot import a provider (positive controls, none committed)
Run all five boundary checkers + their self-tests; all **PASS** with `worker-daemon-boundary.mjs:52` and `sandbox-fake-provider-boundary.mjs:45` **byte-unchanged** (`git diff --stat` proves it).

**Positive controls — applied, run, reverted, transcribed into the result doc:**

| # | Mutation | Required failure |
|---|---|---|
| 1 | provider import at the top of `supervisor/provider.ts` | `forbidden runtime import` (also proves the checker walks `supervisor/`, not just `bin/`) |
| 2 | provider dep in `worker-daemon/package.json` | `runtime dependencies must equal [worker-protocol, pino]` |
| 3 | non-literal dynamic import in a daemon runtime file | `non-literal dynamic import is forbidden` |
| 4 | `worker-daemon` dep on `sandbox-fake-provider` | fake boundary manifest rule — E6-F004's answer, mechanically |
| 5 | `process.env.E2B_API_KEY` in `per-op-adapter.ts` | e2b credential-confinement violation |

**No commit** — evidence only.

### Step 10 — the deployment default is provably inert too
**RED.** Two cases in `check-staging-manifest.test.mjs`: reject `AOA_WORKER_DISPATCH_ENABLED` and `AOA_WORKER_SANDBOX_PROVIDER` on a worker service. Run → **FAIL**.

**GREEN.** Add `DISPATCH_SWITCH_ENVS` + `checkDispatchDefaultOff(services, v)` to `staging-manifest-invariants.mjs`, registered beside `checkProviderControlBoundary`. Run → **PASS**; real manifest → **PASS**.

**Mutation.** (a) `WORKER_SERVICES` → `[]` inside the new function → both new cases must fail (anti-vacuity: it really iterates workers). (b) Confirm the pre-existing `E2B_API_KEY`-on-a-worker case still fires — DEP-006 unweakened.

**Commit:** `DEP-010: make "dispatch stays off" a static deployment invariant`

### Step 11 — the headers stop contradicting each other; full gate
Docs only: `provider.ts` header names the authority + the adapter; **`sandbox-provider-contract/src/port.ts:14-26` rewritten** from "OPEN item … E6-F008" to the settled demotion (this is the one edit that stops the tree contradicting itself — that paragraph is currently the repo's only assertion the question is open); `current-main-crosswalk.md` CM-010 gains the DEP-010 disposition.

Then the full gate: `pnpm -r build`, `pnpm typecheck`, vitest across the five packages, all boundary checkers, staging manifest, finding-ownership, ticket-graph-coverage, guard-inventory, **and `check-gate-clause-wiring.mjs`** — promoting nothing yet (E7-1 stays dormant until Sprint 5).

**Commit:** `DEP-010: one authoritative provider port, documented where it was contradicted`

---

## 7. Guard mutation matrix

| Guard | Touched? | Mutation | Expected |
|---|---|---|---|
| `check-finding-ownership.mjs` | data | re-add a deleted entry | `stale_declaration` |
| " | " | flip E6-F004 back to `open` | `undeclared_finding` |
| `check-worker-keystore-boundary.mjs` | **yes** | provider import from a non-`PROVIDER_HOST_PATH` file (incl. `bin/nested/`) | one-path violation |
| " | " | drop the specifier from `ALLOWED_BARE` | allow-at-path fails |
| " | " | manifest declares only the old two | `runtime dependencies must equal` |
| `check-worker-daemon-boundary.mjs` | **no** | provider import in `supervisor/provider.ts` | `forbidden runtime import` |
| " | " | provider dep in the daemon manifest | manifest rule |
| " | " | non-literal dynamic import | `non-literal dynamic import` |
| `check-sandbox-fake-provider-boundary.mjs` | **no** | worker-daemon dep on the fake | manifest rule |
| `check-sandbox-e2b-provider-boundary.mjs` | **no** | `E2B_API_KEY` outside `real-transport.ts` | credential confinement |
| `check-staging-manifest.mjs` | **yes** | dispatch switch on a worker | `DISPATCH VIOLATION` |
| " | " | `WORKER_SERVICES` → `[]` | new cases fail (anti-vacuity) |
| " | **no** | `E2B_API_KEY` on a worker | pre-existing violation still fires |
| `desktop-host.ts` resolve position | **yes** | move above the control branch | control/reset tests fail |
| `compose-dispatch.ts` | **no** | `if (!input.provider)` → `if (false)` | shipped-default lock fails |
| `bin/worker-daemon.ts:344` | **no** | `hasSelfModelReader` → `true` | the "does not turn dispatch on" lock fails |

A guard whose failure nobody has seen is a guard nobody has tested — every positive control is applied, run, reverted, and its failure text transcribed into the result doc.

---

## 8. Residual risk

1. **The `e2b` SDK now lives in the key-holding process.** Mitigated by one-file confinement, the lazy dynamic import (not loaded on the default path), and the credential never being named in `worker-keystore`. **Not eliminated** — this is the cost Step 0 buys.
2. **The desktop artifact grows and its supply-chain surface widens.** The manifest regenerates, so nothing drifts silently. Flag to whoever owns DSK-003 packaging.
3. **`perOpToInvokeDriver` lives in the E2B package.** Relocate when a second provider exists; moving it now is speculative.
4. **E6-F003 remains open and HIGH, by design.** Precondition written down so nobody re-derives it.
5. **Split env source.** The root reads `deps.env`; the transport reads `process.env`. Identical in production, and deliberate — it is what keeps the credential out of this package.
6. **`AOA_WORKER_SANDBOX_PROVIDER` is a new operator-facing switch.** DSK-003 host docs should name it and `AOA_WORKER_E2B_TEMPLATE`. Doc follow-up, not a blocker.

---

## 9. Acceptance mapping

| Plan acceptance | Proven by |
|---|---|
| Exactly one port is authoritative and documented as such | §1 D1/D2; Step 1; Step 11 (the two headers stop contradicting) |
| The composition root injects a real `E2bSandboxProvider` via the `provider` seam | Steps 3, 6, 7; Step 8 asserts `toBeInstanceOf` on what the root handed to bootstrap |
| The boundary checker still forbids the daemon importing a provider | Step 9 — byte-unchanged guard, green checker, three positive controls |
| A worker with no injected provider still refuses; the shipped default is provably inert | Step 4 (lock + 2 mutations), Step 8 (real boot with provider **and** flag still refuses), Step 10 (static deployment invariant) |
| Does NOT by itself turn dispatch on | §4; Step 8's `★★` case; Step 10 |
| Test: `compose:true` only with a real provider and the flag on | Step 8, driven by the **root-produced** provider |
| Test: boundary run proving the daemon still cannot import | Step 9 |
| Test: port reconciliation documented against E6-F008 | Steps 1 + 11 |
| Resolves E6-F008 / E6-F004 / E6-F003 | §2 — resolved, resolved (opposite answer), explicitly deferred with its precondition |
