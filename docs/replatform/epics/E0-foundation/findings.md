# E0 Findings

New findings use IDs `E0-F001`, `E0-F002`, and so on, and retain their resolution history. A finding records severity, evidence, affected tickets, disposition, and whether it blocks the gate. Findings are never silently deleted; resolved findings retain the resolution link.

## E0-F001 — Ticket-result template vs Task-9 gate-regex format conflict (Start SHA / Disposition)

- **Status:** resolved
- **Severity:** Minor
- **Blocks gate:** No (resolved inline by conforming the ledger to the gate format; template fix tracked below).
- **Discovered during:** FND-001 independent review / controller gate-format pre-check.
- **Evidence:** The Task-9 integration-gate parser in [`../implementation-plan.md`](../implementation-plan.md) Step 1 requires (a) FND-001's Start SHA as a **bare** 40-hex — `^\*\*Start SHA:\*\*\s*([0-9a-f]{40})\s*$` (no surrounding backticks), and (b) each ticket's Disposition as **backtick-wrapped** — `^\*\*Disposition:\*\*\s*` + `` `approved` ``. But [`../../../templates/ticket-result-template.md`](../../../templates/ticket-result-template.md) line 8 renders the Start SHA example **backtick-wrapped** (`**Start SHA:** \`<...>\``). The FND-001 implementer faithfully followed the template (backtick-wrapped Start SHA), and the FND-001 reviewer wrote a bare `approved` Disposition — both would fail the Task-9 regex.
- **Affected tickets:** FND-001 (result ledger), FND-005 (owns `docs/replatform/templates`), all FND-00x result ledgers (format convention).
- **Disposition:** Resolved for FND-001 by editing `tickets/FND-001-result.md` to the gate-conformant format — **bare** Start SHA, **backtick-wrapped** `` `approved` `` Disposition, `` `complete` `` Status — with the review substance (reviewer identity, reviewed revision, approved disposition, attempt-1 row) unchanged. **Convention for all remaining tickets:** implementers write `**Start SHA:** <bare-40-hex>`; reviewers write `**Status:** ` + `` `complete` `` and `**Disposition:** ` + `` `approved` ``; Reviewed revision may be bare or backticked (the gate regex allows optional backticks). **Carry-forward:** FND-005 should correct `ticket-result-template.md` line 8 so its Start SHA example is bare, matching the gate parser. Until then, this convention is authoritative over the template's example.
- **Carry-forward closed (verified 2026-09-03):** `docs/replatform/templates/ticket-result-template.md:8`
  now reads `**Start SHA:** 0000000000000000000000000000000000000000` — bare, not
  backtick-wrapped — and lines 10-12 spell the requirement out in prose. The FND-005
  carry-forward this finding was held open for is done, so the `Status:` is `resolved`.

## E0-F002 — FND-001 shared-checker code-hygiene carry-forward (fold into FND-002)

