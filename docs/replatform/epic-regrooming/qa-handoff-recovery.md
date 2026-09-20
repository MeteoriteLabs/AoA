# QA and Completion-Handoff Recovery

> ★★★ **AMENDED 2026-09-20 after an audit of this procedure against the rules it must not violate.**
> Four gaps are closed inline below and are summarised here so a reader knows what changed.
>
> **The authorities this procedure operates under, which it previously cited nowhere:**
> [`../artifact-policy.md`](../artifact-policy.md) (record immutability, the required fields, and
> the folder + filename contract), [`../templates/qa-result-template.md`](../templates/qa-result-template.md),
> [`../templates/handoff-template.md`](../templates/handoff-template.md), and — for the three
> already-breached records — the founder grandfather ruling recorded in
> `../epics/E0-foundation/qa/2026-09-14-d0-pre-guard-rewrite-grandfather-a1.md`, enacted as
> `GRANDFATHERED_REWRITES` in `scripts/check-evidence-immutability.mjs`. **That ruling re-pins those
> three records: any FOURTH rewrite, or any later touch of them, is denied by the guard.** §4's
> "leave both files untouched now" agrees with it — now by citation rather than by coincidence.
>
> **Required fields, named explicitly** (they are enforced, not stylistic): `**Supersedes:**`,
> `**Attempt:**`, the revision field — ★ spelled `**Revision:**` on a **QA record** and `**Reviewed
> revision:**` on a **handoff**, *corrected 2026-09-20 (fourth round): this named only `Revision`,
> which no handoff template field matches, so a handoff author following this list could not satisfy
> both it and the template* — and then **one of two verdict fields, which are NOT
> interchangeable** — a **QA record** carries `**Result:**`
> ([`../templates/qa-result-template.md`](../templates/qa-result-template.md)) and a **handoff**
> carries `**Decision:**` ([`../templates/handoff-template.md`](../templates/handoff-template.md)).
> Both take `pass` / `fail` / `blocked_external`. ★ *Corrected 2026-09-20: this list named only
> `Decision` while the procedure creates QA records too, so an author following it could omit the
> template-required `Result` and produce a record the pass checks later in this document cannot
> use.* The filename contract is
> **two forms, not one** — ★ *corrected 2026-09-20 (second round): a single combined pattern was
> given for both record types, and it was the QA form. A handoff author following it would have
> produced a filename carrying a `<scope>` segment the authoritative layout does not define.*
>
> - **QA record:** `<YYYY-MM-DD>-<lane>-<scope>-<sha12>-a<attempt>.md`
> - **Handoff:** `<YYYY-MM-DD>-<gate-or-merge-train>-<sha12>-a<attempt>.md` — **no `<scope>`
>   segment**. For a milestone handoff the middle segment is the milestone id **or the gate slug**
>   (`<YYYY-MM-DD>-<milestone-or-gate-slug>-<sha12>-a<attempt>.md`) — ★ *corrected 2026-09-20
>   (fifth round): milestone-only would have made the `RTF-07`-required `e10-realtime-foundation`
>   handoff unwritable under `milestones/M2-RTF/`.*
>
> **Status-flip authority.** This procedure produces evidence; it grants nothing. Only the
> Integration Gate Owner changes an epic's status, and only on a committed `pass` QA record and a
> committed `pass` handoff for the exact candidate (`../README.md`, `../epics/README.md`).
>
> **Where milestone records live (D-11).** A milestone record belongs to no single epic, and
> ★★★ **BLOCKED UNTIL `EVID-04` IS AMENDED — DO NOT FILE MILESTONE QA RECORDS BEFORE THEN.**
> *Added 2026-09-20 (thirteenth round).* `test-gates.md` `EVID-04` states the QA record path
> normatively as `docs/replatform/epics/<epic>/qa/…`, so a record under `milestones/<milestone>/qa/`
> **does not conform to the gate**. `artifact-policy.md` already carries this as a blocking
> precondition; **this procedure did not**, and this procedure is the executable one — an operator
> following it would have produced nonconforming evidence and then declared `M1a` complete from it.
> Amending the policy, the templates and the immutability guard does **not** amend a gate; that is a
> gate-owner action. **Neither `M1a` nor the required `M2-RTF` campaign can validly pass until it
> happens.**
>
> Once amended: `artifact-policy.md` defines paths only under `epics/<epic>/`. Milestone QA and
> handoff records go under **`../milestones/<milestone>/{qa,handoffs}/`** with the same immutability
> and filename contract. The shared-campaign record of §6 is filed once there and cited by every
> consumer.
>
> ★ **Accepted debt, recorded rather than fixed — the COMPLETE inventory.** ★ *Corrected
> 2026-09-20 after review: an earlier draft of this block listed six records and missed five. §4
> directs recovery work to classify every artifact-policy violation, so an incomplete inventory
> lets the omitted records be treated as valid adoptable evidence.* **Eleven** existing records
> violate the `<YYYY-MM-DD>-…-<sha12>-a<attempt>.md` contract:
>
> | Record | Violation |
> |---|---|
> | `E2-tenant-kernel/handoffs/2026-08-10-epic-completion-21335854f-a5.md` | 9-char revision |
> | `E2-tenant-kernel/handoffs/2026-08-10-epic-completion-920e55de5-a3.md` | 9-char revision |
> | `E2-tenant-kernel/handoffs/2026-08-10-epic-completion-d5abd1a53-a4.md` | 9-char revision |
> | `E2-tenant-kernel/qa/2026-08-10-d0-e2-tenant-kernel-21335854f-a5.md` | 9-char revision |
> | `E2-tenant-kernel/qa/2026-08-10-d0-e2-tenant-kernel-920e55de5-a3.md` | 9-char revision |
> | `E2-tenant-kernel/qa/2026-08-10-d0-e2-tenant-kernel-d5abd1a53-a4.md` | 9-char revision |
> | `E6-deployment-test-harness/qa/2026-08-14-e6-d1-foundation-campaign-pass-85599b192.md` | 9-char revision **and no `-a<attempt>`** |
> | `E0-foundation/qa/2026-09-14-d0-pre-guard-rewrite-grandfather-a1.md` | no revision segment |
> | `E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md` | no revision segment |
> | `E0-foundation/qa/pre-existing-failure-baseline.md` | no revision, no attempt |
> | `E2-tenant-kernel/qa/pre-existing-failure-baseline.md` | no revision, no attempt |
>
> They are **not renamed**: renaming an immutable record is itself a breach, and the grandfather
> ruling already denies further touches of that class. **None of them may be cited as
> exact-candidate evidence without stating the defect**, because a 9-character token does not
> uniquely identify a revision under the contract the gates assume.
> `E2-tenant-kernel/handoffs/` is also missing the `README.md` the folder contract requires — that
> one is purely additive and may be added.

