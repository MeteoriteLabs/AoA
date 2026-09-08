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
- **Items:**
  1. **Same-sentence negation smuggle** — `requireNegatedMention` (~`.mjs:521`) tests each sentence for *any* negation word, so an affirmative clause appended to a sentence that already carries a negation is missed (probe: `"No AoA database is a peer replica except the worker SQLite which is a peer replica."` passes). The *separate-sentence* affirmation the FND-002 mutation targets IS caught; this is only the same-sentence variant.
  2. **Added contradictory matrix row not rejected** — `validateAuthorityMatrix` (~`.mjs:559`) pins the 7 required rows but does not assert row *count*, so an *added* contradictory authority row passes (removed/drifted required rows ARE caught).
- **Affected tickets:** FND-003 (threat-controls JSON + Markdown parity — reuses negation/row-pinning-style validation), FND-007 (crosswalk CM-*/CP-* row pinning), and any later ticket extending the negation/matrix scans.
- **Disposition:** Item 2 is done. Item 1 is **partly** done, and the part that is not is described below rather than summarised, because two earlier revisions of this entry summarised it wrongly in the closing direction. The status stays `open` for that reason; the residual class is declared `accepted` in `scripts/finding-ownership.json`.
  - **What the checker now refuses.** In `scripts/check-distributed-execution-foundation.mjs`, at **both** scanned sites — `requireNegatedMention` over the authority doc's three needles (`peer replica`, `authoritative state`, `auto-applied`) and FND-007's CM-015 no-auto-bypass clause check — a needle-bearing sentence is split into clauses, and each clause carrying the needle must contain at least one negation word **per mention** of the needle. Two arms:
    - **Clause scoping** (`NEGATION_CLAUSE_SPLIT_RE` + `splitNegationClauses`). Boundaries are punctuation (`;` `,` `|` `.` and the dashes) plus the conjunctions that start a new assertion, **including `and`/`or`/`while`/`so`/`yet`**. Degenerate case (the needle straddles a boundary) falls back to the sentence.
    - **A per-mention negation budget** (`negationDeficit`), vocabulary-free. A boundary list is an enumeration and is always one word short; these invariants are needle-scoped, so a smuggled affirmative has to name the needle again, and one negation is then made to cover only one mention.
    - The two arms are **complementary and neither subsumes the other**, measured: an unlisted joiner (`plus`, `then`, `also`, `whereupon`, or a bare space) is rejected only by the budget; a smuggle that meets its budget (`"No AoA database is a peer replica and it is not authoritative and the worker SQLite is a peer replica"`) is rejected only by the split. Each arm has its own mutation at each site.
  - **★ What the scan does not see.** Both arms count negation **tokens** inside a scope. Neither binds a negation to the mention it has to negate. An appended affirmative clause that carries any word from the negation vocabulary therefore meets its own budget and raises no error — and it raises none **whatever the joiner, including the punctuation the pre-fix splitter already split on**, so **widening the JOINER list does not reach this class** - measured across every probe in the table below, the smuggle passes the budget arm whatever the joiner. Whether some OTHER widening reaches it was not measured, and this sentence does not claim it cannot. Measured against the shipped checker:

    | appended clause | joiner | shipped checker | pre-fix checker (`da1a90597`) |
    |---|---|---|---|
    | `the worker SQLite is a peer replica` | `whereupon` | error | no error |
    | `the worker SQLite is a peer replica` | `and` | error | no error |
    | `the worker SQLite is a peer replica that no operator may disable` | `whereupon` | **no error** | no error |
    | ...same | `and` | **no error** | no error |
    | ...same | `, ` | **no error** | no error |
    | `the worker SQLite is a peer replica which cannot be turned off` | `; ` | **no error** | no error |
    | CM-015: `the operator override auto-bypasses the gate without delay` | `whereupon` | **no error** | no error |

    This is an uncovered class, not a regression: all seven probes raised no error before the change, and two of them raise one now. It is an instance of item 1's own words — an affirmative clause appended to a sentence that already carries a negation, missed. It is held by the two `E0-F003 item 1 KNOWN LIMIT` cases in `check-distributed-execution-foundation.test.mjs`, which assert the miss so that the limit cannot drift into an assumed closure; a positive control (drop the smuggle's own negation token) turns them red, so they are not vacuous.
  - **Why it is not chased.** The rule that would reach it — require each mention to be *preceded* by an unconsumed negation within its scope — rejects correct English of the form `"A peer replica is never created by any AoA database"`, where the negation legitimately follows the mention. Zero false positives on this corpus would be weak evidence for such a rule: **the two documents contain four needle-bearing sentences in total, one per scanned invariant.** An honest uncovered class is preferred to a guard that rejects correct prose.
  - **The same measurement bounds the widening that WAS done.** The `and`/`or`/`while`/`so`/`yet` boundary set produces zero errors on the unmodified corpus — over those same four sentences. That is evidence the exclusion bought no precision *here*; it is not evidence that splitting on `and` is safe for English generally.
  - **Correction — the first fix covered only the `except` instance, and its stated rationale was false.** The revision at `86db5238d` excluded `and`/`or`/`while` from the boundary set with the comment that splitting there "would reject correct prose". Changing one word of the finding's own probe from `except` to `and` re-opened the smuggle **at both scanned invariants**, including on a real corpus sentence (`"Expired or replaced attempts cannot update authoritative state and a replayed attempt may update authoritative state."`). A rationale asserted rather than measured is worse than an unexplained gap: it tells the next reader the hole was considered. The comment defending it is replaced by the measurement and by the size of the measurement.
  - **Item 2 —** `validateAuthorityMatrix` rejects malformed, **duplicate** and **unknown** rows before comparing the expected set. The measured mechanism was wider than the finding stated: the state-keyed `Map` plus an expected-rows-only loop meant an added row was never *read*, **and** a duplicate state was laundered by last-write-wins, so row **order** alone decided whether a contradiction was visible.
  - **No separate row-COUNT clause**, against the finding's literal wording: with unknown rows rejected, duplicates rejected, and every expected row required, the count is *entailed* — a count assertion could never fire on its own, and an unfalsifiable clause is the "check that nothing runs" failure class rather than defence in depth. The exact-set property the item asked for is asserted; only the redundant restatement of it is not.
  - **A THIRD site, found by measuring rather than by reading.** This finding's *Affected tickets* line names "any later ticket extending the negation/matrix scans", and FND-007's CM-015 no-auto-bypass invariant — the one place the pattern *was* applied — carried the same blind spot: its private `crosswalkClauses` splitter was punctuation-only, so a contrastive carve-out with no punctuation stayed inside the negated clause and rode the `never`. Measured at `da1a90597`: the mutated crosswalk produced **zero** checker errors. `crosswalkClauses` had exactly one caller and is deleted; both sites now share `splitNegationClauses`. Two splitters where one is weaker is how this class returns.
  - **Mutation record.** 11 guard clauses, each first shown to pass the unfixed checker and then individually neutered and shown to turn its own test red and nothing else; all restored, restore md5-verified. Those 11 were measured at the preceding revision of this branch and are **not** re-run by the disclosure pass above; the checker's executable logic is byte-identical between the two (the later diff touches comments only), which is why the record still stands. Corpus 206/206.
- **Correction to the prior disposition and to the ownership register.** The sentence "FND-003 applied item-2 exact-set parity for its threat register" was true as written but was read as closing item 2; the `scripts/finding-ownership.json` entry restated it as "Item 2 ... WAS applied by FND-003's exact-set parity", which was **wrong** — and self-contradictory, since the same entry also said both named tickets "shipped without doing so". FND-003 and FND-007 applied the *patterns* to their **own new surfaces** (the DE-01...DE-30 register ID set; the CM-001...CM-015 / CP-001...CP-005 row sets and the CM-015 migration-0188 clause split) and their result docs say so in those words; **neither retrofitted `requireNegatedMention` or `validateAuthorityMatrix`.** Measured at `da1a90597`: mutations of both original sites produced **zero** checker errors. The named remediation window closed with the item undone, not declined. The 2026-08-08 E0 epic-completion handoff carries the same misreading ("applied by FND-003 ... and FND-007 ... count pin") and is left unedited as a frozen record; this register is the live authority.

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

