# E6 Deployment / test harness — findings

Scoped discoveries and plan-review deltas for the E6-D1-FOUNDATION partial. Source:
Batch A adversarial plan-review (2026-08-12).

## E6-F001 — DEP-001 package path corrected — RESOLVED

**Status:** `resolved` (plan text fixed). The worker package is
`packages/worker-daemon` (`@armyofagents/worker-daemon`), not `packages/worker`.
All DEP-001 image `COPY` targets and the deps-parity validator reference it.

## E6-F002 — DEP-001 worker-image dependency closure corrected — RESOLVED

**Status:** `resolved` (plan text fixed). Per **E4-D01** the worker image closure
is exactly `worker-daemon` + `worker-protocol` + the `pino` runtime dep (zod
transitive); no `adapter-utils`; no server/db/shared/drizzle.

## E6-F003 — the networked worker→provider driver API is unspecified

**Status:** `open` · Severity: HIGH (cross-plan seam; mirrors E4-F002).

★ NARROWED and DEFERRED by DEP-010 (Sprint 2); DEP-010 does not build the wire and
does not pretend to. See `DEP-010-design.md` §2.1.

**What DEP-010 answered.** *Which port* a networked worker→provider driver speaks: the
per-op `SandboxProvider` (`packages/worker-daemon/src/supervisor/provider.ts`),
transport-agnostic by construction, named THE authoritative port by decision D1. The
networked driver is a **binding of that port**, not a third port — which removes the
entanglement with E6-F008/E6-F004 that once made all three look like one question. Those
two are resolved; this one is not.

**What is still open.** The wire itself — the request/response shapes a containerized
worker's provider driver speaks to `adapter-manager`. No transport, no schema, no client.
DEP-010 wires the **desktop/self-hosted lane only**.

**★ Which network, stated correctly — the register carries this sentence, so a wrong name
would be a durable false statement no guard can contradict.** In
`docker-compose.staging.yml` the worker↔adapter-manager conversation is on **`control-net`**:
workers are `[control-net, store-egress-net]`, `adapter-manager` is
`[control-net, provider-ctl-net]` (`scripts/lib/staging-manifest-invariants.mjs`,
`checkWorkerServiceNetworks`). **`provider-ctl-net` is adapter-manager-only** — the
adapter-manager→E2B leg — and a worker attached to it is a hard `PROVIDER-CONTROL
VIOLATION`. ★ The name is OVERLOADED across two compose files: in
`docker-compose.d1.yml` both D1 workers ARE on `provider-ctl-net` (its topology matrix says
so), because D1's fake provider is a container the workers reach directly. Both files are
correct for their own topology; the name is not portable between them.

**Precondition (when this becomes REQUIRED).** The moment a containerized worker under
`docker-compose.staging.yml` must dispatch: §2.5 forbids `E2B_API_KEY` on any worker
surface, so that worker's provider cannot be key-backed and MUST be networked, reaching
`adapter-manager` over `control-net`. There is no consumer today — `adapter-manager` has
**zero implementation** (`DECISION-byte-egress-and-provider-topology.md` §4 residual 4.2)
and no worker dispatches (flag default-off, no `compose:true` branch) — so specifying a wire
against an unimplemented peer for an unbuilt caller is the failure this programme keeps
re-learning. Deferring is correct, not convenient.

**Resolution owner:** filed to a successor at DEP-010 completion (`DEP-011`, the containerized
worker→provider wire) rather than left `owned` by the shipped DEP-010 — an open finding owned
by shipped work reads as owned by nobody (finding **E4-F013**). DEP-010 repoints the manifest
`ticket`, not merely the prose (`DEP-010-design.md` §2.1).

## E6-F004 — DEP-000 provider-driver port import source — RESOLVED

**Status:** `resolved` (DEP-010, Sprint 2) · Severity: MED-HIGH (mirrors E4-F003).

★ RESOLVED with the OPPOSITE answer to the one this finding proposed. The finding said the
fake should import the port from `@armyofagents/worker-daemon` and the boundary should be
widened to ALLOW it. **Rejected.** DEP-010's decision D2 demotes the contract's
`SandboxProviderDriver` to a conformance-harness surface, and the DEP-000 fake
(`packages/sandbox-fake-provider`) already implements THAT harness port **structurally**
(`fake-driver.ts`) — so it needs no import from worker-daemon at all.
`scripts/lib/sandbox-fake-provider-boundary.mjs` therefore stays **exactly**
`["@armyofagents/worker-protocol","zod"]`: widening it would put the daemon's whole provider
surface inside a leaf whose entire point is that it has none. Proved mechanically by
`DEP-010-design.md` Step 9 positive controls 4a (a `worker-daemon` dep in the fake's manifest
fails `check-sandbox-fake-provider-boundary.mjs`) and 4b (an `import type` from worker-daemon
in `fake-driver.ts` is caught lexically) — against the fake's OWN guard, which is the guard
that actually reads the fake.

## E6-F005 — Gate control-plane path transitive deps (nit)

**Status:** `open` · note at **E6-D1-FOUNDATION gate** · Severity: LOW.

Gate closure requires TEN-002/JOB-003/WRK-004 (program-design L700). E6F-01/E6F-04
exercise submit→placement→enroll→lease→ACK, which transitively needs
JOB-001/JOB-002/JOB-009 `complete`. Add one line noting `JOB-003 complete`
transitively implies those via their dep chain so the campaign path is fully backed.

