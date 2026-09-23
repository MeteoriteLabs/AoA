# `E7-1-JOURNEY-ARM` — result

**Status:** `gate_review`
**Ticket:** `E7-1-JOURNEY-ARM` (E7, S, `M1a`) — promote the coding-journey clause when its two preconditions ship
**Implementer:** M1 planning session (Claude Opus 5), under founder delegation F2
**Reviewed revision:** `dd839129bf82347867180133029f242a0b4c9ed5` (the candidate the keyed run tested)
**Filed:** 2026-09-23

> ★★★ **This is an `M1a-D2-MECHANISM` record, not an `M1-D2-CODING` one.** Its verdict is the
> mechanism verdict. It never contributes to the capability gate, which a `capabilityProven=false`
> run **fails**. `capabilityProven=false` is a **PASS** for `M1a`: *"`M1a` explicitly does NOT claim
> useful agent capability, and a record that reports `capabilityProven=false` satisfies it."*

## 1. Both preconditions have committed passing evidence

The ticket may not be assigned until both do. They do:

| Precondition | Ticket | Evidence |
|---|---|---|
| The adapter-manager image built, signed and admitted in CI | **`DEP-014`** | `DEP-014-result.md`, `Status: complete` (independent review, PR #550). The D1 train builds, SBOMs, signs and admits all three images, with refusal controls. |
| The shipped CI boot lane that boots it and runs the journey (ruling F3) | **`DEP-015`** | `DEP-015-result.md` §12 — the keyed journey **run `35619555883`** on this candidate is green. |

The daemon consumer was already built and shipped inert
(`packages/worker-networked-host/src/bin/networked-host.ts`, DEP-011 Slice 2b-ii). This ticket built
neither precondition.

## 2. The register flip, with evidence

`scripts/gate-clause-wiring.json` → `E7-1-coding-journey`: `unwired` → **`wired`**, cited by symbol
`E2bSandboxProvider`, `expectedReferences: 4` **unchanged**.

`node scripts/check-gate-clause-wiring.mjs` after the flip:

```
gate-clause-wiring: OK (26 wired clause(s), 8 declared dormant, 2 provider-capability claim(s) matched to source)
```

The count the ticket typed out (4) is the count the checker found; nothing was edited to make it
agree. The clause left the dormant list, which now names 8 instead of 9.

## 3. The verifier's verdict on the milestone candidate

The lane runs `dist/cli/verify-e7-1-distributed-run.js` per enabled tenant inside the booted control
plane, which is `pnpm verify:e7-1-distributed-run`'s entry point.

| Tenant | Role | `execution_owner` | Run status | Verifier exit | `capabilityProven` | Real E2B sandbox |
|---|---|---|---|---:|---|---|
| a | enabled | `distributed` | `succeeded` | **0** | `false` | `iofom0nu25ztf3kc5tte1` |
| b | enabled | `distributed` | `succeeded` | **0** | `false` | `isqx7nvhgf40txm5vc4b6` |
| c | control | `null` — refused the distributed path | `failed` | — | — | none |

`journey.json`: `"passed": true`, mode `keyed`, template `aoa-base`.

**Verdict: PASS (mechanism).** Exit `0` is the corroborated mechanism, and `capabilityProven=false`
is expected and required to be read as a pass here, because `M1b` has not landed.

## 4. What this record does NOT say

- **Not a capability claim.** Nothing the agent produced reached AoA; Unit F's emit half is unbuilt.
- **Not legacy health.** Tenant c's own run `failed`; it evidences **refusal** of distributed routing
  (the F10 control), nothing more.
- **Not pricing.** `usage_json.costUsd` is `null` on both enabled tenants. No `cost_events` row is
  evidenced; that is `DEP-016`'s assertion and `E3-F037`'s remaining half.
- **Not tools.** `CLI-016`'s per-Organization tool surface is off in this lane.
- **Not the `M1a` gate record.** The `M1a-D2-MECHANISM` campaign is a separate record on the frozen
  `M1a` candidate; this is one ticket's evidence, filed under that gate.

## 5. Non-goals honoured

Built no image (`DEP-014`) and no boot (`DEP-015`); flipped no other clause; dispatched no keyed lane
outside the F8 envelope — the run cited here is F8's named `E7-1-JOURNEY-ARM` run, dispatched by the
planning session.

## 6. Commands

```
node scripts/check-gate-clause-wiring.mjs      # OK, 26 wired / 8 dormant (above)
pnpm verify:cp-am-keypair                      # run inside the lane: step "Verify the control-plane / adapter-manager keypair" = success (run 35619555883)
verify:e7-1-distributed-run                    # run inside the lane per tenant: exit 0 for a and b (above)
```

The full pure-node guard set and `check-evidence-immutability --base origin/docs/replatform-program`
are green on the commit that carries this record.

## 7. Reviewer section

**Pending.** A **distinct reviewer** must check this record against source and the cited run, and is
the only one who may set `Status: complete`.

**Reviewer:** M1 review-batch-3B independent reviewer (Claude Opus 5) — distinct from the M1 planning session that authored this record and dispatched the run
**Reviewed revision:** `60aafb32ec6f8316f92079789cf8814f981f3ed3`
**Disposition:** `approved`
**Attempt:** 1

### Independent review — attempt 1

**Disposition: `approved`.** Reviewed at the `docs/replatform-program` tip (the merge of PR #565).
The flip commit `be3051cba`, the candidate `dd839129bf82347867180133029f242a0b4c9ed5` and the
DEP-015 evidence commit `a64aea26c` are all ancestors of it.

**1. Both preconditions had committed passing evidence BEFORE the flip.** The ticket's bar, in the
E7 plan, is *"It may not be assigned until both have committed passing evidence"* — not that both
records be `complete`, and this record does not claim that they are.

- `DEP-014-result.md` is `Status: complete` at the reviewed revision, by independent review on
  PR #550.
- `DEP-015-result.md` §12, committed in `a64aea26c`, records the keyed journey run as met.
  `DEP-015` itself is still `gate_review` awaiting its own attempt-2 review; the record's §1 cites
  it by section and evidence, not by status, which is the accurate citation.
- **Ordering, measured.** `a64aea26c` (2026-09-23 04:38:18 +0530) precedes the flip commit
  `be3051cba` (04:40:51 +0530) and is its ancestor. The evidence was committed before the flip, not
  alongside or after it.

**2. The register flip.** `git show be3051cba -- scripts/gate-clause-wiring.json` changes exactly one
line, `"status": "unwired"` → `"wired"`. **`expectedReferences` is not in the diff**, so the number
was not edited to make the checker agree — which is what the ticket's Failure behavior demands
("If the wiring checker reports a reference count other than the typed-out 4, that is a finding, not
an edit to the number"). At `be3051cba` the register holds **26 wired and 8 dormant**, exactly the
counts §2 quotes. The clause's `expectedReferences` is `4`, and the two named construction seams
carry two non-comment references each — `packages/worker-keystore/src/bin/sandbox-provider.ts` (the
`readonly E2bSandboxProvider:` loader type and `new mod.E2bSandboxProvider(…)`) and
`packages/adapter-manager/src/bin/adapter-manager.ts` (the same pair) — four in total, with the
remaining occurrences in comments.
`node scripts/check-gate-clause-wiring.mjs` is OK at the reviewed tip (now 27 wired / 7 dormant,
because a later ticket promoted another clause; the clause under review is `wired` and off the
dormant list).

**The positive control the plan requires exists, and it bites — but this record does not cite it.**
The task section is explicit that the promotion RED cannot come from a deployment boot, and that the
control must come *"from a controlled checker fixture that raises the reference count above
`expectedReferences`"*. §2 shows only the green run. I located the fixture myself:
`scripts/lib/__tests__/gate-clause-wiring.test.mjs` drives `evaluateGateClauseWiring` with a
declared-`unwired` entry at `expectedReferences: 1` against a caller count of 2 and asserts the
single problem kind `unwired_but_now_has_caller`, and a second case does the same at the default
expectation of 0. `node --test` on that file gives **19 pass, 0 fail** at the reviewed tip. So the
acceptance item is **met at source**; what is missing is the citation, and the record would be
stronger for naming the fixture rather than leaving a reader to assume a green checker is
self-validating. Not blocking, because the control exists and I verified it rather than inferring it.

**3. The verifier's verdict, checked against the run rather than the record.** Run `35619555883`
(`workflow_dispatch`, *"M1 shipped CI boot (DEP-015)"*, headSha
`dd839129bf82347867180133029f242a0b4c9ed5`, conclusion `success`, single job `shipped-boot`
`106398898162` `success`). Its log's dispatch lines read:

- tenant a (enabled) `owner=distributed verifierExit=0 capabilityProven=false → PASS`
- tenant b (enabled) `owner=distributed verifierExit=0 capabilityProven=false → PASS`
- tenant c (control) `owner=null verifierExit=null capabilityProven=null → PASS`

I also downloaded the run's own evidence bundle (`m1-shipped-boot-keyed-35619555883`).
`journey.json` carries `"passed": true`, `"mode": "keyed"` and candidate
`dd839129bf82347867180133029f242a0b4c9ed5`. Tenants a, b and c hold **three distinct
`organizationId`s**, so the F10 evidence is a real multi-Organization run and not a re-labelled
single tenant. Tenant a's run is `succeeded` / `execution_owner: distributed`, tenant b's likewise.
Each enabled tenant's `providerEvidence.sandboxIds` names one sandbox, and **each sandbox id appears
only in that tenant's own worker log** — `iofom0nu25ztf3kc5tte1` in `logs-m1-worker-a.txt` and
`isqx7nvhgf40txm5vc4b6` in `logs-m1-worker-b.txt`, one occurrence each, neither in the other's.
`capabilityProven` is `false` on both, with a stated `capabilityFailures` clause 6 naming the
unbuilt output capture (`CLI-008` Unit F). §3's table is accurate in every cell.

**4. The "what this record does NOT say" list is accurate.** I checked the load-bearing item first.

- **Tenant c's own run FAILED, and the record says so.** `journey.json` gives tenant c
  `status: "failed"`, `execution_owner: null`, `error_code: "adapter_failed"`, with a distributed job
  id of `null`. What it evidences is that the control tenant was **refused the distributed path** —
  the F10 control — and nothing about the legacy path's health; its failure is in the legacy adapter
  after the refusal. The record states exactly that, and `DEP-015` §12 states it too and forbids any
  record from citing tenant c as legacy health. This is the single claim most likely to be
  mis-borrowed downstream, and both records fence it correctly.
- **Not pricing.** `usage_json.costUsd` is `null` on both enabled tenants in the bundle; the record
  says so and hands the assertion to `DEP-016` and `E3-F037`.
- **Not a capability claim, not tools, not the gate record.** Consistent with the verifier's own
  `capabilityProven=false` and with the `M1a-D2-MECHANISM` framing the task section mandates in
  those terms.

**5. `capabilityProven=false` is a PASS here, and the record frames it as the task requires.** The
triage's wording — *"`M1a` explicitly does NOT claim useful agent capability, and a record that
reports `capabilityProven=false` satisfies it"* — is quoted in the record's own banner, so no reader
can convert the mechanism verdict into a capability one.

**6. Non-goals honoured.** The flip commit touches only `scripts/gate-clause-wiring.json` and this
record. No image, no boot, no other clause. The run cited is F8's named `E7-1-JOURNEY-ARM` run,
dispatched by the planning session; I dispatched nothing.

**7. Guards.** The full `pr.yml` guard set minus the six excluded by the M1 rules, plus
`check-evidence-immutability --base origin/docs/replatform-program`, is **0 failures** at the
reviewed tip.

**Acceptance items, against the E7 plan's `### E7-1-JOURNEY-ARM`.** Both preconditions shipped with
committed passing evidence; the entry flips to `wired` cited by symbol, with evidence; the E7-1
verifier was run on the milestone candidate and its exit code recorded alongside `capabilityProven`;
`pnpm verify:cp-am-keypair` is recorded green inside the lane; the checker's reference count is the
typed-out 4 and was not edited; and the checker fixture control exists and bites. **Every acceptance
item is met.**

**Not blocking, noted.**

1. **A mis-citation of source, not of fact.** §3 says *"`journey.json`: `"passed": true`, mode
   `keyed`, template `aoa-base`"*. `journey.json` carries `passed` and `mode` but has **no
   `template` key**; `aoa-base` appears in the run as the `E2B_TEMPLATE` step env
   (log line `E2B_TEMPLATE: aoa-base`). The fact is true and I confirmed it at source — the
   attribution is what is loose. `DEP-015` §12 states the same pair in a table row without
   attributing it to `journey.json`, which is the safer wording.
2. **The positive control is met but uncited**, as above. A future reader should be pointed to
   `scripts/lib/__tests__/gate-clause-wiring.test.mjs` rather than to the green checker run.
3. The record is short, and deliberately so for an S ticket that builds nothing. Everything it does
   claim, it claims narrowly, and its §4 is the part that does the real work.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-3B independent reviewer (Claude Opus 5) | `60aafb32ec` (program tip, the #565 merge) | `approved` | Both preconditions had committed passing evidence BEFORE the flip: `DEP-014` is `complete`, and `DEP-015` §12 was committed in `a64aea26c` at 04:38, an ancestor of the flip `be3051cba` at 04:40. The flip diff changes only `status`; **`expectedReferences` is not in it**, and at that commit the register holds exactly the quoted 26 wired / 8 dormant. The two named seams carry two non-comment `E2bSandboxProvider` references each, so the measured count is the typed-out 4. The plan's required positive control — a checker fixture raising the count above `expectedReferences` — **exists and bites** (`scripts/lib/__tests__/gate-clause-wiring.test.mjs`, `unwired_but_now_has_caller`, 19 pass / 0 fail), though the record does not cite it. Run `35619555883` verified at source including its evidence bundle: `passed: true`, mode `keyed`, **three distinct `organizationId`s**, each enabled tenant's sandbox id appearing only in its own worker log, `capabilityProven=false` with a stated clause-6 reason. The §4 list is accurate — tenant c's own run is `failed` with `execution_owner: null` and `error_code: adapter_failed`, so it evidences refusal of distributed routing and not legacy health, exactly as written; `costUsd` is `null` on both enabled tenants. Guard set 0 failures. Noted, non-blocking: §3 attributes `template: aoa-base` to `journey.json`, which has no such key (it is the run's `E2B_TEMPLATE` step env — the fact is true, the attribution is loose); and the positive control is met but uncited. |
