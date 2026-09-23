# CLI-011 Result — the output mechanism is reviewed, probed and RULED: a conventional output root

**Status:** `gate_review`
**Date (UTC):** `2026-09-23`
**Epic:** `E7-coding-e2b`
**Plan task:** E7 `implementation-plan.md` `### CLI-011 — the emit half: DESIGN ONLY, founder-ruling
gated` · **Graph node:** `program-design.md` `#### CLI-011`
**Author:** M1 planning session (Claude Opus 5), under founder delegation **F2**
**Owns:** `E7-F026` — ★ **no longer.** Re-pointed to `CLI-017` by `E7-D11` in the same change (see §6).

The author leaves `Status` at `gate_review`. A **distinct reviewer** completes the review section and
is the only role that may change it to `complete`.

★ **This ticket is DESIGN-ONLY as to build, and this result changes no product code.** It records a
review, a measurement and a ruling. Everything buildable that follows is `CLI-017`.

---

## 1. What this ticket owed, and what it delivered

The task's Files list names four things in order. All four now exist.

| # | owed | delivered |
|---|---|---|
| 1 | the review document | [`CLI-011-review.md`](./CLI-011-review.md) — the writer census, the §6-constraint table, the positive-control table, the adversarial pass, the pins each option moves, and the `WRK-018` stdout channel priced as an input. Measured at `ba534b16b`. |
| 2 | the `files.read` probe, inside the F8 envelope | the **P-011** probe: apparatus in [`CLI-011-probe-apparatus-record.md`](./CLI-011-probe-apparatus-record.md), run and durable record in [`CLI-011-probe-record.md`](./CLI-011-probe-record.md) + [`CLI-011-probe-record.json`](./CLI-011-probe-record.json). |
| 3 | the ruling, recorded separately | **`E7-D11`** in [`../decisions.md`](../decisions.md) — ruling **F7**, under founder delegation F2. |
| 4 | this result | this file. |

**Outcome taken:** the task permits exactly two — *(i)* a surviving candidate mechanism, priced and
sized, or *(iii)* a recorded statement that neither is reachable. **This ticket returns (i).**

---

## 2. The evidence the ruling rests on

**Probe run:** [`35833717162`](https://github.com/MeteoriteLabs/AoA/actions/runs/35833717162), job
`probe`, conclusion `success`, head `499ec4d1c3c3aab7324dcf0ca98ea34872fe18a0`, template `aoa-base`
(resolved `explicit`), `armsMode: all`, output root `/home/user/aoa-output`.
**Record:** `cli-011-output-probe-record.json`, schema `aoa.cli-011.output-probe-record/1`, committed
verbatim (69,853 bytes, sha256
`db61e3b071c2557f62c976639c38ca1432d022da78a2a51aa0acf9d7fe7eb5c9`).
**Disposition:** `measured` — *"every arm observed and every control held"*.
**CLI under test:** `claude` **2.1.251 (Claude Code)** at `/usr/local/bin/claude`, identical on all
four model arms. ★ That version is now **pinned** in `e2b/e2b.Dockerfile`; see §4.

**Controls — the probe's own positive controls, all `held: true`:** `PC-1` (a planted file in `R` is
reported present), `PC-2` (with `R = /home/user` the staged paths are found under `R`), `C-census`
(the census sees a planted write under `R` and in cwd). A control that cannot go red is not a
control; these three assert the apparatus **would** have seen the thing whose absence the ruling
relies on.

**The five rows that fired,** against §10.5's table, which was written before the run:

