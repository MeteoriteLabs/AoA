# HANDOFF — Session 2: guard-sink enactment + register custodian (register-heavy track)

**Base:** branch a fresh git worktree off the `docs/replatform-program` tip that contains this file (the kickoff PR).
**Track class:** ruling-unblocked, **register/docs only — NO production code** (guard-sink R1 was ruled **B**, which is honest-the-gap, not a code change).
**Companion session:** Session 1 (E9 service-lifecycle) runs in parallel. **You are the sole custodian of the four shared registers** — Session 1 hands you its finding-close deltas; you land them last, one at a time.

---

## Founder rulings this session enacts (ruled 2026-09-20)

- **R1 guard-sink = Option B (accept-the-gap-made-honest).** Dispose of the two `guardPlatformAuthority` throws that write no denial row: **G1** (`server/src/services/job-leasing.ts:596`, the platform-scope fallthrough) — reclassify as a **data-integrity fallthrough** (not an authority denial at all); **G2** (`job-leasing.ts:638`, the 30-conjunct physical-authority recheck) — **accept on the session-arm adjacency** (`security.denied.worker_session` already audits the same physical recheck), naming the adjacent-not-identical residual window in the DE-18/DE-04 register rows. Close the `§5.4` deferral task in the guard-sink paper. **DO NOT amend the frozen JOB-003 contract** (that was rejected Option A). **DO NOT edit `job-leasing.ts`** — B is register + docs only.
- **R2 Unit F fifth option = ratify SUPERSEDED.** Add the ratification note to `docs/replatform/epics/E7-coding-e2b/tickets/CLI-008-unit-f-design.md` §13.3/§13.4: keep `capabilityProven` dormant-and-printed off-by-default; **do NOT delete** clause-6 arm 2 (W21/#422 already made it honest — deleting converts a fixed judge into "no judge"); do NOT arm `--require-capability`. (A `★ RATIFIED 2026-09-20` note was already added to §13 in the kickoff commit — verify it reads correctly and expand if needed.)

## Owned work + scope

| Item | Action | Notes |
|---|---|---|
| Guard-sink R1=B | Amend the DE-18 + DE-04 `deliveryEvidence` in `docs/architecture/distributed-execution-threat-controls.json`: name G1 as data-integrity, G2 as session-arm-adjacent, and the residual window. Close the `§5.4` deferral in the guard-sink paper; flip its status to RULED-ENACTED. | register + docs only |
| Unit F §13 ratify | Confirm/expand the `★ RATIFIED 2026-09-20` note in CLI-008-unit-f-design.md | docs only |
| Stale-heading verification | The 3 stale-ruled paper headings (Unit C, DAT-007, E9-F002) were flipped in the kickoff commit — verify they now read "RULED + ENACTED", not "AWAITING" | docs only |
| **Register custodian** | Serialize EVERY `finding-ownership.json` key-delete + `findings.md` status-flip + `threat-controls.json`/`gate-clause-wiring.json` edit that Session 1's finding-closes require: land them **last, one at a time**, re-pointing citations after each rebase. | the load-bearing coordination role |

## ★ The register-editing discipline (this is why a custodian exists)

The four shared registers — `scripts/finding-ownership.json`, `docs/architecture/distributed-execution-threat-controls.json` (326 KB), `scripts/gate-clause-wiring.json`, `docs/replatform/GO-BOOK.md` (398 KB) — are guarded by **pure-node checks that RED on cross-branch drift**. Two branches editing them conflict *before* their code does. As custodian you MUST:

1. **After EVERY register edit, run ALL the guards** — a file can have more than one:
   ```bash
   node scripts/check-register-citation-integrity.mjs      # threat-controls.json citations
   node scripts/check-distributed-execution-foundation.mjs # threat-controls.json <-> finding-ownership consistency
   node scripts/check-finding-ownership.mjs                # findings.md <-> finding-ownership.json
   node scripts/check-gate-clause-wiring.mjs               # gate-clause-wiring.json
   node scripts/check-ticket-graph-coverage.mjs
   ```
   **Enumerate every guard that reads a file before claiming local-green** — `grep <filename> .github/workflows/pr.yml scripts/guard-inventory.json`. (The #507 lesson: the *foundation* checker enforces that a threat crossing may **not cite a finding absent from `finding-ownership.json`** — so when you resolve+delete a finding, scrub its ID from every crossing, and reference the finding's OUTCOME by clause/symbol, never re-introduce the dead `E<n>-F<nnn>` id. The citation regex is `/\b[A-Z][A-Z0-9]*-F\d+\b/`.)
2. **Cite by SYMBOL, re-measure at HEAD** before every edit — the register lags delivered code (this wave's dominant defect). Re-point citations via the git-diff-delta after editing any cited source; leave `was :NN` history alone; grandfathered citations must NOT be re-pointed.
3. **EOL: keep every register `w/lf`.** They are `i/lf w/lf` today; edit via python (`read → .replace("\r\n","\n") → write newline='\n'`) if the Edit tool would flip them, and verify `git ls-files --eol` → `w/lf`. A CRLF flip on a 326 KB register is a catastrophic diff.
4. **A conflict inside a `reason`/`deliveryEvidence` STRING is read by no guard** → resolve those hunks line-by-line by meaning, not by `git rerere` (rerere is trained on `finding-ownership.json` and a replayed stale resolution silently duplicates a key — always chain the JSON-parse to `git add` with `&&`).

## Serialization rules (obey exactly)

1. **You are register-only** — do NOT edit `job-leasing.ts` or any production `.ts`. If R1 had been A this would be the `job-leasing.ts` owner; it is B, so nobody edits it this round.
2. **You land register status-flips LAST.** Session 1 builds E9 code + hands you its finding-close deltas; you serialize them after your own guard-sink edits.
3. **NO migration** (you emit no schema).

## Per-item orchestration recipe

Same proven loop as Session 1: terrain-map workflow → **re-verify at HEAD yourself** → RED-first (for a register edit, the RED is the guard failing before the edit / the positive-control) → GREEN → **blind adversarial-review Workflow** (refute-by-default, Codex is quota-exhausted → blind lenses + skeptic-per-finding + adjudicator) → CI-green + self-review merge. **Re-run the register guards after EVERY edit** (a step-N green goes red at N+1 from a 1-line shift). Confirm a CI run exists for the pushed sha (`gh --jq`; `jq` not on PATH). Parallel PRs free; **merges serialize** — coordinate with Session 1.

## ★ Do-NOT-close guardrail

Same as Session 1: **do NOT flip `findings.md` status / delete a `finding-ownership.json` key for E9-F002, E7-F003, or any Unit F finding on buildable code alone** — each has a keyed-real-E2B conjunct in its close criterion. As custodian you are the last line of defence against a premature status-flip: reject any finding-close delta whose observed conjunct does not yet hold.
