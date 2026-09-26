# QA Result — `M1a-D2-MECHANISM`, M1a candidate, `7be35ae6b771`, attempt 19

**Date (UTC):** `2026-09-24`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a19.md`
**Scope slug:** `m1a-candidate`
**Revision:** `7be35ae6b7719877e61f54ab552de84de8491e7d`
**Attempt:** `19`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a18.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-23T21:12:00Z`
**Campaign end (UTC):** `2026-09-23T21:18:00Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session **distinct** from the planning session that took
the M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no
workflow, keyed or keyless, and wrote no milestone handoff.

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

## 0.00000000000000000 Why attempt 19 exists — my remediation recipe was IMPOSSIBLE as written

One **P1** and one P2 from the Codex review of PR #591 on `c46bdbced9`, both confirmed at source. **No verdict or measurement changes: `Result: fail`, class `harness`.** These are the first findings in several rounds that are about the *substance* of §11.1 rather than its cross-links, and both show the recipe could not have been executed.

★★★ **(1) P1 — the recipe told an operator to change the harness and then run "on the candidate". Those two instructions contradict each other.** Measured: `.github/workflows/m1-shipped-boot.yml` **checks out the supplied candidate** (`actions/checkout` with `ref: ${{ inputs.candidate }}`, ≈:116–121) and then **asserts HEAD is that candidate** (*"Bind the run to the candidate"*, ≈:123–128, `[[ "$(git rev-parse HEAD)" == "$CANDIDATE" ]]`). So dispatching on `7be35ae6b…` after adding a fault-matrix step would check out a tree **without that step** — the run would do nothing new. And dispatching on the new revision means the evidence is no longer this candidate's: `qa-handoff-recovery.md` §1 is explicit that *"a code or behavior-changing documentation commit after that freeze creates a **new candidate and new attempt**"*, and §1's byte-identity carry-forward does **not** apply, because this is a change to `.github/` and `tests/`, not a documentation-only disposition.

**What follows from that, and it is the most consequential thing in this record:** **`M1a-D2-MECHANISM` cannot be passed on the candidate `7be35ae6b7719877e61f54ab552de84de8491e7d` at all.** Passing it requires harness that this revision does not contain, so it requires a **new candidate**, a **new freeze** under §1's checklist, and a **fresh `M1-D1-SPINE` record on that same new candidate** — exit criteria 2 and 3 each demand a campaign on *one exact candidate*, and §8's spine record attests this one. §11.1 now says so, instead of implying a successor attempt on this revision could pass.

★★ **(2) P2 — running the 22 cases without first promoting their declarations would FAIL the campaign**, and expensively. All 22 are declared `evidence: "pending"`, and `scripts/check-campaign-fault-matrix.mjs` states in its own header that *"a `pending` case that reported evidence is refused (the declaration has gone stale)"*, raising `evidence:pending_case_reported` (`scripts/lib/campaign-fault-matrix.mjs:376`) — *"rewrite the declaration rather than inherit a pass"*. So the declaration must be promoted `pending` → `required` **in the same commit that adds the driver**, with its own review, or the keyed run burns E2B money to produce a guaranteed red. Added as an explicit step.

*Both findings share a shape worth naming: I wrote a remediation from what the gate **requires** without checking what the **harness and its checker permit**. A recipe that has not been read against the machinery it drives is a wish, not a plan.*

Every other section is carried forward from `a18` unaltered.

## 0.0000000000000000 Why attempt 18 existed — the companion-link loop it closed (carried forward)

Minted together with the companion's `a15`, whose §8 pointer this record's §11 would otherwise stale in turn. **No verdict or measurement changes: `Result: fail`, class `harness`.**

★★★ **THE LOOP, AND THE STRUCTURAL FIX.** The last three review rounds were the two gate records chasing each other's *live companion pointer*: naming a specific companion attempt means the next attempt on either side immediately stales the other's link, so each fix mints the next finding. **That does not converge**, and iterating it would grow the attempt chain without improving the evidence by one measurement.

**So the live companion pointer is now attempt-AGNOSTIC.** It names the **gate and this folder** and directs the reader to the head of that gate's `Supersedes` chain, instead of an attempt number. A reader always lands on the record they should rely on, and neither record can stale the other again. **Historical and debt pointers keep their exact attempt numbers**, because moving those would rewrite what happened — the two link classes and their opposite update rules are tabulated in the mechanism record's §0.000000000000000.

*The general lesson, which is why this is in the record and not only in the diff: **a cross-reference that must be updated whenever anything moves is a defect in the reference, not a series of defects in the records.** Two immutable documents cannot hold mutually current pointers to each other; at least one side has to be indirect.*

★ `a17`'s link-class table stands and is carried forward, with the **LIVE** row now in the chain-relative form; the HISTORICAL and SPECIFIC rows keep their exact attempt numbers, exactly as that table requires.

Every other section is carried forward from `a17` unaltered.

## 0.000000000000000 Why attempt 17 existed (carried forward)

One P2 from the Codex review of PR #591 on `20fbed03b8`, accepted. **No verdict or measurement changes: `Result: fail`, class `harness`.**

★ **§11's companion link pointed at spine `a13`, which `a14` supersedes** because `a13` still carried two live false claims — the non-empty-candidate-store inference and the assertion that two cases lacked valid routing. Re-pointed at **`a14`**.

★ **And this time the link classes were enumerated, not assumed.** Every spine reference in this record was listed and classified:

| Site | Reference | Class |
|---|---|---|
| §11 gate effect | the **`M1-D1-SPINE` chain head**, not an attempt number | ★ **LIVE** — made chain-relative in `a18`, so it can never stale |
| §0.000000 narrative | spine `a7` | **HISTORICAL** — records which attempt moved the companion verdict at the time; must NOT be updated |
| §0.00000 narrative | spine `a6` | **HISTORICAL** — same |
| §0.0 debt inventory | spine `a1`, `a2` | **SPECIFIC** — names the exact non-conforming files; must NOT be updated |

**A record holds two kinds of link and they have opposite update rules**: a *live* pointer must always name the current attempt, while a *historical* or *debt* pointer must never be moved, because moving it would rewrite what happened. Conflating them is how a provenance fix becomes a provenance error. Recording the distinction here so the next reviewer of this chain can tell a stale link from a deliberate one.

Every other section is carried forward from `a16` unaltered.

## 0.00000000000000 Why attempt 16 existed (carried forward)

Two P2 findings from the Codex review of PR #591 on `1a9a697438`, both accepted. **No verdict or measurement changes: `Result: fail`, class `harness`.**

★★★ **(1) THE RECORD DATE ROLLS TO `2026-09-24`, and this is the second time this chain has got the UTC date wrong — in the opposite direction.** `§0.0` records `a1`/`a2` as dated 2026-09-24 when the UTC date was the 23rd. Now the correction chain has crossed midnight UTC: `TZ=UTC date` reads **`2026-09-24T01:15Z`**, and the `a12`/`a15` pair was first committed at `87247ac8ac`, **2026-09-24 00:52 UTC**. `artifact-policy.md:115` requires the filename's date segment to be the **record's** UTC date, not the campaign's — the campaign date is carried in `**Campaign start (UTC):**`, which is unchanged at `2026-09-23`. So this attempt and its companion are dated **`2026-09-24`**.

★ **`a12`/`a15` keep their `2026-09-23` filenames as ACCEPTED DEBT**, on the same authority as §0.0's four records: `qa-handoff-recovery.md` §4 forbids renaming an immutable record and directs that an unrepairable contract violation be *"recorded as accepted debt with its reason"*. The debt inventory for this chain is therefore **six** records: the four in §0.0 (dated the 24th when the UTC date was the 23rd) plus `a12` and `a15` (dated the 23rd when the UTC date was the 24th). **None may be cited as exact-date evidence without stating the defect.** *The lesson is one line: read the UTC clock at the moment of minting, every time — an inherited date is a guess.*

★★★ **(2) §5's F-9 row still declared BOTH routed cases invalidly routed. `a15`'s own §0 says otherwise.** Dispatch being enabled on the spine's `worker-b` invalidates routing the **`WRK-013` startup-reconciliation** case away — nothing more. `DEP-018` allocates **provider failure** to this gate, so `d1.provider.worker_terminal_mapping` is a **valid** obligation of **this** lane; what is false about it is only the *reason* the declaration gives. F-9 now separates the two: one case wrongly routed away from the spine, one validly owned here — and **both unrun, so both uncertified**, which is what makes F-9 a failure either way.

*This is the fourth site of one propagation class across this chain. Recording it plainly: a correction is not done when the flagged line is fixed; it is done when every sentence resting on the same premise has been re-read.*

Every other section is carried forward from `a15` unaltered.

## 0.0000000000000 Why attempt 15 existed (carried forward)

One P2 from the Codex review of PR #591 on `87247ac8ac`, accepted. **No verdict or measurement changes: `Result: fail`, class `harness`.**

★ **§11.1's closing note told a successor it could run BOTH routed cases keylessly on the spine lane. Only one of them belongs there.** `DEP-018` allocates **restart and reconciliation (`WRK-013`)** to `M1-D1-SPINE` and **provider failure** to `M1a-D2-MECHANISM` (`epics/E6-deployment-test-harness/implementation-plan.md` ≈:1313–1317), and the companion spine record classifies routing `d1.provider.worker_terminal_mapping` away as **contract-consistent** for exactly that reason. A **reference-provider** spine run cannot discharge a **real-E2B** obligation. So `d1.reconcile.worker_startup_lease_probe` is the keyless one, and the deployed worker's terminal mapping stays **this lane's**, on the shipped boot, inside precondition 1.

*This is the spine chain's error in reverse: I let a case cross a contract boundary because running it somewhere cheaper was convenient.*

Every other section is carried forward from `a14` unaltered.

## 0.000000000000 Why attempt 14 existed (carried forward)

One P2 from the Codex review of PR #591 on `21eb43d2fa`, accepted. **No verdict or measurement changes: `Result: fail`, class `harness`.**

★ **`a13` corrected "all 23" to "22" and attributed the SAME LITERAL owner string to all 22. Only 21 carry it.** Counted at the candidate: **21** rows read `pendingOwner: "planning session (F8), on the DEP-015 lane"`; **1** — `d2m.credential.production_reader_company_predicate` — reads `"planning session (F8), on the DEP-015 shipped-boot lane"`; and **1** — `d2m.tenant.cross.tool_calls` — is `CLI-016`'s. §5 now records the **21 / 1 / 1** split rather than quoting one string for 22 rows.

*The 22 figure was right about what matters — 22 cases are the planning session's to run and 1 needs a disposition — but I proved it by quoting a literal that is not literally true of all 22. **A count and the evidence quoted for it must be the same claim.***

Every other section is carried forward from `a13` unaltered.

## 0.00000000000 Why attempt 13 existed (carried forward)

One P2 from the Codex review of PR #591 on `c3435df374`, accepted. **No verdict or measurement changes: `Result: fail`, class `harness`.** This is the third site of the same propagation failure, and the last one the review found.

★ **§5's root-cause summary said every `pending` row carries `pendingOwner: "planning session (F8), on the DEP-015 lane"`.** Twenty-two of them do. `d2m.tenant.cross.tool_calls` does **not**: `tests/d1/fault-matrix.json` assigns it to **`CLI-016` (M1b)**, with the note that the `M1a` posture — the surface off on every replica — is asserted by the `DEP-016` `m1-spine` profile. That distinction is precisely what drives §11.1's 22-runnable-plus-one-disposition split and the corrected gate effect, so leaving the blanket owner claim in §5 contradicted both. Scoped to the other 22.

*Three sections of this record stated a premise that a later section had already disproved. The pattern is worth more than the fix: **when a correction lands, sweep the whole record for the claim it invalidates** — the summary paragraphs are where it survives, because they are written once and re-read least.*

Every other section is carried forward from `a12` unaltered.

## 0.0000000000 Why attempt 12 existed (carried forward)

One P2 from the Codex review of PR #591 on `ca67af8fd7`, accepted. **No verdict or measurement changes: `Result: fail`, class `harness`.**

★ **`a11` rewrote §11.1 to the 22-runnable-plus-one-disposition split and left §11's gate-effect summary saying *"this lane needs its 23 declared cases to run"*.** An operator who read only the gate effect would take away the same impossible instruction §11.1 exists to remove — arming a tool surface the freeze checklist requires off. Corrected, and the companion record's §0.00000000 records the identical propagation failure on its own side. *A correction that does not sweep the record for its own premise is half a correction.*

Every other section is carried forward from `a11` unaltered.

## 0.000000000 Why attempt 11 existed (carried forward)

Two P2 findings from the Codex review of PR #591 on `e44f3c7019`, both accepted. They are both about **§11.1's recipe**, not about any measurement: **`Result: fail`, class `harness`, unchanged.**

1. ★★★ **§11.1 said "all 23 cases merely need a runner". One of them cannot run on this gate at all.** `d2m.tenant.cross.tool_calls` requires an **armed** tool surface, and the frozen `M1a` configuration **disarms it on every replica** — this record asserts exactly that in §2 and §9.7, and the declaration's own reason says an armed cross-tenant case *"cannot run on this gate at all"* and is `CLI-016`/`M1b` work. So my recipe told an operator to run a set that includes a case whose execution would **break the freeze checklist my own §2 certifies**. The correct split is **22 cases need a runner; 1 needs a gate-owner disposition.**
2. ★ **§11.1 let an operator reach a passing attempt while still violating `EVID-01`.** This record states in §2.1 that the unpinned `aoa-base` template build and the E2B service version are *additional* reasons it fails — yet option (a) went straight from running the matrix to filing a pass. A successor following it exactly would file a `pass` with the same provider/template identity gap. §11.1 now makes capturing those identifiers (or an approved contract disposition for them) a **precondition**, not a footnote.

Every other section is carried forward from `a10` unaltered.

## 0.00000000 Why attempt 10 existed (carried forward)

One P2 from the Codex review of PR #591 on `adaff48c93`, confirmed at source and accepted. **No verdict or measurement changes: `Result: fail`, class `harness`.**

★ **`a9` recorded the E2B SDK only as the range `^2.30.5` and called the resolved version unavailable. It is available, and in the repository.** `pnpm-lock.yaml` at the candidate resolves the provider dependency at both import sites to exactly **`e2b@2.30.5`** (`specifier: ^2.30.5` → `version: 2.30.5`, lock entries `:633–634` and `:887–888`, package key `e2b@2.30.5`), and `docker/adapter-manager/Dockerfile` installs that lockfile with `--frozen-lockfile`, so the SDK built into the recorded image digest is knowable **without another campaign**. §2.1 now records **`2.30.5`** as the resolved provider-SDK version, separately from the identifiers that genuinely remain unavailable.

★ **The remaining gap is narrower, and stated more precisely because of it.** Two identifiers, not three, are still missing: the **`aoa-base` template build id** (registered out of band, so a re-registration changes what this record attests without changing the record) and the **E2B service version** (not exposed to the run). *An "unavailable" that turns out to be in the lockfile is a reminder that a gap should be measured before it is declared.*

Every other section is carried forward from `a9` unaltered.

## 0.0000000 Why attempt 9 existed (carried forward)

One P2 from the Codex review of PR #591 on `8c5b83575a`, confirmed and accepted. **No verdict or
measurement changes: `Result: fail`, class `harness`.**

★★★ **`EVID-01` identity was missing.** `test-gates.md:15` requires every QA record to identify its
protocol-contract hash and provider/template versions. `a1`–`a8` named only *"real E2B"* and an
unversioned `aoa-base`, and gave image digests without the protocol contract — so after the CI
artifact expires, nobody could establish which protocol and which provider environment produced these
results. **New §2.1** supplies the values, **and states three places where an immutable identifier
does not exist**: `aoa-base` carries no template build id, the E2B SDK appears only as the range
`^2.30.5`, and the E2B service is versionless from the run's view. Those gaps are recorded as limits
on reproducibility rather than smoothed over.

Also carried into §2.1: the in-job control-plane keypair fingerprint, the three execution-target
profile hashes, and the four-reading flag assertion, so the configuration identity is pinned even
though the provider identity cannot fully be.

## 0.000000 Why attempt 8 existed (carried forward)

Again no finding against **this** record, and again its **companion moved**. `a7` said the spine was
`Result: pass`; the spine is now **`Result: fail`** at
`./2026-09-23-m1-d1-spine-m1a-candidate-7be35ae6b771-a7.md`, and an immutable record must not point
at a stale verdict.

★ **What moved there, and why it strengthens the finding this record already carried.** `a6` had
reclassified the spine's unrun `WRK-013` restart/reconciliation case from a `REQUIRED` failure to an
`OBSERVED` finding, reasoning that an unrun `pending` case is a declaration defect rather than an
unmet gate clause. **That reclassification was overruled by an approved contract**: `DEP-018`'s
*Outcome* in `epics/E6-deployment-test-harness/implementation-plan.md` (≈:1313–1317) allocates *"the
journey's fault controls (Toxiproxy), **restart and reconciliation (`WRK-013`)**, cancellation"* to
**`M1-D1-SPINE`** by name, and its Acceptance item 1 requires *"a run showing its injection fired"*
for every declared case. A QA owner may not narrow a locked allocation.

**So `d1.reconcile.worker_startup_lease_probe` is gate-blocking on the spine, and it is ALSO one of
the two cases §5 F-9 records as routed to THIS lane and never run here.** Both lanes now fail on the
same missing case, from opposite directions: the spine because the case is allocated to it and was
runnable there, this lane because the case was routed here and nothing ran. **`WRK-013`'s
deployed-boot restart behaviour is certified by no campaign, and that is now a recorded failure on
both gate records rather than a finding on one.**

The same contract allocates **provider failure, reconciliation and every cleanup path** to
**`M1a-D2-MECHANISM`** — all of which §5 already records as `pending` and unfired (F-2, F-3, F-4). This
record's verdict was never in doubt; the contract simply names it.

**Nothing about this gate's measurement changes:** 23 declared cases, 23 `evidence: "pending"`, 0
fired; audit signal empty; `costEventsForRun: 0`. **`Result: fail`, class `harness`.** Every other
section is carried forward from `a7` unaltered.

★ **Both `M1a` gate records now carry `Result: fail`.** Exit criterion 8 requires a committed
`Result: pass` for **each** named gate, so `M1a` does not pass on this candidate. Each record states
what a passing successor needs; the spine's is one keyless case.

## 0.00000 Why attempt 7 existed (carried forward)

No finding was raised against **this** record. It is superseded because its **companion changed
verdict**, and a record that points at a stale companion misleads the reader of an immutable file.

★ **The `M1-D1-SPINE` record is now `Result: pass`** at
`./2026-09-23-m1-d1-spine-m1a-candidate-7be35ae6b771-a6.md`. Two things moved there, both settled
against `m1-spine-evidence-35912752449/profile/m1-spine-evidence.json` — the **passing** arm's
profile record, which the QA owner had not opened until that attempt:

- the `MIG-009` rollback rehearsal **ran and passed** (`exitCode 0`, audit
  `actorId "operator-cli:m1-spine-1449e508"`, a 5-candidate pre-drain census, 5 audit rows,
  `verdicts.rollbackRehearsal = []`), so the spine's `SPINE-ROLLBACK-1` failure was **retracted**; and
- the remaining defect — two `pending` cases excused on a premise false for the lane that boots
  `docker/d1/m1-spine.override.yml` — was **reclassified** from a `REQUIRED` failure to an `OBSERVED`
  finding, because it is a defect in `tests/d1/fault-matrix.json`, not an unmet clause of that gate.

**Nothing about THIS gate changes.** The `M1a-D2-MECHANISM` verdict rests on its own measurement,
which is untouched: **23 declared cases, 23 `evidence: "pending"`, 0 fired**, an empty audit signal
and `costEventsForRun: 0`. **`Result: fail`, class `harness`.**

★ **And one cross-reference is now sharper, not weaker.** §5 F-9 says the two spine cases routed to
this lane were never run here. That still holds — and with the spine at `pass`, **this lane is the
only reason they are certified by no campaign at all.** The spine declared them out of scope on a
false premise; this lane, which owns them, ran nothing.

Every other section is carried forward from `a6` unaltered.

## 0.0000 Why attempt 6 existed (carried forward)

One P2 from the Codex review of PR #586 on `ed85a93004`, accepted. §11.1 still told an operator to
*"file attempt 5"*, which after `a5` would reuse this chain's own filename and make its `Supersedes`
link self-referential instead of minting the required higher attempt. Both the heading and the
instruction now name **attempt 7**, so the next successor of *this* record is unambiguous.

This is the second numbering slip in the chain: a remediation instruction written at attempt *n*
goes stale the moment attempt *n* is superseded. Stated so it is not repeated: **the remediation
section must always name `current attempt + 1`, and it must be re-checked on every supersede.**

**Nothing else changes.** Every measurement, assertion, clause judgement, the `Result` (`fail`,
class `harness`), the §0.000 command-table split, the §0.00 `DEP-015` correction and the §0.0
accepted-debt note are carried forward from `a5` unaltered.

## 0.000 Why attempt 5 existed (carried forward)

One P2 from the Codex review of PR #586 on `2e0d884d48`, confirmed and accepted. The env-probe row of
§3 still folded a **second** invocation into prose (*"and the same command on …"*) and gave one exit
code and one duration to two distinct commands. It is now **two literal rows**, one per file, each
with its own exit code, duration and result.

This is the third pass over the same table, and the lesson is worth stating rather than quietly
fixing: *"the exact command"* means one row per executed command — no collective descriptions, no
shared exit codes, no elided arguments.

**Nothing else changes.** Every measurement, assertion, clause judgement, the `Result` (`fail`, class
`harness`), the §0.00 `DEP-015` correction and the §0.0 accepted-debt note are carried forward from
`a4` unaltered.

## 0.00 Why attempt 4 existed (carried forward)

Two P2 findings from the Codex review of PR #586 on `78ae70dcd4`, both confirmed at source.

★★★ **(1) A FACTUAL ERROR about `DEP-015`, repeated in `a1`, `a2` and `a3`.** Those attempts said
`DEP-015` carries `Status: gate_review` at the candidate. **It carries `Status: complete`.**
Measured now at `7be35ae6b`, `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-015-result.md:3`:

> `**Status:** `complete` (set by the distinct reviewer of attempt 2; the author left it at `gate_review`). ★ **Re-affirmed 2026-09-23** by the distinct reviewer of attempt 3 … *Original line, kept as first written:* "`gate_review`. The **keyed acceptance is PENDING** …"`

**I read the quoted historical line as the live status.** The record follows this programme's own
"never rewrite history in a quote" convention and preserves its superseded wording inline; a
first-match grep for `**Status:**` returns the whole line, historical quote included, and I took the
wrong half of it. That is the records-disagreeing-with-code class again, this time caused by reading
a *correctly written* record carelessly.

**Corrected below.** At the candidate, of `M1a`'s required result set: **`DEP-015` is `complete`**,
and `DEP-017` (`gate_review`, keyed acceptance pending) and `WRK-018` (`gate_review`) are the two
that remain. **Exit criterion 1 is still unmet**, on those two — so no verdict, assertion or clause
judgement changes.

**(2) The `a3` command table still abbreviated artifact paths** with an ellipsis prefix, and used
prose for one entry. §3 is rewritten once more with every path written out in full, so each row is
copy-pasteable as recorded.

**Everything else is carried forward from `a3` unchanged**, including the §0.0 accepted-debt note on
the four wrongly-dated `a1`/`a2` filenames, which still stands and is not repaired.

## 0.0 Why attempt 3 existed, and the accepted debt it could not repair (carried forward)

Two P2 findings from the Codex review of PR #586 on `f30a0c6a85`, both confirmed at source.

**(1) The UTC date in `a1` and `a2` is wrong.** `artifact-policy.md:115` requires the filename's
date segment to be the **UTC** date. Measured: `TZ=UTC git log -2 --format='%H %cd' --date=iso-local`
returns `f30a0c6a857e345b52370502a21ef133b6a671df 2026-09-23 22:21:12 +0000` and
`3f00c2be118e1c2e94bf0d15ba7b7c2965fb499b 2026-09-23 22:04:53 +0000`. The authoring session's clock
is `+05:30`, so its "2026-09-24" was **2026-09-23 UTC**. Both campaigns also ran on 2026-09-23 UTC
(`20:05`–`20:11` and `21:12`–`21:18`). Attempt 3 and this attempt use **`2026-09-23`** in its filename and in
`Date (UTC)`.

★★★ **ACCEPTED DEBT, recorded rather than repaired.** `a1` and `a2` are already committed and are
**immutable**. `qa-handoff-recovery.md` §4 is explicit: where the breach is *"a contract violation
that cannot be repaired without touching an immutable file (a malformed filename …), record it as
accepted debt with its reason — do not rename or edit."* So the four records

- `2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a1.md`
- `2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a2.md`
- `2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a1.md`
- `2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a2.md`

**keep their non-conforming date segment**, and are hereby added to the debt class that
`qa-handoff-recovery.md`'s amendment banner enumerates. **None of them may be cited as
exact-date evidence without stating this defect.** Their `Supersedes` chain is intact and their
content stands as recorded; only the date token is wrong.

**(2) The `a2` command table was not literally reproducible.** It used ellipses (`node -e "…"`),
prose (`read …`), collective descriptions ("the 38 pure-node guards") and, for shell loops, a
`0`/`1` pair rather than the loop's single exit status. The template requires the **exact** command,
exit code, duration and result summary, so that the record survives its CI artifacts. §3 below is
rewritten with literal, copy-pasteable commands and single exit statuses.

**Nothing else changed.** Every measurement, assertion, clause judgement and the `Result` are
carried forward from `a2` unaltered.

## 0.1 The correction the `a1` → `a2` step made

`a1` reached the correct verdict — `fail`, class `harness` — but **omitted the template-required
`## Commands` section entirely** (raised by the Codex review of PR #586 on `3f00c2be11`, and
confirmed: `templates/qa-result-template.md` requires a command table with exact command, exit code,
duration and result summary). Run ids and "30 steps succeeded" do not record what a reviewer
actually executed to inspect the evidence, and after the CI artifact expires the record could not
independently satisfy the evidence contract. `a1` is immutable and is not edited; `a2` added §3, and **this attempt rewrites §3 with literal,
reproducible commands** after §0.0 finding (2).

