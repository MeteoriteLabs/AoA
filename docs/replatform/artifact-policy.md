# Re-platform Artifact Policy

## Purpose

Keep every design change, implementation result, QA run, autonomous test campaign, finding, and handoff navigable by epic without creating competing architecture sources.

## Epic folder contract

An active epic uses this layout:

```text
docs/replatform/epics/<epic>/
  README.md
  implementation-plan.md
  decisions.md
  findings.md
  tickets/
    README.md
    <TICKET-ID>-result.md
  qa/
    README.md
    <YYYY-MM-DD>-<lane>-<scope>-<sha12>-a<attempt>.md
  handoffs/
    README.md
    <YYYY-MM-DD>-<gate-or-merge-train>-<sha12>-a<attempt>.md
```

Folders are created when an epic enters `planning`. Result files are created only when real execution or evidence exists; do not pre-create empty ticket or QA records.

★★★ **MILESTONE records live outside the epic tree (added 2026-09-20, founder decision D-11).** A
milestone spans several epics by construction, so its QA and handoff records belong to no
`epics/<epic>/` folder. They live under:

```
docs/replatform/milestones/<milestone>/
  qa/        <YYYY-MM-DD>-<gate>-<scope>-<sha12>-a<attempt>.md
  handoffs/  <YYYY-MM-DD>-<milestone-or-gate-slug>-<sha12>-a<attempt>.md
```

★★★ **BLOCKING PRECONDITION — `EVID-04` MUST BE AMENDED BEFORE ANY MILESTONE QA RECORD IS FILED,
AND THIS DOCUMENT CANNOT DO IT.** *Added 2026-09-20 (twelfth round), verified at source.*
`test-gates.md` `EVID-04` states the record path normatively: *“Use
`docs/replatform/epics/<epic>/qa/<YYYY-MM-DD>-<lane>-<scope>-<sha12>-a<attempt>.md`”*. A record
under `milestones/<milestone>/qa/` **does not conform to it**. Changing this policy, the templates
and the immutability guard does **not** amend a normative gate — gate text is the gate owner's, and
`qa-handoff-recovery.md` says so in terms.

★ **So the milestone layout is BLOCKED on an `EVID-04` amendment permitting milestone paths**, and
the most concrete casualty is the **required `M2-RTF` campaign**, which has nowhere conforming to
live. Filing milestone evidence before that amendment produces records that satisfy this document
and violate the gate — which is worse than having no path, because it looks conformant. **This is a
gate-owner action and it is not optional.**

★ **The handoff's middle segment is the milestone id OR the gate slug.** *Corrected 2026-09-20:
it read `<milestone>`, which collides with a gate that requires its handoff by name — `RTF-07`
requires `e10-realtime-foundation`, so an `M2-RTF` handoff must be free to carry the gate slug
there. Existing handoffs already use the gate slug in this position.*

**The contract is identical, not softer** — the same immutability rule, the same required fields,
the same 12-character revision in every filename. (Worded to avoid restating the rule's own
phrase: `check-distributed-execution-foundation.mjs` requires that phrase to appear here, and a
second copy would let a mutant delete the real one while the checker still passed.) A milestone handoff is **non-promoting**: it
changes no epic status and must not use `epic-completion` in its name. See
[`milestones/README.md`](./milestones/README.md).

## Artifact responsibilities

### `README.md`

Owns epic status, dependencies, ticket list, exit gate, and links to the latest accepted evidence. It is a navigation ledger, not an implementation diary.

### `implementation-plan.md`

Owns exact files, interfaces, red/green commands, task ordering, and commit boundaries. Once ticket execution begins, behavior-changing edits require an entry in `decisions.md` and a plan amendment reviewed by the Integration Gate Owner.

### `decisions.md`

Records epic-scoped decisions in chronological order. Each entry states context, decision, alternatives, consequences, and affected tickets. Product-wide or cross-epic decisions are also promoted to `docs/architecture/decisions.md`; the local entry links to the promoted decision.

### `findings.md`

Uses stable IDs such as `E1-F001`. A finding records severity, evidence, affected tickets, disposition, and whether it blocks the gate. Findings are never silently deleted; resolved findings retain the resolution link.

### `tickets/<TICKET-ID>-result.md`

