# E6-F030 — the shipped-boot lane builds its object store from upstream source (route 2) — result

**Status:** `gate_review`
**Epic:** E6 · **Finding:** `E6-F030` (HIGH) · **Milestone:** `M1a` (unblocks the keyed campaign lane)
**Date (UTC):** `2026-09-25`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `00cbba381eaf6d49aec2f8b46e47e7747ae9e8cb` (`origin/docs/replatform-program`)
**PR:** #604 (base `docs/replatform-program`)
**Reviewed revision:** `845ffb4c9f7d7cd9722c88667209ec6b28679348`

> **On the revisions, stated as a claim that can be checked.** `845ffb4c9` is the revision every
> piece of live evidence in §5 and §6 was produced on — run `36047740323` was dispatched from it, and
> the local guard and mutation runs were made on it. The commits after it are this record, the
> `findings.md` closure and the `scripts/finding-ownership.json` key deletion. `git diff --name-only
> 845ffb4c9..HEAD` therefore contains **no workflow, Dockerfile, compose file, script or test** — the
> code surface the evidence speaks about is byte-identical. Saying so without checking would be the
> records-disagreeing-with-code defect this programme keeps paying for, so the claim is the diff.

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.

---

## 1. The defect, re-measured before anything was built

`docker/m1-boot/docker-compose.m1-boot.yml:91` defaulted the shipped-boot stack's object store to
`quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`. `E6-F021`'s amendment measures that reference
as closed on every documented route. **Re-measured independently on 2026-09-25, with controls on
both registries, before any code was written:**

| registry | request | result |
|---|---|---|
| quay.io | `GET /v2/minio/minio/manifests/RELEASE.2025-09-07T16-13-09Z`, pull-scoped token (801 chars, acquired OK) | **401** |
| quay.io | **control** `GET /v2/prometheus/busybox/manifests/latest`, anonymous token flow | **200** |
| Docker Hub | `GET /v2/minio/minio/manifests/RELEASE.2025-09-07T16-13-09Z`, pull-scoped token | **401** |
| Docker Hub | **control** `GET /v2/library/busybox/manifests/latest` | **200** |

The controls are what make this a **repository closure** rather than a registry outage: both
registries answer, both anonymous token flows work, and only `minio/minio` is shut. This reproduces
the finding's measurement rather than restating it.

The peeled release tag was re-measured too, because the predecessor's first pin caught the wrong
object:

```
01ce918d8279a20e4706b96a64396146894adee4  refs/tags/RELEASE.2025-09-07T16-13-09Z      (annotated tag OBJECT)
07c3a429bfed433e49018cb0f78a52145d4bedeb  refs/tags/RELEASE.2025-09-07T16-13-09Z^{}   (the COMMIT a checkout lands on)
```

`docker/d1/minio.Dockerfile`'s `MINIO_SOURCE_COMMIT` is already `07c3a429bfed…` — the peeled commit,
the correct one — and its build `test`s the checked-out `HEAD` against it and aborts on a mismatch.
Nothing had to be re-pinned.

## 2. How the compose files were enumerated, and whether any other lane carries the dead image

The finding exists because `E6-F021`'s sweep handed a recursive `grep` its own file list via a glob
the shell expanded first, so `-r` recursed into nothing and covered **five of seven** files while
reading exactly like a complete sweep. This sweep therefore does the walking with `find`:

```
$ find . -name "docker-compose*.yml" -not -path "./node_modules/*" | sort
./docker-compose.d1.yml
./docker-compose.quickstart.yml
./docker-compose.research.yml
./docker-compose.staging.yml
./docker-compose.yml
./docker/campaign/docker-compose.campaign.yml
./docker/m1-boot/docker-compose.m1-boot.yml
```

**Seven**, and widening the pattern to `-name "*compose*.yml" -o -name "*compose*.yaml"` returns the
same seven — so the denominator is not an artefact of the name pattern either.

**The class, in one sentence:** *a service in a harness or shipped-boot compose stack whose image
resolves, by default, from a third-party registry the lane cannot authenticate to.* **Its dual**
(E.1(b)) is *an **override** — an env file, a `$GITHUB_ENV` write, a workflow `env:` — that re-points
such a service at a registry image*, which is the polarity that hid `E6-F029`'s instance #3 inside
`.env.example` after a sweep of the compose files had passed.

Both polarities, enumerated by searches that can be quoted:

