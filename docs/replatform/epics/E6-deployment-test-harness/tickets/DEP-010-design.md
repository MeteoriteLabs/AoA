# DEP-010 — The provider seam: one authoritative port and a composition root that supplies it

**Epic:** E6 · **Plan node:** `docs/replatform/program-design.md` (`#### DEP-010`, `:818-820`)
**Depends on:** DEP-000, WRK-004, CLI-001 (all shipped) · **Size:** M · **Status:** design
**Sprint:** 2 (see `docs/replatform/GO-BOOK.md`)
**Revision:** 1 — adversarial review applied (GO-BOOK decision **D-4**); see §-1.

---

## ★ -1. REVISION 1 — the plan was right about the tree and wrong about CI

Adversarial review could not falsify any of §0's core grounding claims (`PROVIDER_HOST_PATH` was
checked against the scanner and works exactly as described). Every defect it found was in one of
two places: **CI mechanics the plan would break**, and **mitigations the plan asserted that do not
exist**. Both classes are the same failure the guard-inventory work named — *a check that nothing
runs is not a check*, and here, *a mitigation nothing performs is not a mitigation*.

| # | What was wrong | Where it is fixed |
|---|---|---|
| D1 | The plan makes `check-gate-clause-wiring.mjs` go RED and Step 11 told you to let it. | §0.1, §5, Step 6 |
| D2 | `scripts/test-inventory.json` pins the two packages this ticket adds tests to. | §0.1, §5, Steps 2/3/6, Step 11 |
| D3 | `sandbox-e2b-provider` is never pre-built in CI, and its exports resolve to `./dist`. Green locally, red in CI. | §0.1, §5, Step 5 |
| D4 | Step 9's positive control #4 tested the wrong guard — a mislabelled duplicate of #2. | Step 9 |
| D5 | "The staging manifest regenerates, so nothing drifts silently" — the assembler REFUSES to run. | §3.3.5, §8.2 |
| D6 | The inertness proof keyed on a scaffold Sprint 3 deletes. | §4, Step 8 |
| D7 | §3.2's "worker-keystore never names the credential" had zero enforcement. | §3.2, Step 5, Step 6 |
| D8 | Step 10's new invariant was narrower than the one it sits beside. | Step 10, §7 |
| D9 | The E6-F003 rewrite named the wrong network — in staging that sentence describes a violation. | §2.1 |
| D10 | E6-F008 was closed against the wrong half, and against a weaker bar than its own resolution text. | §2.2, §8 |
| D11 | The crosswalk edit could hard-fail `check-dependency-graph.mjs`. | Step 11 |
| D12 | Step 6's default-loader test was environment-dependent. | Step 6 |
| D13 | §8.3 understated what relocating the adapter costs. | §8.3 |
| D14 | The two new operator switches would go undocumented with no guard firing. | §5, Step 11 |
| D15 | Two off-by-one citations. | §0 |

**Two places the code disagreed with the review, and the code wins:**

1. **D3 said "add the build to BOTH pre-build steps."** Only the `verify` job's list
   (`.github/workflows/pr.yml:743-751`) is load-bearing: it is the one that runs `pnpm -r typecheck`
   and the root `pnpm test:run`, and the root vitest project list includes
   `packages/worker-keystore` (`vitest.config.ts:24`). The `distributed-contract` job's list
   (`:1168-1173`) runs only the three provider packages' own suites plus two server files, none of
   which resolves `@armyofagents/sandbox-e2b-provider` by name — so adding the line there is
   symmetry, not necessity. Both are added anyway (the two lists have been kept identical since
   CLI-001, and a divergence is a future trap), but §7 marks only the `verify` one as required.
2. **D15's `finding-ownership.mjs` correction is right and slightly conservative.** The stale loop
   is `:132-136`; `:130-131` is its explanatory comment. `:129` (which the old text included) is a
   blank line. Cited as `:132-136`.

**And one thing neither the plan nor the review had.** Step 0 was written as "present the case and
obtain approval". **The approval already exists.** Go-book decision **D-3** (`GO-BOOK.md:404`),
settled 2026-08-25 in a ledger headed *"do not relitigate"* (`:394`), approves the keystore widening
on **three named conditions** — and, independently of this review, records the same D5 defect: *"the
earlier approval leaned partly on the staging-manifest mitigation — that build refuses to run, so it
mitigates nothing."* Step 0 is rewritten from a request into a **conditions check**, mapped
condition-by-condition to the steps that satisfy each. A plan that re-asks a settled question is how
a settled question comes unsettled.

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
| `@armyofagents/sandbox-e2b-provider` is in **no other** package.json dependency list | `grep -rn "sandbox-e2b-provider" --include=package.json .` returns only its own `name` (`package.json:2`) |
| The bridge between the two ports **already exists and is shipped** | `packages/sandbox-e2b-provider/src/per-op-adapter.ts:112` — `perOpToInvokeDriver`, header "CLOSES finding E6-F008" |
| …and it bridges **per-op → driver only**; there is no driver → per-op direction | `per-op-adapter.ts:112-115` (`(provider: SandboxProvider) => SandboxProviderDriver`) |
| The fake implements the **contract** port structurally, importing neither | `packages/sandbox-fake-provider/src/fake-driver.ts:5-8` |
| A composition root **already exists** and passes no provider | `packages/worker-keystore/src/bin/desktop-host.ts:101`, `:254-260` |
| …and its deps are daemon + protocol only | `packages/worker-keystore/package.json:27-30` |
| The daemon already has the `provider` seam and refuses without it | `bin/worker-daemon.ts:159`, `:338`; `compose-dispatch.ts:62` |
| The daemon boundary pins deps to exactly two | `scripts/lib/worker-daemon-boundary.mjs:53` **(was cited `:52`)** |
| The **keystore** boundary pins deps to two…| `scripts/lib/worker-keystore-boundary.mjs:56-59` **(was cited `:47-60`)** |
| …and calls any addition a **STOP** | same file `:20-24` (module header), **not** at the constant |
| …rejects every other bare specifier | `:94-97` (`ALLOWED_BARE`), applied at `:152` |
| …and confines subprocess execution to ONE PATH | `:71` (`SUBPROCESS_HOST_PATH`), applied at `:144-151` |
| The fake/contract boundary pins deps to exactly two | `scripts/lib/sandbox-fake-provider-boundary.mjs:45` |
| `AOA_WORKER_DISPATCH_ENABLED` is default-OFF, refuses an unrecognised value | `packages/worker-daemon/src/config/config.ts:69`, `:150-162` **(was cited `:142-162`)** |
| The `compose:true` branch **does not exist** — that is WRK-008 slice 2b | `bin/worker-daemon.ts:337-349` **(was cited `:331-350`)**; the `if (!dispatch.compose)` at `:347-349` has **no `else`** |
| `hasSelfModelReader` is hardcoded `false` — and there is a SECOND hardcoded falsy beside it | `bin/worker-daemon.ts:344`; `selfModel: null` at `:345` |
| …and `hasSelfModelReader` is scaffolding Sprint 3 removes | `compose-dispatch.ts:44` — "This reason retires when 2b lands"; `GO-BOOK.md:127`, `:236-237` |
| Staging forbids `E2B_API_KEY` on every worker; it lives only on `adapter-manager` | `docker-compose.staging.yml:23-28`, `:316-323`; `scripts/lib/staging-manifest-invariants.mjs:120`, `:436-493` **(was cited `:436-470`; the command/entrypoint arm is `:476-481`)** |
| `adapter-manager` has **zero implementation** | `docs/replatform/DECISION-byte-egress-and-provider-topology.md` §4.2 (`:166-174`) |
| The findings register is CI-enforced; a stale entry FAILS | `scripts/lib/finding-ownership.mjs:132-136` **(was cited `:129-136`)**; `.github/workflows/pr.yml:288-298` |

**The one-sentence problem.** A port with zero implementations, an implementation no process can
construct, and a root that never asks for one: three independently-correct pieces and nothing that
joins them.

### 0.1 The CI mechanics this plan must not break — the half revision 1 added

Every row below is a fact about *this repository's gates*, not about the provider seam. The first
three are the ones that would have turned a correct implementation red.

