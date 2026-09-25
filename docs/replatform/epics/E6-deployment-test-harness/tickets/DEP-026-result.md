# DEP-026 — Grading the withheld-plant arm: closing clause 5's THIRD flip precondition — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (E5 exit-gate clause 5) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-25`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `ca1d9a2e65ee463f211e84e38f2da9ce7b5491f4` (`origin/docs/replatform-program`)
**PR:** base `docs/replatform-program`

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.

---

## 0. What this ticket is

`DEP-025` (PR #608) closed clause 5's first two flip preconditions and **handed up a third**, honouring
the two-round Codex cap exactly as `DEP-024` had one ticket earlier on this same driver. Its §11 named
the residual, verified it at source, gave two candidate fixes, and recommended the local one while
flagging that the general one **reds a green `required` case**.

This ticket takes the **GENERAL** fix (`DEP-025` §11 option **B**) and **does not narrow it to keep that
case green**. §2 is the judgement about the D1 case that the general fix forces, made at source. §7 is
the flip judgement, and it is still *no*.

Nothing here flips anything, and nothing here dispatches a keyed run.

---

## 1. The defect, re-measured at this revision before touching anything

`grep -n "positiveControlPassed" scripts/lib/campaign-fault-matrix.mjs` returns **exactly two** read
sites, unchanged from `DEP-025`'s reading:

- `if (c.family === "credential" && isPlainObject(c.credentialCase) && row.positiveControlPassed !== true)`
- `if (t && (t.kind === "cross_tenant_denial" || t.kind === "legacy_table_isolation"))`

The `if (c.family === "redaction")` branch never read it. `d2m.redaction.planted_canary_scrubbed` is
declared `family: "redaction"` with a `redactionCase` and **no** `tenantCase`, so neither site applied.

Consequence, stated precisely: when the graded arm succeeded and the **suppressed** arm terminated
non-`succeeded` or carried its own nonce-tagged marker on a stream, `DEP-025` §1/§2's fixes cleared
`positiveControlPassed` — and nothing graded it. Every field the redaction branch *did* read stayed
pass-shaped, so a **standalone verdict over the retained row reported no violations while the run itself
reded.** The phase still refused, so a normal end-to-end keyed run went red; what did not hold is that
**the retained artifact alone was gradeable.**

★ That is `E6-F023` in artifact form — *"a green run conclusion does NOT mean its tests passed"*, with
the bundle in the role of the run conclusion. The retained bundle exists precisely so a reader can grade
it independently of the run that produced it, which is why this was worth fixing generally rather than
narrowing.

**A second row-field fact, measured while confirming the first:** the grader reads exactly seven row
fields (`grep -no "row\.[A-Za-z]*"` → `case`, `injectionFired`, `observedClassification`,
`positiveControlPassed`, `redactedOnAllStreams`, `scrubberMarkerObservedOnStream`,
`streamBytesObserved`, `antiVacuityObservedForeignRow`). `attemptStatus` is **not** among them — see §4.2,
where it is swept and dispositioned rather than fixed.

---

## 2. ★★★ THE D1 JUDGEMENT — which of (a)/(b)/(c) holds, with the evidence

The general fix's cost, as `DEP-025` §11.3 measured it, is that requiring `positiveControlPassed`
unconditionally on the redaction family **reds `d1.redaction.planted_canary_scrubbed`**, which is
`required` and currently passing. The brief's question is which of three things is true, and it must be
answered at source rather than avoided by narrowing the guard.

**The answer is a SPLIT, and the honest statement of it is `(a)` for the `events` stream and `(c)` for
the `logs` stream.** Every link below was read, not inferred (`E.3.1`).

| Link | Measured |
|---|---|
| Does the D1 row report a suppressed arm? | **No.** `record("d1.redaction.planted_canary_scrubbed", {…})` (`tests/d1/m1-fault-matrix.test.mjs`) passes no `positiveControlPassed` key, and `record` sets the field only `if (positiveControlPassed !== undefined)` |
| Could it, as written? | **No.** `SUPPRESS_INJECTION = process.env.AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION === "1"`, read ONCE at module load, so an invocation is entirely graded or entirely suppressed. The suppression is a whole separate campaign, not an in-run second arm |
| Is the campaign-scoped substitute case-scoped? | ★ **No, and this is new.** `.github/workflows/d1-merge-train.yml`'s `POSITIVE CONTROL — with every injection suppressed` step asserts the run reds and then `grep -F 'injection_did_not_fire'` over its output. **Any** of the profile's 25 cases satisfies that grep. Nothing anywhere ties *this* case's marker observation to *this* case's plant |
| Could an in-run arm's **`events`** half be built? | ★ **YES — so this half is a real gap, `(a)`.** `queryJobEventPayloadText({ jobId })` (`tests/d1/lib/e6f-harness.mjs`) is `SELECT … FROM job_events WHERE job_id = $jobId`, strictly per-job. A second seeded job with `workloadArgs: []` would read only its own stream |
| Could its **`logs`** half? | **NO — structural, `(c)`.** `composeServiceLogs("worker-b")` shells `docker compose logs --no-color --tail 5000 worker-b`: the whole service log, no job scoping. And the probe log line carries no per-run token — `createUsageObserver` (`packages/worker-daemon/src/supervisor/usage-observer.ts`) emits `logger.info({ probeLine: line }, RUN_OUTPUT_PROBE_LOG_MESSAGE)` with no `jobId`, `attemptId` or `runId`, and the line's own text is `AOA-RUN-OUTPUT-PROBE ANTHROPIC_API_KEY=<marker>`, identical across runs. That is `E6-F033` |

### 2.1 So what was built, and why it is not a narrowing

The guard **requires the field for cases that can supply it**, and D1's exemption is **declared,
justified, and itself checked** — not the guard failing to look:

`redactionCase.suppressedArm` says **where the withheld-plant control lives**, read by ONE helper,
`classifyRedactionSuppressedArm`, shared by the declaration half and the evidence half so the two cannot
drift apart — which is the asymmetry that produced `DEP-025` finding (a) in the first place.

| Declared | Graded as |
|---|---|
| `{scope: "in_run"}` | `row.positiveControlPassed === true` is **REQUIRED** (`evidence:redaction_positive_control_missing`) |
| `{scope: "none", blockedBy: [ids…], reason: "…"}` | the **narrow exemption**. Both halves are required and checked for CONTENT, not presence: an empty array, a non-array, an empty id and a whitespace reason all red (`…_exemption_unjustified`) |
| absent, or any other shape | ★ **REFUSED** (`evidence:redaction_suppressed_arm_undeclared`). This is the load-bearing part: a guard that quietly skips a case it cannot grade is the same defect one level out |

**`d2m` declares `in_run`**, which its driver already satisfies: `redactionProbeMatrixRow` sets
`positiveControlPassed` from the conjunction of the suppressed arm's `succeeded` terminal and its
per-declared-stream marker-absence, both added by `DEP-025`. **So after the flip the retained artifact
alone is gradeable on BOTH arms** — the property rounds 1–3 were reaching for and none of them reached.

**`d1` declares the `none` exemption, naming `E6-F033` and the new `E6-F034`**, with the per-stream chain
above recorded in its `reason` field rather than only here.

**Why the exemption is whole-case rather than per-stream** — and this is the measured reason, not a
preference: `redactionCase.streams` names TWO streams while `positiveControlPassed` is ONE boolean. So
reporting an events-only arm through it would flatten a per-stream requirement into a scalar **in the
permissive direction** — which is exactly `DEP-025` finding (a), the defect this surface has spent three
review rounds unwinding. Building the sound half while the field cannot express that it is only half
trades one silent hole for another. The `events` gap is therefore **filed, with an owner and a closure
condition** (`E6-F034`), rather than half-built or absorbed silently into the exemption.

★ **`d2c.redaction.planted_canary_scrubbed` is deliberately left without the field.** It is `pending`
and **no producer anywhere in the repo writes a `d2c.redaction.*` row** (`grep -rn "d2c\." --include=*.mjs
scripts/ tests/` finds only the declaration and one harness comment), so it cannot honestly answer the
question. `declaration:redaction_suppressed_arm_missing` fires only on a `required` case, which makes
answering it a **mechanical precondition of that case's flip** rather than prose nobody re-reads.
Well-formedness is required either way, so no case can park a broken shape behind `pending` (§3, control 6).

---

## 3. RED, GREEN, and the mutation table

### 3.1 The RED, and its shape

Six controls written first (a seventh was added later by self-audit — §4.5), run against the unfixed
grader:

**`38 tests / 32 pass / 6 fail`.**

★ **Every one of the six failed with the judge raising NOTHING** — the assertion messages print the
violation-code list, and it was empty in each: `false must red: `, `scope "campaign" must red: `,
`{"scope":"none"} must red: `. That is the same shape `DEP-025` recorded (`<no violations>`), and it is
the point: this was never a wrong message or a near-miss, it was a branch that did not look.

### 3.2 GREEN

**`41 tests / 41 pass / 0 fail`** on `scripts/check-campaign-fault-matrix.test.mjs` — `38/38/0` at the first
push, `39/39/0` after §4.5 and §4.7, `41/41/0` after Codex round 1 (§12).

The owning `pr.yml` step (`Campaign fault matrix declaration (DEP-018)`) runs
`node scripts/check-campaign-fault-matrix.mjs` **and** that suite; both are green, the guard reporting
`3 gate profile(s) and 83 case(s) (46 required, 37 pending)`. Run with the two neighbouring pure suites
(`m1a-redaction-probe`, `m1-spine-assertions`): **`194 tests / 194 pass / 0 fail`**.

### 3.3 The mutation table — each behaviour removed, the red shown, reverted

Run by a script that asserts the baseline is green first, asserts each mutation reds, and asserts the
tree returns to its baseline afterwards (it did: `38/38/0`, and `git diff --stat` against the index shows
only the committed change).

| Mutation | Red |
|---|---|
| **M1** remove the evidence-half grade entirely (the reported defect) | `38 / 34 / 4` — all four evidence controls |
| **M2** keep the grade but stop FAILING CLOSED on an absent/unknown declaration | `38 / 34 / 4` — both refusal controls **and** both declaration controls |
| **M3** let a bare `{scope:"none"}` exemption through | `38 / 36 / 2` |
| **M4** remove the DECLARATION half's presence requirement (the second source, `E.2.1`) | `38 / 37 / 1` |
| **M5** accept the row field as TRUTHY rather than strictly `true` | `38 / 37 / 1` |
| **M6** (§4.5) name a PHANTOM blocker id in the committed declaration's exemption — `blockedBy: ["E6-F033", "E6-F901"]` | `39 / 38 / 1`, with the exact message `d1.redaction.planted_canary_scrubbed: suppressedArm.blockedBy names E6-F901, which no epic's findings.md declares` |
| **M7** (§4.7) remove the STALE-EXEMPTION refusal (the dual) | `39 / 38 / 1` |

All seven reverted. M6 mutated `tests/d1/fault-matrix.json` itself and was restored byte-identically
(asserted in the script, not eyeballed). The M1–M5 counts were measured against the six-control
tree; M6 and M7 were added afterwards by self-audit (§4.5, §4.7) and are measured against the
seven-control tree, which is why their totals are `39`. Stated rather than silently re-normalised.

**M5 is the fail-closed row**: it is what makes `undefined`/`null` a refusal rather
than a pass, and the control that catches it iterates `[false, null, undefined]` rather than asserting
one value.

---

## 4. THE CLASS SWEEP, in both directions (`E`, `E.1`)

**THE CLASS, in one sentence:** *a durable row field that a probe CLEARS on a control-arm failure, which
no consumer of that row grades — so the artifact alone passes while the run reds.*

**THE DUAL (`E.1b`), searched and reported:** *a row field the grader GRADES that no producer SETS* —
which fails the other way, making a case permanently red or its grade vacuous.

★ **A SECOND dual, found by turning the sentence on my own new branch** (`E.1a`+`E.1b` together): *a
case declaring it CANNOT report the arm whose row reports one* — an exemption that outlived its reason.
My first pass missed it. Fixed in §4.7.

### 4.1 Enumeration, quoted not remembered

`grep -no "row\.[A-Za-z]*" scripts/lib/campaign-fault-matrix.mjs | sort -u` → the grader reads **8** row
keys. Cross-referenced against what the two row builders emit (`redactionProbeMatrixRow`'s object
literal, and `record()`'s destructured parameter list in `tests/d1/m1-fault-matrix.test.mjs`):

| Row field | Grader reads | Disposition |
|---|---|---|
| `injectionFired` | 2 sites | graded |
| `observedClassification` | 2 | graded |
| `positiveControlPassed` | 2 → **6** | **THE REPORTED SITE — fixed here for the redaction family** |
| `redactedOnAllStreams` | 2 | graded |
| `scrubberMarkerObservedOnStream` | 1 | graded, per declared stream |
| `streamBytesObserved` | 1 | graded, per declared stream |
| `antiVacuityObservedForeignRow` | 2 | graded |
| **`attemptStatus`** | **0** | **in the class SHAPE, and NOT a hole — see §4.2** |
| `note` | 0 | not in the class: informational, no control clears it and nothing is proven by it |

**9 row fields checked, 2 in the class shape, 1 was a hole, 1 fixed.**

### 4.2 ★ `attemptStatus` — the shape without the hole, stated rather than "fixed"

`DEP-025` put `attemptStatus` on the row with the explicit comment *"Carried as a ROW field, because
`detail` does not reach the grader"* — and the grader **never reads it** (`grep -c attemptStatus
scripts/lib/campaign-fault-matrix.mjs` → `0`). That is the reported defect's own shape, in the diff of
the ticket that reported it (`E.1a`: you are the most recent author of the defect you are describing).

**It is nonetheless NOT a hole, and it would be dishonest to claim a fix for it.** The fact it encodes is
graded **twice over** through fields the grader does read: `DEP-025` ANDs `attemptSucceeded` into
`injectionFired`, and degrades `observedClassification` to
`redactionAttemptFailureClassification(attemptStatus)` on a non-`succeeded` terminal. So a failed attempt
already reds the retained row as `evidence:injection_did_not_fire` **and**
`evidence:classification_mismatch`. Grading the raw status a third time would couple the generic grader
to a redaction-specific required constant for no additional refusal. **Recorded, not fixed, and not filed
— because there is no defect, only a field that is belt where two braces already hold.**

### 4.3 The dual, searched

For every `required` case in the committed declaration, which grader-read fields does its declaration
oblige, and does a producer set them?

- `positiveControlPassed`: **15** obliged in `M1-D1-SPINE` (14 in `M1a-D2-MECHANISM`), all from
  `tenantCase`/`credentialCase`, all set by `cross-tenant.mjs` / `m1-fault-matrix.test.mjs` producers.
- `antiVacuityObservedForeignRow`: **4** per profile, all set.
- `suppressedArm`: **exactly 1** required redaction case exists across all three profiles, and it is the
  exempted `d1`. **So the blast radius of this change on the required set is one case, and it is the case
  the judgement in §2 is about.** No case is obliged to supply a field no producer sets — **0 found in
  the dual.**

### 4.4 ★ My own diff is in the class (`E.1a`)

The first place I looked after writing the class sentence. Two things came out of it:

1. the **fail-closed `unknown_scope` arm** exists because the class sentence applies to my own new field:
   an absent `suppressedArm` would have been a declaration the grader clears and nothing grades — the
   defect rebuilt one level up. M2's four reds are that arm's proof.
2. `classifyRedactionSuppressedArm` is **one helper called by both halves** rather than two inline checks,
   for the same reason `DEP-025` made `requireArmSucceeded` one helper: an asymmetry between two readers
   of the same fact is what finding (a) cost.

### 4.5 ★ A phantom blocker id would have been an unchecked exemption — found in my own diff, fixed here

The self-audit's family 8 (*fail-closed on missing input*) pointed at my own new field.
`classifyRedactionSuppressedArm` checks that `blockedBy` is a non-empty array of non-empty strings, which
answers *"is what I wrote well-formed?"* and **not** *"does the thing it names exist?"* — `E.2.1`'s exact
distinction. A typo, or an id invented to satisfy the shape, would have passed every check in §2.1 while
the exemption pointed at nothing. **An exemption naming a phantom finding is an unchecked exemption**, and
the whole argument for taking the general fix is that a declared exemption is checkable.

So a seventh control cross-references every declared `blockedBy` id against a **second source**: the
`## <ID>` headings of every `docs/replatform/epics/*/findings.md`. Two non-vacuity assertions come first —
the heading scan must find ≥ 50 ids (so a moved layout or a broken regex reds rather than passing
vacuously), and at least one exemption must declare a blocker (so an exemption-free matrix does not make
the loop evaluate nothing). M6 is its mutation.

★★★ **SUPERSEDED BY §12.1 — and the superseded reasoning is kept here rather than rewritten.** This
paragraph said: *"`findings.md` and NOT `scripts/finding-ownership.json`, deliberately. Closing a finding
DELETES its register key (`E.2` rule 5), and an exemption may legitimately name a blocker that has since
been closed — so the register would red on a correct declaration. The prose heading survives closure; the
register key does not."* **That was backwards.** Closing the blocker is PRECISELY what must invalidate the
exemption — the D1 case's own `reason` says *"Closing both means deleting this exemption and declaring
`scope: "in_run"`."* I had optimised the check to survive its blockers' closure, when failing on closure is
the entire point. Codex round 1 caught it; §12.1 has the measurement that settles it and the fix, which
requires each id to be a CURRENTLY OPEN registered finding and keeps the heading set only for the
existence half. The control now lives in the PRODUCTION path as well (§12.2), which was the second half of
the same round.

### 4.7 ★ THE DUAL of my own fix — an exemption that OUTLIVED its reason

`E.1b` says a class has a dual and your grep will miss it. Mine did, on the first pass: I wrote a check
that can **fail wrongly is impossible** and did not ask what can **pass wrongly** on the other side of
the same branch.

**THE DUAL:** *a case declaring `scope: "none"` whose ROW nonetheless reports `positiveControlPassed`.*
That means the driver GREW the arm and nobody deleted the exemption — so the field the grader would have
required is present and **deliberately ungraded**, which is the original defect restored by a stale
declaration rather than by a missing branch.

★ **And the file already sets the precedent**, which is how I knew this was in-pattern rather than
invented: `evidence:pending_case_reported` refuses a `pending` case that DID produce evidence, on the
stated reasoning that *"inheriting the pass would be exactly the silent drift this matrix exists to
stop."* This is that shape with the polarity flipped, so it is spelled the same way —
`evidence:redaction_suppressed_arm_exemption_stale`, telling the reader to **flip the declaration to
`in_run`** rather than to delete the row field.

Its control asserts the red on `positiveControlPassed: true` **and** on `false`: the *presence* of the
field is the drift, not its value — an exempt case has no business reporting either. `M7` is its mutation.

### 4.6 `E6-F033` — checked, and it does **NOT** close

**It does not, and my change does not touch it.** `E6-F033` is about the D1 **graded** arm's `logs`
attribution being positional — `markedProbeLine` carrying no per-run token over a shared append-only
container log. My change adds no assertion to that arm and removes none. What changed is that `E6-F033`
is now **cited by a machine-checked declaration** rather than only by prose: `d1`'s
`suppressedArm.blockedBy` names it, and `classifyRedactionSuppressedArm` reds the exemption if that array
is emptied. It stays `open` / `unowned`, and it is now **the first step of `E6-F034`'s closure condition**,
because the `logs` half cannot be soundly read until it is fixed.

---

## 5. `E6-F034` — filed, with the prose and the register key in the SAME commit

**`E6-F034` — the D1 redaction case has NO case-scoped withheld-plant control, and its `events` half is
buildable and unbuilt.** `unowned`, MEDIUM.

`unowned` because `DEP-023` authored the case and `DEP-024`/`DEP-025` the shipped-boot sibling, and all
three stand at `gate_review` rather than `complete`, so none is a shipped ticket that could be named a
successor (`E4-F013`). MEDIUM because it cannot produce a false denial and does not produce a false pass
today — every graded assertion on the case stands and the campaign-scoped control does red the lane; what
is missing is the **attribution** of that redness to this case.

Per `E.2` rule 5, adding a finding flips `findings.md` **and** adds the ownership key in one commit, which
is what the filing script does (it refuses to run if either is already present).

---

## 6. Register deltas (two-sided, against the MERGE REF)

Taken against the fetched `origin/docs/replatform-program`, printing **both** directions (`E.2`/`E.2.1`) —
a rewrite that loses an entry shows up only here. Both files were edited as **deltas on the parsed
document**, after asserting that a `json.dumps(indent=2, ensure_ascii=False)` round-trip of the base is
byte-identical (it is, for both), so a whole-file write could not reformat an unrelated key.

```
scripts/finding-ownership.json
  ADDED  : ['E6-F034']
  DROPPED: []
  CHANGED: []
  base 103 keys, head 104

tests/d1/fault-matrix.json      (flattened to (profile, case, key) triples, redactionCase included)
  ADDED  : [('M1-D1-SPINE',      'd1.redaction.planted_canary_scrubbed',  'redactionCase.suppressedArm'),
            ('M1a-D2-MECHANISM', 'd2m.redaction.planted_canary_scrubbed', '$supersededPendingReason_DEP025'),
            ('M1a-D2-MECHANISM', 'd2m.redaction.planted_canary_scrubbed', 'redactionCase.suppressedArm')]
  DROPPED: []
  CHANGED: [('M1-D1-SPINE',      'd1.redaction.planted_canary_scrubbed',  'redactionCase'),
            ('M1a-D2-MECHANISM', 'd2m.redaction.planted_canary_scrubbed', 'pendingReason'),
            ('M1a-D2-MECHANISM', 'd2m.redaction.planted_canary_scrubbed', 'redactionCase')]
  base 655 keys, head 658 · top-level key set identical · profile list identical
```

Asserted in the edit and check scripts rather than eyeballed: `d2m`'s
`$supersededPendingReason_DEP025` is **byte-identical to the base's `pendingReason`** (never rewrite
history in a quote), and `evidence`, `pendingKind`, `pendingOwner`, `injection`,
`expectedClassification` are unchanged on `d2m`; `evidence`, `injection`, `expectedClassification`,
`$pendingResolvedBy`, and `redactionCase`'s `plantedCanary` / `scrubberMarkerControl` / `streams` /
`producer` are unchanged on `d1`. The two `redactionCase` CHANGED rows are the containers of the two
ADDED `suppressedArm` keys, not separate edits.