| search | sites | stale |
|---|---|---|
| `grep -rn "minio/minio\|MINIO_IMAGE" -I .` (excluding `node_modules`, `docs/replatform`) | 25 | **1** — `docker/m1-boot/docker-compose.m1-boot.yml:91` |
| `grep -rn "AOA_M1_[A-Z_]*IMAGE" -I .` | 9 compose sites + 3 in `journey.mjs` | **1** — the same line |
| the DUAL: `find . -name "*.env*" -not -path "./node_modules/*"` → `.env.example`, `docker/campaign/.env.campaign.example`, `docker/d1/.env.example`, `docker/d1/campaign.env` | 4 files | **0** — none sets any `AOA_M1_*` variable |

**So exactly one site carried the dead image, and no other lane carries it.** The D1 stack's own
MinIO (`docker-compose.d1.yml:110`) is the repaired GHCR mirror pinned by index digest, which is the
right fix *there* and is left alone (§3).

**Two same-class sites are deliberately NOT changed, stated rather than left silent:**

- `docker/m1-boot/docker-compose.m1-boot.yml:74` — `${AOA_M1_POSTGRES_IMAGE:-pgvector/pgvector:pg18}`.
  Same class, and it is the residual risk on this lane. It is *not* stale: `E6-F029` measured that
  tag pullable, and run `36047740323` below pulled it. It is not repaired here because the ruling
  names MinIO, because building PostgreSQL + pgvector from source is a different order of cost from
  a Go compile, and because changing it on this ticket would be an unruled widening. **Recorded for
  the planning session to rule on; not minted as a finding, because that is a severity call and an
  id allocation this ticket was not given.**
- `docker-compose.staging.yml:49…327` — the `ghcr.io/meteoritelabs/aoa-*:staging` defaults. Those are
  the *staging deployment's* defaults, and on this lane every one of them is overridden by the
  overlay's `:?`-required admitted digests. Out of scope by construction.

**And the first place the class was searched was this diff** (E.1(a)): the workflow step added here
introduces no registry reference (the shape guard's own registry ban, clause 216, re-runs over it and
is green), and the tag it builds is a bare local `aoa-m1-minio:<release-tag>` with no host component.

## 3. Route 2, and why the mirror was not taken

The GHCR mirror exists, is proven on the D1 lane, and a one-line compose change would have used it.
**It was not taken, and the reason is design rather than convenience.**

`scripts/lib/m1-shipped-boot-shape.mjs` requires `build.sh` / `sbom.sh` / `sign.sh` / `admit.sh`,
forbids `docker pull` / `docker login`, and forbids registry references, under the stated reason
*"images are built from the source"*. That is founder ruling **F3**'s definition of a shipped CI
boot: the lane builds the artefacts under test from the frozen candidate and boots them. A lane whose
object store arrives pre-baked from a registry is a weaker claim than F3 asks for.

★ **And the guard would not have stopped route 1, which is exactly why route 2 is right.** Verified
at source: `scripts/check-m1-shipped-boot-shape.mjs` reads
`readFileSync(path.join(repoRoot, SHIPPED_BOOT_WORKFLOW))`, and `SHIPPED_BOOT_WORKFLOW` is
`.github/workflows/m1-shipped-boot.yml` — **the workflow text and nothing else**. A public GHCR
reference placed in the *compose* file would never have reached the registry ban. Route 1 would have
gone green while quietly weakening the property the guard exists to protect, which is worse than a
red, and is the defect class this programme keeps paying for.

★★ **The asymmetry with D1 is principled, not an inconsistency:**

| lane | what it is | the right fix |
|---|---|---|
| `docker-compose.d1.yml` | a **test harness** — pulling a pinned third-party image is normal | the GHCR mirror, pinned by digest (`E6-F021`, shipped, untouched here) |
| `docker/m1-boot/…` | the **shipped-boot evidence lane** — building from source **is the claim** (F3) | build MinIO from source in the lane (this ticket) |

Route 3 — amending the shape guard to permit a `ghcr.io` login — stays rejected. **No test or guard
was weakened, and no failure path was made non-fatal**; §4 lists what was *added* to fail closed.

## 4. What changed

