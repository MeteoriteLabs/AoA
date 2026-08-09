# TEN-005 Result — Tenant adversarial property suite

**Status:** `gate_review`
**Date (UTC):** `2026-08-09`
**Epic:** `E2-tenant-kernel`
**Plan task:** `TEN-005 — Tenant adversarial property suite (M) — surface scope E2-D04 / finding E2-F003`
**Implementer:** `claude-opus (implementer subagent)`
**Start SHA:** 3fb4c368001a7ba8a6be57e49fce415f67de212a

The Start SHA is the actual `git rev-parse HEAD` of the C:\e2 worktree captured
before the first change. Plan §0 lists `df509b946` as the "E2 Start SHA"; that commit
is an ancestor of this HEAD (TEN-001a/b, TEN-004, TEN-006a/b, TEN-002 + E2-F011 fix,
TEN-003 + E2-F012 confirmation have since landed). Mirrors the TEN-001/002/003/004/006
convention.

**Preconditions verified:** TEN-003 (`runInTenant`) and TEN-004 (composite FKs) are
`complete` on the branch; TEN-002 (non-owner `aoa_app` role + FORCE RLS + per-table
policies + `createTenantAppDb` fail-closed pool + migration `0211`) underpins them.
E2-D04 (surface scope + uniform denial + null-Org read) governs this ticket;
`AOA_RUN_WIN_INTEGRATION` env-hatch per E2-D05.

## Delivered scope

- **`server/src/testing/tenant-graph.ts`** — a deterministic, seed-reproducible tenant
  graph generator + hostile-identifier corpus + surface registry. **No `Math.random` /
  no wall-clock** — a seeded **mulberry32** PRNG plus the seed integer derives every
  value (ids, counts, slugs, prefixes), so the same seed reproduces a **byte-identical**
  graph. Exports:
  - `generateTenantGraph(seed, opts?) → TenantGraph`: **4–6 Organizations** (count is
    PRNG-drawn from the seed, bounded by `minOrgs`/`maxOrgs`), each with companies +
    `jobs` / `job_attempts` / `leases` / `services` / `service_instances` /
    `job_artifacts` / `job_secret_handles` + org-scoped `workers`, PLUS graph-level
    **platform (null-Org) `workers`**. Emits typed **row descriptors** (ids + org/company/
    parent linkage) so the suite seeds them with EXPLICIT ids and can cross-reference
    tenants. Slugs (`s{seed}-org{n}`) and issue-prefixes (`T{seed}O{n}C{n}`) embed the
    seed so many graphs coexist in one DB without tripping `organizations_slug_uq` /
    `companies_issue_prefix_idx`.
  - `buildHostileCorpus(graph, actorOrgId) → HostileCorpus`: for an actor tenant, the
    other-tenant ids per accessor type (cross-Organization, cross-Company-within-other-
    org), the forbidden sentinel Organization (`FORBIDDEN_SENTINEL_ORG_ID` =
    `…000000000001`), the null-Org platform worker ids, plus valid-format-but-**absent**
    uuids and **malformed** ids.
  - `TENANT_ADVERSARIAL_SURFACES`: the surface registry — `repository` + `composite_sql`
    `implemented: true`; `http` / `worker_events` / `websocket` / `object_key` /
    `placement` / `restore` `implemented: false` with the owning epic in `note` (E2-D04,
    no silent cap; later epics flip these + register drivers).
  - `TENANT_ADVERSARIAL_SEEDS`: the fixed **8-seed** set `[1, 7, 13, 42, 101, 1337,
    20260809, 2147483647]`.
- **`server/src/__tests__/tenant-adversarial.property.integration.test.ts`** — the
  capstone H-01 adversarial property suite (E2-D05 env-hatch embedded-PG). For **each of
  the 8 seeds**, seeds the graph as the SUPERUSER (RLS-bypassing) then, acting through
  the NON-OWNER `aoa_app` pool inside `runInTenant` / `withTenantTx`, hurls the hostile
  corpus at the E2-available surfaces and asserts **fail-closed with no existence
  disclosure** (see Acceptance). **4,244 adversarial ops** across the 8 seeds
  (414–647/seed), every op class exercised ≥ once (non-vacuous).