`gate-clause-wiring.json`, `distributed-execution-threat-controls.json`, `test-execution-census.json`
and `test-inventory.json` were **not touched**: no test file was added or removed, and no register-cited
symbol moved. `check-register-citation-integrity` is green.

---

## 7. THE FLIP JUDGEMENT — the case stays `pending`/`keyed`

**It may not flip, and closing the third precondition is not an argument that it may.** `DEP-025` §5's
four reasons stand verbatim and were re-checked at this revision:

1. `evaluateFaultMatrixEvidence` still raises `evidence:injection_did_not_fire` for any row whose
   `injectionFired !== true`, and firing requires the scrubber's marker on both streams of a real run.
2. The case can only fire on the keyed lane, and **not one line of `scripts/m1-shipped-boot/redaction.mjs`
   has executed anywhere.** `journey.mjs`'s `redaction` phase refuses outright in `keyless`.
3. A stricter judge cannot justify a flip. Everything added here is a new way to REFUSE.
4. Flipping would fold an unexercised phase's row into a graded bundle.

The declaration's `pendingReason` is superseded in place to record the third closure, with `DEP-025`'s
text kept verbatim under `$supersededPendingReason_DEP025`.

### 7.1 The owed keyed run, and whether its red shapes are still accurate

**ONE keyed `m1-shipped-boot` dispatch, `mode: keyed`, on a candidate that is an ancestor of
`docs/replatform-program` carrying this commit.** Ruling F8 reserves it to the planning session; this
ticket was forbidden from dispatching one and did not.

