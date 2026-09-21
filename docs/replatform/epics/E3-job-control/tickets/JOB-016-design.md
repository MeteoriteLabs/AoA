# JOB-016 — Price accepted usage at ingest, on the in-transaction accepted-event seam

**Status:** `scoping` · **Epic:** E3 · **Plan node:** `docs/replatform/program-design.md`, `#### JOB-016`
**Task:** `docs/replatform/epics/E3-job-control/implementation-plan.md` §4b
**Depends on:** `JOB-005`, `JOB-012`; `WRK-018` for closing `E3-F037` only · **Milestone:** `M1a`
**Owns:** finding **E3-F037** (`epics/E3-job-control/findings.md`)
**Filed:** 2026-09-21 (M1 Step 0, S0-3, `docs/replatform/qa/2026-09-21-m1-execution-plan.md` §4)

---

## Why this file exists now

`check-finding-ownership` accepts an `owned` declaration only for a ticket that has a file on disk
(`findTicketIds` in `scripts/check-finding-ownership.mjs` reads ticket ids from filenames). `E3-F037`
was `unowned` because no ticket would close it. This file makes `JOB-016` a ticket the guard can see,
so the finding can be owned by the work that will close it. It carries no design and no result: the
design is decision `E3-D-ACC`, which is recorded in `../decisions.md` as this ticket's first commit.

## Scope

Build the `E3-D-ACC` seam — an accepted event projected inside the ingest transaction while the
attempt's fence is live — register `priceAcceptedUsage` onto it, and compose `jobBudgetCostBridge`
default-off. Acceptance, failure semantics and the tenant requirements are in the task section.

## What closes `E3-F037`

Both halves, never one: this seam priced and composed, **and** `WRK-018` merged so a real run emits
`usage`. Wiring alone yields no `cost_events` row, or a hollow ~$0 one. When a real handed-off run
produces a `cost_events` row the budget controls read, `findings.md` `Status` flips and the manifest
key is deleted in the same commit.

## Status

Scoping stub. No result doc until the seam is built and reviewed by a distinct reviewer.