- **`server/src/__tests__/tenant-graph-unit.test.ts`** — Windows-visible unit sibling:
  generator determinism (same seed → byte-identical; different seeds differ; options
  honored), intra-tenant referential integrity, uuid-format + global uniqueness of
  ids/slugs/prefixes (incl. across seeds), corpus shape, and surface-registry shape.

**E2-D04 surface-scope note (recorded, no silent cap):** the surfaces that EXIST at E2
and are exercised here are **`repository`** (tenant repositories via `runInTenant` over
the non-owner pool + forced RLS — TEN-002/TEN-003) and **`composite_sql`** (direct-SQL
mixed-tenant construction rejected by the TEN-004 composite FKs — 23503). **`http`** is
not exercised because no HTTP endpoint reads/writes a new-path table at E2 (entry-point
adoption rides E3 per E2-D04); **`worker_events`/`websocket`/`placement`** (E3/E4),
**`object_key`** (E5), and **`restore`** (E6) are registered NOT-implemented for later
epics to extend the SAME harness. The **full D1 floor** (`D1-01`: 20 seeds × 10,000 ops
× ≥10 Organizations, `test-gates.md`) is owned by the **D1 gate**, NOT E2.

**Audit note (E2):** at E2 there is **no audit sink** for these DB-level RLS denials
(activity-log wiring is E3). "Failures are audited where a sink exists" is therefore
**vacuously satisfied** — no audit path is fabricated.

**Non-goals preserved:**
- **No schema/migration change** — the migration chain still caps at `0211` (`git diff
  --stat` empty; only 3 new untracked files). **No** route/scheduler wiring.
- **No change** to the TEN-002 RLS policies, `rls-tenant.ts`, `runInTenant`,
  `with-tenant-tx.ts`, the tenant repository, `createDb`, `rls-bootstrap.ts`, or
  `assertCompanyAccess`. **No uniform-denial normalization was added** — the tenant
  repository accessors are plain RLS-backed `tx.select`/`insert` with NO existence-
  revealing pre-check and NO catch-and-differentiate (verified by reading
  `packages/db/src/repositories/tenant/index.ts`), so uniform denial holds NATURALLY
  (no leak found → no normalization needed; §Deviations).
- No new dependency; **no `package.json`/`pnpm-lock.yaml` change** (AGENTS §7 N/A).
- Caveat/credential/target impact: *N/A — E2 introduces no placement, credential,
  provider, or locality logic; CAV-005: no legacy RLS retrofit; provider-neutral seam
  untouched.*

## Changed files

| File | Responsibility |
|---|---|
| `server/src/testing/tenant-graph.ts` | **New.** Deterministic seeded generator + hostile corpus + surface registry + SEED set. |
| `server/src/__tests__/tenant-adversarial.property.integration.test.ts` | **New.** Embedded-PG H-01 adversarial property suite (8 seeds × hundreds of ops). |
| `server/src/__tests__/tenant-graph-unit.test.ts` | **New.** Windows-visible determinism + corpus/registry shape unit proof. |

## Acceptance evidence

Property suite `tenant-adversarial.property.integration.test.ts`, embedded-PG,
`AOA_RUN_WIN_INTEGRATION=1` → **11 passed**. Unit sibling → **10 passed**. Op counts
(deterministic, identical on re-run): `totalOps=4244`,
`perClass={crossRead:2688, absentRead:288, crossList:640, crossInsertReject:72,
crossUpdateZero:144, crossDeleteZero:144, updateToOtherOrgReject:36, nullOrgReadZero:144,
nullOrgWriteReject:72, compositeSqlReject:16}`,
`perSeed={1:647, 7:414, 13:647, 42:647, 101:414, 1337:414, 20260809:414, 2147483647:647}`.

