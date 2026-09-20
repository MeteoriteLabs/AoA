# QA and Completion-Handoff Recovery

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

Two known breaches must remain explicit:

- E5’s exit-gate audit a1 was committed and later modified. Treat its observations as historical input only; create a new a2 audit that names a1 in `Supersedes`, reruns the current candidate, and records the complete seven-clause result.
- E2’s corrective a5 QA record and matching a5 handoff were committed as candidates and later amended with the independent decision. Leave both files untouched now. Create a6 QA and handoff records that name the a5 paths in `Supersedes`, pin the accepted implementation/review revisions, and explain which evidence was independently rerun or validly carried forward.

The superseding attempt repairs provenance; it does not erase the breach or change the earlier file’s history.

## 5. Run candidate QA

Run focused ticket acceptance first, then the epic’s integrated campaign, then every cross-epic gate the milestone consumes. Record commands, exit codes, counts, topology, required/hard/initial/observed values, failure classification, and controlled artifact references.

Infrastructure or external-dependency prevention before the campaign starts may be `blocked_external`. Once a required campaign starts, a scheduled external failure counts toward `fail`. There is no conditional pass and no waiver of a HARD invariant.

For this proposal, keep `M1-D1-SPINE` and `M1-D2-CODING` distinct from full D1/D2 in filenames, scope, requirement maps, and decisions. Their records must identify every normative clause they do not certify. In particular, the accepted managed-shared DE-08 residual must be recorded as an unresolved conflict with H-06; it cannot be transformed into a full-gate pass by prose.

## 6. Reuse a shared campaign narrowly

One immutable campaign may support more than one epic when all consumers use the same exact revision, topology, configuration, and evidence bytes. The campaign must contain a separate requirement mapping for each epic and must not infer an untested clause from another epic’s pass.

Each epic still gets its own completion handoff and owner decision. If one epic later changes code, configuration, or a dependency relevant to the shared campaign, only the still-identical consumers may continue to adopt it.

## 7. Commit the completion handoff after QA

The Integration Gate Owner reviews the committed passing QA record, canonical/successor ticket results, open findings, dependency gates, and rollback state. The completion handoff is a separate later commit, pins the reviewed blobs and exact revision, and records only `pass`, `fail`, or `blocked_external`.

`pass` is allowed only when every required ticket result is approved and the exit-gate QA record says `Result: pass` for that revision. A partial-gate handoff may unlock a named dependent without completing the parent epic; its name and scope must make that limit explicit.

A first-milestone handoff based on the two M1 partial gates must say it is non-promoting and must not use `epic-completion` in its name. Full E6/E7 completion remains unavailable until current D1/D2/H-06 pass or the normative gate document is separately amended and approved.

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
4. Finish E7 tools/workspace/output capability and freeze the exact shared M1 candidate.
5. Run `M1-D1-SPINE`, then `M1-D2-CODING` on that same candidate, explicitly retaining the DE-08/H-06 conflict.
6. Commit the passing E5 a2 audit as a consumer of both campaign records, then issue only the non-promoting milestone handoff. Per-epic completion handoffs wait for each epic’s normative gate.
7. Regroom E8, E9, the later E10 lanes, and E11 as later milestones without losing their current slices or blockers.
