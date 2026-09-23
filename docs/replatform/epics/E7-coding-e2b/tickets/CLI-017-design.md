# CLI-017 — the EMIT build: where the agent writes, and what may leave

**Status:** `filed` — **not started.** Filed 2026-09-23 by ruling **F7**
(`../decisions.md`, **`E7-D11`**, under founder delegation F2).
**Epic:** E7 · **Graph node:** `docs/replatform/program-design.md` `#### CLI-017` ·
**Plan task (the contract):** `../implementation-plan.md` `### CLI-017`
**Depends on:** `CLI-011` (the ruling) · **Blocks:** `CLI-012`'s real-run acceptance, `CLI-015`
**Milestone:** `M1b` · **Owns:** `E7-F026`

★ **This file is a pointer, not a second specification.** The executable contract — Outcome, Files,
Interfaces, Failure behavior, the eight acceptance rows with their mutants, Non-goals and Evidence —
lives in **one** place, the E7 implementation plan's `### CLI-017` task. Two specifications drift;
this epic has a register full of what that costs. Read the task.

## Why this file exists at all

Two reasons, both mechanical:

1. **`check-ticket-graph-coverage`** reads ticket ids from filenames under `epics/*/tickets/`; a node
   with no file is backlog, which `CLI-017` no longer is.
2. **`check-finding-ownership`** tests `tickets.has(entry.ticket)` (`findTicketIds`, the same
   `/^([A-Z]+-\d+)/` derivation). `E7-F026` is re-pointed to `CLI-017` by this ruling, and without a
   file on disk that declaration would fail `owner_ticket_missing` — a false ownership claim the
   guard exists to refuse.

## In one paragraph

Ruling F7 chose **option 2, a conventional output root** `R = /home/user/aoa-output`, with placement
**SD-1b** (a `claude_local`-only directive appended at the distributed caller) and **SD-5** (the
provider refuses exporting bytes that carry the run's own secrets) ruled **REQUIRED**. `CLI-017`
builds exactly that, in **two slices** — `CLI-017-A` (the directive + `PC-12`, the `R` constants +
SD-4's equality check) and `CLI-017-B` (the sandbox-scoped secret handoff, its lifecycle and the
export refusal + `PC-11`) — each inside the Definition of Ready's three-agent-day cap.

## What it owns, and what it must not absorb

- **Owns `E7-F026`** (re-pointed here from `CLI-011` by `E7-D11`). That finding's property is not
  spent: the ruled directive **is** an append that reaches the staged prompt bytes, so `CLI-017` is
  the ticket that must enumerate the staged-prompt pin surface rather than reason about the workload.
  See `E7-F026`'s own Status line for the re-point, and `E7-D11` for the reasoning.
- **Does not own** the enumeration port, the producer, the `kind`, the symlink refusal, the size
  bounds or the bounded read — all `CLI-012`'s. Nor the announcement (`CLI-013`), the projection
  (`CLI-014`) or the counter (`CLI-015`).
- **Does not build option 1b** (the stdout declaration), which `E7-D11` records as feasible and
  defers past `M1b`.

## Preconditions that are NOT this ticket's to discharge

Recorded here so a build agent does not discover them as surprises, and does not mistake them for
work it can do:

- **The template preconditions** — `S-P0` (the root is empty) **and** `A-neg` (a no-op run writes
  nothing under it) on the template `M1b`'s campaign actually uses, re-run on every template change
  or rebuild, and on any bump of the pinned `@anthropic-ai/claude-code@2.1.251` in
  `e2b/e2b.Dockerfile`. They are operator acts, owned by the `M1b` gate owner (`E7-D11`, *Conditions on the
  ruling*; `E7-F022`, HIGH; `scope-triage.md`'s `M1b` required set).
- **A keyed dispatch.** Not authorized by this ticket. The one `A-neg` re-run is authorized under F8
  for the **campaign**, not for a build agent to fire.