| file | change |
|---|---|
| `.github/workflows/m1-shipped-boot.yml` | a new step, *"Build the object store image from upstream source (E6-F030)"*, placed after the three-image build: `docker build -f docker/d1/minio.Dockerfile -t "$AOA_M1_MINIO_IMAGE" docker/d1`, then `docker image inspect` on the tag (a build that warned and produced nothing would otherwise surface later as a compose pull), then an export of the tag to `$GITHUB_ENV`. `set -euo pipefail`; a build failure fails the run. |
| `docker/m1-boot/docker-compose.m1-boot.yml` | the `minio` service's image becomes `${AOA_M1_MINIO_IMAGE:?…}` — fail-closed, like the three candidate images — with the measurement, the ruling and the D1 asymmetry recorded above it. |
| `scripts/m1-shipped-boot/journey.mjs` | `prepare` refuses an absent `AOA_M1_MINIO_IMAGE`, refuses a value naming a registry host, writes it into the compose env file, and records `images.objectStore` (`builtFromSource: true`) in `candidate.json`. |
| `scripts/lib/m1-shipped-boot-shape.mjs` | two new clauses: the lane must `docker build -f docker/d1/minio.Dockerfile`, and must export `AOA_M1_MINIO_IMAGE`. |
| `scripts/check-m1-shipped-boot-shape.test.mjs` | a red for each. |

**Why the `$GITHUB_ENV` export is load-bearing and not decoration.** `actions/checkout` replaces the
workspace with the candidate, so on any candidate that predates this commit the *candidate's* compose
default and *candidate's* `prepare` are what run. Compose reads the process environment, and the
process environment outranks both the file default and `--env-file` — so the export is what makes the
repair effective on the frozen candidates M1a will actually dispatch. §6 is the measurement of that
claim, which was an inference until the run.

**Two new clauses, not one** (the halves are independently holed): without the build the lane has no
store image; without the export the built image is never the one Compose resolves, and an older
candidate falls back to its own withdrawn default.

## 5. RED / GREEN and the positive controls

The unit surface is pure node and ran locally.

**The shape guard's new clauses — mutation-proved.** `node --test scripts/check-m1-shipped-boot-shape.test.mjs`:

| state of `scripts/lib/m1-shipped-boot-shape.mjs` | executed | fail |
|---|---|---|
| **RED** — the two clauses absent (the file at its base revision) | 42 | **2** |
| **GREEN** — the two clauses present | 42 | **0** |

The two that red are *"REJECT: the object store no longer built from source (it would have to be
pulled)"* and *"REJECT: the built store's tag not exported, so Compose resolves something else"*, and
each is non-vacuous by construction: the first uses the suite's `mutate` helper, which fails the TEST
if its anchor is not found exactly once; the second asserts `!/AOA_M1_MINIO_IMAGE=/` on the mutated
text before evaluating it, so a mutation that silently did nothing cannot produce a passing red.

**The journey's fail-closed arms — three observed cases, including the positive control.** Run at
`845ffb4c9`, `node scripts/m1-shipped-boot/journey.mjs prepare --out … --candidate 00cbba381e… --mode keyless`:

| case | observed |
|---|---|
| `AOA_M1_MINIO_IMAGE` unset | `::error::DEP-015 AOA_M1_MINIO_IMAGE is not set — the lane must build the object store from source (docker/d1/minio.Dockerfile) and export its tag before \`prepare\` (E6-F030)` |
| set to `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` | `::error::DEP-015 AOA_M1_MINIO_IMAGE=quay.io/… names a registry host — the shipped-boot lane builds its object store from source (F3, E6-F030)` |
| **positive control** — set to `aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z` | gets **past** both arms and fails at the next step, `ENOENT … docker/images/digests.env` (absent locally, because no image build ran) |

The third row is what makes the first two non-vacuous: the refusals are the *variable's* doing, not a
phase that cannot run at all. The check was deliberately placed **before** `prepare`'s `digests.env`
read so that it is reachable and observable without a Docker build.

**Full guard set + `check-evidence-immutability --base origin/docs/replatform-program`:
`failures: 0`**, run after `git add -A` (so newly-touched files are visible to the tracked-file
walks) and before the push. `node scripts/check-staging-manifest.mjs` is green on the edited overlay,
which is the check that parses it with `yaml-lite`.

## 6. The live rehearsal: `m1-shipped-boot` keyless, run `36047740323`

**The hypothesis, stated before the dispatch, with both predictions** (M1-BUILD-RULES §E.3):

> The **only** thing stopping this lane from reaching MinIO bring-up is the withdrawn image, and
> building it from source while exporting the tag into the process environment will bring MinIO up
> **even though the candidate still carries the quay default** — because Compose's process
> environment outranks both that default and `--env-file`.
>
> - **If right:** the build step succeeds and *Boot the core* gets past MinIO, either completing or
>   failing later at a non-MinIO step, with no `pull access denied` / 401 for MinIO anywhere.
> - **If wrong:** either the source build fails, or *Boot the core* still dies on a MinIO pull or
>   auth error — which would falsify the one link in §4 that was inferred rather than measured
>   (Compose's env precedence, and `compose()` in `journey.mjs` inheriting the process env because it
>   spawns without an `env:` option).

