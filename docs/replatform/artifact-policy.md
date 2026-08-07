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
    <YYYY-MM-DD>-<lane>-<run-id>.md
  handoffs/
    README.md
    <YYYY-MM-DD>-<gate-or-merge-train>.md
```

Folders are created when an epic enters `planning`. Result files are created only when real execution or evidence exists; do not pre-create empty ticket or QA records.

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

Records the actual scope, changed files, acceptance evidence, focused commands and exit codes, deviations, discovered findings, and follow-up tickets for one ticket. A result cannot mark its epic complete.

### `qa/<date>-<lane>-<run-id>.md`

Records one immutable test campaign: revision, topology, environment, commands, result counts, failure classification, artifact links, and cleanup. A rerun creates a new file instead of overwriting a failed run.

### `handoffs/<date>-<gate-or-merge-train>.md`

Summarizes a merge train or epic gate, references ticket and QA results, lists open risks, and records the Integration Gate Owner’s pass/fail decision.

## Status and evidence rules

- Ticket status is `not_started`, `in_progress`, `gate_review`, `complete`, or `blocked`.
- A ticket becomes `complete` only after its focused acceptance commands pass and its result file is committed.
- An epic becomes `gate_review` only after every required ticket result exists.
- An epic becomes `complete` only after the exit-gate QA result and completion handoff are committed.
- Failed test runs remain in history and are linked from the resolving run.
- Infrastructure/harness failures are classified separately from product failures; neither is erased.
- Autonomous agents may propose decisions in epic-local `decisions.md`; only the designated custodian or gate owner may lock them.

## Naming

- Epic directories: `E<number>-<lowercase-kebab-name>`.
- Ticket results: uppercase ticket ID followed by `-result.md`.
- QA results: UTC date, lane, and stable run ID.
- Handoffs: UTC date plus `merge-train-<n>` or `epic-completion`.
- Finding IDs: epic ID, `F`, and a three-digit sequence.

## Redaction and retention

- Redact credentials, cookies, authorization headers, customer content, and private URLs.
- Record hashes, sizes, event IDs, and controlled artifact references instead of sensitive bytes.
- CI artifacts may expire; the QA record must retain enough structured evidence to understand the result after expiry.
- Do not commit generated provider logs or browser traces to Git.