## E6-F006 — DEP-000 missing explicit REDs (nit)

**Status:** `open` · resolve at **DEP-000** · Severity: LOW. Acceptance names
"unschema-valid fixture rejected" and "unknown op rejected" but no dedicated RED
files exist. Add explicit REDs or fold-and-note.

## E6-F007 — DEP-003 RLS migration mechanism citation (nit)

**Status:** `open` · resolve at **DEP-003** · Severity: LOW. Cite the drizzle
`--custom` mechanism (E2-D01 precedent, product Decision #122/C14) for the RLS
marker migration; confirm both slugs (`distributed_cutover_marker` + `_rls`)
generate after `0231`.

## E6-F008 — DEP-000 contract port is provider-neutral, NOT WRK-004's authoritative `SandboxProvider` — RESOLVED

**Status:** `resolved` (DEP-010, Sprint 2) · Severity: MED (contravened a plan STOP; harness self-consistent). Source: DEP-000 adversarial review (CONFIRMED should-fix).

★ RESOLVED, one direction only. DEP-010's decision **D1** names ONE authoritative port —
worker-daemon's per-op `SandboxProvider` (`packages/worker-daemon/src/supervisor/provider.ts`),
the port the security core speaks and the only one the sole real implementation
(`E2bSandboxProvider`) implements. Decision **D2** states the contract's
`SandboxProviderDriver` is NOT retired and NOT authoritative: it is kept as the surface the two
conformance suites drive (`runSandboxProviderContract`, `runSandboxIsolationConformance`),
reached through the shipped adapter `perOpToInvokeDriver` (`per-op-adapter.ts`, header "CLOSES
finding E6-F008") that shipped in CLI-001. Direction is single and stated: **authoritative
per-op port → adapter → harness driver port**, never the reverse.

**★ Option (b)'s totality bar is SUPERSEDED in writing, not earned by a new test.** This
finding's resolution offered (a) relocate the port to a shared leaf, or (b) a tested
`SandboxProvider → SandboxProviderDriver` adapter *with a totality assertion over all 11 ops +
result shapes*. That bar was written when the adapter was **the** reconciliation. D1 changes
the frame: it demotes the driver port to a harness surface, so per-op coverage of that surface
is the two conformance suites' problem, not the port-authority question's — and the existing
`per-op-adapter.test.ts` already covers the vocabulary case-by-case (routing of the eight
core ops, `reconcile_cleanup`, and the optional trio through the advertisement gate). Naming
one authority is the reconciliation E6-F008 asked for; a `for (const op of PROVIDER_OPERATIONS)`
loop is not part of that decision. (`DEP-010-design.md` §2.2b.)

**★ What this resolution does NOT buy — recorded before the manifest entry is deleted.** The
bridge runs `per-op → driver` only; there is no `driver → per-op` adapter, so the DEP-000 fake
CANNOT stand in as the daemon's provider. The repository therefore keeps **two independent
provider doubles** — `packages/sandbox-fake-provider` for the conformance suites and
`packages/worker-daemon/src/__tests__/support/fake-provider.ts` for the supervisor — and the
DEP-000 harness never drives the daemon's supervisor. Building a `driver → per-op` adapter would
put a fabricating provider one import from a production path (the WRK-009 defect shape), so it is
deliberately NOT done here. Residual, `DEP-010-design.md` §8.9.

The original "reconcile before CLI-001/D2" schedule is moot: CLI-001 shipped, and this is the
composition-root decision the reconciliation was waiting on.

DEP-000's `@armyofagents/sandbox-provider-contract` defines a provider-neutral
`SandboxProviderDriver` (single `invoke(op, args)` over the frozen worker-protocol
`PROVIDER_OPERATIONS` vocabulary). This is **structurally unrelated** to WRK-004's authoritative
`SandboxProvider` (`packages/worker-daemon/src/supervisor/provider.ts`, a per-op method surface
exported per E4-F003). The DEP-000 boundary forbids importing `@armyofagents/worker-daemon`, so
the two ports cannot be mechanically linked as built.

**Why it happened:** the E6 plan has an internal tension — §2.1 wants DEP-000 provider-neutral
with deps limited to worker-protocol+zod+Node (no worker-daemon), while §0 (lines 66-74) STOPs on
"inventing a second provider-driver interface" as requiring an E4 amendment. The orchestrator
resolved toward §2.1 (provider-neutral) when directing DEP-000; the review flagged that this
improvised past the §0 STOP.

**Impact:** NONE on `E6-D1-FOUNDATION` — real-provider conformance is explicitly out of that
gate's scope (plan lines 37-38, 83, 102-103); the harness is internally consistent (deterministic
fixture replay against the fake, which conforms to the driver). The gap is that a real E2B
provider implementing `SandboxProvider` cannot be passed to `runSandboxProviderContract` as-is, so
a green contract does not (yet) prove real-supervisor conformance.

**Resolution (do at CLI-001/D2, before a real provider is validated by this suite):** either
(a) relocate the `SandboxProvider` port + result types to a shared worker-protocol-only leaf that
BOTH `@armyofagents/worker-daemon` and the contract import (the E4-F003 "shared leaf" option), so
the contract validates the authoritative per-op port; OR (b) add a tested
`SandboxProvider → SandboxProviderDriver` adapter with a totality assertion over all 11 ops + their
result shapes. The misleading "satisfies this shape" comment in `port.ts` was corrected in the
DEP-000 fix round; this finding records the deferred reconciliation.

## E6-F009 — D1 worker↔data isolation is direct-path + no-credentials + RLS; toxiproxy is a deliberate multi-homed bridge — RESOLVED

**Status:** `resolved` (DEP-002 fix round, 2026-08-13) · Severity: MED (harness-claim honesty) · Source: DEP-002 adversarial review (2 confirmed: control-endpoint static coverage; toxiproxy porosity).

The DEP-002 review found that the "workers cannot reach PostgreSQL" claim was porous: the plan §2.3
specifies a SINGLE toxiproxy multi-homed on data-net + worker-net, whose control-plane→postgres
proxy listens `0.0.0.0:15432`, so a worker can reach `toxiproxy:15432 → postgres:5432` indirectly
even though it is off data-net. The direct-path live test passed but the indirect path was
unprobed, so the gate would falsely advertise full network isolation.

**Decision (proportionate — no plan deviation):** the D1 harness does NOT split toxiproxy (the
plan deliberately specifies one multi-homed instance). Instead the enforced worker↔data isolation
is defined precisely as the conjunction of:
1. **No DIRECT worker→postgres path** — worker services are off data-net (static invariant
   `checkWorkerNotOnDataNet`) and a direct `connect(5432,'postgres')` is refused (live test).
2. **Workers carry NO database credentials** — a new static invariant asserts worker services
   declare no `DATABASE_URL`/`*_DATABASE_URL`/`aoa_app` credential env, so even reaching
   `toxiproxy:15432` a worker cannot AUTHENTICATE to postgres. (Reject fixture: a worker with a
   `DATABASE_URL` fails the validator.)
3. **E2 FORCE-RLS** gates any data access regardless of network path.

toxiproxy's `:15432` listener being TCP-reachable from workers is documented as **by design** (a
deliberate data-tier bridge), not a hidden port; a CI-deferred live assertion documents that a
worker reaching it without `aoa_app` credentials cannot authenticate. The control-plane-must-not-
script-the-fake boundary also gained a static invariant (fake `AOA_FAKE_PROVIDER_CTL_ALLOW`
non-empty + excludes control-plane) and the fake control endpoint now fails CLOSED on an empty
allowlist. A stricter network-layer split (dedicated cp↔pg toxiproxy on a control-plane-only net +
interface-bound listener) is a possible E6 follow-up but is NOT required — the credential + RLS
boundary is the meaningful guarantee.

