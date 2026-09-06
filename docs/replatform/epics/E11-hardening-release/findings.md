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

## E11-F003 — E11-5's register reason asserts a second call site that does not exist: the warm-sandbox reaper calls a DIFFERENT function

**Status:** open
**Severity:** MEDIUM (a register sentence describing source, refuted by source; the clause's
`wired` verdict is unaffected)
**Filed:** 2026-09-06 (W5U1), measured at `e1f723df2`.

**What the register says.** `scripts/gate-clause-wiring.json` → `E11-5-provider-kill-switch`:

> "Genuinely wired: called on the real poll path (job-leasing.ts) **and by the warm-sandbox
> reaper**."

**Measured.** `evaluateKillSwitches` (`server/src/services/execution-kill-switches.ts:230`) has
exactly ONE production caller:

```
grep -rn "evaluateKillSwitches" --include=*.ts . | grep -v node_modules | grep -v __tests__ | grep -vi "\.test\."
```

→ `server/src/services/job-leasing.ts:49` (the import) and `:720` (the call), plus four COMMENTS
that name it (`packages/db/src/schema/instance_settings.ts:18`,
`server/src/services/execution-kill-switch-policy.ts:13,36`,
`server/src/services/execution-kill-switches.ts:206`,
`server/src/services/execution-target-resolver.ts:62`).
`node scripts/check-gate-clause-wiring.mjs --counts` measures it at **1**.

**What the reaper actually calls.** `server/src/services/warm-sandbox-reaper.ts:195` is:

```js
reclaimProviders = killedProviders(await readDocument(), EXECUTION_TARGET_KINDS);
```

`killedProviders` is a different function in the same module, and the comment two lines above says
it is deliberately the OPPOSITE polarity: *"Fail-OPEN, inverted from leasing: `killedProviders`
returns the empty set for an absent, malformed or unreadable document"* — where
`evaluateKillSwitches` "refuses" an unreadable document (`execution-kill-switch-policy.ts:13`). So
the register does not merely name the wrong symbol; it attributes to `evaluateKillSwitches` a second
site whose actual occupant has the inverse failure mode.

**What is NOT wrong.** `E11-5` is correctly `wired` — one real production caller is one, and
`job-leasing.ts:720` is genuinely on the poll path. The clause's verdict, its `wired` status and
its recorded REL-005 residual all stand. This finding is about the sentence beside them.

**Why it matters at MEDIUM.** This is the failure class W4U1 built `providerCapabilityClaims` for,
in the half that guard deliberately does not cover: the `symbol` field is machine-checked and has
stayed honest, while the `reason` PROSE is read by nobody and rots. A reader auditing kill-switch
coverage reads "and by the warm-sandbox reaper" and concludes the reaper refuses on an unreadable
policy document. It does the opposite, by design and with a comment saying so — an inverted safety
property inferred from a register string. No code is wrong; the map is.

**What would close it.** Correct E11-5's `reason` to say `evaluateKillSwitches` has one production
caller (`job-leasing.ts:720`) and that the warm-sandbox reaper reaches the same policy document
through the deliberately fail-OPEN `killedProviders`. Not done here: W5U1's charter forbids
changing an existing clause's declaration, and the `reason` is part of it.
