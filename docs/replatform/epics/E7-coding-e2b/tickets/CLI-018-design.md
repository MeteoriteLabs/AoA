# CLI-018 — the founder-reachable artifact: make a distributed run's committed bytes retrievable

**Status:** `filed` — **not started.** Filed 2026-09-24 by the **M1 planning session** under founder
delegation **F2**, on the measurement recorded in `../findings.md` `E7-F047`.
**Epic:** E7 · **Graph node:** `docs/replatform/program-design.md` `#### CLI-018` ·
**Plan task (the contract):** `../implementation-plan.md` `### CLI-018`
**Depends on:** `JOB-017` (shipped — the projection seam this rides) · **Blocks:** `M1b` exit
criterion 4
**Milestone:** `M1b` · **Owns:** `E7-F047`

★ **This file is a pointer, not a second specification.** The executable contract — Outcome, Files,
Interfaces, Failure behavior, Acceptance, the focused verify command, Non-goals and Evidence — lives
in **one** place, the E7 implementation plan's `### CLI-018` task. Two specifications drift; this
epic has a register full of what that costs. Read the task.

## Why this file exists at all

The same two mechanical reasons `CLI-017-design.md` records:

1. **`check-ticket-graph-coverage`** reads ticket ids from filenames under `epics/*/tickets/`; a node
   with no file is backlog, which `CLI-018` no longer is.
2. **`check-finding-ownership`** tests `tickets.has(entry.ticket)` (`findTicketIds`, the
   `/^([A-Z]+-\d+)/` derivation). `E7-F047` is re-pointed from `unowned` to `CLI-018`, and without a
   file on disk that declaration would fail `owner_ticket_missing` — a false ownership claim the
   guard exists to refuse.

★ **There is deliberately no `CLI-018-result.md`.** `findCompletedTicketIds` reads a `-result.md` as
"this ticket shipped", and the ticket has not been built. The result belongs to whoever builds it.

## In one paragraph

A distributed agent's artifact is durable in object storage and **unreachable by any
founder-available route** — seven routes measured, negatives included, tabulated on `E7-F047`.
`CLI-018` closes that. It presents **two options and chooses neither**: **(a)** materialize the
committed `job_artifacts` row into the product `artifacts`/`assets` tables so the existing routes and
`OutputRefTabBody` work unchanged, or **(b)** a founder-facing read route that mints a download grant
for a board actor, reusing the grant machinery that already exists. The choice is a later ruling,
because option (b) turns a **worker credential surface** into something a board session can reach,
and that authorization analysis has not been done — the task makes it a **precondition of the
option**, not an afterthought. Under ruling **F10** whichever option is chosen needs a cross-tenant
denial case with a same-tenant positive control, and the acceptance carries an **end-to-end** arm
that asserts criterion 4 itself: a founder-available route returns the bytes of an artifact a
distributed run produced.
