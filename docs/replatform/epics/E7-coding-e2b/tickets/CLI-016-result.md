# CLI-016 Result - the distributed tool surface is armed per Organization, and denied at use for a tenant that is not

**Status:** `complete`
**Date (UTC):** `2026-09-21`
**Epic:** `E7-coding-e2b`
**Plan task:** `E7 implementation-plan ### CLI-016 - arm the distributed tool surface behind the fence-bound gate (M1b)`, as amended by S0-4 and S0-8 (ruling F10)
**Graph node:** `program-design.md #### CLI-016`
**Implementer:** `M1 CLI-016 build agent (Claude Opus 5)`
**Start SHA:** `1447a27398738f36a17d3e79cc5e5ed01fb5e82f` (program tip at start)
**Reviewed revision (implementation commit):** `0254c5c67b94c817fe2fc68db6d43b50ae2bb27b`
**Depends on:** E5 `DAT-007-S3`, `complete` on the program tip at start (`9549ac0cc`, "review(M1): disposition -- DAT-007-S3 moves to complete").

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ **The keyed real-E2B +/- controls are PENDING.** The graph node and the plan's RED list both
require a keyed real-E2B case. In it, a tool call from an authorized run reaches AoA, and the same
call is denied from an unauthorized run id and from an expired lease. That case is on ruling F8's
named list (`CLI-016` +/- controls), and **this build did not dispatch it**. The planning session
dispatches it on a named candidate. Until it runs, this record proves the per-Organization arming
and the use-side denials against real PostgreSQL and at the `/mcp` route, **not** from inside an
E2B sandbox. `E7-F003`'s tools row is **narrowed, not closed**.

---

## 1. What was found before building, and what was decided

Measured at source at the start SHA:

- `readDistributedToolSurfaceFlag(process.env)` (`server/src/config/distributed-execution.ts`) was the
  whole decision. Its one production read site was the canary block in `server/src/services/heartbeat.ts`.
  From there it was threaded as `toolSurfaceAuthorized` into `brokeredAoaMcpConfig` and, through
  `resolveExecutionOwner`, into the run_jwt mint. It had **no per-Organization dimension**, which
  matches the plan.
- `parseDistributedExecutionRolloutMap` ignores unknown per-Organization keys, so an older binary
  would silently drop `tools`. This confirms the S0-8 note.
- The `/mcp` currency gate (`classifyRunCurrency` plus `createDistributedRunCurrencyResolver`) checks
  that the run's fence is live. It does not check the run's tenant's tool-surface arming. A run_jwt
  lives up to 48h, so without a use-side check, unsetting the flag would leave already-dispatched
  sandboxes with the surface until the JWT expired.