## E0-F010 — Eight trust crossings assert that denials are audited; on every one of them the deny path returns before anything durable is written, so a refused cross-tenant read, a replayed credential and a shed submission are all indistinguishable from traffic that never happened

- **Status:** open
- **Severity:** HIGH
- **Filed:** 2026-09-08, by W20 (the DE-audit landing unit). Every citation below was measured
  at tip `360d0b0ed`, not inherited.
- **Blocks gate:** No — this is a detection gap, not an enforcement gap. Every crossing named
  here **does deny**; what is absent is the record of the denial.

**The class.** `docs/architecture/distributed-execution-threat-controls.json` gives every crossing
an `audit` clause. The clause fields are, by the register's own note, *"a charter, not a report"* —
but until W20 no crossing's audit clause had been measured against source at all. Eight have now
been, and **all eight are absent**. The shape is identical every time: the enforcement point
returns or throws a refusal, and the refusal reaches the caller as a status code or an exception
with **no row, no metric and no log line** recording that a security control fired.

| Crossing | `audit` clause, verbatim | The line that denies | What records it |
|---|---|---|---|
| DE-01 (Critical) | "query and policy-denial events recorded in the control-plane audit log" | The RLS policy itself — `packages/db/src/migrations/0211_tenant_rls_enforcement.sql:26-28` and 24+ siblings. A read is silently filtered; a write raises 42501. | **Nothing.** No production code handles SQLSTATE 42501 or the string `row-level security policy` — a grep over `server/src` + `packages/*/src` excluding tests returns only prose (e.g. `server/src/services/job-input-staging.ts:25`). The one control-plane audit writer for this path, `jobAuditBridge` (`server/src/services/job-audit-bridge.ts:158`), has **zero production callers** — its only references are its own definition and `server/src/__tests__/job-audit-parity.integration.test.ts:24,42`. |
| DE-03 (High) | "enrollment, session issue, and replay-rejection are audited" | `packages/db/src/repositories/tenant/worker-enrollment.ts:273-276` (`onConflictDoNothing().returning()` → `rows.length === 1`), turned into a refusal at **nine** production call sites. | **Nothing on the job/lease paths.** The refusal returns via `sendWorkerOperationProtocolError` (`server/src/services/worker-protocol-http.ts:76-93`), which writes the HTTP response and nothing else, and the route returns at `server/src/routes/worker-control.ts:436-442` **before** the handler's only `logger.error` at `:444`. |
| DE-04 (Critical) | "claim, fence-generation, and stale-claim rejection are audited" | `packages/db/src/repositories/tenant/job-control.ts:1167` / `:1177` / `:1185` / `:1187` (`guardActiveFence`, 11+ governed mutators call it). | **Nothing.** The one table that looks like it records rejections, `worker_lease_rejections`, is an eligibility-certificate cache whose own header excludes exactly this class — *"Dynamic capacity, liveness, lock, parsing, and **authority failures** are deliberately excluded"* (`packages/db/src/schema/worker_lease_rejections.ts:16-18`), and its single writer (`job-control.ts:2127`) inserts placement certificates, not fence refusals. |
| DE-06 (Critical) | "object put/get and rejected-key attempts are audited" | `server/src/services/artifact-transfer-grant.ts:113` (upload key outside this org's prefix), `:201-202` (download), `packages/db/src/repositories/tenant/job-control.ts:2750-2751` (commit). | **Partly — and this is the one row in the table where "nothing" would be wrong.** A rejected *commit* does emit a **count-only** metric: `metrics?.artifactOp({operation:"commit", outcome:"rejected", count:1})` (`server/src/services/artifact-commit.ts:246-250`), and the sink is genuinely wired in production (`createPinoJobControlMetrics`, `server/src/index.ts:657-660`). It is **not an audit record**: by deliberate design it carries no organization, no object key, no reason and no actor (`job-control-metrics.ts:15-17` — high-cardinality ids ride the logger spine, never a metric label), so a breach cannot be attributed or reconstructed from it. The *grant* rejections emit nothing at all: `rejected()` (`artifact-transfer-grant.ts:76-85`) only constructs a parsed response object, and although `ArtifactOpOperation` includes `"transfer_grant"` (`job-control-metrics.ts:30`), the sole production `artifactOp` caller is the commit path. |
| DE-11 (High) | "sensitive-artifact access and retention are audited" | — (the controls themselves are absent; see `E8-F011`) | **Nothing**, and the code says so: `server/src/services/artifact-commit.ts:172-173`. |
| DE-12 (Critical) | "partition, drain, and generation changes are audited" | `packages/db/src/repositories/tenant/job-control.ts:1667-1679` (the generation gate) | **Nothing**, and nothing could: `services.generation` has **no writer anywhere in the tree** (`grep -rn "update(services)"` returns zero hits outside comments), so no generation change exists to audit. |
| DE-13 (High) | "admission, throttle, and quota-breach events are audited" | `server/src/services/org-concurrency.ts:248` (capacity) and `server/src/services/worker-admission-rate-limit.ts:139` (`over_cap`). | **Nothing for the throttle.** `server/src/routes/worker-control.ts:414-416` returns the 429 through the same silent `sendWorkerOperationProtocolError`. The capacity 429 (`server/src/services/job-submission.ts:353`) surfaces only a generic `job_submission_rejected` reason code carrying neither cap nor usage. |
| DE-14 (Critical) | "the startup safety-assertion outcome is logged" | `server/src/config/distributed-execution.ts:72` — measured throwing (see the DE-14 register evidence). | **Nothing, in either direction.** `server/src/config/distributed-execution.ts` imports no logger and contains no `logger`/`console` call at all — its only import is `import type { DeploymentMode }` at `:1`. The failure surfaces as an unhandled module-eval crash trace; the success outcome is never recorded. |

**Why this is HIGH and not cosmetic.** Seven of the eight crossings are the ones an operator would
have to reconstruct an incident from. A cross-tenant read denied by RLS produces no error at all —
it returns zero rows — so without an audit record there is no difference, anywhere in the system's
own memory, between "an attacker probed thirty organizations and was refused thirty times" and
"nobody asked". This is the detection half of the same programme lesson that produced
`scripts/check-guard-inventory.mjs`: a control that fires unobserved cannot be shown to have fired.

**What it is NOT.** It is not a claim that any of these controls fail to deny. W20 measured every
one of them denying (DE-01 across 4,460 adversarial operations against real PostgreSQL; DE-14 by
executing the assertion directly). The register rows for those crossings are `partial`, not
`not-delivered`, precisely because the enforcement halves hold.

**★ A WRITER NOW EXISTS, AND NONE OF THESE EIGHT USE IT (2026-09-08).** The E0 denial-audit slice
built `recordSecurityDenial` (`server/src/services/security-denial-audit.ts`) and closed exactly
one crossing's audit clause — **DE-19, in `E0-F013`'s cohort, not this one**. **All eight crossings
in this finding are unchanged and this finding stays open.** Recorded here because the *reason*
this finding gave for `unowned` — "a denial-observation point would have to be built rather than
connected" — is now half-answered: the storage half is built and has a production caller. What is
still true, and is why these eight did not come with it, is stated in the follow-on list under
`E0-F013`. Two things from that slice bear directly on this finding: (1) **DE-01's read half is
confirmed unbuildable by interception** — PostgreSQL emits no event when an RLS `USING` clause
filters rows, so detecting it needs a `BYPASSRLS` comparator, i.e. exactly the privilege
`packages/db/src/client.ts:325` throws at boot to forbid; **DE-01's WRITE half is different and IS
interceptable**, because a `WITH CHECK` violation raises catchable SQLSTATE `42501`. (2) DE-04,
DE-12 and DE-13's capacity half deny by `throw` **inside the tenant transaction**, so an
in-transaction write of the denial rolls back with it; `recordSecurityDenial` is documented as
requiring a pool-level handle and that separate-transaction lifecycle is not yet built. Neither is
a wiring task.

- **Affected crossings:** DE-01, DE-03, DE-04, DE-06, DE-11, DE-12, DE-13, DE-14 — **all eight
  still open.** (DE-11's is carried in detail by `E8-F011`; it is listed here so the class is
  complete.)
- **Disposition:** `unowned`. No ticket on disk owns "record a denial" for these eight. The
  nearest candidate, `jobAuditBridge`, exists and is caller-less; wiring it is not a code-motion
  task, because the DE-01 case has **no error to intercept** (a filtered read is a successful empty
  read), so a denial-observation point would have to be built rather than connected. Minimum work
  is stated in the ownership manifest entry. NOT `accepted`: HIGH may never be accepted.
- **Resolution condition:** each row's `audit` clause is either delivered against a named record
  point with a production caller, or AMENDED to state what the programme intends. Amending is a
  founder decision and is not taken here. Resolve = flip this Status and delete the `E0-F010` key
  in `scripts/finding-ownership.json` in the SAME commit.

## E0-F011 — Four crossings are defended by a control whose ARMING PATH is dead: two have zero production callers, one is enabled by an environment variable set in no manifest, and one is gated on a database column with no writer

- **Status:** open
- **Severity:** HIGH
- **Filed:** 2026-09-08, by W20 (the DE-audit landing unit). Caller counts below were taken by
  enumerating the single write or construction chokepoint, not by grepping call sites.
- **Blocks gate:** No — but it is the reason four register rows are `partial` rather than
  `delivered`, and each of the four looks delivered from the register.

**The class.** In each case the *receiving* half of the control is fully built, tested and
correct — and the half that would ever arm it does not run in any deployment. This is the
`checks-that-nothing-runs` failure one level up: not a guard with no caller, but an **enforcement
mechanism with no producer**. From the register, and from the owning tickets' acceptance clauses,
all four read as shipped.

1. **DE-05 (Critical) — quarantine of late/lost-ACK output has no producer.** The receiver is
   real and denies correctly (`server/src/services/quarantine-finalize.ts:48,52-54`;
   `packages/db/src/repositories/tenant/job-control.ts:3686` `recordOrphanQuarantine`, whose
   deny lines are `:3707` `target_revoked`, `:3722` and `:3742` `unknown_job`). The producer is three dead
   layers deep: `runOrphanQuarantine` is called only from `startup-reconcile.ts:480`; that runs
   only if `deps.quarantineCandidates` is supplied (`:468`); and its factory
   `createStartupReconciler` (`:292`) has **zero production callers** — every reference outside
   its own module is a test or the barrel re-export at `packages/worker-daemon/src/index.ts:634`.
   Consequence: **no shipped path can ever write a quarantined artifact row.**
2. **DE-07 (Critical) — the secret-handle revocation lever cannot be pulled.** The clause is
   *"lease or fence loss invalidates handles; the broker revokes grants."* The fence half holds
   (`job-control.ts:3005`). The broker half does not: `job_secret_handles.revoked_at` is **read**
   (`job-control.ts:2992`, `isNull(...)`) and declared (`packages/db/src/schema/job_secret_handles.ts:81`),
   and the **single write chokepoint** for that table — `tx.update(jobSecretHandles)` at
   `job-control.ts:3139`, the only such call in the tree — sets exactly
   `lastResolvedAt`, `resolveCount`, `updatedAt` and optionally `appliedPolicyVersion`. It cannot
   set `status` or `revokedAt`. **No code path anywhere can revoke a handle.** Separately,
   broker-owned refresh throws unconditionally (`server/src/services/execution-secret-brokers.ts:58-61`).
3. **DE-10 (High) — orphan sandbox destruction is disarmed in every deployment, twice over.**
   Server-side: `reconcile-reaper.ts:192` destroys, reached from `bin/adapter-manager.ts:228`
   → `reaper-loop.ts` — but only when `resolveReaperConfig` returns `enabled`, which requires
   `AOA_ADAPTER_MANAGER_REAPER_ENABLED` to trim to **exactly** `"1"` (`reaper-loop.ts:55`). A
   whole-tree grep finds that variable in docs, code and one test — and in **zero** deployment
   manifests, so the loop is never started. Worker-side: WRK-007's restart reconciliation is the
   same dead `createStartupReconciler` as (1) — `bootstrapWorkerDaemon` builds an empty step list
   when no reconciler is injected (`packages/worker-daemon/src/bin/worker-daemon.ts:603`, whose
   own comment at `:601` says *"the current default"*), and neither production entry point injects
   one. Consequence: **a crashed worker's sandbox is reclaimed only by the provider's own 60s TTL,
   and nothing in this system reclaims it.**
4. **DE-12 (Critical) — the generation fence is production-unreachable and has no writer.** The
   deny exists (`job-control.ts:1667-1679`, `eq(services.generation, input.generation)` at `:1675`)
   and is taken at `server/src/services/job-submission.ts:229` (`if (!executionPrincipal) throw
   denial();`, closing the `service_reconcile` arm opened at `:222`). But that arm sits behind a
   requester-kind gate — `SOURCE_REQUESTER_KINDS.service_reconcile = ["system"]`
   (`job-submission.ts:99`), checked at `:164` and refused at `:166`, i.e. **one gate earlier than
   the generation check** — and the only `system` principal producer in the tree is
   `server/src/services/one-shot-sandbox-cli.ts:293`,
   which submits `one_shot`. Even if it were reachable, `services.generation` has **no writer**:
   `repos.services` exposes `insert` / `getById` / `listForCompany` and no update
   (`packages/db/src/repositories/tenant/index.ts:215-226`), and there is no `update(services)`
   call anywhere in the tree. A generation rollover cannot be performed, so the fence cannot fire.

**Why each is HIGH.** (1) and (3) are silent data/resource losses — a late result is dropped rather
than quarantined, and an orphan sandbox is billable. (2) means the only revocation story for a
resolved execution secret is fence expiry; an operator who learns a handle is compromised has no
lever. (4) means DE-12's `failureMode` — *"two service instances act as active simultaneously"* —
has no control at all, only a gate that nothing can reach.

**What it is NOT.** None of the four is a *wrong* implementation. Each ticket's own result document
is honest about its scope (`WRK-007-result.md`: *"inert-until-wired (E4-D12)"*;
`CLI-004-result.md` residual risk 2: *"No live periodic reconciliation LOOP"*;
`SVC-001-terrain.md:216-218` explicitly disclaims DE-12). The defect is that the **register**
carried none of that, so four Critical/High crossings read as chartered-and-owned while their
controls could not fire.

- **Affected crossings:** DE-05, DE-07, DE-10, DE-12.
- **Disposition:** `unowned` for the class. Per-item ownership is uneven and is stated in the
  ownership manifest entry: (3)'s server half needs four environment settings and no code (the
  experiment is written out in `docs/replatform/DE-AUDIT-live-experiments.md`); (1) and (3)'s
  worker half need the E4-D12 composition-root wiring, which no ticket on disk carries; (2) needs
  a revoke mutator or the deletion of the dead clause; (4) needs SVC-002/003/005, none of which
  are written. NOT `accepted`: HIGH may never be accepted.