| Fact | Verified at |
|---|---|
| The `policy` job is **always-on** — no `changes` gate, so it runs on a docs-only PR too | `.github/workflows/pr.yml:124-126` |
| `gate-clause-wiring.json` declares `E7-1-coding-journey` **`unwired`**, symbol `E2bSandboxProvider`, with **no `expectedReferences`** | `scripts/gate-clause-wiring.json` (`E7-1-coding-journey` block) |
| …so the count today is **0**, and any production file naming the symbol makes it ≥1 | `node scripts/check-gate-clause-wiring.mjs --counts` → `0  E2bSandboxProvider` |
| …and `count > expected` raises **`unwired_but_now_has_caller`** → `process.exit(1)` | `scripts/lib/gate-clause-wiring.mjs:105-113`; `scripts/check-gate-clause-wiring.mjs:126` |
| …the counter blanks imports and re-export blocks but counts an **interface property** and a **`new mod.X(...)`** line | `check-gate-clause-wiring.mjs:66-90` |
| `test-inventory.json` **pins** `packages/worker-daemon` at **131** and `packages/worker-keystore` at **18** | `scripts/test-inventory.json:47-54`; disk count confirms 18 keystore files |
| …and membership counts **any code file under a `__tests__` directory**, not just `.test.ts` | `scripts/lib/test-inventory.mjs:65-72` |
| …a pinned tree is an exact contract in BOTH directions; adding a file is `pinned_mismatch` | `scripts/check-test-inventory.mjs:109-112` |
| `scripts` is pinned at **46** — but only NEW `.mjs` test *files* count, and this ticket adds none | `scripts/test-inventory.json:59-62` |
| `sandbox-e2b-provider` exports resolve to **`./dist`** and it is **never pre-built** in CI | `packages/sandbox-e2b-provider/package.json:6-13`; `.github/workflows/pr.yml:743-751`, `:1168-1173` |
| …and `verify` runs Typecheck + Run tests **BEFORE** Build | `.github/workflows/pr.yml:753-760` |
| …and the root vitest project list **includes `packages/worker-keystore`** | `vitest.config.ts:24` |
| A lockfile edit is allowed **only when a manifest change rides with it** in the same PR | `.github/workflows/pr.yml:134-145` |
| `check-sandbox-fake-provider-boundary.mjs` covers **only** the two DEP-000 packages; it never reads worker-daemon's manifest | `scripts/check-sandbox-fake-provider-boundary.mjs:38-41` |
| …and its scanner catches **`import type`** lexically (a static import is found by scanning forward to `from`) | `scripts/lib/worker-protocol-boundary.mjs:368-379` |
| `build-desktop-staging.mjs` **REFUSES to run** — producing its input is an unsolved step | `scripts/build-desktop-staging.mjs:21-30` |
| …and the only thing CI runs is its unit test | `.github/workflows/pr.yml:365` |
| …and the embedded-secret scan already had to prune third-party READMEs/benchmarks to stay green | `scripts/lib/staging-manifest.mjs:41-51` |
| In **staging**, workers are on `[control-net, store-egress-net]`; `adapter-manager` on `[control-net, provider-ctl-net]` | `scripts/lib/staging-manifest-invariants.mjs:63-70` |
| …so a worker on `provider-ctl-net` is a hard `PROVIDER-CONTROL VIOLATION` | same file `:438-443` |
| In **`docker-compose.d1.yml`** the same name means the opposite: `worker-a` (`:332`) and `worker-b` (`:368`) ARE on `provider-ctl-net` | `docker-compose.d1.yml:14-22` (the matrix comment), `:332`, `:368`; also `control-plane` `:218`, `control-plane-b` `:289`, `fake-provider` `:398` |
| `worker-keystore-boundary.mjs` has **no credential-token rule** — its only token ban is `existsSync` | `scripts/lib/worker-keystore-boundary.mjs:88`, `:171-177` |
| …while the e2b leaf has exactly the rule this plan needs, over **raw source** (so a comment counts) | `scripts/lib/sandbox-e2b-provider-boundary.mjs:56`, `:126-128` |
| …and both keystore and e2b scanners **skip `.test.ts`** entirely | `scripts/lib/worker-protocol-boundary.mjs:94-99`; `scripts/check-worker-keystore-boundary.mjs:112` |
| `createRealE2bTransport` throws **synchronously in the constructor** when no key, with `E2B_API_KEY` in the text | `packages/sandbox-e2b-provider/src/real-transport.ts:53-59`, `:84`, `:238` |
| …reading `process.env.E2B_API_KEY` directly, so a developer's exported key changes the outcome | `real-transport.ts:54` |
| brand-check guard 9 matches **only** literal `process.env.AOA_[A-Z_]+` in `*.ts` | `.github/workflows/pr.yml:648-663` |
| …which is why `AOA_WORKER_DISPATCH_ENABLED` (read via the `ENV` map at `config.ts:69`) is documented by discipline, not by a guard | `docs/deploy/environment-variables.md:192` |
| `checkProviderControlBoundary` spans environment **and** env_file **and** secrets/configs/volumes **and** command/entrypoint | `scripts/lib/staging-manifest-invariants.mjs:452-482` |
| CM-010's owner cell is `CLI-001, CLI-004, MIG-008, DEP-006, DEP-008`, dominated today by **MIG-008** | `docs/replatform/current-main-crosswalk.md:26`; `docs/replatform/program-design.md:1049` |
| …and the owner cell is located by an **"exclusively a ticket list"** regex, so a prose cell is never read as one | `scripts/lib/dependency-graph.mjs:72-88` |
| …and an undominated row with no `crosswalk-coverage.json` declaration is `exit 1` | `scripts/lib/dependency-graph.mjs:135-147`; `scripts/check-dependency-graph.mjs:59-64` |
| `check-guard-inventory.mjs` tracks `scripts/check-*.mjs` **files**; this ticket adds none, so it stays green | `scripts/check-guard-inventory.mjs:32-40` |
| `check-execution-census.mjs` declares per-**file** status, not per-case; adding cases to an existing `.test.mjs` is invisible to it | `scripts/test-execution-census.json:112-131` |

---

## 1. DECISION D1 — worker-daemon's per-op `SandboxProvider` is THE authoritative port

**`packages/worker-daemon/src/supervisor/provider.ts:330` is the provider port. There is no other.**

1. **It is what the consumer consumes.** The supervisor programs against the per-op surface;
   `SupervisorDeps.provider` is typed to it and is required. Nothing in production calls
   `invoke(op, args)`. A port the security core does not speak is a second vocabulary, not the
   authority.
2. **It is what the only real implementation implements.** Declaring the other port authoritative
   would orphan the only real provider in the repo.
3. **It carries the security semantics.** `ResourceLabels` + `hashResourceLabels` (`:104-160`), the
   deliberately-sensitive `InspectResult` that makes cleanup redaction non-vacuous (`:244-262`), the
   byte-free `ArtifactUploadGrantV1`/`ArtifactExportResult` pair (`:358-378`),
   `UnsupportedProviderOperation` (`:297`), `SandboxNotFoundError` (`:311`). The driver's
   `ProviderOpArgs` is an opaque `params` bag (`port.ts:58-65`) carrying none of it — correct for a
   *neutral* conformance harness, wrong for a security core.
4. **The tree already says so twice in prose.** DEP-010's contribution is to make it a decision of
   record, enforced in the findings register, rather than a comment two files repeat and a third
   contradicts.

### D2 — the contract driver port is KEPT, demoted to a conformance-harness surface, reached through the shipped adapter

`SandboxProviderDriver` is **not retired and not authoritative**. It is retained as the surface the
two conformance suites drive (`runSandboxProviderContract` DEP-000, `runSandboxIsolationConformance`
DEP-008) and nothing else.

- **Not retired** — retiring means rewriting both suites and the fake against a port whose
  `ProviderOpContext` has no `params` channel for the fault vocabulary they depend on
  (`withdrawEffectAuthority`, `authority:"cleanup"`, `lifecycleFault`, `targetGeneration`,
  `egress.classification` — `per-op-adapter.ts:14-33`). Large, risky, buys a tidier diagram.
- **Not authoritative** — nothing in production calls it.
- **The bridge is `perOpToInvokeDriver`** (`per-op-adapter.ts:112`): generic, provider-agnostic,
  already tested, already green on both suites against
  `perOpToInvokeDriver(new E2bSandboxProvider(mockTransport))`
  (`docs/replatform/current-main-crosswalk.md:26`).

Direction is now single and stated: **authoritative per-op port → adapter → harness driver port.**
Never the reverse. §2.2 says what that costs.

**Structural residual, named:** the adapter lives in `packages/sandbox-e2b-provider`, so a *non-E2B*
provider wanting harness conformance would depend on the E2B package for a file with nothing to do
with E2B. DEP-010 does **not** move it — a package move for a provider that does not exist is
speculative, and §8.3 now records what the move would actually cost. Recorded in §8.

---

## 2. Findings disposition — all three, explicitly

| Finding | Disposition |
|---|---|
| **E6-F008** — two structurally distinct ports | **RESOLVED, one direction only.** D1 names the authority; D2 states the driver's retained role; the mechanism shipped in CLI-001. §2.2 states what is NOT bought and what the resolution text must therefore say. Status `open → resolved`; entry **deleted** from `scripts/finding-ownership.json`. |
| **E6-F004** — where the fake imports the port from | **RESOLVED, with the OPPOSITE answer to the one proposed.** The finding said the fake should import the port from worker-daemon and the boundary should allow it. **Rejected.** The fake implements the *harness* port, so it needs no import; it stays structural and `sandbox-fake-provider-boundary.mjs:45` stays **exactly** `["@armyofagents/worker-protocol","zod"]`. Widening it would put the daemon's whole surface inside a leaf whose entire point is that it has none. Proved mechanically by Step 9's control #4 — **against the fake's own guard**, which is a different guard from #2 (see Step 9). |
| **E6-F003** — the networked driver API | **EXPLICITLY DEFERRED.** Half is answered by D1 and recorded; half is not, and this ticket does not pretend otherwise. See §2.1. |

### 2.1 E6-F003 in full — because "deferred" without a reason is how it got orphaned once already

**What D1 answers.** Which port a networked worker→provider driver speaks: the per-op
`SandboxProvider`, transport-agnostic by construction (`provider.ts:16-21`). The networked driver is
a **binding of the authoritative port**, not a third port. That removes the entanglement with
E6-F008/F004 that made all four one question.

**What DEP-010 does NOT answer.** The wire itself — request/response shapes a worker's provider
driver speaks to `adapter-manager`. No transport, no schema, no client.

**★ Which network, stated correctly — the first draft had this backwards.** In
`docker-compose.staging.yml` the worker↔adapter-manager conversation happens on **`control-net`**:
workers are `[control-net, store-egress-net]` and `adapter-manager` is
`[control-net, provider-ctl-net]` (`staging-manifest-invariants.mjs:63-70`). **`provider-ctl-net` is
adapter-manager-only**, and a worker attached to it is a hard `PROVIDER-CONTROL VIOLATION`
(`:438-443`) — so the earlier sentence "workers speak to adapter-manager over `provider-ctl-net`"
described the exact thing the manifest gate exists to reject. `provider-ctl-net` is the
*adapter-manager → E2B* leg, not the *worker → adapter-manager* leg.

