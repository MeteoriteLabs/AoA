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