- **Resolution condition:** for each item, either the arming path gains a production caller and
  the crossing is re-measured, or the clause is deleted from the register — *a guard that nothing
  can arm is the failure class this programme has already shipped three times.* Resolve = flip this
  Status and delete the `E0-F011` key in `scripts/finding-ownership.json` in the SAME commit.

## E0-F012 — Three crossings name a mechanism that no code anywhere attempts: a capability restriction never passed to the provider, a fair-share scheduler with no tenant term in its ORDER BY, and a "scoped service identity" that is one bucket-wide credential

- **Status:** open
- **Severity:** HIGH
- **Filed:** 2026-09-08, by W20 (the DE-audit landing unit).
- **Blocks gate:** No.

**How this differs from `E0-F011`.** There the mechanism is built and its arming path is dead. Here
there is no mechanism: the clause names a control and the codebase contains no attempt at it. The
distinction matters for remediation — `E0-F011`'s items are wiring or configuration; these are
design work, and one of them may not be expressible at all against the current provider.

1. **DE-09 (Critical), `integrity`: "image and capability restrictions prevent host command
   execution."** The only path that creates a provider sandbox is
   `packages/sandbox-e2b-provider/src/real-transport.ts:98-103`, and it passes exactly
   `{ apiKey, timeoutMs, metadata, envs }` to `sdk.create`. **No capability, user, seccomp or
   isolation configuration is passed at any point.** The one object in the tree that looks like the
   control — `CLI_001_CAPABILITY_MATRIX` (`packages/sandbox-e2b-provider/src/capability-matrix.ts:59`)
   — is a **typed fixture**: its only references outside its own module are the barrel re-exports at
   `packages/sandbox-e2b-provider/src/index.ts:49,55`. It is a declaration, and a declaration is not
   enforcement. ★ Before anyone writes an enforcement point here, the prior question must be settled
   against the pinned e2b SDK and the `e2b/` template definition: **is a capability restriction
   expressible on create at all?** If it is not, this clause is not implementable as written and the
   row must be AMENDED rather than marked delivered. The experiment is written out in
   `docs/replatform/DE-AUDIT-live-experiments.md` (DE-09, experiments 1 and 3).
   *What DE-09 does have* is a structural property — no host-execution path for a tenant command
   exists to refuse — plus real denies on adjacent controls (`effect-authority.ts:88`,
   `cleanup-authority.ts:159,164`, `compose-dispatch.ts:103`, `adapter-manager.ts:120-180`,
   and `GIT_HARDENING_FLAGS` at `snapshot/git-runner.ts:43`). That is why the row is `partial`.
   It is **not** why the `integrity` clause is satisfied; a structural absence is not a capability
   restriction, and it degrades the moment a host-exec path is added.
