# CLI-011 — the P-011 output probe: the durable record, preserved in the repository

**Status:** `record` — a preserved measurement, not a ticket result. **This file is deliberately NOT
named `*-result.md`:** `findCompletedTicketIds` (`scripts/check-finding-ownership.mjs`,
`/^([A-Z]+-\d+).*-result\.md$/`) would then read `CLI-011` as shipped, and `CLI-011` owns the still-open
`E7-F026`.
**Epic:** E7 · **Ticket:** [`CLI-011-design.md`](./CLI-011-design.md) ·
**Review:** [`CLI-011-review.md`](./CLI-011-review.md) (its §10 designed this probe) ·
**Apparatus:** [`CLI-011-probe-apparatus-record.md`](./CLI-011-probe-apparatus-record.md) ·
**Ruling it fed:** `E7-D11` (ruling **F7**) in [`../decisions.md`](../decisions.md)

## Why this file exists

The review's §10.3 requires it in terms: *"**Then** copy the durable record into
`tickets/CLI-011-probe-result.md`, naming the run id and the job. This is `E7-F025`'s lesson: a verdict
that lives only in a job log is lost."* The workflow uploads the record as a GitHub Actions artifact
with `retention-days: 90` (`.github/workflows/keyed-e2b-cli-011-output-probe.yml`), so without a
committed copy the only detailed evidence behind a **locked** decision expires. The full record is
committed verbatim beside this file as
[`CLI-011-probe-record.json`](./CLI-011-probe-record.json) — **69,853 bytes**, sha256
`db61e3b071c2557f62c976639c38ca1432d022da78a2a51aa0acf9d7fe7eb5c9`, **byte-identical** to the
downloaded artifact.