**`DEP-024` §9.1's five shapes and `DEP-025` §5.1's five stand UNCHANGED, and this was checked rather
than assumed:** this ticket adds no phase-level assertion and removes none, so every refusal raised
inside `scripts/m1-shipped-boot/redaction.mjs` and `evaluateRedactionProbeEvidence` is byte-for-byte the
one `DEP-025` recorded. The diff touches the grader, the grader's self-test, the declaration and two
records — nothing the phase executes.

**Two shapes are ADDED, both on the RETAINED BUNDLE's standalone verdict rather than inside the phase:**

| Red | What it decides |
|---|---|
| `evidence:redaction_positive_control_missing` | the withheld-plant arm did not pass — its attempt did not reach `succeeded`, or it carried the scrubber's marker on either declared stream. These are exactly the shapes `DEP-025` §1/§2 already refuse inside the phase, so **the artifact and the run now agree instead of disagreeing**; a reader grading the retained bundle in isolation reaches the verdict the run reached |
| `evidence:redaction_suppressed_arm_undeclared` | structural: a future editor removed `d2m`'s `suppressedArm` rather than answering it. Refused, never read as "no arm needed" |

Neither can produce a false pass while the field says `pending`, because `faultMatrix` folds the row into
the graded bundle only on `required` — `DEP-024`'s argument, re-checked and still true.