The failing prediction is what made the dispatch worth making: a MinIO pull error would have killed
the precedence reasoning outright, and either outcome is a diagnosis (E.3.2).

Dispatched `mode: keyless` — free, no E2B and no model spend — on `--ref claude/m1-e6-f030-minio`
with `candidate=00cbba381eaf6d49aec2f8b46e47e7747ae9e8cb` (the program tip, the newest 40-hex that
is an ancestor of `docs/replatform-program`; this branch is not merged and could not be the
candidate). **No keyed dispatch was made.**

Steps, by name and conclusion:

| step | conclusion |
|---|---|
| Static preflight at the candidate | success |
| Build, SBOM, sign and admit the three images from the candidate | success |
| **Build the object store image from upstream source (E6-F030)** | **success** |
| Prepare — job secrets and the CI-generated control-plane keypair | success |
| Verify the control-plane / adapter-manager keypair | success |
| **Boot the core (stores, migrate, both control-plane replicas)** | **success** |
| Seed the three Organizations through the API | success |
| Apply the F10 tenant set to every control-plane replica | success |
| Assert the tenant set and the must-be-off switches (render + running replicas) | success |
| Provision each Organization's target and enrolment ticket | success |
| Boot the workers (keyed also boots the adapter-manager) | success |
| Await each worker enrolled on its own Organization's target | success |
| Reconcile and preflight every Organization | success |
| **Probe the presign store from the adapter-manager's seat** | **success** |
| Run the journey | success |
| Drive the M1a-D2-MECHANISM cross-tenant, cost, legacy-table and lease-binding cases | **failure** — unrelated; §6.1 |
| Collect the evidence (redacted) · leak scan · evidence upload · teardown | success |

**Run conclusion: `failure`, at the `cross-tenant` step — fourteen steps after MinIO.** The two
lines that carry the acceptance, quoted from the job log:

```
19:32:04  object store aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z built from upstream source
19:32:51  boot-core: postgres, minio, migrate (completed), control-plane + control-plane-b healthy
```

**Hypothesis confirmed, and the acceptance is earned with room to spare.** The gate asked only for a
run that gets *past* MinIO bring-up in `boot-core` — the point the old default cannot reach.
`boot-core` concluded **success** and printed the line above; MinIO's compose healthcheck
(`curl -fsSk https://127.0.0.1:9000/minio/health/live`) is part of the `--wait` that step blocks on,
so a store that came up unhealthy would have failed it. No `pull access denied`, no 401 and no
registry error appears anywhere in the log.

★ **Stronger than bring-up: the store is functional, not merely running.** *Probe the presign store
from the adapter-manager's seat* also passed — the presign surface is the exact behaviour a wrong
MinIO version breaks (the predecessor's `:latest`-era substitute failed `E6F-05`/`E6F-14` with
`400 AccessDenied: There were headers present in the request which were not signed`), so this is the
evidence that building the **exact** tag rather than the newest obtainable one was the right call.

### 6.1 The run's own failure is MinIO-independent, and it is DEP-022's step-1 rehearsal coming back WRONG

Reported rather than touched, because it is outside this ticket and **no test or guard may be weakened
to make a lane pass**. The failing line, in full:

```
##[error]DEP-015 cross-tenant: activity_log: the owner's own read must return its row:
{"own":0,"foreign":0,"unscoped":0,"ownActions":[]}
```

That is a **positive control inside the `cross-tenant` driver** refusing: before it can claim a
foreign tenant was *denied* an `activity_log` read, it must see the owner's *own* row, and it saw
zero rows of any kind. It is not a cross-tenant leak; it is the driver declining to grade a case it
could not set up. Nothing in it touches the object store, and it is fourteen steps downstream of
`boot-core`.

★ **This run IS the rehearsal `DEP-022-result.md` §"The sequence to dispatch" asked for** — step 1,
`mode=keyless`, candidate = a merged commit — and that section states the failing prediction in
advance: *"the step fails naming the case and the arm, at zero cost."* It named two likely wrong
answers (`seedSpineTarget`'s `worker_enrollment_codes` insert, and `costService.byAgent` returning
`ownCents === 0`). **This is a third one**, so the cycle that found it killed a line of reasoning
rather than extending one, which is worth more than a green would have been (E.3 §4). It also means
**step 2 — the keyed dispatch — must NOT be made yet**: that sequence gates keyed on a green step 1.