2. **DE-13 (High), `integrity`: "fair-share scheduling prevents monopolizing capacity."** The
   scheduler's candidate claim orders by
   `asc(jobs.availableAt), desc(jobs.priority), asc(jobs.createdAt), asc(jobs.id)`
   (`packages/db/src/repositories/tenant/job-control.ts:1981`). **There is no tenant term in that
   ordering, and no per-tenant round-robin, weighting or borrow limit anywhere.** What ships is
   per-Organization *admission* (a cap, `server/src/services/org-concurrency.ts:248`) and a poll
   *throttle* (`server/src/services/worker-admission-rate-limit.ts:139`) — both real, both
   measured denying, neither a scheduler. A second organization's first job therefore waits behind
   every in-flight attempt of a backlogged first organization, bounded only by that organization's
   own cap and by attempt duration. That window is precisely DE-13's `failureMode`.
3. **DE-06 (Critical), `authentication`: "scoped service identity; presigned grants signed by the
   broker."** There is one static credential set, constructed twice for two endpoints
   (`server/src/storage/s3-provider.ts:86-102`), and it signs every grant for every tenant. A grep
   for `AssumeRole|STSClient|@aws-sdk/client-sts` across `server/` and `packages/` returns **zero**
   hits, so no per-tenant or per-lease credential scoping exists or is attempted. The *grants* are
   genuinely prefix-bound and short-lived (`artifact-transfer-grant.ts:113,201-202`;
   `artifact-grant-ttl.ts`), which is the half that holds; the *identity* signing them is
   bucket-wide. Whether the deployed credential is in fact bucket-wide is a one-command live check,
   recorded in the handover document.

**Why HIGH.** (1) is the `integrity` clause of a Critical crossing whose `failureMode` is
*"sandboxed code executes a command on the worker host"*, and it may be unbuildable as written —
which is a fact a founder needs, not a gap an engineer can close. (2) means DE-13's stated failure
mode has no control. (3) means a single credential compromise is bucket-wide rather than
tenant-scoped, i.e. the blast radius the clause exists to bound is unbounded.

- **Affected crossings:** DE-06, DE-09, DE-13. (DE-11's encryption and TTL clauses are the same
  class and are carried by `E8-F011`.)
- **Disposition:** `unowned`. DE-09's owner tickets WRK-004 and REL-004 both exist on disk and both
  shipped; neither claimed this clause — `WRK-004-result.md`'s security invariant is *"No local
  tenant spawn: … asserts zero calls"*, which is an accurate description of a test and an
  inaccurate description of an enforced control. DE-13's second owner, REL-002, has zero files and
  is deferred. DE-06's owner DAT-002 shipped and delivered the prefix/fence half. NOT `accepted`:
  HIGH may never be accepted.
- **Resolution condition:** for each item, either the mechanism is built and the crossing
  re-measured, or — for (1) especially — the clause is AMENDED to state what the provider can
  actually enforce. Amendment is a founder decision and is not taken here. Resolve = flip this
  Status and delete the `E0-F012` key in `scripts/finding-ownership.json` in the SAME commit.

## E0-F013 — The audit class, second cohort: nine more crossings assert that denials are audited, and on eight of the nine the denial is still not recorded durably — DE-19 was closed on 2026-09-08 and the remaining eight are enumerated below

- **Status:** open — **8 of 9 remaining; DE-19 CLOSED 2026-09-08.**
- **Severity:** HIGH
- **Filed:** 2026-09-08, by W20B (the recovered-audit landing unit). Every citation below was
  measured at tip `4d5507a80` by the landing unit itself, not inherited from the auditor.
- **Blocks gate:** No — a detection gap, not an enforcement gap. Every crossing named here does deny.

**Why a sibling and not an edit to `E0-F010`.** `E0-F010` measured eight crossings and its count is
correct for the cohort it audited. These are **nine** *different* crossings, from the sixteen an
orchestration bug dropped out of W20's landing commit. Folding them in would have required
rewriting that finding's title, table and count in a wave whose whole subject is counts that stop
matching their data. The class is identical; the cohort is not.
*(★ CORRECTION, 2026-09-08. This paragraph said "eight *different* crossings" while the title, the
table, and the affected-crossings list all said nine. Nine is right — DE-15, DE-16, DE-17, DE-18,
DE-19, DE-20, DE-21, DE-27, DE-29 — and the count was re-verified against the table before this
edit. A finding whose subject is counts that stop matching their data had three counts and one of
them was wrong.)*

**★ TWO CORRECTIONS TO THIS FINDING'S OWN CHARACTERISATION (2026-09-08), made by the unit that
closed DE-19.** Both were found by re-measuring the citations rather than re-reading the prose.

1. **The title's clause "on the other four the success path is recorded and the refusal is not" is
   FALSE for DE-16.** It holds for DE-18, DE-19 and DE-20. On DE-16 what is recorded is the
   **refusal itself** — `recordCloudPluginBlock` (`server/src/services/cloud-plugin-execution.ts:225-247`)
   emits a `logger.warn` on the deny path carrying `pluginId`, `companyId`, `activationSource`,
   `sink` and `reasonCode` — and the *success* path is not recorded at all. This finding's own
   DE-16 table row says so correctly ("unlike the rest of this table there IS a log line"); it is
   the title that generalises past its data. The **5/4 split is correct** and was re-verified; only
   the description of the four is wrong. The title above has been rewritten to enumerate rather
   than characterise.
2. **DE-29's row header "Nothing, by ordering" applies a different standard than `E0-F010` applied
   to DE-06, on the same evidence.** The row's own body then names the trace: an anonymous
   `metrics?.secretRead({outcome:"denied", count:1})` tick at
   `server/src/services/secret-broker.ts:328`, count-only and compile-closed against ids
   (`job-control-metrics.ts:29`). That is the *same category* as DE-06's rejected-commit metric,
   which `E0-F010` explicitly refused to call "nothing" — "this is the one row in the table where
   'nothing' would be wrong". Read DE-29's "Nothing" as **"nothing attributable"**: the tick is
   real, it carries no handle, owner, company or reason, and it therefore satisfies no clause in
   this class. The substance of the finding is unchanged; the standard is now the same in both
   siblings.

**★ DE-19 IS CLOSED (2026-09-08).** Its audit clause — "context retrieval and denials are recorded
in the retrieval audit" — is delivered against a named record point with a production caller:
`recordSecurityDenial` (`server/src/services/security-denial-audit.ts:125`), called from
`handleMemoryGet`'s `denyMemoryGet` closure (`server/src/mcp/tools/read-tools.ts:297`) on all three
deny branches (`:339` `not_visible`, `:342` `not_approved`, `:351` `actor_filter_denied`). The row
lands in `activity_log` under a reserved `security.denied.*` action namespace and carries WHO
(`actor_type`/`actor_id`), TENANT (`company_id`), RESOURCE (`entity_type`/`entity_id`) and WHY
(`details.reason`). Proven by provoking the real refusal, not by reading a record back:
`server/src/__tests__/de-19-memory-denial-audit.integration.test.ts:298` (attribution), `:322`
(the reason is read from the branch, not stamped), `:337` (positive control — the same path
succeeding writes NO denial row and still writes its `memory_retrievals` success row). Observed
RED against the pre-change tree, and four mutants killed. Enrolled as `E0-de19-denial-audit` in
`scripts/gate-clause-wiring.json` in the same commit. **DE-19 stays `partial` in the threat
register**: its `authentication`, `revocation` and `integrity` clauses are separately absent and
are carried by `E0-F016`. **Not closed within DE-19:** `memory.search`'s refusals, which are the
DE-01 empty-read shape (the in-SQL gate removes rows from a query that then SUCCEEDS, so there is
no discrete refusal event to intercept).

