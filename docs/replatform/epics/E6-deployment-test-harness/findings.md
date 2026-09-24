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

> ★★★ **THE TITLE IS STALE — THE WIRE IS SPECIFIED AND BUILT. Corrected 2026-09-21 (M1 Step 0,
> S0-4), verified at source; the title is kept because it is the finding's name.** The
> request/response wire now exists end to end: the driver `packages/provider-wire/src/driver.ts`
> (codec and capability in the same package), the server `createProviderServer` in
> `packages/adapter-manager/src/server.ts` with its gated owned-op routes, and the worker-side
> container root `packages/worker-networked-host/src/bin/networked-host.ts` (DEP-011 Slice 2b-ii,
> commit `45d930066`), which boots the daemon with `makeNetworkedRunProvider` when
> `AOA_WORKER_PROVIDER_URL` is set. DEP-012 units A/B and waves β1/β2 and DEP-011 slices 1, 2a and 2b
> built it. **What is still open is deployment, not specification:** the adapter-manager image is not
> built in CI and no shipped CI boot runs this wire — filed at M1 Step 0 as **`DEP-014`** and
> **`DEP-015`** — and mTLS on the worker→adapter-manager hop is a named residual (M1 plan §8).
> Status, severity and owner (`DEP-011`) are unchanged by this note; the finding closes when
> `DEP-011` ships, which now means when the wire runs in a shipped boot.

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

## E6-F012 — the deps-stage parity guard compares the PRODUCTION closure while the build stage traverses dev edges too — RESOLVED

**Status:** `resolved` (2026-09-04) · Severity: MED · Source: WRK-017 (2026-09-03), promoted out of E6-F010's residual
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
*(★ AS-FILED TEXT, SUPERSEDED — see the RESOLUTION below. "No guard saying so" is no longer true;
and the widening on `server`/`ui` specifically turned out not to be a defect at all, for a reason
this paragraph did not know. The paragraph is kept verbatim because the resolution argues with it.)*

**Blocks:** nothing today — the re-install makes the current tree build. It is filed `unowned` because
no ticket is building the detector, and because the honest remediation is a design choice, not a line:
either teach the deps-stage guard to compare the DEV closure as a second, separately-reported set, or
give the image build a PR-time consumer. Note the relationship to **DEP-013** without conflating them:
DEP-013 makes the next occurrence LOUD within a bounded time; this finding's successor would make it
IMPOSSIBLE. Neither substitutes for the other, which is why WRK-017's designer declined to fold this
into DEP-013.

**RESOLUTION (2026-09-04).** Both halves closed, and the second half was worse than filed.

> ★ **READ THE CORRECTION BELOW BEFORE QUOTING ANYTHING IN THIS SECTION.** Review refuted this
> resolution's headline on 2026-09-05 — twice. The measurements below stand; two of the claims made
> about them did not. The corrected statement of what actually ships is at the end of this entry.

**Measured first.** The divergence was never hypothetical — every one of the three split images
already diverges at `da1a90597`:

| image | runtime (prod) closure | build (dev) closure | build-only |
|---|---|---|---|
| control-plane | 19 | 25 | 6 — adapter-manager, provider-wire, sandbox-e2b-provider, sandbox-fake-provider, sandbox-provider-contract, worker-daemon |
| worker | 7 | 8 | 1 — sandbox-fake-provider |
| adapter-manager | 7 | 8 | 1 — sandbox-fake-provider |

Measured alongside it: **0 of 33** workspace manifests declare an `optionalDependencies` block at
all, so the neighbouring hazard the module header warns about (`--filter-prod` traverses them,
`indexPackages` does not) is still dormant and is deliberately left where it is.

**Half 1 — the detector.** `scripts/lib/image-deps-stage.mjs` gains a SECOND, separately-reported
verdict (`evaluateBuildStageAbsorption`) beside the deps-stage one. The invariant is deliberately
NOT "the deps stage must COPY the dev closure" — that would destroy the least-privilege property
the file exists to enforce and would push the fake provider and the worker daemon into the
control-plane install. It is conditional, and it lives one stage later:

> IF the build closure is strictly larger than the runtime closure, THEN the `build` stage must
> absorb the difference — **(a)** by re-installing (`RUN pnpm install`, not `--prod`/`--filter-prod`,
> which would re-select the runtime closure and absorb nothing) and **(b)** with the divergent
> packages' manifests actually present in that stage, or the re-install has nothing to resolve.

`computeRuntimeClosure` is untouched: its `.dependencies`-only walk is a load-bearing mirror of
`--filter-prod` and must not grow a mode flag, so `computeBuildClosure` is a separate function and
`indexPackages` records `devWorkspaceDeps` as a separate field.

Clause (b) is what makes the rule bite. The worker build stage deliberately does not `COPY . .` —
a whole-tree copy would make every `dockerfile-static` exclusion grep vacuous — so for that image a
new workspace devDependency is a real break, and clause (a) alone would not see it. Clause (b) also
promotes the worker's "8th manifest" note from prose to a checked rule.

**Half 2 — the consumer that could not fire.** The only lane that builds these images is
`d1-merge-train.yml`, and its `paths:` filter listed the workflow, the compose files, `docker/**`,
`.dockerignore`, `tests/d1/**` and seven scripts — and **nothing matching `package.json`,
`pnpm-lock.yaml` or `pnpm-workspace.yaml`**. So the exact commit class that widens the build
selection could not fire even the POST-merge consumer. `c3d26657d` reddened the lane only because
it happened to touch `docker/**` as well. This finding was filed as "no PR-time consumer"; it was
NO CONSUMER AT ANY TIME. That same file already carried the identical lesson for `.dockerignore`
("a change to it could alter the contents of both shipped images without the image-building lane
ever running") — the manifests were simply never given the same treatment. They now are, with the
queueing cost stated in the comment rather than hidden.

**Proved by mutation, on the REAL tree, each one restored and the restore verified green:**

| # | mutation | result |
|---|---|---|
| 1 | `packages/worker-networked-host` gains a workspace devDependency on `shared` | RED — clause (b): "build-only closure package @armyofagents/shared has no manifest in the 'build' stage". The deps-stage verdict is untouched, which is the point. |
| 2 | `server` gains a workspace devDependency on `cli` | **GREEN — and correctly so.** |
| 3 | the control-plane build stage's re-install line deleted (WRK-017's fix reverted) | RED — clause (a), naming all six build-only packages. |
| 4 | that same line changed `--filter` → `--filter-prod` | RED — "absorbs nothing". |
| 5 | the worker build stage's two `sandbox-fake-provider` COPY lines deleted | RED — clause (b). |

**★ Mutation 2 is the honest limit, and it revises this finding's own headline.** "The next
workspace devDependency added to `server` or `ui` re-widens the build selection" is still true, but
it is no longer a defect there: the control-plane and adapter-manager build stages do `COPY . .`
plus a non-prod re-install, so any dev-closure widening is absorbed *by construction* and the image
still builds. The guard returns green because there is nothing wrong, not because it is blind — and
mutations 3 and 4 are what distinguish those two readings. What the guard newly makes impossible is
(i) removing or `--prod`-ing an absorber that is load-bearing, and (ii) a widening on an image whose
build stage copies selectively — i.e. the worker.

**Not claimed.** This is static text analysis over the Dockerfiles and the manifests. It does not
build an image. The stated remedy in every error message points at the `build` stage and says
"never to deps", because a guard whose message advises the least-privilege violation is worse than
no guard. DEP-013's verdict consumer remains the mechanism that makes an actual image-build failure
loud; this makes one class of it impossible to introduce silently, and the trigger fix is what lets
the lane observe the class at all.

---

### ★★★ CORRECTION (2026-09-05) — the shipped HEADLINE overstated the shipped MECHANISM, twice

Review refuted this entry's claim, not its measurements. Both corrections are recorded here in full,
because a future reader believes the headline and only reaches the body once the headline has already
misled them.

**Correction 1 — a FALSE CLAIM OF ENFORCEMENT in the one file a filter-editor reads.** The comment
added to `.github/workflows/d1-merge-train.yml` said `check-image-deps-stages.mjs` "now detects the
divergence statically on every PR", directly beneath an antecedent naming *"a single workspace
devDependency added to `server`"*. **On exactly that class the script is silent** —
`evaluateBuildStageAbsorption` returns `[]` before any report once the divergence is absorbed, and
the only passing output is the single line `split-image deps-stage parity: PASS`. No divergence is
ever printed. This register said so in the same commit (mutation 2 green, "no longer a defect
there"), so the workflow comment contradicted its own evidence. Worse than wrong: it sat directly
above the paragraph that costs 45 minutes of CI, where it reads as the reassurance that would
license trimming the `**/package.json` trigger. The comment now states what the guard checks, states
that it stays green on the antecedent class *and why that is correct*, and says plainly that the
static guard is **not** grounds for trimming these entries.

**Correction 2 — clause (a) tested the wrong half, and that was not disclosed.** Clause (a) asks
"is there a `pnpm install` in the build stage without `--prod`/`--filter-prod`?" — a question about
a FLAG. It is satisfied by an install that absorbs nothing. **Measured on `da1a90597`:** replacing
the control-plane build stage's re-install with
`RUN pnpm install --frozen-lockfile --filter "@armyofagents/worker-protocol..."`, leaving its
`--filter "…/server…" --filter "…/ui…" build` line untouched, left the whole gate GREEN — and that
is `c3d26657d`'s failure mode exactly (the build selection strictly exceeding the installed
selection). Disclosing that would have left a guard whose name promises more than it does, so it is
FIXED: `evaluateBuildSelectionCoverage` (clause **a2**) compares the two SELECTIONS. Every package a
`pnpm … build` line selects must have been selected by an install visible to that stage. It is
unconditional — "build only what you installed" holds with no dev/prod divergence at all.

Three subtleties the fix had to get right, each of which is a test:

* **Discovery bounds a selection.** `--filter "…/server…"` in a `deps` stage holding only the 19
  runtime manifests installs 19, not the 25 the same flag selects against the whole tree — pnpm's
  `...` walks the DISCOVERED workspace. Unbounded, the deps filter would vouch for packages it never
  installed and the fix would be vacuous.
* **`COPY --from=<stage> <workdir>` IS an install.** The control-plane and adapter-manager build
  stages take deps' node_modules wholesale, so reporting those packages is a FALSE POSITIVE. Credit
  is given only for a copy of that stage's own workdir (or its `node_modules`) — an unrelated
  `COPY --from=deps /app/patches ./patches` earns none, or a narrowed re-install could hide behind it.
  Finding this cost the first draft of clause (a2): it would have red-flagged a correct Dockerfile.
  ★ Note the deliberate asymmetry with clause (b), which still does **not** count a `COPY --from=`
  as manifest delivery: a cross-stage copy moves an *installed tree*, which is what (a2) asks about,
  and does not move *source manifests*, which is what (b) asks about. The same line legitimately
  answers one question and not the other; collapsing them would make (b) vacuous for both
  `COPY . .` images.
* **An ABSENT package is clause (b)'s, not (a2)'s.** A package whose directory never entered the
  stage cannot be selected by the build line either. Double-reporting one gap with two different
  remedies sends the reader to the wrong fix.

Also removed while proving this: an `isPnpmBuildLine` exclusion for lines containing `deploy`. It
could not change a verdict on any realistic line (a `pnpm deploy --prod` line carries no whole-token
`build`) and would have SUPPRESSED a real build on a compound `RUN pnpm deploy … && pnpm build`.

**Measured, on the real tree, each mutation restored and the restore verified green:**

| # | mutation | result |
|---|---|---|
| a2-1 | worker build-stage install narrowed to `worker-protocol...` | RED — "BUILDS 1 package(s) that no install there selected (sandbox-fake-provider)" |
| a2-2 | adapter-manager build-stage install narrowed to `provider-capability...` | RED — 5 packages |
| a2-3 | control-plane install covers `server` only; the build line still selects server+ui | RED — 1 package (`ui`) |
| a2-4 | a glob selector (`--filter "@armyofagents/*"`) on the build line | RED — reported as unparseable, never read as "selects nothing" |
| 3′ | control-plane build-stage re-install DELETED | RED — clause (a), unchanged |
| 4′ | that line `--filter` → `--filter-prod` | RED — clauses (a) AND (a2) |
| 5′ | worker build stage loses both `sandbox-fake-provider` COPYs | RED — clause (b), unchanged |

And eleven mutations of the guard's own source, each restored: neutering `evaluateBuildSelectionCoverage`,
dropping the unparseable-selector report, dropping the present-set filter, dropping `FROM <stage>`
install inheritance, dropping `COPY --from=` install credit, widening that credit to any source,
un-bounding a selection by its stage's discovery, making a bare install select nothing, making
build lines invisible, and matching `build` as a substring — **all red**.

**What clause (a2) still does NOT cover, stated rather than implied.** pnpm filter syntax beyond a
plain package name with an optional `...` (`^...`, `...^`, globs, path and changed-since selectors)
is REPORTED as unparseable rather than silently treated as empty — loud, but not understood.
ORDERING is invisible: an install placed *after* the build line reads the same as one before it. And
nothing here builds an image.

**The claim, at its weakest fully-supported strength.** This PR does two things. It gives
`d1-merge-train.yml` a manifest/lockfile trigger, so the commit class that re-widens the build
selection can fire the only lane that builds these images — verified, and the valuable half. And it
adds a static guard that makes three specific evasions impossible: removing or `--prod`-ing a
load-bearing absorber, narrowing a re-install below what the build line compiles, and a widening on
an image whose build stage copies selectively. It does **not** detect "a workspace devDependency
was added", it prints no divergence, and it is not a substitute for building the image.

Corpus: 19 new cases in `scripts/check-image-deps-stages.test.mjs` (34 total, all green).

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
work budget may not exceed **2× its own recorded `measuredMaxWorkSeconds`**.

★★★ **CORRECTED 2026-09-05.** This paragraph first concluded that "*passing therefore requires editing
a dated, run-id-attributed measurement in the same diff*". **It did not — not on the dial that
mattered most.** The ceiling covered `workBudgetSeconds` only. `setupAllowanceSeconds` was validated
as a positive number and nothing else, so editing that one **uniform** value 480 → 3000 plus the two
caps it derives — a three-line diff with no measurement in it — took `policy` from an 11-minute cap to
**53**, and its step cap from 8 to **50**, on **all eight jobs at once**, and the guard printed OK.
That is the same failure mode this finding filed against DEP-013's raise, one level up. The manifest
now carries a `setupAllowance` measurement (431 s worst over 156 observations, dated, 13 run ids)
and a **1.5×** ceiling, deliberately tighter than the work budget's 2× because this one number is
additive into all eight caps. **No cap changed**, so the live evidence in item 4 below still holds.
Six new test cases pin the refuting diff; all six were RED against the pre-correction library.