---

## 8. The free run that DOES test this branch

`d1-merge-train` checks out the dispatched ref, so this branch's code runs — unlike `m1-shipped-boot`,
whose `actions/checkout` uses `ref: ${{ inputs.candidate }}` and whose candidate must be an ancestor of
`docs/replatform-program`, which this branch is not (`E6-F031`).

**HYPOTHESIS:** `d1.redaction.planted_canary_scrubbed`'s declared `none` exemption is well-formed at
run time, so the live lane's matrix verdict over the retained bundle is UNCHANGED — the case passes
without supplying `positiveControlPassed`, and the stricter grader adds no red.

- **If right:** `m1-fault-matrix` green, the static preflight and live steps executing their full case
  counts, and the suppressed control still red.
- **If wrong:** the matrix's own verdict step reds on **exactly** `evidence:redaction_positive_control_missing`
  or `evidence:redaction_suppressed_arm_undeclared` on that case — which would mean the exemption I
  declared is not the one the live row needs, and the declaration would be corrected rather than the
  guard loosened.

### 8.1 The run — HYPOTHESIS CONFIRMED

**Run `36134477276`, `d1-merge-train` / `m1-fault-matrix`, head `7fc569c8b4`. Run conclusion `success`.**
Cited by job and step with executed counts, not by run id alone. The checkout is asserted from the log
itself rather than assumed: `git checkout … -B claude/m1-redaction-positive-control` at
`7fc569c8b4c114433cb13ec21b5c87dfaa824ada`, so **this branch's code ran**.

