# QA Result — `M1a-D2-MECHANISM`, M1a candidate, `f8cdbe92e1cd`, attempt 27

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a27.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `27`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a26.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-25T16:39:51Z`
**Campaign end (UTC):** `2026-09-25T17:01:33Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## 1. Why Attempt 27 Exists

Attempt 26 used an unsupported failure class (`evidence_incomplete`). Codex review of PR #610
correctly pointed out that the QA template only permits `none`, `product`, `harness`, `provider`, or
`environment`. Attempt 26 is superseded. The verdict remains **fail**, now classified as `harness`:
the retained campaign evidence and declaration do not yet exercise everything this gate requires.

## 2. Evidence That Passed

The free rehearsal passed:

- run: [`36153039186`](https://github.com/MeteoriteLabs/AoA/actions/runs/36153039186)
- workflow: `M1 shipped CI boot (DEP-015)`
- mode: `keyless`
- head SHA: `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- conclusion: `success`

The keyed campaign passed at the workflow level:

- run: [`36162184337`](https://github.com/MeteoriteLabs/AoA/actions/runs/36162184337)
- workflow: `M1 shipped CI boot (DEP-015)`
- mode: `keyed`
- head SHA: `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- artifact: `m1-shipped-boot-keyed-36162184337`
- conclusion: `success`

The keyed artifact records two enabled Organizations and one control Organization, real distributed
execution for the enabled tenants, distributed refusal for the control tenant, credential env probes
with planted controls red, and the D2 redaction case with both streams scrubbed and a passing
suppressed arm.

## 3. Blocking Findings

### MECH-F1 — The mechanism profile remains incomplete

`fault-matrix-verdict.json` reports:

- profile: `M1a-D2-MECHANISM`
- declared: `26`
- required: `17`
- pending: `9`
- fired: `17`
- complete: `false`
- violations: `[]`

The zero-violation result proves the 17 required rows fired and classified correctly. It does not
complete the profile. The checker defines completion as zero violations **and** zero pending cases.
The remaining pending cases still include mechanism-defining surfaces assigned to this gate by the
DEP-018 plan. They must be promoted and evidenced, or removed/reallocated by reviewed gate
amendment, before this gate can pass.

### MECH-F2 — The keyed journey lacks journey-local audit and priced-cost evidence

For enabled tenants `a` and `b`, `journey.json` records:

- `signals.audit.jobSubmitted: []`
- `signals.audit.securityDenials: []`
- `signals.cost.costEventsForRun: 0`
- one parsed usage event per tenant

The D1 spine lane records audit and cost rows on the reference-provider surface, but those rows are
not evidence that the keyed real-E2B mechanism journey emitted operator-visible audit or priced-cost
signals. The keyed mechanism gate must produce its own audit/cost evidence or explicitly receive a
reviewed gate amendment.

### MECH-F3 — Full EVID-01 identity is still incomplete for the real-provider lane

`candidate.json` records candidate, mode, image digests, and the CI-generated keypair. It does not
record a protocol-contract hash, immutable `aoa-base` template build identity, E2B service version,
or complete execution-target configuration hashes. Those identity fields remain required for a
passing real-provider gate record.

## 4. Non-Blocking Limits Still Recorded

`H-06` is recorded, not passed. The real sandbox reached the metadata endpoint with HTTP `401`, and
no denial is claimed for the remaining H-06 destination variants.

The control tenant proves distributed refusal only; its legacy run failed because `claude` was
absent from the boot container. No legacy-path health claim is made.

`capabilityProven: false` remains expected and non-blocking for M1a.

## 5. Gate Effect

`M1a-D2-MECHANISM` **does not pass** on candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`.

This blocks M1a exit criterion 8 for this gate and blocks the milestone handoff. A passing successor
needs complete mechanism-profile evidence, keyed journey-local audit and priced-cost evidence, and
full real-provider `EVID-01` identity.