★★★ **CORRECTED AGAIN, same day, and this time the correction is a WITHDRAWAL.** The paragraph above
first continued "*the cost was declared, not charged — it is charged now*", and the register said
raising a cap costs a re-measurement on BOTH dials. **That is false too, and computable from the
shipped manifest without running anything.** Each clause compares a **declared** number to a
measurement **declared in the same file**; none compares anything to a **previously committed**
value. So 3000 is refused and 646 is not: the shipped 480 sits **166.5 s** below its 646.5 s ceiling,
uniformly across the eight jobs, and every `workBudgetSeconds` sits below its own 2× ceiling too
(`verify` 1700/2184, `e2e` 1500/2092). MEASURED: pushing every declared number to its ceiling with
**no `measured*` field edited** moves the eight derived caps from **142 to 187 minutes** and every
step cap **8 → 11**, and the guard prints OK. Full residue table, and the reason a previous-value
clause cannot live in this guard, in the **E3-F036 addendum §5c**. A second miss found in the same
read — a required-lane job with no `timeout-minutes` at all is skipped by the coverage clause
entirely — is in **§5d**. Neither is closed, and no third claim replaces them.

#### 5. ★ What is still open

1. **The cause.** Nothing here explains the six hours. **PR #321 (`pnpm/action-setup` 6.0.9 → 6.0.10),
   this finding's own free lead, is still open and was NOT tested by this track.** The split budget
   makes the next episode legible; it does not prevent one.
2. **12 of the 21 repo-wide uses are untouched** — every non-required lane (`release.yml`,
   `release-smoke.yml`, `cross-platform-weekly.yml` ×2, five `keyed-e2b-*`, `llm-evals.yml`,
   `catalog-audit.yml`, `thread-v2-e2e.yml`).
3. **The other half of the E3-F036 class is untouched.** The guard covers workflow jobs and steps, not
   *tests* that reach the network — so E3-F036's own instance would not have been caught by it.
3b. ★ **This finding's remedy (b) is answered as a GATE, not as a bound on the work.** The step cap
   makes the infrastructure half fail under its own name — which is what this finding asked for. It
   does **not** make the job cap bound the work: GitHub's `timeout-minutes` covers every step, so the
   480 s allowance is additive and **unreserved**, and a job whose setup is fast may spend the whole
   cap on work (`lint` 9.8× its measured worst work, `policy` 7.5×). The magnitudes improved; the
   shape did not. See E3-F036 addendum §4 and §6 item 4 for the full ratios and what closing it
   would take.