> **Proposal only.** This procedure preserves existing evidence. It never edits an old QA/handoff record to make today’s state look compliant.

## Recovery principles

- Evidence is retained at the strength it actually supports. Unit coverage is not D1 topology proof; a manual mechanism run is not useful capability proof; a ticket result cannot complete an epic.
- QA and handoff files are immutable from their first commit. A correction, rerun, changed decision, or changed revision creates a higher attempt with `Supersedes`.
- Epic completion requires a passing QA record and a passing completion handoff for the exact same candidate revision.
- A named milestone partial gate may unlock only its declared dependency set. It cannot complete an epic or substitute for a stricter normative D1/D2 gate.
- Implementer, independent reviewer/QA owner, and Integration Gate Owner are separate roles. One person may not self-certify the result they implemented.

## 1. Freeze the recovery candidate

Before a campaign starts, record the 40-character revision, ticket-result blob SHAs, topology, environment and provider/template/policy versions, configuration and feature-flag digests, required external services, QA owner, Integration Gate Owner, and rollback owner. A code or behavior-changing documentation commit after that freeze creates a new candidate and new attempt.

Documentation-only disposition commits may follow an independently reviewed implementation revision, but the QA record must state both and prove the candidate code is byte-identical where it carries evidence forward.

## 2. Inventory and classify legacy evidence