| Acceptance condition (plan §TEN-005 / E2-D04) | Evidence | Result |
|---|---|---|
| **READ** — another tenant's row by id → `null`, and an absent id → `null`, and the two are **indistinguishable** (both null), across all 8 accessor types | integration per-seed it, `crossRead=2688` / `absentRead=288` ops, `check()` asserts `crossRes === absentRes === null` | `pass` |
| **READ (list)** — `listForCompany(otherOrgCompany)` → `[]`; `listForOrganization(otherOrg)` → `[]` | `crossList=640` ops → all length 0 | `pass` |
| **WRITE (insert)** — `repos.jobs.insert({ organizationId: OTHER_ORG, … })` in actor context → **42501** (RLS WITH CHECK) | `crossInsertReject=72`; `expect(sqlstate).toBe("42501")` | `pass` |
| **WRITE no-disclosure** — cross-insert 42501 is IDENTICAL whether the referenced company exists (real victim company) or not (absent uuid); deepest DB message identical + never echoes a victim id | real vs absent SQLSTATE both 42501 + `pgDeepestMessage` equal = `new row violates row-level security policy for table "jobs"` (logged) | `pass` |
| **WRITE (update-to-other-org)** — UPDATE the actor's own row to OTHER_ORG → **42501**; same class as cross-insert | `updateToOtherOrgReject=36`; `expect(sqlstate).toBe("42501")` and equals cross-insert SQLSTATE | `pass` |
| **UPDATE/DELETE cross-tenant by id → 0 rows** (RLS USING hides it — indistinguishable from an absent id) | `crossUpdateZero=144` / `crossDeleteZero=144`; `RETURNING id` rows length 0 for cross AND absent | `pass` |
| **null-Org read** — no tenant GUC returns a platform (org-NULL) worker (by `IS NULL` filter or by id) | `nullOrgReadZero=144` → all counts 0 | `pass` |
| **null-Org write** — `aoa_app` cannot INSERT or UPDATE a worker to org NULL → **42501** | `nullOrgWriteReject=72`; `expect(sqlstate).toBe("42501")` | `pass` |
| **composite_sql** — direct-SQL mixed-tenant construction rejected by the TEN-004 composite FKs → **23503** (`jobs_org_company_fk`, `job_attempts_org_job_fk`) | `compositeSqlReject=16`; `expect(sqlstate).toBe("23503")` + constraint name | `pass` |
| **Non-vacuous** — ≥2 orgs/seed, non-empty corpus, ≥1 op per class, ≥100 ops/seed | dedicated `it`: every `opCounts[*] > 0`, every `perSeedOpCounts[*] ≥ 100`, total ≥ 800 | `pass` |
| **Determinism** — reproducible from the fixed seeds | unit: `JSON.stringify` byte-identical same-seed / differs cross-seed; integration re-run → identical `totalOps=4244` + per-class counts | `pass` |
| **Serving role is non-owner** (else the whole suite is vacuous) | `assertNonOwnerConnection(appDb)` resolves; `(db)` rejects | `pass` |

**Uniform denial (E2-D04) — how "identical across read/write/absent" is proved:** the
operationally-precise, load-bearing property is **per-operation-KIND
indistinguishability of a cross-tenant target from an absent target** — a cross-tenant
READ ≡ absent READ (both `null`/`[]`), and a cross-tenant WRITE ≡ absent-related WRITE
(both `42501`, byte-identical DB message). This is exactly "no existence disclosure": the
caller cannot tell whether an id belongs to another tenant or does not exist. It holds
naturally because the repository is RLS-backed with no leaky pre-checks (no normalization
added).

## Commands