## E6-F010 — the D1 merge-train lane had been RED for five days and three merges; the control-plane image could not build — RESOLVED

**Status:** `resolved` (WRK-017, 2026-09-03) · Severity: **HIGH** (the D1 lane is the ONLY thing
that boots the split images, and it validated nothing for three merges) · Source: WRK-017 Step 0 —
the ticket's premise is "a CI-exercised first container-enrol", so the first question was whether
the lane runs at all.

**Measured.** `gh run list --workflow=d1-merge-train.yml` → `failure` on `c3d26657d` (2026-08-29),
`07ed2cc42` (2026-08-30) and `b6e02a478` (2026-08-31); last `success` `50380b6f7` (2026-08-25).
The failing step is *Build split D1 images*, and the failure is identical on all three:

```
packages/sandbox-fake-provider build: src/hash.ts(11,28): error TS2307: Cannot find module 'node:crypto'
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @armyofagents/sandbox-fake-provider@0.1.0 build: `tsc`
#40 ERROR: process "/bin/sh -c pnpm --filter \"@armyofagents/server...\" --filter \"@armyofagents/ui...\" build" did not complete successfully
```

Reproduced byte-for-byte on a local Docker Desktop against `203853b3a` before any WRK-017 change.

**Root cause — a guard that was green because it guards a different set.** The control-plane
`deps` stage COPYs the workspace manifests in `@armyofagents/server`'s **production** closure, and
`scripts/check-image-deps-stages.mjs` enforces that COPY set exactly — its `computeRuntimeClosure`
walks `.dependencies` alone, by design, to mirror pnpm's `--filter-prod`. The `build` stage,
however, runs `pnpm --filter "@armyofagents/server..." build`, and `pkg...` traverses
**`devDependencies` too**. The two sets were equal until DEP-011 Slice 1 (`c3d26657d`) added
`@armyofagents/adapter-manager` to `server`'s **devDependencies**, whose graph reaches
`provider-wire → sandbox-e2b-provider → sandbox-provider-contract → (devDep) sandbox-fake-provider`.
Five packages the deps stage never installed entered the build selection, and `tsc` died in a
package with no `node_modules`. `node scripts/check-image-deps-stages.mjs` **stays PASS** through
all of it, correctly: the manifest it guards is still exactly right.

**Why nobody noticed.** `d1-merge-train.yml` is not among the required checks — branch protection
requires only `ci-required` (`pr.yml`), and `d1-merge-train` runs on `push` to the integration
branch, after the merge. A red there is a red nobody is waiting on. This is the programme's own
"a check that nothing runs is not a check" class, one lane over: the check ran and went red, and
the absence of a *consumer* for that verdict made it equivalent to not running.