For every epic, build a requirement-to-evidence map and classify each item as:

- `adoptable`: immutable, attributable, exact-revision evidence that still proves the requirement;
- `delta_required`: valid historical evidence whose dependency, production reachability, configuration, or candidate has changed;
- `historical_only`: useful for diagnosis but too weak, noncanonical, self-certified, or not tied to the required topology; or
- `invalid_record`: the file itself was changed after first commit or otherwise violates the artifact policy.

Never silently treat prose statuses such as `LANDED`, `SHIPPED`, `DONE`, or a slice label as canonical ticket approval. Adoption requires an independent review that maps the old blob to current acceptance clauses and records every uncovered delta.

## 3. Adopt without rewriting

If an existing ticket result is canonical and still open, append the next independent review attempt without deleting prior attempts. If it is already frozen `complete`, leave it unchanged.

If a historical result is noncanonical or frozen but materially inaccurate, open a finding and create a new successor/reconciliation ticket and result. That successor pins the old result blob, states what is retained, tests the missing delta, and receives its own independent approval. The epic completion handoff pins both the historical evidence and the successor result. Do not normalize the old file in place.

The same rule applies to prerequisite and partial-gate evidence: adopt the narrow clause it proves and do not promote it into an epic-completion claim.

## 4. Supersede immutable-record breaches

