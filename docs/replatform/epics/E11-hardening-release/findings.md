# E11 Hardening & Release — findings

Findings filed against Epic E11. Every OPEN finding must have a declaration in
`scripts/finding-ownership.json` (the `check-finding-ownership` register fails otherwise:
a new open finding is born `undeclared_finding`). `unowned` with a reason is legitimate —
it makes an unscheduled item visible rather than impossible.

## E11-F001 — the "flip strict, two lines from honest" release-gate framing predates CI going green

**Status:** `open` · Severity: LOW · Filed 2026-08-27 by REL-FOUNDATION-GATE (S9 unit 1) terrain verification.

Two living documents describe the E0 release-test fix as a free "flip the checker strict,
accept honestly-red" change:

- `docs/replatform/qa/2026-08-27-breadth-terrain-audit.md` (Sprint 9 section): *"make the
  checker require the named release-test ticket to exist (flips E0 to honestly-red until E11
  lands)."*
- The same audit's *"30/30 Critical/High trust crossings name REL-001/002/003/005"* is
  imprecise. Parsed at tip, **6 of the 30 crossings name the WRITTEN REL-004** (and would pass
  a strict existence check); only **24** name *only* unwritten tickets. A strict flip reds 24,
  not 30.

Both were written when `ci-required` was already red (the GO-BOOK §2.0 60-min `verify`
timeout), so a foundation-checker red was **free** — it changed a gate that was red anyway.
**§2.0 was RESOLVED 2026-08-27 (PR #327): `ci-required` is green, and a red required check now
BREAKS the gate.** The foundation checker runs as a step of the always-on `policy` job
(`.github/workflows/pr.yml`), which `ci-required` requires unconditionally, so a hard-strict
"require the ticket to exist" flip would red a required check on **every** PR until all four
unwritten REL tickets land — a self-inflicted merge freeze, not "honest red". REL-001/002 are
blocked on Sprints 7/8 and REL-005 on all of them, so "until they exist" is the rest of the
programme.

**Resolution recorded, not owed.** REL-FOUNDATION-GATE (S9 unit 1) ships the *trackable-strict*
gate instead: a named REL ticket is admissible if its `<id>-design.md` exists on disk OR it is
declared, with a reason, in `docs/architecture/distributed-execution-release-tests.json`. That
ships **0-error at rest** (6 admit on written REL-004, 24 on manifest-deferral) while making the
24 unwritten release tests machine-tracked debt. GO-BOOK §4 Sprint 9 and §5 were corrected in
review round 2; this finding records that the **dated** 2026-08-27 terrain audit still carries
the pre-CI-green framing (a dated QA snapshot is not silently rewritten). Blocks nothing.

## E11-F002 — the database restore path has no operator entrypoint

**Status:** `open` · Severity: **MED** · Owner: **REL-003** · Filed 2026-08-27 by REL-003 (S9 unit 2) terrain verification.

`runDatabaseRestore` (`packages/db/src/backup-lib.ts`) is exported from that module and
unit-tested, but has **zero production/CLI callers** — verified at tip, the only references are
`*.test.ts` (`packages/db/src/__tests__/backup-lib-non-system-schemas.test.ts`) plus a string
reference in `server/src/__tests__/job-leasing-contract.test.ts`. It is **not** re-exported from
the `@armyofagents/db` barrel (`packages/db/src/index.ts` exports `runDatabaseBackup` but not the
restore), and there is **no `aoa db:restore` command** (`aoa db:backup` exists —
`cli/src/commands/db-backup.ts`). A DR ticket whose acceptance says "prove database … restore"
therefore has no operator invocation for the restore leg — the one clause satisfied by a function
nothing calls (the DSK-002 / REL-004 "count the callers" lesson).

**Resolution (in REL-003 scope):** the DR rehearsal runbook
(`docs/replatform/epics/E11-hardening-release/tickets/REL-003-dr-rehearsal-runbook.md`, step 4)
names the exact restore invocation — a thin harness calling `runDatabaseRestore({ connectionString,
backupFile })`, or `pg_restore` for the custom-format dump — since there is no `aoa db:restore`.
The finding resolves when a real operator restore entrypoint (an `aoa db:restore` command or an
exercised harness wrapper) lands **and** the live staging rehearsal exercises it (the owed leg).
Owned by REL-003.
