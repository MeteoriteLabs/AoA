# TRACK-001-B1 Result - the ticket-graph guard still runs, and the authority is still complete

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan TRACK-001-B1 - current lane evidence for the ticket-graph guard (M0)`
**Implementer:** `M0 unit 6 (Claude Opus 5) - re-measure only; none of the underlying work is this record's`
**Start SHA:** `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ This is an EVIDENCE-CURRENCY record, not a rebuild and not a re-approval of the original
ticket. `qa-handoff-recovery.md` section 2 forbids treating a prose `LANDED` header as canonical
ticket approval, so `M0` exit requires a result measured on **this** candidate. The original
[`TRACK-001-result.md`](./TRACK-001-result.md) is not edited: where a measurement disagrees with it, the
disagreement is recorded here as a **delta**, never repaired in place.

---
## 1. What was measured

| Clause | OBSERVED at `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf` | State |
|---|---|---|
| the guard runs and passes | `node scripts/check-ticket-graph-coverage.mjs` exit 0 | **green** |
| every ticket FILE has a node | `117 ticket ids from files, all present among 131 graph nodes` | **green** |
| authority-only ids reported, not failed | `14 planned-but-unbuilt ids ... the backlog and not a failure` | **green, by design** |
| pure logic separated | `scripts/lib/ticket-graph-coverage.mjs` | present |
| unit tests pinning the design | `scripts/lib/__tests__/ticket-graph-coverage.test.mjs` - **8** cases | matches the result's "8 unit tests" |
| declared in the guard inventory | `scripts/guard-inventory.json` names `check-ticket-graph-coverage.mjs` | **green** |

## 2. Deltas against the original result

**None material.** The id and node counts have grown with the programme, which is expected and is
not a regression. The asymmetry the ticket was built on is intact.

★★★ And it was exercised on real work during this milestone, which is stronger evidence than
re-reading it. `M0` unit 4 added seven `CLI-01x` nodes while creating only two ticket files, and the
guard reported the five file-less ids as **backlog** and passed - the asymmetry behaving exactly as
its own header describes. In the same unit a `#### CLI-008 ...` heading for a mapping block minted a
second `CLI-008` node and reddened `check-dependency-graph` with *"ticket heading has no 'Depends
on:' line"*, which is the sibling guard doing its job. Both observations are live, this candidate.

## 3. Not re-run here

The 8 unit cases were read, not executed (this worktree has no `node_modules`). Recorded as
`not re-run` rather than assumed green.

## Independent review

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Attempt:** none recorded

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.
