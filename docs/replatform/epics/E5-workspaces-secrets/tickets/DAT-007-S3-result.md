# DAT-007-S3 Result — prove the `/mcp` run-currency gate against real PostgreSQL

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-007-S3 — prove the /mcp run-currency gate against real PostgreSQL (M, ≤3 agent-days, M1a)`
**Implementer:** `M1 DAT-007-S3 build session (Claude Opus 5)`
**Start SHA:** 66d1f917619f5b201a27f378dc62ebd81bb5bb38

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the section below and is the only role that may change it to `complete`.

This file is a controlled append-only review ledger until `complete`; do not delete or rewrite prior review attempts. Once `complete`, it is frozen. Ticket commands are focused acceptance evidence, not the immutable epic D0 rollup.

## Delivered scope

**Tests only. Zero source changes. No test found a defect.**

The platform decision (D2) is **option (a)**. The Tier-3 suite stays
`describe.skipIf(process.platform === "win32")` and is not changed to honour
`AOA_RUN_WIN_INTEGRATION`. The authoritative Tier-3 evidence is the Linux `verify` shard and its
executed count (see *Commands*). I also ran the suite on Windows by temporarily flipping the guard
in the working tree, and never committed that change. Those runs are labelled
`operator-directed windows-local` below. They are supporting evidence only.

The five original Tier-3 cases are **unchanged**. The seed helper `seedDistributedRun` keeps its
signature and delegates to the new `seedDistributedChain`. Every new knob of `seedDistributedChain`
defaults to the value the original cases used.

New Tier-3 cases in `server/src/__tests__/distributed-run-currency.integration.test.ts`. Each is a
single-knob change from the case-1 admit baseline:

| # | Case | Verdict | Resolver/classifier code exercised |
|---|---|---|---|
| N1 | Replaced target generation: target `device_generation` 2, lease `target_generation` 1 | `deny` | `createDistributedRunCurrencyResolver`, `targetSuperseded` generation comparison |
| N2 | Disabled execution target (`status = 'disabled'`), generations matching | `deny` | `targetSuperseded` `targetStatus === "disabled"` arm |
| N3 | Wrong **Organization**: a live Org-A run presented at Org B's company. Same-tenant control: the same run at its own company admits | `deny` / `admit` | `classifyRunCurrency` step (2), `runCompanyId !== companyId` |
| N4 | Wrong Organization in the reverse direction: an Org-B run at Org A. Same-tenant control: B at B admits, which proves the second tenant's chain is live | `deny` / `admit` | same |
| N5 | Wrong **company** in the **same** Organization: a company-A run at company A2 | `deny` (control `admit`) | same |
| N6 | Cross-tenant attempt pointer: an Org-A `heartbeat_runs` row whose `distributed_attempt_id` names Org B's **live** attempt. Control: B's own run admits | `deny` | the attempt join's `eq(jobAttempts.companyId, heartbeatRuns.companyId)` |
| N7 | Tier-3 throw, query-level: a signed run id that is not a uuid, so Postgres rejects the real query | rejects, SQLSTATE `22P02` | fail-closed propagation (no catch in the resolver) |
| N8 | Tier-3 throw, connection-level: the real resolver over a pool to an absent database | rejects, SQLSTATE `3D000` | same |
| N9 | Plan shape: the exact statement the real resolver sends, `EXPLAIN`ed with `enable_seqscan = off`. Positive control: an unindexed predicate (`organizations.name`) is detected as a non-probe scan | every hop is an index probe | the query as built |

New Tier-1 pin in `server/src/__tests__/mcp-run-currency-gate.test.ts`:
*"DAT-007-S3: keyed on the SIGNED run id, never the header-overridable runId (divergent ids pin)"*.
The actor has `runId: "run-header-live"` and `signedRunId: "run-signed-stale"`. The stub resolver
admits only the header id, so a gate that read the header would return 200. The test asserts 403,
and that the resolver was called exactly once with the signed id.

**Rerun and credited, not claimed RED:**
- The five original Tier-3 cases.
- The Tier-1 flag-off control: *"flag OFF (unset) + distributed agent → resolver NEVER consulted"*.
- The Tier-1 route-level throw: *"flag ON + resolver THROWS → fails CLOSED (non-2xx)"*.

N7 and N8 are the Tier-3 complement of that route-level throw. The existing test proves the route
maps a rejection to non-2xx. N7 and N8 prove that the real resolver rejects on a real database
error, and never admits.

**Non-goals kept:**
- Item #2 enablement and live proof (CLI-008 Unit C / `CLI-016`).
- Forced-RLS coverage (a separately-scoped `aoa_app`-role harness).
- No change to the verdict vocabulary or to the denial message.

## ★ S0-8 measurement — which pool the resolver reads through

Measured at the start SHA, by symbol:

- **The pool.** `server/src/index.ts` calls `createApp(db as any, …)` with the **primary owner pool**
  (`db = createDb(config.databaseUrl)`, or the embedded equivalent). `createApp`
  (`server/src/app.ts`) mounts `mcpServerRoutes(db)` with that same handle. `mcpServerRoutes`
  (`server/src/mcp/server.ts`) builds `createDistributedRunCurrencyResolver(db)` from it. The
  `aoa_app` pool reaches `createApp` only as `opts.tenantAppDb`, and `mcpServerRoutes` never
  receives it.
- **RLS does not apply.** When distributed execution is on, boot calls
  `assertPrimaryDbBypassesRls(db)` (`packages/db/src/client.ts`, via `rlsBypassRefusal`). It refuses
  to arm unless that pool's role is `rolsuper` or `rolbypassrls`. So RLS **by construction**
  provides no tenant filtering for this read.
- **Where the wrong-tenant denial rests.** It rests entirely on two application predicates:
  - `classifyRunCurrency` step (2) compares the run's `heartbeat_runs.company_id` with the URL
    company **in JavaScript**. N3, N4 and N5 prove this, and mutant M3 kills all three.
  - The attempt join's `job_attempts.company_id = heartbeat_runs.company_id` stops a run from
    inheriting another tenant's live attempt. N6 proves this, and mutant M4 kills it.
- **★ A correction to `milestones/M1a/reachability/E5-workspaces-secrets.md` row E5-7.** That row
  says the resolver reads *"with a `companyId` predicate"*. **The SQL has no predicate on the
  request's `companyId`.** Its only `WHERE` is `heartbeat_runs.id = <signed run id>`, a primary-key
  probe. The URL company is checked after the read, in the classifier. The row's open question
  (*"Whether that handle is subject to RLS: TO MEASURE"*) now has an answer: **no**. The handle is
  the owner pool, and boot requires it to bypass RLS.

This is not a defect. The two predicates hold under test and each is pinned by a killed mutant. But
the tenant boundary for this read is application code, not the database.

**What kind of measurement this is.** The plan's Step 0 (S0-8 amendment) asks for the pool to be
measured *on the candidate's flag-on configuration*, for example with
`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user` through the
same `db` handle at boot. `assertPrimaryDbBypassesRls` runs that query. It runs on that same handle,
because `index.ts` has a single `db` variable, passed to both the assertion and `createApp`. It is
assigned on exactly one of two boot branches, an external `config.databaseUrl` or the embedded
cluster, and both assignments come before either use. It is fail-stop at boot. So **every** flag-on boot that reaches `createApp` has already
measured `rolsuper OR rolbypassrls = true` on the resolver's pool.

**This ticket did not observe a live flag-on candidate boot.** There is no candidate frozen yet; the
reachability row defers this to `TO MEASURE AT CANDIDATE FREEZE`. The answer above therefore comes
from source plus that boot-enforced invariant. It is not a captured boot log. The branch the plan
prescribes for the owner-pool outcome is met in full, and it also covers the RLS-subject outcome:
- a Company-B run resolved with Company A's `companyId` denies (N4, and N3 in the other direction);
- the same run at its own Company admits;
- the mutant that drops the company comparison fails (M3);
- no E2 RLS evidence is cited.

The route maps every `deny` to `forbidden(MCP_CROSS_COMPANY_FORBIDDEN_MSG)`. That is the same
constant `ensureProtocolAccess` throws for wrong-tenant in `server/src/mcp/server.ts`. The Tier-1
case *"resolver 'deny' → coarse 403 on initialize, tools/list, AND tools/call"* is the proof that
the verdict becomes the coarse forbidden.

## Changed files

| File | Responsibility |
|---|---|
| `server/src/__tests__/distributed-run-currency.integration.test.ts` | Tier-3 cases N1–N9; a second Organization (`TENANT_B`) and a second company in Organization A (`COMPANY_A2`) seeded in `beforeAll`; `seedDistributedChain` with three defaulted knobs |
| `server/src/__tests__/mcp-run-currency-gate.test.ts` | the divergent `runId` / `signedRunId` pin |
| `docs/replatform/epics/E5-workspaces-secrets/tickets/DAT-007-S3-result.md` | this record |

## RED → GREEN and mutation evidence

**No source defect.** Every new test passed on its first run against the unmodified resolver. The
behaviour already existed, so the plan's "RED" for these rows means *the case was absent*. What
makes each test non-vacuous is the mutant it kills. Every mutant below was applied to the source
by a script, run against the named suite, and reverted with `git checkout`. The Tier-3 rows are
`operator-directed windows-local`, with the skip guard flipped in the working tree only.

| Mutant | Change | Suite | Result |
|---|---|---|---|
| M1 | drop `row.targetDeviceGeneration !== row.leaseTargetGeneration` | Tier-3 | **killed**: N1 red (1 failed / 13 passed) |
| M2 | drop `row.targetStatus === "disabled"` | Tier-3 | **killed**: N2 red (1 / 13) |
| M3 | drop `classifyRunCurrency` step (2), the company comparison | Tier-3 | **killed**: N3, N4, N5 red (3 / 11) |
| M4 | drop `eq(jobAttempts.companyId, heartbeatRuns.companyId)` from the attempt join | Tier-3 | **killed**: N6 red (1 / 13) |
| M5 | catch-and-admit: wrap the resolver body in `try { … } catch { return "admit"; }` | Tier-3 | **killed**: N7 and N8 red (2 / 12) |
| M6 | gate reads the header: `signedRunId: req.actor.runId` in `mcpServerRoutes` | Tier-1 | **killed**: the new pin red (1 failed / 6 passed). ★ The pre-existing `run-99` deny test **passed under M6**, which confirms the survival the ticket named |
| N9 control | an `EXPLAIN` of `SELECT id FROM organizations WHERE name = $1` with `enable_seqscan = off` | Tier-3 | the detector reports a non-probe scan (asserted in-test) |

## Observability — the resolver's query plan shape

N9 captures the statement the real resolver sends (a traced `postgres` client) and `EXPLAIN`s it.
The plan was logged in the Windows-local run and is logged in CI as `[dat-007-s3] resolver plan`.
Every hop is an `Index Scan` over a unique index with an `Index Cond`:

| Hop | Index | Index Cond |
|---|---|---|
| `heartbeat_runs` | `heartbeat_runs_pkey` | `id = <signed run id>` |
| `job_attempts` | `job_attempts_pkey` | `id = heartbeat_runs.distributed_attempt_id` |
| `leases` | `leases_active_per_attempt_idx` | `attempt_id = job_attempts.id` |
| `execution_targets` | `execution_targets_authority_id_uq` | `target_authority_key = leases.target_authority_key AND id = leases.target_id` |

`enable_seqscan = off` is deliberate. On tiny test tables the planner prefers a sequential scan even
when an index exists. With sequential scans disabled, any hop that still shows a non-probe scan has
no usable index, and that is the regression this test pins.

## Commands

The implementation revision is `9e87b13758bc8c372ca37f8d162eb29ba09d7f96`, the test commit. Every row below ran against it. This record is the only later change.

| Command | Exit code | Result summary |
|---|---:|---|
| `pnpm --filter @armyofagents/server exec vitest run src/__tests__/distributed-run-currency-classify.test.ts src/__tests__/mcp-run-currency-gate.test.ts src/__tests__/distributed-run-currency.integration.test.ts` (Windows) | `0` | 19 passed (classify 12, gate 7); integration 14 **skipped**, which is expected on win32 |
| same integration file with the skip guard flipped locally, `--reporter=verbose` (`operator-directed windows-local`) | `0` | **14 passed / 14** (5 original + 9 new) |
| `pnpm --filter @armyofagents/server typecheck` | `0` | clean (`src/__tests__` is excluded by `server/tsconfig.json`; the two test files were also checked with an ad-hoc tsconfig, and the only error is the pre-existing `req.actor` cast at gate-test line 49, not from this ticket) |
| `pnpm --filter @armyofagents/server build` | `0` | clean |
| full guard set (M1-AGENT-RULES) + `check-evidence-immutability --base origin/docs/replatform-program` | `0` | `failures: 0` |
| **Linux CI — `verify (4)`, step `Run tests`** (`pnpm exec vitest run --shard=4/4`), job [`106279057337`](https://github.com/MeteoriteLabs/AoA/actions/runs/35582715287/job/106279057337), run `35582715287`, head `9e87b13758bc8c372ca37f8d162eb29ba09d7f96` — **authoritative Tier-3** | `0` (job `success`) | `✓ @armyofagents/server src/__tests__/distributed-run-currency.integration.test.ts (14 tests)` — **14 executed, 14 passed, 0 skipped**; the `[dat-007-s3] resolver plan` line is in the same log (all four hops `Index Scan` on the unique indexes above). Shard total: 656 files, 6110 passed / 2 skipped |
| **Linux CI — `verify (1)`, step `Run tests`**, job [`106279057312`](https://github.com/MeteoriteLabs/AoA/actions/runs/35582715287/job/106279057312), same run and head | `0` | `✓ @armyofagents/server src/__tests__/mcp-run-currency-gate.test.ts (7 tests)` — the Tier-1 pin, the flag-off control and the route-level throw |
| `ci-required` on PR #540, head `9e87b137` | — | `pass` |

## Deviations

- More Tier-3 cases than the plan's four. The plan names one wrong-company case. Ruling F10 needs a
  cross-tenant case with a same-tenant control, so I added: the wrong Organization in both
  directions (N3, N4), a wrong company inside the same Organization (N5), and the cross-tenant
  attempt pointer (N6). The pointer is the only case that exercises the join-level company predicate.
- Two Tier-3 throws (N7 query-level, N8 connection-level) rather than one.
- The plan-shape record is an executed test (N9) with a positive control, not a prose note.

## Findings

- **Reachability-record correction (no new finding id).** Row E5-7 of
  `milestones/M1a/reachability/E5-workspaces-secrets.md` claims a `companyId` predicate in the
  resolver's SQL, and there is none. Its RLS question is answered: the owner pool, with RLS bypass
  required at boot. See the S0-8 section. No finding id was minted. The owning row belongs to the
  candidate-freeze measurement, so the planning session should decide whether to amend it.

## Follow-up tickets

None. Item #2 enablement and live proof stays with CLI-008 Unit C / `CLI-016`, as the plan says.

## Gate recommendation

**Ready for independent review.** The Linux `verify (4)` shard executed all 14 cases of
`distributed-run-currency.integration.test.ts`, and every mutant in the table is killed.

## Independent review

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Review evidence:** `pending`

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