3c. ★ **Two further things the guard does not see**, both stated rather than left for the next
   reader: a raise that stays **inside** either ceiling (E3-F036 §5c — up to +166.5 s of allowance
   on all eight jobs at once, and +484 s / +592 s of work budget on `verify` / `e2e`, with no
   measurement edited), and a required-lane job that arrives with **no `timeout-minutes` at all**
   (E3-F036 §5d — skipped by the coverage clause, inheriting GitHub's 360-minute default).
4. ~~**No live CI evidence at the time of writing.**~~ **SUPERSEDED.** Run **`33902312371`** on
   `claude/ci-timeout-class` is fully green including `ci-required`; every job landed inside both its
   new cap and its declared work budget (full table in the E3-F036 addendum), and `brand-check`
   recorded **no `Setup pnpm` step at all**, confirming the deletion in CI. ★ It landed in a QUIET
   window — `Setup pnpm` was 3–7 s — so **the 8-minute step cap has not yet fired.** The first real
   test of it is the next episode, which is also the first time this finding's remaining question
   (why the step grows) will be legible instead of showing up as a cancelled job blaming an innocent
   step.

**Disposition:** stays `unowned`. Item 1 is the remaining defect and is a diagnosis, not a line.

## E6-F015 — The committed staging manifest boots a control plane against two NOLOGIN roles, and nothing in the manifest or any clause mints their credentials

**Status:** open
**Severity:** MEDIUM — corrected DOWN from the HIGH this was reported at; the correction is the
substance of the finding and is stated first.
**Filed:** 2026-09-06 (W5U1), measured at `e1f723df2`. Cross-links E7-F018 (the class: an
operator/deployment precondition of a capability, recorded by no clause).

### ★ FIRST — what was reported, and what measurement REFUTED

This was handed over as: *"migrations `0211_tenant_rls_enforcement.sql:16` and
`0213_e2_serving_role_correction.sql:11/:17` create `aoa_app` and `aoa_operator` NOLOGIN with no
password. The only thing that mints credentials is
`docker/control-plane/provision-d1-serving-roles.mjs`."*

**The migration half is exactly right** and was re-measured:

```
sed -n '16p' packages/db/src/migrations/0211_tenant_rls_enforcement.sql
sed -n '11p;17p' packages/db/src/migrations/0213_e2_serving_role_correction.sql
```

all three are `DO $$ … CREATE ROLE "aoa_app|aoa_operator" NOLOGIN NOSUPERUSER NOBYPASSRLS …`.

**The "only minter" half is FALSE.** There is a second, in-repo, deployment-agnostic minter:
`maybeProvisionDistributedExecutionRoles` (`server/src/index.ts:303`, called at `:562`), which runs
`ALTER ROLE … WITH LOGIN PASSWORD …` on the owner connection immediately before
`openDistributedExecutionDatabases` — gated on `config.distributedExecutionEnabled` AND on
`AOA_APP_DB_PASSWORD` / `AOA_OPERATOR_DB_PASSWORD` being set. `0211`'s own header comment says so
("the login credential is provisioned at boot from env (E2-D03, server/src/index.ts)"), and the
campaign terrain doc records it as the RECOMMENDED route:
`docs/replatform/qa/2026-08-31-campaign-blockers-and-fleet-terrain.md:161-166` lists **both** ways
to grant LOGIN, calls the boot-env one "RECOMMENDED (works anywhere)", and warns that the passwords
must match the ones embedded in the role URLs. Both env vars are also documented in
`docs/deploy/environment-variables.md:110-111`.

So "recorded by no clause" is true only in the narrowest sense (no `gate-clause-wiring.json` entry),
and "recorded nowhere an operator looks" — the thing that would make it E7-F018-shaped — is **not**
true. That is why the severity is MEDIUM, not HIGH.

### What survives, and it is narrow

The committed staging manifest cannot bring its own control plane up after its own `migrate` step.

- `docker-compose.staging.yml:48-57` runs `migrate` with the owner URL. Migrations create both roles
  **NOLOGIN**.
- `docker-compose.staging.yml:61-86` and `:115-137` then start two control-plane replicas with
  `AOA_DISTRIBUTED_EXECUTION_ENABLED: "true"` and `AOA_APP_DATABASE_URL` /
  `AOA_OPERATOR_DATABASE_URL`.
- Neither replica is given `AOA_APP_DB_PASSWORD` or `AOA_OPERATOR_DB_PASSWORD`
  (`grep -n "AOA_APP_DB_PASSWORD\|AOA_OPERATOR_DB_PASSWORD" docker-compose.staging.yml` → **0 hits**),
  so `maybeProvisionDistributedExecutionRoles` is a strict no-op there. No service in the manifest
  runs `provision-d1-serving-roles.mjs` either — that script is reachable only from
  `docker-compose.d1.yml`, whose own comment scopes it "D1 harness ONLY" (`:118`).
- `server/src/index.ts:600-611` then opens both bounded pools with, in its own words, "deliberately
  no owner fallback". So the boot **fails closed** on two roles that cannot log in.

**The distinguishing detail, and why it is worth a finding at all rather than "one more `${…}`".**
Every other operator input in that file appears in the file — as a named `${AOA_STAGING_*}`
placeholder an operator reading the manifest can see and fill. The credential MINT is a *step*, not
a variable: it appears nowhere in the manifest, in no comment in it, and in no checked-in guard.
`scripts/check-staging-manifest.mjs` grades this exact file and prints "OK:
docker-compose.staging.yml satisfies the DEP-006 staging config contract" without asking the
question.

### Why the error direction is benign, and why it is still worth recording

The failure is loud: startup aborts before serving. Nothing runs unsafely, and no capability is
over-claimed. What it costs is a deploy attempt and the time to rediscover a precondition that is
written down two directories away and nowhere the operator is looking. That is a MEDIUM.

**What would close it.** A comment in `docker-compose.staging.yml` beside the two role URLs pointing
at `…campaign-blockers-and-fleet-terrain.md` §8, or the two password vars added as
`${AOA_STAGING_*}` placeholders so the manifest names its own precondition. Not done here: W5U1's
charter is "do not touch docker/ or the D1 compose files (another unit owns those)", and
`docker-compose.staging.yml` is close enough to that boundary that editing it belongs to the
deployment track.
## E6-F016 — `scripts/ci-local.mjs`'s "skip `pnpm install`" guard had never once been in effect, and its own comment said otherwise — RESOLVED

**Status:** resolved
**Severity:** MEDIUM — a local-runner-only defect (no CI lane is affected), but its side effect is
lockfile mutation in the DEFAULT fast gate, which the `policy` job then fails the PR for.
**Filed and resolved:** 2026-09-08 (W19), measured at `3814b90f3`. Cross-links the same class in
`scripts/lib/worker-keystore-boundary.mjs` (fixed earlier) and
`server/src/__tests__/w17-ipv6-range-closeout.test.ts` (fixed on another branch).

### What was wrong

`scripts/ci-local.mjs` carried, in source:

```
if (/^pnpm install<0x08>/.test(cmd)) continue;
```

a literal 0x08 backspace byte where the two characters backslash-b belonged — the signature of a
file written through a shell heredoc, `echo`, `printf` or `sed`, all of which collapse those two
characters into one control byte. The regex therefore demanded a real backspace character after
`install` and matched nothing.

The comment three lines above it read: *"Running `pnpm install --frozen-lockfile` locally costs
minutes and can churn node_modules; the local runner assumes a working tree that already installs.
This is the ONE deliberate deviation from CI, and it is stated in `--list`."* Measured with the
script's own parser, **eight** `pnpm install` steps survived that guard and were executed as steps:

```
policy               :: pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile
verify               :: pnpm install --frozen-lockfile
lint                 :: pnpm install --frozen-lockfile
e2e                  :: pnpm install --frozen-lockfile
migrations           :: pnpm install --frozen-lockfile
e2e-pgvector         :: pnpm install --frozen-lockfile
distributed-contract :: pnpm install --frozen-lockfile
browser              :: pnpm install --frozen-lockfile
```

The `policy` one is lockfile-MUTATING and `policy` is in the default fast gate, so every
`node scripts/ci-local.mjs` ran a command that can rewrite `pnpm-lock.yaml` in the working tree —
which the `Block manual lockfile edits` step in that same job then fails the PR for.

### ★★★ THE SECOND DEFECT, which the byte hid

Fixing the byte alone moved the surviving-install count **8 → 7, not 8 → 0.** The guard had only
ever sat on the multi-line `run: |` path, while **seven of the eight** installs are inline
`run: pnpm install --frozen-lockfile` steps that `parseJobs` pushes and `continue`s on, several
lines ABOVE the guard. So even a correctly-written regex could only ever have skipped ONE job's
install, and the premise that "the intended regex would have skipped all 8" is false.

That is the substance of this finding: a dead escape is visible once you know to look for it with
`cat -A`; a guard on the wrong code path is invisible in any rendering, and only a test that
asserts the CONSEQUENCE — the count — can see it. A byte-only fix, or a byte-only regression test,
would have gone green over a guard that still covered one eighth of its cases.

### ★ A third inaccuracy in the same three lines

The comment claimed the deviation "is stated in `--list`". It was not: `--list` printed job names,
step counts, env-gated counts and unrepresentable counts, and said nothing about installs — and
after the byte fix the skipped steps were dropped silently, so it still would not have. Three
claims in one comment, none of them true of the running code.

### The decision that was made deliberately rather than inherited

`policy`'s `--lockfile-only` install is skipped **too**, and not for the cost reason the original
comment gives. In CI that command sits behind two conditions this parser cannot see: a step-level
`if: github.event_name == 'pull_request'`, and a shell `if` that runs it only when a manifest file
changed. `parseJobs` keeps lines starting with `node`/`pnpm`/`npx` and drops the `changed=` / `if` /
`fi` scaffolding around them, so running it locally does not reproduce CI — it runs a command CI
would usually NOT run, with a side effect on a tracked file. Skipping it is the faithful behaviour.

### What changed

- The byte is now `\b`, and the predicate is a named `IS_INSTALL_STEP` consulted on **both** parser
  paths. Measured 8 → 0.
- Install steps are RECORDED as deliberate deviations rather than dropped, so `--list` and the run
  summary state the deviation the comment had only claimed they stated.
- `scripts/lib/__tests__/ci-local-install-guard.test.mjs` pins the consequence (0 surviving), the
  mechanism (both paths, ≥8 recorded), and the byte. All four mutants observed RED: re-inject the
  0x08; remove the inline-path guard; remove the block-path guard; over-broaden to all `pnpm`.
- `scripts/check-invisible-control-chars.mjs` generalises the byte half to the whole tree, wired
  into `policy`. See E6-F017.

---

## E6-F017 — sixteen raw control bytes sat in nine tracked text files, six of them corrupting explanatory prose including the post-mortem for this very defect — RESOLVED

**Status:** resolved
**Severity:** LOW individually; the reason it is filed is the CLASS, which has shipped three times,
twice after its own post-mortem was written down.
**Filed and resolved:** 2026-09-08 (W19). Census measured at `3814b90f3` and re-measured at this
PR's parent `c78a6827d`; the two trees give byte-for-byte the same result, so the rev is not what
moved the number.

### What was measured

A byte scan of every tracked text file found **16 raw control bytes in 9 files**. Every one of them
is the same shell-eaten-escape corruption or an authored byte written raw; **none** required
deleting an explanation to fix. The `bytes` column is the unit — a file can hold more than one:

| file | bytes | raw byte(s) | disposition |
|---|---|---|---|
| `docs/aoa/plans/2026-07-20-cli-auth-detection-plan.md` | 4 | 4× 0x08 BS | prose meant `` `\b5\d{2}\b` ``; the four `\b` were eaten, leaving the sentence naming a character it could not show. **Restored.** |
| `docs/replatform/qa/2026-08-31-blocker-ab-fix-design.md` | 1 | 0x08 BS | a Windows path `C:\pn\blockab\` with `\b` eaten. **Restored.** |
| `scripts/lib/worker-keystore-boundary.mjs` | 1 | 0x08 BS | the POST-MORTEM comment for this defect class, reading "where `<0x08>` was intended". **Restored.** |
| `packages/worker-daemon/src/supervisor/provider.ts` | 1 | 0x00 NUL | authored join separator → `"\0"` |
| `scripts/lib/__tests__/embedded-secret-scan.test.mjs` | **3** | 0x00 NUL, 0x01 SOH, 0x02 STX | authored fixture → `"\x00\x01\x02\uFFFD"` |
| `server/src/services/asset-content-guard.ts` | **3** | 0x00 NUL, 0x1f, 0x7f DEL | authored strip class → `/[\x00-\x1f\x7f]/` |
| `server/src/services/mcp-connectors.ts` | 1 | 0x00 NUL | authored sentinel → `"\u0000bound"` |
| `packages/browser-runtime/src/__tests__/path-adapter.test.ts` | 1 | 0x7f DEL | authored test input → `"evil\x7f.pdf"`; the two lines above it already used `\u0000` and `\n` |
| **subtotal repaired under this finding** | **15** | | across **8** files |
| `scripts/ci-local.mjs` | 1 | 0x08 BS | not this finding's repair — it is E6-F016's defect, filed and fixed directly above. Counted here because the scan does not know the difference. |
| **TOTAL, full-tree scan** | **16** | | across **9** files |

### ★★★ How to re-derive this census in one step

The number below is stated so it does not have to be trusted. **Banned set** is the guard's own
unit, `isBannedByte()` in `scripts/check-invisible-control-chars.mjs`: every C0 control byte
(0x00–0x1f) EXCEPT TAB 0x09, LF 0x0a and CR 0x0d, plus DEL 0x7f. **Scanned set** is every tracked
file `classifyPath()` calls `text`, decided by path and extension only, never by content — so the
62 binary blobs (PNG screenshots and the like), which hold ~800k of these bytes between them, are
out of scope by construction, and an unclassified type FAILS rather than being skipped.

Run the guard *from this branch* against a checkout of the parent, because the parent tree does not
contain the guard:

```
git worktree add --detach ../w19-parent c78a6827d
node scripts/check-invisible-control-chars.mjs --root ../w19-parent   # exits 1
git worktree remove ../w19-parent
```

It prints **one line per BYTE**, `path:line:col  NAME`. Verbatim, 2026-09-08:

```
invisible control characters in 9 file(s):
  docs/aoa/plans/2026-07-20-cli-auth-detection-plan.md:283:7  BS
  docs/aoa/plans/2026-07-20-cli-auth-detection-plan.md:283:14  BS
  docs/aoa/plans/2026-07-20-cli-auth-detection-plan.md:283:65  BS
  docs/aoa/plans/2026-07-20-cli-auth-detection-plan.md:283:72  BS
  docs/replatform/qa/2026-08-31-blocker-ab-fix-design.md:400:57  BS
  packages/browser-runtime/src/__tests__/path-adapter.test.ts:52:34  DEL
  packages/worker-daemon/src/supervisor/provider.ts:213:11  NUL
  scripts/ci-local.mjs:145:25  BS
  scripts/lib/__tests__/embedded-secret-scan.test.mjs:131:39  NUL
  scripts/lib/__tests__/embedded-secret-scan.test.mjs:131:40  SOH
  scripts/lib/__tests__/embedded-secret-scan.test.mjs:131:41  STX
  scripts/lib/worker-keystore-boundary.mjs:117:44  BS
  server/src/services/asset-content-guard.ts:77:16  NUL
  server/src/services/asset-content-guard.ts:77:18  0x1f
  server/src/services/asset-content-guard.ts:77:19  DEL
  server/src/services/mcp-connectors.ts:563:33  NUL
```

Sixteen lines, nine distinct paths — that is the whole derivation. Substituting `3814b90f3` for
`c78a6827d` prints the identical sixteen lines. Substituting this PR's head prints
`invisible control characters: PASS` and exits 0.

### ★ The number this record carried before, and why it was wrong

This finding first said "eight raw control bytes in seven text files". **Both numbers were wrong,
and wrong in the same way: they counted SITES, not BYTES** — one row per file-and-repair — so the
two files carrying three bytes each (`embedded-secret-scan.test.mjs` NUL/SOH/STX and
`asset-content-guard.ts` NUL/0x1f/DEL) were each counted as one, and an eight-row table was
summarised as "seven files". The total is precisely what hid them, which is why the per-file
breakdown above is now part of the record rather than a total standing alone.

It is worth stating plainly that this was the **third** count of the same corpus and the first
re-derivable one: 11-in-8 (which included a binary `.docx` and missed three bytes), then 8-in-7
(sites, not bytes), and only the external review on PR #384 noticed that neither reproduced from
the parent blobs. Three attempts to count invisible characters by eye produced three different
answers — the best argument this guard could have, and the reason a command now sits beside the
number. A false figure in the record justifying a guard is the exact class the guard exists to
prevent.

The hand-picked six-byte reconnaissance list (00 07 08 0b 0c 1b) would have **missed five of the
sixteen bytes**, and one file entirely: the 0x01 and 0x02 in `embedded-secret-scan.test.mjs` (whose
NUL it would have caught, so the file would have looked handled), the 0x1f and the 0x7f in
`asset-content-guard.ts` (likewise), and the `path-adapter.test.ts` hit, which is 0x7f alone and so
invisible to the list at file level too. (The earlier "missed three" here was the same
site-counting error, carried through.) That is why the guard bans a RANGE — C0 minus tab/LF/CR,
plus DEL — rather than a list.

### The objective harm, independent of taste

git classifies a file containing a NUL as BINARY and refuses to show its diff. **Four source files
were in that state**, so every change to them was unreviewable. Repairing them took the
repository's NUL-bearing file count from 66 to 62 — the four are diffable text again. "The author
meant it" is therefore not a sufficient defence for the raw byte.

### The guard, and why it is not the checker that gets deleted

The same post-mortem warns: *"a plain substring scan over raw source … flagged `command-runner.ts`
for the COMMENTS explaining why existsSync was removed: a checker that makes you delete the
explanation of a bug is a bad checker."*

`scripts/check-invisible-control-chars.mjs` bans the raw BYTE and permits every ESCAPE that denotes
the same character. Because the scan reads bytes, escapes are invisible to it by construction — no
exception machinery, no allowlist, no intent-reading. The repair for a legitimate use is a rewrite
to an escape denoting the identical character; the repair for a corrupted one restores meaning.
**The tree reached zero hits with no allowlist, no suppression comment, and not one word of
explanation removed. Three explanations were restored.** An allowlist of the day's findings was
rejected outright: it catches nothing new.

File type is decided by path and **never** by content. The usual NUL-sniff for binaries is
self-defeating here — the NUL being hunted would exempt its own file, which is exactly the state
the three `.ts` files above were in. Classification is default-deny: a tracked file whose type is in
neither list fails until someone classifies it. That rule earned its keep on its first run,
surfacing sixteen unclassified types, most of them text (`.mts`, `.jsonl`, `.npmrc`, `.mailmap`,
`.webmanifest`, PEM `.key`/`.crt`) that a hand-written list had silently skipped.

### ★★★ The evasion, stated rather than claimed away

The guard was measured EVADED at zero cost by three invisible characters that are not bytes:
U+200B ZWSP, U+202E RLO and U+00AD SHY each passed a full run. Two were then closed, chosen by
measurement: bidi overrides (U+202A–U+202E, U+2066–U+2069) and SHY have **zero** legitimate uses in
the tree and are a documented exploit class (Trojan Source, CVE-2021-42574). **U+200B, U+00A0 and
U+FEFF remain legal**, deliberately — the tree has six legitimate uses and one of them (a ZWSP
writing a close-comment sequence inside a JSDoc block) has no escape-based repair.

So the honest verdict: this guard is **complete against the accident it was built for** — a shell
can only ever emit a C0 byte — and it is **not a security boundary**. Anyone who wants to hide a
character can still do it with one zero-width space. `scripts/lib/__tests__/invisible-control-chars.test.mjs`
asserts that limit as a passing test so it cannot quietly be forgotten or over-claimed later.

---

## E6-F018 — the new control-character guard's ENTRY POINT was unpinned: deleting `process.exit(1)` kept every test and a clean-tree CI run green — RESOLVED

**Status:** resolved
**Severity:** MEDIUM — the guard's library was covered by eighteen tests; its EXECUTABLE, which
is the thing the workflow calls, was covered by none. The consequence is a CI step that reports
success over a planted control byte it has just printed to the screen.
**Filed and resolved:** 2026-09-08 (W19 round 2), on the same PR that introduced the guard. Found
by an adversarial mutation pass: sixteen mutants were landed against E6-F016/E6-F017's work,
fourteen went red and **two survived** — this and E6-F019, the same shape twice.

### What was wrong

`scripts/check-invisible-control-chars.mjs` ends its `main()` with

```
  if (violations.length > 0 || unclassified.length > 0) process.exit(1);
  console.log(`invisible control characters: PASS (...)`);
```

Delete that one line and **every test still passed**, `node --test` exit 0, and a clean-tree run
of the script still exited 0 — because on a clean tree the exit code is 0 either way. Neither
`invisible-control-chars.test.mjs` nor `ci-local-install-guard.test.mjs` contained the word
`spawn`; both import the module and exercise `evaluateTree`, `scanBuffer`, `classifyPath` and the
byte tables. None of them can observe an exit code, because an exit code does not exist inside the
module.

Measured against a throwaway git tree holding one file with a planted 0x08, the mutant printed
**both halves at once**:

```
--- stdout ---
invisible control characters: PASS (1 text files scanned, 0 raw control bytes)
--- stderr ---
invisible control characters in 1 file(s):
  scripts/planted.mjs:1:19  BS
--- exit status: 0 ---
```

So the `policy` step would have gone GREEN on a dirty tree while naming the violation on screen.
That is the repository's own "a check that nothing runs is not a check", one layer down: the
library was checked, the executable never was, and the executable is what CI invokes.

### ★ Why the library tests could not have caught it, in principle

This is not an oversight that more library tests would fix. The defect lives in the two lines
between "the library computed the right answer" and "the process told the operating system about
it". A test that imports the module has no process boundary to observe, so the ONLY instrument
that can see this is a subprocess with a status code. Import-only coverage of a CLI is a
structural blind spot, not a thin spot.

### What changed

`invisible-control-chars.test.mjs` gained one test that spawns the real script three times over a
throwaway git repository (one `git init`, ~250 ms total) and asserts the exit STATUS each time:

| fixture | expected | what it pins |
|---|---|---|
| a planted raw 0x08 | exit **1**, the file+`BS` named on **stderr**, and `PASS` absent from stdout | the mutant above |
| the same line written `\b` (two characters) | exit **0**, `PASS` on stdout | the POSITIVE CONTROL — without it a red is not a verdict about the byte, only about the harness |
| an unclassified `.rb` | exit **1**, `DEFAULT-DENY` on stderr | the second disjunct of the same `if`, which a narrower mutant drops |

The fixture must be a git repository: `listTrackedFiles` follows the index, so pointing `--root`
at a plain directory would scan zero files and pass vacuously — the same failure in a new costume.

**Four mutants observed RED against the new pin** (all previously green): delete `process.exit(1)`;
drop the `|| unclassified.length > 0` disjunct; make the exit unconditional (caught by the positive
control, not by a negative one); and break `invokedDirectly` so `main()` never runs.

---

## E6-F019 — the `invokedDirectly` conditional this PR ADDED could turn `scripts/ci-local.mjs` into a silent no-op that exits 0 with no output — RESOLVED

**Status:** resolved
**Severity:** LOW-MEDIUM — `ci-local.mjs` is a developer runner, not a CI lane, so no gate depends
on it. It is filed anyway because the failure mode is the one this programme keeps paying for: a
tool that returns the success code having executed nothing, which reads to its operator as "your
tree is clean".
**Filed and resolved:** 2026-09-08 (W19 round 2). **This hole did not exist before this PR** — it
was opened to make E6-F016's pin possible, and is closed in the same change.

### What was wrong

`main()` in `scripts/ci-local.mjs` used to be unconditional. Exporting `parseJobs` so the pin could
call the REAL parser (rather than re-implement it, which cannot catch a parser regression) required
guarding the call:

```
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

That conditional is a new place for a regression to hide, and the mutation pass proved it. Drop the
`fileURLToPath` call — a plausible refactor, since the two sides look comparable — and the predicate
compares a filesystem path to a `file://` URL, which is false on every platform forever. Measured:

```
$ node scripts/ci-local.mjs --list   ->  exit 0, zero bytes of output
$ node scripts/ci-local.mjs          ->  exit 0, zero bytes of output
$ node --test scripts/lib/__tests__/ci-local-install-guard.test.mjs  ->  5/5 pass
```

All five tests imported the module; none ran the script.

### What changed

Two tests, both spawning the real entry point, ~75 ms combined:

- `--list` from the repository root: exit **0**, and — the assertion that matters — the stdout must
  actually contain `jobs in pr.yml:`, name six real jobs from the workflow, carry at least ten job
  lines, and print `INSTALL_SKIP_REASON` **verbatim**. Status alone cannot distinguish "ran and
  passed" from "never ran": the mutant returns 0 too. Output is the only discriminator.
- run from an empty directory: exit **2** with `no workflow at …` on stderr and nothing on stdout,
  pinning `main()`'s other exit code against the same deletion E6-F018 describes.

`--list` is chosen because it is the only invocation that reaches `main()` without executing a CI
job — a real `node scripts/ci-local.mjs` run is the fast gate and takes minutes, a cost this suite
may not impose — while still exercising `existsSync`, `readFileSync`, `parseJobs`, the
`CANNOT_RUN_HERE` table and the deviation reporting.

**Three mutants observed RED** (all previously green): the `invokedDirectly` no-op (reds BOTH
tests); deleting `process.exit(2)`; and — from E6-F018's pass — the same class on the sibling script.

### ★ The class, and the census of it in this change

Two of sixteen mutants surviving is a class, not a pair, so the rest of the PR was swept for the
same shape. Of the seventeen files it touches, exactly **two** contain an entry point
(`#!`/`import.meta.url`/`main()`): these two scripts. The others are prose, data manifests, or
escape rewrites inside libraries. A third entry point — the `pr.yml` step itself — was tested by
deleting its whole `run:` body: `check-guard-inventory.mjs` exits 1 with *"declared 'ci' but no
workflow invokes it"* and `check-execution-census.mjs` exits 1 with `not_named_in_step` for both
test files. That wiring was already pinned; the two script entry points were the whole gap.

## E6-F020 — the invisible-character guard's OWN documented gap recurred within hours, and its stated reason for leaving the gap open ("no repair exists") is refuted by the repair made here

**Status:** `resolved` · **Severity:** MED · **Owner:** `unowned` (at filing; closed by ruling, not
by an owner)
**Filed:** 2026-09-08, by SVC-002 design review (branch `replatform/svc-002-design`), against work
done in the same PR that hit it.
**RESOLVED 2026-09-09 by founder ruling, via resolution option 2 (§4), NOT option 1.**

> ★★★ **THE RULING, and the principle that decides it.** The guard is **NOT widened** — ZWSP, NBSP
> and BOM stay legal. What was wrong was the guard's *description of itself*, and that is what was
> repaired.
>
> The guard's rule is **"ban the raw byte, permit the ESCAPE."** That rule can only be applied
> where an escape can be written — and **inside a block comment there IS no escape, only a
> REWRITE.** So the byte scan covers the **ACCIDENT class** (a shell injecting a C0 byte, which has
> shipped here three times and which the scan is complete against) and **not the AUTHORED class**
> (a human typing an invisible codepoint on purpose). Those are different classes with different
> remedies; the byte scan was never a candidate for the second. That boundary is now stated in the
> header as **deliberate scope, not a known hole**.
>
> The one ZWSP found in practice was **load-bearing** (§1: deleting it stops the file parsing), which
> is what makes this a scope question rather than a hygiene one.
>
> **The rewrite recipe is now recorded in both places** (`scripts/check-invisible-control-chars.mjs`
> header, `scripts/lib/__tests__/invisible-control-chars.test.mjs` `THE DOCUMENTED LIMIT`): *convert
> the block comment to `//` line comments* — line comments have no terminator, so a star followed by
> a slash is written literally and no invisible character is needed. That is the four-character
> repair §2 item 2 demonstrated, and the next author now finds it instead of reaching for a ZWSP.
> Both narration sites were also corrected on the two claims this finding refuted: **"2 uses"** no
> longer reads as a fixed grandfathered set (it is a **recurring pattern**), and **"no escape-based
> repair exists"** no longer stands in for **"no repair exists"**.
>
> **Option 1 was considered and REFUSED, not deferred:** banning ZWSP/NBSP/BOM without a rewrite for
> every legitimate use is the cry-wolf failure that gets a guard switched off — which is strictly
> worse than a stated boundary. §4's option-1 text is retained below as the recorded path if it is
> ever revisited.
>
> **What this ruling does NOT claim.** The residual in §2 is unchanged and still true: one
> zero-width space still evades this guard, it is still not a security boundary against a deliberate
> adversary, and nothing counts the authored class. The ruling changes what the repository *says*
> about that, not what it *catches*.


**Affected tickets:** none on disk. See "Why `unowned`".
**Blocks gate:** no. Nothing is currently mis-enforced; the character is gone and the file's 24 tests
pass.

### 1. What happened, and the first draft of this finding got the cause wrong

`scripts/check-threat-control-audit-debt.test.mjs:97` shipped a **U+200B ZERO WIDTH SPACE** inside a
JSDoc comment, between the `*` and the `/` of a glob path:

```
/** An id no `docs/replatform/epics/*<U+200B>/tickets/` file can ever start with, so "not on disk" …
```

**It was not a stray keystroke.** Delete the ZWSP and the file **stops parsing** — `*/` closes the
block comment, and `node --test` fails with `SyntaxError: Unexpected identifier 'findTicketIds'`.
The character was load-bearing. It is therefore a third instance of **exactly the use
`check-invisible-control-chars.mjs` counted and excused**: *"U+200B ZWSP (2 uses — one writes a
close-comment sequence inside a JSDoc block, which cannot be expressed as an escape because it is a
comment)."*

That is recorded because the first draft of this finding said the character *"was introduced while
writing the comment"*, framing it as an authoring slip. **That was wrong, and it was refuted by
running the file rather than by reading it.** The correct statement is narrower and worse: the
guard's documented exception is not a fixed set of two grandfathered sites, it is a **recurring
pattern** — anyone writing a glob or a regex inside a JSDoc block reaches for it — and nothing in
the repository counts it, because it is invisible by construction.

**The repair, which is the load-bearing part.** The comment is now a run of `//` line comments, which
have no terminator, so the glob is written literally and no invisible character is needed. The file's
24 tests pass. The guard's parenthetical *"cannot be expressed as an escape"* is true and is **not
the same claim** as "no repair exists": a rewrite repair exists, costs four characters, and is the
one the guard's own design constraint asks for (*"the repair for a legitimate use is a rewrite that
denotes the identical character. Nothing is ever deleted."*).

**Scan of the whole PR**, by codepoint, over all changed files
(`docs/architecture/distributed-execution-audit-debt.json`, `SVC-002-design.md`,
`SVC-002-terrain.md`, `scripts/check-threat-control-audit-debt.test.mjs`, and this register plus
`docs/replatform/epics/E9-service-agents/findings.md`):

| Codepoint | Count before | Count after |
|---|---|---|
| U+200B ZWSP | **1** | 0 |
| U+00A0 NBSP | 0 | 0 |
| U+FEFF BOM | 0 | 0 |
| U+2028 LS | 0 | 0 |
| U+2029 PS | 0 | 0 |
| U+0085 NEL | 0 | 0 |
| U+2060 WJ | 0 | 0 |
| U+180E MVS | 0 | 0 |

One character, one file, one line. It was found by an explicit codepoint scan, not by review and not
by CI.

### 2. ★ Why this is a finding and not a typo

`scripts/check-invisible-control-chars.mjs` bans raw **C0/DEL bytes** and states, in its own header,
that this set does not:

> *"STILL LEGAL, DELIBERATELY (legitimate uses found, and no escape-based repair exists for some of
> them): U+200B ZWSP (2 uses …), U+00A0 NBSP (4 uses …), U+FEFF BOM (3 files). … the residual is
> real and is stated rather than papered over: anyone who WANTS to hide a character in this
> repository can still do it with one zero-width space."*