★ *Corrected 2026-09-23 (Codex P2, PR #575), re-measured: the first copy of this file carried an
extra blank line at EOF, so it was **69,854** bytes and the "byte-identical" claim above was false.
The blob is now the artifact's own bytes, and the hash is recorded so the claim is checkable rather
than asserted — `sha256sum` on the file must print the digest above.*

★ *The review named the file `CLI-011-probe-result.md`. That name is unsafe for the reason in the
status line above, so the copy is made under `-probe-record`, matching this epic's existing
`CLI-011-probe-apparatus-record.md`. The review's wording is quoted, not edited.*

## The run

| field | value |
|---|---|
| workflow | `Keyed E2B — CLI-011 P-011 output probe` (`.github/workflows/keyed-e2b-cli-011-output-probe.yml`) |
| run | [`35833717162`](https://github.com/MeteoriteLabs/AoA/actions/runs/35833717162) |
| job | `probe` — conclusion `success` |
| head sha | `499ec4d1c3c3aab7324dcf0ca98ea34872fe18a0` |
| artifact | `cli-011-output-probe-record` → `cli-011-output-probe-record.json` |
| record schema | `aoa.cli-011.output-probe-record/1` |
| generated at | `2026-09-23T07:50:40.065Z` |
| template | `aoa-base`, resolved `explicit` |
| arms mode | `all` |
| output root `R` | `/home/user/aoa-output` |

**Disposition:** `measured` — *"every arm observed and every control held"*.

## Controls — all three held

| id | arm | expectation | `held` |
|---|---|---|---|
| PC-1 | `S-PC1` | a planted file in `R` is reported present | `true` |
| PC-2 | `S-PC2` | with `R = /home/user` the staged paths are found under `R` | `true` |
| C-census | `C-census` | the census sees a planted write under `R` and in cwd | `true` |

★ A control that cannot go red is not a control. These three are the probe's own positive controls:
each asserts that the observation apparatus **would** have seen the thing whose absence the ruling
relies on.

## Decision-table rows that FIRED

Read against `CLI-011-review.md` §10.5, which was written before the run.

| row | result | `because` |
|---|---|---|
| **R2** | S-P2 shows directory entries at default depth → confirms §3.3; `CLI-010` must implement files-only recursion | `defaultDepthDirs=["/home/user/aoa-output/sub"]` |
| **R4** | S-P7 nonce present → SD-5 moves to **required before `M1b`'s campaign** | `noncePresent=true` |
| **R6** | A-neg: nothing under `R` or cwd → **6.7 holds for option 2** | `filesUnderRoot=0 removedUnderRoot=0 filesCwdOther=[] cwdMutations=[]` (cli-home-state, reported not counted: 5) |
| **R7** | A-dir writes `R/hello.txt`; A-cwd writes `R/hello.txt` → both placements viable; choose by pin cost: **SD-1b recommended** | `A-dir=true A-cwd=true` |
| **R11** | A-decl carries a correct line → option 1b is feasible; recorded for a post-`M1b` refinement | `declaration={"present":true,"declared":"hello.txt","resolved":"/home/user/aoa-output/hello.txt","relative":true,"matchesWritten":true,"matchesRequested":true}` |

## Decision-table rows that did NOT fire — each one is a refutation that did not happen

| row | result it would have signalled | `because` |
|---|---|---|
| R1 | `R` is not template-empty → pick another `R` | `present=false paths=[]` |
| R3 | list hides links **and** read follows them → `CLI-012` needs an `lstat` path, **+1 day** | `listExposesLink=true readFollowsLink=true` |
| R5 | A-neg finds files under `R` → **SD-1a refuted**, and option 2 refuted if a directive-only `R` also fills | `filesUnderRoot=[] removedUnderRoot=[]; directive-only R extra files=[]` |
| R8 / R9 | only one placement complies | `A-dir=true A-cwd=true` |
| R10 | **neither** placement writes into `R` → outcome (iii) | `A-dir=true A-cwd=true; A-cwd hello elsewhere=[]` |
| R12 | any arm inconclusive, or a control did not hold → **not a measurement** | *"every arm observed and every control held"* |

## Arm verdicts, in one line each

| arm | state | reason |
|---|---|---|
| `S-P0` | observed | `root-absent` — `R` is template-empty on `aoa-base` |
| `S-PC1` | observed | `root-present` — the planted control |
| `S-P1` | observed | `no-staged-path-under-root` |
| `S-PC2` | observed | `staged-paths-under-root` with `R = /home/user` — the three `.aoa-run-*` files |
| `S-P2` | observed | `listed` — default depth includes dirs and does **not** reach nested; depth does; `RealE2bTransport.listDir` returned `["/home/user/aoa-output/a.txt","/home/user/aoa-output/sub/b.txt"]` |
| `S-P3` | observed | `exited` — exit 3 returned (not thrown) through both `runCommand` and `execute`; the file survived |
| `S-P4` | observed | `redirect-failed-before-command` — `commandRan=false`, `failedClosed=true` |
| `S-P5` | observed | `listed` — `type` and `symlinkTarget` are exposed **and** `read` follows the link |
| `S-P6` | observed | `measured` — list `size` equals the real size (3,145,728), read 344 ms, sha matches |
| `S-P7` | observed | `nonce-exported-in-file-bytes` |
| `C-census` | observed | `census-sees-planted-writes` |
| `A-neg` | observed | `nothing-under-root-or-cwd`; `permissionMode=bypassPermissions`, `initCwd=/home/user`, exit 0 |
| `A-dir` | observed | `wrote-hello-under-root`; `rootCreatedDuringArm=true`, `otherFilesUnderRoot=[]`, `helloElsewhere=[]` |
| `A-cwd` | observed | `wrote-hello-under-root`; `initCwd=/home/user/aoa-output`, same emptiness |
| `A-decl` | observed | `wrote-hello-under-root` plus a correct, relative declaration |

## What this record does NOT establish

Stated so a later reader cannot borrow more from it than it measured — the review's §10 limits,
unchanged by the run:

- **codex** (excluded, `E7-D04`); the networked/container lane; any template other than `aoa-base`.
- **Compliance RATES.** One arm per case, one run: the `A-dir`/`A-cwd`/`A-decl` results are
  **existence proofs, not rates**. `E7-D11` does not convert them into rates.
- **Anything about the control-plane half** — grant, commit, announcement, projection. That is
  `CLI-012`…`CLI-014`'s acceptance.
- **That the agent always writes under `R`.** `A-O2-8` stays an accepted named residual (`E7-D11` §5).
