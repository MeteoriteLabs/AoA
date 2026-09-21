# MIG-010 Result — legacy-resource reconciliation becomes runnable, and closure becomes decidable

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E10-desktop-migration-realtime`
**Plan task:** `M0 unit 5 — the disposition-B result owed for MIG-010 (scope-triage.md, exit criterion 5)`
**Implementer:** `M0 unit 5 (Claude Opus 5) — RECORD author, not the implementer of the units below`
**Start SHA:** `8ce4c2ab6d248c5de4b67f4834645eb221611d59`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

This file is a controlled append-only review ledger until `complete`; do not delete or rewrite prior
review attempts. Once `complete`, it is frozen.

---

## 0. What kind of record this is, stated first so nothing is over-claimed

★★★ **This is a RECORD-CURRENCY result for work that shipped earlier, not a report of fresh
implementation.** Units 2.2–2.5 landed before this milestone; `MIG-010` carried **no `-result.md`
deliberately**, because adding one would have put it in `completedTicketIds` exactly when `E7-F007`
needed an owner. That deadlock is recorded in `scope-triage.md` and was the subject of founder
decision **D-10**.

★★ **The deadlock was cleared before this file was written, and the order was not optional.**
`MIG-011` was filed as `E7-F007`'s successor and the finding re-pointed to it **first**; only then
was this result written. `scope-triage.md` is explicit that filing the successor *"neither creates
nor approves"* this result — it only makes it possible to write one honestly.

★ **Nothing here re-opens the landed units.** Every claim below was re-verified at `8ce4c2ab6d248c5de4b67f4834645eb221611d59` by
reading the source, because this programme's dominant failure is a record that no longer matches the
code.

## 1. Delivered scope — re-verified at this candidate

| Claim | Verified at |
|---|---|
| The reconciliation pass has a **production caller** (it previously had zero) | `server/src/cli/reconcile-legacy-resources.ts`, wired as `reconcile:legacy-resources` in `package.json:39` |
| The pass itself | `server/src/services/legacy-resource-reconciliation.ts:486` (`reconcileCompanyLegacyResources`), self-called at `:588` |
| An **operator remedy** for unattributable records | `server/src/cli/resolve-unattributable-record.ts`, wired as `resolve:unattributable-record` in `package.json:40` |
| The gate inventory narrowed to a DB-clock watermark | `packages/db/src/migrations/0270_canary_preflight_lease_watermark.sql`; the gate reads it in `server/src/services/canary-preflight.ts` |
| Supporting schema | `packages/db/src/migrations/0268_legacy_reconciliation_lease_read.sql`, `0269_groovy_lila_cheney.sql`, `0271_real_frightful_four.sql` (the `resolved_at` / `resolved_by` / `resolution_reason` columns the remedy writes — ★ *Corrected 2026-09-21 in response to review attempt 1:* previously omitted) |

**Findings closed by these units:** `E10-F002`, `E7-F004`, `E7-F005`, `E7-F006`.

**Non-goals preserved:** the remedy takes **one record at a time with no bulk mode** (a bulk clear is
how a register of unresolved problems becomes a register of nothing); the transition guard lives in
the SQL `WHERE` clause (`AND disposition = 'unattributable'`) rather than in TypeScript, so minting
`mapped` is structurally impossible and a second run is a no-op rather than a silent overwrite; and
**no new authority was granted** — `aoa_operator` already held the needed grants since `0256` and
this is their first consumer.

## 2. What these units did NOT close, and it is still open

**`E7-F007`** — the fail-OPEN divergence between the pass's in-memory closure and the gate's
persisted closure. It is MEDIUM, open, and now owned by **`MIG-011`**
(`tickets/MIG-011-design.md`), which owns choosing among the three non-equivalent shapes the finding
records. This result does not narrow that choice and must not be read as closing it.

★ **The finding's own reachability claim was partly wrong when filed, and that is worth carrying
forward**: "deleting an agent creates an unattributable record" holds only when the deletion
*precedes* the company's first pass. Delete it afterwards and `onConflictDoNothing` means the
newly-unattributable record is never written. It was caught by asserting what was **observed**
rather than what was expected — which is the discipline `MIG-011`'s test must repeat.

## 3. Acceptance evidence

| Clause | Evidence | State |
|---|---|---|
| The pass is reachable from a production entrypoint | `reconcile-legacy-resources.ts` + `package.json:39` | **verified at `8ce4c2ab6d248c5de4b67f4834645eb221611d59`, statically** |
| The remedy is reachable and single-record | `resolve-unattributable-record.ts` + `package.json:40` | **verified at `8ce4c2ab6d248c5de4b67f4834645eb221611d59`, statically** |
| The watermark migration is present | `0270_canary_preflight_lease_watermark.sql` | **verified at `8ce4c2ab6d248c5de4b67f4834645eb221611d59`** |
| The integration behaviour (13 cases — ★ *Corrected 2026-09-21 in response to review attempt 1:* was “12”; the file has 13 `it(` blocks and CI reports 13) | `mig-010-unit-2-5-unattributable.integration.test.ts` | **NOT re-run here** — needs a live PostgreSQL and `AOA_RUN_WIN_INTEGRATION=1`; recorded as unrun rather than assumed green |
| Record/graph guards | citation-integrity, guard-inventory, distributed-execution-foundation, gate-clause-wiring, finding-ownership, test-inventory, ticket-graph-coverage, execution-census, dependency-graph, evidence-immutability | **all green, aggregated, at `8ce4c2ab6d248c5de4b67f4834645eb221611d59`** |

### 3.1 The deadlock was proven resolved, not asserted

The whole reason this result could not exist before is mechanical, so it was checked mechanically.
Running `evaluateFindingOwnership` over the real tree at this candidate, and then over a mutated
copy of `scripts/finding-ownership.json` in which `E7-F007` is pointed back at `MIG-010`:

| Configuration | `ok` | Problems reported for `E7-F007` |
|---|---|---|
| **actual** (`E7-F007` → `MIG-011`) | `true` | none |
| **positive control** (re-point reverted to `MIG-010`) | `false` | `owner_ticket_already_complete`, `successor_missing` |

`MIG-010` **is** now in `completedTicketIds` (this file put it there), `MIG-011` exists on disk and
is **not** completed. So the deadlock was real, the ordering mattered, and the guard demonstrably
fires when the re-point is removed — the check is not vacuous.

★★★ **The integration suite was NOT re-run for this record and this table says so.** Claiming it
passed would be the false-enforcement class this programme exists to stop. A reviewer who needs that
evidence should require a run before approving, and the honest state of this row is `unrun`, not
`pass`.

## 4. Independent review

**Reviewer:** M0 attempt-2 independent reviewer subagent (Claude) — distinct from the M0 implementation session, from the attempt-1 reviewer, and from the correcting session
**Reviewed revision:** 6f9031220bd2a20a6485b83a5b2b74cf6b5782d0
**Disposition:** `approved`
**Attempt:** 2 (see Review attempt history)
**Review evidence (attempt 2):**
- Attempt-1 DEFECT 1 ("12 cases") — FIXED at source: `grep -cE '^\s*it\(' server/src/__tests__/mig-010-unit-2-5-unattributable.integration.test.ts` → `13`, no `it.skip`/`it.only`/`it.each`/`test(` forms; PR run `35561909654` job `verify (2)` log → `✓ src/__tests__/mig-010-unit-2-5-unattributable.integration.test.ts (13 tests)`. The record's "13 … CI reports 13" holds, and the row correctly stays `NOT re-run here`.
- Attempt-1 DEFECT 2 (E7-F007 prose still named MIG-010) — FIXED at source: `E7-coding-e2b/findings.md` § `E7-F007` now reads `**Owner:** MIG-011 (…/MIG-011-design.md)` and `**MIG-011 owns choosing**`; the only remaining `MIG-010` mention in the entry is the historical `**Filed:** … by MIG-010 Unit 2.5 Task 1`, which is true. `scripts/finding-ownership.json` → `E7-F007` `{status: owned, ticket: MIG-011}` — prose and register now agree. `MIG-011-design.md` exists with `**Owns:** E7-F007` and status `scoping`. `node scripts/check-finding-ownership.mjs` at the reviewed revision → `OK`, exit 0. §0/§2's "owned by MIG-011" is now true in both places.
- Attempt-1 minor (0271 omitted) — FIXED: `packages/db/src/migrations/0271_real_frightful_four.sql` exists (from #338 `2253f3110`) and adds `resolved_at timestamptz`, `resolved_by text`, `resolution_reason text` to `legacy_resource_reconciliation` (`ADD COLUMN IF NOT EXISTS`); `resolve-unattributable-record.ts` `:192-194` writes exactly those three columns.
- Rest re-checked: `package.json` `reconcile:legacy-resources` / `resolve:unattributable-record` still at `:39`/`:40`; the eight static record/graph guards (`check-register-citation-integrity`, `-guard-inventory`, `-distributed-execution-foundation`, `-gate-clause-wiring`, `-test-inventory`, `-ticket-graph-coverage`, `-execution-census`, `-dependency-graph`) plus `check-finding-ownership` all exit 0 at the reviewed revision.
- Non-blocking note: §0's "the finding re-pointed to it **first**" is accurate for the machine register (which is what the completedTicketIds deadlock and the guard turn on, and which `findings.md` now declares authoritative); the prose `Owner:` line followed later, in the attempt-1 correction. Not a false statement about the gating mechanism, so not blocking.

**Review evidence (attempt 1):**
- Record describes an ancestor of the reviewed revision: `8ce4c2ab6` is an ancestor of `5f3b47556`; `git diff 8ce4c2ab6 HEAD` over every file §1/§3 cites (`package.json`, both CLIs, `legacy-resource-reconciliation{,-store}.ts`, `canary-preflight{,-evidence,-store}.ts`, `packages/db/src/migrations/`, `docs/replatform/epics/E7-coding-e2b/findings.md`) is **empty**; only `scripts/finding-ownership.json` changed (the E7-F007 re-point).
- §1/§3 static clauses — all **hold**: `package.json:39` = `reconcile:legacy-resources` → `server/src/cli/reconcile-legacy-resources.ts`; `:40` = `resolve:unattributable-record` → `server/src/cli/resolve-unattributable-record.ts`; `legacy-resource-reconciliation.ts:486` `export async function reconcileCompanyLegacyResources`, called at `:588` from the org-level loop; migrations `0268`, `0269`, `0270_canary_preflight_lease_watermark.sql` present; `canary-preflight.ts` gate requires the watermark (`reconciliation_stale` arms; the SQL read itself is in `canary-preflight-evidence.ts`, 3-arg function, 0270 DROPs the 2-arg form).
- Non-goals — **hold**: `resolve-unattributable-record.ts` `parseArgs` takes one `--company`/`--resource-key`, header comment "There is NO bulk mode"; the `UPDATE … WHERE company_id = … AND resource_key = … AND disposition = 'unattributable'` guard is in SQL; 0 rows → non-success. `0256_dizzy_bedlam.sql` `GRANT SELECT, INSERT, UPDATE ON "legacy_resource_reconciliation" TO "aoa_operator"` (table-level, so it covers the resolution columns 0271 later adds). `onConflictDoNothing` confirmed at `legacy-resource-reconciliation-store.ts` `insertRecordIfAbsent`.
- Findings closed: `E7-F004`, `E7-F005`, `E7-F006` are `**resolved**` in `E7-coding-e2b/findings.md`; `E10-F002` `**resolved**` in E10 `findings.md` — **true**.
- Successor exists: `tickets/MIG-011-design.md` (in E10, not E7; `Owns: E7-F007`, status `scoping`, no result doc); `scripts/finding-ownership.json` → `E7-F007` `status: owned, ticket: MIG-011`.
- §3.1 positive control **reproduced** in a `git archive HEAD` scratch copy: `node scripts/check-finding-ownership.mjs` → exit 0 as-is; with `E7-F007.ticket` reverted to `MIG-010` → exit 1 with `owned by a ticket that has already SHIPPED` and `…names no successor` for E7-F007. Not vacuous.
- Record/graph guards re-run at the reviewed revision: `check-register-citation-integrity`, `check-guard-inventory`, `check-distributed-execution-foundation`, `check-gate-clause-wiring`, `check-finding-ownership`, `check-test-inventory`, `check-ticket-graph-coverage`, `check-execution-census`, `check-dependency-graph` → all exit 0; `check-evidence-immutability --base 8725bd892~1` → exit 0 (without `--base` it refuses by design). CI run `35561909654` `policy` → `success`.
- §3 `unrun` integration row: honestly unrun locally, and **actually satisfied** at the reviewed revision by CI run `35561909654` (`headSha` = `5f3b47556d0d…`): `verify (2)` → `mig-010-unit-2-5-unattributable.integration.test.ts (13 tests)` ✓, plus `legacy-resource-reconciliation.test.ts (24)`, `cli-006-canary-preflight.test.ts (22)`, `canary-preflight-real-role.integration.test.ts (14)` ✓. `ci-required` fails only on the `do-not-merge` label.
- ★ **DEFECT 1 (blocks, because a `complete` record is frozen):** §3 says the integration suite has **"12 cases"**. It has **13** — 13 `it(` blocks in the file and `(13 tests)` in CI run `35561909654`. A frozen record with a wrong count of the evidence it defers to is the records-disagree class.
- ★ **DEFECT 2 (blocks):** §0 says `MIG-011` was filed and *"the finding re-pointed to it **first**"*, and §2 says E7-F007 is *"now owned by `MIG-011`"*. Only the machine register was re-pointed. The finding itself, `E7-coding-e2b/findings.md` § `E7-F007`, still reads `**Owner:** MIG-010 (… MIG-010-design.md, no result doc)` and ends *"MIG-010 owns choosing."* — both now false (MIG-010 has this result doc; MIG-011 owns choosing). `check-finding-ownership` reads only the JSON, so it cannot see this. Fix: re-point the E7-F007 `Owner:` line and "owns choosing" sentence to `MIG-011` (findings.md edit — outside this reviewer's remit), then this record's §0/§2 claims become true.
- Minor, not blocking: §1 "Supporting schema" omits `0271_real_frightful_four.sql` (the Unit 2.5 `resolved_at`/`resolved_by`/`resolution_reason` columns the remedy writes).

For `approved`, verify that this record describes the reviewed revision, that every clause in §3
marked *verified* still holds at that revision, and that the §3 `unrun` row is either accepted as
unrun or satisfied by a run; then change the top-level `Status` to `complete` and commit that
disposition separately. Otherwise leave `Status` at `gate_review` and link stable findings.

★ **`M0` exit criterion 5 requires this result *approved*, not merely committed.** It is left at
`gate_review` on purpose: the record's author may not approve it, and self-certification is what
`artifact-policy.md` forbids.

## Review attempt history

The implementation author leaves the table body empty; the pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M0 independent reviewer subagent (Claude) | `5f3b47556d0df152db0d53d76c304861f30ffd37` | `changes_requested` | All §1/§3 static clauses hold at source (package.json:39/:40, `reconcileCompanyLegacyResources` :486/:588, 0268/0269/0270, SQL `AND disposition = 'unattributable'`, 0256 grant); successor MIG-011 exists and owns E7-F007 in `finding-ownership.json`; §3.1 positive control reproduced (exit 0 → exit 1); 10 guards green at HEAD; unrun integration row satisfied by CI run `35561909654` (13/13). DEFECTS: (1) §3 says 12 cases, suite has 13; (2) `E7-coding-e2b/findings.md` § E7-F007 still names MIG-010 as owner ("no result doc", "MIG-010 owns choosing"), contradicting §0/§2's "re-pointed first". Minor: 0271 omitted from supporting schema. |
| 2 | M0 attempt-2 independent reviewer subagent (Claude) | `6f9031220bd2a20a6485b83a5b2b74cf6b5782d0` | `approved` | Both attempt-1 defects FIXED at source: suite has 13 `it(` blocks and CI `verify (2)` reports `(13 tests)`; `E7-coding-e2b/findings.md` § E7-F007 now names MIG-011 as Owner and as the one who "owns choosing", consistent with `finding-ownership.json` (`owned`, `MIG-011`); `check-finding-ownership` OK. Minor fixed: 0271 exists and adds `resolved_at`/`resolved_by`/`resolution_reason`, written by the remedy `:192-194`. 9 record guards exit 0 at reviewed revision. Nothing new false (note: §0 "first" is true of the register; the prose followed). |
<!-- Later reviewers append attempt 2+ below without rewriting attempt 1. -->