That limit is pinned by a **passing** test —
`scripts/lib/__tests__/invisible-control-chars.test.mjs:224-241`,
*"★ THE DOCUMENTED LIMIT: ZWSP, NBSP and BOM still evade this guard, on purpose"* — which asserts
that a ZWSP produces **zero** violations, and whose comment says: *"If that ever needs to change, the
change is to ban ZWSP/NBSP and repair the six legitimate uses; this test is the place that decision
gets recorded."*

**So the gap was measured, documented and pinned — and the very use it excused recurred within
hours, in a new file, without anybody deciding to use it.** Two things follow, and they are the whole
content of this finding.

1. **The census is not a fixed set.** *"2 uses"* reads like two grandfathered sites to be repaired
   once. It is not: it is a pattern that regenerates whenever someone writes a glob or a regex
   inside a JSDoc block, and **nothing counts it**, because the character is invisible in every
   terminal, editor, diff view and code-review UI. This instance was found by an explicit codepoint
   scan run for an unrelated review — not by CI, not by a reader, and not by the author.
2. **"No escape-based repair exists" is not "no repair exists", and the difference decides the
   question.** The header's parenthetical is literally true — an escape cannot appear in a comment —
   and it is doing the work of a much stronger claim in the decision to leave ZWSP legal. The repair
   in this PR is four characters: `/** … */` becomes `// …`, the glob is written literally, and the
   file's 24 tests pass. If that generalises to the other ZWSP site, option 1 below is materially
   cheaper than the guard's own note assumes.

### 3. What is deliberately NOT done here

**The guard is not widened in this PR.** The PR is a design document for service reconciliation;
widening a repository-wide policy guard inside it is exactly the smuggling this programme's registers
exist to prevent — and it would be the second time in two waves that a policy change rode a ticket
about something else. The cost is also not zero: the guard's census found **six legitimate uses**
(2 ZWSP, 4 NBSP) plus 3 BOM files, and each needs a rewrite, not a deletion — *"a checker whose only
remedy is deletion gets deleted itself"* is that guard's own founding constraint. Banning without an
answer for every one of them is the cry-wolf failure that gets a guard switched off.

### 4. Why `unowned`, and what would close it

`unowned`: no ticket on disk owns the invisible-character guard's scope. E6-F017/F018/F019 (its
ancestors) are all RESOLVED, and naming a shipped ticket would be the false-ownership claim E4-F013
exists to refuse. NOT `accepted`: accepting would re-assert the rationale this occurrence is evidence
against, and the decision is a real one with a real cost, not a nit.

**Resolution — one of these two, decided deliberately.** ★ **DECIDED 2026-09-09: option 2. See the
ruling block at the head of this finding.** Option 1 is retained below as the recorded path if the
decision is ever revisited; it was refused, not deferred.

1. Add U+200B / U+00A0 (and a BOM rule) to `BANNED_CODEPOINTS`, repair the remaining legitimate uses
   the way this PR repaired its own (block comment → line comments; the rewrite, not an escape), and
   **invert** the `THE DOCUMENTED LIMIT` test so it asserts the ban with a positive control; or
2. Record, with reasons, that the residual stays open — and amend the guard header and that test so
   the census reads as a **recurring pattern with a known rewrite**, not as two grandfathered sites
   with no repair.

Either way, flip this Status and DELETE the `scripts/finding-ownership.json` key in the SAME commit.

---

## E6-F021 — the D1 gate lane has been RED since 2026-09-15 on a DELETED upstream image, and the consumer built to report exactly that went silent because the red aged out of its lookback window

**Status:** `resolved` · **Severity:** HIGH · **Owner:** `unowned` (at filing; both halves repaired
in the filing commit)
**Filed:** 2026-09-20, by the re-platform reconciliation/grooming pass, measured at `4df71dada`.

★★★ **AMENDED 2026-09-24 — the quay.io row in the table below is now FALSE, and the repair
it justified has failed the same way a second time.** The table records
`quay.io/v2/minio/minio/manifests/RELEASE.2025-09-07T16-13-09Z` returning **200** on 2026-09-20.
That measurement was true when made and is left in place unedited. Re-measured 2026-09-24, with
controls on both registries:

| registry | request | result |
|---|---|---|
| quay.io | `GET /v2/minio/minio/manifests/RELEASE.2025-09-07T16-13-09Z`, pull-scoped token (801 chars, acquired OK) | **401** |
| quay.io | `GET /v2/minio/minio/manifests/latest`, same token flow | **401** |
| quay.io | the repository API | `"Requires authentication"` |
| quay.io | **control** `GET /v2/prometheus/busybox/manifests/latest`, anonymous | **200** |
| Docker Hub | `GET /v2/minio/minio/manifests/{that tag, latest}` | **401**, **401** |
| Docker Hub | **control** `GET /v2/library/busybox/manifests/latest` | **200** |
| mirror.gcr.io | `GET /v2/minio/minio/manifests/{that tag, latest}` | **404**, **404** |
| dl.min.io | `HEAD /server/minio/release/linux-amd64/minio` | **410 Gone** |
| GitHub releases | `minio/minio` latest release | tag exists, **0 binary assets** |

The controls are what make this a REPOSITORY closure rather than a registry outage: both
registries are up and both anonymous token flows work. **Both documented sources for this image
are unavailable, and there is no public route left to the upstream image.** Nine D1 dispatches over
~2.5 hours died at *Bring up the D1 stack* before a single test ran, blocking every D1 campaign and
therefore M1a.

★ **The lesson is not "pick a better registry".** The original repair replaced one third party's
registry policy with another's, and bought nine days. The class is *a gate lane whose bring-up
depends on a third party's decision to keep serving an image*, and it is now fixed at the class:
`docker/d1/minio.Dockerfile` + `.github/workflows/d1-image-mirror.yml` MIRROR the image into this
organisation's own GHCR, and `docker-compose.d1.yml` pins
`ghcr.io/meteoritelabs/aoa-d1-minio` **BY DIGEST** — because a tag we own is still a tag. The mirror
BUILDS MinIO from upstream source at `RELEASE.2025-09-07T16-13-09Z`, the release the lane was
already pinned to, and runs it on Debian, so the compose service is byte-for-byte unchanged: root
(for the `/root/.minio/certs` DAT-002 slice-7 bind), `curl` (for the healthcheck), ENTRYPOINT the
binary (for the existing `command:`).

★ **It builds from source rather than re-homing a public third-party BUILD, and that was measured,
not preferred.** The first cut did re-home one; every such build is `:latest`-only, so it carried
`RELEASE.2026-09-22T19-25-18Z`, and run `36022608037` brought the stack up and then failed `E6F-05`
and `E6F-14` with `400 AccessDenied: There were headers present in the request which were not
signed` on the presigned PUT. A newer MinIO is stricter about presigning, so **the version is not a
free variable** — the upstream source tag is public even though every built image of it is gone. The
sibling third-party refs were swept and are all still anonymously pullable
(`pgvector/pgvector:pg18`, `ghcr.io/shopify/toxiproxy:2.9.0`, `node:lts-trixie-slim` — 200 each);
the outage class is MinIO-only.

★ **Nothing was made quieter.** No service was dropped, no pull failure was made non-fatal, and no
healthcheck was relaxed. A lane that skipped MinIO would have converted a loud blocker into a
silent hole.

Evidence: `docs/replatform/epics/E6-deployment-test-harness/tickets/E6-F021-mirror-result.md`.

### The lane

`d1-merge-train.yml@docs/replatform-program` — the lane that CONSTITUTES the `E6-D1-FOUNDATION`
gate — concluded `failure` on **2026-09-15** (run `35017820850`) and again on **2026-09-17** (run
`35238458091`). Both died in the same step, *Bring up the D1 stack*, with the same line:

```
minio Error pull access denied for minio/minio, repository does not exist or may require 'docker login'
```

`docker-compose.d1.yml` defaulted the MinIO service to `${AOA_D1_MINIO_IMAGE:-minio/minio:latest}`
and **no workflow sets that variable**, so the default was always what CI pulled. Measured the same
day, with a positive control:

| registry | request | result |
|---|---|---|
| Docker Hub | `GET registry-1.docker.io/v2/minio/minio/manifests/latest` with an anonymous pull token | **401** |
| Docker Hub | `GET hub.docker.com/v2/repositories/minio/minio/tags` | `{"message":"object not found"}` |
| quay.io | `GET quay.io/v2/minio/minio/manifests/RELEASE.2025-09-07T16-13-09Z` with a pull-scoped token | **200**, `manifest.list.v2+json` (multi-arch) |

This is an UPSTREAM deletion, not a repo regression: MinIO's Docker Hub repository is gone. It was
also the ONLY `:latest` image reference in the file, against sibling third-party images that are
tag-pinned (`pgvector/pgvector:pg18`, `ghcr.io/shopify/toxiproxy:2.9.0`).

### Why nobody saw it — the half that matters

DEP-013 exists so that *"a red verdict nobody consumes"* cannot happen again, and
`d1-merge-train.yml@docs/replatform-program` is declared in
`scripts/workflow-verdict-manifest.json` as **THE CHARTERED STREAM**. The consumer was alive and
publishing — issue #358 was reconciled at 2026-09-20T08:16 and listed two findings — **and the red
D1 lane was not one of them.**