**Resolved** by the fix the WORKER image already uses for the identical reason (its "8th manifest"
note): re-install in the build stage, against the manifest set that stage actually has after
`COPY . .`, so the build selection and the installed set are the same set. Non-prod, because the
workspace `typescript` devDep must resolve; `pnpm deploy --prod` still prunes every dev package
back out, so nothing extra reaches production. Verified locally: both images build and
`docker/images/digests.env` is populated. NOT fixed by switching the build line to `--filter-prod`
— `provider-capability`'s only edge to `worker-daemon` is a devDependency and that edge is what
yields the correct topological order, a trap the worker Dockerfile already records.

**Residual, stated plainly.** The class is not closed. Any future workspace **devDependency** added
to `server` or `ui` widens the build selection again; the re-install absorbs that, but nothing
warns when the two sets diverge, and no PR-time check builds either image. A deps-stage guard that
also compared the dev closure — or a `ci-required` consumer for the image build — would close it.
Not attempted here: WRK-017 needed the lane green, not a new gate.

## E6-F011 — the D1 control plane would have refused every real worker request: `toxiproxy` was never in its hostname allowlist — RESOLVED

**Status:** `resolved` (WRK-017, 2026-09-03) · Severity: MED (latent; unreachable until a worker
container actually issued a request, which WRK-017 is the first thing to do) · Source: WRK-017
source trace of the enrol path before the first bring-up.

`docker-compose.d1.yml` set `AOA_ALLOWED_HOSTNAMES: "control-plane,localhost,127.0.0.1"` with the
comment *"The E6F harness + the workers reach the control plane by its in-compose service name"*.
The workers do **not**. `AOA_WORKER_CONTROL_PLANE_URL` is `http://toxiproxy:13100` — and that
routing is itself a load-bearing static invariant (`checkToxiproxyInPath`), so it is not a mistake
to be corrected on the worker side. A worker's HTTP `Host` header is therefore literally
`toxiproxy:13100`, `privateHostnameGuard` is ENABLED on this stack (`authenticated` mode plus the
control-plane image's default `AOA_DEPLOYMENT_EXPOSURE=private`), and `/api/worker-control/*` does
not bypass it — so every enrol/poll/ack from a real worker would have been answered **403**.

The comment was true of the only client that existed: the E6F harness dials
`http://control-plane:3100` from `test-runner`, which was in the allowlist all along. The claim
about *workers* had never been executed by anything.

**Resolved** by adding `toxiproxy` to `AOA_ALLOWED_HOSTNAMES` on BOTH control-plane replicas, with
the reasoning recorded at the line. No product code changed: the guard behaved exactly as designed;
the harness's allowlist was simply wrong about who its clients are.

## E6-F012 — the deps-stage parity guard compares the PRODUCTION closure while the build stage traverses dev edges too

**Status:** `open` · Severity: MED · Source: WRK-017 (2026-09-03), promoted out of E6-F010's residual
so it is countable by `check-finding-ownership.mjs` — a residual recorded inside a `resolved` finding
is invisible to the guard, which is its own small instance of this programme's failure class.

`scripts/check-image-deps-stages.mjs` enforces that each split image's `deps` stage COPYs EXACTLY the
workspace manifests in that image's **runtime** closure. Its `computeRuntimeClosure`
(`scripts/lib/image-deps-stage.mjs`) walks `.dependencies` **only** — deliberately, and the module's
own header says so, because that is what makes it byte-equal to pnpm's `--filter-prod "X..."`.

The BUILD stage does not run `--filter-prod`. It runs `pnpm --filter "@armyofagents/server..."
--filter "@armyofagents/ui..." build`, and `pkg...` traverses **`devDependencies` too**. The two sets
were equal until DEP-011 Slice 1 (`c3d26657d`) added a workspace DEVdependency
(`@armyofagents/adapter-manager`) to `server`, whose graph reaches
`provider-wire → sandbox-e2b-provider → sandbox-provider-contract → (devDep) sandbox-fake-provider`.
Five packages the deps stage never installed entered the build selection and `tsc` died on
`Cannot find module 'node:crypto'` in a package with no `node_modules` — **and the parity guard stayed
PASS throughout, correctly**, because the manifest it guards was still exactly right.

**What WRK-017 did and did not close.** It fixed the break, using the mechanism the worker Dockerfile
already used for the identical reason: re-install in the build stage against the manifest set that
stage actually has after `COPY . .`. That **absorbs** the divergence. It does **not detect** it. The
next workspace devDependency added to `server` or `ui` widens the build selection again, silently,
with no guard saying so and no PR-time job that builds either image.

**Blocks:** nothing today — the re-install makes the current tree build. It is filed `unowned` because
no ticket is building the detector, and because the honest remediation is a design choice, not a line:
either teach the deps-stage guard to compare the DEV closure as a second, separately-reported set, or
give the image build a PR-time consumer. Note the relationship to **DEP-013** without conflating them:
DEP-013 makes the next occurrence LOUD within a bounded time; this finding's successor would make it
IMPOSSIBLE. Neither substitutes for the other, which is why WRK-017's designer declined to fold this
into DEP-013.

## E6-F013 — the verdict consumer has never been OBSERVED publishing: DEP-013's live control is owed, and the reader is in its one tolerated state until it is

**Status:** `open` · Severity: MED · Source: DEP-013 build (2026-09-04), filed by the builder
against its own work rather than discovered later.

DEP-013 ships the consumer, the reconciler workflow and the terminating reader in `policy`.
Three of the design's controls were executed and are recorded in `DEP-013-result.md`: PC-1 (a
12-mutant sweep over the pure evaluator, 12/12 killed and the source restored byte-identical),
PC-2 (the replay against the **recorded** 08-25 → 09-03 `d1-merge-train` history, which reports
from `c3d26657d` and stops at `ee74f9c8c`), and a LIVE evaluation of all eleven watched streams
against the real GitHub API, which correctly reports `cross-platform-weekly.yml@main` as
`not_success (cancelled)` — §6's free positive control, fired with nothing broken to arrange it.