| Crossing | `audit` clause, verbatim | The line that denies | What records it |
|---|---|---|---|
| DE-15 (Critical) | "image admission, scan, and kill events are audited" | `server/src/services/job-leasing.ts:731-740` — the kill-switch drain return. | **Nothing.** The block constructs and returns the poll response and exits the transaction: no repository call, no `activity_log` row, no metric. The `metrics` object in scope records certificate scans, not kill verdicts. |
| DE-16 (Critical) | "blocked plugin routes, dispatch, and reconciliations are audited" | `server/src/services/cloud-plugin-execution.ts:254`; the 503 helper at `server/src/routes/plugins.ts:381`. | **Partly — and unlike the rest of this table there IS a log line.** `recordCloudPluginBlock` (`cloud-plugin-execution.ts:225-247`) emits `logger.warn` with `event:"plugin.worker.cloud_blocked"`, `pluginId`, `companyId`, `activationSource`, `sink` and `reasonCode`. What is absent is durability: the counters it increments are module-level process memory that resets on restart, and no row is written anywhere. Nobody can answer "how often was this company's plugin dispatch refused last week" from the system's own memory. |
| DE-17 (Critical) | "post-fence cleanup and denied escalations are audited" | `packages/adapter-manager/src/owned-op-gate.ts:154-156`; `packages/worker-daemon/src/supervisor/cleanup-authority.ts:127-144,162-165`. | **Nothing.** `owned-op-gate.ts` and `create-gate.ts` contain zero matches for `logger|console.|audit|metric`; the only such matches in `adapter-manager/src/server.ts` are the reaper sweep counter. A whole-tree sweep shows **nothing anywhere catches or logs `CleanupAuthorityDeniedError`** — every reference is a throw site, a class declaration, a barrel re-export or a conformance assertion. |
| DE-18 (Critical) | "placement decisions and generation changes are audited" | `packages/db/src/repositories/tenant/job-control.ts:1177` / `:1167`. | **Partly.** A generation bump does write one durable `execution_target_revocations` row. Every *denial* the fence then produces returns as a protocol error with no row, no metric and no log line. |
| ~~DE-19 (Critical)~~ **CLOSED 2026-09-08** | "context retrieval and denials are recorded in the retrieval audit" | `read-tools.ts:339` / `:342` / `:351`, all via the `denyMemoryGet` closure at `:297`. | **Was: Half** — retrieval *was* recorded (`recordMemoryRetrievals` runs after the gate) and **both deny returns sat before it**, so a refused memory read wrote nothing. **Now:** each deny awaits `recordSecurityDenial` (`security-denial-audit.ts:125`), writing one attributable `security.denied.memory_read` row to `activity_log` (WHO/TENANT/RESOURCE/WHY) before returning the same non-disclosing message. Proven by provocation at `de-19-memory-denial-audit.integration.test.ts:298`/`:322`/`:337`. `memory.search`'s refusals remain uncovered — they are the DE-01 empty-read shape. |
| DE-20 (Critical) | "cutover selection and rollback transitions are audited" | `server/src/services/heartbeat.ts:5399` → `:5451`. | **Half, and the other half cannot exist.** A distributed selection writes one `distributed_execution_handoff` run event; a legacy selection writes no durable row. There is no rollback transition to audit because there is no rollback (see `E0-F014`). |
| DE-21 (High) | "subscribe, replay, and denial events are audited" | `server/src/realtime/live-events-ws.ts:1077-1079`. | **Nothing, with a positive control sitting beside it in the same file.** The 403 calls `rejectUpgrade`, whose entire body (`:106-112`) writes an HTTP status line to the socket and destroys it. The file *does* import `logger` (`:15`) and call it at eight sites — including `logger.error` at `:1090`, which fires only when the authorization function **threw**. So an internal fault is loud and a cross-tenant probe is silent. |
| DE-27 (High) | "cross-replica admission and partition events are audited" | `server/src/services/worker-admission-rate-limit.ts:138-140`; `server/src/services/org-concurrency.ts:247-249`. | **Nothing, and the clause is unsatisfiable as written.** The `over_cap` deny returns through `sendWorkerOperationProtocolError`, whose whole body is a status-and-json write (`worker-protocol-http.ts:83-93`); `org-concurrency.ts` emits nothing at all. ★ A whole-tree sweep of `server/src` for `replicaId\|replica_id\|AOA_CONTROL_PLANE_REPLICA\|controlPlaneId` returns **zero hits** — the system has no replica identity, so no admission record could name a replica even if one were written, and there is no partition detector to produce a partition event. |
| DE-29 (Critical) | "grant routing and wrong-owner denials are audited" | `packages/db/src/repositories/tenant/job-control.ts:3122`. | **Nothing, by ordering.** The audit UPDATE is `job-control.ts:3139` — *after* the throw at `:3122` — so on a denial it never runs and the transaction rolls back. The only trace is an anonymous `secretRead{outcome,count}` metric tick carrying no handle, owner, company or reason, which makes a **wrong-owner denial forensically indistinguishable from a stale fence**. |

*(Nine rows; DE-24's audit clause is absent too, but for a different reason — there is no host-side
event to record because there is no host-side updater. It is carried by `E0-F014`.)*

**Why HIGH.** Two of these are worse than the `E0-F010` cohort rather than merely more of it.
DE-27's clause names a fact about the system — "cross-replica" — **that the system has no vocabulary
to express**: it is not unwritten, it is unwritable, and it cannot be closed by adding a logger call.
DE-21 ships the counter-example to its own gap in one file: the code knows how to log, and the one
path it does not log is the security refusal.

**What it is NOT.** It is not a claim that any of these controls fail to deny. Every crossing here
is recorded `partial` precisely because its enforcement half was measured holding.

### What the remaining sixteen need (2026-09-08, from the unit that closed DE-19)

Sixteen crossings in this class are still open: **eight here** (DE-15, DE-16, DE-17, DE-18, DE-20,
DE-21, DE-27, DE-29) and **all eight in `E0-F010`** (DE-01, DE-03, DE-04, DE-06, DE-11, DE-12,
DE-13, DE-14). They are not one job. Grouped by what they actually need:

**Group A — the same shape as DE-19: an async deny path, a real tenant, a live DB handle, no
surrounding transaction. `recordSecurityDenial` already fits; only the interception is new.**

- **DE-16** — `recordCloudPluginBlock` (`cloud-plugin-execution.ts:225-247`) is already the
  chokepoint for **ten** production call sites and already emits the right fields. ★ **But it is
  NOT the drop-in the audit-phase measurement claimed.** Three obstacles, all measured at tip
  `921b2c1f9`: (i) it is **synchronous** (`: number`) and one caller,
  `plugin-worker-manager.ts:623` `spawnProcess()`, is a sync function returning `ChildProcess` —
  a durable write cannot be awaited there; (ii) `companyId` is **optional**, and
  `plugin-loader.ts:1285` and `:1777` pass **none at all**, so `activity_log`'s NOT NULL
  `company_id` cannot be satisfied on those two sinks; (iii) `company-plugins.ts:333` blocks
  **before** `assertCompanyAccess`, so its `companyId` is an unvalidated route param and may not
  be a valid FK. Closing DE-16 means async-ifying the chokepoint (or splitting the sync backstop
  off), plus Decision 2 below for the company-less sinks. Cheap, but not one line.
- **DE-21** — `live-events-ws.ts:1078` `rejectUpgrade`. Async, and it ships its own positive
  control (`logger.error` at `:1090` fires only when the authorize function *threw*). Blocked on
  Decision 2: its `companyId` comes from an **unauthenticated URL path segment**.
- **DE-15** — the kill-switch drain return at `job-leasing.ts:731-740`. In a transaction, but a
  *returning* one rather than a rejecting one, so the rollback problem does not bite.