**The verdict, every measurement and every clause judgement are unchanged from `a1`.** §5's failures
and §6's passes are carried forward intact. The only substantive addition is §3; two small
corrections are noted where they occur.

*(Corrected here: `a1` §3's table row *"`gh run download 35912752449`… 40 files"* belongs to the
spine record, not this one — this lane's artifact is 22 files, which `a1` stated correctly
elsewhere. The spine record's own count is corrected in its `a2`.)*

---

## 1. Candidate and run

| | |
|---|---|
| **Candidate** | `7be35ae6b7719877e61f54ab552de84de8491e7d` |
| **Run** | **`35920425288`**, `.github/workflows/m1-shipped-boot.yml` (*"M1 shipped CI boot (DEP-015)"*), event `workflow_dispatch`, `mode: keyed`, template `aoa-base` |
| **Run head SHA** | `7be35ae6b7719877e61f54ab552de84de8491e7d` — **the candidate exactly.** This record needs no tree-equivalence argument. |
| **Job** | `shipped-boot` — **30 steps, all `success`** (read per step from the jobs API, not from the run conclusion; `E6-F023`) |
| **Keyless rehearsal of the same candidate** | run `35919374111`, same workflow, `shipped-boot` 30/30 `success` |
| **Evidence artifact** | `m1-shipped-boot-keyed-35920425288`, **22 files**, downloaded and read in full |

★ **Ruling F3 is satisfied by this lane.** `m1-shipped-boot.yml` is `workflow_dispatch`-only, bound
to a named candidate (steps *"Validate the named candidate"*, *"Bind the run to the candidate"*),
builds the three images from source in-job, and generates the control-plane keypair in-job
(`candidate.json`: `keypair.generatedInJob: true`, `algorithm: "ed25519"`,
`signVerifyProbe: "pass"`). It is not the operator campaign deploy.

| Image | Digest |
|---|---|
| control-plane | `sha256:90c1e7aa24c6a1e0f81f0105f397e2e109833745400db908b26bdcfbd07401ba` |
| worker | `sha256:df44724d49d4cfb07ab19f266f149fc8c0bf4432540514caecdf6ee99742ecc4` |
| adapter-manager | `sha256:bba7540e4b34a25e0b5ba564b5c3ac363978bd4e4ba89ea5e0af8232d35f70ff` |

---

## 2. Topology and configuration digest (F10 + the M1a freeze checklist)

| Field | Value |
|---|---|
| Control planes | 2 replicas (`control-plane`, `control-plane-b`) |
| Workers | 3, one per Organization (`m1-worker-a/b/c`), each `status: enrolled`, `scope: organization`, `device_generation: 1`, `live: true` |
| Adapter manager | booted; `logs-adapter-manager.txt` retained |
| Provider | **real E2B** |
| Object store | MinIO; `presign-probe.txt` = `PRESIGN_PROBE_OK status=200` from the adapter-manager's seat |
| Enabled Organizations | `2f6229af-f681-4777-9235-8541ed33585e` (a), `c7fe6ae6-2ec6-482c-84d6-e9a330eacab1` (b) |
| Control Organization | `3f09853c-d5b7-42a8-94bf-17c893867e7b` (c) |
| Rollout resolution | a `canary`, b `canary`, c **`off`** |
| Tenant set + must-be-off switches | asserted on **four** replica readings — `control-plane` and `control-plane-b`, each `rendered` **and** `running`: `tenantSet: "exact"`, `crewRolloutEnabled: "false"`, `toolSurfaceEnabled: null`, `mustBeOff: "off"` |
| Targets | one `aoa-canary-e2b` target per Organization, three distinct `registeredProfileHash` values |
| Staging-manifest admission | pre-boot **and** post-rollout: *"rendered shipped boot satisfies DEP-015 (scoped), and the unscoped default-off check reds it (6 violation(s)) — the admission is scoped"* |
| Preflight | all three Organizations `ok: true`, `credentialAuthority: "company_api_key"` |

### 2.1 `EVID-01` identity — image digests, protocol contract, provider/template and configuration

★ *Added in `a9`. `a1`–`a8` named only "real E2B" and an unversioned `aoa-base`, which `EVID-01`
(`test-gates.md:15`) does not accept.*

**Images** — built in-job from the candidate `7be35ae6b7719877e61f54ab552de84de8491e7d`
(`candidate.json`):

| Image | Digest |
|---|---|
| `localhost/aoa/control-plane:7be35ae6b…` | `sha256:90c1e7aa24c6a1e0f81f0105f397e2e109833745400db908b26bdcfbd07401ba` |
| `localhost/aoa/worker:7be35ae6b…` | `sha256:df44724d49d4cfb07ab19f266f149fc8c0bf4432540514caecdf6ee99742ecc4` |
| `localhost/aoa/adapter-manager:7be35ae6b…` | `sha256:bba7540e4b34a25e0b5ba564b5c3ac363978bd4e4ba89ea5e0af8232d35f70ff` |

**Control-plane keypair** — generated in-job: `ed25519`, `signVerifyProbe "pass"`,
`publicKeySha256 9b55e2f0f91e635677adef9f5df5ec4a0eac30efa20fc51d0d5cc80a212f94be`.

**Protocol contract** — the frozen `v1` contract, at the candidate
(`docs/contracts/worker-protocol/v1/manifest.sha256`, blob `a5198560282b95e922a955fc48ffa8fe2eb67140`):

| Contract file | SHA-256 |
|---|---|
| `conformance.json` | `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71` |
| `operations.md` | `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775` |

Wire `protocolVersion` is **`1`** (`packages/worker-protocol/src/artifacts.ts`), package
`@armyofagents/worker-protocol@0.1.0`.

**Provider and template** — **real E2B**, through `packages/sandbox-e2b-provider`. Declared
constraint `e2b: "^2.30.5"` (`packages/sandbox-e2b-provider/package.json:40`), and ★ **the
lockfile-RESOLVED version is `e2b@2.30.5`** — `pnpm-lock.yaml` at the candidate records
`specifier: ^2.30.5` → `version: 2.30.5` at both import sites (≈:633–634 and ≈:887–888, package key
`e2b@2.30.5`), and `docker/adapter-manager/Dockerfile` installs that lockfile with
`--frozen-lockfile`, so this is the SDK inside the recorded image digest. *(Added in `a10`; `a9`
recorded only the range and wrongly called the resolved version unavailable — §0.00000000.)*
Sandbox template **`aoa-base`**, defined by `e2b/e2b.Dockerfile` at the candidate.

★★★ **A GAP IN THIS IDENTITY, STATED RATHER THAN PAPERED OVER — and it is TWO values, not
three.** *`a9` listed the SDK version here; it is in the lockfile and is recorded above.* These
remain unpinned by the evidence:

- **`aoa-base` carries no version or digest.** It is an E2B-account-side template registered out of
  band (`e2b/README.md`: `e2b template create aoa-base -d e2b.Dockerfile`). The run records the
  template *name*, not the template *build* it resolved to, so a re-registration of `aoa-base` would
  change what this record attests **without changing anything in the record**. The in-repo Dockerfile
  is pinned by the candidate revision; the registered image it produced is not.
- **The E2B service itself is versionless** from the run's point of view.

These are honest limits on reproducibility, and they are additional reasons this record's
`Result` is **`fail`** rather than something to be repaired by prose. **A successor attempt should
capture an `aoa-base` template build identifier**; the profile digests
below are the closest immutable anchors the lane produces today.

**Configuration and feature-flag digests** — asserted on **four** replica readings
(`control-plane` and `control-plane-b`, each `rendered` and `running`; `tenant-set-and-flags.json`):

| Field | Value |
|---|---|
| Tenant set | `tenantSet "exact"` on all four readings |
| Enabled / control Organizations | `2f6229af-…`, `c7fe6ae6-…` / `3f09853c-…` |
| Rollout resolution | `canary` / `canary` / **`off`** |
| Crew switch | `crewRolloutEnabled "false"` on all four |
| Tool surface | `toolSurfaceEnabled null`, `mustBeOff "off"` on all four |
| Execution-target profile hashes | a `4534d9a08a77ed67a15bb0d72189d00e886a71bf8650772bee772754011612eb`; b `94412d154a1fccaabec29d3734b3dd2dec2b82f182776cc486fec8bb8076d124`; c `c5695fef19f5d69e508dc2b5f7e7788f89535ddad3ccedb6720367d706507450` |
| Credential authority | `company_api_key`, all three Organizations |
| Staging-manifest admission | `DEP-015`-scoped; the unscoped default-off check reds with 6 violations |

---

## 3. Commands

Literal and copy-pasteable, run from a checkout of the candidate
`7be35ae6b7719877e61f54ab552de84de8491e7d`. Exit codes are the single status of the command as
written. **No workflow was dispatched, keyed or keyless.**

| Command | Exit | Duration | Result summary |
|---|---:|---:|---|
| `gh run view 35920425288 --json databaseId,headSha,conclusion,status,displayTitle,workflowName,event,jobs --jq '{id:.databaseId,sha:.headSha,c:.conclusion,w:.workflowName,e:.event,jobs:[.jobs[]\|{name,conclusion,steps:([.steps[]\|.conclusion]\|group_by(.)\|map({(.[0]):length})\|add)}]}'` | `0` | 3 s | `c success`, `e workflow_dispatch`, `sha 7be35ae6b7719877e61f54ab552de84de8491e7d`, `w "M1 shipped CI boot (DEP-015)"`; `shipped-boot {"success":30}` |
| `gh run view 35919374111 --json databaseId,headSha,conclusion,workflowName,event,jobs --jq '{id:.databaseId,sha:.headSha,c:.conclusion,jobs:[.jobs[]\|{name,conclusion}]}'` | `0` | 3 s | keyless rehearsal: same head, `shipped-boot success` |
| `gh run download 35920425288 -D /c/m1a-evid/keyed` | `0` | 9 s | artifact `m1-shipped-boot-keyed-35920425288` written |
| `find /c/m1a-evid/keyed -type f \| wc -l` | `0` | <1 s | `22` |
| `cat /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/journey.json` | `0` | <1 s | `passed: true`; `outcomes.{a,b}` `distributed`/`succeeded`/`verifierExit 0`; `outcomes.c` `execution_owner null` (§4, §8) |
| `cat /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/candidate.json` | `0` | <1 s | three image digests; `keypair.generatedInJob true`, `algorithm ed25519`, `signVerifyProbe pass` (§1) |
| `cat /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/env-probe-a.json` | `0` | <1 s | tenant a: `verdict absent`, `present []`, `allowedPresent ["ANTHROPIC_API_KEY"]`, `plantedControl.red true`, `de08MetadataResidual.reachable true` (§7) |
| `cat /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/env-probe-b.json` | `0` | <1 s | tenant b: identical verdict, `present []`, `plantedControl.red true`, `de08MetadataResidual.reachable true` (§7) |
| `node -e "const j=require('/c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/env-probe-a.json'); console.log(j.observed.checked.length);"` | `0` | <1 s | `18` — tenant a’s credential-class count, counted rather than asserted |
| `node -e "const j=require('/c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/env-probe-b.json'); console.log(j.observed.checked.length);"` | `0` | <1 s | `18` — tenant b’s count, measured separately |
| `cat /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/tenant-set-and-flags.json` | `0` | <1 s | four replica readings, each `tenantSet exact`, `crewRolloutEnabled "false"`, `toolSurfaceEnabled null`, `mustBeOff "off"` (§2) |
| `cat /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/reconcile-and-preflight.json /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/presign-probe.txt /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/manifest-check-pre-boot.txt /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/manifest-check-post-rollout.txt /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/verifier-a.txt /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/verifier-b.txt /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/workers.json /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/targets.json /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/tenants.json` | `0` | <1 s | all three Organizations `ok: true` with `credentialAuthority "company_api_key"`; `PRESIGN_PROBE_OK status=200`; both manifest checks *"…(scoped)… the unscoped default-off check reds it (6 violation(s))"*; `verifier-a.txt` *"RESULT: PASS (mechanism)"*; three workers `enrolled`; three targets; three Organizations (§2, §6) |
| `grep -c icnga1mdlhrayh683vwcl /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/logs-m1-worker-a.txt` | `0` | <1 s | `1` — tenant a's sandbox id in tenant a's log |
| `grep -c icnga1mdlhrayh683vwcl /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/logs-m1-worker-b.txt` | `1` | <1 s | `0` — absent from tenant b's log (exit 1 is `grep -c`'s no-match) |
| `grep -c icnga1mdlhrayh683vwcl /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/logs-m1-worker-c.txt` | `1` | <1 s | `0` |
| `grep -c iw8yiqpx7b0drx4saibqj /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/logs-m1-worker-b.txt` | `0` | <1 s | `1` — tenant b's sandbox id in tenant b's log |
| `grep -c iw8yiqpx7b0drx4saibqj /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/logs-m1-worker-a.txt` | `1` | <1 s | `0` |
| `grep -c iw8yiqpx7b0drx4saibqj /c/m1a-evid/keyed/m1-shipped-boot-keyed-35920425288/logs-m1-worker-c.txt` | `1` | <1 s | `0` |
| `node -e "const m=JSON.parse(require('fs').readFileSync('tests/d1/fault-matrix.json','utf8')); const p=m.profiles.find(x=>x.profile==='M1a-D2-MECHANISM'); console.log(p.cases.length, p.cases.filter(c=>c.evidence==='pending').length);"` | `0` | <1 s | **`23 23`** — 23 declared, 23 pending, 0 fired. The basis of this record's `fail` (§5) |
| `grep -rn "fault-matrix\|faultMatrix\|d2m\." .github/workflows/m1-shipped-boot.yml scripts/lib/m1-shipped-boot.mjs scripts/m1-shipped-boot/ \| wc -l` | `0` | <1 s | **`0`** — no fault-matrix step or driver anywhere in the lane |
| **positive control A:** `grep -c classifyTenantOutcome scripts/lib/m1-shipped-boot.mjs` | `0` | <1 s | `1` |
| **positive control B:** `grep -c shipped-boot .github/workflows/m1-shipped-boot.yml` | `0` | <1 s | `48` — with A, this proves the paths exist and the grep is live, so the `0` above is a real zero and not a mistyped path. *A check that evaluates nothing is not a check.* |
| `grep -n "name:" .github/workflows/m1-shipped-boot.yml` | `0` | <1 s | the 30 steps, ending `dispatch` → collect → secret-scan → upload → teardown; **no fault-matrix step** |
| `node -e "import('./scripts/check-gate-clause-wiring.mjs').then(async m=>{for (const s of ['observeRun','jobBudgetCostBridge','jobOutputBridge','jobAuditBridge','createFenceAwareEgressProxy','stageJobInputFiles']) console.log(s, (await m.countProductionCallers(process.cwd(), s)).count);})"` | `0` | 8 s | `observeRun 5`, `jobBudgetCostBridge 1`, `jobOutputBridge 0`, `jobAuditBridge 0`, `createFenceAwareEgressProxy 0`, `stageJobInputFiles 2` |
| `node scripts/check-gate-clause-wiring.mjs` | `0` | 2 s | `OK (28 wired clause(s), 6 declared dormant, 2 provider-capability claim(s) matched to source)` |
| `fail=0; for g in $(grep -oE "node scripts/check-[a-z0-9-]+\.mjs" .github/workflows/pr.yml \| sort -u \| awk '{print $2}'); do case "$g" in *browser-suite-executed*\|*embedded-secrets*\|*schema-migration-drift*\|*worker-protocol-package*\|*verdict-consumer-freshness*\|*evidence-immutability*) continue;; esac; node "$g" >/dev/null 2>&1 \|\| { echo "FAIL $g"; fail=$((fail+1)); }; done; echo "failures: $fail"` | `0` | 3 min | `failures: 0` |
| `node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program` | `0` | 4 s | `Evidence-ledger immutability OK` |
| `TZ=UTC git log -2 --format='%H %cd' --date=iso-local` | `0` | <1 s | `f30a0c6a857e345b52370502a21ef133b6a671df 2026-09-23 22:21:12 +0000` — the §0.0 date correction |