> ★ **AMENDED 2026-09-20 — this section covers a CLASS, not two instances.** §2 classifies
> `invalid_record` ("the file itself was changed after first commit **or otherwise violates the
> artifact policy**") and nothing downstream acted on it: §3 handles the other three classes and the
> two named events below were the whole of §4. **Rule for any `invalid_record` not named below:**
> if the breach is a *rewrite*, supersede it exactly as the two worked examples do — a new attempt
> naming the old path in `Supersedes`, re-running or validly carrying forward its evidence, and
> never editing the original. If the breach is a *contract* violation that cannot be repaired
> without touching an immutable file (a malformed filename, a missing field), **record it as
> accepted debt with its reason** — do not rename or edit. The superseding attempt repairs
> provenance; it does not erase the breach, and neither does the debt note.

Two known breaches must remain explicit:

- E5’s exit-gate audit a1 was committed and later modified. Treat its observations as historical input only; create a new a2 audit that names a1 in `Supersedes`, reruns the current candidate, and records the complete seven-clause result.
- E2’s corrective a5 QA record and matching a5 handoff were committed as candidates and later amended with the independent decision. Leave both files untouched now. Create a6 QA and handoff records that name the a5 paths in `Supersedes`, pin the accepted implementation/review revisions, and explain which evidence was independently rerun or validly carried forward.

The superseding attempt repairs provenance; it does not erase the breach or change the earlier file’s history.

## 5. Run candidate QA

Run focused ticket acceptance first, then the epic’s integrated campaign, then every cross-epic gate the milestone consumes. Record commands, exit codes, counts, topology, required/hard/initial/observed values, failure classification, and controlled artifact references.

Infrastructure or external-dependency prevention before the campaign starts may be `blocked_external`. Once a required campaign starts, a scheduled external failure counts toward `fail`. There is no conditional pass and no waiver of a HARD invariant.

For this proposal, keep **all three** M1 partial gates — `M1-D1-SPINE`, `M1a-D2-MECHANISM` and `M1-D2-CODING` — distinct from full D1/D2 in filenames, scope, requirement maps, and decisions. ★ *Corrected 2026-09-20 (third round): this line named only two, which pre-dates the mechanism gate.* ★★★ **`M1a-D2-MECHANISM` and `M1-D2-CODING` must also stay distinct FROM EACH OTHER**, and that is the distinction most likely to be lost: they are run on different candidates, they carry separate `Result` fields, and a mechanism pass is not evidence for the capability gate under any wording. Their records must identify every normative clause they do not certify. In particular, the accepted managed-shared DE-08 residual must be recorded as an unresolved conflict with H-06; it cannot be transformed into a full-gate pass by prose.

## 6. Reuse a shared campaign narrowly

One immutable campaign may support more than one epic when all consumers use the same exact revision, topology, configuration, and evidence bytes. The campaign must contain a separate requirement mapping for each epic and must not infer an untested clause from another epic’s pass.

Each epic still gets its own completion handoff and owner decision. If one epic later changes code, configuration, or a dependency relevant to the shared campaign, only the still-identical consumers may continue to adopt it.

## 7. Commit the completion handoff after QA

The Integration Gate Owner reviews the committed passing QA record, canonical/successor ticket results, open findings, dependency gates, and rollback state. The completion handoff is a separate later commit, pins the reviewed blobs and exact revision, and records only `pass`, `fail`, or `blocked_external`.

`pass` is allowed only when every required ticket result is approved and the exit-gate QA record says `Result: pass` for that revision. A partial-gate handoff may unlock a named dependent without completing the parent epic; its name and scope must make that limit explicit.

**There are two milestone handoffs, not one.** The `M1a` handoff is based on `M1-D1-SPINE` + `M1a-D2-MECHANISM`; the `M1b` handoff adds `M1-D2-CODING`. Each must say it is non-promoting and must not use `epic-completion` in its name, and each gets its own record — an `M1b` handoff does not retroactively serve as `M1a`'s, nor the reverse. ★ *Corrected 2026-09-20 (third round): this said “a first-milestone handoff based on the two M1 partial gates”, singular, which left the `M1a` checkpoint with no handoff of its own.* Full E6/E7 completion remains unavailable until current D1/D2/H-06 pass or the normative gate document is separately amended and approved.

## Reopening rules

An epic or named partial gate reopens when any of these occurs:

- a relevant code, schema, feature flag, provider/template/policy version, topology, or required dependency changes;
- an adopted result is found to have a pending/noncanonical review state or an immutable-record breach;
- a new finding contradicts a gate assumption or makes a passing test vacuous;
- a required production caller is removed or a previously live path becomes dormant;
- a regression or required periodic campaign fails;
- the advertised capability/target matrix expands; or
- the gate owner’s decision changes.

Reopening creates new findings, results where needed, QA attempts, and handoffs. It never rewrites the prior pass.

## Recommended recovery order

1. Repair E2 evidence provenance. For E5, record the a1 immutable-record finding and reserve/approve the a2 audit plan, but do not commit an a2 result before its candidate campaigns exist.
2. Perform current dependency/delta checks for historically complete E0–E2.
3. Reconcile E3, E4, and E6 ticket ledgers and production reachability; close E5’s M1 implementation/build gaps; run focused acceptance; and freeze the E5 a2 seven-clause matrix, commands, topology, and owners.
> ★★★ **STEPS 4–6 WERE REWRITTEN 2026-09-20 (third review round) BECAUSE THEY COULD NOT PRODUCE
> THE `M1a` CHECKPOINT.** As written they made the operator *finish E7 tools/workspace/output
> capability* **first**, then run only `M1-D1-SPINE` and `M1-D2-CODING`, then issue **one**
> handoff. `M1a` exists precisely to be reached **before** output capability, so an operator
> following the old order would never run `M1a-D2-MECHANISM`, never record it, and never produce
> the pre-capability checkpoint — the gate would exist in the plan of record and be unreachable by
> the only executable procedure that mints its evidence. *Creating the gate without updating this
> list was, once again, correcting what the documents say and leaving what they tell you to do.*

0. ★★★ **PRECONDITION — `EVID-04` amended to permit `milestones/<milestone>/qa/`.** Until the gate
   owner does this, every milestone QA record minted by the steps below is nonconforming, so no
   milestone can validly pass. See the banner above.
4. **Freeze the shared candidate and complete the `M1a` required result set.** This step does
   **not** require the **tools** or **output** paths — the tool surface is armed by `CLI-008-C5`,
   an `M1b` ticket, and `M1a` passes with `capabilityProven=false`. ★ **Workspace staging IS
   required**, because the `M1a` journey stages input. *Corrected thirteenth round: an earlier
   revision deferred “tools/workspace/output” while the entry criteria exempted only output — two
   different subsets, so a candidate frozen here could fail `M1a`'s own entry conditions. The exact
   subset is `tools` + `output`, and it is now stated identically in both documents.*
   `M1a` Step 0 first files the tickets that set marks `TO FILE`.
5. **Run `M1-D1-SPINE`, then `M1a-D2-MECHANISM`, on that same frozen candidate**, explicitly
   retaining the DE-08/H-06 conflict. ★ `M1a-D2-MECHANISM` is satisfied by a record reporting
   `capabilityProven=false`; that is the gate’s defining property, not a waiver.
6. **Commit the passing E5 a2 audit as a consumer of the two `M1a` campaign records, THEN issue
   the `M1a` milestone handoff** — non-promoting, and naming both campaign records above.
   `M1a` is complete here. Per-epic completion handoffs still wait for each epic’s normative gate.

   ★★★ **THE AUDIT COMES BEFORE THE HANDOFF, and an earlier revision issued the handoff at this
   step while first committing the audit at step 9 — after `M1b`'s campaigns.** *Corrected
   2026-09-20 (ninth round).* Exit criterion 7 requires a *“committed passing E5 a2 audit”* for
   **both** milestones, so `M1a` was being declared complete before producing evidence its own
   exit criteria require. A milestone cannot be complete at a step that precedes one of its
   required records.
7. **Then** finish E7 tools/workspace/output capability (`CLI-008` Unit F links, `DAT-009` 3c–3e)
   and freeze the `M1b` candidate.
8. **Run ALL THREE gates on the `M1b` candidate** — `M1-D1-SPINE`, `M1a-D2-MECHANISM`, then
   `M1-D2-CODING`. `M1-D2-CODING`'s `Result` is the useful-capability verdict, and a run reporting
   `capabilityProven=false` **fails** it.

   ★★★ **THE M1a RECORDS MAY NOT BE CARRIED FORWARD, and an earlier revision of this step said to
   run only `M1-D2-CODING`.** *Corrected 2026-09-20 (fifth round).* `M1b` inherits every `M1a` exit
   criterion, and criteria 2 and 3 each require a **fresh** campaign; every gate record attests
   **one exact candidate**, and step 7 freezes a NEW one. Reusing `M1a`'s spine and mechanism
   records would attest the older revision, so the procedure as written could not produce a valid
   `M1b` handoff at all. `M1a` is a checkpoint on the way, not a set of credits `M1b` spends.
9. **Commit a HIGHER, SUPERSEDING audit attempt** — `a3` or later — as a consumer of the `M1b`
   campaign records, then issue the **`M1b`** milestone handoff: a second handoff, not the same
   one.

   ★★★ **`M1b` MAY NOT REUSE `a2`.** *Corrected 2026-09-20 (ninth round).* `a2` is an immutable
   record attesting the `M1a` candidate; step 7 freezes a **different** candidate, and an audit
   attests one exact revision exactly as a gate record does. Reusing it would make `M1b`'s
   criterion 7 evidence point at the older tree — the same defect as carrying `M1a`'s gate
   records forward, which step 8 already forbids. A correction or changed candidate creates a
   new attempt linked by `Supersedes`, never an edit.
10. Regroom E8, E9, the later E10 lanes, and E11 as later milestones without losing their current slices or blockers.
