# MIG-011 — make the pass verdict and the gate verdict agree by construction

**Status:** `scoping` · **Epic:** E10 · **Filed:** 2026-09-21 (M0 unit 5, founder decision D-10)
**Depends on:** `MIG-010` · **Successor to:** `MIG-010` for [`E7-F007`](../../E7-coding-e2b/findings.md#e7-f007)
**Owns:** `E7-F007` (MEDIUM, open)

---

## Why this ticket exists

`scope-triage.md` records the deadlock plainly: `MIG-010` has no `-result.md` **deliberately**,
because adding one would retire it as `E7-F007`'s owner exactly when that finding needs one — while
exit criterion 1 requires a result for every required ticket. Founder decision **D-10**: file a
successor for `E7-F007` so `MIG-010` can land a result honestly.

★ **Filing this successor does NOT discharge `MIG-010`'s result.** `scope-triage.md` corrects that
reading in terms (eighth round): the successor *"only removes the ownership deadlock **so that**
`MIG-010` CAN receive a result; it neither creates nor approves one."* The order is: file this,
**then** commit and approve `MIG-010`'s result. Both before `M0` exits.

## The finding, restated from its own evidence

Measured on a real database in `mig-010-unit-2-5-unattributable.integration.test.ts`, not reasoned:

1. A lease owned by an agent reconciles as `mapped`; the record lands on disk.
2. The founder deletes the agent. `environment_leases.agent_id` is `ON DELETE SET NULL`, so the
   lease survives with no owner FK and `resolveResourceType` can no longer classify it.
3. Re-running the pass builds an `unattributable` record in memory and reports `ok: false` — but
   `insertRecordIfAbsent` is `onConflictDoNothing` on `(company_id, resource_key)` and a record
   already exists, so **nothing is written**. The persisted row is still `mapped`.
4. The gate reads the **persisted** records, finds closure satisfied, and **opens**.

★★★ **It is the MIRROR of E7-F006, not a repeat of it.** E7-F006's trap is a durable
`unattributable` record: it refuses fail-**closed**, and Unit 2.5 gave it a remedy. This one is
fail-**OPEN**, and there is **no record for that remedy to act on**. Widening the Unit 2.5 command to
rewrite a `mapped` record is the forgeable transition design §9.2 forbids by name, which is exactly
why it was not done.

## The three candidate shapes, preserved rather than pre-decided

The finding is explicit that these are *"not equivalent"* and that choosing is the ticket work. They
are carried here verbatim in substance so this ticket does not quietly narrow to whichever is
easiest:

1. **`stale_record` as its own outcome** — let the pass compare against the persisted record and
   report a verdict distinct from `unattributable`.
2. **A reconcile-with-existing path** — reopens *"a pass that can rewrite its own verdict is not
   evidence"* (design §9.2 option 2), and the finding says it is *probably wrong*. Recorded, not
   recommended.
3. **Read the same rows the gate reads** — accept the divergence and make the pass's verdict come
   from the persisted records, so the two **cannot disagree by construction**.

★ Shape 3 is the one that removes the failure class rather than reporting it, and the acceptance
below is written so shapes 1 and 3 can both satisfy it. Shape 2 must clear design §9.2 before it may
be chosen.

## Acceptance

The two computations of the same predicate cannot return different verdicts for the same crosswalk
state, **or** the divergence is accepted and the operator's pass reads the persisted records the
gate reads. In either case `pnpm reconcile:legacy-resources` must be returnable to green by some
command; a permanently red operator tool with no path to green is not an acceptable end state.

## Non-goals

Widening `resolve:unattributable-record` to rewrite a `mapped` record (forgeable transition, §9.2);
granting the operator pool any new authority — E7-F006's remedy cost none and neither may this;
re-opening `E10-F002`, `E7-F004`, `E7-F005` or `E7-F006`, all closed by `MIG-010`.

## Test

`mig-010-unit-2-5-unattributable.integration.test.ts` extended with the ordering that produces the
divergence — delete the agent **after** the first pass — asserting the pass verdict and the gate
verdict agree. ★ The positive control matters more than usual here: the case must be shown to FAIL
against today's code before the fix, because this finding's own reachability claim was partly wrong
once already (the divergence only exists when the deletion follows the first pass), and that was
caught by asserting what was observed rather than what was expected.