| Step | Executed | Result |
|---|---|---|
| Static preflight (the declaration, its reds, the compose invariants) | `tests 38 / pass 38 / fail 0` | **success** |
| **Run the M1-D1-SPINE fault matrix (live)** | `tests 25 / pass 25 / fail 0` | **success** |
| The matrix's own verdict over the retained bundle | — | **success** |
| POSITIVE CONTROL — with every injection suppressed, the matrix MUST go red | — | **success** (i.e. it went red, as required) |

★ **The step that matters is the third**, not the second: *"The matrix's own verdict over the retained
bundle"* is the standalone `evaluateFaultMatrixEvidence` pass over the recorded rows, and it is where a
wrong exemption would have surfaced. It is green, so `d1.redaction.planted_canary_scrubbed` passes the
stricter grader **without supplying `positiveControlPassed`** — which is precisely what the declared
exemption is for, judged by the production verdict rather than by my reading of it.

★ **And the static preflight runs THIS SUITE** (`node --test scripts/check-campaign-fault-matrix.test.mjs`,
read from the workflow rather than assumed), so the `38` above is this ticket's own control count at that
head — the D1 lane re-checks the declaration half independently of `pr.yml`.

### 8.2 A SECOND free run, on the FINAL head, so the round-1 fix is demonstrated and not argued

