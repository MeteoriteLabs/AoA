# <TICKET-ID> Result — <Ticket title>

**Status:** `gate_review`
**Date (UTC):** `<YYYY-MM-DD>`
**Epic:** `<E#-name>`
**Plan task:** `<implementation-plan heading>`
**Implementer:** `<agent or human identity>`
**Start SHA:** `<40-character implementation-base SHA or not_applicable>`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the section below and is the only role that may change it to `complete`.

## Delivered scope

- List the behavior actually delivered.
- List explicit non-goals preserved.

## Changed files

| File | Responsibility |
|---|---|
| `<path>` | `<why it changed>` |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| `<condition>` | `<test, assertion, or inspected artifact>` | `pass` or `fail` |

## Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `<exact command>` | `0` | `<counts/output>` |

## Deviations

State `None` or describe the approved decision entry that changed the plan.

## Findings

State `None` or link stable IDs from `../findings.md`.

## Follow-up tickets

State `None` or list ticket IDs with one-sentence outcomes.

## Gate recommendation

State `ready for independent review` or `not ready`, with the concrete reason.

## Independent review

**Reviewer:** `<agent or human identity; must differ from implementer>`
**Reviewed revision:** `<40-character git SHA>`
**Disposition:** `pending`, `approved`, or `changes_requested`
**Review evidence:** `<review record, exact commands/exit codes, or finding links>`

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.