**★ And the name is overloaded across two compose files.** `docker-compose.d1.yml` uses
`provider-ctl-net` to mean something different: there, `worker-a` (`:332`) and `worker-b` (`:368`)
**are** on it — the file's own topology matrix says so in prose (`:14-22`) — because D1's fake
provider is a container the workers must reach directly. Both files are correct for their own
topology; the name is not portable between them.

**Why the correction matters more than a typo would.** The corrected sentence is about to be written
into a **CI-enforced register** (`scripts/finding-ownership.json`, "Register action" below), where a
wrong network name stops being a slip and becomes a durable false statement — one the next reader
designs a wire against, and one no guard can contradict because no guard reads prose.

**Why deferring is correct, not convenient.** There is no consumer: `adapter-manager` is declared
and enforced against but has **zero implementation** (DECISION §4.2, `:166-174`); no worker
dispatches (flag default-off, no `compose:true` branch). Specifying a wire against an unimplemented
peer for an unbuilt caller is the failure this programme keeps re-learning.

**Its precondition, written down.** E6-F003 becomes *required* the moment a containerized worker
under `docker-compose.staging.yml` must dispatch — because §2.5 forbids `E2B_API_KEY` on any worker
surface, so that worker's provider **cannot** be key-backed and **must** be networked, reaching
`adapter-manager` over `control-net`. **DEP-010 therefore wires the desktop/self-hosted lane only**,
and §3.3 states that as a consequence, not an oversight.

**Register action.** Stays `open`/`unowned` (permitted for HIGH; may never be `accepted`). Its
`reason` is rewritten to: the narrowed question (a wire, not a port), the removed entanglement, the
precondition above, and the correct network — with the d1-vs-staging overload called out in one
clause so the next reader does not have to rediscover it.

### 2.2 ★ What "E6-F008 resolved" does NOT buy — recorded before the entry is deleted

Deleting a register entry is the moment to be precise about what the deletion claims, because
nothing re-checks it afterwards.

**(a) The bridge runs one way, and the useful-for-DEP-010 direction is the one that exists.**
`perOpToInvokeDriver(provider: SandboxProvider): SandboxProviderDriver` (`per-op-adapter.ts:112-115`)
takes the daemon's per-op port and produces the harness's driver port. DEP-010 needs exactly that
direction — it must hand the daemon a **per-op** provider, and `E2bSandboxProvider` already is one
(`e2b-provider.ts:136`). So the root has something to inject. What does **not** exist is
`driver → per-op`, and that absence is load-bearing in the opposite way: **the DEP-000 fake cannot
stand in as the daemon's provider.** `packages/sandbox-fake-provider` implements the driver port
structurally (`fake-driver.ts:5-8`); nothing adapts it onto `SandboxProvider`. That is *correct*
(§3.4 rejects shipping a fabricating provider on a production path) but it means the harness and the
daemon exercise **two independent provider doubles** — `packages/sandbox-fake-provider` for the
suites, `packages/worker-daemon/src/__tests__/support/fake-provider.ts` for the supervisor. The
DEP-000 harness never drives the daemon's supervisor. Recorded as residual §8.7; **not** fixed here.

**(b) F008's own resolution text set a bar the shipped adapter does not clear.** The finding's
option (b) is "a tested `SandboxProvider → SandboxProviderDriver` adapter **with a totality
assertion over all 11 ops + their result shapes**" (`epics/E6-deployment-test-harness/findings.md:90-92`).
`PROVIDER_OPERATIONS` has 11 entries (`packages/worker-protocol/src/capabilities.ts:125-137`). The
adapter routes them with hand-written `switch` arms (`per-op-adapter.ts:308-392`) and the suite
checks them **case by case** — `per-op-adapter.test.ts:92` names eight in one test, `:110` covers
`reconcile_cleanup`, `:231`/`:243` cover the optional trio through the advertisement gate. There is
**no** `for (const op of PROVIDER_OPERATIONS)` assertion anywhere in the package.

**Do one of these two in Step 1, not both:**

- **Preferred — earn it.** Add a totality case to
  `packages/sandbox-e2b-provider/src/__tests__/per-op-adapter.test.ts` that iterates
  `PROVIDER_OPERATIONS` and asserts every op either routes to its per-op method or raises
  `UnsupportedProviderOperation` (never "silently returns"), so a twelfth op added to the frozen
  vocabulary fails here rather than in production. Note this adds **no file** — the tree is pinned
  per file, not per case, so `test-inventory.json` is unaffected.
- **Or supersede it, in writing.** State in the `findings.md` resolution that D1/D2 supersede option
  (b): the totality bar was written when the adapter was *the* reconciliation, and D1 demotes the
  driver port to a harness surface whose per-op coverage is the suites' problem, not the port
  question's.

Silently closing at a lower bar than the finding's own text is the aggregation failure
`gate-clause-wiring.mjs` was built for. Whichever branch is taken must appear in the resolution
paragraph.

---

## 3. DECISION D3 — the root is the existing `desktop-host.ts`; the provider package is confined to one new file

### 3.1 The constraint that decides the shape

`scripts/lib/worker-keystore-boundary.mjs:56-59` pins `worker-keystore` to **exactly**
`{worker-daemon, worker-protocol}`, and the module header (`:20-24`) says: *"Adding anything is a
STOP for controller approval — a native keychain binding must never arrive here by accident, because
this package is injected INTO the daemon's process."* `ALLOWED_BARE` (`:94-97`, applied at `:152`)
rejects every other bare specifier in runtime source, **including `import type`** (the scanner is
lexical — `worker-protocol-boundary.mjs:368-379` reaches `from` regardless of the `type` modifier)
and **including a literal dynamic import** (`extractModuleSpecifiers` emits `kind:"dynamic"` with a
value, which flows through the same allow check).

There is no clever way in. **Adding the provider package to this package IS a controller STOP**, and
this design asks for it explicitly. The go-book has already granted it, **conditionally**, as
decision **D-3** (`GO-BOOK.md:404`) — so Step 0 is the check that the three conditions hold, not a
fresh request.

### 3.2 Pay for the widening by making the guard tighter than it was

The concern is real: the provider package transitively pulls the `e2b` network SDK into the process
that holds the device private key. So the widening is **paired with two new confinement rules**, both
modelled on files that already exist — `SUBPROCESS_HOST_PATH` (`:71`), whose own history (a basename
check that let any `command-runner.ts` inherit permission) is why it keys on the full
package-relative path, and the e2b leaf's `CREDENTIAL_TOKEN` (`sandbox-e2b-provider-boundary.mjs:56`,
`:126-128`).

- `REQUIRED_RUNTIME_DEPENDENCIES` → the three-element sorted list.
- `ALLOWED_BARE` gains the specifier.
- **New (path):** `PROVIDER_HOST_PATH = "src/bin/sandbox-provider.ts"` — the provider package may be
  named from **exactly one path**; every other runtime file is rejected, with the reason in the error
  text.
- **★ New (credential):** `FORBIDDEN_CREDENTIAL_TOKENS = ["E2B_API_KEY"]` — the token may appear in
  **ZERO** runtime source files in this package. Not "one host file": zero. This package has no
  legitimate reason to name the credential, which is precisely what §3.2 claimed and nothing checked.

**Why the credential ban is not decorative.** Steps 6 and 7 require a refusal message that mentions
`E2B_API_KEY`, and the obvious implementation writes the literal into `sandbox-provider.ts` or
`desktop-host.ts`. That would put the credential's name into the key-holding package and nothing
would object. The rule makes the obvious implementation fail, and the correct one is forced:

> **The `E2B_API_KEY` mention arrives by PROPAGATING the transport's own error text.**
> `createRealE2bTransport()` throws synchronously from its constructor
> (`real-transport.ts:84` → `requireApiKey` `:53-59`) with the message
> *"RealE2bTransport requires E2B_API_KEY (provider-control credential) …"*. `sandbox-provider.ts`
> catches, wraps as `{kind:"refused", reason: <the caught message>}` and **never types the token**.
> The assertion that the operator really sees it lives in
> `packages/worker-keystore/src/__tests__/sandbox-provider.test.ts` — a `.test.ts`, which both
> scanners skip by classification (`worker-protocol-boundary.mjs:94-99`;
> `check-worker-keystore-boundary.mjs:112`).

Note the e2b leaf's precedent scans **raw source** (`sandbox-e2b-provider-boundary.mjs:126`), so a
comment naming the token counts. Mirror that. It means the Step 6 header must explain the credential
confinement **without spelling the variable** — say "the transport reads the provider-control
credential itself (DEP-006 confinement point, `real-transport.ts:53-59`)". This is a real
constraint on the prose, not an accident, and it is the point: a package that must not carry a
credential should not carry its name either.

Net: one more allowed specifier, two more confinement rules. The dangerous capability lands in one
reviewable file instead of becoming ambient, and the credential's name never lands at all.

- **Lazy load.** `sandbox-provider.ts` uses a **literal dynamic** `import(...)`. A static import
  would load the SDK on **every** boot including the default boot that constructs nothing
  (`index.ts` statically re-exports `real-transport.js`, which imports `e2b` at module scope).
- **The credential never crosses the root.** `createRealE2bTransport()` is called with no `apiKey`;
  it reads the credential itself (`real-transport.ts:53-59`, called from the constructor at `:84`),
  the DEP-006 confinement point. `worker-keystore` never names it — now enforced.

### 3.3 Dependency-direction consequences

1. **New arrow `worker-keystore → sandbox-e2b-provider`.** With the existing
   `sandbox-e2b-provider → worker-daemon`, the graph stays a DAG. No cycle.
2. **`worker-keystore` becomes the only package naming daemon + OS custody + a provider.** The
   DSK-001 arrangement extended by one.
3. **The daemon's arrow is untouched.** `worker-daemon-boundary.mjs:53` is not edited; Step 9 proves
   it with positive controls.