| Command | Exit | Result |
|---|---:|---|
| `pnpm --filter @armyofagents/db typecheck` | `0` | clean |
| `pnpm --filter @armyofagents/server typecheck` | `2` | **66** errors, **all** `@armyofagents/plugin-sdk` (E2-F009); **zero** reference `tenant-graph`/`tenant-adversarial` (grep clean); zero non-plugin errors |
| `vitest run tenant-graph-unit.test.ts` (RED, pre-impl) | `1` | `Cannot find module '../testing/tenant-graph.js'` |
| `AOA_RUN_WIN_INTEGRATION=1 vitest run tenant-adversarial.property.integration.test.ts` (RED, pre-impl) | `1` | fails to load — `../testing/tenant-graph.js` missing |
| `vitest run tenant-graph-unit.test.ts` (GREEN) | `0` | **10 passed** |
| `AOA_RUN_WIN_INTEGRATION=1 vitest run tenant-adversarial.property.integration.test.ts` (GREEN) | `0` | **11 passed**; `totalOps=4244`, 8 seeds, every op class > 0 |
| `vitest run tenant-adversarial.property.integration.test.ts` (NO flag) | `0` | **11 skipped** (E2-D05 env-hatch `skipIf`, not the banned ternary) |
| `AOA_RUN_WIN_INTEGRATION=1 vitest run tenant-adversarial.property.integration.test.ts` (re-run, determinism) | `0` | **11 passed**; **identical** `totalOps=4244` + per-class/per-seed counts |
| `vitest run integration-test-hygiene.test.ts` | `0` | **2 passed** (my `skipIf` form + comments not flagged) |
| `AOA_RUN_WIN_INTEGRATION=1 vitest run tenant-rls-enforcement + tenant-tx-context` | `0` | **17 passed** (TEN-002 10 + TEN-003 7 — no regression) |

**Seed count:** 8 (`TENANT_ADVERSARIAL_SEEDS`). **Ops per class (total across 8 seeds):**
crossRead 2688, absentRead 288, crossList 640, crossInsertReject 72, crossUpdateZero 144,
crossDeleteZero 144, updateToOtherOrgReject 36, nullOrgReadZero 144, nullOrgWriteReject 72,
compositeSqlReject 16 → **4244 total**.

## Deviations

1. **Raw-SQL ops via `withTenantTx` / superuser `db`.** The tenant repository surface
   deliberately exposes only `insert` / `getById` / `listFor*` (no update/delete/raw —
   TEN-001a). So READ + cross-INSERT ops go through `runInTenant` (the repository
   surface), while **UPDATE/DELETE-to-0-rows**, **update-to-other-org**, the **null-Org
   read/write** checks, and the **composite_sql** bypass are driven via `withTenantTx`
   (the same non-owner-pool primitive `runInTenant` is built on — TEN-003) or the
   superuser `db` (for the direct-SQL app-bypass, the TEN-004 surface). The RLS
   enforcement path is identical; mirrors the TEN-003 test's use of `withTenantTx` for
   raw SQL. Not a plan deviation — an interface consequence of the read-only repository.
2. **"No error message reveals existence" asserted on the DEEPEST PostgresError message,
   not drizzle's wrapper.** drizzle's `DrizzleQueryError.message` echoes the failing
   query + the params the CALLER supplied (the caller's OWN input — never a DB
   disclosure), so a naive substring check on it self-trips. The meaningful assertion is
   on the raw PostgresError leaf message (`pgDeepestMessage`), which for both the
   real-company and absent-company cross-inserts is the byte-identical RLS text `new row
   violates row-level security policy for table "jobs"` — no ids, no row contents.
3. **Uniform-denial interpretation (per-KIND indistinguishability).** E2-D04 frames it as
   "identical across a cross-tenant read, a cross-tenant write, and a truly-absent row." A
   READ returns `null` while a WRITE throws `42501` — these differ by operation KIND. The
   security-load-bearing, faithful reading (and what the ticket's own detailed bullets
   spell out) is that **within each kind** a cross-tenant target is indistinguishable
   from an absent one — implemented and asserted exactly (READ: null≡null; WRITE:
   42501≡42501 with identical DB message). Recorded so the reviewer can confirm the
   framing.
