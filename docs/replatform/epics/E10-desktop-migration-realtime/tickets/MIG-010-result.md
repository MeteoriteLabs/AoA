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
| Supporting schema | `packages/db/src/migrations/0268_legacy_reconciliation_lease_read.sql`, `0269_groovy_lila_cheney.sql` |

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
| The integration behaviour (12 cases) | `mig-010-unit-2-5-unattributable.integration.test.ts` | **NOT re-run here** — needs a live PostgreSQL and `AOA_RUN_WIN_INTEGRATION=1`; recorded as unrun rather than assumed green |
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

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Attempt:** none recorded

For `approved`, verify that this record describes the reviewed revision, that every clause in §3
marked *verified* still holds at that revision, and that the §3 `unrun` row is either accepted as
unrun or satisfied by a run; then change the top-level `Status` to `complete` and commit that
disposition separately. Otherwise leave `Status` at `gate_review` and link stable findings.

★ **`M0` exit criterion 5 requires this result *approved*, not merely committed.** It is left at
`gate_review` on purpose: the record's author may not approve it, and self-certification is what
`artifact-policy.md` forbids.