---

## 4. Every planning-session observation, confirmed or refuted at source

Unchanged from `a1` §3. Re-derived from the downloaded artifacts; **nothing inherited**.

| Claimed | Verdict | Measured |
|---|---|---|
| job `shipped-boot` `success`, 30/30 steps `success` | **confirmed** | per-step conclusions from the jobs API |
| `journey.json` `passed: true` | **confirmed** | `journey.json` |
| tenant **a**: `distributed`, `succeeded`, verifier exit 0, tokens 8/618, sandbox `icnga1mdlhrayh683vwcl` | **confirmed** | `outcomes.a`; `verifier-a.txt` *"RESULT: PASS (mechanism)"* |
| tenant **b**: `distributed`, `succeeded`, verifier exit 0, tokens 8/597, sandbox `iw8yiqpx7b0drx4saibqj` | **confirmed** | `outcomes.b` |
| tenant **c** (control): `execution_owner=null`, run `failed`, no sandbox | **facts confirmed; framing narrowed — §8** | `outcomes.c` |
| each sandbox id appears in ITS OWN tenant's worker log | **confirmed** | the two `grep -c` sweeps in §3. Both ids also pass `E2B_SANDBOX_ID_SHAPE` (`scripts/lib/m1-shipped-boot.mjs`), which rejects every checked-in test double's id shape |
| env probe: `absent`, 18 classes, `present: []`, planted control `red: true` with the three named classes each detected as expected | **confirmed** | `env-probe-{a,b}.json`; `checked` counted = **18** |
| usage cardinality: 1 event per enabled tenant, `violations: []`, judged by `evaluateUsageCardinality`; 0 for the control | **confirmed** | `journey.json` `usage`; `evaluateUsageCardinality` exists and is called at `scripts/lib/m1-spine-assertions.mjs` |
| `capabilityProven: false` throughout — a PASS for `M1a` | **confirmed for a/b; refined for c** | a and b report `false`; the control reports **`null`** (no verifier ran). Immaterial to the verdict; recorded for precision |
| `costEventsForRun: 0`, `costUsd: null`; the priced row is NOT proven and `E3-F037` is not closed here | **confirmed** | `signals.cost` on a and b |