Run `36134477276` was dispatched on `7fc569c8b4`, which **predates** the blocker cross-reference (§12).
That fix touches two things the D1 lane executes — the static preflight's suite, and the driver's own
module-load declaration block, which now calls `evaluateRedactionExemptionBlockers` with the real
loader — so the earlier run cannot speak for it, and saying otherwise would be `E6-F031` in miniature.

**Run `36138531579`, same lane, head `e5cbb0c8cf`.**

**HYPOTHESIS:** the committed exemption's two blockers are open registered findings at this head, so the
new production cross-reference is silent, the static preflight's suite reports `41` controls rather than
`38`, and every verdict is unchanged from §8.1.

- **If right:** the preflight green at `41/41/0`, the live matrix still `25/25/0`, the retained-bundle
  verdict green, and the suppressed control still red.
- **If wrong:** the preflight or the driver reds on `declaration:redaction_exemption_blocker_not_open` /
  `…_undeclared` / `…_unverifiable`. On the committed tree that would mean `E6-F033` or `E6-F034` is not
  actually an open register key where the lane reads it — a real record defect, not a broken test, and it
  would be fixed in the register rather than by loosening the check.

#### 8.2.1 The second run — HYPOTHESIS CONFIRMED, including the count prediction

**Run `36138531579`, `d1-merge-train` / `m1-fault-matrix`, head
`e5cbb0c8cf3b611ce63d8967f8387b4a8c807bb6` (asserted from the job log, not from the dispatch). Run
conclusion `success`, and **all sixteen steps `success`** — not merely the run's conclusion, which on this
programme's advisory lanes is not the same thing (`E6-F023`).**

| Step | Executed | Result |
|---|---|---|
| Static preflight (the declaration, its reds, the compose invariants) | `tests 41 / pass 41 / fail 0` | **success** |
| Run the M1-D1-SPINE fault matrix (live) | `tests 25 / pass 25 / fail 0` | **success** |
| The matrix's own verdict over the retained bundle | — | **success** |
| POSITIVE CONTROL — with every injection suppressed, the matrix MUST go red | — | **success** (it went red, as required) |
| Collect / upload the retained evidence, tear down | — | **success** |

★ **The count prediction is the part that makes this a test rather than a re-run.** §8.2 predicted the
preflight would report `41` rather than §8.1's `38`, because that step runs
`node --test scripts/check-campaign-fault-matrix.test.mjs` and this head carries nine new controls. It
reports `41`. So the lane demonstrably executed **this** head's suite, and a stale-checkout reading of the
result (`E6-F031`) is excluded by the evidence rather than by my assurance.

★ **And the failing prediction did not fire:** `grep -c redaction_exemption_blocker` over the whole job log
is **`0`**. No `…_not_open`, no `…_undeclared`, no `…_unverifiable` — so `E6-F033` and `E6-F034` are open
register keys where the lane reads them, the new production cross-reference is silent on the committed
tree, and the guard CLI (`node scripts/check-campaign-fault-matrix.mjs`, also in that preflight step) exits
0 with it wired in.

**So §12's fix is DEMONSTRATED on the live lane, not argued.** Both halves of it: the suite at `41`, and
the guard CLI that `m1-shipped-boot.yml`'s keyed artifact-verdict step will run.

---

## 9. Demonstrated vs argued — the honest split

