# DEP-025 — Closing clause 5's two flip preconditions: the suppressed arm per stream, and both arms' attempt status — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (E5 exit-gate clause 5) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-25`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `993fd82d63` (`origin/docs/replatform-program`)
**PR:** #608, base `docs/replatform-program`

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.

---

## 0. What this ticket is, and what it is NOT

`DEP-024` (PR #607) wired clause 5's floor onto the keyed lane and **handed up two Codex round-3
findings unfixed**. Its reasoning for doing so is preserved here because it was correct, and because a
reader who does not have it will misread this ticket as a bug fix on a live gate:

> They are **flip preconditions, not merge blockers.** The case is declared `pending`, and
> `faultMatrix` folds this phase's row into the graded bundle **only** while the declaration says
> `required`. So the driver cannot contribute evidence to any graded bundle until the planning
> session **both** flips that field and dispatches the keyed run. **There is no window in which these
> two holes can produce a false pass.**

That remains true at this revision, and it is why both were safely left standing. This ticket closes
them so the flip is safe, and **does not flip anything**. §5 is the flip judgement, and it is *no*.

Nothing here is a decision.

---

## 1. Finding (a) — the suppressed arm must refuse a marker on EITHER stream INDIVIDUALLY

### 1.1 The actual shape, established at source before fixing

`DEP-024` §5.5(a) described this as "a regression MY OWN round-2 fix introduced", and reading the code
confirms it exactly. In `scripts/lib/m1a-redaction-probe.mjs`:

- `classifyRedactionObservation` computes
  `injectionFired = o.markerOnEvents === true && o.markerOnLogs === true`. That conjunction is round
  2's fix, and it is right *for the graded arm*, whose requirement is "the marker must appear on BOTH
  declared streams".
- `evaluateRedactionProbeEvidence`'s suppressed branch then read that same field as
  `if (suppressed.injectionFired !== false)`. The suppressed arm's requirement is the **opposite
  polarity**: *any* marker bearing this arm's own nonce is a violation, because the plant was
  withheld.

`true && false === false`. So a withheld-plant arm observing its own nonce-tagged marker on exactly
**one** stream produced `injectionFired === false`, raised nothing, and the phase could pass — while
that marker already proves something other than this case's injection can generate the evidence, which
is the entire property the suppressed arm exists to exclude.

★ **The fix that created the hole is the pattern `E.1(a)` exists for, and so is mine.** Round 2's fix
was sound in the direction it was reasoning about and opened a hole in the polarity it was not. So
before writing anything I stated the class and swept it (§3), including my own new code, rather than
patching the one line Codex pointed at.

### 1.2 The fix

The suppressed branch now iterates the **declared** streams — not this module's own constant, so a
declaration drift cannot route around it — and requires each stream's own observation to be explicitly
`false`:

- `scrubberMarkerObservedOnStream[stream] === true` ⇒ a violation naming **which** stream.
- anything else that is not `false` (absent, `null`, a non-boolean) ⇒ a violation too. **Fail-closed on
  missing input** (self-audit family 8): an unreported stream is refused, never read as clean.

`if (suppressed.injectionFired !== false)` is **kept below** as a backstop for a row whose
`injectionFired` was computed some other way. It is no longer the thing that decides.

### 1.3 ★ THE TWIN, fixed in the same commit

`summary.suppressedUnfired` was `suppressed.injectionFired === false` — **the identical collapse**, and
it is not cosmetic: `redactionProbeMatrixRow` sets
`positiveControlPassed: detail?.suppressedUnfired === true`. So on the very observation the new loop
refuses, the matrix row would still have reported a **passing positive control**. It is now the
conjunction of `injectionFired === false` **and** every declared stream's own `=== false`.

A known twin left behind is worse than the original defect: the next reader sees a fixed neighbour and
assumes the family is handled.

### 1.4 The mutation red

| Mutation | Result |
|---|---|
| Remove the per-stream loop entirely | `22 tests / 19 pass / 3 fail` — the two new per-stream controls **and** the stale-marker test's new suppressed half |
| Collapse `summary.suppressedUnfired` back to the AND (**the twin alone**) | `22 tests / 20 pass / 2 fail` |

Both reverted; the file is byte-identical to the committed version afterwards (`git diff --stat` empty
against the index).

★ **It reds for the right reason**, which is the question a control-path fix has to answer. The RED run
*before* the fix failed with **`<no violations>`** — not with a wrong message, not with a near-miss
assertion: **the judge raised nothing at all** on these shapes. That is the hole, reported by the test
rather than described by me.

---

## 2. Finding (b) — BOTH arms must require `attemptStatus === "succeeded"`

### 2.1 Verified at source, and the harness itself names the class

`grep -n attemptStatus scripts/m1-shipped-boot/redaction.mjs` returned one log line and three `detail`
fields and **no predicate**, exactly as `DEP-024` §5.5(b) reported. A suppressed job that reached a
durable `failed` **after** `attempt_started` therefore had a non-empty event stream and no markers, and
satisfied every suppressed check — including the one whose whole job is non-vacuity (*"its own event
stream is empty, so `no marker` is indistinguishable from `never ran`"*). **Non-vacuity claimed from a
failed setup.**

★ And the harness states the contract it was relying on. `awaitSpineWorkerDrivenTerminal`
(`tests/d1/lib/e6f-harness.mjs`) documents that it returns the final observation either way because
*"a timeout is judged by the verdict (as `attempt_not_succeeded`), never swallowed here"* — it
**delegates the assertion to its caller**, and this caller was not making it. The finding is not a
matter of taste; it is a broken half of a documented division of labour.

### 2.2 The fix, and why it is in the PURE module

`REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS = "succeeded"`, asserted by `evaluateRedactionProbeEvidence`
through **one** helper (`requireArmSucceeded`) applied to both arms, so the two cannot drift apart —
the asymmetry that produced finding (a) in the first place. `classifyRedactionObservation` carries the
status onto the row, normalised to `null` when absent so the absence is **refused**, not defaulted to
something passing.

It is placed in the pure judge deliberately: `scripts/m1-shipped-boot/redaction.mjs` needs a live
stack, a real sandbox and a keyed envelope, so an assertion written there could not be given a
mutation-proven control at all. In the judge it has one.

### 2.3 The mutation red

| Mutation | Result |
|---|---|
| Remove both `requireArmSucceeded` calls | `22 tests / 20 pass / 2 fail` — the per-arm × per-status control, and the named `failed`-after-`attempt_started` shape |

Reverted. Again the pre-fix RED was `<no violations>`.

---

## 3. THE CLASS SWEEP, in both directions (`E`, `E.1`)

### 3.1 Finding (b)'s class

**THE CLASS, in one sentence:** *an attempt's terminal status read into a record or a log for
reporting, but never asserted, so a FAILED SETUP satisfies a control whose only non-vacuity
requirement is a non-empty stream.*

**THE DUAL (`E.1b`), searched and reported:** *a status asserted on the GRADED arm only, leaving the
SETUP arm unasserted.* That dual is why the fix covers **both** arms rather than the graded one —
finding (b) as Codex stated it is really about the suppressed arm, and fixing only that half would have
left the mirror standing.

**Enumeration, quoted not remembered:**
`grep -n "attemptStatus\|attempt_status" -r scripts/ tests/d1/ --include=*.mjs` → **7 consuming sites**
(excluding fixtures in `scripts/lib/__tests__/m1-spine-assertions.test.mjs`, which are inputs to the
asserting evaluator, not consumers):

| Site | Disposition |
|---|---|
| `m1-spine-assertions.mjs` `evaluateEnabledTenantSpine` | asserts (`journey:attempt_not_succeeded`) |
| `m1-spine-assertions.mjs` worker-driven evaluator | asserts (`worker_driven:attempt_not_succeeded`) |
| `m1-fault-matrix.test.mjs` per-tenant journey case | asserted via `evaluateEnabledTenantSpine` + `assert.deepEqual(violations, [])` |
| `m1-fault-matrix.test.mjs` `d1.provider.worker_terminal_mapping` | asserts `controlMapped` **unconditionally** and `mappedByWorker` when unsuppressed |
| `m1-fault-matrix.test.mjs` timeout/control pair | asserts both statuses explicitly |
| `m1-spine.test.mjs` (4 reads) | all feed the asserting evaluators above |
| **`m1-fault-matrix.test.mjs` `d1.redaction.planted_canary_scrubbed`** | **THE TWIN — unasserted. Fixed here.** |
| **`m1-shipped-boot/redaction.mjs` (both arms)** | **the reported site. Fixed here.** |

**7 checked, 2 in the class, 2 fixed.**

★ **The D1 twin is fixed on the pattern its own neighbour already sets.**
`d1.provider.worker_terminal_mapping` asserts its control arm **unconditionally**, in both the graded
and the suppressed campaign — because suppression changes only `workloadArgs`, never whether the seeded
job runs. The new assertion is placed the same way, after `record` so the row carries the observation
that refuses.

### 3.2 Finding (a)'s class

**THE CLASS:** *a per-stream requirement enforced through the AND-collapsed `injectionFired` instead of
over each stream's own observation, in the polarity where "ANY marker is a violation" — where the
collapse is permissive rather than merely imprecise.*

**THE DUAL:** *an OR-collapse (or an any-stream disjunction) standing where a conjunction is needed, so
"every stream must fire" passes on one.* **Searched: 0 found.** The only disjunction in this surface is
`markedProbeLine`'s `.some()` over LINES of one stream, which is correct — any line carrying the tag,
the marker and the nonce suffices — and the two streams are read by two separate calls, never OR'd.

**Enumeration:** `grep -rn "injectionFired" scripts/ tests/d1/lib/ --include=*.mjs` → **4 collapse
sites** in `m1a-redaction-probe.mjs`:

| Site | Polarity | Disposition |
|---|---|---|
| suppressed `injectionFired !== false` | permissive | **fixed** (per stream) |
| `summary.suppressedUnfired` → `positiveControlPassed` | permissive | **fixed** (the twin) |
| graded `injectionFired !== true` | sound — an AND checked for `true` catches any `false` | unchanged |
| `redactedOnAllStreams !== true` (both arms) | sound — same shape over three cleanliness booleans | unchanged |

**4 checked, 2 permissive, 2 fixed.** The other `injectionFired` sites in the repo
(`cross-tenant.mjs`, `campaign-fault-matrix.mjs`, `d2m-cross-tenant.mjs`, `journey.mjs`) are **not** in
the class: each is a single observation, not a per-stream conjunction. Checked by reading each, not
assumed.

### 3.3 ★ My own diff is in the class (`E.1a`)

The first place I looked after writing each class sentence. Two things came out of it:

1. the per-stream loop's **fail-closed** arm exists because of (b)'s "absent input must refuse" reading
   applied to (a)'s new code — an `observed !== false` branch I would not have written if I had only
   flipped the one condition Codex named;
2. the new `requireArmSucceeded` is a **single helper called twice** rather than two inline checks,
   precisely because finding (a) is what an asymmetry between two arms costs.

### 3.4 ★★★ A member of `DEP-024`'s OWN shared-surface class that its count missed — filed as `E6-F033`

`DEP-024` §5.3 named the class *"a predicate over a SHARED, APPEND-ONLY surface that is scoped by when
it was read rather than by something in the data"* and reported **"2 shared-surface reads checked, 1
positional, 1 fixed"**. That count is over the reads **inside its own diff**. The **D1 twin of the same
case** is outside it and was never counted, and it has the defect:

- `tests/d1/m1-fault-matrix.test.mjs`'s `markedProbeLine` requires tag + `REDACTION_MARKER` on one
  line, with **no per-run token**, over `composeServiceLogs("worker-b")` — the whole container log. The
  canary cannot serve as the token: the scrubber has replaced it with the marker, so it is exactly the
  value the line no longer contains.
- **And the stale line is not hypothetical — measured at source.** In
  `.github/workflows/d1-merge-train.yml` the `m1-fault-matrix` job brings the stack up **once**, runs
  the graded profile, then runs the suppressed control **against that same stack**, tearing down only
  afterwards. So the suppressed invocation reads the graded invocation's tagged+marked line **every
  run**: `markerOnLogs === true` with `markerOnEvents === false`.

**Not fixed here, with the reason** (`E` rule 4): every available fix reaches outside the harness — a
unique token in the reference provider's echo (a product change), or a per-invocation log boundary,
which is positional again and which `DEP-024` §5.3 rejected on the merits. Filed as **`E6-F033`**,
`unowned` (both `DEP-023` and `DEP-024` stand at `gate_review`, so neither is a shipped ticket that
could be named a successor — `E4-F013`), MEDIUM rather than HIGH because it produces no false pass
today, and **for a reason nothing enforces**: the graded invocation is simply the first on a fresh
stack.

★ It also **blocks a port**: (a)'s per-stream suppressed discipline cannot be carried to D1 while this
stands, because it would red on the stale line rather than on a defect. That is worth knowing before
someone tries.

---

## 4. Record rot fixed in passing

`scripts/m1-shipped-boot/redaction.mjs`'s inline comment above the two arm calls still read
*"SUPPRESSED FIRST — see the header: it is what makes the graded arm's log evidence attributable."*
That is the **positional argument Codex round 2 falsified**, and the file's own header already says so
twenty lines above. The code moved and the comment did not. Corrected, with what it used to claim kept
in the correction rather than deleted.

`detailFacts` also gained `suppressedMarkerOnEvents` / `suppressedMarkerOnLogs`, so a keyed refusal
names **which** stream carried the withheld arm's marker. The AND-collapsed `suppressedFired` beside
them cannot distinguish "neither" from "exactly one", and "exactly one" is the shape that used to pass.

---

## 5. THE FLIP JUDGEMENT — the case stays `pending`/`keyed`

**It may not flip, and my fixes are not an argument that it may.** Four reasons, each checkable:

1. **The declaration's own contract requires the injection to have FIRED.**
   `evaluateFaultMatrixEvidence` (`scripts/lib/campaign-fault-matrix.mjs`) raises
   `evidence:injection_did_not_fire` for any row whose `injectionFired !== true`. Firing requires the
   scrubber's marker on both streams of a real run — i.e. a real E2B sandbox echoing the redeemed
   value.
2. **This case can only fire on the keyed lane, and no keyed run exists.** `journey.mjs`'s `redaction`
   phase refuses outright in `keyless` (the adapter-manager is never started, so no sandbox exists).
   **Not one line of `scripts/m1-shipped-boot/redaction.mjs` has ever executed anywhere.** Its coverage
   is the pure judge's controls plus an argued-from-source chain — which is `DEP-024`'s honest position
   and still is.
3. **A stricter judge cannot justify a flip.** Everything this ticket added is a new way for the phase
   to REFUSE. That can only make a future keyed run more likely to red, never more likely to be
   believed.
4. **Flipping would fold an unexercised phase's row into a graded bundle** on the next keyed run —
   declaring coverage nobody measured, which is the failure class this matrix exists to stop.

So the honest outcome is the expected one: **preconditions closed, case still `pending` /
`pendingKind: keyed`, with the owed run named.** The declaration's `pendingReason` is superseded in
place to say so, with `DEP-024`'s text kept verbatim under `$supersededPendingReason_DEP024`.

### 5.1 The owed keyed run, and EXACTLY what each red shape decides

**ONE keyed `m1-shipped-boot` dispatch, `mode: keyed`, on a candidate that is an ancestor of
`docs/replatform-program` carrying this commit.** Ruling F8 reserves it to the planning session; this
ticket was forbidden from dispatching one and did not.

`DEP-024` §9.1's five red shapes stand unchanged. **Five are added or sharpened by this ticket**, and
they are in the declaration's `pendingReason` as well as here, so the next reader finds them where they
are already looking:

| Red | What it decides |
|---|---|
| `graded arm: the seeded job's attempt terminated "failed", not "succeeded"` | the graded arm's setup broke: the seeded handle does not materialise as `ANTHROPIC_API_KEY` in a real sandbox, or `sh` is not on the `aoa-canary-e2b` template. Previously diagnosable only indirectly, as "a failed terminal with no events" |
| `suppressed arm: the seeded job's attempt terminated …` | the same, on the withheld arm — and that arm's "no marker" therefore says nothing about suppression |
| `suppressed arm: the scrubber's marker was observed on stream "events"` | a marker carrying **this arm's own nonce** appeared on the event stream while the plant was withheld ⇒ the marker is not produced by this case's injection, and the case proves nothing. The nonce makes a stale line impossible by construction, so this means the withheld arm planted something, or the nonce reached another producer |
| `suppressed arm: … on stream "logs"` | the same, on the container log — the arm that was **structurally blind** to a log marker until `DEP-024` round 2 and **permissively blind** to a one-stream marker until this ticket |
| `suppressed arm: stream "X" reported no marker observation (null)` | the driver did not report that stream at all: a wiring fault, refused rather than read as clean |

None of these is "flaky", and each names a different fact.

---

## 6. Demonstrated vs argued — the honest split

| Claim | Status |
|---|---|
| The judge refuses a suppressed marker on EITHER stream individually | **Demonstrated** (local, mutation-proven; `<no violations>` before) |
| `summary.suppressedUnfired` / `positiveControlPassed` no longer pass on that shape | **Demonstrated** (local, its own mutation) |
| The judge refuses either arm whose attempt did not reach `succeeded`, incl. an absent status | **Demonstrated** (local, mutation-proven, 4 statuses × 2 arms) |
| The owning `pr.yml` step's eight suites still pass with the stricter judge | **Demonstrated** — `261 tests / 261 pass / 0 fail`, run locally |
| The full guard set + `check-evidence-immutability --base origin/docs/replatform-program` are green | **Demonstrated** — `failures: 0` |
| The register deltas are exactly mine, two-sided against the merge ref | **Demonstrated** — §7 |
| The D1 twin's new assertion HOLDS on a live stack (the D1 attempt does reach `succeeded`) | **Demonstrated** by the free `d1-merge-train` run in §8 |
| The D1 twin's new assertion would RED if the attempt did not succeed | **Argued** — the identical predicate, mutation-proven in the pure judge. A live red needs a broken D1 attempt, which I cannot manufacture |
| `E6-F033`: the D1 suppressed control reads a stale marked line every run | **Argued from source**, and the load-bearing link was READ rather than inferred (`d1-merge-train.yml`: one bring-up, two invocations, teardown last) |
| The probe line actually appears on both streams of a REAL E2B run | **NOT demonstrated**, and not claimed. This is the owed keyed run (§5.1) — unchanged from `DEP-024` |
| These two holes could not have produced a false pass while the case was `pending` | **Argued from source**, and it is `DEP-024`'s argument, re-checked: `faultMatrix` folds the row only on `evidence === "required"` |

★ **What I did NOT dispatch, and why.** `m1-shipped-boot` in `mode: keyless` is free and was the
obvious reach. It would have proved **nothing about this branch**: that workflow's `actions/checkout`
uses `ref: ${{ inputs.candidate }}`, and the candidate must be an ancestor of
`docs/replatform-program`, which this branch is not — so the workspace would be the old tree. And the
`redaction` phase does not run in `keyless` at all, so even a correct checkout could not exercise the
code this ticket changes. Reading such a run as verification is `E6-F031`, and a run that cannot
distinguish my change from its absence is not a hypothesis test (`E.3.2`).

---

## 7. Register deltas (two-sided, against the MERGE REF)

Taken against the fetched `origin/docs/replatform-program`, printing **both** directions
(`E.2`/`E.2.1`) — a rewrite that loses an entry shows up only here:

```
scripts/finding-ownership.json
  ADDED  : ['E6-F033']
  DROPPED: []
  CHANGED: []
  base 102 keys, head 103

tests/d1/fault-matrix.json          (flattened to (profile, case, key) triples)
  ADDED  : [('M1a-D2-MECHANISM', 'd2m.redaction.planted_canary_scrubbed',
             '$supersededPendingReason_DEP024')]
  DROPPED: []
  CHANGED: [('M1a-D2-MECHANISM', 'd2m.redaction.planted_canary_scrubbed', 'pendingReason')]
  base 642 keys, head 643 · top-level key set identical · profile list identical
```

Both files were edited as **deltas on the parsed document**, after asserting that a
`json.dumps(indent=2, ensure_ascii=False)` round-trip of the base is byte-identical (it is, for both).
`evidence`, `pendingKind`, `pendingOwner`, `injection`, `redactionCase` and `expectedClassification`
are **unchanged**, asserted in the edit script rather than eyeballed. `gate-clause-wiring.json`,
`distributed-execution-threat-controls.json`, `test-execution-census.json` and `test-inventory.json`
were **not touched**: no test file was added or removed, and no register-cited symbol moved.
`check-register-citation-integrity` is green.

★ Adding `E6-F033` flips `findings.md` **and** adds the ownership key **in the same commit**, which is
the direction `E.2` rule 5 requires for an ADDED finding.

---

## 8. The free run that DOES test this branch

`d1-merge-train` checks out the dispatched ref, so this branch's code runs — unlike `m1-shipped-boot`,
whose `candidate` input would not.

**HYPOTHESIS:** the D1 redaction case's seeded job DOES reach a durable `succeeded` terminal, so the
new unconditional assertion (§3.1) holds in both the graded profile and the suppressed control, and the
lane's verdicts are unchanged.

- **If right:** `m1-fault-matrix` green, the live step executing its full case count with the redaction
  case among the passes, and the suppressed-injection control still red.
- **If wrong:** the live step reds on **exactly** my new assertion —
  `the seeded job's attempt must reach a durable succeeded terminal` — naming the observed status. That
  would be a REAL finding rather than a broken test: it would mean the D1 twin, a `required` case, has
  been accepting its stream evidence from a non-succeeded attempt all along. The D1 half would then be
  reverted and filed, and the shipped-boot half kept.

### 8.1 The run

**Run `36118426821`, `d1-merge-train` / `m1-fault-matrix`, dispatched on
`claude/m1-d2m-flip-preconditions` (head `970b3c49d1`).** IN FLIGHT at the time this section was first
committed; its verdict is recorded below by job and step, with executed counts, before this ticket
leaves `gate_review`. **No claim in §6 rests on it except the one row that names it.**

---

## 9. Codex round 1 — ONE finding, real, and it was MY OWN diff in finding (b)'s class

**P2 — `propagate failed attempts into the retained evidence row`
(`scripts/lib/m1a-redaction-probe.mjs`, `redactionProbeMatrixRow`).** **Real**, verified at source
before acceptance, and it is the more interesting of anything on this PR because **the class it belongs
to is the one this ticket was written to close.**

What I had done: asserted the attempt status in the judge, and left the ROW exactly as it was. Codex
measured the consequence, and every link of it holds:

1. `journey.mjs`'s `redaction` phase **deliberately** retains
   `cases: observations?.rows ?? error?.rows ?? []`, with the comment saying why — *"a phase that only
   wrote evidence when it passed would leave a failure with nothing to read"*. So a run refused for a
   non-succeeded attempt **still writes a row** to `redaction-observations.json`.
2. `redactionProbeMatrixRow` derived `injectionFired`, `observedClassification` and
   `positiveControlPassed` from the markers and `suppressedUnfired` alone. A graded arm that emitted
   both markers and then failed produced a **fully pass-shaped row**; a suppressed arm that failed with
   no markers produced `suppressedUnfired: true` ⇒ `positiveControlPassed: true`.
3. `faultMatrix` reads that file and folds the row **without re-running this judge**, and
   `evaluateFaultMatrixEvidence` inspects `injectionFired`, the classification, `redactedOnAllStreams`,
   the stream bytes and `positiveControlPassed` — and **nothing about an attempt status**.
4. So the retained artifact **contradicted the refusal that produced it**, and a later standalone
   `fault-matrix` invocation could not detect the failed setup from the artifact alone.

★ **That is finding (b) again, one layer out.** Finding (b) was *"a status read and never asserted"*; my
fix asserted it **in one process** and left the durable record a different consumer grades unchanged.
`E.1(a)` says the first place to look for a class is the code you just wrote, and I looked at the
judge and not at the row. The class is now stated in the code: *a fact asserted in one process, while
the DURABLE record it retains stays pass-shaped for a different consumer that grades it later.*

**The fix.** The row now carries `gradedAttemptStatus` and `suppressedAttemptStatus` **at top level**
(not only inside `detail`, so a consumer need not know this module's detail shape), and degrades every
field that would otherwise read as a pass: `injectionFired` requires the graded arm to have succeeded,
`observedClassification` becomes `graded_arm_attempt_<status>` and so can never equal the declared
token, and `positiveControlPassed` requires the **suppressed** arm to have succeeded too. Both status
reads are **fail-closed**: absent ⇒ `null` ⇒ not succeeded.

★ **One field is deliberately left RAW, and the reason is not laziness.** `redactedOnAllStreams` keeps
the observation. Forcing it to `false` would make the bundle assert a **leak** — a claim the run does
not support, and whose stated remedy in this very module is *"the surface must be reverted rather than
debugged"*. A false leak report is a worse defect than the one being fixed. `injectionFired` going
false is what stops the row passing, and the classification names the real cause.

### 9.1 The sibling check for this class

**Enumeration:** the phases that throw an error carrying rows which `journey.mjs` persists are
`cross-tenant.mjs` and `redaction.mjs` — **2 sites checked**.

`cross-tenant.mjs` is **not** in the class, and this was read rather than assumed: its verdict is
`unfired = rows.filter((r) => r.injectionFired !== true)`, `notDenied` filtered on
`observedClassification`, `noControl` on `positiveControlPassed` — **every refusal condition is derived
from a row field**, so a row it retains on a refusal cannot be pass-shaped by construction. The
redaction phase was the only one whose verdict consulted a fact the row did not carry.

**2 checked, 1 in the class, 1 fixed.** And the same question asked of the redaction phase's *other*
refusals: vacuity and zero bytes ride on `streamBytesObserved` (which clause 5 grades), a missing
suppressed arm lands as `positiveControlPassed: false`, and the stream-drift refusal is read from the
same declaration the matrix reads. The attempt status was the one gap.

### 9.2 Mutations

| Mutation | Red |
|---|---|
| Undo the row's `injectionFired` / classification degradation | `26 tests / 23 pass / 3 fail` |
| Undo the `positiveControlPassed` suppressed-status conjunct | `26 tests / 24 pass / 2 fail` |

Both reverted. Pre-fix RED was `actual: true, expected: false` on all four new controls — the row
really was pass-shaped.

### 9.3 One test's expectation changed, and it is an improvement rather than an accommodation

`a row built from a MISSING graded arm cannot claim a pass` asserted
`observedClassification === "no_scrubber_marker_observed"`; it is now `graded_arm_attempt_null`. A
missing arm has no attempt status **and never read a stream**, so naming the scan would describe
something that did not happen. The old expectation is recorded in a comment beside the new one rather
than silently replaced.

---

## 10. Codex round 2 — ONE finding, real, and it is THE SWEEP I OWED AND DID NOT DO

**P2 — `make the retained D1 row fail with its attempt`
(`tests/d1/m1-fault-matrix.test.mjs`).** **Real**, verified at source before acceptance.

It is the **same class as round 1**, on the twin I had just edited. I fixed
`redactionProbeMatrixRow` one round earlier and **did not look at the D1 row I had added an assertion
to in the same PR.** `E` rule 3 exists for exactly this: *a known twin left behind is worse than the
original, because the next reader sees a fixed neighbour and assumes the family is handled.* Round 1
should have swept it; it did not, and a reviewer found it instead. Recorded as a miss, not as a
discovery.

**Verified at source, every link:**

1. `after(() => { … writeFileSync(… "m1-fault-matrix-evidence.json" …) })` writes the bundle
   **whether or not a test threw**.
2. `record()` is called **before** my new assertion, and `evaluateFaultMatrixEvidence` grades
   `bundle.cases` and **never** `bundle.detail` — where the status sat.
3. So a run whose output was observed on both streams but whose attempt later ended `failed` left a
   **fully pass-shaped row** behind the assertion that rejected it, and the retained artifact could be
   graded as a pass independently of the test.

★ **And the naive fix would have been INERT, which reading `record` is what caught.** That helper
copies a **fixed set of fields** and silently drops anything else — a hazard its own comment records
(Codex P1 on PR #593). Passing `attemptStatus` to `record` without threading it would have dropped it
on the way into the bundle, leaving the grader exactly as blind while the diff looked like a fix. So
`attemptStatus` is threaded through `record` as a **row** field, and the case degrades its own
`injectionFired` and `observedClassification` using the same token the shipped-boot lane emits
(`graded_arm_attempt_<status>`), so the two lanes cannot drift apart.

`redactedOnAllStreams` is left **raw** here for the same reason as §9: forcing it false would make the
bundle assert a leak the run does not support.

### 10.1 The class, swept

**THE CLASS:** *a fact asserted AFTER the row was written, which the row does not carry, in a bundle a
different consumer grades later.*
**THE DUAL:** *a fact carried on the row that nothing asserts* — which is finding (b) itself, the other
end of the same stick. Both ends are now closed on both lanes.

**Enumeration:** this PR added exactly **2** attempt-status assertions (the shipped-boot judge and the
D1 case). **2 in the class, 2 fixed.** Asked of the pre-existing D1 cases as well, by reading rather
than by memory: `d1.provider.worker_terminal_mapping` asserts `controlMapped`/`mappedByWorker`, both of
which its row carries (`positiveControlPassed`, and its `observedClassification` encodes both statuses);
the timeout/control pair's asserted statuses are encoded in its own classification. **No pre-existing
case asserts a fact its row lacks.**

### 10.2 The round cap is now reached

**Two Codex fix rounds taken, which is this programme's hard cap** (`C`). Both findings were real, both
verified at source before acceptance, both fixed at source, and both were in the class this ticket was
written to close — which is itself worth reporting rather than smoothing over. A review is requested on
the final head because the gate requires one, but **I will not take a third fix round**: anything raised
now goes to the planning session with my verification at source and a proposed fix, for it to rule on.