4. **Malformed uuids kept in the corpus but not used for the indistinguishability core.**
   The corpus includes malformed ids (shape asserted in the unit test), but the property
   suite drives indistinguishability with valid-format **absent** uuids: a malformed uuid
   is `22P02` input-validation (tenant-independent), a different class from existence
   disclosure — kept separate to avoid conflation.

## Findings

- **None new.** No leak was found in the tenant repository accessors, so no uniform-denial
  normalization was added (E2-D04 permits it "ONLY IF you find a leak").
- **E2-F009 (pre-existing)** re-confirmed unchanged: `pnpm --filter server typecheck`
  exits 2 with 66 errors, ALL `@armyofagents/plugin-sdk` / plugin subsystem; grep for
  `tenant-graph`/`tenant-adversarial` over the error output → none. DEC-03-waivable /
  subset-of-baseline.
- **E2-F012 (informational)** — the suite drives every new-path access through
  `runInTenant` / `withTenantTx` with the context ALWAYS set to a valid uuid, so it never
  encounters the reused-connection `22P02` fail-closed path (as E2-F012 itself notes);
  no uniform-denial concern.

## Follow-up tickets

`None` — later epics (E3/E4/E5/E6) extend `TENANT_ADVERSARIAL_SURFACES` with their new
surfaces; the full D1-floor cross-surface run is the D1 gate's (E2-D04), not a TEN-005
follow-up.

## Gate recommendation

`ready for independent review` — the adversarial property suite is proved on real
embedded-Postgres over the non-owner `aoa_app` pool for all **8 fixed seeds** (4,244
deterministic ops, identical on re-run): cross-tenant reads are indistinguishable from
absent reads (null≡null), cross-tenant lists are empty, cross-tenant inserts +
update-to-other-org fail closed at `42501` **identically whether or not a related row
exists** (byte-identical RLS DB message, no id echo), cross-tenant UPDATE/DELETE affect 0
rows, no tenant GUC ever returns a platform null-Org worker and `aoa_app` cannot write one
(`42501`), and direct-SQL mixed-tenant construction is rejected by the composite FKs
(`23503`). The serving role is asserted non-owner (else vacuous); every op class ran ≥
once; the graph/corpus are seeded from a PRNG (no `Math.random`/wall-clock). No schema/
migration/policy/repository change (`git diff --stat` empty; chain caps at 0211); TEN-002/
TEN-003 suites do not regress; hygiene green; env-hatch skips cleanly without the flag.
Reviewer should scrutinize: (1) the per-KIND uniform-denial interpretation + that the
DEEPEST DB message is truly identical real-vs-absent (Deviations 2/3); (2) that the suite
is genuinely non-vacuous (op-class counters + the non-owner assertion — remove FORCE/
policies and the null/0-row assertions would flip); (3) that `withTenantTx`/superuser raw
SQL for update/delete/null-Org/composite is the same RLS path (Deviation 1); (4) that a
real Linux run is still owed for H-01 at the E2 gate (E2-D05/E2-F008 — Windows-local
evidence here).

## Independent review

