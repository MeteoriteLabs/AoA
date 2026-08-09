# E2 — Tenant Kernel — Findings

Stable IDs `E2-F###`. Each finding records severity, evidence, affected tickets,
disposition, and whether it blocks the gate. Findings are never silently deleted; a
resolved finding retains its resolution link.

---

## E2-F001 — RLS/role/GRANT/FORCE security DDL exceeds the current C14 exception; TEN-002 needs E2-D01 locked first

- **Severity:** High (process/assignability gate — not a defect).
- **Status:** **RESOLVED 2026-08-09** — operator locked E2-D01 and it is promoted to `docs/architecture/decisions.md` #122; TEN-002 is unblocked on this axis.
- **Blocks gate:** No. **Blocked TEN-002 assignability** until E2-D01 was locked (now locked).
- **Evidence:** The C14 exception as written (CLAUDE.md Rule #1, `docs/architecture/decisions.md` Decision #19, `AGENTS.md` §6) permits hand-appended DDL for **only** idempotency guards and data backfills (exemplars `0189`, `0195`). E2's forced-RLS enforcement requires `CREATE ROLE`, `GRANT`, `FORCE ROW LEVEL SECURITY`, and `CREATE POLICY` — DDL that `drizzle-kit@0.31.10` **provably cannot emit** (recon: `FORCE` absent from the generator bundle; no `GRANT`/`REVOKE` emission; role generation gated off and never emits `LOGIN`/`PASSWORD`). Neither a pure idempotency guard nor a data backfill.
- **Affected tickets:** TEN-002 (primary), TEN-001/TEN-004/TEN-006 (mechanism reuse).
- **Disposition:** Resolved-by-decision. Proposed **E2-D01** extends C14 to cover idempotent RLS/role/GRANT/FORCE security DDL and is promoted to `docs/architecture/decisions.md`. **Requires the operator (Migration Custodian + Security Gate Owner) to lock E2-D01 before TEN-002 begins.** Not a STOP condition — the mechanism is clean and precedented (`rls-bootstrap.ts` proves the exact DDL); it is a governance ratification, not an architectural blocker.
- **Resolution link:** [decisions.md#E2-D01](decisions.md).

---

## E2-F002 — TEN-002 "no owner/superuser in the application container" is a boot-sequence + deployment change with cross-mode blast radius

- **Severity:** Medium (scope/risk flag for planning).
- **Status:** **RESOLVED 2026-08-09** — operator confirmed the whole-app non-owner role, flag-gated dormant-but-tested (E2-D03).
- **Blocks gate:** No.
- **Evidence:** The serving process today connects via a single owner/superuser pool (`packages/db/src/client.ts:46`) and auto-applies migrations at boot (`server/src/index.ts:246,262`). Satisfying "owner/superuser credentials are absent from the application container" + "Run application queries with a non-owner role" means moving *all* app queries onto a non-owner role and relocating migration-apply/runtime-DDL to a separate privileged phase — a change that touches every deployment mode's boot path.
- **Affected tickets:** TEN-002, TEN-003.
- **Disposition:** Addressed by **E2-D03** (whole-app non-owner role reconciled with CAV-005: legacy tables get full GRANTs + no RLS; new-path gets forced RLS; migrations under a separate privileged role; whole-legacy-surface cutover behind the FND-005 disable flag, dormant-but-tested). **Operator confirmation requested** on whether E2 delivers the full whole-app cutover (recommended, flag-gated) or the bounded fallback (new-path pool only). Not a STOP condition.
- **Resolution link:** [decisions.md#E2-D03](decisions.md).

---

## E2-F003 — TEN-005 cannot reach the full D1 tenant-property floor at E2 (surfaces not yet built)

- **Severity:** Low (scope clarification).
- **Blocks gate:** No.
- **Evidence:** TEN-005/E2-README name worker events, WebSockets, placement, object keys, and restored data; these are built by E3/E4/E5/E6. The full D1 tenant property floor (`D1-01`, `test-gates.md`) runs at the D1 gate; the D1 hard-invariant preamble "does not imply behavior whose owning tickets have not landed."
- **Affected tickets:** TEN-005.
- **Disposition:** Addressed by **E2-D04** — E2's suite is seed-reproducible and surface-parametrized over the E2-available surfaces (repositories/HTTP/composite-SQL/object-key format), fail-closed + non-disclosing (a HARD subset of H-01), and designed to extend; the full D1-floor run is owned by the D1 gate. Recorded explicitly in the E2 gate QA record (no silent cap).
- **Resolution link:** [decisions.md#E2-D04](decisions.md).

---

## E2-F004 — Original plan's `FORCE ROW LEVEL SECURITY` H-01 assertion was unsound (owner ≠ superuser)

- **Severity:** High (correctness of a HARD-invariant proof).
- **Blocks gate:** No (resolved by plan revision a2 before execution).
- **Evidence:** Plan revision a1 asserted "owner/superuser is not exempt because FORCE ROW LEVEL SECURITY is on" and a RED step expecting the embedded-PG owner filtered to 0 rows. PostgreSQL semantics (confirmed unanimously by all three reviewers): `FORCE ROW LEVEL SECURITY` subjects only the **non-superuser table owner** to RLS; **superusers and BYPASSRLS roles always bypass RLS regardless of FORCE**. In embedded-PG the tables are owned by the `test` superuser, so FORCE would not filter it and the assertion could not pass.
- **Affected tickets:** TEN-002.
- **Disposition:** **Resolved by revision a2.** The DB-enforcement guarantee is re-anchored on the serving role `aoa_app` being **non-owner + NOSUPERUSER + NOBYPASSRLS** (plain RLS filters it). FORCE is proved via `pg_class.relforcerowsecurity = true` + a dedicated non-superuser-owner behavioral test; provisioning never grants SUPERUSER/BYPASSRLS/CREATEDB to `aoa_app`. See E2-D01 (FORCE semantics) + TEN-002 TDD steps.
- **Resolution link:** [decisions.md#E2-D01](decisions.md), implementation-plan.md §TEN-002.

---

## E2-F005 — Sentinel Organization dual identity (forbidden distributed sentinel AND real single-tenant Default Org)

- **Severity:** High (following the plan literally would brick/false-block the default self-hosted deployment).
- **Blocks gate:** No (resolved by revision a2 + E2-D07). **Blocks TEN-006b correctness:** must land the E2-D07 reconciliation.
- **Evidence:** `00000000-…-000000000001` is both the FND-007 `forbiddenOrganizationSentinels` distributed-admission sentinel (`distributed-execution-legacy-parity.json:15-19`) and the legitimate single-tenant Default Org (`organizations.ts` slug `default`; `routes/companies.ts:47-61` resolves it in the isolation-not-enforced branch). Revision a1's "sentinel = blocker" + "remove the `:61` fallback" would break self-hosted company creation and false-flag every self-hosted install.
- **Affected tickets:** TEN-006 (a/b).
- **Disposition:** **Resolved by revision a2 + E2-D07** — remove only fail-open mechanisms; preserve explicit self-hosted resolution; scope "sentinel = blocker" to distributed admission; backfill is a no-op scaffold at E2 (blocks-rollout arm).
- **Resolution link:** [decisions.md#E2-D07](decisions.md).

---

## E2-F006 — TEN-006 Company-writer sweep is ~70 sites, not 6; TEN-006 exceeds the 3-day bound and must split

- **Severity:** High (partial-cutover / NOT-NULL-break risk; sizing).
- **Blocks gate:** No (resolved by split + exhaustive-sweep requirement).
- **Evidence:** Dropping `companies.organization_id`'s schema default fails-closed **every** company-insert that omits the column: `grep "INSERT INTO companies"` ≈ 106 hits (~70 omit `organization_id` inline), 13 `.insert(companies)` call sites, plus source-asserting unit tests pinning `?? DEFAULT_ORGANIZATION_ID` (`company-service-org-scope.test.ts:14`, `companies-create-org-default.test.ts:10`, `cloud-auth-cutover.test.ts:38-39`, `companies-org-scope.test.ts:201`). Real fallback sites include `services/companies.ts:187,334,414,434`, `services/organizations.ts:101,108`, `company-portability.ts:2213` (`?? undefined` → now NOT NULL) — the a1 list of 6 files with drifted line numbers was off by ~10×.
- **Affected tickets:** TEN-006.
- **Disposition:** **Resolved by revision a2 + E2-D07** — split into TEN-006a (exhaustive `rg`-derived sweep + fail-closed writers + shared `insertTestCompany` factory) and TEN-006b (drop default + admission-denial helper); inventory derived at execution, not from stale line numbers.
- **Resolution link:** [decisions.md#E2-D07](decisions.md).

---

## E2-F007 — Non-owner pool must fail closed (never fall back to the owner/superuser pool)

- **Severity:** High (latent total H-01 fail-open).
- **Blocks gate:** No (resolved by revision a2).
- **Evidence:** If `createTenantAppDb`/`runInTenant` fell back to `createDb` (the owner/superuser pool) when `AOA_APP_DATABASE_URL` is unset, every new-path query would run as a superuser that bypasses RLS entirely — invisible at E2 (tables dormant) and only manifesting when E3 wires callers.
- **Affected tickets:** TEN-002, TEN-003.
- **Disposition:** **Resolved by revision a2** — `createTenantAppDb` throws on a missing/blank `AOA_APP_DATABASE_URL` and never falls back; boot asserts the non-owner pool's role is `NOT rolsuper AND NOT rolbypassrls`.
- **Resolution link:** [decisions.md#E2-D03](decisions.md).

---

## E2-F008 — H-01 (non-waivable) must have ≥1 real Linux execution, not Windows-only console evidence

- **Severity:** Medium (gate-fidelity for the crown-jewel invariant).
- **Blocks gate:** No — but the E2 gate `pass` requires the Linux run.
- **Evidence:** The tenant/company-writer suites are gated so they run on Linux CI + Windows-on-demand, but `pr.yml` does not auto-run on `docs/replatform-program`. Resting the non-waivable H-01 proof on Windows-only console output risks a Linux-only breakage (e.g. a missed company-insert site) passing silently (review R#-05).
- **Affected tickets:** E2 gate.
- **Disposition:** **Addressed by revision a2 + E2-D05** — the gate runs the H-01 suites Windows-local **and** obtains at least one real Linux execution (`workflow_dispatch` on `pr.yml` or a scratch PR) pinned as formal evidence. **Requires operator action** to trigger a Linux run (or explicit acceptance of the E0/E1 Windows-local precedent for E2).
- **Resolution link:** [decisions.md#E2-D05](decisions.md).

---

## E2-F009 — Pre-existing: `packages/plugin-sdk` is absent on the branch, so server typecheck/build fails (DEC-03 baseline)

- **Severity:** Low (pre-existing, not epic-touched).
- **Blocks gate:** No — DEC-03-waivable when captured in the E2 baseline.
- **Evidence:** `server/package.json:49` depends on `@armyofagents/plugin-sdk` (`workspace:^`), but `packages/plugin-sdk` does not exist on `docs/replatform-program` (packages/ = adapter-utils, adapters, db, plugins, shared, worker-protocol). `pnpm --filter @armyofagents/server typecheck` exits 2 with ~66 errors — the unresolvable `@armyofagents/plugin-sdk` import + downstream `TS7006` implicit-any in the plugin subsystem. **Zero** errors reference E2 files (jobs/attempts/leases/tenant/repositories/`@armyofagents/db`) — grep-confirmed during TEN-001a review. E0 already documents this in `docs/replatform/epics/E0-foundation/qa/pre-existing-failure-baseline.md`.
- **Affected tickets:** all E2 tickets that run `pnpm --filter @armyofagents/server typecheck`/`build`; the E2 gate D0 rollup (`pnpm -r typecheck`/`build`).
- **Disposition:** The E2 gate captures its own DEC-03 pre-existing-failure baseline at Start SHA (referencing the E0 baseline row), so server typecheck/build failures are subset-of-baseline and non-epic-touched (waivable). Implementers running server typecheck on an E2 ticket verify only that **no new** error references an E2-changed file. Not a defect to fix in E2.
- **Resolution link:** E0 `qa/pre-existing-failure-baseline.md`; E2 gate §4.

---

## E2-F010 — TEN-006a service-writer sweep is INCOMPLETE: ~32 `companyService.create()` test sites still omit `organizationId` and now throw the fail-closed guard

- **Severity:** High (breaks the H-01 integration safety-net suite the ticket relies on; regresses ~14 currently-green integration files).
- **Blocks gate:** **No — RESOLVED** by fix commit `324e62ca6` (was Yes at attempt 1).
- **Found by:** TEN-006a independent review (attempt 1), reviewed revision `c4d8756c8`.
- **Evidence:** TEN-006a added `requireResolvedOrganizationId` (`server/src/services/companies.ts:91`), which throws when a Company writer is reached with no `organizationId`. The **raw-SQL sweep is complete** (0 `INSERT INTO companies` stragglers; control `memory-rbac-leakage.integration.test.ts` GREEN 8/8 on embedded PG) and **production callers are clean** (`routes/companies.ts:329`, `company-portability.ts:2197` both pass org explicitly). BUT the **service-writer (`companyService(db).create({…})`) sweep missed 32 call sites across 14 test files**, each passing only `{ name }` (no `organizationId`), so each now throws `Company writer requires an explicitly resolved organizationId (TEN-006a)`. Empirically reproduced on embedded PG (`AOA_RUN_WIN_INTEGRATION=1`): `crew-repair.integration.test.ts` **34/37 FAIL**, `extraction-sandbox-batch.integration.test.ts` **4/4 FAIL**, `d18-autonomy-dial-split.integration.test.ts` **6/6 FAIL** — all with that exact guard message (pre-change these bucketed to `DEFAULT_ORGANIZATION_ID` and passed). Missed sites (file: lines):
  - `crew-marketplace-bootstrap.integration.test.ts`: 561, 604, 717, 791, 819, 843, 1099, 1158, 1191 (9 — note 490 in the *same file* WAS swept, so the sweep is partial within one file)
  - `crew-repair.integration.test.ts`: 506, 580, 1065, 1476, 1561, 1583, 1601, 1616, 1850 (9)
  - `d18-autonomy-dial-split.integration.test.ts`: 93; `discussion-detail-lasterror.integration.test.ts`: 62; `extraction-sandbox-batch.integration.test.ts`: 224; `link-entry-seq.integration.test.ts`: 93; `organizations-backfill.integration.test.ts`: 50; `thread-commit-idempotency.integration.test.ts`: 119, 1721; `thread-v2-real-e2e.integration.test.ts`: 100, 366; `w1a-crew-assignment.integration.test.ts`: 91; `w1b-auto-accept.integration.test.ts`: 69; `w1c-inbox-dispatch-approval.integration.test.ts`: 71; `w2-extract-then-scope.integration.test.ts`: 92; `w3a-crew-loopback.integration.test.ts`: 93.
  The ledger §5 undercounted the service-create population ("15 service-create calls / 9 files") — the actual population is ~47 calls; 32 remain unswept — a recurrence of the E2-F006 undercount, this time on the `.create()` axis. `organizations-backfill.integration.test.ts:50` is a semantic red flag: its premise (create a company *without* an org, then backfill) is now impossible through the guarded service and needs a rethink, not just an added literal.
- **Affected tickets:** TEN-006a.
- **Disposition:** **RESOLVED (attempt 2, fix commit `324e62ca6`, verified at HEAD `324e62ca6`).** The implementer swept all 32 real service-writer sites to pass `organizationId: "00000000-0000-0000-0000-000000000001"` explicitly (matching the raw-SQL convention); `organizations-backfill.integration.test.ts:50` was correctly reseeded via **raw SQL** `INSERT INTO companies (organization_id, …)` (the guarded service can no longer mint an org-less company — the exact semantic flag raised here) with the now-unused `companyService` import dropped; the 2 intentional throws in `company-writer-fail-closed.test.ts` kept org-less. **Independent re-verification (reviewer, attempt 2):** balanced-paren sweep of `server/src/__tests__` → 0 real `companyService.create()/createWithOperator()` sites still omit org (only the 2 intentional throws remain); all `.createWithOperator(` + alias/`input`-literal receivers pass org. Embedded-PG (`AOA_RUN_WIN_INTEGRATION=1`) re-runs GREEN: `crew-repair`, `crew-marketplace-bootstrap`, `d18-autonomy-dial-split`, `extraction-sandbox-batch` (all previously RED on the guard), + dynamic-port control `teams-null-parent-cascade`. `company-writer-fail-closed` still 4 passed; broad glob 59 passed / 13 skipped / 2 plugin-sdk-baseline fail-to-collect; `@armyofagents/db` typecheck 0. Fix is test + result-doc only (no schema/migration/production change).
- **Resolution link:** [decisions.md#E2-D07](decisions.md); TEN-006a-result.md (§5 reconciled, attempt-2 review block); fix commit `324e62ca6`.

---

## E2-F011 — TEN-006b left a stale `packages/db` source-asserting test (missed by the server-only regression glob)

- **Severity:** Medium (pre-existing gate-blocker — the D0 `pnpm test:run` would fail).
- **Blocks gate:** Was yes (fixed inline). **Blocks TEN-002:** No (orthogonal — TEN-002 never touches `companies.ts`).
- **Evidence:** TEN-006b (`a269f8bd2`, migration 0210) correctly dropped the fail-open `.default("00000000-0000-0000-0000-000000000001")` from `packages/db/src/schema/companies.ts` (E2-D07), but `packages/db/src/__tests__/companies-org-scope-schema.test.ts:11` is a **source-asserting** test whose regex still required that `.default(...)` (its title even read "+ sentinel DB default"). It now fails on the branch (full `@armyofagents/db` suite: 291 passed / **1 failed** / 38 skipped). The TEN-006a/TEN-006b regression checks ran the `server/` glob `companies-*/company-*/*org*` and did not cover this `packages/db` test — the coverage gap that let it through. Surfaced during TEN-002 regression (implementer `a61ff33e…`).
- **Affected tickets:** TEN-006b (defect source); the E2 gate D0 rollup.
- **Disposition:** **RESOLVED (controller fix, inline).** Updated the assertion to require the NOT-NULL FK **without** the sentinel default AND to assert the `.default("…0001")` is absent (a fail-closed marker for E2-D07). Comment + title reworded. Test-only change; `companies-org-scope-schema.test.ts` now 2/2 green. Because TEN-006b's result ledger is frozen (`complete`), this correction is recorded here + committed rather than rewriting the approved TEN-006b evidence (artifact-policy). Follow-up lesson: source-asserting-test regression checks must run repo-wide (`pnpm -r`), not per-package globs.
- **Resolution link:** fix committed on `claude/epic-e2-tenant-kernel`; [decisions.md#E2-D07](decisions.md).

---

## E2-F012 — On a REUSED pooled connection, a no-context new-path query fails closed by THROWING (22P02), not by returning 0 rows

- **Severity:** Low (behavioral nuance; both outcomes are fail-closed — no data leak).
- **Blocks gate:** No.
- **Found by:** TEN-003 implementation (`tenant-tx-context.integration.test.ts` assertion (d) → (d)/(d2) split).
- **Evidence:** The TEN-002 tenant policy predicate is `organization_id = current_setting('aoa.organization_id', true)::uuid`. On a **pristine** connection the GUC has never been set, so `current_setting(..., true)` returns **NULL**, `NULL::uuid` is NULL, and a no-context query returns **0 rows** (clean default-deny — assertion (d)). But `aoa.organization_id` is a **placeholder (custom) GUC**: once `set_config('aoa.organization_id', <org>, true)` has run in a session (as every `runInTenant`/`withTenantTx` does), its **reset value becomes the empty string `''`** for the rest of that physical connection. A subsequent query issued **OUTSIDE** any `runInTenant` on that **reused** connection therefore evaluates `organization_id = ''::uuid`, which raises **`22P02` (invalid input syntax for type uuid: "")** — the query FAILS CLOSED by throwing rather than leaking rows (proved live on embedded-PG: server log `ERROR: invalid input syntax for type uuid: ""`; assertion (d2)). postgres-js pools reuse connections, so this is the production-relevant case.
- **Affected tickets:** TEN-003 (documented + tested); E3 entry-point adopters (JOB-*); TEN-005 (uniform-denial harness — informational).
- **Disposition:** **Resolved-by-design / documented.** Both outcomes are fail-closed (H-01 holds: a no-context query NEVER returns another tenant's rows — it returns 0 on a pristine connection or throws 22P02 on a reused one). This **reinforces** that `runInTenant` is mandatory: a stray un-wrapped new-path query on a live pool fails loudly instead of silently returning nothing. **E3-adoption note:** every new-path DB access MUST route through `runInTenant`; never issue a bare `appDb`-level new-path query. **TEN-005 note:** the adversarial suite drives new-path access via `runInTenant` (context always set), so it does not encounter (d2); the 22P02 throw is not a uniform-denial concern because it only occurs on a mis-implemented un-wrapped access path, not on a normal cross-tenant attempt (which is denied inside a set context by RLS as 0-rows / 42501). No policy change is warranted at E2. A future hardening option (register the GUC with a NULL-safe default, or use a `NULLIF(current_setting(...), '')::uuid` predicate) can be considered at E3 if any operator/monitoring path legitimately issues un-wrapped reads — out of E2 scope (would alter the shipped TEN-002 policy).
- **Resolution link:** `tickets/TEN-003-result.md` (assertions (d)/(d2)); TEN-002 policy `server/src/db/rls-tenant.ts` `tenantPolicySql`.