### 4.1 Beyond the planning session's list

1. ★★★ **DE-08 was measured, and metadata is REACHABLE** — §7.
2. ★★★ **The audit signal is empty**: `signals.audit.jobSubmitted: []` and `securityDenials: []` on
   both enabled tenants, while the gate text requires the operator-visible audit signals.
3. ★★★ **All 23 declared fault-matrix cases for this gate are `pending`** — §5.
4. The participating Organization's own key IS in the sandbox by design
   (`allowedPresent: ["ANTHROPIC_API_KEY"]`, `allowedMismatch: []`) — the accepted managed-shared
   model, recorded as the mitigation it is (§7).
5. **`observeRun` has 5 production callers** and real `claude_local` usage was parsed
   (`cachedInputTokens` 64287 for a, 77982 for b), so `WRK-018`'s producer works on real E2B — the
   evidence `E3-15-budget`'s register entry says its promotion waits on. The priced **row** is still
   not shown.

---

## 5. Failures — the clauses this gate requires and this run did not exercise

The gate requires the journey *"end to end — dispatch, distributed ownership, lease, secret
redemption, staged input, E2B create/execute/teardown, durable terminal, **cancellation, provider
failure, reconciliation and every cleanup path** — in a shipped CI boot, and record the
operator-visible **audit, cost and failure-classification** signals journey item 7 names."*