**Group B — blocked on a lifecycle `recordSecurityDenial` does not have: the deny is a `throw`
INSIDE the tenant transaction, so an in-transaction write rolls back with it.** DE-29 is the
proof: the audit UPDATE at `job-control.ts:3139` sits after the throw at `:3122` and never runs.
These need a **separate-transaction** recorder that commits after the refusing transaction has
rolled back — a different lifecycle, not a wiring change.

- **DE-04 + DE-18** — both refuse through `guardActiveFence`
  (`job-control.ts:1167-1187`), which **11+ governed mutators** call. Highest leverage in the
  whole class: one function, two crossings. **This is the right second slice**, once the
  separate-transaction lifecycle exists.
- **DE-29** (`job-control.ts:3122`), **DE-12**'s denial half (`job-submission.ts:229`), and
  **DE-13**'s capacity half (`org-concurrency.ts:244/:248/:268`) join it on the same lifecycle.
- **DE-01's WRITE half** belongs here too and is genuinely closable: an RLS `WITH CHECK` violation
  raises catchable SQLSTATE **`42501`**, and `server/src/db/with-tenant-tx.ts` is the single place
  to catch it.

**Group C — shared interception point, but the point has no tenant context to give.**

- **DE-03**, **DE-13**'s throttle half and **DE-27**'s throttle half all refuse through
  `sendWorkerOperationProtocolError` (`worker-protocol-http.ts:76-93`), which has **20+ call sites
  in `worker-control.ts` alone**. Its signature is `(req, res, operation, code, now)`: **no db
  handle, no org, no company**. Widening it is the work, and DE-03's unenrolled-worker case hits
  Decision 2 head-on.

**Group D — structurally different; no amount of interception closes them at this architecture.
Naming them, because a plan that quietly covers twelve and implies seventeen is this programme's
own failure class.**

- **DE-01's READ half — the hard one.** PostgreSQL emits **no event** when an RLS `USING` clause
  filters rows: the planner ANDs the policy into the predicate, the query **succeeds**, and zero
  rows is a legal, indistinguishable result. Detecting it requires re-running the query without
  the policy and diffing — i.e. a `BYPASSRLS`/owner connection, exactly the privilege
  `packages/db/src/client.ts:325` throws at boot to forbid and `server/src/app.ts:490` calls
  "owner fallback is forbidden". `pgaudit` does not rescue it (it logs statements, not policy
  verdicts) and appears nowhere in this tree. **Recommend AMENDING the clause, not building it.**
  The same shape covers `memory.search` under DE-19 and is why DE-19's closure is scoped to
  `memory.get`.
- **DE-27's cross-replica and partition halves** — `replicaId|replica_id|AOA_CONTROL_PLANE_REPLICA|controlPlaneId`
  returns **zero hits** across `server/src`. The clause names a fact the system has no vocabulary
  to express. Needs a replica identity built first, or amendment.
- **DE-12's "generation changes" half** — `services.generation` has **no writer anywhere**, so
  there is no change to audit. Vacuous until one exists.
- **DE-20's rollback half** — `createDistributedExecutionDrain` has **zero production callers**
  (`E0-F014`), so there is no rollback transition. Selection is recordable; rollback is prose.
- **DE-11** — the sensitive-artifact access and retention controls are themselves absent
  (`E8-F011`). Nothing decides, so there is nothing to record; `artifact-commit.ts:170-176`
  self-labels as "a LOG LINE, not an audit record".
- **DE-17** — technically possible, practically blocked. `packages/adapter-manager` and
  `packages/worker-daemon` run **off the control plane** and hold no control-plane DB handle, so a
  durable row from a `CleanupAuthorityDeniedError` needs a **wire hop** — and
  `packages/worker-protocol` is v1-FROZEN behind a hash-pinned cross-version conformance test. Its
  own ticket, with its own freeze decision.