For the planning session: this is a candidate-side defect at `00cbba381e…`, it is free to re-measure
(`mode=keyless` costs nothing), and it belongs to DEP-022 rather than to `E6-F030`. **No finding id
was minted for it here** — severity and ownership are the planning session's call, and inventing an
id for another ticket's surface is how registers drift.

★ **What this run does NOT prove, said plainly.** The candidate is `00cbba381e…`, so *Static
preflight at the candidate* ran the **candidate's** copy of the shape guard against the
**candidate's** copy of the workflow — both pre-change, consistent, green. **The two new shape-guard
clauses were therefore not evaluated by this run**; their evidence is §5's mutation table, and CI's
`policy` job on this PR. Conversely, the run proves the §4 mechanism *against an older candidate*,
which is the case M1a will dispatch — the candidate's compose file still held the quay default and
the candidate's `prepare` never wrote the variable, and MinIO came up anyway, from the process env.
That is the precedence link measured rather than inferred.

## 7. Findings and register

`E6-F030` moves to `resolved` in
`docs/replatform/epics/E6-deployment-test-harness/findings.md`, and its key is deleted from
`scripts/finding-ownership.json`, **in the same commit** (E.2 §5).

The register was touched as a **delta**, never rewritten from this worktree's copy, and the result is
asserted **two-sided against the merge ref** — both the added and the dropped key set — because a
guard reading the file it was just handed can only say the file is well-formed, never that it is
complete (E.2.1). The assertion is printed in §8.

`E6-F029`'s note that GHCR package visibility "is now a convenience for D1's local operators only,
because the shipped-boot lane will build MinIO from source" is **now true rather than planned**; no
edit to `E6-F029` is needed and none was made.

## 8. Two-sided register delta, against the merge ref

```
key sets compared: origin/docs/replatform-program (base) vs HEAD
added:   (none)
dropped: E6-F030
```

Nothing else differs: the same command reports every other key present and byte-identical, which is
the control for the rewrite-loses-an-entry half of the class.

## 9. Self-audit against the SPEED-RULES families (§A), before the first Codex request

| family | finding |
|---|---|
| 1. redaction / secret collision | nothing new is logged. The new step prints a bare local image tag; the new `prepare` value is an image tag, is not `trackSecret`ed (it is not a credential and registering it would make the redactor scrub a plain word), and appears in `candidate.json`, which is already-published evidence. |
| 2. vacuous control | the shape reds are mutation-proved (42/2 vs 42/0) with anchor assertions; the journey refusals carry a passing positive control that reaches the next step. |
| 3. bounds and deadlines | the build inherits the job's `timeout-minutes: 150`; a Go cross-compile of one binary is minutes, and run `36047740323` completed the whole keyless journey inside it. |
| 4. replay / idempotency | the build is content-addressed by Docker's cache and `-t` is fixed; a re-run rebuilds or re-tags the same thing. |
| 5. crash windows / ordering | the export happens only after `docker image inspect` proves the tag resolves, so a partial build cannot publish a name that nothing backs. |
| 6. authentication of the right half | the pin is on the **peeled commit** (`07c3a429bfed…`), the half that cannot be moved, not on the annotated tag object (`01ce918d…`) a re-pin naturally reaches for; the Dockerfile `test`s the checkout against it and aborts. |
| 7. record rot | every code claim here is cited by file + symbol; the two-sided register delta is recomputed against the merge ref in §8. |
| 8. fail-closed on missing input | the compose default became `:?`; `prepare` refuses absent and registry-shaped values; the build's failure is fatal and `docker image inspect` closes the produced-nothing gap. Nothing was made best-effort. |

## 10. Not claimed

- **No keyed dispatch was made**, and nothing here is evidence about keyed spend, E2B or the fault
  matrix. Those are the planning session's.
- This does **not** claim the D1 lane changed. `docker-compose.d1.yml` and
  `docker/m1-boot/docker-compose.m1-boot.yml` are separate stacks and the D1 half of `E6-F021` is
  untouched — deliberately, per §3's asymmetry.
- It does **not** claim the `pgvector/pgvector:pg18` default is safe in the long run, only that it is
  currently pullable and out of this ruling's scope (§2).
- It does **not** claim the new shape clauses were exercised by run `36047740323`; see §6's third
  star.