`evaluateCoverageStream` finds the newest commit matching the lane's `paths:` filter and evaluates
the run covering it. `scripts/reconcile-workflow-verdicts.mjs` fetches only `COVERAGE_WINDOW = 40`
heads. The newest `docker/**`-matching commit was `ceb6f2c45` (2026-09-17) with **105 commits
since**, so `targetIndex` was `-1` and the evaluator returned `null`. The collector even logged
*"silent (window exhausted)"* — and that log reached no reader.

★★★ **So the lane went red, then stopped being triggered, and therefore disappeared from the guard
written to stop precisely that.** [[E6-F010]] and GO-BOOK §1.9.8 record the previous instance of
this class; this is the same class reproduced one layer inside its own detector.

### Repair — both halves, in the filing commit

1. **The lane.** `docker-compose.d1.yml` now defaults to
   `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` (MinIO's own registry, dated tag, verified
   200/multi-arch above). `scripts/check-d1-compose.test.mjs`'s fixture is aligned.
2. **The blind spot.** `evaluateCoverageStream` gains an `unread_failure` arm
   (`unreadFailure` in `scripts/lib/workflow-verdict.mjs`): when nothing is owed, it stays silent
   **unless** the stream's newest completed run did not succeed. It cannot manufacture an
   incident nobody can close — it speaks only when a run really completed and really failed, so
   "fix or re-run the lane" is always the repair. Raising `COVERAGE_WINDOW` was considered and
   **rejected**: it moves the cliff rather than removing it, and the cliff is what hides the red.

★ **The arm requires a NON-EMPTY commit history, and that is load-bearing.** An unfiltered lane
matches every commit (`commitMatchesPaths(c, []) === true`), so the only way to reach the arm with
no `paths:` filter is an empty `commits` list — which the real collector never produces. Firing on
`[]` would make coverage mode report a dead SCHEDULE, which is cadence's job and is the §5.2
separation the suite pins (*"coverage cannot see a dead schedule"*). That test caught this during
the build and the arm was narrowed rather than the test relaxed.

**Positive control + mutant** both ship in `scripts/lib/__tests__/workflow-verdict.test.mjs`: the
control asserts the measured 2026-09-17 shape now reports `unread_failure`, and the mutant restores
the bare `return null` and observes the silence. Suite 44/44.

### Not claimed

The repair makes the lane PULLABLE and the red REPORTABLE. It does **not** assert that
`d1-merge-train` is green — the lane has not run on a fixed compose file at filing time, and its
next run is the evidence. If it reds for a different reason, that is a new finding, not this one.

---

## E6-F022 - the epic's ticket-range claim asserted DEP-011 shipped, and DEP-011 has no result doc

**Status:** open
**Severity:** LOW (record-truth; no code claim rests on it today)
**Filed:** 2026-09-21 (M0 unit 7, the disposition-A audit), measured at `169be1f2c`.

**What.** `README.md`'s status line read *"all tickets DEP-000 through DEP-013 shipped"*. That is a
RANGE claim, and a range includes every id inside it. `docs/replatform/epics/E6-deployment-test-harness/tickets/`
holds `DEP-011-design.md` and **no `DEP-011*-result.md`** - the only DEP id in the range with a
design and no ledger.

★ **It is not that DEP-011 did nothing.** Its mint/worker/reaper slices have their own records
elsewhere in the programme's history, and `scope-triage.md` splits the ticket: the **record half**
is disposition A and the **remaining deploy half** is `TO FILE, scope unestablished` and belongs to
`M1a`. What is wrong is a blanket range sentence asserting a shipment the epic's own `tickets/`
directory cannot evidence.

**Disposition.** The range sentence is narrowed in place to say so; the ticket is not re-opened and
no result is invented for it. `M1a` Step 0 still owes the deploy half's ticket, and that obligation
is unchanged by this finding.

**Blocks gate:** no.

---

## E6-F023 - cross-platform-weekly's run conclusion is blind to every job it declares advisory, and the DEP-013 consumer reads that conclusion

**Status:** resolved (2026-09-21, option 3 implemented on `docs/replatform-program`; the `@main` stream changes only at M5 — see Resolution)
**Severity:** MEDIUM (a false GREEN, which is worse than a red: it is indistinguishable from health)
**Filed:** 2026-09-21 (M0 unit 2), measured on run `35530935808`.

**What.** Every job in `cross-platform-weekly.yml` carries `continue-on-error: true`, so a failing
job does not fail the run. The DEP-013 consumer keys on the **run conclusion**
(`workflow-verdict.mjs`, `not_success` when the latest completed run did not conclude `success`), so
the consumer cannot see an advisory job's failure at all.

**Measured, not reasoned.** Run `35530935808` concluded **`success`** while **8 of its 12 jobs
failed** - all four macOS and all four Windows test shards. `verify-cross-platform` and
`e2e-cross-platform` were green on both platforms. A consumer reading that run reports the lane
healthy.

★★★ **AND M0 UNIT 2 IS WHAT MADE THIS VISIBLE, BY REMOVING THE THING THAT WAS MASKING IT.**
Before that unit the lane died on a 25-minute timeout, and a timed-out job concludes `cancelled`,
which **does** propagate to the run regardless of `continue-on-error`. So the lane read red - for
the wrong reason, but red. With the timeout gone, the same lane reads green while its tests fail.
That is a REGRESSION IN SIGNAL HONESTY produced by a repair, and it is recorded here rather than
banked, because "the lane is green now" would be the exact false-enforcement claim this programme
exists to stop.

★ **The advisory intent is not in dispute.** Linux is the required platform and these jobs are
deliberately non-blocking; nothing here argues they should gate a merge. The defect is narrower: a
job that may fail without consequence still owes a VERDICT someone can read, and today its failure
is invisible to the only consumer that reads this lane.

### The options, none of which M0 chose

1. **Drop `continue-on-error` from the test jobs.** The run then concludes `failure` and the
   consumer reports it honestly - but the lane goes red until cross-platform test health is fixed,
   which is a larger piece of work than lane health.
2. **Keep it and give the consumer a job-level reader.** `workflow-verdict.mjs` would need to read
   job conclusions, not just the run's. That widens DEP-013's contract.
3. **Split advisory from verdict-bearing.** Let the jobs that CAN be green today
   (`verify-cross-platform`, `e2e-cross-platform`) be verdict-bearing and leave the test shards
   advisory, so the lane reports on what it can actually assert.

Option 3 is the one that makes the lane's verdict mean something without blocking on test health,
but choosing is a gate-owner decision about what this lane asserts, not a repair.

**Blocks gate:** no. It does, however, mean a green `cross-platform-weekly` must not be cited as
cross-platform TEST health until this is resolved.

### Ruling — 2026-09-21, gate owner: **option 3**

Split advisory from verdict-bearing. `verify-cross-platform` and `e2e-cross-platform` become
**verdict-bearing** (no `continue-on-error`), so the run concludes `failure` when either fails; the
test shards stay **advisory**. The lane then asserts only what it can assert today, without going red
on cross-platform test health, which is a larger piece of work tracked separately.

