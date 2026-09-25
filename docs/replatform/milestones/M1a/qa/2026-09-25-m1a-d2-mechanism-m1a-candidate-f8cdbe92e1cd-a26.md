# QA Result — `M1a-D2-MECHANISM`, M1a candidate, `f8cdbe92e1cd`, attempt 26

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a26.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `26`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a25.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `fail`
**Failure class:** `evidence_incomplete`
**Campaign start (UTC):** `2026-09-25T16:39:51Z`
**Campaign end (UTC):** `2026-09-25T17:01:33Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## 1. Why Attempt 26 Exists

Attempt 25 was wrong. Codex review on PR #610 raised two P1 findings against the pass verdict, and I
confirmed both at source:

1. The `M1a-D2-MECHANISM` fault-matrix profile remains incomplete (`complete: false`) because nine
   cases are still pending, including mechanism-defining failure and cleanup cases.
2. The keyed real-E2B journey does not produce journey-local operator-visible audit or priced-cost
   evidence: `jobSubmitted: []`, `securityDenials: []`, and `costEventsForRun: 0`.

The third Codex identity finding also applies to this gate: `candidate.json` records images and the
CI-generated keypair, but not the complete `EVID-01` provider/template and protocol-contract
identity.

Attempt 25 is superseded. This attempt records the honest verdict: **fail**.

## 2. Evidence That Did Pass

The free rehearsal passed:

- run: [`36153039186`](https://github.com/MeteoriteLabs/AoA/actions/runs/36153039186)
- workflow: `M1 shipped CI boot (DEP-015)`
- event: `workflow_dispatch`
- mode: `keyless`
- head SHA: `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- conclusion: `success`

The keyed campaign passed at the workflow level:

- run: [`36162184337`](https://github.com/MeteoriteLabs/AoA/actions/runs/36162184337)
- workflow: `M1 shipped CI boot (DEP-015)`
- event: `workflow_dispatch`
- mode: `keyed`
- head SHA: `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- artifact: `m1-shipped-boot-keyed-36162184337`
- conclusion: `success`

The keyed artifact records two enabled Organizations and one control Organization, crew rollout off,
and the tool surface off. Both enabled tenant runs succeeded on distributed execution with
`verifierExit: 0`, `verdict.ok: true`, and `capabilityProven: false` as expected for M1a. The control
tenant was refused distributed execution (`execution_owner: null`, no distributed job or attempt).

Criterion 5 evidence is strong for the two enabled tenants: `env-probe-a.json` and
`env-probe-b.json` both report `pass: true`, `verdict: absent`, `present: []`, and planted controls
red for `DATABASE_URL`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY`.

The redaction probe is strong: `d2m.redaction.planted_canary_scrubbed` fired, scrubbed both `events`
and `logs`, observed scrubber markers on both streams, scanned non-zero bytes, and had a passing
suppressed arm.

## 3. Blocking Findings

### MECH-F1 — The mechanism profile is still incomplete

`fault-matrix-verdict.json` reports:

- profile: `M1a-D2-MECHANISM`
- declared: `26`
- required: `17`
- pending: `9`
- fired: `17`
- complete: `false`
- violations: `[]`

The zero-violation result proves that the 17 required rows fired and classified correctly. It does
not prove that the gate is complete. The governing checker defines
`summary.complete = out.length === 0 && summary.pending === 0`, and the E6 DEP-018 plan says a
profile remains incomplete while pending cases remain.

I previously treated the nine pending rows as acceptable M1a floor debt. That was a QA error. The
governing mechanism gate still names cancellation, provider failure, daemon reconciliation, cleanup,
credential/redaction, and tenant surfaces; pending rows in those families cannot be absorbed into a
pass record unless a reviewed gate amendment removes or reallocates them.

### MECH-F2 — The keyed journey lacks required audit and priced-cost evidence

For enabled tenant `a`, `journey.json` records:

- `signals.audit.jobSubmitted: []`
- `signals.audit.securityDenials: []`
- `signals.cost.costEventsForRun: 0`
- one usage event with parsed tokens

For enabled tenant `b`, the same pattern holds:

- `signals.audit.jobSubmitted: []`
- `signals.audit.securityDenials: []`
- `signals.cost.costEventsForRun: 0`
- one usage event with parsed tokens

The companion D1 spine profile records audit and cost rows on the reference-provider lane, but those
are different attempts on a different provider surface. They do not prove that the keyed real-E2B
journey produced the operator-visible audit and priced-cost signals required for this mechanism
gate.

### MECH-F3 — EVID-01 identity remains incomplete

`candidate.json` identifies the candidate, mode, image digests, and CI-generated keypair. It does not
record the protocol-contract hash, immutable `aoa-base` template build identity, E2B service
version, or complete execution-target configuration hashes. The superseded `7be35ae...` chain
already identified this class as a blocker; this candidate's artifact does not close it.

## 4. Non-Blocking Limits Still Recorded

`H-06` remains recorded, not passed. The metadata endpoint was reachable from the real sandbox with
HTTP `401`, and no denial is claimed for the remaining H-06 destination variants.

The control tenant proves distributed refusal only. Its legacy run failed because `claude` was absent
from the boot container, so no legacy-path health claim is made.

`capabilityProven: false` remains expected and non-blocking for M1a.

## 5. Gate Effect

`M1a-D2-MECHANISM` **does not pass** on candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`.

This blocks M1a exit criterion 8 for this gate, and therefore blocks the milestone handoff. A
passing successor must either:

- promote and fire the currently pending mechanism-profile cases, remove/reallocate them through a
  reviewed gate amendment, and produce complete `summary.complete: true` evidence; and
- produce keyed journey-local audit and priced-cost evidence for the enabled tenants; and
- record the full `EVID-01` identity fields.