| Claim | Status |
|---|---|
| The grader's redaction branch now grades the withheld-plant arm | **Demonstrated** (local, mutation-proven; the pre-fix RED raised nothing at all) |
| An absent or unrecognised `suppressedArm` is REFUSED, not skipped | **Demonstrated** (M2's four reds; controls over `["campaign", "", null, 1]` and a deleted key) |
| A bare or half-filled `none` exemption reds on both halves of the matrix | **Demonstrated** (M3; seven malformed shapes) |
| The row field is required STRICTLY `true`, so `null`/`undefined` refuse | **Demonstrated** (M5; the control iterates `[false, null, undefined]`) |
| The declaration half is a genuine SECOND source, not a restatement | **Demonstrated** (M4 reds the declaration control alone, with the evidence half intact) |
| A declared exemption cannot name a PHANTOM finding | **Demonstrated** (M6, and M10 through the guard CLI) |
| A declared exemption cannot name a RESOLVED finding, so closing the blocker FORCES the flip | **Demonstrated** (§12.1; M9 and M10; `E9-F003` asserted declared-but-not-open first, so the control is not vacuous) |
| The blocker cross-reference runs in the PRODUCTION path, not only in the self-test | **Demonstrated** (§12.2; M8 reds the anti-orphan control, M10 exits 1 from the guard CLI the keyed lane actually runs) |
| No OTHER production file validates the declaration without the cross-reference | **Demonstrated** — an enumeration, not a memory: the anti-orphan control walks four directories for `evaluateFaultMatrixDeclaration(` and asserts set EQUALITY with the three known callers |
| An exemption that OUTLIVED its reason is refused (the dual) | **Demonstrated** (§4.7; M7; the control reds on a reported `true` and a reported `false`) |
| The D1 row reports no suppressed arm | **Demonstrated at source** — `record(…)` passes no such key |
| The D1 `events` half IS buildable — so this is `(a)`, a real gap, not impossibility | **Argued from source, and the load-bearing link was READ**: `queryJobEventPayloadText`'s SQL is `WHERE job_id = $jobId`. NOT built here, and filed as `E6-F034` |
| The D1 `logs` half is NOT buildable — so that half is `(c)` | **Argued from source, three links read**: the whole-service `docker compose logs`, the tokenless `logger.info({ probeLine }, …)`, and the constant line text |
| The D1 lane's campaign-scoped control is not case-scoped | **Demonstrated at source** — the workflow step's `grep -F 'injection_did_not_fire'` is satisfied by any case |
| `attemptStatus` is in the class shape but is NOT a hole | **Argued from source**, and deliberately not claimed as a fix: the fact is graded via `injectionFired` and `observedClassification` |
| `E6-F033` closes | ★ **FALSE, and not claimed.** Untouched; now machine-cited by the exemption rather than only by prose |
| The owning `pr.yml` step's suites pass with the stricter judge | **Demonstrated** — `41/41/0`, and `194/194/0` with the two neighbouring pure suites |
| The full guard set + `check-evidence-immutability --base origin/docs/replatform-program` are green | **Demonstrated** — `failures: 0`, `75 base records` all byte-identical |
| The register deltas are exactly mine, two-sided against the merge ref | **Demonstrated** — §6 |
| The live D1 lane accepts the declared exemption, judged by the PRODUCTION verdict | **Demonstrated on a live stack** — free `d1-merge-train` run `36134477276` on head `7fc569c8b4`: static preflight `38/38/0`, live matrix `25/25/0`, *"The matrix's own verdict over the retained bundle"* **green**, suppressed control still red. Checkout asserted from the log (§8.1) |
| The same holds WITH the round-1 blocker cross-reference | **Demonstrated on a live stack** — free run `36138531579` on the FINAL head `e5cbb0c8cf`, ALL SIXTEEN STEPS `success`: preflight `41/41/0` (the predicted move from `38`, which is what proves the lane ran THIS head's suite rather than a stale checkout), live matrix `25/25/0`, retained-bundle verdict green, suppressed control red, and `grep -c redaction_exemption_blocker` over the job log = `0` (§8.2.1) |
| The probe line reaches both declared streams on a REAL E2B run | **NOT demonstrated**, and not claimed. This is the owed keyed run (§7.1) — unchanged since `DEP-024` |
| **After the flip, `d2m`'s retained artifact alone is gradeable on BOTH arms** | **Argued** — demonstrated for the judge (the grader now requires the field, mutation-proven) and for the producer (`redactionProbeMatrixRow` sets it, mutation-proven by `DEP-025`); the composition of the two on a live keyed row is the owed run |

★ **What I did NOT dispatch, and why.** No keyed workflow: ruling F8 reserves that envelope, and the
`redaction` phase does not execute in `keyless` at all, so a free `m1-shipped-boot` run could not
distinguish this change from its absence — reading one as verification is `E6-F031`, and a run that
cannot fail my hypothesis is not a hypothesis test (`E.3.2`).

---

## 10. Files changed

| File | Change |
|---|---|
| `scripts/lib/campaign-fault-matrix.mjs` | `REDACTION_SUPPRESSED_ARM_SCOPES` + `classifyRedactionSuppressedArm`; the declaration half validates `redactionCase.suppressedArm` (presence on `required`, well-formedness always); the evidence half grades the withheld-plant arm and fails closed |
| `scripts/check-campaign-fault-matrix.test.mjs` | 9 new controls (`32 → 41`); the anchor declares `in_run` and its bundle row carries the field; three of them cover the blocker cross-reference (open-registered, the failure shapes incl. fail-closed sources, and the anti-orphan caller sweep) |
| `tests/d1/fault-matrix.json` | `d1` → the declared `none` exemption naming `E6-F033`/`E6-F034`; `d2m` → `in_run`, with its `pendingReason` superseded in place |
| `docs/replatform/epics/E6-deployment-test-harness/findings.md` | `E6-F034` filed |
| `scripts/finding-ownership.json` | `E6-F034` added as a delta |
| `scripts/lib/campaign-fault-matrix.mjs` (§12) | `evaluateRedactionExemptionBlockers` — the exemption's blockers cross-referenced against the finding register, fail-closed on unusable sources |
| `scripts/lib/finding-sources.mjs` | NEW. Loads the two finding sources: `openFindingIds` (register keys — OPENNESS, shrinks on closure) and `declaredFindingIds` (findings.md headings — EXISTENCE, survives closure) |
| `scripts/check-campaign-fault-matrix.mjs`, `scripts/m1-shipped-boot/journey.mjs`, `tests/d1/m1-fault-matrix.test.mjs` | the three production declaration-validating paths now make the cross-reference |
| `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-026-result.md` | this record |

---

## 11. What I stopped on

**Nothing was handed up unfixed.** Codex round 1 raised two P2s, both real, both verified at source and
both fixed in this PR (§12) — one of them reversing a judgement written into §4.5 of this record, which
is corrected in place with the superseded reasoning kept. Counted honestly (`E.3` rule 5) that is **one
round with two findings**, so rule `C`'s two-round cap still has a round in hand.

The one judgement worth a reviewer's attention is §2's split verdict: I built the `(c)` shape (a declared,
checked, narrowly-scoped exemption) for a case whose `events` half is honestly `(a)` (a buildable gap),
and filed that half as `E6-F034` rather than building it. The reason is in §2.1 and it is measured — a
one-boolean field cannot express a two-stream partial control without recreating `DEP-025` finding (a) —
but it is a judgement, and a reviewer who disagrees should say so rather than assume it was an oversight.
## 12. Codex round 1 — TWO P2s, both REAL, both fixed

Both were verified at source before any code moved, and the second one **reversed a judgement I had
written into §4.5 of this very record**. That is recorded as a reversal rather than smoothed over,
because a correction is as suspect as the thing it corrects (`E.3.1` corollary) and the reader is owed
the new link rather than new reasoning.

### 12.1 P2 (a) — a blocker that is phantom **or resolved** leaves the exemption unchecked

> *"this predicate accepts any non-empty strings in `blockedBy` … A typo—or later resolution and removal
> of E6-F033/E6-F034 from the open-finding register—therefore leaves the D1 case permanently exempt and
> green without its withheld-plant arm, even though the documented closure requires switching it to
> `in_run`."*

**The first clause I had already closed** in §4.5, by cross-referencing the epics' `findings.md`
headings. **The second clause is the one that matters, and my §4.5 rationale was backwards.** I had
argued *against* using `scripts/finding-ownership.json` on the grounds that closure DELETES its key, so
the register would red on a correct declaration naming a since-closed blocker. But **closing the blocker
is precisely what must invalidate the exemption** — the D1 case's own `reason` says so: *"Closing both
means DELETING this exemption and declaring `scope: "in_run"`."* I had optimised the check to survive its
blockers' closure, when failing on closure is the entire point.

★ **THE NEW LINK I MEASURED**, which the first pass had not: `E9-F003` and `E9-F007` are closed, are
**absent from the register**, and their `##` headings **survive** in `findings.md` — 232 headings against
104 register keys, 40 headings explicitly `resolved`. So the two sources answer two different questions,
and the register is the one the exemption must depend on.

**The fix** requires each id to be a **currently open registered finding**, which subsumes the phantom
case (a phantom id is in neither set) and adds the closure case. The two codes are kept distinct so a
reader is told which failure they have: `…_blocker_undeclared` (no heading anywhere) versus
`…_blocker_not_open` (a real, resolved finding). A control asserts they do not collapse.

### 12.2 P2 (b) — the cross-reference lived only in the self-test

> *"This cross-reference exists only inside the self-test, so neither `evaluateFaultMatrixDeclaration`
> nor `check-campaign-fault-matrix.mjs` performs it … consequently the standalone checker used by the
> keyed `m1-shipped-boot.yml` artifact-verdict step also accepts the phantom exemption whenever the test
> suite is not run alongside it."*

**Verified at source and exactly right.** `scripts/check-campaign-fault-matrix.mjs` called only the pure
`evaluateFaultMatrixDeclaration(matrix)`, and it is invoked at `m1-shipped-boot.yml:438` (the keyed
artifact-verdict step) and `d1-merge-train.yml:806` and `:858` — in none of those alongside this suite.
`scripts/m1-shipped-boot/journey.mjs:1287` calls the pure evaluator directly too. So my check was a
check that the production path never ran: the class this ticket is about, in my own diff.

**The fix** puts it in the lib as `evaluateRedactionExemptionBlockers(matrix, sources)`, kept SEPARATE
from `evaluateFaultMatrixDeclaration` because the sets come from the filesystem and that evaluator is
pure. The two sources are loaded once by `scripts/lib/finding-sources.mjs`. **Three production callers
now make the call** — the guard CLI, the keyed `journey.mjs` fault-matrix phase, and the live D1 driver.

★ **FAIL-CLOSED ON ABSENT SOURCES.** A matrix that declares an exemption while the caller supplied no
usable sets is REFUSED (`declaration:redaction_exemption_blockers_unverifiable`), so a caller cannot
obtain silence by not looking. Six unusable shapes are controlled: `undefined`, `{}`, either set alone,
an empty `Set`, and arrays-instead-of-`Set`s. A matrix with **no** exemption needs no sources — the
refusal is scoped to callers that actually depend on it, rather than made a tax on every caller.

★ **AND AN ANTI-ORPHAN CONTROL**, which is `REL-004`'s lesson applied to my own new verifier: it walks
`scripts/`, `scripts/m1-shipped-boot/`, `scripts/lib/` and `tests/d1/` for every file containing
`evaluateFaultMatrixDeclaration(` and asserts that set **equals** the three known callers. So a NEW
production validator cannot be added without being swept, and a caller that drops the call reds in
`policy`. That is the second source (`E.2.1`) for a completeness claim I would otherwise be making from
memory.

### 12.3 The mutations for round 1

| Mutation | Red |
|---|---|
| **M8** remove the cross-reference from the GUARD CLI — P2 (b)'s exact shape | `41 / 40 / 1`, the anti-orphan control |
| **M9** source OPENNESS from the headings instead of the register — the reasoning P2 (a) reversed | `41 / 39 / 2`, both blocker controls |
| **M10** a RESOLVED blocker (`E9-F003`) in the committed declaration, judged **through the guard CLI end-to-end** | `exit 1`, `declaration:redaction_exemption_blocker_not_open: … names "E9-F003", which is RESOLVED …` |

All reverted; baseline `41 / 41 / 0` restored and the mutated files asserted byte-identical. M10 is the
one that answers P2 (b) on its own terms: the refusal now comes out of the **CLI the keyed lane runs**,
not out of a suite that lane does not run.

**`32 → 41` controls. Full guard set `failures: 0`; `194 / 194 / 0` with the two neighbouring pure
suites.**

### 12.4 Honest counting

Rounds counted per `E.3` rule 5: this is **round 1 with two findings**, not two rounds. Rule `C`'s
two-round cap therefore still has a round in hand, and nothing is being handed up. P2 (a) and P2 (b) are
**one class in two places** — *a check whose input cannot answer the question being asked*: (a) asked
"does this id exist?" when the question was "is it still open?", and (b) asked it somewhere the
production path never looked. Both are the ticket's own subject matter turned on the ticket's own diff.