- **Status:** open
- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-001 code-quality review (disposition `approved`; items explicitly deferred to a later-ticket extension).
- **Evidence / items:** In `scripts/check-distributed-execution-foundation.mjs` at the FND-001 revision `490049551`:
  1. **Dead code on the spine** — the `__test` export (`.mjs:517-523`) is unused; its only purpose is to hold `fileURLToPath` (imported at `.mjs:40`), which nothing consumes. Prune both.
  2. **Defensive gap in forbidden-edge validation** (`.mjs:341`) — a present-but-malformed lifecycle (key exists, `states` missing) referenced by a forbidden edge throws a `TypeError` instead of pushing a clean error; still fails closed (exit 1 via `main`'s catch), but `runCheck(root)` throws for the `node:test` harness rather than returning a structured error. Guard it so it returns a clean error.
  3. **Unpinned mutation branches** in `scripts/check-distributed-execution-foundation.test.mjs` — reachability (unreachable state), non-terminal dead-end, forbidden self-lifecycle edge (`is not cross-lifecycle`), forbidden unknown-lifecycle/state, and reason-only guard drift have working checker logic but no mutation asserting them. Pin these as the corpus grows.
  4. **Prose not parity-checked** (optional future hardening) — the Markdown `Statuses:` enumerations and terminal-immutability prose are not cross-checked against JSON `states`/`terminal` (only the From/To transition tables are). Within the amendment's documented parity scope (edges + guard reasons), so not a defect; candidate hardening as later tickets grow the contract.
- **Affected tickets:** FND-002 (extends the same checker + `.test.mjs`).
- **Disposition:** **Resolved (items 1–3) in FND-002** commit `f5e45cf2b2a3ddf588307e2cba12ec2d183925f6` — dead `__test`/`fileURLToPath` pruned; the forbidden-edge validation now pushes a clean error (no `TypeError`) for a present-but-malformed lifecycle referenced by a forbidden edge; and the five previously-unpinned branches (unreachable state, non-terminal dead-end, forbidden self-lifecycle edge, forbidden unknown-lifecycle/state, reason-only guard drift) are pinned by mutations. Verified by FND-002 spec + code-quality review. **Item 4** (prose/`Statuses:` list not parity-checked) remains **open/optional** — candidate hardening for a later FND ticket as the contract grows.

## E0-F003 — Structural-checker negation/row-pinning hardening (carry into FND-003/FND-007)

- **Status:** open
- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-002 code-quality review (disposition `approved`; both notes make the checker stronger than the plan's substring-only requirement, so neither violates the stated acceptance).
- **Evidence / items** (in `scripts/check-distributed-execution-foundation.mjs` at FND-002 revision `f5e45cf2b`):
  1. **Same-sentence negation smuggle** — `requireNegatedMention` (~`.mjs:521`) tests each sentence for *any* negation word, so an affirmative clause appended to a sentence that already carries a negation is missed (probe: `"No AoA database is a peer replica except the worker SQLite which is a peer replica."` passes). The *separate-sentence* affirmation the FND-002 mutation targets IS caught; this is only the same-sentence variant.
  2. **Added contradictory matrix row not rejected** — `validateAuthorityMatrix` (~`.mjs:559`) pins the 7 required rows but does not assert row *count*, so an *added* contradictory authority row passes (removed/drifted required rows ARE caught).
- **Affected tickets:** FND-003 (threat-controls JSON + Markdown parity — reuses negation/row-pinning-style validation), FND-007 (crosswalk CM-*/CP-* row pinning), and any later ticket extending the negation/matrix scans.
- **Disposition:** Open — non-blocking hardening. When FND-003/FND-007 add their own row/ID pinning and invariant scans, tighten these two patterns (per-clause negation scoping; assert exact row/ID set incl. count / reject unknown rows). Not required for E0 gate pass. FND-003 applied item-2 exact-set parity for its threat register.

## E0-F004 — Threat-controls parity fields not in required-field set (carry into FND-004)

- **Status:** resolved
- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-003 code-quality review (disposition `approved`).
- **Evidence:** In `scripts/check-distributed-execution-foundation.mjs` at FND-003 revision `09651fb63`, the JSON crossing fields `threat`/`control`/`verification` are rendered into the Markdown register and value-compared in per-ID parity, but are NOT in `THREAT_CROSSING_REQUIRED_FIELDS`. Because each parity comparison is guarded by `typeof c.<field> === "string"`, **deleting** one of those fields from a JSON crossing yields zero errors (value-drift IS caught; only field-deletion escapes). All 30 crossings already carry these fields, so requiring them keeps the corpus green.
- **Affected tickets:** FND-004 (next to extend the checker), FND-007 (extends fixtures/parity).
- **Disposition:** **Resolved in FND-004** commit `3f10606a5` — `threat`/`control`/`verification` added to `THREAT_CROSSING_REQUIRED_FIELDS` with a field-deletion mutation; corpus stays green. The two smaller notes need no action.

## E0-F005 — FND-005 exclusions test: plan `createApp()` unit-import vs. codebase drizzle-ESM constraint (ratified deviation)

- **Status:** resolved
- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-005 implementation (reported DONE_WITH_CONCERNS) + controller investigation.
- **Evidence:** Plan Task 5 Step 4 specifies `distributed-execution-exclusions.test.ts` proves the reserved `/api/distributed-execution/{public-services,cloud-plugins}` routes 404 "through the real `createApp()` path". But `CLAUDE.md` §Test Patterns documents a drizzle-orm `require(esm)` cycle: **no server unit test can import the real app** (they mock `@armyofagents/db`+`drizzle-orm`); only `*.integration.test.ts` with embedded Postgres import the real app (e.g. `plugin-broker-cloud.integration.test.ts`, Windows-skipped per Issue #114). The implementer's dynamic `import("../app.js")` fails under vitest on every lane, so the two 404 cases are `it.skipIf(!appModule)`-skipped (honestly, not faked), while the `loadConfig()`-throws-on-excluded-sentinel cases run.
- **Why non-blocking:** the reserved-route protection is actually provided by (a) the always-on **source-boundary checker** in `check-distributed-execution-foundation.mjs` (rejects any import of a reserved distributed public-ingress/cloud-plugin-runner module and any registration of the two reserved path prefixes — static, runs in the policy job), and (b) **`loadConfig()` hard-rejects** the excluded sentinels at startup. With no reserved-route code existing (source-boundary-enforced), an unregistered path returning 404 is trivially guaranteed; the runtime 404 proof is redundant.
- **Affected tickets:** FND-005 (this deviation); **FND-006/FND-008** — MUST use `*.integration.test.ts` (embedded PG, Windows-skip, Linux-CI-authoritative) for their real `createApp()`/startup-composition cloud-denial + self-hosted-positive proofs, per this same constraint and the crosswalk.
- **Disposition:** **Ratified by custodian.** Keep the unit test (loadConfig-throws runs; 404 skipped with the documented rationale). No embedded-PG integration test is warranted for a trivial unregistered-route 404. Recorded in FND-005-result.md Deviations.

## E0-F006 — FND-005 build reproducibility: digest-manifest pin vs. committed snapshot bytes (ratified deviation)

- **Status:** resolved
- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-005 implementation (reported DONE_WITH_CONCERNS) + controller investigation.
- **Evidence:** Plan Task 5 Step 8 / hardening amendment say `pnpm build` must "consume only checked-in snapshots whose source URL/version/digest are recorded in a committed manifest." Investigation showed the two snapshot files (`ui/src/aoa-marketplace-snapshot.json`, `ui/src/aoa-connectors-snapshot.json`) were **already `.gitignore`d before FND-005** (`.gitignore:59-61`, "fetched at build time, not committed") and are **not statically imported** by any build (runtime-loaded fallbacks; UI fetches via `/api/marketplace/catalog`, server dynamic-imports at runtime) — so `pnpm -r build` does not consume them as compile inputs. Committing them would reverse a deliberate `.gitignore` decision and add ~1.5 MB of volatile third-party catalog data (with a changing `generatedAt`).
- **Resolution the implementer chose:** keep snapshots gitignored; commit a small `scripts/bundled-snapshots.manifest.json` pinning each snapshot's `file`/`sourceUrl`/`version`/`sha256`/`order`; `prebuild` runs `check-bundled-snapshot-inputs.mjs` (network-free; verifies manifest shape always + a present snapshot's digest); intentional refresh is the new explicit `pnpm refresh:bundled-snapshots`. Verified: `pnpm build` and `pnpm -r build` exit 0, do no CDN fetch, and leave tracked bytes byte-identical (`git status`/`git diff --check` clean). This is the D0-R02 "**split refresh from build**" option (explicitly sanctioned alongside "pin those inputs").
- **Deviation from the plan's literal Step-10 `git add` list:** one file beyond the list — `scripts/bundled-snapshots.manifest.json` — which Step 8's "committed manifest" requirement mandates but the Step-10 list omitted (a plan inconsistency). No `.gitignore` change; snapshot bytes not committed.
- **Affected tickets:** FND-005.
- **Disposition:** **Ratified by custodian.** Achieves the real reproducibility goal (network-free, tracked-byte-clean build) without reversing the pre-existing gitignore or bloating the repo, per D0-R02's split-refresh option. Recorded in FND-005-result.md Deviations.

## E0-F007 — FND-006 test-flip scope deviation + FND-008 carry-forwards (ratified)

- **Status:** open
- **Severity:** Minor
- **Blocks gate:** No.
- **Discovered during:** FND-006 implementation (DONE_WITH_CONCERNS) + spec + code-quality review (both approved; every flip corroborated source-correct).
- **Evidence / items** (FND-006 commit `f916457be`):
  1. **Extra-test-flip scope deviation (ratified):** reversing the pre-FND-006 (U10-era) "plugins allowed in cloud" behavior inverted the expectations of 4 test files beyond the plan's Step-5 `git add` list — `plugin-tenant-routes.test.ts`, `marketplace-install-plugin.test.ts`, `company-plugin-upgrade-rollback.test.ts`, `plugin-lifecycle-upgrade.test.ts` (plus `plugin-worker-manager.test.ts`, which the implementer brief explicitly authorized). All flips are **test-only** (no production code outside the plan's 5 source files: `cloud-plugin-execution.ts`/`plugin-worker-manager.ts`/`plugin-lifecycle.ts`/`app.ts`/`index.ts`), and each flip asserts the CORRECT Decision #103 blocked behavior derived from source (cloud reads project blocked `status="error"`+`PLUGIN_WORKER_BLOCKED_IN_CLOUD`+`CLOUD_PLUGIN_BLOCK_MESSAGE`; install/load throw `CloudPluginExecutionBlockedError`; rollback route 503-before-DB/authz). Ratified — necessary to keep the suite green after a required behavior reversal; mirrors the E0-F006 precedent.
  2. **Stale RW5a comments → FND-008 cleanup:** now-false "stays allowed on cloud"/"inert on cloud" comments remain at `plugin-lifecycle.ts:500-502`, `routes/plugins.ts:332-334`, `services/marketplace-install/plugin-installer.ts:95-101`, `routes/company-plugins.ts:327-330`. Code behavior is correct (centralized gate fires); only comments are stale. 3 of 4 files are outside FND-006's scope (correctly left untouched). **FND-008 re-touches `plugins.ts`/`company-plugins.ts`** — clean up the comments there.
  3. **Linux-CI-authoritative integration verification (open — before Task 9):** the real `createApp()`/startup composition proofs — `plugin-broker-cloud.integration.test.ts`, `cloud-plugin-process-composition.test.ts` (real-app portions), `plugin-tenant-routes.test.ts` — Windows-skip (embedded-PG / drizzle `require(esm)` cycle, E0-F005). The flips are source-derived + typecheck-clean but were NOT executed locally. **Controller must run these (and FND-008's equivalents + the full `pnpm test:run`/`pnpm -r typecheck` DEC-03 baseline) in a short-path detached worktree with embedded Postgres before the Task-9 gate**, since no Linux CI is being triggered (operator directive: run locally).
- **Affected tickets:** FND-006 (deviation), FND-008 (comment cleanup + shares the integration harness), Task 9 (integration + baseline run).
- **Disposition:** Items 1 ratified/closed; item 2 partially resolved in FND-008 (`plugins.ts`/`company-plugins.ts`/`plugin-loader.ts` cleaned; residuals in `plugin-lifecycle.ts`/`marketplace-install/plugin-installer.ts`/`plugin-ui-static.ts` remain, cosmetic/dead-on-cloud); item 3 (Linux-CI integration run) open → Task 9.

## E0-F008 — FND-008 marketplace-install 404 deviation + residual minors (ratified)

- **Status:** open
- **Severity:** Minor
- **Blocks gate:** No (marketplace-install is fail-closed; Decision #103 execution exclusion fully met).
- **Discovered during:** FND-008 implementation (DONE_WITH_CONCERNS) + spec + code-quality review (both approved).
- **Evidence / items** (FND-008 commit `0f04cc747`):
  1. **Marketplace INSTALL orchestrator returns 404, not a 503 stub (ratified acceptable-interim).** In `cloud_auth` the `createMarketplaceInstallRouter` stays UNMOUNTED (`app.ts:740`, off-cloud `if` only) → a request to that one endpoint gets a generic **404** instead of the documented 503 envelope. It is genuinely **fail-closed** (loader `undefined`, no package I/O/import/execution reachable); the PRIMARY install path `POST /plugins/install` DOES return the 503 stub (gate `plugins.ts:955` before `loader.installPlugin`); this is a valid CP-004 "reject before I/O" disposition (marketplace-install is a CP-004 install path, not a CP-003 tool/job/webhook surface); and no test bakes in the 404 as a permanent contract. The 503-stub for this one endpoint would require touching out-of-scope files — **deferred to 1.1**. Ratified non-blocking by custodian; spec + code review concur.
  2. **Residual stale RW5a comments** in `plugin-lifecycle.ts:500-502`, `marketplace-install/plugin-installer.ts:95-101`, `plugin-ui-static.ts:270-273` (all outside FND-008's `git add` set; code behavior correct; comments cosmetically stale in dead-on-cloud paths). Low priority.
  3. **Code-review Minors (non-blocking, safe):** (M1) `company-plugins.ts:470`/`plugins.ts` disable persists the `enabled=false` metadata write then returns 503 in the narrow pre-boot-reconciliation window where a row is still `status:"ready"` — outcome safe (disabled, never enabled/run), self-corrects at boot; (M2) enable + settings routes rely on the `blockActivationInCloud` facade-throw+catch rather than a pure entry gate — functionally correct (503, no effect leak), less uniform than the new uninstall/disable entry gates.
- **Affected tickets:** FND-008; program 1.1 (marketplace-install 503 stub + comment cleanup + M1/M2 uniformity).
- **Disposition:** Item 1 ratified acceptable-interim non-blocking; items 2–3 open, cosmetic/low-priority, deferred to 1.1. None block the E0 exit gate (Decision #103 execution exclusion fully met; the Task-9 integration run confirms on embedded PG).

## E0-F009 — Task-9 embedded-PG integration gate caught 2 defects (fixed)

- **Status:** resolved
- **Severity:** Medium
- **Blocks gate:** No (both fixed + re-verified green before the gate decision).
- **Discovered during:** Task-9 integration gate — the short-path detached worktree (`C:/e0gate`) embedded-Postgres run (`AOA_RUN_WIN_INTEGRATION=1`) of the FND-006/008 cloud-denial integration proofs, which the OneDrive worktree cannot run (embedded-PG MAX_PATH). The unit tests + `pnpm -r typecheck` + independent source-review did NOT catch these — running the DB-backed integration tests locally did (initial run: 84/86; after fix: 86/86).
- **Items (fixed in gate-repair commit):**
  1. **Cloud-denial facade threw synchronously** (`server/src/routes/plugins.ts` `cloudPluginDenialProxy`) — but it backstops the real loader/lifecycle methods, which are **async** (Promise-returning), and the FND-008 integration facade test correctly asserts async rejection (`.rejects`). The sync throw escaped the matcher. **Fix:** the proxy now returns `() => Promise.reject(new CloudPluginExecutionBlockedError())`, matching every awaited/`.catch()` call site and closing a latent non-awaited-caller footgun. The real routes are unaffected (they `await`/catch → 503) — verified by `plugin-tenant-routes.test.ts` 44/44 + `cloud-plugin-process-composition.test.ts` 7/7 still green after the change.
  2. **Stale c2 tenant-isolation assertion** (`server/src/__tests__/plugin-broker-cloud.integration.test.ts`) — expected a c2 JWT calling c1's tool to `404` (company-scoped `getTool` miss), but FND-008's cloud-block **403/-32003** now fires strictly earlier, before the tenant-scoped lookup. The 403 is CORRECT and strictly safer (c2 is denied all plugin dispatch; the response discloses nothing about whether c1 owns the tool). The FND-008 flip updated the c1 assertion but missed this c2 sub-case. **Fix:** the assertion now expects `403/-32003` with the tenant-isolation rationale documented. Code was correct; the test was stale.
- **Affected tickets:** FND-008 (facade code — `plugins.ts`), FND-006/008 test flip (`plugin-broker-cloud.integration.test.ts`). Both files were reviewed at their ticket revisions; this is a Task-9-gate scoped-defect repair (the plan Task 9 explicitly permits "Modify only if verification exposes a scoped defect").
- **Disposition:** **Fixed and re-verified green** (86/86 across the 7 E0 integration files on embedded PG; server typecheck 0; dependency-free checker + mutations pass; E0 unit suites unchanged). Lesson: for cloud-execution-boundary code, run the DB-backed integration tests on a short-path embedded-PG worktree before the gate — unit + typecheck + review are necessary but not sufficient.
