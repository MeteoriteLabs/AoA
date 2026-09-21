# DEP-016 — The `m1-spine` campaign profile on the D1 compose

**Status:** `scoping` · **Epic:** E6 · **Plan node:** `docs/replatform/program-design.md`, `#### DEP-016`
**Depends on:** `JOB-016`, `JOB-017`, `DEP-004`; `WRK-018` for closing `E3-F037` · **Milestone:** `M1a`
**Owns:** finding **E3-F037** (`epics/E3-job-control/findings.md`)
**Filed:** 2026-09-21 (planning-session ruling under founder delegation F2, applied in `JOB-016`'s PR #547)

---

## Why this file exists now

`check-finding-ownership` accepts an `owned` declaration only for a ticket that has a file on disk
(`findTicketIds` in `scripts/check-finding-ownership.mjs` reads ticket ids from filenames), and
refuses an open finding owned by a ticket that has a `-result.md`. `JOB-016` built the seam and the
pricing and filed its result record, so `E3-F037` is re-pointed to the ticket whose acceptance is
the end-to-end proof that closes it. This file makes `DEP-016` a ticket the guard can see. It
carries no design and no result.

## Scope

The `m1-spine` campaign profile described in the program-design node: a one-worker topology on the
D1 compose, evidence retained on pass, and audit and cost assertions per attempt, run across at
least three Organizations (two enabled, one control). The reference provider emits canned usage.

## What closes `E3-F037`

All of the following, never a subset:

1. `JOB-016` — the in-transaction accepted-event seam `E3-D-ACC` and the pricing registered on it
   (built; `epics/E3-job-control/tickets/JOB-016-result.md`).
2. `WRK-018` — the usage producer on the deployed worker, **and** its keyed E2B acceptance for the
   real claude usage parser.
3. This ticket's end-to-end assertion: a handed-off attempt through the **real** ingest writes
   exactly ONE `cost_events` row with cost > 0, and a usage-suppressed positive control reds.

When all three hold, `findings.md` `Status` flips and the `E3-F037` key in
`scripts/finding-ownership.json` is deleted in the same commit.

## Status

Scoping stub. No result doc until the profile is built and reviewed by a distinct reviewer.