4. **The fake's arrow is untouched** — that is E6-F004's answer.
5. **★ The desktop artifact grows, and by how much is now MEASURED rather than assumed.** The
   first draft said the DSK-003 staging manifest "regenerates by the build, so nothing drifts
   silently." **That mitigation does not exist.** `scripts/build-desktop-staging.mjs` refuses to run
   — its own header (`:21-30`) records that producing its link-free input is an unsolved packaging
   step, `pnpm deploy --prod` yields 36 symlinks and the hoisted variant yields no `node_modules` at
   all — and the only thing CI executes is its unit test (`.github/workflows/pr.yml:365`). Nothing
   regenerates a manifest today, so nothing would have caught the growth. **The go-book had already
   reached the same conclusion independently:** decision **D-3** (`GO-BOOK.md:404`) records that "the
   earlier approval leaned partly on the staging-manifest mitigation — that build **refuses to run**,
   so it mitigates nothing." Two documents arriving at it separately is the reason it is stated here
   in the plan's own voice rather than left as a cross-reference.

   Measured instead, on this workspace at revision time (`pnpm why e2b` + the lockfile's `e2b@2.30.5`
   snapshot, closed transitively):

   | | |
   |---|---|
   | direct dependency | `e2b@2.30.5` (`packages/sandbox-e2b-provider/package.json:28`) |
   | transitive closure | **36 packages** — incl. `undici`, `tar`, `glob`, `@bufbuild/protobuf`, `@connectrpc/connect{,-web}`, `dockerfile-ast`, `openapi-fetch`, `chalk`, `cross-spawn` |
   | on disk, unpruned | **~15.2 MiB across ~1,752 files** |

   That is the *pre-prune* number: `isShippableStagingPath` would drop docs/benchmarks/READMEs
   (`staging-manifest.mjs:33-52`), so the shipped figure is smaller — by an amount nobody can compute
   until an assembler runs. Record the measured number in the DEP-010 result doc so the first real
   assembly has a baseline to compare against.

   **★ The real handoff is the secret scan, and it goes to DSK-003 packaging by name.**
   `build-desktop-staging.mjs` step 4 scans the assembled bytes for embedded credentials, and that
   scan **already had to prune third-party READMEs and benchmarks** to stay green — pino's README and
   `@pinojs/redact`'s benchmarks contain `password: "hunter2"`-style examples
   (`staging-manifest.mjs:41-51`). The `e2b` closure is **36 new packages of unscanned third-party
   bytes** entering that scan for the first time. Expect false positives; the correct response is
   another prune rule, never a weaker scan. **Flag this to DSK-003 explicitly** — not as "the
   artifact is bigger", but as "an unmeasured new input to a scan that has already been widened once
   to survive its existing inputs."
6. **This is the desktop/self-hosted lane ONLY.** A staging containerized worker cannot use it:
   `E2B_API_KEY` on a worker is a hard `PROVIDER-CONTROL VIOLATION`. The containerized lane needs
   E6-F003. The boundary of this ticket, not a gap in it.

### 3.4 Alternatives rejected

| Alternative | Why not |
|---|---|
| New package `@armyofagents/worker-desktop-host` owning the bin | Moves `bin/aoa-worker-desktop` out of `worker-keystore/package.json:15`, reaching DSK-003 install layout, autostart `execPath`, and the staging manifest. It would also mint a new tree that `test-inventory.json` must adopt (default-deny: an unmanaged tree with tests is a violation — `lib/test-inventory.mjs:24-26`). Far larger blast radius to avoid one reviewed guard edit — and it writes a root when one already exists. **Reconsider only if a controller withdraws D-3 on the measured cost (Step 0).** |
| Relocate the per-op port to a shared leaf (E6-F008 option (a)) | Contradicts the explicit E4-F003 choice at `provider.ts:10-14`; churns the port every consumer imports; buys nothing, since the adapter already bridges. |
| Make the fake the daemon's provider | It implements the other port, and no `driver → per-op` adapter exists (§2.2a). Building one would ship a fabricating provider on a production path — the WRK-009 defect shape. |
| Fall back to `MockE2bTransport` when no key is present | A worker that fabricates provider success is byte-identical to a real one on every gate. Never in production. |
| Degrade to "no provider" when an explicitly-requested provider cannot be built | The operator would see `no_provider` — the message for a build that *cannot* have one — and rebuild something that is fine. An explicit opt-in that cannot be honoured is a **refusal**. |
| Avoid the gate-clause-wiring failure by not naming `E2bSandboxProvider` (structural access, `Reflect.get`) | This is evasion of a guard, not compliance with it. The register's whole purpose is that a capability acquiring a caller becomes visible; hiding the reference to keep a stale `unwired` entry green is the exact behaviour `gate-clause-wiring.mjs:95-104` was written to surface. Update the declaration instead (Step 6). |

---

## 4. What this ticket does NOT do — and how that is proven

DEP-010 wires the **seam** and the **root**. It does **not** turn dispatch on. Three independent
facts keep the shipped default inert; Steps 7/8/10 prove each:

1. **`AOA_WORKER_SANDBOX_PROVIDER` unset by default** → resolver returns `{kind:"none"}` →
   `provider: undefined` → `no_provider`. The `e2b` SDK is never loaded (Step 7 asserts the loader is
   called zero times).
2. **`AOA_WORKER_DISPATCH_ENABLED` stays default-off**, unset in every deployment surface; Step 10
   makes setting it on a staging worker a CI failure.
3. **★ Nothing consumes `compose === true` — a STRUCTURAL fact, not a flag value.** This is the
   revised form of the third proof, and it replaces the previous one for a reason worth stating.

### 4.1 ★ Why the old third proof was anchored to sand

The first draft proved inertness by keying on `hasSelfModelReader: false`
(`bin/worker-daemon.ts:344`). That literal is **documented scaffolding that Sprint 3 deletes**:
`compose-dispatch.ts:44` says in so many words *"This reason retires when 2b lands"*, and slice 2b is
the very next sprint (`GO-BOOK.md:127`, `:236-237`). A lock whose mutation target is removed by the
next ticket stops locking anything the moment that ticket lands, silently — nobody re-derives what a
deleted line was holding up.

**The structural lock, which survives 2b's arrival:**

> With provider **and** flag **and** a self-model reader **and** a self-model all satisfied,
> `decideDispatchComposition` returns `{compose: true}` (`compose-dispatch.ts:59-67`) — and
> `bootstrapWorkerDaemon` **still composes no supervisor and no poll loop**, because the only thing
> reading the decision is `if (!dispatch.compose) { logger.info(...) }` at
> `bin/worker-daemon.ts:347-349`. **There is no `else`.** The seams that would build a loop stay
> empty by presence-gating on deps the shipped binary never passes: `deps.reconciler` (`:355`),
> `deps.leasing` (`:362`), `deps.eventOutbox` (`:363`) each degrade to `[]`.

That is the honest statement of "does not turn dispatch on": not *the daemon cannot reach
`compose:true`*, but *reaching it changes nothing, because nothing is listening*. It stays true when
`hasSelfModelReader` becomes real, and it stops being true exactly when slice 2b writes the `else` —
which is when it *should* stop being true.