Records the actual scope, changed files, acceptance evidence, focused commands and exit codes, deviations, discovered findings, and follow-up tickets for one ticket. It is a controlled append-only review ledger while `in_progress` or `gate_review`: every review attempt is appended and prior `changes_requested` history remains visible. The summary fields point to the latest attempt. Once status becomes `complete`, the file is frozen; a later correction creates a finding and a new ticket/result rather than rewriting approved evidence. A result cannot mark its epic complete.

### `qa/<date>-<lane>-<scope>-<sha12>-a<attempt>.md`

Records one immutable test campaign: exact revision, topology, environment, commands, REQUIRED/HARD/INITIAL/OBSERVED values, stable requirement-to-evidence mapping, result counts, failure classification, artifact links, schedule/sample dimensions where applicable, and cleanup. It is write-once from its first commit. A rerun or correction creates a new attempt with `Supersedes` instead of modifying any prior run.

### `handoffs/<date>-<gate-or-merge-train>-<sha12>-a<attempt>.md`

Summarizes a merge train, named partial gate, or epic gate; pins ticket-result blob SHAs, reviewed implementation SHAs, and immutable QA records; lists open risks; and records the named Integration Gate Owner's `pass`, `fail`, or `blocked_external` decision on one exact revision. It is write-once from its first commit; a correction or changed decision creates a new attempt with `Supersedes`.

## Status and evidence rules

- Ticket status is `not_started`, `in_progress`, `gate_review`, `complete`, or `blocked`.
- The implementation commit creates the result at `gate_review` with the independent-review summary set to explicit `pending` sentinels and no review-attempt row. That placeholder is not attempt 1, and implementation-agent self-certification cannot set `complete`.
- A separate reviewer appends review attempt 1 with the reviewed revision, disposition, evidence, and findings and adds stable entries to the epic findings ledger when needed. Later reviewers append monotonically increasing attempts. Only an `approved` latest disposition with all focused acceptance commands passing changes the result status to `complete`; the reviewer commits that documentation-only disposition. `changes_requested` leaves it at `gate_review` (or `blocked` when the recorded blocker applies), and the same reviewer or another independent reviewer appends a later attempt for the resolving revision without deleting or editing earlier attempts. The ledger does not embed the Git SHA of the commit that contains its own row; that commit is recovered from repository history, while downstream handoffs pin the resulting ticket-ledger blob SHA.
- An epic becomes `gate_review` only after every required ticket result exists with status `complete`, so no result ledger may retain the implementation-time pending summary.
- An epic becomes `complete` only after the exit-gate QA record is committed with `Result: pass` and the completion handoff is committed with `Decision: pass`, both for the exact candidate revision. A `fail` or `blocked_external` record leaves the epic in `gate_review`.
- QA/handoff files are immutable from first commit. Failed or incorrect records remain in history and are linked through `Supersedes` from the resolving attempt.
- Infrastructure/harness failures are classified separately from product failures; neither is erased.
- QA decisions are `pass`, `fail`, or `blocked_external`; there is no conditional pass. `blocked_external` applies only when an external dependency prevents the required lane/schedule from starting; scheduled external failures after a campaign starts count toward `fail`. A HARD invariant in `test-gates.md` cannot be waived.
- A rerun, correction, changed decision, or changed revision always creates a new revision/attempt-qualified filename; same-day attempts never overwrite evidence.
- Autonomous agents may propose decisions in epic-local `decisions.md`; only the designated custodian or gate owner may lock them.

## Naming

- Epic directories: `E<number>-<lowercase-kebab-name>`.
- Ticket results: uppercase ticket ID followed by `-result.md`.
- QA results: UTC date, lane, scope, 12-character revision, and monotonically increasing run attempt. Example: `2026-08-07-d4-service-72h-9b74b888d78b-a1.md`.
- Handoffs: UTC date, `merge-train-<n>`, a named partial-gate slug such as `e6-d1-foundation` or `e10-realtime-foundation`, or `epic-completion`; then the 12-character reviewed revision and a monotonically increasing attempt. A rerun never overwrites an earlier decision.
- Finding IDs: epic ID, `F`, and a three-digit sequence.

## Redaction and retention

- Redact credentials, cookies, authorization headers, customer content, and private URLs.
- Record hashes, sizes, event IDs, and controlled artifact references instead of sensitive bytes.
- CI artifacts may expire; the QA record must retain enough structured evidence to understand the result after expiry.
- Do not commit generated provider logs or browser traces to Git.