| # | Clause | Observed | Class |
|---|---|---|---|
| F-1 | **cancellation** | not exercised; `d2m.cancellation.leased_attempt` is `pending` | `harness` |
| F-2 | **provider failure** | not exercised; `d2m.provider_failure.e2b_create_refused` is `pending` | `harness` |
| F-3 | **reconciliation** | not exercised; `d2m.reconcile.daemon_restart_with_live_lease` is `pending`. The pre-journey `reconcile` step is a preflight closure pass whose own output says *"This flips no gate"* | `harness` |
| F-4 | **every cleanup path**, incl. E2B teardown | not exercised; all three `d2m.cleanup.sandbox_destroyed_on_*` are `pending`. No artifact records a sandbox teardown | `harness` |
| F-5 | **operator-visible audit signal** | **empty** on both enabled tenants | `harness` |
| F-6 | **cost signal** | `costEventsForRun: 0`, `costUsd: null`. The evidence's own note concedes the count is keyed to the usage event rather than the run, so 0 does not disprove a charge — but neither does it show one. **No priced row on real E2B; `E3-F037` is not closed by this run** | `harness` |
| F-7 | **cross-tenant denial in every gate profile (F10)** | not exercised; all nine `d2m.tenant.cross.*` and the four `d2m.tenant.legacy.*` cases are `pending`. `providerEvidence.rejected` = `{shape: 0, foreignLease: 0}` — zero rejections, because no hostile attempt was made | `harness` |
| F-8 | **control-tenant refusal as a declared case** | the refusal **is** observed (§8), but `d2m.tenant.control_refused` remains `pending` in the declaration | `harness` |
| F-9 | **the two cases at issue between this gate and the spine** | **Both unrun here, so both uncertified — but their routings differ and `a16` no longer conflates them.** **(i) `d1.reconcile.worker_startup_lease_probe` was WRONGLY routed away from the spine**: `DEP-018` allocates restart/reconciliation (`WRK-013`) to `M1-D1-SPINE`, and the spine's own `worker-b` runs with `AOA_WORKER_DISPATCH_ENABLED: "1"` via `docker/d1/m1-spine.override.yml:137`, so it was never structurally unavailable there (spine `a2` §0, carried into `a7` §0.1) — it is that record's REQUIRED failure. **(ii) `d1.provider.worker_terminal_mapping` is VALIDLY this lane's**: `DEP-018` allocates provider failure here, so only the *reason* its declaration gives is false, not its destination — and it is **pending and unfired on this lane**, which is this record's failure, not the spine's. ★ *Corrected in `a16`: this row called both routings invalid.* | `harness` |
| F-10 | **`d2m.credential.production_reader_company_predicate`**, routed here by `E6-D003` | `pending`. Uncertified by any campaign | `harness` |