- **DE-14** — recordable only as a **log**, and that is all its clause asks ("the startup
  safety-assertion outcome is **logged**"). `assertHostedExecutionStartupSafe` fires at
  `config.ts:198` during config load, **before any DB pool exists**, so a durable row is
  structurally impossible. ~5 lines. Take it as a freebie; it proves nothing about the mechanism.

**Honest arithmetic: of the seventeen, ONE is closed and at most ELEVEN more are closable end to
end. Five clause-halves are not, and DE-17 is a sixth behind the protocol freeze.** Any plan must
state twelve, not seventeen.

### Decisions this slice did not take

1. **(Blocking the plan, not the next slice.) What happens to the clause-halves that cannot be
   delivered as written** — DE-01's read half, DE-27's cross-replica and partition halves,
   DE-12's change half, DE-20's rollback half, and DE-11. Per clause: amend the wording in
   `docs/architecture/distributed-execution-threat-controls.json` to what the programme actually
   intends, or charter the missing machinery. **A mechanism that closes twelve while the register
   still asserts seventeen reads as a solved class and is a false claim of enforcement.**
2. **Where a company-less denial goes.** `activity_log.company_id` is NOT NULL with a cascade FK.
   DE-03 (unenrolled worker), DE-21 (attacker-supplied path segment), DE-01 (wrong or absent org
   GUC) and two of DE-16's sinks can all produce denials with **no resolvable company**. Either
   (a) accept that those record nothing and **say so in the register**, or (b) mint a denial table
   with a nullable company and an `organization_id` — a **schema** decision (Drizzle only,
   `pnpm db:generate`), whose RLS/GRANT posture must be considered rather than guessed (AGENTS.md
   + Decision #122; note the closest analogue, `activity_log`, is deliberately **non-RLS** per
   `0245:15-18`, which is a live-fire question for a table holding cross-tenant evidence).
3. **Retention and disclosure of a denial record.** (a) Whose log does a cross-tenant denial land
   in? The probed company's `activity_log` discloses to them that they were probed and by whom.
   (b) `activity_log` **cascade-deletes with its company**, so a hostile tenant can destroy the
   evidence of their own probing by deleting their own company. An audit record a suspect can
   delete is not an audit record.

### The reserved namespace is a convention over thirty-four writers, not a chokepoint — and why no guard was shipped for it

Recorded on 2026-09-08, after an adversarial check of the DE-19 slice measured the claim the slice's
own prose made. The commit message and `server/src/services/activity-namespace.ts` described
`activity_log` writes as funnelling through one predicate. **They do not.** Re-derived
independently at `12660dbd6`: there are **thirty-four** direct `db.insert(activityLog)` /
`tx.insert(activityLog)` sites in `server/src`, and `assertUnreservedActivityNamespace` runs at
exactly **two** — `insertActivityLog` (`services/activity-log.ts:35`) and `activityService.create`
(`services/activity.ts:188`) — plus the HTTP route's Zod refinement (`routes/activity.ts:33`) ahead
of the second.

**The property still holds, for a narrower reason than the prose gave.** Those two are the only
writers that accept a caller-supplied `action`. All thirty-two others hard-code it: string
literals, a ternary of literals (`work-question-continuation-terminal.ts:175`), a literal-union
parameter (`user-notes.ts:27`), module-local consts (`marketplace-reconcile.ts:380`,
`seed-commander-review.ts:267`), and one statically-prefixed template (`hub-items.ts:1186`,
`` hub_item.${…} ``, unreachable from this namespace whatever the suffix). The single site typed
`action: string` (`operator-break-glass.ts:277`) is a private dep hook with three internal literal
call sites. Probed live: `logActivity` rejects, `activityService.create` throws, and
`POST /companies/:cid/activity` returns 400 — zero forged rows.

**Decision: no static guard.** A guard that fires when a new direct `insert(activityLog)` appears
without the predicate was considered and declined, on three grounds:

1. **It cannot be precise.** The honest predicate is "this site's `action` expression is
   statically constrained away from `security.denied.`", which needs flow analysis: four of the
   thirty-four pass an identifier or a parameter, and only reading their declarations separates
   them from a genuine free-form writer. A grep-shaped guard must allowlist
   `operator-break-glass.ts:277` **on the day it ships**. A guard that arrives with an exemption
   for a legitimate site teaches its next reader to add the next exemption — the measured failure
   in this programme's scanner history, where a benign `postgres://localhost:5432/dev` hard-failed
   the leak check.
2. **It reds on unrelated edits.** `activity_log` writers are ordinary product code and there are
   thirty-four of them; an inventory-shaped guard goes red on every new one. This repository has
   refused guards of that shape before, and a guard that gets switched off is worse than none
   because it leaves a false claim of enforcement behind.
3. **It buys little.** The hazard is a THIRD writer that takes free-form `action` text. Both of
   today's two are guarded, and a new free-form writer is far likelier to be a new *caller* of
   `insertActivityLog` — already covered — than a fresh direct insert typed `action: string`.

**What was done instead**, because an unenforced rule must at least be stated where it is read:
`activity-namespace.ts`'s docblock now carries the measured counts and the rule in place of the
false chokepoint claim — *a direct `insert(activityLog)` must hard-code its `action`; if the action
comes from the caller, route through `insertActivityLog`* — and says in terms that it is not
mechanically enforced. If a third free-form writer ever appears, this decision should be revisited
with the flow-analysis guard, not the grep one.

- **Affected crossings:** DE-15, DE-16, DE-17, DE-18, DE-20, DE-21, DE-27, DE-29 — **eight
  remaining.** DE-19 is closed (above) and is no longer carried by this finding.
- **Disposition:** `unowned`, for the reason `E0-F010` gives — no ticket on disk owns "record a
  denial" for the remaining eight, and DE-27's case additionally needs a replica identity that does
  not exist. NOT `accepted`: HIGH may never be accepted.
- **Resolution condition:** each remaining row's `audit` clause is either delivered against a named
  record point with a production caller, or AMENDED to state what the programme intends (DE-27's is
  the one most likely to need amending). Resolve = flip this Status and delete the `E0-F013` key in
  `scripts/finding-ownership.json` in the SAME commit.

## E0-F014 — The dead-arming-path class, second cohort: five more crossings are defended by a lever with zero production callers, including the rollback the cutover row calls "atomic" and the immutability check for the evidence ledger whose rule this repository has already broken three times

- **Status:** open
- **Severity:** HIGH
- **Filed:** 2026-09-08, by W20B (the recovered-audit landing unit). Caller counts below were taken
  by the landing unit as whole-tree sweeps excluding `node_modules` and `dist`.
- **Blocks gate:** No — but it is the reason five register rows are `partial` rather than
  `delivered`, and each of the five looks delivered from the register.

**The class, as `E0-F011` states it.** The receiving half of the control is built, tested and
correct, and the half that would ever arm it does not run in any deployment.

1. **DE-18 (Critical) — the revocation fanout has no caller.** The fence denies correctly
   (`job-control.ts:1177`), but `createExecutionTargetRevocationFanout`
   (`server/src/services/execution-target-revocation-fanout.ts:43`) has **zero production callers**:
   the whole tree holds its own declaration, `server/src/__tests__/worker-revocation.integration.test.ts:18,53`,
   and a comment naming it in `scripts/lib/gate-clause-wiring.mjs:10`. Consequence: after a
   revocation the lease stays `offered`/`active` and the `execution_target_revocations` row stays
   `pending` forever, so the job attached to it is **stranded non-terminal with its organization
   concurrency slot still held**.
2. **DE-20 (Critical) — the rollback lever cannot be pulled, and the row's own word is "atomically".**
   `createDistributedExecutionDrain` (`server/src/services/job-distributed-drain.ts:114`) has **zero
   production callers** — declaration, two test files, and the same `gate-clause-wiring.mjs:10`
   comment. Removing an organization from the rollout dial therefore does not cancel an in-flight
   distributed run; it only changes what the *next* wake resolves. The `revocation` clause describes
   a transition no code performs.
3. **DE-22 (High) — the evidence ledger's immutability check has never run, and the rule it would
   enforce is already broken in this repository's history.** `checkEvidenceImmutability`
   (`scripts/check-distributed-execution-foundation.mjs:2633`, denies at `:2639` and `:2641`) has
   **zero production callers**: its declaration, a comment at `:2199`, and five call sites inside
   its own test file. ★ The landing unit measured the consequence rather than asserting it:
   `docs/replatform/artifact-policy.md:54,67` makes a QA record "write-once from its first commit",
   and `git log --follow` over
   `docs/replatform/epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md` returns
   **two** commits — `6fc46988a` created it and `4379a2c53` rewrote it in place (+24/−4), inserting
   a paragraph that begins *"This record originally said […]. That is wrong."* while the record's
   own `Supersedes` field at tip still reads `— (E5 has no prior QA record; this is the first)`.
   The correction bypassed the Supersedes mechanism entirely, on a branch that merged CI-green,
   months after the deny function landed. Two further pairs were found by the auditor.
4. **DE-24 (Critical) — the update admission that would run on a host is not connected to one.**
   `evaluateUpdateAdmission` (`scripts/lib/update-admission.mjs:79-119`) is fail-closed and
   well-tested, and its only non-test reference is the *promotion-time* verifier map at
   `scripts/lib/release-manifest.mjs:66`. The host-side function that would refuse a tampered update
   before apply, `planUpdateSwap` (`packages/worker-keystore/src/install-layout.ts:236-251`),
   **verifies nothing** — `admitted`, `compatible` and `healthConfirmed` are injected booleans on its
   input type (`:210-216`) — and has **zero non-test callers**, as does `runDrainBeforeSwap`
   (`packages/worker-daemon/src/update/drain-before-swap.ts:102`). There is no code path by which an
   enrolled desktop host refuses a tampered update, and no host-side event to audit.
5. **DE-28 (Critical) — quarantine has no producer, so a live deployment shows zero quarantine
   traffic.** This is `E0-F011` item 1 reached from the other side: the *receiver* denies correctly
   (`job-control.ts:3741-3743`, `:3701-3708`; `quarantine-grant.ts:91`), and no shipped path can
   write a quarantined artifact row, because `runOrphanQuarantine` sits three layers behind the
   zero-production-caller `createStartupReconciler`. ★ **An operator must not read that silence as
   the control working.**

**Why HIGH.** (1) strands jobs and holds concurrency slots. (2) means the cutover row's stated
rollback guarantee is prose. (3) means the programme's own evidence discipline is unenforced and has
already failed silently, which is the exact `checks-that-nothing-runs` shape this repository keeps
paying for. (4) means the desktop supply-chain control stops at the release directory.

**What it is NOT.** None of the five is a wrong implementation, and (3) is not an accusation of bad
faith — the in-place correction it names was made in good faith and improved the record. The defect
is that nothing could tell the difference.

- **Affected crossings:** DE-18, DE-20, DE-22, DE-24, DE-28.
- **Disposition:** `unowned`, and unevenly. (3) is the cheapest — wire `checkEvidenceImmutability` to
  a CI step that materialises the merge-base tree and calls it with `(base, HEAD)`, then re-run it
  over the three commits above as a positive control. (1), (2) and (5) need composition-root wiring
  no ticket on disk carries. (4) needs a host binary that does not exist. NOT `accepted`: HIGH may
  never be accepted.
- **Resolution condition:** each lever gets a production caller and a test that goes red when the
  caller is removed, or the clause it arms is AMENDED. Resolve = flip this Status and delete the
  `E0-F014` key in `scripts/finding-ownership.json` in the SAME commit.

## E0-F015 — Three crossings are `not-delivered` on measurement: one has no tenant parameter anywhere in its code path, one has every deny line behind a zero-caller factory, and one has a conformance suite that has never been run against the thing it certifies

- **Status:** open
- **Severity:** HIGH
- **Filed:** 2026-09-08, by W20B (the recovered-audit landing unit).
- **Blocks gate:** No, but read the severities: two of the three crossings are Critical.

**Why these are `not-delivered` and not `partial`.** `partial` requires at least one clause enforced
by a named line that was exhibited denying **on a path that ships**. These three have none.

1. **DE-23 (Critical) — the backup/restore crossing has no tenant dimension at all.** This is not a
   missing check; it is a missing *parameter*. `runDatabaseRestore` (`packages/db/src/backup-lib.ts:1056`)
   takes `{connectionString, backupFile, connectTimeoutSeconds}` (`:37-41`) and is therefore
   **structurally incapable** of a tenant decision; it pipes the whole dump into psql or, on the
   fallback, executes every statement unconditionally (`:1073-1075`). The backup is instance-wide:
   the default `auto` engine short-circuits at `:613` into `runPgDumpBackup` (`:618`), which runs
   `pg_dump` with `--clean --if-exists --no-owner --no-privileges` over the full DSN (`:388-393`) —
   no `-n`, no `--table`, no organization filter — and `RunDatabaseBackupOptions` has no
   organization field. ★ So the row's `failureMode`, *"a restore exposes or reintroduces another
   tenant's data"*, is **the default behaviour of the only documented invocation**. The one line the
   owning design nominates as the guard, `manifest-reconciliation.ts:103-105`, returns the string
   `"wrong_prefix"` inside a result struct — a classification, not a denial — runs *after* the
   restore has written the object, and sits in functions with zero production callers.
2. **DE-25 (High) — every folder-grant deny is behind a factory nothing calls.** The refusals are
   real and well-tested (`folder-grant-binding.ts:81,83,86,89`; `folder-grant.ts:148,151`) and every
   one is reached only through `createFolderGrantService` (`folder-grant.ts:66`), whose whole-tree
   caller census is its own declaration plus two test files. The module says so about itself at
   `:7-8`: it *"is INERT until a capture/reconcile path reads it"*. Daemon-side is worse than inert:
   `buildWorkspaceManifest` (`snapshot/build-manifest.ts:308`) is also zero-production-caller **and**
   does not confine its walk to a granted base. The `integrity` clause has no line at all —
   `detectIsolationMechanism` (`enrollment/isolation-capabilities.ts:86`) is never called in
   production and the single production site hardcodes `isolation: "none"`
   (`bin/worker-daemon.ts:536`), for which `capabilitiesForIsolation` returns `[]` (`:50`).
   `folder_grants` declares `revoked_at` (`packages/db/src/schema/folder_grants.ts:39`) and **no
   expiry column**, and `offlinePolicy: "cancel"` is written into every assignment
   (`job-leasing.ts:391`) and read by nothing.
3. **DE-26 (Critical) — the real-provider conformance run has never happened, and the mock it was
   run against is already known to diverge in exactly the way the row names.**
   `runSandboxIsolationConformance` (`packages/sandbox-provider-contract/src/isolation-contract.ts:89`)
   has exactly **two call sites, both keyless doubles** — the hostile fake, and
   `sandbox-e2b-provider/src/__tests__/conformance.test.ts:46` over a `MockE2bTransport`, whose own
   header says it runs *"with NO key and NO network"*. The one lane that touches real E2B
   (`.github/workflows/keyed-e2b-conformance.yml:79`) runs a file that never imports the suite, is
   `workflow_dispatch`-only, and is not in `ci-required`. ★ And the divergence is not hypothetical:
   `ListInput.ownershipSelector` is a **required** port field
   (`packages/worker-daemon/src/supervisor/provider.ts:288`); the fake honours it; the real provider
   forwards only `{pageSize, pageToken}` to the transport
   (`packages/sandbox-e2b-provider/src/e2b-provider.ts:412-414`) and returns **every sandbox in the
   E2B account**. The codebase already says so twice in its own comments
   (`packages/adapter-manager/src/reconcile-reaper.ts:104-106`; `owned-op-gate.ts:201-206`).
   **This is the `E8-F003` shape verbatim** — a field accepted, typed, required, honoured by the
   double, and inert in the real implementation — and it is the strongest available argument that a
   conformance suite run only against doubles cannot close a real-provider crossing.

**Why HIGH.** (1) is a Critical crossing whose stated failure mode is the code's normal behaviour.
(3) is a Critical crossing whose entire verification story is a suite that has never met its subject,
against a provider already measured dropping a required isolation input.

- **Affected crossings:** DE-23, DE-25, DE-26.
- **Disposition:** `unowned`. (1)'s successor is scoped but unbuilt (`DBR-001-design.md`, status
  "scoping"); (2)'s owner tickets shipped the pure functions and no caller; (3)'s owner `DEP-008`
  **explicitly scopes the real-provider half out** in its own design and repeats it in its result's
  residual risk, and `REL-004` names no `DE-` id at all — so DE-26's exit is chartered by two written
  tickets neither of which owns the control. Existence is not chartering. NOT `accepted`: HIGH may
  never be accepted.
