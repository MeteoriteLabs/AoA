# E0–E2 current dependency/delta review (M1 Step 0, unit S0-7a)

**Date (UTC):** `2026-09-21`
**Milestone:** `M1a` (the entry bullet is shared by `M1b`)
**Measured revision (program tip):** `b71f0dd539fe713c776f3935932be33af1a24fae` (`origin/docs/replatform-program`)
**Reviewer:** a distinct review session (Claude Opus 5). It did not author E0, E1, E2 or the M1 plan.
**Serves:** the scope-triage entry bullet *"E0–E2 historical completion evidence has passed a current
dependency/delta review, including superseding records for any immutable-record breach"*
(`epic-regrooming/scope-triage.md` → *Entry criteria*), and recovery step 2 of
`epic-regrooming/qa-handoff-recovery.md` (*"Perform current dependency/delta checks for historically
complete E0–E2"*).

> ★★★ **THIS IS NOT A QA RECORD AND NOT A HANDOFF, AND IT GRANTS NOTHING.** It reviews existing
> evidence and classifies it (recovery §2: `adoptable` / `delta_required` / `historical_only` /
> `invalid_record`). It changes no epic's status. Only the Integration Gate Owner flips a status,
> and only on committed `pass` QA and handoff records for an exact candidate.
>
> ★ **Why it lives here and not under `qa/` or `handoffs/`.** Neither `qa-handoff-recovery.md` nor
> `milestones/README.md` names a path for a delta review. `qa/` and `handoffs/` under
> `epics/*/` and `milestones/*/` are immutable-evidence paths governed by `EVID-04`
> (`test-gates.md`) and enforced by `scripts/check-evidence-immutability.mjs` (`EVIDENCE_RECORD_RE`).
> A delta review is not a gate run and has no `Result` or `Decision` to give. It is also measured
> against a moving tip, so it must be re-run against the frozen candidate. Filing it as an
> immutable record would make that re-run a new attempt of a record type the templates do not
> define. It belongs to no single epic, so it is placed in the milestone folder, beside the
> records it feeds and outside the two immutable subfolders.

## Verdict

| Part of the entry bullet | State at `b71f0dd539fe` |
|---|---|
| Current dependency/delta review of E0, E1 and E2 | **Done (this document).** No measured change invalidates any E0, E1 or E2 completion claim. Each epic is `delta_required`, not `adoptable`, because its gate-dependency files have changed since its pinned revision. The changes were read, and the gate suites re-execute green in Linux CI on a tree whose code is identical to the tip (§4). |
| Superseding records for every immutable-record breach | ★★★ **NOT MET.** One breach class in E0–E2 is owed a superseding record that **does not exist**: the E2 `a5` QA and handoff pair (§5). The **E2 `a6` QA record and `a6` handoff are owed.** This review does not create them, because a QA record needs a gate owner and a rerun or a stated carry-forward. |

**So the entry bullet is not yet satisfied.** It becomes satisfiable when the E2 `a6` pair is
committed. That is a gate-owner action. Under ruling F2 it is taken by the planning session and
certified by a distinct QA session. **Before the M1a candidate is frozen, this review must also be
re-run from each pinned revision to the frozen candidate** (§6), because the tip will move.

---

## 1. Method (every figure below comes from these commands)

1. **Pinned revisions.** Each revision is read from the `**Revision:**` / `**Reviewed revision:**` /
   `Candidate code revision` fields of the committed records. `git merge-base --is-ancestor` was run
   for each one against the tip, and each is an ancestor.
2. **Gate-dependency set per epic.** The non-`docs/` files changed between the epic's recorded
   start SHA and its completion revision (`git diff --name-only <start>..<completion> | grep -v '^docs/'`).
   These are the epic's own deliverables and gate suites. Documentation authorities that the E0
   checker reads are covered by re-running that checker, not by path.
3. **Delta.** `git diff --stat <completion>..origin/docs/replatform-program -- <set>`, then reading
   every change that touched a gate-relevant file. **Removed lines are read first**, because a
   weakened control shows up as a removal.
4. **Current execution.** The E0 and E1 pure-node gate checkers were run locally at the tip. The
   repository gate suites were read from the Linux CI `verify` shard logs of PR #528's `PR` run
   `35572455312`. That run's head is `24eefabb1f4b3466bc5d0795534e735af4f525c2`, and
   `git diff --name-only 24eefabb1f4b <tip>` lists **only** `docs/` paths (measured: 0 non-doc paths).
   A `pull_request` run executes GitHub's merge ref, not the head itself. This is Linux re-execution
   evidence. It is not an exact-candidate record.
5. **Breaches.** `git log --oneline origin/docs/replatform-program -- <file>` was run on every file
   under `epics/E{0,1,2}-*/{qa,handoffs}/`. More than one commit on a non-README record is a rewrite.
   `--follow` was **not** used for the count, because it reports copy-detection false positives
   (see §5, E1 `a2` handoff).

## 2. E0 — Foundation

**Completion chain.**

| Record | Revision | Verdict | Classification |
|---|---|---|---|
| `qa/2026-08-08-d0-e0-completion-3a469b6bec68-a1.md` | `3a469b6bec687a3055360dcd657df45b7d20ba88` | `Result: pass` | `delta_required` |
| `handoffs/2026-08-08-epic-completion-3a469b6bec68-a1.md` | same | `Decision: pass` | `delta_required` |
| `qa/2026-09-14-d0-pre-guard-rewrite-grandfather-a1.md` | none in the filename | grandfather ruling | accepted filename debt (recovery banner) |
| `qa/pre-existing-failure-baseline.md` | none | advisory Windows seed | accepted filename debt (recovery banner) |

**Gate-dependency set.** `c24fc57fff11..3a469b6bec68` contains 48 non-doc files. **16 of them have
changed since `3a469b6bec68`.** Those 16 are `.github/workflows/pr.yml`, `AGENTS.md`, `package.json`,
`scripts/check-distributed-execution-foundation{,.test}.mjs`, `server/src/app.ts`,
`server/src/config.ts`, `server/src/config/distributed-execution.ts`, `server/src/index.ts`,
`server/src/mcp/tools/plugin-broker-tools.ts`, `server/src/routes/{company-plugins,plugins}.ts`,
`server/src/services/plugin-lifecycle.ts`, and three test files (`config.test.ts`,
`distributed-execution-exclusions.test.ts`, `plugin-broker-cloud.integration.test.ts`). The
`cloud-plugin-execution.ts` and `unsandboxed-multitenant-guard.ts` controls are **unchanged**.

**What changed, read at source.**
- **`assertHostedExecutionStartupSafe`** (`server/src/config/distributed-execution.ts`) — the EXIT-02
  and H-07 control. It was refactored to throw `HostedExecutionStartupUnsafeError` with a
  `reason` code, and it now returns an outcome. It still refuses both excluded surfaces
  (`excluded_surface_enabled`) and `AOA_ALLOW_UNSANDBOXED_MULTITENANT` in `cloud_auth`
  (`unsandboxed_multitenant_in_cloud_auth`). It **adds** two refusals: `distributed_database_url_missing`
  and `env_flag_unparseable`. **No refusal branch was removed.**
- **`rejectBlockedCloudExecution`** (`server/src/routes/plugins.ts`) — the CP-003/CP-004 route gate.
  Every call site still rejects. The change adds a best-effort `recordCloudPluginDenial` audit
  (DE-16, PRs #433/#446/#450). This is additive.
- **Cloud-plugin boot reconcile** (`plugin-lifecycle.ts`, CP-002). The bare `registry.updateStatus`
  was replaced by `reconcileOnePluginToBlocked`, which performs a `FOR UPDATE` lock plus the status flip plus
  the audit row in one transaction. It still ends in the blocked state. This is a strengthening.
- **`scripts/check-distributed-execution-foundation.mjs`** (EXIT-01/03/04/05) grew by about 1,100 lines.
  At the tip it prints `distributed execution foundation: PASS` (exit 0). Its test corpus is
  `229/229` (it was `169/169` at completion). `check-bundled-snapshot-inputs` is `PASS` with `12/12`.
  All were run locally at the tip.

**Current Linux execution (the DEC-03 caveat the record left open).** The E0 QA record said the
gate was Windows-local only, and that a Linux-CI result *"would supersede this record if a Linux-CI
run differed"*. In run `35572455312` the seven embedded-PG cloud-denial suites that made up the
86/86 are green on Linux. Jobs: `verify (1)` 106246853762, `verify (2)` 106246853780,
`verify (3)` 106246853760, `verify (4)` 106246853693. The suites are `plugin-broker-cloud.integration` 7,
`cloud-plugin-runtime-exclusions.integration` 7, `cloud-plugin-process-composition` 7,
`plugin-tenant-routes` 44, `cloud-external-adapter-execution` 6, `plugin-ui-static-tenant-scope` 10
and `distributed-execution-exclusions` 5, which total **86**. So do `cloud-plugin-execution` 13,
`cloud-plugin-runtime-exclusions` 8, `unsandboxed-multitenant-guard` 11,
`distributed-execution-policy` 17 and `config` 21 (it was 15). The `policy` job (106246794582) prints
`distributed execution foundation: PASS`. **The Linux result does not differ**, so the record's own
supersede condition is not triggered.

**Post-completion findings.** `E0-F010` through `E0-F019` were filed between 2026-09-08 and
2026-09-21. **All ten are `open`.** They are about the trust-crossing register's
**delivery** claims: audit clauses with no deny-path record, arming paths with zero callers,
mechanisms no code attempts, and retention that is not enforced. E0's EXIT-04 claim was
**structural**: every crossing has its 13 control fields and every Critical/High crossing names a release-test owner. That
claim still holds, because the foundation checker enforces it at the tip. **Consequence:** the E0
completion must not be cited as evidence that any DE crossing is delivered. That question belongs
to the register and to the E0 findings.

**E0 conclusion.** `delta_required`. **No change invalidates an E0 completion claim.** The one
revision-scoped sentence is H-07's *"no distributed runtime is constructed at this revision"*. It
was true at `3a469b6bec68` and is historical now. A distributed runtime exists behind
`AOA_DISTRIBUTED_EXECUTION_ENABLED`. H-07's actual invariant, that the excluded surfaces and the
override are impossible, is still enforced by the unchanged refusal branches.

## 3. E1 — Worker protocol

**Completion chain.**

| Record | Revision | Verdict | Classification |
|---|---|---|---|
| `qa/…-93c5e9f2763a-a1.md` + `handoffs/…-93c5e9f2763a-a1.md` | `93c5e9f2763a…` | `fail` (E1-F007) | `historical_only` (a superseded fail) |
| `qa/…-b03262692882-a2.md` + `handoffs/…-b03262692882-a2.md` | `b03262692882a7ce17834131ad358d3aecf07f5b` | `pass` | `delta_required` — **the E1 completion** |
| `qa/…frozen-checker-correction-{4fa9df3f0845-a3,127247f54271-a4,7d649a01802b-a5}.md` + matching handoffs | `Reviewed revision: TBD` | `awaiting_review` | `historical_only`: unaccepted candidates, preserved on purpose |
| `qa/…frozen-checker-correction-01ad1ab554fe-a6.md` + `handoffs/…-01ad1ab554fe-a6.md` | reviewed `01ad1ab554fe25c5178c7552ec047d4df45b7dcf`, code `7d649a01802bc2062e91ded370ec7d6385c72931` | `pass` | **`adoptable`** for its narrow scope (the E1-F008 frozen-consumer checker correction) |

★ The `a3`–`a5` corrective QA records carry `Result: awaiting_review`, which is not one of the
three verdicts the QA template allows. They are candidate records that were never accepted. `a6`
supersedes them, and they are preserved as history. **Not a breach, and nothing is owed.**

**Gate-dependency set.** `c32bbe087368..b03262692882` contains 71 non-doc files. **9 have changed**
since `b03262692882`: `.gitattributes`, `.gitignore`, `.github/workflows/pr.yml`, `package.json`,
`pnpm-lock.yaml`, `vitest.config.ts`, `scripts/check-frozen-worker-protocol-consumer{,.test}.mjs`
(the accepted E1-F008 correction), and **one** package file, `packages/worker-protocol/src/capabilities.test.ts`.
**No runtime file under `packages/worker-protocol/src/` has changed**, and neither has anything under
`docs/contracts/worker-protocol/`, `tests/fixtures/worker-protocol-consumers/` or
`tests/fixtures/worker-protocol-import/`. The correction's own 3 files are unchanged since
`7d649a01802b`.

**What changed, read at source.** `capabilities.test.ts` gained 156 lines in `70c0d39f5` (2026-08-24),
which is finding **`E1-F009`** (`resolved`, HIGH, test-only). At E1 completion, **five of
`workerSatisfiesRequirements`'s placement guards had no falsifiable test.** The `makePair` helper
caused every override-based case to be refused at the job-ref check before it reached the guard it
was named for. After the fix, 6 of 9 guards die when deleted, and 3 were checked as equivalent. The
`E1-F009` status line and the `70c0d39f5` commit message both say that no runtime source changed.
`git log b03262692882..tip -- packages/worker-protocol` lists four commits, and between them they
change only this one file.

**Current execution.** Locally at the tip: `check:frozen-worker-protocol-v1` →
`frozen worker-protocol v1 consumer: OK (sourceSha b7a842870ce7…, zod 3.24.2, esbuild 0.28.1)`;
`check-worker-protocol-boundary` → `PASS`; `update-worker-protocol-contract-manifest --check` → `OK`.
Linux CI run `35572455312`: the 17 `@armyofagents/worker-protocol` test files total **552** tests,
all green, including `capabilities.test.ts` with 53. The `Worker protocol package import smoke` step
prints `worker protocol package: PASS` in the `verify` shards. The `policy` job prints the frozen
consumer `OK` line.

**E1 conclusion.** `delta_required`. **No change invalidates an E1 completion claim.** The frozen v1
wire contract is byte-unchanged. ★ **Qualification:** the `a2` record's green test counts are
accurate, but they are **not evidence of the five placement guards' falsifiability** at
`b03262692882`. For those guards, cite `E1-F009` and the tip's `capabilities.test.ts`. Reviewer
judgment: this is a coverage gap recorded by a resolved finding. It is not a materially inaccurate
record, so **no successor record is owed** under recovery §3. The gate owner may rule otherwise.

## 4. E2 — Tenant kernel

**Completion chain.**

| Record | Revision | Verdict | Classification |
|---|---|---|---|
| `qa/…-acf2b32fba48-a1.md` + `handoffs/…-acf2b32fba48-a1.md` | `acf2b32fba48…` | `blocked_external` | `historical_only` |
| `qa/…-9a5455071f8c-a2.md` + `handoffs/…-9a5455071f8c-a2.md` | `9a5455071f8cf2cd17e0f68999c16aef77b94a21` | `pass` | `delta_required` — **the E2 completion** |
| `qa/…-920e55de5-a3.md`, `qa/…-d5abd1a53-a4.md` + matching handoffs | `TBD` | `awaiting_review` | `historical_only`, plus accepted 9-char filename debt |
| `qa/2026-08-10-d0-e2-tenant-kernel-21335854f-a5.md` + `handoffs/2026-08-10-epic-completion-21335854f-a5.md` | code `21335854f1fe33773b1ef70b4b5da9bc8f618f3f`, reviewed `7843b86e25eb1ff9c520308aef7f123fec6997a7` | `pass` | ★ **`invalid_record`**: rewritten after first commit (§5). **Superseding `a6` owed.** |
| `qa/pre-existing-failure-baseline.md` | none | advisory seed | accepted filename debt |

The `a3`–`a5` chain is the **serving-role correction** (E3 prerequisite P1). It does not re-open
the E2 epic gate. The E2 epic's completion claim is `a2`. `a5` is the accepted correction on top of it.

**Gate-dependency sets.** The E2 epic range `df509b946c5b..9a5455071f8c` contains 130 non-doc
files, and **32 have changed** since `9a5455071f8c`. The correction range `2c33cb220a4a..21335854f1fe`
contains 22 non-doc files, and **14 have changed** since `21335854f1fe`. They include
`server/src/db/{rls-tenant,tenant-context,with-tenant-tx,distributed-execution-databases,job-control-legacy-grants}.ts`,
`packages/db/src/{client,index}.ts`, `packages/db/src/repositories/tenant/index.ts`, eight kernel
schema files (`jobs`, `job_attempts`, `job_artifacts`, `job_secret_handles`, `leases`, `services`,
`service_instances`, `workers`), and `server/src/index.ts`.

**What changed, read at source.**
- **E2's own migrations are byte-unchanged.** `0210` through `0215` have no diff since `21335854f1fe`.
- **No later migration weakens the RLS posture.** In the `.sql` files numbered above `0215`, there
  is no `DISABLE ROW LEVEL`, `NO FORCE ROW LEVEL`, `ALTER POLICY` or `BYPASSRLS` grant. Every
  `aoa_app`/`aoa_operator` role statement asserts `NOSUPERUSER NOBYPASSRLS`. Of E2's 11 policies,
  two (`workers_platform_operator` and `execution_targets_platform_operator`) are dropped and
  re-created in `0221`, with **identical** `USING` and `WITH CHECK` predicates. No E2 policy is
  dropped without being re-created.
- **The startup authority audit is preserved.** `assertNonOwnerConnection` and
  `assertExactServingRoleAuthority` (`server/src/db/distributed-execution-databases.ts`) still run
  for both `aoa_app` and `aoa_operator`. They moved into a transaction.
- **`runInTenant`** (`server/src/db/tenant-context.ts`) still rejects an empty Organization and
  still opens through `withTenantTx`. JOB-010 made it also pass the raw transaction as a `Db`, so
  legacy service factories can run inside the tenant transaction. It also added `runInTenantReadOnly`.
  See the F10 note below.
- **Composite tenant FK: strengthened, and one constraint was renamed.** The pair
  `service_instances_org_service_fk` became the triple `service_instances_org_company_service_fk`
  (in `tenant-composite-integrity.integration.test.ts`, the service_instance case now asserts both
  the org and company mismatch arms). **Records at `9a5455071f8c` that cite the old constraint name
  cite a constraint that does not exist at the tip.** The property is stronger than before. Cite the new name.
- **The `aoa_app` grant surface has grown well beyond what `a5`'s *"complete effective authority"*
  audit attested.** The E3 job-control grants are one part of this. `JOB_CONTROL_LEGACY_GRANTS`
  (`server/src/db/job-control-legacy-grants.ts`) now grants `aoa_app` privileges on **40 legacy
  tables**, among them `issues`, `companies`, `cost_events`, `activity_log`, `approvals`,
  `artifacts` and `provider_credentials` (`0259`, table-level `SELECT`). `0261` separately grants
  `SELECT` on `instance_settings`. **None of these legacy tables has RLS.** On them, isolation is
  enforced by a **query predicate**, not by E2's RLS (the `0259` header says so for
  `provider_credentials`). This is a documented design choice (for example `DSK-001-lane-B-design.md`
  D-B3). It does not invalidate E2's claim, which is H-01 over the **kernel** tables. It does narrow
  what that claim can be cited for.

**Current Linux execution (E2-F008's deferred Linux H-01 run).** In run `35572455312`'s `verify`
shards, all of the following are green on Linux with real embedded PostgreSQL:
`tenant-rls-enforcement.integration` 10, `tenant-adversarial.property.integration` 11,
`e2-serving-role-correction.integration` 20, `distributed-execution-db-startup.integration` 74,
`@armyofagents/db` `tenant-composite-integrity.integration` 9, and `tenant-kernel-schema-b.integration` 7.
`E2-F008` was resolved by operator acceptance of Windows-only evidence (E2-D05 amendment). A Linux
H-01 execution now exists as CI evidence. It is **not** an E2 QA record.

**Post-completion findings.** `E2-F012` through `E2-F015` are all `resolved`.

**E2 conclusion.** `delta_required`. **No measured change invalidates E2's completion claim**
(kernel-table H-01 through forced RLS on the non-owner pool). Two things are owed:
**(1)** the `a6` superseding pair for the `a5` breach (§5), and **(2)** a note on what E2's H-01 can
be cited for under ruling F10 (below). There is no successor record for (2). It is a ledger note,
carried in the E3–E6 ledgers' tenant column.

> ★★★ **F10 (multi-tenant M1) consequence, stated once here.** M1 must prove that tenant A *"cannot
> lease, read, cancel or see B's jobs, events, secrets, staged inputs, outputs, **cost rows** or tool
> calls"*. E2's RLS covers the kernel tables and the later `*_rls` job tables. **It does not cover
> `cost_events`, `activity_log`, `issues`, `artifacts`, `task_outputs` or the other legacy tables
> that `aoa_app` can now read**, and `runInTenant` now lets legacy service code run inside the
> tenant transaction. Isolation for those rows is established only by query predicates. The M1 F10
> hostile matrix (`DEP-018`) must therefore exercise those rows directly, with a same-tenant
> positive control. It must not inherit the result from E2's RLS evidence.

## 5. Immutable-record breaches in E0–E2

Measured with `git log --oneline origin/docs/replatform-program -- <file>` on every record.

| Record | Commits | Breach? | Superseding record | Owed? |
|---|---|---|---|---|
| `E2-tenant-kernel/qa/2026-08-10-d0-e2-tenant-kernel-21335854f-a5.md` | 2: `7843b86e2` (add) → `6b1af52a4` (rewrite: +44/−23 across the pair, per `git diff --stat 7843b86e2 6b1af52a4`) | **Yes.** Grandfathered by the 2026-09-14 ruling (`GRANDFATHERED_REWRITES` in `scripts/check-evidence-immutability.mjs`). Any further touch is denied. | **None.** No `-a6` file exists under `E2-tenant-kernel/`. | ★ **YES: E2 `a6` QA record**, per recovery §4 |
| `E2-tenant-kernel/handoffs/2026-08-10-epic-completion-21335854f-a5.md` | 2: same pair | **Yes**, same ruling | **None** | ★ **YES: E2 `a6` handoff**, per recovery §4 |
| `E1-worker-protocol/handoffs/2026-08-09-epic-completion-b03262692882-a2.md` | 1 without `--follow` (`df509b946`). `--follow` reports 2 | **No.** `--follow` reports `9224bd771` as a copy-detected ancestor (`C051` from the `a1` file). The `a1` record is itself single-commit and unchanged. | n/a | no |
| every other record in `E{0,1,2}-*/{qa,handoffs}/` | 1 each | no | n/a | no |

**What the owed `a6` pair must contain** (recovery §4, bullet 2, and §3). This is stated so it is
not re-derived, and it is **not** a draft:
- `**Supersedes:**` naming both `a5` **paths** in full. `a5`'s own `Supersedes: a4` is not a path.
- The QA half needs the fields `a5`'s QA lacks: `**Attempt:**` and `**Revision:**` (`a5` has neither;
  it carries `Reviewed revision` and `Candidate code revision` in a table). The handoff half needs
  `**Reviewed revision:**`. Each half needs its verdict field (`Result` / `Decision`). Filenames need
  a 12-character SHA, which `a5` does not have.
- Pin the accepted implementation revision (`21335854f1fe…`) and review revision (`7843b86e25eb…`).
  State **which evidence was independently rerun and which was validly carried forward**. The Linux
  shards cited in §4 are rerun evidence on a later tree, not on `21335854f1fe`.
- It repairs provenance only. It does **not** erase the `a5` breach, and `a5` stays untouched.

**Other contract debt in E0–E2, not owed a superseding record** (the recovery banner's accepted
inventory): the 9-char filenames of E2 `a3`/`a4`/`a5`, the E0 grandfather record and the two
`pre-existing-failure-baseline.md` files. The **E2 `handoffs/README.md`** required by the folder
contract is missing. Adding it is purely additive and allowed. It is **owed**, and it is not
created here because it is outside this unit's brief.

**Out of scope, named so nothing is lost:** the E5 `a1` exit-gate audit rewrite (also grandfathered)
is owed its `a2` by S0-6 and the M1a campaign. It is not an E0–E2 record.

## 6. Re-run at candidate freeze

This review is measured at the tip `b71f0dd539fe`. At M1a candidate freeze, re-run §1 steps 2–5
with `origin/docs/replatform-program` replaced by the **frozen candidate SHA**. Re-read any
newly changed file in the four gate-dependency sets. Record the new counts next to the ones above.
Any change to `server/src/config/distributed-execution.ts`, `server/src/routes/plugins.ts`,
`server/src/db/*tenant*`, `server/src/db/distributed-execution-databases.ts`, `packages/db/src/migrations/`
(RLS, role and grant statements) or `packages/worker-protocol/src/` (non-test) requires reading the
**removed** lines before the entry bullet can be re-affirmed.