**Root cause, one line, measured with a positive control (§3):**
`.github/workflows/m1-shipped-boot.yml` at the candidate has **no fault-matrix step**, and the
uploaded artifact contains no fault-matrix bundle. The `M1a-D2-MECHANISM` profile in
`tests/d1/fault-matrix.json` therefore stands at **23 declared, 23 `pending`, 0 fired**. Every `pending` row is properly formed — `pendingKind: "keyed"`, a reason and an owner — and the owners split **21 / 1 / 1**, counted at the candidate: **21** read `pendingOwner: "planning session (F8), on the DEP-015 lane"`; `d2m.credential.production_reader_company_predicate` reads `"planning session (F8), on the DEP-015 shipped-boot lane"`; and `d2m.tenant.cross.tool_calls` is `CLI-016`'s. So **22 cases are the planning session's to run on this lane and 1 needs a gate-owner disposition.** *Corrected in `a14`: `a13` quoted the first owner string for all 22.* ★ **The twenty-third is NOT owned there**:
`d2m.tenant.cross.tool_calls` is assigned to **`CLI-016` (M1b)**, because it needs an ARMED tool surface and
the frozen `M1a` configuration disarms it — so it needs a gate-owner disposition rather than a runner
(§11.1, precondition 2). *Corrected in `a13`: this attributed all 23 to the planning session.* All 23
are well-formed, so `check-campaign-fault-matrix.mjs`
is green — **the declaration is honest; the cases simply have not been run.**

**Why `fail` and not `blocked_external`.** `qa-handoff-recovery.md` §5 reserves `blocked_external`
for external prevention **before** a required campaign starts. This campaign started and completed;
keyed E2B was available and was used. There is no conditional pass and no waiver of a HARD invariant.

---

## 6. What the run DOES establish — at full strength