★ **Implementation must also close the install bypass.** ★ *Corrected 2026-09-21 (Codex, PR #526):* the `Install Playwright`
step in `e2e-cross-platform` is itself `continue-on-error: true`, and the config and e2e steps run
only `if: steps.install-playwright.outcome == 'success'`. Removing only the job-level flag would
leave the job **green with no e2e run** whenever the install fails. So an install failure must fail
the job, either by dropping the step-level flag or by adding an explicit failing step after it. The
acceptance adds a control for this: a failed install concludes the job `failure`. **Also:** on
`windows-latest` the e2e step never runs (Issue #114, embedded-postgres), so a green Windows
`e2e-cross-platform` asserts only setup and build parity, and the finding must say so when it
resolves.

★ **Status stays `open` until the workflow change lands** — a ruling is not a repair.

★ **Where it takes effect.** This lane's `schedule` trigger runs only from `main`, and the program
branch reaches `main` only at the program integration checkpoint (`M5`). So a change landed on
`docs/replatform-program` does not alter the `cross-platform-weekly.yml@main` stream before then. It
**can** be verified on the program branch by `workflow_dispatch`: the acceptance is a dispatched run
whose **run** conclusion is `failure` when a verdict-bearing job fails and `success` only when both
pass — with a positive control that a failing **advisory** shard alone leaves it `success`.

★ Until then the rule above stands: a green run of this lane is not evidence of test health.

### Resolution — 2026-09-21, option 3 implemented and verified against controls

**Change** (`.github/workflows/cross-platform-weekly.yml`, commit `31a4ef91f`):

| Job | Before | After |
|---|---|---|
| `verify-cross-platform` | `continue-on-error: true` | **no flag — verdict-bearing** |
| `e2e-cross-platform` | `continue-on-error: true` | **no flag — verdict-bearing** |
| `test-cross-platform` | `continue-on-error: true` | **flag kept — advisory, deliberately** |
| `Install Playwright` step | `continue-on-error: true` | **no flag — the install bypass is closed** |

★★★ **The install bypass was the half a job-level fix alone would have missed.** Every later e2e
step is gated on `steps.install-playwright.outcome == 'success'`, so with the step flag in place a
failed install SKIPPED the config and e2e steps and the job concluded GREEN having run no browser
test. Control 4 below proves that path is now red.

**Verified by `workflow_dispatch`, four controls, every failure attributed to its causal STEP rather
than just its job.** Each dispatch used a distinct ref, so `cancel-in-progress` could not cancel one
with another.

| # | Control | Run | Job(s) | Causal step | Asserted | Observed |
|---|---|---|---|---|---|---|
| 1 | clean — the implementation branch | `35569301716` | verify mac + win, e2e mac + win | — | run `success` | **run `success`** |
| 2 | advisory — sabotage shard 1 on both OSes | `35569308695` | `test-cross-platform (macos-latest, 1)` `106237378419`; `(windows-latest, 1)` `106237378400` | `SABOTAGE advisory control` → `failure` | run **`success`**, those jobs `failure` | **run `success`**, both jobs `failure` |
| 3 | verdict — sabotage `verify-cross-platform` | `35569315154` | `verify-cross-platform (macos-latest)` `106237398790`; `(windows-latest)` `106237398822` | `SABOTAGE verdict control` → `failure` | run **`failure`** | **run `failure`** |
| 4 | install bypass — bogus browser name | `35569315154` | `e2e-cross-platform (macos-latest)` `106237398865` | `Install Playwright` → `failure`; `Generate AoA config`, `Run e2e tests`, `Upload Playwright report` → **skipped** | job **`failure`**, not green-with-skips | **job `failure`** |

★ **One limit, stated rather than blurred.** Controls 3 and 4 were folded into one run, as the brief
permitted. That run's `failure` is therefore jointly caused — `verify` AND `e2e` both failed — so
it does not by itself ISOLATE `verify`'s contribution to the run verdict. What is observed is that
`verify` concludes `failure` on sabotage. That this alone is sufficient to fail the run is inferred,
not isolated: from the parsed YAML (`verify-cross-platform` carries no `continue-on-error`), and from
controls 1 and 2, which show that failing advisory shards — three in control 1, five in control 2 —
leave the run `success`, so only the flag-less jobs can move it.

★ **Advisory noise, recorded because it is real.** Control 2's `test-cross-platform (macos-latest,
2)` failed on `Run tests (shard 2/4)` — a genuine test failure, not the sabotage (whose step was
`skipped` there by `if: matrix.shard == 1`), on a shard that passed in control 1. It is advisory,
does not bear on any assertion above, and is the same cross-platform test-health class as `E5-F005`
and `E3-F039`.

### What a green run of this lane now means — and what it still does not

A green **run** now means: both platforms typecheck and build, macOS passes the browser suite, and
Windows installs Playwright. It does **not** mean the unit-test shards passed — they are advisory and
visible only per job.

- **Windows e2e asserts build parity only.** On `windows-latest` the e2e step never runs (Issue #114,
  embedded-postgres cannot start under `runneradmin`), so a green Windows `e2e-cross-platform` job
  proves setup, build and the Playwright install — nothing about browser behaviour.
- **A Playwright CDN stall now turns the e2e job red.** These lanes lack the required Linux lane's
  Chrome-for-Testing fallback, so a stall means the browser suite genuinely did not run. Accepted
  deliberately: a red job says that honestly, where the old flag said nothing.

### Where it takes effect

On `docs/replatform-program` now. **Not** on the `cross-platform-weekly.yml@main` stream: GitHub runs
`schedule` only from `main`, which the program branch reaches only at the program integration
checkpoint (M5). Until then `@main` executes the old workflow, where every job still carries the flag
— so a green `@main` run still means nothing. That stream is recorded **blocked on M5, owned by the
founder (gate owner)** in `scripts/workflow-verdict-manifest.json`, where the DEP-013 consumer reads
it.

### Which guard enforces the new shape: none

★★★ **Nothing prevents this regressing.** At source, the only `continue-on-error` assertions in
any guard are in `scripts/check-verdict-consumer-freshness.test.mjs` and they read
`verdict-reconcile.yml` and `pr.yml` — never `cross-platform-weekly.yml`. Re-adding the flag to
`verify-cross-platform` or `e2e-cross-platform`, or to the `Install Playwright` step, would silently
restore the false green and every guard would stay green. Stated plainly rather than implied: the
controls above prove the shape at `31a4ef91f`, and nothing proves it at any later revision.

★ **Enforcement added — 2026-09-21 (M1 plan §3, S0-5(a)).** The paragraph above was true when
written and is kept as written. The shape is now enforced by `scripts/check-cross-platform-verdict-shape.mjs`
(pure logic in `scripts/lib/cross-platform-verdict-shape.mjs`, symbol `evaluateCrossPlatformVerdictShape`),
run in `pr.yml`'s `policy` job, step "Cross-platform lane verdict-bearing shape (E6-F023)", with its
self-test `scripts/check-cross-platform-verdict-shape.test.mjs`. It reds on a job-level
`continue-on-error` on `verify-cross-platform` or `e2e-cross-platform`, on a step-level flag on any
step of those jobs (`Install Playwright` included), and when either job or the `Install Playwright`
step cannot be found. `test-cross-platform` may keep its flag. It reads the program-branch file only;
it says nothing about the `cross-platform-weekly.yml@main` stream, which stays blocked on M5.


## E6-F024 - an adapter-manager provider-op failure was undiagnosable: the leak fence dropped the cause with the text

**Status:** resolved (2026-09-21, in the DEP-015 follow-up PR that files it)
**Severity:** MEDIUM. It masks, rather than causes, a failure, but it made the first keyed shipped-boot run's failure unattributable from the logs.
**Filed:** 2026-09-21. Measured on keyed shipped-boot run `35601445269` (candidate `fc2eb7dde`), job `shipped-boot`, step "Run the journey".

**What.** Both enabled tenants failed at `stage_files`.
- The worker logged `WireProtocolError … (adapter-manager provider operation failed)`.
- The adapter-manager logged **nothing** about the operation, only boot and reaper sweeps.

The cause was a missing network and CA on the adapter-manager, which redeems grants in-process through `fetchGrantBytes`. It had to be found by reading source.

**Why the fence produced this.** `createProviderServer` (`packages/adapter-manager/src/server.ts`) maps every unmodelled error to one fixed `WireProtocolError` ([Cred-2], DEP-012 Slice 4+5). That is correct: an SDK or fetch error can carry a provider key, a presigned URL or a grant header. But it dropped the *cause* along with the *text*, and it logged nothing. So every failure — DNS, TLS, refused connection, HTTP status, digest mismatch — read the same on both sides.

**Resolution.**
- `packages/adapter-manager/src/op-failure-classification.ts` (`classifyOpFailure`) derives a classification from a **closed vocabulary only**:
  - op (a known set);
  - error class (a known set, else `other`);
  - cause (`dns|tls|connect|timeout|http_status|fetch_failed|digest_mismatch|size_exceeded|unclassified`);
  - error code (a known set);
  - HTTP status.
- No message text is ever copied out. Messages are only matched against fixed patterns.
- The server logs the classification (a new `onOpFailure` option; the default is one `console.error` line) and appends it to the fixed wire message, for example `adapter-manager provider operation failed (op=stage_files class=TypeError cause=dns code=ENOTFOUND)`. The worker already logs that message.
- The [Cred-2] fence is otherwise unchanged. Modelled classes still pass as-is, and unmodelled text still never crosses.

**Proof.** `packages/adapter-manager/src/__tests__/op-failure-classification.test.ts` drives the REAL default grant redemption through the REAL gated server and wire driver, in four cases: a refused connection, an untrusted TLS certificate, an unresolvable host and a 403. Each case asserts two things:
- **The classification arrives:** it is logged and carried to the worker.
- **Nothing leaks:** neither the log nor the wire nor the worker's rejection carries the URL, its host, an `X-Amz-Signature` canary or a grant-header canary.

A default-sink case covers the log itself. Pure cases pin the fallbacks:
- a secret-bearing class name falls to `other`;
- a secret-bearing code is dropped;
- a secret-bearing message is not copied;
- a non-Error throw is classified, not stringified;
- a cyclic cause chain terminates.

Run against the pre-fix `server.ts`, the five wire cases fail (RED) and the four pure ones pass. With the fix, all nine pass, and the whole adapter-manager suite passes: 169 tests in 19 files.

---

## E6-F025 - the DEP-017 env probe cannot see a control-plane MIS-RESOLUTION of a tenant's provider key, and the keyed lane shares one key across tenants so the case is invisible by value

**Status:** `open` - Owner: `unowned`
**Severity:** MEDIUM
**Filed:** 2026-09-23, by the `DEP-017` build, from the Codex review of PR #565; disposition ruled by
the M1 planning session under founder delegation **F2** - *file it, do not build it*.

**The property, stated precisely.** The live env-absence probe
(`packages/worker-daemon/src/supervisor/env-probe.ts`) detects, inside a real distributed sandbox:

- any credential class of the section-9 taxonomy present under any name, POSIX or not;
- a FOREIGN tenant's credential by VALUE, under ANY name including an allowed one, because the
  lane plants a per-tenant marked canary (`plantedTenantCanary`, `ENV_PROBE_CANARY_MARKER`) whose
  Organization the probe compares against the run's own;
- an allowed provider-auth name the run did not redeem (`unredeemed_provider_credential`);
- a value under an allowed name that is not the one THIS WORKER REDEEMED
  (`provider_credential_value_mismatch`, a salted per-run digest comparison).

**What it CANNOT see.** A control-plane **mis-resolution**: a redemption that hands this run a
legitimate-looking credential belonging to another Company. The worker's expectation is derived from
`spec.env`, i.e. from whatever redemption returned, so a wrong value defines its own expectation and
the digest comparison passes. The marker check is what would catch it - and only when the leaked
value is one of the lane's planted canaries.

**Why it is invisible in the keyed lane today.** The shipped-boot journey seeds every enabled tenant
with the SAME repository `ANTHROPIC_API_KEY` (`scripts/m1-shipped-boot/journey.mjs`, the `seed`
phase), because only one such secret exists. For that credential the tenants' values are equal by
construction, so no value-based check - marker or digest - can separate them. The per-tenant marked
canary is saved as each tenant's OpenAI key, which `claude_local` never redeems, so the marker arm
is exercised by the in-sandbox planted control rather than by a real redemption.

**Closure routes (both outside `DEP-017`).**
1. **A company-scoped value fingerprint on the resolve reply.** The control plane mints, beside the
   value, a fingerprint bound to the owning Company (the resolve reply today carries `envTarget`,
   `value` and an optional owned-labels capability - `classifyResolveResponse`,
   `packages/worker-daemon/src/lease/secret-redemption.ts` - and nothing that binds the value to a
   tenant). The worker would then compare against an expectation it did not derive from the value.
   This is a server change plus a new reply field.
2. **Tenant-distinct exercised credentials in the keyed lane.** Give each enabled tenant its own
   real provider key, so a mis-resolution shows up as a value difference. This is a founder/ops
   action with cost (more provisioned keys), not an engineering change.

**Consequence for the M1a claim.** The `M1a` isolation claim built on criterion 5 EXCLUDES
control-plane mis-resolution of a tenant's provider key. It covers what a sandbox OBSERVES, not
whether the control plane resolved the right credential in the first place.

**Not `accepted`:** nobody has accepted the residual; it is filed so the gate record cannot read the
probe as broader than it is. Resolve = build route 1 or provision route 2, prove it with a
cross-tenant mis-resolution case, then flip this Status and delete the `E6-F025` key in
`scripts/finding-ownership.json` in the SAME commit.

## E6-F026 - the DEP-015 log-surface controls cannot join a key that is split ONE FRAGMENT PER JSON RECORD, on either surface

**Severity:** MEDIUM
**Status:** open
**Filed:** 2026-09-23, by the DEP-015 log-surface work from the Codex review of PR #574.

The lane's published-log redactor and its leak scan both judge a line, and both join each line to
the tail of the ones before so a key wrapped across lines still forms its marker. Framing that
sits INSIDE a line is removed first: the compose service prefix, a timestamp on either side of it,
and — since this finding's own PR — JSON punctuation and escaped whitespace (`base64Payload`). A
key carried in ONE JSON record, however it is wrapped inside that record's string, is therefore
caught on both surfaces.

**What is NOT caught:** a key split so that each JSON RECORD carries one fragment. Every record
contributes its own field names between the fragments (`{"level":30,"frag":"…"}`), so the fixed
DER prefix is never contiguous in the joined window, and at a narrow wrap no fragment reaches the
40-character base64-run rule either. Both surfaces then read clean. The limit is PINNED by a
KNOWN LIMIT test in `scripts/lib/__tests__/m1-shipped-boot.test.mjs`, which asserts today's
behaviour exactly — the fragments publish and the scan finds nothing — so it cannot be mistaken
for coverage.

**Why it is not closed here.** The two obvious closures are both wrong at this size:

- Parsing every log line as JSON and joining its string VALUES: the worker's logger is not the only
  producer on this surface, and a per-line parse that fails open would be the same gap with more
  code.
- A run-length rule inside the DER latch: measured against the lane's own captured worker logs
  (run 35613849443), ordinary lines already carry a 36-character UUID and a 21-character E2B
  sandbox id. Any threshold low enough to catch an 8-character fragment redacts the sandbox line —
  which is the line the lane's OWN sandbox-evidence assertion reads. The control would break the
  check it exists to protect.

**What it does NOT undermine.** No observed leak: review batch 3A measured both surfaces of run
`35619555883` clean for the whole keypair, and this lane never prints a key by design — the
controls exist for a key it did not generate. The registered-secret mask and scan are unaffected,
since they match by VALUE and not by shape.

**Not `accepted`:** nobody has accepted the residual; it is filed so the DEP-015 record cannot read
its log-surface control as broader than it is. Resolve = a producer-side rule (a logger that never
emits key material) or a framing-aware join with a measured threshold that provably leaves the
sandbox-evidence line intact, proven by a control that reds without it; then flip this Status and
delete the `E6-F026` key in `scripts/finding-ownership.json` in the SAME commit.

---

## E6-F027 - `embeddings-circuit.test.ts` asserts `nextRetryAt > Date.now()` against a clock read AFTER the product's, so a 1 ms backoff draw reds the required Linux `verify` gate on an unrelated PR

**Status:** `open` - Owner: `unowned`
**Severity:** LOW (one assertion, no product claim rests on it - but it is on a REQUIRED gate)
**Filed:** 2026-09-23 by the record custodian, from an observation on PR #576. Verified at source
before filing; the reporter's mechanism was checked and is corrected below.

**Observed.** `verify (3)` on PR #576 - a **records-only** commit, so nothing in the diff could have
caused it - failed with:

```
embeddings-circuit.test.ts
expected 1790182801260 to be greater than 1790182801260
```

Identical numbers: a strict `>` between two millisecond readings that landed on the same value. It
passed on re-run.

**The assertion.** `server/src/__tests__/embeddings-circuit.test.ts`, in
*"retries a transient error: status=pending, attempts bumped, next\_retry\_at set"*:

```ts
expect((retryUpdate.set.nextRetryAt as Date).getTime()).toBeGreaterThan(Date.now());
```

That `Date.now()` is evaluated **after** `svc.processQueue(...)` has already returned, so it is a
LATER reading than the one the product used to compute the value.

**★★★ THIS IS A TEST DEFECT, NOT A PRODUCT DEFECT, and the distinction is the point - the two have
different owners.** The product's invariant is real, deliberate and sound; the test asserts a
different, stronger one.

- **What the product guarantees.** `computeBackoffMs`
  (`server/src/services/embeddings.ts`) is **full jitter with a floor**:
  `Math.max(1, Math.floor(rng() * raw))`, where `raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS *
  2^(attempt-1))` and `BACKOFF_BASE_MS = 2000`. The floor carries its own reason in a comment -
  *"P2-2: clamp to >= 1ms so `rng()===0` never produces an immediately-eligible row (which would make
  the retry indistinguishable from a fresh attempt and could pin-ball a bad row in a tight loop)"*.
  So the product promises `nextRetryAt >= T + 1ms`, where **`T` is the instant the product itself read
  the clock**. It is strict monotonicity **against its own reading**, and it is correct.
- **What the test asserts.** `nextRetryAt > T'`, where `T' >= T` is a *later* reading. The product
  never promised that and does not need to. On the first attempt the draw is
  `max(1, floor(rand * 2000))`, which is **exactly 1 ms** on roughly one draw in two thousand; if at
  least 1 ms of wall clock also elapsed between `T` and `T'`, the assertion fails. Nothing is wrong
  with the code under test when it does.
- **Therefore: no product finding is owed.** Nothing in the product relies on strict millisecond
  monotonicity across two *separate* clock reads. If it did, that would be a real finding and would
  be filed as one - this was checked, and it does not.

**★ THE REPORTED MECHANISM IS CORRECTED: it does NOT get more likely on faster runners.** The
observation that reached this register said the failure "gets *more* likely on faster runners, not
less". Worked through, the opposite holds for **this** assertion. The failure needs
`T + backoff <= T'`, i.e. it needs wall clock to have **elapsed**. A faster runner drives `T' - T`
toward zero, and with `backoff >= 1` the comparison then always passes. It is a **slow**-machine
failure, gated by a small jitter draw. The repository's own precedent points the same way and is the
closest analogue: *"a probe asserting strict `<` on same-millisecond timestamps passed on Windows and
failed on Linux"*, recorded with the rule *"an assertion that holds only on slow hardware is a flake,
not a check."* This is the mirror case - an assertion that holds only on **fast** hardware - and the
rule is the same in both directions.

**Cross-links.** `E5-F005`, widened in the same custodian pass, is the **same class on the same
gate**: an assertion whose arm depends on real-process scheduling, filed as advisory and then found
redding the required Linux `verify` lane on an unrelated PR. The two are not the same bug — that one
races child processes, this one races the wall clock against a jitter draw — and neither fix helps
the other. What they share is the shape: **a test whose verdict depends on timing the test does not
control, on a required gate.** A third instance would be a pattern worth a systematic answer rather
than a third finding.

**Blocks gate:** not a gate clause, but it can **red the required Linux `verify` gate on an unrelated
PR**, which is how it surfaced. That is why it is filed rather than left as a re-run note, and it is
the same reason `E5-F005`'s advisory scoping had to be widened in the same pass.

### The fix, named but deliberately NOT applied here

Assert the product's own predicate, against the instant captured **before** the call:

```ts
const before = Date.now();
const result = await svc.processQueue({ maxAttempts: 6 });
// ...
expect((retryUpdate.set.nextRetryAt as Date).getTime()).toBeGreaterThanOrEqual(before + 1);
```

This is deterministic on every platform, and it is **stronger** than what is there now: it pins the
`>= 1ms` floor the `P2-2` comment exists to protect, which the current `> Date.now()` does not test
at all. Injecting the clock into `computeBackoffMs`'s caller would also work and is a larger change.

**Why the custodian did not apply it.** It is outside this pass's corrections queue, it is a code
change in a required-gate suite, and it is only provable with a positive control - reverting to
`> Date.now()` and forcing `rng() -> 0` plus an elapsed tick must red it. A custodian pass that
cannot run that control should not land the change. Whoever picks this up should apply the two-line
edit with that control, then flip this Status and delete the `E6-F027` key in
`scripts/finding-ownership.json` in the SAME commit.

## E6-F028 — `leakScan` emits one `::error::` annotation per finding, with no aggregation, over a surface whose line count the run does not bound

**Status:** open · **Owner:** `unowned` · **Severity:** LOW

**The class.** *An unbounded per-item emission past a cap.* Swept 2026-09-24 alongside the
`export-request-producer` fix (`E7-F041`), which is the same shape in the worker.

**The site.** `leakScan` (`scripts/m1-shipped-boot/journey.mjs`) prints one
`console.error("::error::DEP-015 …")` per element of `findings` and per element of `keyMaterial`.
`scanForKeyMaterial` produces one finding per matching LINE of `job-log.txt`, and the captured job
log's length is a function of what the phases printed — not a bound this driver sets. A log with a
long run of key-material-shaped lines therefore mints one annotation per line.

**Verified at source before filing**, on `c4faf2587e` plus this sweep's own change: the two
emission loops in `leakScan` iterate the finding arrays directly and neither is capped nor grouped.

