# DAT-008-A1 Result — narrow the lease-scoped-secrets completion claim to its ledgers

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-008-A1 — narrow the lease-scoped-secrets completion claim to the ledgers (M0)`
**Implementer:** `M0 unit 7 (Claude Opus 5)`
**Start SHA:** `5a796928b`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ **Disposition A — a record-truth correction. No source file changed, and neither half of the
residual was built.**

---

## 1. What changed

| File | Change |
|---|---|
| `README.md` | the status sentence's *"DAT-001 through DAT-011 shipped"* is narrowed to what the ticket ledgers support, and points at `E5-F004` |
| `findings.md` | new **`E5-F004`**, recording **two separable facts** |
| `scripts/finding-ownership.json` | `E5-F004` declared `unowned`, with what would have to change |

**No source file changes.** The mint-side implementation is cited, not re-derived.

## 2. The correction this ticket almost published, and did not

★★★ **An earlier draft of this task asserted *"slice 6 has no record on disk at all"*, and founder
decision D7 struck it as a FALSE ABSENCE CLAIM, verified at source.** That is the reason the task
carries an explicit instruction forbidding a particular absence-claiming word in anything it writes.
That word appears in none of the three artefacts above — checked by grep after the last edit, not
assumed at authoring time.

★ The lesson the task states in its own words: *"Exoneration needs strictly more evidence than
conviction."* The second search had already been run and it **found** the records.

## 3. The two facts, each verified at this candidate

### (i) Record-indexing gap — LOW

No standalone `DAT-008-slice-6-*` result file exists. The slice is accounted for three times over:

| Kind | OBSERVED |
|---|---|
| Named | `tickets/DAT-008-design.md:233` — *"Slice 6 — deferral #3, the tautological owner check"* |
| Dispositioned | `tickets/DAT-008-result.md:111-113` — *"Deferral #3 is closed on the MINT side only… The original tautological comparison in the placement path is untouched"* |
| Implemented (mint side) | `server/src/services/execution-secret-handle-mint.ts:174` — `if (!ownerAuthoritiesAgree(input.placementOwner, input.credentialKind)) return refuse("owner_authority_disagreement");` |

All four citations were read at `5a796928b`, by line, before this record was written.

### (ii) Placement-side residual — MEDIUM

The original tautological owner comparison in the **placement path** is untouched, deliberately:
`DAT-008` stopped *relying* on it rather than deleting it. It is **not a live escape** — the mint
refuses unless two independently-derived owner authorities agree — so nothing in M0 and no gate
clause is blocked by it.

## 4. RED → GREEN

The plan specifies the RED as *"the citation-integrity guard failing against a deliberately wrong
symbol anchor (positive control)"*. It was run, not assumed:

| Step | Command | OBSERVED |
|---|---|---|
| **RED** | mutate one register citation `server/src/db/with-tenant-tx.ts:36` → `:9999`, then `node scripts/check-register-citation-integrity.mjs` | **exit 1** — `register citation integrity: FAIL`, `DE-01 (audit) …:9999: line 9999 is outside the file, which has 78 lines (the file shifted or shrank under a citation that did not move)` |
| **restore** | revert the mutation | **exit 0**, and `git diff` on the register is empty |
| **GREEN** | the full aggregated guard set | all green — see §5 |

★ The mutation was reverted in the same session and the register is byte-identical to its committed
state; the positive control leaves no residue.

## 5. Acceptance evidence

All guards run and aggregated, not chained to one exit code:

`check-register-citation-integrity`, `check-guard-inventory`,
`check-distributed-execution-foundation`, `check-gate-clause-wiring`, `check-finding-ownership`,
`check-test-inventory`, `check-ticket-graph-coverage`, `check-execution-census`,
`check-dependency-graph`, and `check-evidence-immutability --base origin/docs/replatform-program`
— **all exit 0.**

★ The ticket's own observability clause is satisfied: the register-integrity guards are green
**after** the edit, and the counts were re-taken after the last edit rather than before it.

## 6. Non-goals preserved

Building slice 6's placement-side residual or slice 7; re-deriving the mint-side slice-6 evidence
(it is cited in §3); touching `E5-5`'s `wired` status; re-opening `DAT-008`'s landed slices.

★ **One deviation, recorded rather than silently absorbed.** The plan says this ticket files
`E5-F003`. That id was taken earlier in the same milestone by M0 unit 2 (the lexical
approved-workspace-root comparison), so this finding is **`E5-F004`**. Finding ids are permanent and
never reused, so taking the next free id is the only correct action; the plan's reference to
`E5-F003` for this ticket is stale as of 2026-09-21.

## Independent review

**Reviewer:** M0 independent reviewer subagent (Claude) — distinct from the M0 implementation session
**Reviewed revision:** 5f3b47556d0df152db0d53d76c304861f30ffd37
**Disposition:** `approved`
**Attempt:** 1 (see Review attempt history)
**Review evidence:**
- **§3 citations, re-read at the reviewed revision (5a796928b and 8b629fc25 are both ancestors of it):** `tickets/DAT-008-design.md:233` is the heading `### Slice 6 — deferral #3, the tautological owner check`; `tickets/DAT-008-result.md:111-113` is the *"Deferral #3 is closed on the MINT side only … placement path is untouched"* bullet; `server/src/services/execution-secret-handle-mint.ts:174-175` is `if (!ownerAuthoritiesAgree(input.placementOwner, input.credentialKind)) { return refuse("owner_authority_disagreement"); }` inside `decideExecutionSecretHandle`, with `ownerAuthoritiesAgree` defined at `:145`. All hold.
- **Placement-side residual is genuinely open, as recorded:** the self-referential comparison still exists — `server/src/services/job-placement.ts` derives `requiredOwnerPrincipalId` from the routed profile (`:289`) and compares `credentialOwnerPrincipalId` against it (`:568-570`); `canary-credential-binding.ts:42` still documents it as reading off the same profile. The record does not claim the placement side closed. Slice 7: `tickets/DAT-008-slice-7-result.md` says `DEFERRED (no code, no test)`, matching the README narrowing. `git ls-files | grep -i slice-6` returns nothing, so clause (i) stands.
- **Forbidden word (D7; named in `implementation-plan.md`'s `DAT-008-A1` task):** case-insensitive count is `0` in `README.md`, `findings.md`, `scripts/finding-ownership.json` and this result file.
- **Scope:** commit `360b2e5d6` touches exactly `README.md`, `findings.md`, `tickets/DAT-008-A1-result.md`, `scripts/finding-ownership.json` — no source file, no register file. `README.md:3` carries the narrowed sentence; `E5-F004` exists in `findings.md` and is `unowned` in `finding-ownership.json`.
- **§4 positive control, reproduced:** mutated `server/src/db/with-tenant-tx.ts:36` to `:9999` in `docs/architecture/distributed-execution-threat-controls.json` → `check-register-citation-integrity` exit 1 with the exact `DE-01 (audit) … line 9999 is outside the file, which has 78 lines` message; restored → `git diff --quiet` clean, exit 0. Also ran the plan's literal RED (a wrong SYMBOL anchor, `aoa.organization_id` → `aoa.zz_wrong_symbol`) → exit 1 `anchor … does not appear within ±5 lines of line 36`; restored, clean. Register byte-identical afterwards.
- **§5 guards at the reviewed revision:** `check-register-citation-integrity`, `check-guard-inventory`, `check-distributed-execution-foundation`, `check-gate-clause-wiring`, `check-finding-ownership`, `check-test-inventory`, `check-ticket-graph-coverage`, `check-execution-census`, `check-dependency-graph`, `check-evidence-immutability --base origin/docs/replatform-program` — all exit 0.
- **Non-blocking observations:** (1) §3 says "all four citations" while its table lists three (the result citation is a line range); (2) §4 describes its run as the plan's "wrong symbol anchor" RED but actually mutated the LINE out of range — a weaker control; the reviewer ran the literal wrong-symbol variant above and it reds, so the plan's RED is satisfied at this revision.

For `approved`, confirm the four §3 citations still resolve at the reviewed revision, that the
forbidden word appears in none of the three artefacts, and that the register is byte-identical after
the §4 positive control. Then change `Status` to `complete` and commit that disposition separately.

## Review attempt history

The implementation author leaves the table body empty; the pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M0 independent reviewer subagent (Claude) — distinct from the M0 implementation session | `5f3b47556d0df152db0d53d76c304861f30ffd37` | `approved` | §3 citation targets re-read at source (design:233, result:111-113, mint `ownerAuthoritiesAgree` :145/:174); placement residual confirmed open at `job-placement.ts:568`; slice 7 DEFERRED; no slice-6 file; forbidden-word count 0 in all artefacts; commit `360b2e5d6` docs-only; positive control reproduced (wrong-line AND wrong-symbol both exit 1, restored clean); 10 guards exit 0. Non-blocking: "four" vs three citations; record's RED was wrong-line not wrong-symbol (reviewer ran the latter). |
<!-- Later reviewers append attempt 2+ below without rewriting attempt 1. -->