| ID | Class | Required | Observed | Result |
|---|---|---|---|---|
| `MECH-BOOT-1` | REQUIRED | shipped CI boot per F3 | dispatch-only, candidate-bound, three images built from source, CI-generated keypair with `signVerifyProbe: "pass"` | `pass` |
| `MECH-DISPATCH-1` | REQUIRED | distributed ownership per enabled tenant | `execution_owner: "distributed"` with job + attempt ids on a and b; `distributed_execution_selection` and `distributed_execution_handoff` events for each | `pass` |
| `MECH-LEASE-1` | REQUIRED | lease taken | `leaseCount: 1` per enabled tenant; leases `34519ffa-…` (a), `6b542298-…` (b); `polls: 1` each | `pass` |
| `MECH-SECRET-1` | REQUIRED | secret redemption | `credentialAuthority: "company_api_key"` for all three Organizations; `redeemedNames: ["ANTHROPIC_API_KEY"]` per enabled tenant | `pass` |
| `MECH-STAGE-1` | REQUIRED | staged input (`M1a` entry requires workspace staging) | the journey stages input and completes; `stageJobInputFiles` has 2 production callers and `E7-1-staged-input-write` is `wired` | `pass` |
| `MECH-E2B-1` | REQUIRED | **real** E2B create + execute | two real sandbox ids, each in its own worker's log, both passing `E2B_SANDBOX_ID_SHAPE`; runtimes 18 455 ms and 18 580 ms | `pass` |
| `MECH-TERM-1` | REQUIRED | durable terminal | one `terminal` event per enabled tenant, `status succeeded`, `exit_code "0"`, `projectionReceiptApplied: true`; `attemptStartedEvents: 1` | `pass` |
| `MECH-CLASS-1` | REQUIRED | failure classification recorded | success path only: `runStatus succeeded`, `terminalErrorCode null`, `placement_disposition "selected"`, `placement_reason_code "target_selected"`. **No failure was injected, so the classifier's failure arms are unexercised** | `pass` (success arm only) |
| `MECH-F10-1` | REQUIRED | per-tenant correctness with its own attribution | both verifiers exit 0 with `ok: true`; each tenant's `organizationId`/`companyId` match its own rows throughout | `pass` |
| `MECH-F10-2` | REQUIRED | the control Organization is refused | §8 | `pass` |
| `MECH-USAGE-1` | REQUIRED | exactly one usage event per enabled tenant, zero for the control | 1, 1, 0; `violations: []`; `evaluateUsageCardinality` | `pass` |
| `MECH-CAP-1` | REQUIRED | `capabilityProven=false` is acceptable and is the gate's defining property | `false` on both enabled tenants, `clause 6` stating output capture is UNBUILT (`CLI-008` Unit F) | `pass` |
| `MECH-CRED-1` | REQUIRED | live env-absence probe with a planted-canary positive control (`DEP-017`, F9) | §7 | `pass` |
| `H-06` | HARD | metadata / private / worker-control / control-plane denied incl. direct-IP, redirect, DNS-rebinding | **metadata measured REACHABLE**; other variants untested | **`recorded`, NOT `pass`** |

---

## 7. DE-08 residual, credential taxonomy, and H-06 — required by scope-triage

### 7.1 The DE-08 residual, measured

`de08MetadataResidual`, identical on both enabled tenants:

```
attempted: true   target: 169.254.169.254   reachable: true   httpStatus: 401   errorCode: null
note: "OBSERVED, not enforced: DE-08 is an accepted residual that leaves H-06 unmet;
       this is a record, not a claim."
```

**The cloud metadata endpoint is reachable from inside the sandbox.** The 401 is the endpoint
declining the request, not the network denying the packet. This is the accepted managed-shared
residual made concrete on a real provider, recorded as an unresolved provider-boundary risk — never
as a denial. At the candidate `createFenceAwareEgressProxy` has **zero production callers** and
`E5-6-denied-egress` is **`unwired`** (both re-measured, §3). **No sandbox-egress-denial claim is
made anywhere in this record.**

### 7.2 `H-06` is NOT passed

`H-06` requires metadata, private, worker-control and control-plane destinations to remain denied,
**including direct-IP, redirect and DNS-rebinding variants**. The DE-08 scope decision did **not**
amend it. Here the metadata destination was **reachable**, and the private, worker-control and
control-plane destinations plus the direct-IP, redirect and DNS-rebinding variants were **not probed
at all**. `H-06` is `recorded`, **not** `pass`. Full `D1`/`D2` and any `E6`/`E7` completion require
live evidence satisfying the current requirement or a separately approved normative amendment.
Neither exists. **This record is non-promoting.**

### 7.3 The credential-taxonomy mitigation

The residual is bounded by the credential taxonomy, and here the taxonomy is **enforced by a live
probe with a red positive control** (`DEP-017`, F9), not asserted. Per enabled tenant:

- `verdict: "absent"`, **18** classes checked: `datastore_credential`, `secrets_master_key`,
  `auth_signing_secret`, `source_control_token`, `subscription_login`, `provider_control_key`,
  `object_store_credential`, `worker_enrollment`, `oauth_client_secret`, `connector_token`,
  `embeddings_key`, `legacy_agent_key`, `host_control_plane_env`, `model_provider_key_not_allowed`,
  `unclassified_credential_shaped`, `cross_tenant_credential`, `provider_credential_value_mismatch`,
  `unredeemed_provider_credential`.
- `present: []`, `presentNames: []`, `allowedMismatch: []`.
- **Positive control `red: true`** — three canaries planted, each detected as its expected class:
  `DATABASE_URL` → `datastore_credential`; `OPENAI_API_KEY` → `cross_tenant_credential`;
  `ANTHROPIC_API_KEY` → `provider_credential_value_mismatch`; all `satisfied: true`. **A probe that
  cannot go red is not a probe; this one can, and did.**
- `allowedPresent: ["ANTHROPIC_API_KEY"]`, `redeemedNames: ["ANTHROPIC_API_KEY"]` — the
  participating Organization's own approved runtime credential, present by design, which is the
  accepted model: host, operator, control-plane, cross-tenant and unrelated connector credentials do
  not enter the sandbox.
- Redaction held: the step *"Scan the evidence AND the job log for job secrets and key material
  (fails the run on any match)"* passed.

**Its limits:** observed for the **two enabled tenants only** — the control tenant has no sandbox and
therefore no probe (`envProbe: null`). And it is a **credential** mitigation: it constrains what a
reachable network can be used to reach. It does not make the network denied, and it is not a partial
`H-06`.

---

## 8. The control tenant — what it proves, and what it does not

The control tenant's heartbeat run **failed**, with `error: "Command not found in PATH: \"claude\""`
and `error_code: "adapter_failed"`.

**What it proves:** the Organization was **refused** the distributed path —
`execution_owner: null`, `distributed_job_id: null`, `distributed_attempt_id: null`,
`jobsForOrganization: 0`, no `distributed_execution_selection` event, `usage.events: 0`, and the
control plane logging `rolloutState: "off"`. That is exactly the conjunction `classifyTenantOutcome`
(`scripts/lib/m1-shipped-boot.mjs`) requires of a `role: "control"` tenant, whose comment makes the
point: *"Refused for the RIGHT reason: the control plane itself resolved the rollout `off` for this
run. A legacy run for any other reason (a dead worker, a stale preflight) is not a control."*

**What it does NOT prove:** that the legacy path is healthy. The control's legacy run failed because
the `claude` CLI is not installed in the control-plane container — an environment fact of the CI
boot with nothing to do with the rollout decision. **Refusal is proven; legacy-path health is not
observed at all.** Nobody may cite this record for "the control tenant continued to work on the
legacy path."

Also structural: no env probe (`envProbe: null`) and no verifier verdict (`verdict: null`,
`capabilityProven: null`), because no sandbox is created. The `DEP-017` criterion-5 observation
covers the two enabled tenants only.

---

## 9. What this record does NOT establish — the full list

1. **Cancellation, provider failure, reconciliation and every cleanup path** — §5, F-1 to F-4.
2. **Cross-tenant denial on this gate** — §5, F-7. The only cross-tenant observation is that each
   sandbox id appears in its own worker's log and nowhere else: a separation *observation*, not a
   *denial* of a hostile attempt. Every hostile case on this gate is `pending`.
3. **A priced row on real E2B** — `costEventsForRun: 0`, `costUsd: null`. `E3-F037` is **not** closed
   by this run. The keyless spine lane shows one `cost_events` row per tenant at 83 cents on the
   **reference** provider — a different claim on a different provider.