**Why it is LOW, and why it was NOT fixed in the same PR that fixed the worker's instance.** The
emission happens only on the failure path, which deletes the bundle and fails the job, so it cannot
affect what is PUBLISHED and cannot be reached by a passing run. GitHub renders at most ten
annotations per step regardless, so the operator-visible surface is already bounded by the consumer.
And the counts are load-bearing evidence in this lane's own committed positive controls
(`scripts/lib/__tests__/m1-shipped-boot.test.mjs`), so changing the emission shape without a DEP
owner's ruling would rewrite what those controls assert about a security scan — the wrong trade for
a bound nothing currently needs.

**Why `unowned`.** `DEP-015` owns this driver and is shipped (`DEP-015-result.md`); no open DEP
ticket owns the leak scan's output shape. Naming one would be an invented owner.

**What would close it.** Group the emissions by `(surface, secret|marker)` and emit one annotation
per group carrying a count — the same remedy `E7-F041` took — with a non-vacuity arm showing every
finding is still accounted for in the counts, and the existing positive controls updated in the same
commit by the owner.

**Filed:** 2026-09-24 by the class sweep.
---

## E6-F029 — a documented path that was never executed: the D1 harness's local bring-up, and the four defects that lived in it

**Status:** open
**Severity:** MEDIUM (operator-facing; no gate rests on it, and that is precisely the problem)
**Owner:** `unowned`
**Filed:** 2026-09-24, by the `E6-F021` re-repair, ruled by the planning session. Measured at
`077873bdd4f1bb0f2cbf1baa602a28017b4cc446`.

### ★★★ The headline: nobody ever ran the command

`docker/d1/README.md`'s *Verification* section documented a local bring-up —
`cp docker/d1/.env.example docker/d1/.env`, then `docker compose -f docker-compose.d1.yml up`.
**That command could never have worked**, for a reason that has nothing to do with this programme's
MinIO outage:

- Docker Compose auto-loads only `.env` in the **project directory** — the repository root, because
  that is where `docker-compose.d1.yml` lives. **`docker/d1/.env` was therefore never read**, and
  Compose fell back to the unrunnable `:d1-local-unbuilt` control-plane and worker defaults.
- `d1-merge-train.yml` writes the digests to **`$GITHUB_ENV`** — process environment variables, which
  Compose reads directly — so **CI never needed the flag.**
- It *also* writes `docker/d1/.env`, and **nothing ever passes that file to Compose.** CI's copy is
  **dead weight that looks exactly like the operator's copy working.**
- And the correct idiom sits **one directory away**: `docker/campaign/docker-compose.campaign.yml:11`
  documents `--env-file docker/campaign/.env.campaign`.

So this was **not a misunderstanding of Compose.** Nobody was wrong about anything. **Nobody ran the
command.**

★ That is the general lesson, and it is sharper than *"CI is amd64"*: the other defects below are a
path **CI cannot take**; this one is a path **nobody ever took at all**. It generalises to every
README in this programme — a documented command is an untested assertion until something executes it,
and prose degrades silently because nothing reds when it stops being true.

★★ **Dead weight that resembles a working artefact is what made it invisible.** A `docker/d1/.env`
exists after a CI run. It has plausible contents. Nothing reads it. Anyone checking "does CI produce
the env file the README describes?" would have answered yes.

### The class

**A path only a human takes, which no lane exercises.** `d1-merge-train.yml` brings the same stack up
by a **different** route from the documented one, so the two drift, and the drift is invisible by
construction.

### Four instances, found in one PR, each invisible for a STRUCTURAL reason

| # | defect | why no lane could see it |
|---|---|---|
| **4** | **the documented bring-up command omits `--env-file docker/d1/.env`, so the copied env file is never loaded and Compose falls back to the unrunnable `:d1-local-unbuilt` defaults** | **the documented path was never executed by anything.** CI does not use that file: it writes the digests to `$GITHUB_ENV`, and the `docker/d1/.env` it also writes is passed to nothing |
| 1 | the mirrored MinIO image was published `linux/amd64` only, while the image it replaced served a multi-arch manifest list | **CI is amd64** |
| 2 | the repo-scoped GHCR package is not anonymously pullable, and the documented local path had no `docker login` prerequisite | **CI authenticates** (`packages: read` + a login step in all three jobs) |
| 3 | `docker/d1/.env.example` set `AOA_D1_MINIO_IMAGE=minio/minio:latest` — the image Docker Hub DELETED — and an env value **overrides** the Compose default, so a local operator resolved the dead image no matter what `docker-compose.d1.yml` said | **CI never reads `.env.example`**; it writes `docker/d1/.env` itself, and never writes `AOA_D1_MINIO_IMAGE` at all |

Instance 4 is **pre-existing** and is listed first because it is the strongest evidence and the most
general lesson. All four were repaired in PR #603 — 1–3 as part of the `E6-F021` repair, 4 as a
one-flag README correction. They are filed as one finding because they are one defect.

### A fifth instance, of the METHOD rather than the environment

The four above are defects nothing executes or the lanes cannot see. This one is a defect in the **sweep that was
supposed to find them**, and it is recorded here because it has the identical signature: a clean
result about a set that was never examined.

`E6-F021`'s class sweep enumerated with:

```
grep -rn "image:" docker-compose*.yml
```

**That is not recursive.** The **shell** expands `docker-compose*.yml` before `grep` ever runs, and
it expands only to the **five root-level** files — so `-r` recursed into nothing and two nested
compose files were never inspected. `find . -name "docker-compose*.yml"` returns **seven**. One of
the two missed files, `docker/m1-boot/docker-compose.m1-boot.yml:91`, carried the same withdrawn
image; it is [[E6-F030]].

★★★ **A sweep that silently covers five of seven reads exactly like one that covers all seven.** That
is `E.2.1` landing on a sweep: the enumeration's own output was the only evidence about its domain,
so it could report *"4 checked, 1 found"* with complete confidence and be wrong about the
denominator. **A count is a claim about a domain, and the domain needs a second source** — here,
`find`, which does the walking itself instead of handing the walk to the shell.

Practical rule, since this will recur: **never hand a recursive search its own file list via a
glob.** Use `find`, or `grep -r` with a DIRECTORY operand and `--include=`, and quote the pattern so
the shell cannot expand it. And when reporting *"N checked"*, say how N was obtained.

★★★ **A GREEN CI RUN IS NOT EVIDENCE ABOUT ANY OF THEM, and that misreading is what let #3 survive.**
Three `d1-merge-train` runs (`36022608037` bring-up, `36025567413`, `36027175548`) went green — the
last two fully, 47/47 + 9/9 executed — *while instance #3 was live in the tree*. They are not in
tension: CI takes the Compose default, so the `.env.example` override is a code path the lane cannot
reach. A lane that does not take a path cannot vouch for it, and reading its green as if it did is
the same *"a check that nothing runs"* shape this programme keeps paying for, relocated to a file the
check never opens.

★ **Instance #3 also survived a class sweep**, which is the sharper lesson. The sweep that fixed #1
and #2 covered the compose files, both workflows and the Dockerfile — and **not** `.env.example`. The
class was named correctly and the enumeration was short by one member. An enumeration you can quote
is only as good as its DOMAIN — and "every file that can set the image the stack resolves" is a wider
domain than "every file that names an image".

### Why it is tractable

The surface is small and enumerable, which the repair measured rather than assumed:
`grep -rn "AOA_D1_[A-Z_]*IMAGE="` across the repo returns **20 sites**, of which **1** was stale.
Line 29 (`pgvector:pg18`) is still pullable, lines 23–24 are local-build placeholders, and all
seventeen workflow sites write control-plane / worker / fake-provider and never MinIO.

### Proposed closure route

Either of these closes it; the first is stronger.

1. **Exercise the documented path.** A job that performs the README's own steps —
   `cp docker/d1/.env.example docker/d1/.env`, then the documented `docker compose …` line verbatim —
   rather than the lane's bespoke bring-up. This is the only thing that can catch the class rather
   than its current members; it would have caught **all four**. Its cost is a second bring-up, and it
   must NOT be allowed to become a copy of the lane's route, or it stops testing the human path and
   the finding regenerates.
1b. **Or, cheaper and static: check that a README's documented commands are the commands the lane
   actually runs.** Extract the fenced/inline commands from a lane's README and require each to
   appear in, or be reconciled against, that lane's workflow. This is what would have caught
   instance 4 without a second bring-up — the README said
   `docker compose -f docker-compose.d1.yml up` and the lane ran something else, and no artefact
   recorded the disagreement.
1c. **And the dead-weight rule, which is the shape that hid it: any `.env` (or similar) a lane
   WRITES must either be passed to something or deleted.** `d1-merge-train.yml` writes
   `docker/d1/.env` and passes it to nothing. A file that exists, has plausible contents and is read
   by nobody is indistinguishable from one that works, and that resemblance is what made instance 4
   survive. Cheap, pure-node, and it generalises past this lane.
2. **At minimum, a static agreement check**: every `AOA_D1_*_IMAGE` in `docker/d1/.env.example` must
   either match the corresponding `docker-compose.d1.yml` default or be absent. Cheap, pure-node,
   runnable in `policy`. It catches #3 and nothing else — it is blind to #1 and #2, which are
   properties of the environment rather than of a file, so it should be filed as a partial closure
   and say so rather than being allowed to look like coverage of the class.

Whichever is built needs a positive control: reintroduce a stale override, or an amd64-only mirror,
and show the check goes red. A check adopted on the strength of the fixes it post-dates has not been
shown to detect anything.

### Related, and downgraded on purpose: GHCR package visibility

`ghcr.io/meteoritelabs/aoa-d1-minio` is repo-scoped and private, so the documented local bring-up
needs a `docker login ghcr.io` with `read:packages` (stated as a requirement in
`docker/d1/README.md`). Making it anonymously readable is an **org-admin** action — `GITHUB_TOKEN`
cannot set package visibility.

★ It was filed as [[E6-F030]]'s route 1 and was briefly a **blocker**. The route-2 ruling removed
that: the shipped-boot lane will build MinIO from source rather than pull the mirror, so nothing
gates on this any more. It is now a **convenience for D1's local operators only** — if it flips, the
login prerequisite and its README paragraph retire. Instance #2 above is what it would close, and
CI is unaffected either way because CI logs in with its own run token.

### Not claimed

This finding does NOT say the local path is currently broken — all three instances are repaired. It
says the path is **unverified**, and that three defects accumulated there undetected is evidence
about the absence of a check, not about the current state of the tree. It also makes no claim about
operator-facing paths in epics other than E6, which were not examined.
---

## E6-F030 — the shipped-boot lane still resolves the withdrawn MinIO image, and the one-line fix is blocked by that lane's own shape guard