**Reviewer:** `claude-opus (independent reviewer subagent)` — distinct identity from the implementer (`claude-opus (implementer subagent)`); did not author the suite.
**Reviewed revision:** `664daadc9c8d9fb86235bf2eb79cbd8bb377203b` (HEAD of `claude/epic-e2-tenant-kernel`).
**Disposition:** `changes_requested`
**Review evidence:** Re-run acceptance (Windows-local, embedded-PG 18.1) all reproduce: `pnpm --filter @armyofagents/db typecheck` → 0; `pnpm --filter @armyofagents/server typecheck` → 2 (66 errors, all in the plugin subsystem `plugins.ts`/`plugin-host-services.ts` = E2-F009 baseline; grep `tenant-graph|adversarial` → none); `tenant-graph-unit.test.ts` → 10 passed; `AOA_RUN_WIN_INTEGRATION=1 … tenant-adversarial.property.integration.test.ts` → 11 passed, `totalOps=4244`; **determinism re-run → 11 passed, identical `totalOps=4244` + identical per-class/per-seed counts**; no-flag → 11 skipped; regressions (`tenant-rls-enforcement` + `tenant-tx-context`, flag on) → 17 passed. Observed SQLSTATEs: cross-org insert + update-to-other-org + null-Org write = `42501` (RLS `WITH CHECK`); composite_sql = `23503`; cross-insert deepest DB message byte-identical real-vs-absent (`new row violates row-level security policy for table "jobs"`). **Non-vacuity CONFIRMED:** every op-class counter > 0; the serving role is asserted non-owner (`assertNonOwnerConnection(appDb)` resolves, `(db)` rejects); the write-path assertions genuinely depend on RLS (the update-own-row-to-other-org → 42501 and own-worker-to-null → 42501 ops only throw if the USING clause ADMITS the actor's own row, so they prove RLS admits the actor while denying cross/null — remove the policy/FORCE and those flip). **However — CHANGES_REQUESTED** on a real, untested existence-disclosure vector (E2-F013): the suite does not discharge its own acceptance (`implementation-plan.md:410-413` / E2-D04 `decisions.md:218-222`) that the denial shape be **identical** across cross-tenant read/write/absent "so no guard's identity (FK vs RLS vs not-found) leaks." I reproduced on embedded-PG as `aoa_app`/GUC=orgA that an **own-org** insert referencing another tenant's company → `23503 jobs_org_company_fk`, while an **absent** company → `23503 jobs_company_id_fkey` — distinguishable by `constraint_name` and message text (a cross-Company existence oracle on the sanctioned `repos.jobs.insert` path). The suite only tests the cross-ORG insert (uniform 42501) and never the own-org+cross/absent-company case; the required repository normalization was not implemented (result §Non-goals: "no normalization added … no leak found"), and Deviation 3's per-KIND reinterpretation sidesteps the write-vs-write axis where the leak lives. Systemic across job_attempts/leases/services/service_instances/job_artifacts/job_secret_handles (all carry redundant single-column FKs). See findings.md#E2-F013 for the file:line evidence and fix options. Suite mechanics (determinism, non-owner serving, null-Org, composite_sql, RLS 42501 uniformity, no-flag skip) are otherwise sound; the gap is coverage of the FK guard-identity leak + the misclaim of "no leak."

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

## Review attempt history

The implementation author leaves the table body empty; the explicit pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt for existing gate tooling. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it. Repository history identifies that commit, and handoffs pin the resulting ticket-result blob SHA.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
| 1 | `claude-opus (independent reviewer subagent)` | `664daadc9c8d9fb86235bf2eb79cbd8bb377203b` | `changes_requested` | Acceptance re-runs all reproduce (db typecheck 0; server typecheck 66 = E2-F009 baseline, none reference TEN-005 files; unit 10 passed; property 11 passed `totalOps=4244`; **determinism re-run identical 4244** + per-class/per-seed; no-flag 11 skipped; TEN-002/003 regressions 17 passed). Non-vacuity + non-owner serving + null-Org + composite_sql confirmed. **Blocking finding E2-F013:** own-org insert referencing a cross-tenant company (`23503 jobs_org_company_fk`) is distinguishable from an absent company (`23503 jobs_company_id_fkey`) by constraint-name + message on the sanctioned `repos.*.insert` path — the exact FK-vs-RLS-vs-not-found guard-identity leak E2-D04 / plan `:410-413` require normalized to one shape and asserted absent. Suite tests only the cross-ORG insert (uniform 42501); normalization not implemented; result misclaims "no leak found." Reproduced on embedded-PG 18.1. Fix + file:line in findings.md#E2-F013. |