4. **Any operator-visible audit signal on this lane** — `jobSubmitted: []`, `securityDenials: []`.
5. **`WRK-013`'s deployed-boot restart** and **the deployed worker's terminal mapping** — §5 F-9.
6. **Legacy-path health for the control tenant** — §8. Refusal only.
7. **Anything about tools.** The surface is off on every replica by design;
   `d2m.tenant.cross.tool_calls` is `pending` and is `M1b`/`CLI-016` work. The switch still has no
   per-Organization dimension.
8. **Anything about output.** `capabilityProven: false`, `workspacePatchArtifacts: 0`,
   `taskOutputs: 0`. The verifier's clause 6 says output capture is UNBUILT (`CLI-008` Unit F) and
   `E7-F018` (HIGH) remains open — `projectAcceptedOutput` reads 0 on every real run, so *"the bar is
   CLOSED rather than working"*. **`capabilityProven: false` is a PASS for `M1a` by the triage's own
   terms and is not among this record's failures.**
9. **This is not `D2` and not `M1-D2-CODING`.** A mechanism pass — and this is not even that — is
   never evidence for the capability gate under any wording.

---

## 10. Cleanup

The job's final step, *"Tear down (stack, volumes, keypair, secrets)"*, ran `success`. **Sandbox
termination is not evidenced**: no artifact records an E2B teardown, and all three
`d2m.cleanup.sandbox_destroyed_on_*` cases are `pending` (§5 F-4). Evidence was collected redacted
and scanned for secrets before upload; no credential values appear in this record. **`H-09`** (zero
provider resources remaining after the lane cleanup deadline) is **not** evidenced by this run.

---

## 11. Gate effect

- **Blocks** `M1a` exit criterion 3, and exit criterion 8 for the gate `M1a-D2-MECHANISM`: criterion
  8 requires a committed `Result: pass` QA record for **each partial gate the milestone names**, and
  this one is `fail`.
- **Promotes nothing.** `M1a-D2-MECHANISM` is **non-promoting**: it cannot complete `E7`, cannot
  support any useful-capability claim, and unlocks only `M1a`.
- **Satisfies, as evidence rather than as a gate verdict,** exit criterion 5's *"explicit observation
  of the dormant-egress residual and credential-taxonomy checks, without an egress-enforcement
  claim"* — §7, for the two enabled tenants. Criterion 5 is observation, and the observation was
  made.
- ★ **Companion record:** the current head of the **`M1-D1-SPINE`** `Supersedes` chain in this folder — the highest-attempt `./*-m1-d1-spine-m1a-candidate-7be35ae6b771-a*.md` (`a15` when this was written, and deliberately **not** pinned to it; see §0.0000000000000000), **`Result: fail`** on one REQUIRED assertion — the `WRK-013` restart/reconciliation case `DEP-018` allocates to it (§0.000000). **Both `M1a` gate records are `fail`, so exit criterion 8 is unmet on this candidate.** The spine needs one keyless case — run with a deliberately held live lease, not a bare restart. ★ **This lane needs its 22 RUNNABLE cases run, plus a gate-owner disposition for `d2m.tenant.cross.tool_calls`, which cannot run under the frozen `M1a` configuration at all, plus the `EVID-01` provider/template identifiers** (§11.1's three preconditions). *Corrected in `a12`: this read "its 23 declared cases to run".*
- **Ticket state at the candidate:** **`DEP-015` is `Status: complete`** at `7be35ae6b` (set by the
  distinct reviewer of attempt 2, re-affirmed at attempt 3 — §0.00 corrects `a1`–`a3`, which read a
  quoted historical line as the live status). **`DEP-017`** (`gate_review`, keyed acceptance pending)
  and **`WRK-018`** (`gate_review`) remain open. This run is the keyed acceptance both were waiting
  for, so each is now dispositionable — **by a distinct reviewer, not by this QA owner and not by the
  session that dispatched the run.** Until then, **exit criterion 1 is unmet**, on those two.

### 11.1 What a passing successor needs — and it CANNOT be on this candidate

★★★ **Read this first: `M1a-D2-MECHANISM` cannot be passed on `7be35ae6b7719877e61f54ab552de84de8491e7d`.** Every route below requires harness this revision does not contain, and `m1-shipped-boot.yml` checks out and **asserts** the named candidate (≈:116–128), so the change cannot be present in a run dispatched on it. Per `qa-handoff-recovery.md` §1, that change **creates a new candidate**, and §1's byte-identity carry-forward does not cover it — the change is to `.github/` and `tests/`, not a documentation-only disposition. *Rewritten in `a19`; `a11`–`a18` told an operator to change the harness and then run "on the candidate", which are contradictory instructions (§0.00000000000000000).*

**Step 0 — build the harness and promote the declaration, in one reviewed change.**

- Add a fault-matrix step to `m1-shipped-boot.yml` driving the `M1a-D2-MECHANISM` profile.
- ★ **In the same commit, promote the 22 runnable rows in `tests/d1/fault-matrix.json` from   `evidence: "pending"` to `required`.** Without this the campaign is a guaranteed red:   `check-campaign-fault-matrix.mjs` refuses *"a `pending` case that reported evidence"* and raises   `evidence:pending_case_reported` — *"rewrite the declaration rather than inherit a pass"*.   **Promoting a declaration is a reviewed act**, not a mechanical edit: each promoted row asserts   the case is now expected to fire on this lane.
- Leave `d2m.tenant.cross.tool_calls` **unpromoted** — see Step 2.

**Step 1 — freeze a NEW candidate.** Record the 40-character revision, topology, image digests, protocol-contract hash, provider/template identity (Step 3), configuration and feature-flag digests, the F10 tenant set, and the QA / gate / rollback owners, per `qa-handoff-recovery.md` §1. ★ **A fresh `M1-D1-SPINE` record is required on that same new candidate**: exit criteria 2 and 3 each demand a campaign on **one exact candidate**, and the spine record cited in §11 attests `7be35ae6b…`. The spine’s own outstanding case (§8) can be run in that same campaign.

**Step 2 — `d2m.tenant.cross.tool_calls` needs a DISPOSITION, not a runner.** It requires an **armed** tool surface, and the `M1a` freeze checklist disarms it on every replica (§2), so running it would violate the freeze this record certifies; the declaration already owns it to `CLI-016`/`M1b`. It requires either a **gate-owner amendment** reallocating it to `M1-D2-CODING` (where `d2c.tenant.cross.tool_calls` already sits), or an explicit reviewed **`pending` disposition** naming where it *is* satisfied. **Neither is a QA owner’s act.**

**Step 3 — close the `EVID-01` provider/template identity gap (§2.1).** The new run must capture an **immutable `aoa-base` identifier** (a template build id or image digest, not the template *name*, so a re-registration cannot change what the record attests) and the **E2B service version**, or a recorded gate-owner statement that none is obtainable and that `EVID-01` is met by the build id alone. The resolved SDK version is already pinned (`e2b@2.30.5`, §2.1).

**Step 4 — dispatch ONE keyed run on the NEW candidate**, under the **F8** envelope, covering the clauses the gate names: cancellation, provider failure, daemon-restart reconciliation, the three cleanup paths, the cross-tenant denial surfaces this configuration permits — lease, read, cancel, events, secrets, staged inputs, outputs, cost rows and the four legacy tables — each with a same-tenant positive control, plus `d2m.tenant.control_refused`, both `d2m.tenant.journey.*` arms, `d2m.credential.production_reader_company_predicate` and `d1.provider.worker_terminal_mapping` (validly this lane’s, §5 F-9).

**Step 5 — file the new candidate’s records**, each at attempt 1 for that revision. They do **not** supersede this chain: a different candidate is a different attestation, not a higher attempt.

**The alternative to all of it** is that the decision owner amends the gate’s clause list — a gate-owner action needing its own review, and a **narrowing of the bar**, to be recorded as such with an owner and never absorbed into a QA record.

★ **What needs no keyed spend.** `d1.reconcile.worker_startup_lease_probe` runs **keylessly on the spine lane**, whose `worker-b` already has dispatch enabled, because `DEP-018` allocates restart and reconciliation (`WRK-013`) to `M1-D1-SPINE` — subject to the live-lease requirement in the spine record’s §9.1, since a restart after a completed attempt reconciles an empty candidate store and would check nothing. ★★★ **`d1.provider.worker_terminal_mapping` may NOT be discharged there**: the same contract allocates provider failure to this gate, and a reference-provider run cannot discharge a real-E2B obligation.