- **Resolution condition:** (1) a restore entrypoint that takes a tenant and refuses a cross-tenant
  apply; (2) a production caller plus an anti-orphan directory-walk test in the style of
  `scripts/check-guard-inventory.mjs`; (3) one keyed run of the certified suite against the real
  transport, recorded per-check — the experiment is cheap, needs only the existing repo secret, and
  is written out in `docs/replatform/DE-AUDIT-live-experiments.md`. Resolve = flip this Status and
  delete the `E0-F015` key in `scripts/finding-ownership.json` in the SAME commit.

## E0-F016 — Two crossings assert a revocation or authority property their code does not have: capabilities that narrow "immediately" except for the one principal whose role rides a ten-minute token, and a context authority declared to end with a lease that is never consulted

- **Status:** open
- **Severity:** HIGH
- **Filed:** 2026-09-08, by W20B (the recovered-audit landing unit).
- **Blocks gate:** No.

**The class.** Not a missing mechanism (`E0-F012`) and not a dead lever (`E0-F011`/`E0-F014`), but a
clause whose *wording* is stronger than the code — where the honest remedies are "build it" **or**
"amend the sentence", and amending is a founder decision.

1. **DE-30 (Critical), `revocation`: "membership or enrollment changes IMMEDIATELY narrow
   capabilities."** For user, mcp and worker principals this holds, and holds well:
   `admittedUserRequester` (`packages/db/src/repositories/tenant/job-control.ts:1441-1467`) re-reads
   the organization membership with `status = 'active'` (`:1453`) and the company membership
   (`:1462`) inside the submission transaction, and the gate tests the **server-derived** kind
   (`server/src/services/job-submission.ts:164`, refusing at `:166`), never the client's claim.
   **The commander principal does not go through it.** The branch at `job-control.ts:1570-1577`
   accepts `input.principalRole` — a claim carried on the run JWT — provided the
   Organization→Company edge exists, and that JWT's TTL defaults to **600 seconds**
   (`server/src/agent-auth-jwt.ts:180`). A commander whose role is narrowed keeps the old scope for
   up to ten minutes. The clause says "immediately".
   *Secondary, and cheap:* nothing on the submission lane tests the requester-side revocation at
   all — deleting the `status='active'` predicate at `:1453` turns nothing red today.
2. **DE-19 (Critical), `authentication` and `revocation`: "a worker session with tenant/job/lease/fence
   authorization" and "context authority ends with the lease and fence."** Neither exists on the lane
   that ships. The distributed worker lane is **not instantiated** — `packages/worker-protocol`
   carries no memory or context field, and `worker-daemon`/`worker-networked-host` hold zero
   references to `AOA_API_KEY`, `AOA_API_URL` or `/mcp` — so the sandbox→MCP-broker lane is the only
   measurable one, and there the bearer is an agent JWT with a TTL and **no line anywhere checks run
   status on a memory read**. The token therefore outlives the run it was issued for. The
   `integrity` clause ("workers cannot write memory") is likewise unenforced: the outbound MCP
   fallthrough is not gated by the per-agent tool allowlist. There is also **no database backstop** —
   migration `0211` ENABLEs and FORCEs RLS on eight distributed-kernel tables and `memory_items` is
   not among them, so "never direct memory-table access" rests entirely on application code.

**Why HIGH.** (1) is a Critical crossing whose whole subject is that server-derived scope beats
self-asserted claims, and the one principal that still carries a role in a token is the one with the
broadest reach. (2) means a captured sandbox credential remains a valid reader of company memory for
its full token lifetime after the run that justified it has ended.

- **Affected crossings:** DE-19, DE-30.
- **Disposition:** `unowned`. (1) has two honest resolutions and they are different decisions:
  re-derive the commander requester through `admittedUserRequester` (dropping the `principalRole`
  token claim from the trust decision), or amend the clause to read "immediately for user/mcp/worker
  principals; bounded by the commander run-JWT TTL for the commander principal". (2) is `DAT-007`'s
  deferred half — its result document is explicit that the remote-reach core is blocked — and
  `REL-001`, the ticket that would close it at release level, has zero files. NOT `accepted`: HIGH
  may never be accepted.
- **Resolution condition:** each clause is either delivered against a named line or AMENDED to state
  the bound the code actually provides. **Do not leave a field asserting "immediately" while the code
  does not.** Resolve = flip this Status and delete the `E0-F016` key in
  `scripts/finding-ownership.json` in the SAME commit.
