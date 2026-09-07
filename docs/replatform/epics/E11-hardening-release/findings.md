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

**Status:** resolved_by_w16a · **Owner:** — (closed; the ownership entry is deleted in this commit)
**Severity:** MEDIUM (a register sentence describing source, refuted by source; the clause's
`wired` verdict is unaffected)
**Filed:** 2026-09-06 (W5U1), measured at `e1f723df2`.
**Resolved:** 2026-09-07 (W16A, branch `replatform/w16a-register-sentences`), re-measured at
`8075cd7a1`.

> ★ **HOW IT WAS RESOLVED, AND THE ONE THING THAT COULD UNDO IT.** W16A rewrote
> `E11-5-provider-kill-switch`'s `reason` to exactly what the "What would close it" section below
> prescribes: `evaluateKillSwitches` has ONE production caller (`job-leasing.ts:720`), the
> warm-sandbox reaper reaches the same policy document through the deliberately fail-OPEN
> `killedProviders`, and the inverse-polarity comment is quoted verbatim so a reader cannot infer
> the fail-closed property again. Nothing about the clause's `status`, `symbol` or
> `expectedReferences` moved; this was prose only, which is all this finding ever alleged.
>
> **This is a BRANCH STATE.** It is true on `replatform/w16a-register-sentences`. If that PR is
> not merged, the corrected sentence goes with it and this finding is `open` again — restore the
> `E11-F003` key in `scripts/finding-ownership.json` at the same time.
>
> ★★★ **A FALSE NEGATIVE SWEEP, CORRECTED 2026-09-07 (W16A-FIX) — recorded here because a false
> sweep inside a register-accuracy unit is the defect eating itself.** W16A's build report claimed
> that `grep -rn 'evaluateKillSwitches' docs --include=*.md` returned "only E11-F003 plus
> `REL-004-lane-C-design.md`". **Re-run at `75c3e42a2`: 46 hits across 8 files** —
> `E11-hardening-release/findings.md`, `REL-004-lane-C-design.md`, `REL-004-lane-C-result.md`,
> `REL-004-lane-D-design.md`, `REL-004-lane-D-result.md`, `REL-004-lane-D-terrain.md`,
> `REL-FOUNDATION-GATE-design.md` and `GO-BOOK.md`.
>
> **The sweep's CONCLUSION survives; its STATED BASIS did not.** All six previously-unnamed files
> were read: none repeats the "second caller" claim, and the three Lane-D documents refute it
> independently — `REL-004-lane-D-design.md:122,133` and `REL-004-lane-D-result.md:60` both set
> `evaluateKillSwitches` (fail-closed) against `killedProviders` (fail-open) as *two consumers of
> one parse*, and `REL-004-lane-D-terrain.md:115` tabulates `evaluateKillSwitches` at **1** caller.
> `GO-BOOK.md:1792` and `REL-FOUNDATION-GATE-design.md:223` name only the REL-005 write-path
> residual. So the correction is complete and no other document needed one — but that is now a
> **measured** statement rather than an asserted one, which is the whole difference this register
> exists to keep.

**What the register SAID.** `scripts/gate-clause-wiring.json` → `E11-5-provider-kill-switch`, as
filed (this text no longer exists in the file):

> "Genuinely wired: called on the real poll path (job-leasing.ts) **and by the warm-sandbox
> reaper**."

**Measured.** `evaluateKillSwitches` (`server/src/services/execution-kill-switches.ts:230`) has
exactly ONE production caller:

```
grep -rn "evaluateKillSwitches" --include=*.ts . | grep -v node_modules | grep -v __tests__ | grep -vi "\.test\."
```

→ `server/src/services/job-leasing.ts:49` (the import) and `:720` (the call), plus **five comment
lines across four other production files** (corrected from "four COMMENTS" 2026-09-07, W16A-FIX)
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
through the deliberately fail-OPEN `killedProviders`. Not done by W5U1: its charter forbids
changing an existing clause's declaration, and the `reason` is part of it. **DONE by W16A** —
see the resolution note at the top of this entry. W16A additionally measured one fact this finding
did not record: `killedProviders` returns only entries carrying `reclaim: true`
(`execution-kill-switches.ts:213-222`), so the reaper is not a consumer of the kill VERDICT under
any polarity, not merely a differently-polarised one.