**Status:** `resolved` (2026-09-24, route 2 built and PROVEN live — see *Closed* below)
**Severity:** HIGH (it fails `m1-shipped-boot` at boot, before the `M1a` journey runs)
**Owner:** `unowned` (at filing; resolved by PR #604)
**Filed:** 2026-09-24, by the `E6-F021` re-repair, after Codex round 4 (P1) on PR #603. Measured at
`82af63622c4341912adefbf3e1dce2b29313ebd0`.

### The site, and that it is reached

`docker/m1-boot/docker-compose.m1-boot.yml:91`:

```
image: "${AOA_M1_MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z}"
```

That is the identical reference `E6-F021` measures at **401** from quay and Docker Hub alike, with
controls on both. `grep -rn "AOA_M1_MINIO_IMAGE"` over the whole repo returns **that line and nothing
else**, so nothing overrides it and the dead default is what resolves.

The chain was measured link by link rather than inferred from any one of them:

| link | measured |
|---|---|
| the overlay is booted | `.github/workflows/m1-shipped-boot.yml` boots `docker/m1-boot/docker-compose.m1-boot.yml` |
| MinIO is brought up | `scripts/m1-shipped-boot/journey.mjs:423` — `compose(state, ["up","-d","--wait",…, CP_REPLICAS[0]])`, and the comment above it names MinIO as part of replica A's dependency closure |
| nothing overrides the image | the single-hit grep above |
| the lane cannot authenticate | `.github/workflows/m1-shipped-boot.yml` contains no registry login |

So `m1-shipped-boot` dispatches fail at `boot-core`, before the journey — and that is the `M1a` lane.

### Why `E6-F021` did not catch it — a broken enumeration, not a failed repair

`E6-F021`'s class sweep enumerated with `grep -rn "image:" docker-compose*.yml`. **That is not
recursive.** The shell expands `docker-compose*.yml` before `grep` runs, and it expands only to the
five root-level files, so `-r` recursed into nothing. `find . -name "docker-compose*.yml"` returns
**seven**. The two never inspected were `docker/campaign/docker-compose.campaign.yml` (clean) and
this one.

★★★ **A sweep that silently covers five of seven reads exactly like one that covers all seven.** This
is `E.2.1` — a check whose input is the thing under test can only tell you the artefact is
well-formed, never that it is complete — landing on the sweep itself. The repair of the D1 half is
sound and proven; the CLAIM that the class was fixed was false, and it was false because of the
enumeration, which is the more dangerous of the two failure modes.

### RULED: route 2 — the lane builds MinIO from source

**Ruled by the planning session, 2026-09-24.** The reasoning is recorded here in full so whoever
builds it inherits the argument rather than re-deriving it.

★ **First, a correction to this finding's own filing, because it was imprecise about the guard.**
The filing said the one-line fix "does not work" because
`scripts/lib/m1-shipped-boot-shape.mjs:215` forbids `docker pull`/`docker login`. Re-measured at
source: **that guard reads the WORKFLOW text and nothing else** —
`scripts/check-m1-shipped-boot-shape.mjs:28` is
`readFileSync(path.join(repoRoot, SHIPPED_BOOT_WORKFLOW))`, and `SHIPPED_BOOT_WORKFLOW` is
`.github/workflows/m1-shipped-boot.yml`. So line 216's registry ban never sees
`docker/m1-boot/docker-compose.m1-boot.yml`, and a *public* GHCR reference placed in that compose
file would **not** have tripped anything. Route 1 would have passed. What is true is narrower: a
**private** mirror needs a `docker login` in the workflow, and *that* reds line 215.

**And that is exactly why route 2 is ruled rather than route 1.** Look at what the guard is for. It
requires `build.sh` / `sbom.sh` / `sign.sh` / `admit.sh`, forbids `docker pull` / `docker login`, and
forbids registry references, under the stated reason *"images are built from the source"*. That is
founder ruling **F3**'s definition of a shipped CI boot: the lane builds the artefacts under test
from the frozen candidate and boots them. **A lane whose object store arrives pre-baked from a
registry is a weaker claim than the one F3 asks for.**

So route 1 would have satisfied the guard's **letter** while quietly weakening the property the guard
exists to protect — which is the defect class this programme keeps paying for, and it is worse when
the guard would have stayed green. Route 2 is not the fallback; **it is what this lane was designed
to do**, and `docker/d1/minio.Dockerfile` already performs exactly that build, fail-closed on the
release tag's peeled commit, so it is reuse rather than new work. A Go compile per run is a fair
price on a lane that runs rarely and deliberately.

★★ **The asymmetry is the interesting part, and it is not an inconsistency.** `docker-compose.d1.yml`
and `docker/m1-boot/docker-compose.m1-boot.yml` get **different fixes for the same broken image, on
principle**:

| lane | what it is | the right fix |
|---|---|---|
| D1 (`docker-compose.d1.yml`) | a **test harness** — pulling a pinned third-party image is entirely normal, and a registry mirror is the natural repair | pull the GHCR mirror, pinned by digest (`E6-F021`, shipped) |
| `m1-boot` (`docker/m1-boot/…`) | the **shipped-boot evidence lane** — building from source **is the claim** (F3) | build MinIO from source in the lane (this finding) |

Two different fixes for principled reasons, not two attempts at one fix.

**Route 3 — amending the shape guard to permit a `ghcr.io` login — is rejected.** It would edit a
guard to accommodate the need it was written to forbid.

**Consequence: GHCR package visibility is no longer a blocker.** It was route 1's prerequisite; with
route 1 rejected it becomes a **convenience for D1's local operators only**, and it is recorded that
way on [[E6-F029]] rather than here.

### Scope of the ruling

Route 2 is deliberately **not** started in PR #603: that PR's D1 half is proven and lands as it
stands, with this finding open. Whoever picks this up inherits the pin-down above — the site, the
four measured links, the guard's true scope, and the reason route 2 beats a route that would also
have gone green.

### Not claimed

This does NOT say the D1 lane is broken — it is fixed and proven at runs `36025567413` and
`36027175548` (bring-up **and** full campaign, 47/47 + 9/9). `docker-compose.d1.yml` and
`docker/m1-boot/docker-compose.m1-boot.yml` are separate stacks. Nor does it claim `m1-shipped-boot`
has actually been observed failing on this: the lane is dispatch-only and no dispatch was made — the
failure is derived from the four measured links above, and **a dispatch is what would confirm it**.
That dispatch was not made because the lane is keyed-capable and outside this ticket's brief.

### Closed — 2026-09-24, route 2 built, and the lane PROVEN past MinIO

**PR #604**, head `f546f068ecb24a700d2c9ccb9460255d1a3b4a46` (the run in the next paragraph is cited at its own revision `845ffb4c9`, and a SECOND keyless dispatch, run `36051455003`, re-proves it on the Codex-round-1 tree). Evidence:
`docs/replatform/epics/E6-deployment-test-harness/tickets/E6-F030-shipped-boot-minio-result.md`.

The measurement above was reproduced before building — quay **401** and Docker Hub **401** for
pull-scoped tokens, against anonymous **200** controls on `quay.io/prometheus/busybox` and
`docker.io/library/busybox` — and the release tag's **peeled** commit re-read as
`07c3a429bfed…` (`refs/tags/<tag>^{}`), distinct from the annotated tag object `01ce918d…`, which
is the pin `docker/d1/minio.Dockerfile` already carries and fails closed on.

Route 2 as ruled: `.github/workflows/m1-shipped-boot.yml` now **builds** the store
(`docker build -f docker/d1/minio.Dockerfile`), asserts the tag resolves locally, and exports it as
`AOA_M1_MINIO_IMAGE`; the overlay's `minio` service is **`:?`** on that variable rather than
defaulting to anything; `journey.mjs prepare` refuses an absent value and one naming a registry host;
and two new clauses in `scripts/lib/m1-shipped-boot-shape.mjs` require the build and the export, each
with a red in `check-m1-shipped-boot-shape.test.mjs` (42 executed; the clauses' absence reds exactly
2). No test or guard was weakened and no failure path was made non-fatal. The D1 half of `E6-F021`
is untouched, per the asymmetry ruled above.

★ **The `$GITHUB_ENV` export is the load-bearing half, and the run measured the link that had only
been inferred.** `actions/checkout` replaces the workspace with the candidate, so an older candidate
brings its own compose default and its own `prepare`; Compose reads the process environment, which
outranks both that default and `--env-file`.

**The derived failure is now an OBSERVED pass.** `m1-shipped-boot`, `mode: keyless`, run
**`36047740323`**, candidate `00cbba381eaf6d49aec2f8b46e47e7747ae9e8cb` — a candidate that **still
carries this finding's quay default**, which is what makes it the right test. *Build the object store
image from upstream source (E6-F030)* → `success`
(`object store aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z built from upstream source`); *Boot the
core* → `success`
(`boot-core: postgres, minio, migrate (completed), control-plane + control-plane-b healthy`); and
*Probe the presign store from the adapter-manager's seat* → `success`, which shows the store is
**functional** and not merely up — the presign surface being exactly what the wrong MinIO version
breaks. No `pull access denied`, no 401, no registry error anywhere in the log.

★ Re-proved on the round-1 fixes: run **`36051455003`** (head `f546f068e`, same candidate) printed
`minio version RELEASE.2025-09-07T16-13-09Z (commit-id=07c3a429bfed433e49018cb0f78a52145d4bedeb)` off
the BUILT BINARY before booting — the release AND the peeled commit confirmed on the artefact rather
than on the build request — and `boot-core` was green again. Both dispatches were `mode: keyless` and
free; no keyed dispatch was made.

★ **Both** runs' overall conclusion was `failure`, **fourteen steps later**, at the DEP-022 `cross-tenant`
step, with the byte-identical error — two independent dispatches, so it is reproducible and
candidate-side rather than a flake (`cross-tenant: activity_log: the owner's own read must return its row: {"own":0,…}` — that
driver's own positive control declining to grade a case it could not set up). It touches no object
store and is not this finding's. It is `DEP-022-result.md`'s step-1 keyless rehearsal returning its
*failing* prediction, with a cause outside the two that section anticipated, so **the keyed step 2
must not be dispatched yet**. Recorded for the planning session; no id minted for another ticket's
surface.

★ Two same-class sites are deliberately left: `AOA_M1_POSTGRES_IMAGE`'s `pgvector/pgvector:pg18`
default in the same overlay (currently pullable, and source-building PostgreSQL is an unruled
widening — the residual risk, recorded for a ruling) and `docker-compose.staging.yml`'s `ghcr.io`
defaults (staging's own, overridden by the overlay's required digests on this lane).

---

## E6-F031 — the `activity_log` same-tenant positive control reded because the case's only own event was `usage`, which `E3-D-AUDIT-SET` deliberately does NOT audit

**Status:** resolved · **Owner:** `DEP-022` · **Severity:** HIGH

Class: HARNESS. Found 2026-09-25, probing runs `36047740323` / `36051455003`. It blocked M1a's
critical path: the keyed step 2 is gated on a green keyless step 1.

The `cross-tenant` step reded byte-identically on two independent keyless runs with

```
DEP-015 cross-tenant: activity_log: the owner's own read must return its row:
{"own":0,"foreign":0,"unscoped":0,"ownActions":[]}
```

### The measured chain

Every link below was read at source; the one inference is marked as such.

1. **The read predicate.** `probeLegacyTableIsolation`'s `activity_log` arm
   (`tests/d1/lib/e6f-harness.mjs`) reads
   `activityService.list({ companyId, entityType: "job", entityId: jobId })`, and its anti-vacuity
   arm runs the SAME predicate minus the Company, as raw SQL **on the owner pool**.
2. **`unscoped === 0` rules out the visibility hypotheses outright.** A predicate-removed read on the
   owner pool returning zero means no such row exists **for any tenant**. RLS/GRANT (`E2-D03`) and
   company-scoping can only produce `own: 0` with `unscoped > 0`, so both are eliminated by
   measurement rather than by argument. This is a WRITER question, not a reader question.
3. **Every production writer of `entity_type='job'`, enumerated** (`grep` on `JOB_AUDIT_ENTITY_TYPE`
   and `entityType: "job"` across `server/src` and `packages`) — **four** sites, each with its
   trigger read:
   * `recordJobSubmitActivity` ← `submitJobWithinTenant`, gated `if (tx && auditSink)`. The lane's
     fixture never uses it: `bringUp` calls `seedSpineJob`, which `INSERT`s `issues`, `jobs` and
     `job_attempts` by raw SQL.
   * `recordJobDrainActivity` ← the drain route / `job-reconciliation` / the drain-trigger store.
     No drain is issued against the victim job before this arm.
   * the staged-input bundle audit (`job-input-staging.ts`), gated `if (pending.length > 0)`. The
     lane stages no input files.
   * `createAcceptedActivityAuditProjector` (JOB-017) ← the `acceptEvent` seam. **Registered on
     every ingest** (`job-events.ts`, `acceptedEventProjectors`), so the product path is wired.
4. **`E3-D-AUDIT-SET` is CLOSED at `attempt_started` and `terminal`**
   (`ACCEPTED_ACTIVITY_AUDIT_ACTIONS`, `job-accepted-activity-audit.ts`). `usage` is **deliberately
   excluded** — it has its own durable record, the `cost_events` row plus its `authoritative_cost`
   receipt.
5. **The case uploaded exactly ONE own event, `eventType: "usage"`** (`cross-tenant.mjs` §2). So the
   projector correctly never fired, and no `activity_log` row was ever written.

★ **The observed payload is explained down to its last field, including why the SIBLING arm passed.**
The same `usage` batch is what gives `cost_events` its charge — and in `mode: keyless` the enabled
tenants' journey is never dispatched, so that charge can only have come from this case's own batch.
The ingest therefore demonstrably accepted, fenced and priced the batch: the *only* remaining
variable is the event TYPE. `ownActions: []` is the projector reporting, correctly, that nothing in
the audited set arrived.

The single INFERRED link, marked as such: that no other lane phase submits an `attempt_started` or
`terminal` event against *this fixture job*. It is read rather than dumped from the database — the
fixture's `jobId` is minted inside `runCrossTenantCases` by `newScenarioIds()`, so no phase outside
that function can name it — but it is a reading, not a row count.

### HARNESS, not product

Every production writer is correctly gated and the JOB-017 projector is registered on every ingest.
Nothing in the product declines to write a row it owes. The driver asserted a row that no path it
exercised writes.

★ **The second source that settles it** (`E.2.1`): the D1 twin
(`tests/d1/m1-fault-matrix.test.mjs`) passes `journeyA.ids.jobId` — the **real journey's** job, whose
attempt ran `attempt_started` through the ingest — and says so in an assertion of its own:
*"tenant A's journey must have run — it is what wrote the cost and audit rows"*. The shipped-boot
port substituted its own raw-SQL fixture job, and the lane never retains the journey's job id in
`state`, which is almost certainly why. The D1 twin is therefore **not** affected by this finding.

### The fix, and why it is stronger than the D1 shape

The case now submits the audited `attempt_started` event on the fence it already owns, so the arm
**earns** its row instead of borrowing one another phase happened to leave. That certifies the live
JOB-017 audit write rather than depending on journey ordering. `terminal` is deliberately not used —
it would end the attempt, and every later arm needs this fence live. Sequence numbers shift (usage
1→2, hostile 2→3) and must stay distinct: a duplicate seq is rejected as a replay, which would make
the hostile refusal indistinguishable from a tenant denial (the DEP-016 lesson).

★ **No control was weakened.** Both `own > 0` and the `unscoped > 0` anti-vacuity arm are untouched,
and the `foreign === 0` classification is unchanged. Relaxing a same-tenant positive control to
unblock the lane would have re-created precisely the `resolveExecutionSecretHttp` defect this control
exists to catch.

★★★ **The fix is ARGUED FROM SOURCE, NOT DEMONSTRATED LIVE, and `Status: resolved` above refers to the
CAUSE being established, not to the fix having been observed to pass.** `m1-shipped-boot` checks out
`ref: ${{ inputs.candidate }}`, so the lane runs the CANDIDATE's `cross-tenant.mjs`, never the
dispatching branch's; and it refuses a candidate that is not already an ancestor of
`docs/replatform-program`. A verification dispatch (run `36057809378`) therefore re-ran the **unfixed**
driver and returned the byte-identical payload — a **third** reproduction, not a test of the fix. The
verification is OWED: one `mode: keyless` dispatch with the merge commit as candidate. See
`tickets/E6-F031-activity-log-positive-control-result.md` §4.1.

### Class sweep

**The class:** *a probe arm that asserts a row exists without the case producing it — it depends on a
row some other phase is assumed to have written.* Enumerated over all four arms of
`probeLegacyTableIsolation`: **4 checked, 1 found, 1 fixed.** `task_outputs` plants through the
production writer (`upsertForIssue`); `provider_credentials` plants by owner SQL; `cost_events` is
produced by the case's own `usage` event; `activity_log` planted nothing.

**The dual** (`E.1(b)`), searched for and **found**: *an arm that can PASS wrongly on a row another
phase wrote.* Filed as `E6-F032`.

---

## E6-F032 — the `cost_events` arm can pass on the JOURNEY's charge, so it would stay green if the case's own pricing regressed

**Status:** open · **Owner:** `unowned` · **Severity:** MEDIUM

Class: HARNESS. Found 2026-09-25, as the DUAL half of `E6-F031`'s class sweep. A latent vacuity in a
certifying control: it cannot produce a false denial, only a false pass.

`probeLegacyTableIsolation`'s `cost_events` arm reads `costService.byAgent(companyId)` filtered to
`agentId`, and `cross-tenant.mjs` asserts `cost.ownCents > 0`. That predicate is **Company- and
agent-scoped, not job-scoped**, and the lane's fixture agent is the tenant's own agent — the same one
the real journey charges. So in `mode: keyed`, where the enabled tenants' journey does run, `own > 0`
and `ownCents > 0` are satisfied by the journey's charge **whether or not the case's own `usage`
event was priced at all**.

This is the exact polarity `E6-F031` lacked: `E6-F031` was a control that **failed wrongly**; this is
a control that can **pass wrongly**.

★ It is not a false-denial risk, which is why it is Medium rather than High: the arm cannot claim
isolation it does not have, it can only fail to notice that its own charge went missing. But it means
the `d2m.tenant.cross.cost_rows` row's `positiveControlPassed` is weaker in `keyed` than in `keyless`
— and `keyless` is the mode in which it is currently sound, which is the wrong way round for a gate.

**Deliberately NOT fixed here, with the reason** (`E` rule 4): a sound fix reads the agent's total
before the case's own upload and asserts the delta, which changes the arm's shape and its recorded
evidence fields. Doing that inside a probe PR whose purpose is to establish `E6-F031`'s cause would
mix a measured diagnosis with an unrelated control redesign. Owner is `DEP-022`, which owns the arm.