| row | what it establishes |
|---|---|
| **R6** | `A-neg`: **nothing under `R` or cwd** — `filesUnderRoot=0`, `removedUnderRoot=0`, `filesCwdOther=[]`, `cwdMutations=[]`, CLI home state reported and **not counted** (5 paths, all under the record's declared `cliHomeStatePrefixes`). Constraint 6.7 holds for option 2. |
| **R7** | `A-dir` **and** `A-cwd` both wrote `R/hello.txt`; `helloElsewhere=[]`, `otherFilesUnderRoot=[]`, `rootCreatedDuringArm=true`. |
| **R4** | `S-P7` `noncePresent=true` — an env value written into `R` is read back out. |
| **R11** | `A-decl` carried a correct, **relative** declaration matching both the file written and the file requested. |
| **R2** | default-depth listing includes directories — confirms `CLI-010`'s files-only recursion requirement, already built and merged (`E7-D09`). |

**The rows that did NOT fire are the refutations that did not happen:** R1 (`R` not template-empty),
R3 (links neither exposed nor refusable), R5 (the CLI writes under `R`), R8/R9/R10 (one or no
compliant placement), R12 (any arm inconclusive).

---

## 3. The ruling, in one table

Recorded in full as **`E7-D11`**. Summarised here; the decision file is authoritative.

| question | ruled | the measurement it rests on |
|---|---|---|
| mechanism | **option 2, a conventional output root** `/home/user/aoa-output` | **R6** refutes the review's *decisive* attack `A-O2-3` — the CLI writes nothing under `R` when the model does not act, so a no-op run cannot produce a counted file; **R7** shows the agent does write its deliverable there when told |
| placement | **SD-1b**, the caller-side directive | it moves none of the 16 pins where SD-1a moves pins 1–2 and auto-fires a keyed lane; **R7** shows both comply, so the choice is free. ★ The review's caveat binds: that "none" is a **search result, not a proof**, so `CLI-017` **must** carry **PC-12** |
| SD-5 (export secret refusal) | **RULED IN, REQUIRED before `M1b`'s campaign** | **R4** |
| option 1b (agent declaration) | **feasible, deferred** to a post-`M1b` refinement | **R11**, plus `otherFilesUnderRoot=[]` on every model arm — there was nothing to select |
| `A-O2-8` (the agent writes elsewhere) | **accepted named residual** — it under-claims, the safe direction | not observed at the single-sample level; one sample is an existence proof, not a rate |
| the `+1 day` lstat contingency | **does not fire** — the SDK exposes `type`/`symlinkTarget` | **R3** did not fire. ★ But the *transport* discards them, so `CLI-012` must widen the seam; see §5 |

**Confidence.** The review put option 2 at "medium (≈60–65%)", naming two unmeasured facts as the
reason: what the CLI itself writes, and whether the agent complies. **Both are now measured** (R6,
R7), which is what moved this from a recommendation to a ruling.

---

## 4. What the ruling produced beyond the decision

| artefact | why |
|---|---|
| **`CLI-017`** filed — graph node, plan task, `tickets/CLI-017-design.md`, `M1b` required set | the emit build the `CLI-011` node deliberately left unnamed *"because what it builds depends on which mechanism is chosen"*. Split into `CLI-017-A` / `CLI-017-B` for the three-day cap; both required |
| **`e2b/e2b.Dockerfile` pins `@anthropic-ai/claude-code`** to the measured version | it was `npm install -g @anthropic-ai/claude-code`, unpinned, so a rebuild could silently falsify **R6** — the single measurement the whole ruling rests on |
| **an `A-neg` re-run authorized under F8**, before `M1b`'s campaign | `S-P0` alone proves only that `R` is empty *before* execution; it does not re-establish that the CLI writes nothing *there*. Pinning closes the accidental drift; the re-run closes the deliberate one |
| **`E7-F022` re-derived MEDIUM → HIGH** | on that finding's own standing instruction: *"re-derive this to HIGH the moment any candidate output mechanism becomes location-based"* |
| **`E7-F038` filed** (MEDIUM, open, `unowned`) | SD-5 is a literal-value refusal; encoded, reversed or split credentials still export. Named rather than implied |
| **`E5-F009` re-scoped** | its stated blocker is measured gone (`S-P6`: `files.list` already reports a correct size), and `CLI-012` is named as the closing ticket |

---

## 5. Contradictions found at source, and what happened to each

The review's §13 listed seven. This result records their disposition plus what the probe and the
review of this PR added.

| # | contradiction | disposition |
|---|---|---|
| 1 | §9.2's "unrun" probe had already run | recorded in the plan's `CLI-011` task (M1 corrections batch 1) |
| 2 | the plan's `CLI-010` Outcome described the mock, not the real `listDir` | **fixed** by `E7-D09`; `CLI-010` shipped, and **R2** confirms the real behaviour live |
| 3–4 | `E7-F026`'s drifted lines and stale pins 1+2 | re-measured; pins read `326` / `65_210` at HEAD |
| 5 | the F8 list omits two auto-fired keyed runs | **still open.** Recorded in the `CLI-017` task's Files note, which warns that editing `task-run-sandbox-invocation.ts` fires `keyed-e2b-unit-d.yml` on merge |
| 6 | `E7-D06` vs `WRK-018` | **closed** by the dated amendment to `E7-D06` |
| 7 | the plan's `CLI-011` Files list named artefacts this review is not | **fixed** in the plan |
| ★ new | `RealE2bTransport.listDir` returns `readonly string[]` — `filesOnlyFromListing` discards `symlinkTarget` — so the `A-O2-4` refusal is **unimplementable** from what `CLI-012` is given | **assigned to `CLI-012`**: widen the transport/port to carry a link marker and a size, with an **atomic** no-follow read rather than a check-then-read pair |
| ★ new | the review's **SD-6** says the grant's `maxBytes` should be the per-file cap | **SUPERSEDED by shipped behaviour.** `artifact-export.ts` sets `maxBytes: described.sizeBytes` — *"the EXACT size, not a ceiling"* — because a larger value only widens the read/orphan bound. The 25 MiB admission limit stays independent |

---

## 6. `E7-F026` — measured, then re-pointed

This ticket owned `E7-F026`. Writing a `-result.md` puts `CLI-011` in `findCompletedTicketIds`
(`/^([A-Z]+-\d+).*-result\.md$/`), and an open finding owned by shipped work is owned by nothing —
so the disposition had to be settled **before** this file could exist. It was measured, not assumed:

- **Not superseded by `E7-D11`.** `E7-F026`'s subject is **option 1**'s completeness/sizing claim
  ("appending a directive changes no existing test"), not option 4's fitness to carry the capability
  claim. The ruling does not touch it.
- **It still binds.** The ruled mechanism **is** an append that reaches the staged prompt bytes.
  `E7-D11` makes **PC-12** mandatory precisely because the "moves no pin" census was a search result,
  and it records as a stated behaviour change that the directive now counts against
  `MAX_STAGED_FILE_BYTES` — which is this finding's own under-counted fourth test, *"accepts a prompt
  exactly at the staging ceiling"*, arriving live.
- **It constrains the emit build, not the judge.** So it is re-pointed to **`CLI-017`** (not
  `CLI-015`), status **open**, with `ownerStillOpen` and a reason, in `scripts/finding-ownership.json`
  and in its `findings.md` Status line.

**Positive control, both directions.** `node scripts/check-finding-ownership.mjs` was run before the
change (green, `E7-F026 → CLI-011`); with a stub `CLI-011-result.md` present and the owner still
`CLI-011` it reports `owner_ticket_already_complete` **and** `successor_missing`; after the re-point
plus `tickets/CLI-017-design.md` it is green again with this result file in place. The guard is
therefore demonstrably live on this exact case, not merely quiet.

---

## 7. Evidence and verification

- **Full guard set green** before every push, including `check-finding-ownership`,
  `check-register-citation-integrity`, `check-register-id-uniqueness`, `check-ticket-graph-coverage`,
  `check-dependency-graph` and `check-evidence-immutability` against `origin/docs/replatform-program`.
- **No code, no test, no keyed dispatch** in the ruling change itself. The one product edit is the
  Dockerfile version pin (§4).
- **Reviewed revision:** to be recorded by the reviewer.

---

## 8. Reviewer section


### Reviewer section — completed

**Reviewer:** M1 review-batch-4 independent reviewer (Claude Opus 5) — distinct from the M1 planning session, which authored this ticket and ruled `E7-D11`. I authored neither.
**Reviewed revision (40-hex):** `99bff824d1c4fd641cea3b05ab7fe588f8255b96` (`origin/docs/replatform-program`). The probe head `499ec4d1c3c3aab7324dcf0ca98ea34872fe18a0` and the ruling commits `5709c8ff9`, `b65099512` and `68b676131` are all ancestors of it.
**Disposition:** `approved`
**Attempt:** 1

### Independent review — attempt 1

**Disposition: `approved`.** The ruling rests on a probe whose record I checked byte-for-byte, and
every row it cites reads the way the record says.

- **The probe run, at source.** Run
  [`35833717162`](https://github.com/MeteoriteLabs/AoA/actions/runs/35833717162), workflow *Keyed
  E2B — CLI-011 P-011 output probe*, **job `probe` `107092095372`, conclusion `success`**, head
  `499ec4d1c3c3aab7324dcf0ca98ea34872fe18a0` — matching the record and `E7-D11` exactly.
- **The committed record is byte-identical to what the record claims.**
  `tickets/CLI-011-probe-record.json` is **69,853 bytes**, sha256
  `db61e3b071c2557f62c976639c38ca1432d022da78a2a51aa0acf9d7fe7eb5c9` — I recomputed both. Its
  `schema` is `aoa.cli-011.output-probe-record/1`, `commitSha` and `workflowRunUrl` match the run,
  `template` is `{"resolved":"aoa-base","source":"explicit"}`, `armsMode` is `all`, `outputRoot` is
  `/home/user/aoa-output`.
- **`disposition: measured`, and the three controls held.** The record's `disposition` object is
  `{disposition: "measured", detail: "every arm observed and every control held"}`, and `controls` is
  exactly `PC-1`, `PC-2`, `C-census`, each `held: true` with the expectation wording the result and
  `E7-D11` quote.
- **The fired/non-fired rows, read from the record rather than from the prose.** The
  `decisionTable` array's `fired` flags are, in order R1…R12:
  `false, true, false, true, false, true, true, false, false, false, true, false` — i.e. **R2, R4,
  R6, R7, R11 fired and nothing else**, which is precisely the five the result names and precisely
  the seven it calls "refutations that did not happen". Spot-checked the two load-bearing entries:
  R6's `because` is *"filesUnderRoot=0 removedUnderRoot=0 filesCwdOther=[] cwdMutations=[]
  (cli-home-state, reported not counted: 5)"* with reading *"6.7 holds for option 2"*; R7's is
  *"A-dir=true A-cwd=true"* with reading *"both placements viable; choose by pin cost: SD-1b
  recommended"*. §2 and §3 read them correctly, and the "5 paths, all under the record's declared
  `cliHomeStatePrefixes`" claim is the record's own `because` string, not an inference.
- **The CLI version, and the pin.** `2.1.251 (Claude Code)` appears in **four** version fields of the
  record — one per model arm — with `/usr/local/bin/claude` four times and no other version string.
  `e2b/e2b.Dockerfile` now reads
  `RUN npm install -g @anthropic-ai/claude-code@2.1.251 @openai/codex`, and the file keeps the old
  unpinned line quoted in a comment as the record of what it said. So the pin **is** at the version
  the probe measured. I also checked that this edit fires no keyed workflow: no workflow carries a
  `paths` trigger on `e2b/**` or `e2b.Dockerfile`.
- **`E7-F026` was re-pointed, not silently resolved — and I reproduced the control.** In
  `scripts/finding-ownership.json` the key is `status: "owned"`, `ticket: "CLI-017"`, with an
  `ownerStillOpen` naming PC-12 and the `MAX_STAGED_FILE_BYTES` invariant as the open substance, and
  every PRIOR REASON retained. `findings.md`'s Status line reads **open**, Owner **`CLI-017`**, with
  the superseded owner quoted. `tickets/CLI-017-design.md` exists. Reproduced both directions:
  `node scripts/check-finding-ownership.mjs` is **green** at the reviewed revision, and with the
  owner reverted to `CLI-011` it reds with *"E7-F026 (CLI-011): owned by a ticket that has SHIPPED
  but names no `successor`"*. Reverted; the tree was clean afterwards.
- **`E7-F039` says what it is asked to say.** Status open, Owner `CLI-012`, Severity MEDIUM. It
  states the `lstat` TOCTOU residual, names **`SD-5` (`E7-D11` §3)** as the bound with the explicit
  warning *"IF SD-5 IS EVER DESCOPED OR WEAKENED, THIS RESIDUAL IS NO LONGER BOUNDED"*, and it carries
  the acceptance line verbatim: *"A swap that produces a STORED artifact containing the planted
  canary is a **FAIL** of `CLI-012`, not a residual"*, with the two acceptable outcomes enumerated
  and the closure route marked **UNVERIFIED** rather than asserted.
- **`E7-D11` matches the evidence it is decided on.** The decision is `locked`, decided under F2,
  cites the same run/job/head and the same three controls, rests option 2 on R6 and R7, makes
  **PC-12 mandatory** because the "moves no pin" census was a search result, records the
  `MAX_STAGED_FILE_BYTES` consequence as a stated behaviour change, rules SD-5 IN on R4, and names
  SD-5's own open residual (a literal-value refusal does not close encoded exfiltration) rather than
  letting it pass as closed.
- **Outcome and Files.** The task permits (i) or (iii); this returns **(i)**, and all four owed
  artefacts exist on disk: `CLI-011-review.md`, the probe apparatus + record (`.md`, `.json`),
  `E7-D11`, and this result.
- **Guards.** The full `pr.yml` pure-node guard set is **0 failures** at the reviewed revision, plus
  `check-evidence-immutability --base origin/docs/replatform-program`, and
  `check-finding-ownership` specifically (above).
- **★ One finding, not blocking — the Dockerfile pin is a product edit against a stated non-goal.**
  The task's **Ticket non-goals** read *"**any product change.** No literal in
  `task-run-sandbox-invocation.ts`, no argv, **no template**, no test edit."* `e2b/e2b.Dockerfile`
  **is** the template definition, so pinning the CLI there is a change the ticket told itself not to
  make. §4 and §7 disclose the edit and give a strong reason (unpinned, a rebuild silently falsifies
  R6, the single measurement the ruling rests on), and the change is conservative — it pins to the
  version already running and triggers no keyed workflow. What is missing is only the reconciliation:
  the deviation is not recorded **as** a deviation from the non-goal, and the plan's non-goal is not
  amended. Recorded here rather than held against the disposition; the fix is a dated amendment on
  the plan's non-goal line naming `E7-D11` as its authority.
- **Not blocking, noted.** §4 also authorizes *"an `A-neg` re-run under F8, before `M1b`'s
  campaign"*. That is an obligation on `M1b`, not an unmet acceptance item here, and I read it that
  way.

**What remains open after this approval:** `E7-F026` (now `CLI-017`), `E7-F038`, `E7-F039` (now
`CLI-012`), the §5 contradiction 5 (the F8 list omits two auto-fired keyed runs), and the authorized
`A-neg` re-run before `M1b`'s campaign. `CLI-017` must carry **PC-12**; a `CLI-017` without it does
not satisfy `E7-D11`.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-4 independent reviewer (Claude Opus 5) | `99bff824d1c4fd641cea3b05ab7fe588f8255b96` | `approved` | Probe run `35833717162`, job `probe` `107092095372`, success, head `499ec4d1c`. Committed record recomputed: **69,853 bytes, sha256 `db61e3b0…7eb5c9`**, `disposition: measured`, PC-1/PC-2/C-census all `held: true`. `decisionTable` fired flags give exactly R2, R4, R6, R7, R11 — the five named — and R6/R7's `because` strings match §2 verbatim. CLI `2.1.251 (Claude Code)` on all four arms; `e2b/e2b.Dockerfile` pins `@anthropic-ai/claude-code@2.1.251`, and no workflow triggers on that path. `E7-F026` re-pointed to `CLI-017` (open), control reproduced both ways: green at HEAD, reds *"owned by a ticket that has SHIPPED but names no successor"* when reverted to `CLI-011`. `E7-F039` carries the TOCTOU residual, the SD-5 bound with its descope warning, and the planted-canary FAIL clause. **Finding (non-blocking): the `e2b.Dockerfile` pin is a product/template edit against the task's own "no template" non-goal, disclosed as an edit but not reconciled as a deviation.** |
<!-- Later reviewers append attempt 2 below without replacing this row. -->