**How the deployment flag and the per-Organization field combine was left to this build ("your
call, recorded").** It is recorded as **`E7-D10`** in [`../decisions.md`](../decisions.md),
**decided under founder delegation F2**:

1. The surface is **deployment kill switch AND per-Organization `tools: true`**.
2. The flag's **only arming value is `per-organization`**. The legacy `1`/`true`/`yes`/`on` values
   are **refused** at startup. A pre-CLI-016 binary reads `true` as "arm every tenant", and its parser
   **rejects** `per-organization`. So a binary rollback with the flag armed fails loud and closed.
   The unsafe combination (older binary plus an "arm everyone" value) cannot be reached from any
   configuration the new binary boots with.
3. The per-Organization decision is **re-proven at `/mcp` authorization**, beside the DAT-007
   currency gate.

## 2. What shipped (implementation commit `0254c5c67`)

| File | Change |
|---|---|
| `server/src/config/distributed-execution.ts` | `DISTRIBUTED_TOOL_SURFACE_PER_ORGANIZATION = "per-organization"`. `readDistributedToolSurfaceFlag` arms only on that value and throws on the legacy truthy spellings. New `resolveDistributedToolSurface({deploymentArmed, organizationToolsEnabled})` returns `enabled` / `deployment_disabled` / `organization_not_enabled`. `assertHostedExecutionStartupSafe` refuses an unaccepted value as `env_flag_unparseable`. |
| `server/src/config/distributed-execution-rollout-source.ts` | `OrganizationRolloutPolicy.tools?: boolean`. Absent means **not** enabled; a non-boolean fails the parse. New `resolveOrganizationToolSurface({organizationId})` is strictly `tools === true` and is read per call, so a malformed map fails closed. |
| `server/src/services/heartbeat-distributed-rollout.ts` | Hook method `resolveOrganizationToolSurface(organizationId)`. A null Organization or a throwing source gives `false`, and the method never throws. |
| `server/src/services/heartbeat.ts` | The canary block computes `toolSurfaceDecision = resolveDistributedToolSurface({ deploymentArmed: readDistributedToolSurfaceFlag(process.env), organizationToolsEnabled: distributedRolloutHook.resolveOrganizationToolSurface(distributedRolloutOrganizationId) })`. The one `toolSurfaceAuthorized` still gates both the MCP config and the mint. The DISTRIBUTED owner log carries `toolSurface: <reason>`. |
| `server/src/mcp/distributed-tool-surface-use.ts` | **New, pure.** `classifyToolSurfaceAtUse` works like this: no run row → admit (the DAT-007 fail-open class); company mismatch → deny; not distributed → admit; distributed → admit iff the Organization is armed. |
| `server/src/mcp/distributed-tool-surface-use-resolver.ts` | **New.** The DB reader. It joins `heartbeat_runs` to its **run's** company's `organization_id`, keyed on the signed run id, and reads the flag and the rollout map per call. It fails closed on a throw. |
| `server/src/mcp/server.ts` | The `/mcp` mount runs the tool-surface gate after the currency gate, in the same scoped block (`AOA_DISTRIBUTED_EXECUTION_ENABLED` on, agent actor, signed run id). A deny is the same coarse `MCP_CROSS_COMPANY_FORBIDDEN_MSG`. `McpRouteDeps.resolveDistributedToolSurfaceAtUse` is injectable. |
| `server/src/__tests__/distributed-tool-surface-per-organization.test.ts` | **New**, 30 tests (Tier-1, cross-platform). |
| `server/src/__tests__/distributed-tool-surface-arming.integration.test.ts` | **New**, 7 tests on real PostgreSQL with two tenants. **`describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")`**, as the plan requires. |
| `server/src/__tests__/mcp-run-currency-gate.test.ts` | +4 route tests. The existing DAT-007 cases inject an admitting tool-surface stub, so each still isolates the currency verdict. |
| `server/src/__tests__/crew-distributed-gate.test.ts` | One row encoded the superseded contract (`"true"` → `true`). It now asserts the E7-D10 contract, with the old wording quoted beside it. |
| `docs/architecture/distributed-execution-threat-controls.json` | DE-14, DE-16, DE-19 and DE-20 citations are re-pointed to the lines they moved to (`distributed-execution.ts`, `mcp/server.ts`, `heartbeat.ts`). Anchors are unchanged, and the census is unchanged at 397. Historical "(These read `:5399`…)" and "(W20-B, heartbeat.ts:5407)" attributions are left as written. |
| `docs/replatform/epics/E7-coding-e2b/decisions.md` | `E7-D10`. |
| `findings.md` (`E7-F003`) | Tools row **narrowed, not closed**. |
| `implementation-plan.md` `### CLI-016` | A dated note: the Interfaces sentence "the deployment flag … unchanged" no longer holds for the flag's accepted values. The sentence is kept as written. |

No database schema, no route, and no `packages/worker-protocol` wire change. No migration.

## 3. Evidence

### RED, before implementation (tests written first, at the start SHA plus the test files)

`AOA_RUN_WIN_INTEGRATION=1 npx vitest run` over the unit file, the route file and the integration
file:

- `mcp-run-currency-gate.test.ts`: **3 failed / 8 passed**. The three new CLI-016 route tests failed
  on behaviour: *"currency ADMIT + tool surface DENY → coarse 403"* failed with `expected 200 to be 403`
  (the mount did not exist); the positive control failed with
  `expected "spy" to be called 1 times, but got 0 times`; and the fail-closed row failed with
  `expected 200 not to be 200`.
- `distributed-tool-surface-per-organization.test.ts` and `distributed-tool-surface-arming.integration.test.ts`
  failed to load: `Cannot find module '../mcp/distributed-tool-surface-use.js'` and
  `'../mcp/distributed-tool-surface-use-resolver.js'`. The use-side gate did not exist. The
  behavioural rows inside these files are each shown red individually by the mutation table below.

### GREEN, local on Windows, at `0254c5c67`

| Command | Result |
|---|---|
| `AOA_RUN_WIN_INTEGRATION=1 npx vitest run` over `task-run-batch-workload`, `mcp-run-currency-gate`, `distributed-tool-surface-arming.integration`, `distributed-tool-surface-per-organization`, `crew-distributed-gate` (the focused verify command plus the new unit file and the updated row) | **5 files, 151 passed**: 95 + 11 + **7 (real PG, executed, not skipped)** + 30 + 8 |
| Related suites: `crew-distributed-gate heartbeat-distributed-rollout distributed-execution-rollout-source cli-008-unit-d-seam-wiring cli-006 rollout-dial-live rollout-rollback-liveness de-14-startup-safety-audit config.test mcp-config-broker-seam execution-secret-handle-mint distributed-run-currency` (before the `crew-distributed-gate` row update) | 30 files passed, 1 skipped; 485 passed, 14 skipped, **1 failed**. The failure was the superseded `crew-distributed-gate` row, since updated. |
| `pnpm --filter @armyofagents/server typecheck` | exit 0 |
| `pnpm --filter @armyofagents/server build` | exit 0 |

### Mutation and positive-control table

Each mutation was applied to the source, the three CLI-016 test files were run
(`AOA_RUN_WIN_INTEGRATION=1`, 48 tests), and the file was restored. **All 11 went RED.**

| # | Mutation | Result | Red tests (abridged) |
|---|---|---|---|
| M1 | `resolveDistributedToolSurface` ignores the Organization | **4 failed** | real-PG DISPATCH (B got `--mcp-config`), real-PG USE (B admitted), real-PG PER-TENANT ROLLBACK, unit "F10: deployment ARMED but this Organization not enabled" |
| M2 | heartbeat reverts to `const toolSurfaceAuthorized = readDistributedToolSurfaceFlag(process.env)` | **2 failed** | both structural seam pins |
| M3 | `/mcp` mount ignores the tool-surface verdict | **1 failed** | route "currency ADMIT + tool surface DENY → coarse 403" |
| M4 | any Organization present in the map counts as tools-enabled | **6 failed** | real-PG DISPATCH / USE / ROLLBACK, hook delegation, source A/B/C/unknown, per-call re-read |
| M5 | a non-boolean `tools` is not validated | **5 failed** | all five non-boolean parse rows |
| M6 | the legacy truthy flag values are accepted | **6 failed** | five legacy-value rows plus the startup-assertion row |
| M7 | the startup assertion drops the tool-surface check | **1 failed** | startup-assertion row |
| M8 | the use gate also denies LOCAL runs | **2 failed** | unit LOCAL admit, real-PG "LOCAL run in the not-enabled tenant is untouched" |
| M9 | the use resolver ignores the kill switch | **1 failed** | real-PG KILL SWITCH |
| M10 | the use gate ignores a company mismatch | **2 failed** | unit company-mismatch deny, real-PG "UNAUTHORIZED run id … denied by BOTH gates" |
| M11 | the hook reports tools for every Organization | **3 failed** | real-PG DISPATCH, hook null / throwing source, hook delegation |

Positive controls, each paired with its deny in the same test: A's live run is admitted by both gates
next to B's deny. The same tenant's live run is admitted next to the expired-lease deny. A's run is
admitted at A's own company next to the deny at B's company. A's run is admitted before the kill
switch and before the per-tenant rollback. The route test has a 200 case next to its 403 case.

### What each requirement maps to

| Requirement (brief / plan / graph node) | Where it is proven |
|---|---|
| Org A tools-enabled plus Org B not: B's run gets NO surface and is denied, A's works | real-PG **DISPATCH (F10)** (argv carries `--mcp-config` for A only) and **USE (F10)** (B's fence-current run: currency `admit`, tool surface `deny`; A's: both `admit`) |
| An unauthorized run id is denied | real-PG: A's live run presented at B's company is denied by **both** gates. B's run id (tenant not enabled) is denied by the tool-surface gate. |
| An expired lease is denied (currency at USE, not at mint) | real-PG: lease `expires_at` in the past gives currency `deny`, with the same tenant's live run as the control. Redemption refusal of a stale fence is existing coverage (`composed-loop-secret-resolve.integration.test.ts`, "a STALE fence token on the same live handle is DENIED"), not re-proven here. |
| Absent `tools` means off; malformed fails loud | unit parse and source rows, M4, M5 |
| The unsafe older-binary combination is impossible or loud | E7-D10; unit legacy-value rows and startup refusal; M6, M7 |
| Kill switch still instant (rollback exit criterion 6) | real-PG KILL SWITCH (use-side deny of an already-dispatched run, dispatch `deployment_disabled`) |
| codex out of scope | unchanged: `buildSandboxInvocation` emits the MCP config only for `claude_local`; no codex path was touched |
| **Keyed real-E2B +/- controls** | **PENDING. Not dispatched by this build (F8; the planning session dispatches it).** |

## 4. Choices and contradictions recorded

- **E7-D10 changes the flag's accepted values.** The plan's Interfaces said the flag "already exist[s]
  and [is] unchanged". It now arms only on `per-organization`. The plan section carries a dated note.
- **A use-side gate was added in `server/src/mcp/server.ts`.** It was not in the plan's Files list,
  which named `heartbeat.ts` and the rollout source. Without it, "B's run is denied" held only at
  dispatch (by not minting), and the rollback in exit criterion 6 would not have reached runs already
  holding a run_jwt. It is a new, separate gate. The DAT-007 classifier and resolver are **unchanged**.
- **The Organization is the run's, not the URL's.** The use-side reader resolves the Organization
  from the `heartbeat_runs` row's company. A URL-company mismatch is denied before the policy is read.

## 5. Guards

All 45 `node scripts/check-*.mjs` guards named in `.github/workflows/pr.yml` were run (minus the six
the M1 rules exclude), plus `check-evidence-immutability --base origin/docs/replatform-program`:
**0 failures**. `check-register-citation-integrity`: PASS, 397 enforced citations, census unchanged.

## 6. Not proven here

- The keyed real-E2B case (above).
- That any deployment arms any Organization. None does, and the flag is unset everywhere.
- The redemption-side refusal for an expired lease. It is existing coverage, cited above, and was not
  re-run as part of this ticket.

## 7. CI evidence

PR #555, `pr.yml` run `35591990274`, on the reviewed revision `0254c5c67b94c817fe2fc68db6d43b50ae2bb27b`
(`headSha` confirmed). Every job passed, including `ci-required`.

| Job (Linux) | CLI-016 files in the shard, with executed counts | Shard total |
|---|---|---|
| `verify (3)` (job `106308267588`) | **`distributed-tool-surface-arming.integration.test.ts` (7 tests), executed on embedded PostgreSQL, 3770ms, none skipped**; `distributed-tool-surface-per-organization.test.ts` (30 tests) | 654 files passed, 4 skipped; 5913 tests passed, 29 skipped |
| `verify (1)` (job `106308267619`) | `task-run-batch-workload.test.ts` (95), `mcp-run-currency-gate.test.ts` (11), `crew-distributed-gate.test.ts` (8) | 655 files passed, 3 skipped; 6401 passed, 12 skipped |
| `verify (2)` (job `106308267545`) | none | 656 files passed, 2 skipped; 6216 passed, 33 skipped |
| `verify (4)` (job `106308267665`) | none | 658 files passed; 6128 passed, 2 skipped |
| `policy`, `lint`, `migrations`, `e2e`, `e2e-pgvector`, `browser`, `distributed-contract`, `brand-check`, `worker-protocol-contract-bytes` (ubuntu + windows) | — | pass |

The formal real-PG evidence is `verify (3)`'s **7 executed** tests. The Windows local run (§3) is
corroborating only.

## Independent review

_To be completed by a distinct reviewer. The implementer does not set `Status: complete`._

**Reviewer:** M1 review-batch-2B independent reviewer (Claude Opus 5) — distinct from the CLI-016 build agent and the planning session
**Reviewed revision:** fc2eb7dde6325803c77950ac4adb1d190db0bd9a
**Disposition:** `approved`
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `approved`**, for the code and the record, with the keyed real-E2B +/- controls
**honestly PENDING** as the record states (see *What remains open*). Reviewed at
`fc2eb7dde6325803c77950ac4adb1d190db0bd9a` (program tip `docs/replatform-program`, the merge of PR
#547). The start SHA `1447a2739873…`, the implementation commit `0254c5c67b94…` and the `DAT-007-S3`
completion commit `9549ac0cc` are all ancestors of it. `git log 0254c5c67..fc2eb7dde` over the nine
CLI-016 source and test files is empty. PR #555's final head `04c73866c3ba…` differs from
`0254c5c67` only by this record.

- **The combination, at source.** `readDistributedToolSurfaceFlag` (`config/distributed-execution.ts`)
  returns true only on `per-organization`, and throws on `1`/`true`/`yes`/`on`.
  `resolveDistributedToolSurface` checks the deployment flag first, then the Organization.
  `resolveOrganizationToolSurface` in the rollout source is strictly `policy?.tools === true`.
  E7-D10 is in `decisions.md`, recorded under F2 with the build agent named as the one exercising it.
- **The use-side gate, at source.** In `mcp/server.ts`, under
  `distributedExecutionEnabled && protocolActor.source === "agent" && req.actor.signedRunId`,
  `resolveDistributedToolSurfaceAtUse` runs after the currency verdict. A deny throws the same
  `MCP_CROSS_COMPANY_FORBIDDEN_MSG`. The default is `createDistributedToolSurfaceUseResolver(db)`.
  That resolver keys on the signed run id, left-joins the **run's** company to its `organization_id`,
  and reads the flag and rollout map on every call. `classifyToolSurfaceAtUse` is: no row → admit;
  company mismatch → deny; not distributed → admit; distributed → admit only if the Organization is
  armed. The no-row admit is the DAT-007 fail-open class, and the record states it in §2. I accept it
  as disclosed, not as a proof.
- **F10 is real.** `distributed-tool-surface-arming.integration.test.ts` seeds two `organizations`
  rows, each with its own company and agent, on embedded PostgreSQL. The rollout map arms `tools: true`
  for `TENANT_A` only, with `TENANT_B` in canary and no `tools`.
- **Focused command, rerun locally (Windows) at the reviewed tip**, with
  `AOA_RUN_WIN_INTEGRATION=1`:
  - `crew-distributed-gate` 8, `distributed-tool-surface-per-organization` 30,
    `mcp-run-currency-gate` 11, and `distributed-tool-surface-arming.integration` **7, executed on real
    PostgreSQL (6154 ms)**. All passed.
  - `task-run-batch-workload` 95 passed. It first failed to load because the `worker-daemon` dist had
    not been built; after building it, it passed.
  - Total **151**, matching §3.
  - `pnpm --filter @armyofagents/server typecheck` exits 0 at the tip, after building the server's
    workspace dependencies (a clean checkout lacks `plugin-sdk/dist`).
- **Mutation, reproduced by me and reverted.** M1 (drop the `organizationToolsEnabled` check in
  `resolveDistributedToolSurface`) gives **4 failed / 44 passed (48)**. The four are unit *F10:
  deployment ARMED but this Organization not enabled*, real-PG *DISPATCH (F10)*, real-PG *USE (F10)*
  and real-PG *PER-TENANT ROLLBACK*. That is exactly the table's row. I checked the rest by reading
  the tests.
- **CI, by job.** Run `35591990274` (headSha `0254c5c67b94…`, conclusion `success`; all 16 jobs
  success, `ci-required` `106313954527`). Per-job logs:
  - `verify (3)` `106308267588`: `distributed-tool-surface-arming.integration.test.ts (7 tests) 3770ms`
    passed, not skipped. `distributed-tool-surface-per-organization.test.ts (30 tests)` passed. Shard
    654 / 4 files, 5913 / 29 tests.
  - `verify (1)` `106308267619`: `task-run-batch-workload` 95, `mcp-run-currency-gate` 11,
    `crew-distributed-gate` 8. Shard 655 / 3 files, 6401 / 12 tests.

  Every number in §7 matches.
- **Redemption-side refusal (expired lease).** The record cites it as existing coverage and did not
  re-run it. I checked it: *"a STALE fence token on the same live handle is DENIED"* is in
  `composed-loop-secret-resolve.integration.test.ts`, and that file executed in the same run's
  `verify (3)` (**3 tests**, 3630 ms, passed). So the plan's "refused at redemption" half is
  evidenced at the reviewed CI head, although not by a CLI-016 test.
- **Codex.** On PR #555, `chatgpt-codex-connector` reported "Didn't find any major issues" on the final
  head `04c73866c3`. There are no review-thread comments.
- **Acceptance items (E7 plan `### CLI-016`).**
  - Flag on and run fence-current → the argv carries the MCP config: **evidenced** (real-PG DISPATCH,
    A only).
  - Flag on and lease expired → denied at MCP authorization: **evidenced** (real-PG). Refused at
    redemption: **evidenced by existing coverage** (above).
  - Flag off → neither: **evidenced** (real-PG KILL SWITCH).
  - Two Organizations, one enabled for tools → A admitted, B denied (F10): **evidenced**, at dispatch
    and at use.
  - Absent `tools` means off, and a non-boolean fails the parse: **evidenced** (M4, M5).
  - GREEN, server typecheck and build, and the Linux executed count recorded: **evidenced**.
  - The integration file uses `describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")`:
    **true**.
  - One commit with the plan's title: **true**.
  - **Keyed real-E2B +/- controls: PENDING** (below).

**What remains open (this approval does not close it).**

1. **The keyed real-E2B +/- controls** (F8's named list): a tool call from an authorized run reaches
   AoA from inside an E2B sandbox, and the same call from an unauthorized run id and from an expired
   lease is denied. This build did not dispatch them, and I did not either; the M1 rules forbid a
   reviewer dispatching a keyed lane. They are the planning session's to run on a named candidate.
2. **No deployment arms any Organization.** The plan's Files line "deployment configuration for the
   named set" is not delivered here, and the record says so (§6). Arming is an operator step tied to
   (1).
3. **`E7-F003`'s tools row is narrowed, not closed**, as `findings.md` records.

A reader must not treat `complete` on this record as proof that the tool surface works from a
sandbox. It proves per-Organization arming at dispatch, and denial at `/mcp` use against real
PostgreSQL.

- **Not blocking, noted.** §5 says "All 45 … guards … (minus the six)". The count is not load-bearing,
  and I did not re-derive it for `0254c5c67`.

## Review attempt history

Later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-2B independent reviewer (Claude Opus 5) | `fc2eb7dde6325803c77950ac4adb1d190db0bd9a` | `approved` | Code verified at source: flag arms only on `per-organization`, legacy truthy values throw, the conjunction, and the `/mcp` use gate keyed on the signed run id and the run's own Organization. The two-Organization real-PG seeding is real. Focused rerun on Windows: 151 passed, integration 7 executed on real PG. Server typecheck 0. M1 reproduced exactly (4 failed). Run `35591990274` per job: `verify (3)` 7 (not skipped) + 30, `verify (1)` 95 + 11 + 8, all matching. Redemption refusal covered by `composed-loop-secret-resolve` (3 executed, `verify (3)`). Codex clean on `04c73866c3`. OPEN, not closed by this approval: keyed real-E2B +/- controls (F8, planning session); no Organization armed in any deployment; `E7-F003` tools row narrowed only. |