**What is NOT proven, and it is the half that involves a write.** The reconciler has never
published. Two independent reasons, and neither is a shortcut:

1. **The builder may not publish.** `MeteoriteLabs/AoA` is a PUBLIC repository, and opening the
   tracking issue is publishing public content — outside an automated builder's authority. It
   was therefore run as `--dry-run`, which performs the entire evaluation and prints the exact
   issue body it would post. Everything except the `POST` is measured; the `POST` is not.
2. **The workflow cannot fire from this branch anyway.** GitHub registers `schedule` and
   `workflow_dispatch` only from the DEFAULT branch. That is not an assumption: this repository
   already states it at the line in `d1-merge-train.yml` ("workflow_dispatch is omitted
   deliberately: it requires the workflow on the default branch (main)") and in
   `keyed-e2b-conformance.yml`, and every scheduled run of `cross-platform-weekly`,
   `catalog-audit` and `thread-v2-e2e` in the API is on `main`. The `push` trigger added for
   exactly this reason makes the reconciler's FIRST real run the push that merges it.

**What that means for the gate today — stated plainly, because a false claim of enforcement is
worse than a missing check.** `policy` runs the reader on every PR and the reader FAILS the job
(proven by six spawned vectors asserting real exit codes). But with no published issue and no
completed reconciler run, its verdict today is `not_bootstrapped`, which PASSES. **So the
blocking half of DEP-013 is wired and exercised but has not yet blocked anything.** The
tolerance is deliberately the narrowest possible and it is not a dial: it is removed by the
FIRST completed reconciler run, automatically, with no manifest edit and nobody to remember —
after that, a missing issue is `ran_but_never_published` and reds `policy`. It cannot mask any
other failure: with the issue present, a wiped marker, an unparseable marker and a stale marker
all fail regardless.

**Blocks:** nothing merging. It leaves one claim unmade — *the consumer has published and the
reader has been seen going red on real silence*.

**What would have to change, precisely.** After this lands on `docs/replatform-program`: (a) the
merge push runs `verdict-reconcile.yml`, which opens the tracking issue — confirm the run is
`success` and that the issue carries a `verdict-consumer:v1` marker; (b) confirm the next PR's
`policy` prints `OK (fresh)` rather than `OK (not_bootstrapped)`, which is the observation that
the tolerance is gone; (c) for PC-3(2), re-run the reader against a marker older than
`consumer.toleratedSilenceHours` — the `--self-test-case=stale` vector already does this locally
and exits 1, so the live version adds only the CI surface; (d) when `verdict-reconcile.yml`
reaches `main` and its 6h cron is observed firing, drop `consumer.toleratedSilenceHours` from
72 to 26, which the manifest's own `toleratedSilenceReason` already names as its successor
condition.

**Filed rather than fudged.** The alternative was to wire the reader as a no-op until someone
flips a manifest flag. That is the shape this programme has already had to delete once — a gate
nobody can pass, or a dial nobody remembers — and it would have made the enforcement claim false
in a way no guard could see.

## E6-F014 — `Setup pnpm` in the `policy` job grew ~40× (4s → 195s) and nobody noticed until it cancelled a required check

**Status:** `open` — NARROWED 2026-09-04 by TRACK A (see the second addendum below). The LEAK is
closed: the raise had covered 1 of the 9 `pr.yml` jobs carrying this step, and all 9 are now handled —
1 by deleting the step outright, 8 by splitting the job cap into a work budget plus a named
infrastructure allowance, behind a guard that refuses an undeclared cap. **The cause is still
undiagnosed and PR #321 is still untested**, which is what keeps this open.
**Severity:** MED · Source: DEP-013 build (2026-09-04). Found because DEP-013's
own PR was the run that finally crossed the cap.

`policy` is the only job branch protection's `ci-required` aggregator needs on **every** PR. On
run `33858466826` it was **cancelled at exactly 5:04** against its `timeout-minutes: 5`, with no
guard having failed and most having never started. The whole budget went to one step:

| step | duration |
|---|---|
| Checkout | 6s |
| **Setup pnpm** | **4m 47s** |
| everything else (5 guard steps reached before the cancel) | 6s |

**The step used to cost nothing.** Measured across the last six `policy` runs on
`docs/replatform-program` (`gh api …/actions/jobs/<id>`), newest last:

| run | `Setup pnpm` | job total |
|---|---|---|
| 33769476886 | 4s | 74s |
| 33799136579 | 4s | 74s |
| 33799234615 | 5s | 84s |
| 33840970676 | **135s** | 206s |
| 33842573550 | **195s** | 265s |
| 33847376840 | **149s** | 208s |

**So the job total moved from 74s to 265s against a 300s cap.** Every PR in this repository was
one slow registry response away from a cancelled required check, on all four live tracks, for a
reason having nothing to do with any of their commits.

**This is the third instance in three days of one class:** *a required check whose verdict is a
function of something the commit does not contain.* The other two are E3-F034 (a runner's fsync
against a 750 ms `lock_timeout`) and E3-F036 (npm-registry latency against a 30s `testTimeout`,
where the install is allowed 120,000 ms and the test awaiting it gets 30,000 — an inverted
budget). The standing response to all three — re-run until green — is **indistinguishable from
ignoring a real regression**, which is the same sentence DEP-013 was chartered to write about
verdicts.

**Absorbed, not detected.** DEP-013 raised the cap to 12 minutes on this measurement, with the
reasoning at the line. That stops the cancellations; it does **not** detect the next 40×. A cap
raised without a filed cause is exactly how this one went unnoticed for three runs, and the
distinction matters — a 60-minute `verify` cap once masked a real hang here for weeks, so raising
a cap is a legitimate move only when the cause is measured and is not a hang. It is measured, and
it is not a hang.

★ **It is still growing, and the raise was not generous — it was necessary.** The very next run
after the cap went to 12 minutes (`33859560367`, sha `da8abcc2f`) recorded `Setup pnpm` at
**424s** — worse than the 287s that caused the cancellation, ~100× the 4s baseline — for a job
total of **499s**. An 8-minute cap would also have failed. DEP-013's own two steps in that job
cost **1s each**, so nothing in this ticket is the load.

**Blocks:** nothing, now that the cap is raised.

**What would have to change.** Two candidate remediations, and choosing between them is a real
decision rather than a line: (a) find and fix the growth — the step is
`pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271` with `run_install: false`, so 195s is
almost entirely the action's own download/cache work rather than dependency installation, and a
pinned-binary or cached-store approach would remove it; or (b) if the cost is irreducible, give
job durations a consumer — the same argument as DEP-013 one register over, since a step time is a
verdict nobody reads until it crosses a cap. Filed `unowned` because no ticket is doing either.

★ **One free lead for whoever takes it:** PR **#321** (`bump pnpm/action-setup from 6.0.9 to
6.0.10`) is open and untouched. It is a CANDIDATE, not a diagnosis — the correlation has not been
measured, and the growth could equally be CDN-side. But it is the cheapest thing to test first,
and it is already sitting in the queue: check whether 6.0.10 restores the 4s step before
attempting anything larger.

---

### ★ Addendum (2026-09-04, independent track) — the misdiagnosis this causes, and one correction

Filed from a separate investigation that was handed the *symptom* — "the `policy` step
`Worker route-path parity (WRK-008)` hangs for ~5 minutes" — and measured its way to the same step
E6-F014 already names. **It reproduces this finding rather than adding a defect**, so it is recorded
here instead of taking a second id: an id must name one thing, and so must a defect. What follows is
only what was *not* already above. It was filed as a separate finding first and withdrawn on contact
with this one; `check-register-id-uniqueness.mjs` refused the duplicate id, which is the guard doing
exactly its job.

**Independent confirmation of the baseline.** `Setup pnpm` measured **3 s** on run `33871439141`
(job total 1m 10s) — consistent with the 4 s / 4 s / 5 s above, from a different track on a
different day's tip.

#### ★★★ 1. The cancellation is reported against an ARBITRARY INNOCENT STEP — which is how it gets misdiagnosed

E6-F014 says "no guard having failed and most having never started". The sharper and more damaging
fact is that GitHub does not report the job as timing out: **it marks whichever step happened to be
executing at the wall as `cancelled`**, and that step is a coincidence of scheduling. Across the
**eight** cancelled `policy` attempts measured on four shas, the accused step was **four different
steps**:

| accused step | times accused | its own cost on a normal run |
|---|---|---|
| `#4 Setup pnpm` | 5 | 3 s |
| `#10 Sandbox e2b provider dependency boundary` | 1 (run `33858466826`, the one cited above) | <1 s |
| `#16 Frozen worker-protocol v1 consumer (E1)` | 1 | 37 s |
| `#18 Worker route-path parity (WRK-008)` | 1 | **0 s** |

**This is not theoretical — it already produced a wrong bug report.** `#18` was escalated as a
five-minute hang. On a green run it costs **zero seconds** (`07:05:51 -> 07:05:51`), and on the
attempt where it was accused it was cancelled at zero seconds too (`06:39:53 -> 06:39:53`): the wall
arrived one second after it started. `scripts/check-worker-path-parity.mjs` performs **ten**
`readFileSync` calls over four files (counted by instrumenting a copy) and **spawns nothing, reads
no stdin, globs nothing and touches no network**. It cannot stall. Anyone taking the report at face
value searches `scripts/check-*.mjs` — the one place the defect is not.

So this failure does not merely *misattribute* the way E3-F034 and E3-F036 do (a real red on the
thing that was genuinely slow); it **misdirects**, pointing at a file that is not involved. That is
worth knowing before the next one is triaged, and it is the reason the symptom reached a second
track as "a hang" at all. **Nothing hangs**: every step runs to its ordinary cost and the job's
fixed wall arrives first.

#### ★★ 2. It is per-runner, not a uniform slowdown — measured inside a single run

The series above is across runs, which is equally consistent with a global CDN degradation. It is
not global. Within **one run** (`33842573550` attempt 1), the identical pinned action ran in five
jobs starting inside a 20-second window:

| job | `Setup pnpm` | its own report |
|---|---|---|
| `distributed-contract` | **11 s** | `added 1 package, and audited 2 packages in 11s` |
| `browser` | 2m 14s | — |
| `migrations` | 3m 03s | `in 3m` |
| `lint` | 3m 27s | `in 3m` |
| `policy` | **>= 4m 58s** | cancelled before it could report |

**A 27× spread at one minute, against one registry, from one pinned action.** An outage would slow
all five alike. This bears on the choice between remediations (a) and (b): the cost is not a new
fixed price that could be re-budgeted, it is a **heavy tail on each runner independently**, so no
cap chosen against typical behaviour is safe while the dependency stands. It also explains why only
`policy` ever dies — it holds the smallest budget of any job that runs the step
(`policy` was 5m; `brand-check` 10m, `lint`/`migrations` 15m, `distributed-contract`/`browser` 20m,
`e2e-pgvector` 25m, `e2e` 30m, `verify` 60m). `lint` and `migrations` absorbed the same three-minute
install on that very run with eleven minutes to spare. The two other five-minute jobs, `changes` and
`worker-protocol-contract-bytes`, do not run the step at all.

#### 3. The blast radius is two jobs wider than "policy went red"

Observed on all eight cancelled attempts (steps 1 and 2 on 8/8; step 3 as `failure` on 7/8 and as
`cancelled` on the eighth — never `success`, which is the only value branch protection accepts):

1. `policy` is cancelled at the wall.
2. `brand-check` (`needs: [policy]`) is **skipped**, and GitHub stamps the skipped job with
   `completed_at` **before** `started_at` (e.g. started `06:05:12`, completed `06:05:11`). A reader
   who checks that job sees an inverted timestamp and reasonably suspects a second, unrelated fault.
   It is an artefact of the cancel path.
3. `ci-required` requires `policy` **and** `brand-check` in its **always-on** arm — not the
   `code=true`-gated one — so it emits two `::error::` lines and fails. (On run `33858466826`
   `ci-required` was itself `cancelled` rather than `failure`; the gate is red either way.)

No compute is lost (re-running the failed jobs carries the green ones forward — `verify (2)` keeps
its original timestamps across attempts). The cost is latency, attention, and the re-run reflex:
**PR #353 needed five attempts** to get a green `policy`, and the integration tip `717475f63` was
cancelled too. Occurrences on four shas: `46c27e38b`, `5d91afff5` (#353), `717475f63` (the integration tip), and
`f5daf62fc` — DEP-013's own build branch, the run `33858466826` cited above.

#### ★★★ 4. ONE CORRECTION — "it is still growing" is not sustained, and that is a trap for the PR #321 lead

The section above records `Setup pnpm` at **424 s** on run `33859560367` (09:41Z) and concludes it
is *still growing*. Measured **2.5 hours later**, on run `33871439141` (12:10Z), the same step on the
same branch took **3 seconds** — back to baseline, with no change to the action, the pin, or the
workflow in between.

So the distribution is **episodic with a heavy tail, not monotonic growth**. Every cancellation and
every multi-minute sample falls inside one window on 2026-09-04 (roughly 05:34Z–09:48Z); the **18**
`policy` runs on `docs/replatform-program` that PRECEDE that day are green to a run, and the run
after the window is 3 s. (The remaining three greens are ON 09-04 and two of them are the degraded
135 s / 149 s samples above — the episode shows up in the greens as well as the reds, which is why
"all the greens are before it" would have been the wrong summary.)

**Why this matters more than a corrected adjective.** The free lead above suggests testing whether
`pnpm/action-setup` 6.0.10 (PR #321) "restores the 4s step". Outside an episode **the step reads
~4 s with or without the bump**, so a single post-episode measurement will look like a fix whatever
the bump does. Testing that lead needs either a paired comparison (both versions in the same run, so
they see the same runner conditions) or a sample large enough to contain a tail — otherwise the
likely outcome is a confident, wrong "fixed", which costs more than the open question does. The
correlation remains unmeasured either way, and the growth may still be CDN-side.

**Method note, since the addendum corrects the section above.** This addendum's own first draft made
the same error one scale down: it took a *degraded* run (`33842573550` attempt 3 — job 4m 25s, step
3m 15s) for "the green baseline", and asserted a failure rate of "roughly one sha in two" from two
shas that had been handed to it *because* both were red. Measuring the population instead — the last
25 `PR` runs on `docs/replatform-program`, 23 with attempt-1 `policy` data — gives **21 success, 2
cancelled**, of which 18 (5 on 09-02, 13 on 09-03) precede the episode and the other 5 are inside it. Selection bias in the same direction is what
produced both the withdrawn rate and the "still growing" reading: **a sample drawn from an episode
describes the episode, not the distribution.**

---

### ★ Addendum (2026-09-04, TRACK A) — the raise closed one of nine exposures; the remaining eight are now split budgets behind a guard

**Status: still `open`, and NARROWED rather than closed.** What this addendum closes is the *leak*
(the cap was raised on one job out of nine that carry the same step) and the *absence of detection*
(nothing would have caught a tenth instance). What it does NOT close is this finding's headline
question — **why the step grew** — which is still undiagnosed.

#### 1. The leak, counted at the tip `da1a90597`

`pnpm/action-setup` appears in **nine jobs in `pr.yml`**: `policy`, `brand-check`, `verify` (4-shard
matrix), `lint`, `e2e`, `migrations`, `e2e-pgvector`, `distributed-contract`, `browser`. DEP-013's
raise covered `policy`. Repo-wide the step appears 21 times across 12 workflows.

#### 2. The correction to "it is still growing" is confirmed, and sharpened

This finding's own addendum withdrew the "still growing" reading and warned that a sample drawn from
an episode describes the episode. Measuring the whole 13-run window confirms it and puts a shape on
it: the slow setups are confined to **four consecutive runs between 05:34Z and 11:42Z on 2026-09-04**
(10, 10, 12 and 7 of the 12 job instances above 60 s). The five runs before and the four runs after
show `Setup pnpm` at **4–22 s in every job**. So the step is not on a trend and is not permanently
expensive — it had a ~6-hour episode. The 424 s that this finding cites as "worse than the 287 s that
caused the cancellation" is inside that window, and reads as its peak rather than as a next point on a
curve.

★ **This makes the case for splitting the budget stronger, not weaker.** A permanent 400 s cost would
justify raising every cap once. An intermittent episode that leaves no trace in any commit is exactly
what a single cap cannot represent: it absorbs the episode silently when it fits, and when it does not
it kills the job and GitHub names an innocent step — the misdiagnosis this finding's addendum already
documents.

**And a control fell out of the same data.** Per-job WORK (wall clock minus `Setup pnpm`) inside the
episode versus outside it: `verify` 857 s vs 909 s, `e2e` 1003 vs 989, `policy` 71 vs 73, `browser`
60 vs 59, `lint` 56 vs 57 — identical within noise, in both directions. **The episode was in the
registry fetch, not in the runners.**

#### 3. What shipped — remedy (a), partially, plus the detection this finding said the raise did not provide

This finding named two candidate remediations. What shipped is a third that sits between them and
takes one bite of (a):

- **`brand-check`'s exposure is REMOVED, not capped.** That job never ran `pnpm install`; its lone
  `pnpm exec node scripts/check-forbidden-tokens.mjs` was equivalent to plain `node` (the script
  imports only `node:` builtins). The step existed to make `pnpm exec` resolvable and bought nothing,
  while exposing a required check to registry latency — measured here at 3 s median and **234 s**
  worst. Deleted; cap 10 → 5. **Nine exposures → eight.** This is remedy (a) in its cheapest form: the
  fetch that is not needed does not happen.
- **The remaining eight get a SPLIT budget.** Each `Setup pnpm` step now carries its own
  `timeout-minutes: 8`, and each job's cap is derived as
  `ceil((workBudgetSeconds + setupAllowanceSeconds) / 60)` in `.github/ci-timeout-budgets.json`.
  This is what the finding asks for under (b) — a step duration finally has a consumer — but as a
  *gate* rather than a report: the next episode fails a step whose **name is the diagnosis**, instead
  of consuming an unrelated step's budget.
- **Seven caps go DOWN** (`policy` 12→11, `lint` 15→10, `migrations` 15→11, `browser` 20→12,
  `distributed-contract` 20→10, `e2e-pgvector` 25→18, `verify` 60→37) and **one goes up** (`e2e`
  30→33, the thinnest genuine margin of the nine at 323 s). `policy` moving 12 → 11 is not a revert of
  DEP-013's raise: the same total wall clock is preserved, with 480 s of it named as infrastructure
  and failing under its own name, so 11 is more protective than 12 rather than less.

#### 4. The guard — and the fact that it went red on the real tree first

`scripts/check-ci-timeout-budgets.mjs` (pure logic in `scripts/lib/ci-timeout-budgets.mjs`, 15-case
corpus in `scripts/check-ci-timeout-budgets.test.mjs`), wired into `policy`. Run against the
**unmodified** tip before any edit it produced **17 findings across all 9 jobs**. Two mutations against
the fixed tree, both restored: raising `verify` back to 60 alone → `job_cap_mismatch`; raising the cap
*and* the work budget together to make it arithmetically legal → `work_budget_unjustified`, because a
work budget may not exceed **2× its own recorded `measuredMaxWorkSeconds`**. Passing therefore requires
editing a dated, run-id-attributed measurement in the same diff — which is the specific thing this
finding says a cap raise skipped.

#### 5. ★ What is still open

1. **The cause.** Nothing here explains the six hours. **PR #321 (`pnpm/action-setup` 6.0.9 → 6.0.10),
   this finding's own free lead, is still open and was NOT tested by this track.** The split budget
   makes the next episode legible; it does not prevent one.
2. **12 of the 21 repo-wide uses are untouched** — every non-required lane (`release.yml`,
   `release-smoke.yml`, `cross-platform-weekly.yml` ×2, five `keyed-e2b-*`, `llm-evals.yml`,
   `catalog-audit.yml`, `thread-v2-e2e.yml`).
3. **The other half of the E3-F036 class is untouched.** The guard covers workflow jobs and steps, not
   *tests* that reach the network — so E3-F036's own instance would not have been caught by it.
4. **No live CI evidence at the time of writing.** All figures are from the Actions jobs API; all
   verdicts are from local runs. The caps are proven only by the first green `pr.yml` run on the
   branch that carries them.

**Disposition:** stays `unowned`. Item 1 is the remaining defect and is a diagnosis, not a line.