**The `:344` mutation is DEMOTED to a supporting check.** Keep it (it is cheap and it documents
today's behaviour), but it is no longer what §9 maps the acceptance clause to.

**And note the second hardcoded falsy nobody mutated.** `selfModel: null` at `bin/worker-daemon.ts:345`
is a separate literal on the same call, gating a separate refusal (`no_self_model`,
`compose-dispatch.ts:65`). The old matrix mutated `:344` and never `:345`, so the fourth gate had no
falsifying test at all. Step 8 adds one.

---

## 5. Files

| File | Change |
|---|---|
| `epics/E6-deployment-test-harness/findings.md` | E6-F008 + E6-F004 → `resolved`; E6-F008's resolution states the §2.2b branch taken; E6-F003 body rewritten to the narrowed question **on `control-net`** |
| `scripts/finding-ownership.json` | delete E6-F008, E6-F004; rewrite E6-F003 reason |
| **`scripts/gate-clause-wiring.json`** | **★ REQUIRED — `E7-1-coding-journey` re-declared. Without this, `policy` goes red.** See Step 6 |
| **`scripts/test-inventory.json`** | **★ REQUIRED — `packages/worker-daemon` 131 → 132; `packages/worker-keystore` 18 → 20.** Bumped in the same commits that add the files |
| **`.github/workflows/pr.yml`** | **★ REQUIRED — `pnpm --filter @armyofagents/sandbox-e2b-provider build` appended to the `verify` pre-build list (`:743-751`); mirrored into the `distributed-contract` list (`:1168-1173`) for symmetry** |
| **`pnpm-lock.yaml`** | regenerated by `pnpm install` after the manifest change; **must ride in the same commit as `packages/worker-keystore/package.json`** (`pr.yml:134-145`) |
| **`docs/deploy/environment-variables.md`** | **★ two new rows — `AOA_WORKER_SANDBOX_PROVIDER`, `AOA_WORKER_E2B_TEMPLATE`.** No guard will catch their absence (§0.1: brand-check guard 9 matches only literal `process.env.AOA_…`, and these are read through a string constant) |
| `packages/worker-daemon/src/index.ts` | **additive export** of `decideDispatchComposition` + `DISPATCH_REFUSAL_MESSAGES` + types. No new import, no new dependency |
| `packages/worker-daemon/src/supervisor/provider.ts` | header only: name the authority decision, point at the adapter |
| `packages/sandbox-provider-contract/src/port.ts` | header only: `:14-26` rewritten from "OPEN item" to the settled demotion |
| `packages/worker-keystore/src/bin/sandbox-provider.ts` | **new** — the ONLY file permitted to name the provider package, and it may not name the credential |
| `packages/worker-keystore/src/bin/desktop-host.ts` | `DesktopHostDeps.provider` + `.loadProviderModule`; resolve-then-inject before `bootstrap(...)` |
| `packages/worker-keystore/package.json` | add the provider dep |
| `scripts/lib/worker-keystore-boundary.mjs` | +1 dep, +1 bare, **+`PROVIDER_HOST_PATH` confinement**, **+`FORBIDDEN_CREDENTIAL_TOKENS` ban** |
| `scripts/check-worker-keystore-boundary.test.mjs` | +6 cases (4 path, 2 credential) |
| `scripts/lib/staging-manifest-invariants.mjs` | **new invariant**: dispatch/provider switches absent from every worker, across `environment` **and** `command`/`entrypoint` |
| `scripts/check-staging-manifest.test.mjs` | +4 cases |
| `packages/sandbox-e2b-provider/src/__tests__/per-op-adapter.test.ts` | +1 totality case, **iff** §2.2b's "earn it" branch is taken (no new file — the pin is per file) |
| `packages/worker-keystore/src/__tests__/sandbox-provider.test.ts` | **new** |
| `packages/worker-keystore/src/__tests__/desktop-host-provider.test.ts` | **new** |
| `packages/worker-daemon/src/__tests__/public-surface-dispatch.test.ts` | **new** |
| `docs/replatform/current-main-crosswalk.md` | CM-010 **LAST column only** — see Step 11 |
| **Untouched, deliberately** | `worker-daemon-boundary.mjs`, `sandbox-fake-provider-boundary.mjs`, `worker-daemon/package.json`, `compose-dispatch.ts`, frozen `worker-protocol`, **CM-010's owner cell** |

---

## 6. Implementation — bite-sized TDD steps

Every step: **write the failing test → run it and read the failure → minimal implementation → run it
→ commit.**

**Standing rule added in revision 1:** three always-on `policy` guards react to files this ticket
adds, and each must be updated **in the commit that trips it**, never later. A commit that lands red
and is fixed by the next one is a commit nobody can bisect through.

| Trips on | Fix in the same commit |
|---|---|
| a new file under any `__tests__` | `scripts/test-inventory.json` pin |
| production source naming `E2bSandboxProvider` | `scripts/gate-clause-wiring.json` `E7-1` declaration |
| `packages/worker-keystore/package.json` dependency change | `pnpm-lock.yaml` (same commit, or the lockfile step rejects it) |

### Step 0 — the controller STOP is DISPOSITIONED; confirm the conditions, do not re-litigate
No code. **The keystore widening is already approved** — go-book decision **D-3**
(`GO-BOOK.md:404`), settled 2026-08-25 and explicitly listed under "do not relitigate" (`:394`). It
was approved **on three conditions**, and Step 0 is now the check that this plan satisfies each:

| D-3 condition | Where this plan satisfies it |
|---|---|
| (a) a `PROVIDER_HOST_PATH` confinement so **exactly one file** may name the provider | §3.2; Step 5's `PROVIDER_HOST_PATH` + the `bin/nested/` case that closes the basename hole |
| (b) the boundary checker is **tightened, not merely widened**, and its own test proves a **second naming file fails** | §3.2's *two* new rules (path + credential); Step 5's six cases; §7's five keystore mutations |
| (c) the shipped desktop default stays provider-less **and a guard asserts it** | Step 4's lock (2 mutations), Step 8's structural lock, Step 10's static deployment invariant |

D-3 also records *why* the earlier approval needed re-stating: it "leaned partly on the
staging-manifest mitigation — that build refuses to run, so it mitigates nothing." §3.3.5 now carries
the replacement (a **measured** cost, and a named handoff) rather than the phantom one, and Step 0's
presentation must lead with it: **36 packages, ~1,752 files, ~15.2 MiB unpruned**, all of it new
input to an embedded-secret scan that has already been widened once to survive its existing inputs.

If a controller nonetheless refuses on the measured cost, stop and re-plan as §3.4's new-package
alternative. Steps 1–4 are independent and may proceed regardless.

### Step 1 — the findings register records the decision (RED comes from the guard)
**RED.** Edit `findings.md` first: E6-F008 → `RESOLVED` with the D1/D2 text **and the §2.2b branch
stated explicitly** (totality case added, or option (b) superseded with a reason); E6-F004 →
`RESOLVED` with the rejection of its own proposed fix; E6-F003 stays `open`, body rewritten to the
narrowed question **on `control-net`**, with the `docker-compose.d1.yml` overload noted in one
clause.

If the "earn it" branch is chosen, add the `PROVIDER_OPERATIONS` totality case to
`packages/sandbox-e2b-provider/src/__tests__/per-op-adapter.test.ts` **in this commit** — the claim
and its evidence should not be separated by a commit boundary. It adds no file, so no pin moves.

Run `node scripts/check-finding-ownership.mjs` → **FAIL** twice with `stale_declaration`
(`finding-ownership.mjs:132-136`).

**GREEN.** Delete both entries from `scripts/finding-ownership.json`; rewrite `E6-F003.reason` to the
narrowed question + the §2.1 precondition + the correct network. Re-run → **PASS**.

**Mutation.** Re-add E6-F008 → must fail `stale_declaration`. Flip E6-F004 back to `open` in
`findings.md` → must fail `undeclared_finding`. Both directions, then restore.

**Commit:** `DEP-010: name the authoritative provider port; resolve E6-F008/E6-F004, narrow E6-F003`

### Step 2 — the dispatch decision joins worker-daemon's public surface
**Why.** The root lives outside the package and supplies the `provider` input; today it cannot import
the decision, so "the root works" would be a claim about a private function.

**RED.** `packages/worker-daemon/src/__tests__/public-surface-dispatch.test.ts` importing
`decideDispatchComposition`, `DISPATCH_REFUSAL_MESSAGES` from `../index.js`; assert
`{provider: undefined, dispatchEnabled: true, hasSelfModelReader: true, selfModel: null}` →
`{compose:false, reason:"no_provider"}`, and that with a fake provider the flag toggles
`compose:true` / `dispatch_disabled`. Run → **FAIL** (no such export).

**GREEN.** Append to `index.ts` a re-export of the function, the frozen message map, and the three
types, with a comment stating why it is public (the root is outside the package by E4-D01). Run →
**PASS**. Then `node scripts/check-worker-daemon-boundary.mjs` → **PASS** (nothing imported;
`index.ts` already re-exports from `./lifecycle/…` — `:566-567`).

**★ Same commit:** `scripts/test-inventory.json` `packages/worker-daemon` **131 → 132**. Verify with
`node scripts/check-test-inventory.mjs` → **PASS**; without the bump it reports
`packages/worker-daemon: 1 test file(s) added (132, pinned at 131) — bump the pin` and exits 1.

**Commit:** `DEP-010: export decideDispatchComposition so a composition root can assert it`

### Step 3 — the root gets a provider path (no new dependency)
**RED.** `packages/worker-keystore/src/__tests__/desktop-host-provider.test.ts` with a
`capturingBootstrap()` that records `deps.provider`; assert a directly-injected provider reaches
bootstrap. Run → **FAIL**.

**GREEN.** Widen the `@armyofagents/worker-daemon` import with `type SandboxProvider`; add
`readonly provider?: SandboxProvider` to `DesktopHostDeps` with a comment stating it is **absent for
the shipped binary**; pass `provider: deps.provider` in the `bootstrap({...})` call
(`desktop-host.ts:254-260`). Run → **PASS**; boundary checker → **PASS** (already-allowed specifier).

**★ Same commit:** `scripts/test-inventory.json` `packages/worker-keystore` **18 → 19**.

**Commit:** `DEP-010: give the desktop composition root a provider pass-through`

### Step 4 — LOCK the shipped default (green on arrival → mutation-checked)
**Honesty note: these pass the moment they are written.** They are regression locks, not REDs, and
earn their place only through the mutation check.

Add: the shipped shape passes **no** provider; and a **real** `bootstrapWorkerDaemon` booted from the
shipped env reports `no_provider` through a real logger.

**Mutation (both must fail, then revert):** (a) `provider: deps.provider ?? ({} as SandboxProvider)`
→ first test fails. (b) `compose-dispatch.ts:62` `if (!input.provider)` → `if (false)` → second
fails.

No new file (cases land in `desktop-host-provider.test.ts`), so no pin moves.

**Commit:** `DEP-010: lock the shipped default — no provider, no dispatch`

### Step 5 — the boundary guard: widen by one, confine to one path, ban the credential
**RED.** Add six cases to `scripts/check-worker-keystore-boundary.test.mjs`:

*Path confinement (4):* allowed from `src/bin/sandbox-provider.ts`; **rejected** from
`bin/desktop-host.ts`, from `identity-store.ts`, and from **`bin/nested/sandbox-provider.ts`** (the
exact hole the `SUBPROCESS_HOST_PATH` history taught); manifest must declare three deps.

*Credential ban (2):* a runtime file containing `E2B_API_KEY` **in code** is rejected; a runtime file
containing it **only in a comment** is *also* rejected (mirroring
`sandbox-e2b-provider-boundary.mjs:126`, which scans raw source). The second case is the one that
would otherwise pass by accident and is why the rule scans bytes, not tokens.

Run → **FAIL**.

**GREEN.** In `scripts/lib/worker-keystore-boundary.mjs`: three-element
`REQUIRED_RUNTIME_DEPENDENCIES`, the specifier in `ALLOWED_BARE`, a new `PROVIDER_HOST_PATH` check in
`evaluateRuntimeSourceImports` after the `SUBPROCESS_SPECIFIERS` block (`:145-151`) whose error text
names the reason (the `e2b` SDK entering the key-holding process), and a
`FORBIDDEN_CREDENTIAL_TOKENS` scan beside the `existsSync` ban (`:171-177`) whose error text says
*zero files*, not *one host file*. Run → **PASS**; real checker → **FAIL** (manifest still two).

**★ Then, in this same commit:**
1. add `"@armyofagents/sandbox-e2b-provider": "workspace:*"` to
   `packages/worker-keystore/package.json`;
2. `pnpm install` → `pnpm-lock.yaml` updates (the manifest change rides with it, which is what
   `pr.yml:134-145` requires);
3. append `pnpm --filter @armyofagents/sandbox-e2b-provider build` to the `verify` pre-build list at
   `.github/workflows/pr.yml:743-751`, **after** the `sandbox-provider-contract` line (it depends on
   worker-daemon + contract dist, both already built above it), and mirror it into the
   `distributed-contract` list at `:1168-1173`.

Re-run the checker → **PASS**.

**Why (3) is not optional.** `@armyofagents/sandbox-e2b-provider`'s exports resolve to `./dist`
(`package.json:6-13`) and nothing builds it before `verify` runs `pnpm -r typecheck` and
`pnpm test:run` (`pr.yml:753-760`). Step 6 requires a **literal** dynamic import, which NodeNext
type-resolves — so `worker-keystore`'s `tsc --noEmit` needs the `.d.ts`, and its vitest project
(`vitest.config.ts:24`) needs the `.js`. Locally both exist from an earlier `pnpm build`; on a fresh
CI checkout neither does. **Green locally, red in CI** is the exact failure this line prevents.

**Mutation.** (a) Drop `PROVIDER_HOST_PATH` from the comparison → the rejected-elsewhere case must
fail. (b) Remove the specifier from `ALLOWED_BARE` → the allow-at-path case must fail. (c) Narrow the
credential scan from raw source to code tokens → the comment case must fail. Revert all three.

**Commit:** `DEP-010: allow the provider package in worker-keystore, confined to one path, credential-free`

### Step 6 — `sandbox-provider.ts`: resolve or refuse, never guess
**RED.** `packages/worker-keystore/src/__tests__/sandbox-provider.test.ts`, pairing the **real**
`E2bSandboxProvider` with `createMockE2bTransport()` through the injected module seam (so the mock is
never reachable from production code). Cases:

- gate unset → `{kind:"none"}` **and the loader is never called**;
- explicit `"none"` → same;
- unrecognised value → `refused` (not off);
- `e2b` with no template → `refused`;
- opted-in with a template → **real** `E2bSandboxProvider` whose `advertisedOperations.has("create")`
  is true (non-vacuity);
- transport throws → `refused`, and the message **contains** `E2B_API_KEY` — asserted here, in a
  `.test.ts` the scanner skips, because §3.2 forbids the production files from typing it;
- **the default loader really is the provider package** (no injection → the real
  `@armyofagents/sandbox-e2b-provider` is imported and, with no key, refuses — proving the seam is
  not vacuous).

**★ D12 — the last case must pass an EXPLICIT env, not inherit `process.env`.** `requireApiKey` reads
`process.env.E2B_API_KEY` directly (`real-transport.ts:54`), so on a developer machine with the key
exported this test would construct a real provider and fail — or, worse, be "fixed" by inverting the
assertion. Build the env explicitly:

```ts
const { E2B_API_KEY: _omit, ...rest } = process.env;   // never mutate process.env
const env = { ...rest, AOA_WORKER_SANDBOX_PROVIDER: "e2b", AOA_WORKER_E2B_TEMPLATE: "t" };
```

and pass it to `resolveSandboxProvider(env, /* no loader */)`. `resolveSandboxProvider` already takes
`env` as its first parameter (§3.2's split-env-source residual, §8.5) — this is what that split is
*for*. If a future refactor makes the transport read the injected env instead, this test stops being
environment-dependent for a better reason; until then, the explicit env is the fix.

Run → **FAIL**.

**GREEN.** Create the file. Exports `PROVIDER_ENV = "AOA_WORKER_SANDBOX_PROVIDER"`,
`TEMPLATE_ENV = "AOA_WORKER_E2B_TEMPLATE"`, `PROVIDER_KINDS`, `ProviderResolution`
(`none` | `provider` | `refused`), a **structural** `ProviderModule` interface, `loadProviderModule`
using a **literal dynamic** import, and `resolveSandboxProvider(env, load)`. Header states: why it is
confined, why the import is dynamic (the checker requires a literal; a static one would load the SDK
on every boot), why the provider-control credential is not named here (the transport reads it —
DEP-006 confinement, `real-transport.ts:53-59`; **and this package's boundary now forbids the token
outright**, so do not spell it even in prose), and why a bad configuration is a refusal.

**★ Same commit — `scripts/gate-clause-wiring.json`.** This is the commit in which production source
first names `E2bSandboxProvider` (the `ProviderModule` interface's property, and the `new
mod.E2bSandboxProvider(...)` construction). The counter at
`check-gate-clause-wiring.mjs:66-90` blanks imports and re-export blocks but counts both of those
lines, so `E7-1-coding-journey`'s count goes `0 → N` and
`gate-clause-wiring.mjs:105-113` raises `unwired_but_now_has_caller` → `exit 1` in the **always-on**
`policy` job. Worse than the red: the entry's stated reason — *"The package is in no other
package.json dependency list, so no production process can construct it"* — becomes **false**, and a
false reason in this register is the precise defect it was built to prevent.

Two admissible resolutions. **Pick the second unless Sprint 5 has already run:**

- **Promote to `wired`.** Honest only if you are claiming the coding journey RUNS. DEP-010 explicitly
  does not (§4): the provider is constructible, but nothing consumes `compose === true`. Promoting
  here would re-commit the aggregation error the register exists to catch.
- **★ Keep `unwired`, set `expectedReferences`, rewrite the reason.** Run
  `node scripts/check-gate-clause-wiring.mjs --counts`, read the measured number for
  `E2bSandboxProvider`, and type it into `expectedReferences` — the field exists precisely for
  "referenced but not reachable" (`gate-clause-wiring.mjs:99-104`, whose worked example is
  `runBrowserSession`). The number must be typed out, not computed, so a later reference still fires.
  Rewrite `reason` to something like:

  > *"DEP-010 (Sprint 2) gives the desktop composition root a dependency path and a one-file
  > construction seam (`packages/worker-keystore/src/bin/sandbox-provider.ts`), so the N references
  > below are that seam. It is still unreachable in a shipped boot: construction requires
  > `AOA_WORKER_SANDBOX_PROVIDER=e2b` plus a template, and even a provider-bearing daemon composes no
  > supervisor — `bin/worker-daemon.ts:347-349` has no `else` on `dispatch.compose`. Promote when
  > WRK-008 slice 2b (Sprint 3) composes the loop; the journey is proven in Sprint 5."*

  Then re-run the checker: **PASS**, and the clause is still printed on the green run's
  `DORMANT, on the record:` line — which is the outcome we want.

**★ Same commit:** `scripts/test-inventory.json` `packages/worker-keystore` **19 → 20**.

**Mutation.** (a) unrecognised-value branch → `{kind:"none"}` → its test fails. (b) missing template
→ `templateId ?? "base"` → its test fails. (c) `catch` → `{kind:"none"}` → both the throw test and
the default-loader test fail. (d) `expectedReferences` lowered by one → `check-gate-clause-wiring.mjs`
must fail with `unwired_but_now_has_caller` (proving the number is load-bearing, not decorative).
Revert all.

**Commit:** `DEP-010: the one file that may construct a sandbox provider`

### Step 7 — wire the resolver into the root, after the control and reset branches
**RED.** Add: resolves from env and hands a real provider to bootstrap; **refuses to boot** when an
explicitly requested provider cannot be built (`ok:false`, `exit(1)`, bootstrap **never called**,
message mentions `E2B_API_KEY` — again asserted only in the `.test.ts`); **a control command must NOT
construct a provider**; **`--reset-identity` must NOT construct a provider**. Run → **FAIL**.

**GREEN.** Add `loadProviderModule?: ProviderModuleLoader` to `DesktopHostDeps`; insert the resolve
block **immediately before** `bootstrap(...)` (`desktop-host.ts:254`) — after the control branch and
after the reset branch, both of which return early. A direct `deps.provider` wins; a `refused`
resolution logs the propagated transport message, `exit(1)`, returns `{ok:false}`.

**Mutation.** Move the resolve block **above** the control branch → the two "must NOT construct"
tests must fail. Revert.

**Commit:** `DEP-010: the desktop host resolves and injects a real sandbox provider`

### Step 8 — acceptance: the provider arrives, and composition still happens nowhere
**RED/verify.** Boot the root, capture what it produced, feed **that** into the real decision:

- root-produced provider + flag on → `{compose:true}`; flag off → `dispatch_disabled`.
- shipped shape → provider `undefined` → `no_provider` for **both** flag values.
- **★ the structural lock (the primary proof, §4.1):** call the **real** `bootstrapWorkerDaemon` with
  the root-produced provider **and** `AOA_WORKER_DISPATCH_ENABLED=1`, and assert on the returned
  `BootstrapResult` + the injected logger that **no supervisor and no poll loop were composed** — the
  `deps.leasing` / `deps.eventOutbox` / `deps.reconciler` seams stayed `[]`, and the only
  dispatch-related output is the refusal log line. This holds for any value of `hasSelfModelReader`,
  because `bin/worker-daemon.ts:347-349` has no `else`.
- **the reason today, as a supporting check:** the same boot reports **`no_self_model_reader`**, and
  **not** `no_provider` (the provider did arrive).

**Mutations.**

| # | Mutation | Required failure | Note |
|---|---|---|---|
| a | Add an `else` branch at `bin/worker-daemon.ts:349` that composes anything observable | the structural-lock case must fail | **this is the load-bearing one** — it is the mutation slice 2b will make for real |
| b | `hasSelfModelReader: false → true` at `:344` | the supporting `no_self_model_reader` case must fail | demoted; retires with slice 2b |
| c | `selfModel: null` → a valid `WorkerSelfModel` at `:345` | with (b) also applied, the decision reaches `{compose:true}` and mutation (a)'s absence is what still holds the line | closes the fourth gate, which had **no** falsifying test before revision 1 |

Revert all three.

**Commit:** `DEP-010: prove the provider arrives and that nothing composes a loop`

### Step 9 — the daemon still cannot import a provider (positive controls, none committed)
Run all five boundary checkers + their self-tests; all **PASS** with `worker-daemon-boundary.mjs:53`
and `sandbox-fake-provider-boundary.mjs:45` **byte-unchanged** (`git diff --stat` proves it).

**Positive controls — applied, run, reverted, transcribed into the result doc:**

| # | Mutation | Guard that must fire | Required failure |
|---|---|---|---|
| 1 | provider import at the top of `packages/worker-daemon/src/supervisor/provider.ts` | `check-worker-daemon-boundary.mjs` | `forbidden runtime import` (also proves the checker walks `supervisor/`, not just `bin/`) |
| 2 | provider dep in `packages/worker-daemon/package.json` | `check-worker-daemon-boundary.mjs` | `runtime dependencies must equal ["@armyofagents/worker-protocol","pino"]` |
| 3 | non-literal dynamic import in a daemon runtime file | `check-worker-daemon-boundary.mjs` | `non-literal dynamic import is forbidden` |
| 4a | **`@armyofagents/worker-daemon` added to `packages/sandbox-fake-provider/package.json`** | **`check-sandbox-fake-provider-boundary.mjs`** | `runtime dependencies must equal ["@armyofagents/worker-protocol","zod"]` (`sandbox-fake-provider-boundary.mjs:130-135`) |
| 4b | **`import type { SandboxProvider } from "@armyofagents/worker-daemon"` added to `packages/sandbox-fake-provider/src/fake-driver.ts`** | **`check-sandbox-fake-provider-boundary.mjs`** | `forbidden runtime import "@armyofagents/worker-daemon"` — proving `import type` is caught **lexically** and E6-F004's rejection is mechanical, not stylistic |
| 5 | `process.env.E2B_API_KEY` in `packages/sandbox-e2b-provider/src/per-op-adapter.ts` | `check-sandbox-e2b-provider-boundary.mjs` | credential-confinement violation (`sandbox-e2b-provider-boundary.mjs:126-128`) |
| 6 | **`E2B_API_KEY` in `packages/worker-keystore/src/bin/sandbox-provider.ts`** | **`check-worker-keystore-boundary.mjs`** | the new zero-file credential ban (Step 5) |

**★ Why #4 was replaced.** The first draft's control #4 was *"`worker-daemon` dep on
`sandbox-fake-provider` → fake boundary manifest rule"*, and that guard would never have fired:
`check-sandbox-fake-provider-boundary.mjs` iterates `SANDBOX_BOUNDARY_PACKAGES`
(`:38-41`) — `sandbox-fake-provider` and `sandbox-provider-contract` — and **never reads
worker-daemon's manifest at all**. A dep added there is caught by `check-worker-daemon-boundary.mjs`,
i.e. control #4 was a mislabelled duplicate of control #2, and E6-F004's "answer, mechanically" was
unearned. 4a/4b mutate **the fake**, which is the package whose boundary is the answer.

**No commit** — evidence only.

### Step 10 — the deployment default is provably inert too
**RED.** Four cases in `scripts/check-staging-manifest.test.mjs`. For **each** of
`AOA_WORKER_DISPATCH_ENABLED` and `AOA_WORKER_SANDBOX_PROVIDER`:

1. rejected when present in a worker service's `environment`;
2. **rejected when present in that worker's `command` or `entrypoint`.**

**★ Why (2) is not optional.** The invariant this one sits beside — `checkProviderControlBoundary`
(`staging-manifest-invariants.mjs:436-493`) — spans `environment` (`:454-456`), `env_file`
(`:459-461`), `secrets`/`configs`/`volumes` (`:465-474`) **and** `command`/`entrypoint` (`:476-481`),
because a value delivered inline is a value delivered. A new invariant registered next to it that
covers only `environment` is weaker than its neighbour for no stated reason, and
`command: ["node", "worker.js"]` with `AOA_WORKER_DISPATCH_ENABLED=1` prefixed would pass it green.
Reuse the neighbour's `command`/`entrypoint` join idiom verbatim (`:477`) so the two stay in step.

Run → **FAIL**.

**GREEN.** Add `DISPATCH_SWITCH_ENVS = ["AOA_WORKER_DISPATCH_ENABLED", "AOA_WORKER_SANDBOX_PROVIDER"]`
+ `checkDispatchDefaultOff(services, v)` to `staging-manifest-invariants.mjs`, registered in
`evaluateStagingManifestInvariants` (`:600-612`) beside `checkProviderControlBoundary`. Run →
**PASS**; real manifest → **PASS**.

**Mutation.** (a) `WORKER_SERVICES` → `[]` inside the new function → all four new cases must fail
(anti-vacuity: it really iterates workers). (b) Drop the `command`/`entrypoint` arm → the two inline
cases must fail. (c) Confirm the pre-existing `E2B_API_KEY`-on-a-worker case still fires — DEP-006
unweakened.

**Commit:** `DEP-010: make "dispatch stays off" a static deployment invariant`

### Step 11 — the headers stop contradicting each other; docs; full gate

**Docs.**
- `packages/worker-daemon/src/supervisor/provider.ts` header names the authority + the adapter.
- **`packages/sandbox-provider-contract/src/port.ts:14-26` rewritten** from "OPEN item … E6-F008" to
  the settled demotion. This is the one edit that stops the tree contradicting itself — that
  paragraph is currently the repo's only assertion the question is open.
- **`docs/deploy/environment-variables.md`** gains `AOA_WORKER_SANDBOX_PROVIDER` and
  `AOA_WORKER_E2B_TEMPLATE`, in the style of the `AOA_WORKER_DISPATCH_ENABLED` row (`:192`) — default,
  accepted values, and the fact that setting the provider switch without a template is a **refusal to
  boot**, not a degrade. **No guard will catch the omission:** brand-check guard 9 greps for literal
  `process.env\.AOA_[A-Z_]+` in `*.ts` (`pr.yml:648-663`), and these are read through the `PROVIDER_ENV`
  / `TEMPLATE_ENV` string constants against an injected `env` — the same reason
  `AOA_WORKER_DISPATCH_ENABLED` (read via `config.ts:69`'s `ENV` map) is documented by discipline.
  `checkEnvDocumented` (`staging-manifest-invariants.mjs:496-504`) will not help either: it only
  documents keys that **appear in the staging compose**, and Step 10 forbids these from appearing there.
- **`docs/replatform/current-main-crosswalk.md` CM-010 — LAST column ONLY.**

  **★ Do NOT add `DEP-010` to CM-010's owner cell.** The owner cell today is
  `CLI-001, CLI-004, MIG-008, DEP-006, DEP-008` (`:26`) and it is **dominated by MIG-008**, which
  depends on all four others (`program-design.md:1049`). `DEP-010`'s own `Depends on:` is
  `DEP-000, WRK-004, CLI-001` (`:820`) and **nothing depends on DEP-010**, so adding it leaves the row
  with no dominator → `undeclaredUndominated` → `check-dependency-graph.mjs` **exit 1**
  (`lib/dependency-graph.mjs:135-147`; `check-dependency-graph.mjs:59-64`). The last column is prose
  and is never parsed as an owner list: the owner cell is found by an *"exclusively a ticket list"*
  regex (`lib/dependency-graph.mjs:81-84`), which a prose cell mentioning ticket ids cannot match —
  which is exactly how the existing DEP-006 and CLI-001 dispositions already live there. Write the
  DEP-010 disposition the same way.

**Then the full gate** — every command, and the reason each is on the list:

| Command | Why |
|---|---|
| `pnpm -r build` | the new dep must resolve topologically |
| `pnpm -r typecheck` | catches the missing `sandbox-e2b-provider` dist locally *before* CI does |
| `pnpm test:run` (or the five packages individually) | worker-keystore's project needs the built dist |
| all five boundary checkers + self-tests | Step 9's byte-unchanged claim |
| `node scripts/check-staging-manifest.mjs` + self-test | Step 10 |
| `node scripts/check-finding-ownership.mjs` | Step 1 |
| **`node scripts/check-gate-clause-wiring.mjs`** | **★ Step 6's declaration. Must be GREEN, not tolerated red.** Confirm the run prints `E7-1-coding-journey` on its `DORMANT, on the record:` line |
| **`node scripts/check-test-inventory.mjs`** | **★ the three pin bumps (worker-daemon 132, worker-keystore 20)** |
| **`node scripts/check-dependency-graph.mjs`** | **★ the crosswalk edit — must still report `4 undominated rows all declared`** |
| **`node scripts/check-execution-census.mjs`** | green unchanged: this ticket adds **no** new `.mjs` test file, only cases. If that ever changes, `scripts/test-execution-census.json` needs a new entry |
| `node scripts/check-guard-inventory.mjs` | green unchanged: no new `scripts/check-*.mjs` |
| `node scripts/check-ticket-graph-coverage.mjs` | pre-existing gate |

**Commit:** `DEP-010: one authoritative provider port, documented where it was contradicted`

---

## 7. Guard mutation matrix

| Guard | Touched? | Mutation | Expected |
|---|---|---|---|
| `check-finding-ownership.mjs` | data | re-add a deleted entry | `stale_declaration` |
| " | " | flip E6-F004 back to `open` | `undeclared_finding` |
| **`check-gate-clause-wiring.mjs`** | **data** | **land `sandbox-provider.ts` without re-declaring E7-1** | **`unwired_but_now_has_caller` — the D1 blocker** |
| " | " | lower `expectedReferences` by one | `unwired_but_now_has_caller` (the number is load-bearing) |
| **`check-test-inventory.mjs`** | **data** | **omit any of the three pin bumps** | **`pinned_mismatch` … `— bump the pin`** |
| **`check-dependency-graph.mjs`** | **data** | **add `DEP-010` to CM-010's OWNER cell** | **`no ticket transitively completes […]` → exit 1** |
| `check-worker-keystore-boundary.mjs` | **yes** | provider import from a non-`PROVIDER_HOST_PATH` file (incl. `bin/nested/`) | one-path violation |
| " | " | drop the specifier from `ALLOWED_BARE` | allow-at-path fails |
| " | " | manifest declares only the old two | `runtime dependencies must equal` |
| " | " | **`E2B_API_KEY` in a runtime file (code)** | **zero-file credential ban** |
| " | " | **`E2B_API_KEY` in a runtime file (comment only)** | **same — the scan is over raw source** |
| `check-worker-daemon-boundary.mjs` | **no** | provider import in `supervisor/provider.ts` | `forbidden runtime import` |
| " | " | provider dep in the daemon manifest | manifest rule |
| " | " | non-literal dynamic import | `non-literal dynamic import` |
| **`check-sandbox-fake-provider-boundary.mjs`** | **no** | **worker-daemon dep in the FAKE's manifest** | manifest rule *(replaces the old "daemon deps on the fake" control, which this guard never reads)* |
| " | " | **`import type` from worker-daemon in `fake-driver.ts`** | `forbidden runtime import` — lexical catch |
| `check-sandbox-e2b-provider-boundary.mjs` | **no** | `E2B_API_KEY` outside `real-transport.ts` | credential confinement |
| `check-staging-manifest.mjs` | **yes** | dispatch switch on a worker's `environment` | new `DISPATCH` violation |
| " | " | **dispatch switch in a worker's `command`/`entrypoint`** | **same — parity with `checkProviderControlBoundary`** |
| " | " | `WORKER_SERVICES` → `[]` inside the new function | all four new cases fail (anti-vacuity) |
| " | **no** | `E2B_API_KEY` on a worker | pre-existing violation still fires |
| `.github/workflows/pr.yml` | **yes** | remove the `sandbox-e2b-provider build` line from the **`verify`** list | `verify` red on a clean CI checkout (typecheck cannot resolve `./dist/index.d.ts`) — **the required lane** |
| " | " | remove it from the `distributed-contract` list | *no failure today* — that job resolves nothing by that name; the line is symmetry, not necessity, and this row records that honestly |
| `desktop-host.ts` resolve position | **yes** | move above the control branch | control/reset tests fail |
| `compose-dispatch.ts:62` | **no** | `if (!input.provider)` → `if (false)` | shipped-default lock fails |
| **`bin/worker-daemon.ts:349`** | **no** | **add an `else` that composes anything observable** | **the structural inertness lock fails — the primary §4 proof** |
| `bin/worker-daemon.ts:344` | **no** | `hasSelfModelReader` → `true` | supporting check fails (retires with slice 2b) |
| **`bin/worker-daemon.ts:345`** | **no** | **`selfModel: null` → a valid self-model** | **the fourth gate, which had no falsifying test before revision 1** |

A guard whose failure nobody has seen is a guard nobody has tested — every positive control is
applied, run, reverted, and its failure text transcribed into the result doc.

---

## 8. Residual risk

1. **The `e2b` SDK now lives in the key-holding process.** Mitigated by one-file confinement, the
   lazy dynamic import (not loaded on the default path), and the credential's name being **banned
   outright** from `worker-keystore` runtime source. **Not eliminated** — this is the cost Step 0
   buys.
2. **★ The desktop artifact grows by an amount that is MEASURED but not VERIFIED, and nothing checks
   it.** The first draft said "the manifest regenerates, so nothing drifts silently." That was wrong:
   `scripts/build-desktop-staging.mjs` **refuses to run** (`:21-30` — producing its link-free input is
   an unsolved packaging step) and CI executes only its unit test (`pr.yml:365`) — the same conclusion
   go-book decision **D-3** reached independently (`GO-BOOK.md:404`). So:
   - **What is known:** the `e2b` closure is **36 packages, ~1,752 files, ~15.2 MiB unpruned** on this
     workspace (lockfile closure of `e2b@2.30.5`, measured at revision time). Post-prune it will be
     smaller by an uncomputable amount.
   - **What is NOT known:** the shipped size, the shipped file set, or whether the artifact's
     embedded-secret scan survives the new bytes.
   - **The handoff, explicit:** DSK-003 packaging owns this. Tell them the *scan*, not the *size*, is
     the risk — `isShippableStagingPath` already prunes third-party READMEs and benchmarks because
     pino's README and `@pinojs/redact`'s benchmarks tripped the scan with
     `password: "hunter2"`-style examples (`staging-manifest.mjs:41-51`). The e2b closure is 36
     packages of third-party bytes entering that scan for the first time. **The correct response to a
     hit is another prune rule; never a weaker scan.**
3. **`perOpToInvokeDriver` lives in the E2B package — and relocating it is not a file move.**
   The first draft called this "relocate when a second provider exists". That understates it. The
   adapter's fault vocabulary lives in `packages/sandbox-e2b-provider/src/directives.ts`, whose header
   states it
   is *"the ONE place the reserved key names live, shared by the adapter (encode) and the mock
   transport (decode) so they can never silently drift"* (`:16-17`). The **encoder** is
   `per-op-adapter.ts:61`, `:176-197`; the **decoder** is `mock-transport.ts:17`
   (`decodeCreateFaults`/`decodeExecuteFaults`). Moving the adapter out therefore means one of:
   (a) move `directives.ts` too and give the E2B mock transport a dependency on the new home;
   (b) duplicate the key names, reintroducing exactly the drift the header forbids; or
   (c) move the mock transport as well, which drags CLI-002/CLI-003's fs-write and stream directives
   with it. None is a file move. Cost this properly when a second provider actually exists.
4. **E6-F003 remains open and HIGH, by design.** Precondition written down so nobody re-derives it —
   including **which network** (`control-net`), and the warning that `docker-compose.d1.yml` uses
   `provider-ctl-net` to mean the opposite.
5. **Split env source.** The root reads `deps.env`; the transport reads `process.env`. Identical in
   production, and deliberate — it is what keeps the credential out of this package. It is also what
   makes Step 6's default-loader test environment-sensitive, which is why that test passes an explicit
   env with the key removed rather than trusting the ambient one.
6. **`AOA_WORKER_SANDBOX_PROVIDER` is a new operator-facing switch**, and **no guard enforces that it
   is documented** (§0.1). Step 11 adds both rows to `docs/deploy/environment-variables.md` by hand;
   a reviewer must check that it happened, because CI will not.
7. **★ The DEP-000 harness still never drives the daemon's supervisor.** DEP-010 resolves E6-F008 in
   the `per-op → driver` direction only (§2.2a). There is no `driver → per-op` adapter, so
   `packages/sandbox-fake-provider` cannot stand in as the daemon's provider — and the repository
   therefore maintains **two independent provider doubles**: that one for the conformance suites, and
   `packages/worker-daemon/src/__tests__/support/fake-provider.ts` for the supervisor. A behavioural
   divergence between them is invisible to every gate. Fixing it is not this ticket's job (building a
   `driver → per-op` adapter would put a fabricating provider one import away from a production path,
   §3.4), but pretending the doubles are one thing is how "the harness proves the daemon" would become
   a claim nobody checked.

---

## 9. Acceptance mapping

| Plan acceptance | Proven by |
|---|---|
| Exactly one port is authoritative and documented as such | §1 D1/D2; Step 1; Step 11 (the two headers stop contradicting) |
| The composition root injects a real `E2bSandboxProvider` via the `provider` seam | Steps 3, 6, 7; Step 8 asserts `toBeInstanceOf` on what the root handed to bootstrap |
| The boundary checker still forbids the daemon importing a provider | Step 9 controls 1–3 — byte-unchanged guard (`worker-daemon-boundary.mjs:53`), green checker, three positive controls |
| The fake stays a leaf with no daemon surface (E6-F004's answer, mechanically) | Step 9 controls **4a + 4b**, both against `check-sandbox-fake-provider-boundary.mjs` — the guard that actually reads the fake |
| A worker with no injected provider still refuses; the shipped default is provably inert | Step 4 (lock + 2 mutations), Step 8's structural lock (real boot, provider **and** flag, no loop composed), Step 10 (static deployment invariant across `environment` + `command`/`entrypoint`) |
| Does NOT by itself turn dispatch on | §4.1's structural lock — **nothing consumes `compose === true`** (`bin/worker-daemon.ts:347-349`, no `else`); Step 8 mutation (a); Step 10. *(Not the `:344` literal, which Sprint 3 deletes.)* |
| Test: `compose:true` only with a real provider and the flag on | Step 8, driven by the **root-produced** provider; gates 3 and 4 falsified by mutations (b) and (c) |
| Test: boundary run proving the daemon still cannot import | Step 9 |
| Test: port reconciliation documented against E6-F008 | Steps 1 + 11, **and** §2.2b — the resolution text must either add the `PROVIDER_OPERATIONS` totality case or state in writing that D1/D2 supersede option (b) |
| Resolves E6-F008 / E6-F004 / E6-F003 | §2 — resolved (one direction, §2.2), resolved (opposite answer, mechanically proven), explicitly deferred with its precondition and the correct network |
| **CI is green on the commit that lands each step** | §6's standing rule + Step 11's gate table: `check-gate-clause-wiring.mjs`, `check-test-inventory.mjs`, `check-dependency-graph.mjs` all named, all in the **always-on** `policy` job (`pr.yml:124-126`) |
