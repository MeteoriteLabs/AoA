# QA Result — `M1a-D2-MECHANISM`, M1a candidate, `f8cdbe92e1cd`, attempt 25

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a25.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `25`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a24.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `2026-09-25T16:39:51Z`
**Campaign end (UTC):** `2026-09-25T17:01:33Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## 1. Verdict

`M1a-D2-MECHANISM` **passes** on candidate `f8cdbe92e1cdc263876734d06618fae39a07e0ba`.

The gate is supported by GitHub Actions run
[`36162184337`](https://github.com/MeteoriteLabs/AoA/actions/runs/36162184337), workflow
`M1 shipped CI boot (DEP-015)`, event `workflow_dispatch`, branch `docs/replatform-program`, head SHA
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`, conclusion `success`. The single job
`shipped-boot` concluded `success`.

The free rehearsal on the same candidate also passed:
[`36153039186`](https://github.com/MeteoriteLabs/AoA/actions/runs/36153039186), mode `keyless`,
head SHA `f8cdbe92e1cdc263876734d06618fae39a07e0ba`, conclusion `success`.

Artifacts read:

- `m1-shipped-boot-keyed-36162184337`
- `m1-shipped-boot-keyless-36153039186`

## 2. Candidate Identity

The keyed artifact `candidate.json` records:

- candidate: `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- mode: `keyed`
- CI-generated control-plane keypair: `signVerifyProbe: pass`
- control-plane image digest:
  `sha256:8dc2a79ed32748f2a6721a628e20a486d8b2ee90fbd319431830dcfeb60fb0db`
- worker image digest:
  `sha256:90f218fd3dc86af1c5383153fd1f7f342b19b7e844b55c45b3d21f79a5983964`
- adapter-manager image digest:
  `sha256:5204ef8b68aac9f0320cd9e9ccacb897fd4ff68810bb5b8c21bf17a76d8d450a`
- object store built from `docker/d1/minio.Dockerfile`

The freeze flags in `tenant-set-and-flags.json` show the exact two enabled Organizations plus one
control Organization, with crew rollout false and the distributed tool surface off on every
rendered and running control-plane replica.

## 3. Matrix Evidence

`scripts/check-campaign-fault-matrix.mjs` passed both the declaration and the keyed evidence bundle:

- profile: `M1a-D2-MECHANISM`
- declared cases: `26`
- required cases: `17`
- required cases fired and classified as declared: `17/17`
- pending cases: `9`
- evidence violations: `0`

`scripts/check-cross-tenant-suppression.mjs` passed for both the keyless rehearsal and the keyed run:
the suppressed run reported all 14 driver-owned required `M1a-D2-MECHANISM` cases with
`injectionFired: false`.

The generic matrix summary reports `complete: false` because nine cases are intentionally still
declared `pending`. This is expected for the M1a floor and is not reinterpreted as a pass for those
cases. In particular, `d2m.redaction.planted_canary_scrubbed` is no longer silently inferred: the
keyed run includes a direct redaction observation for the D2 mechanism profile, while the stronger
M1b/Coding floor remains pending where the declaration says it is pending.

## 4. Gate Requirements

**Keyed real-provider journey.** `journey.json` records two enabled tenant runs, `a` and `b`, both
with `execution_owner: distributed`, distributed job and attempt ids, `status: succeeded`,
`verifierExit: 0`, and `verdict.ok: true`. `capabilityProven: false` is preserved and accepted for
M1a. The control tenant `c` has no distributed job or attempt and is classified as rollout `off`;
its legacy run failed because `claude` was absent in the boot container, so this record proves
distributed refusal, not legacy-path health.

**Tenant isolation.** `cross-tenant-observations.json` reports the required hostile cases with
same-tenant positive controls: events, read, lease, cancel, secrets, outputs, staged inputs,
cost rows, tool calls, and the four legacy-table surfaces (`cost_events`, `activity_log`,
`task_outputs`, `provider_credentials`) with anti-vacuity controls where required.

**Criterion 5.** `env-probe-a.json` and `env-probe-b.json` both pass. Each enabled tenant reports
`verdict: absent` across 18 credential classes, `present: []`, and planted controls red for
`DATABASE_URL`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY`. The participating Organization's own
redeemed `ANTHROPIC_API_KEY` is allowed by design. The DE-08 metadata residual is observed:
`169.254.169.254` is reachable with HTTP `401`; this is recorded, not claimed as egress denial.

**Redaction.** `redaction-observations.json` reports
`d2m.redaction.planted_canary_scrubbed` with `injectionFired: true`,
`observedClassification: canary_scrubbed_while_unseeded_twin_leaks`,
`redactedOnAllStreams: true`, replacement markers observed on both `events` and `logs`, non-zero
bytes on both streams, and `positiveControlPassed: true`. The suppressed arm reached `succeeded` and
remained unfired.

**Usage, audit, and cost.** Each enabled tenant produced exactly one usage event and zero usage
violations; the control tenant produced zero. The keyed journey records `jobSubmitted: []`,
`securityDenials: []`, and `costEventsForRun: 0` because the keyed journey records usage while the
M1a cost-row and audit-row assertions are made by the D1 spine profile on the same candidate. The
companion `M1-D1-SPINE` attempt 18 records the authoritative cost row and activity audit receipts.

## 5. Limits

`H-06` is recorded, not passed. Metadata was reachable from the real sandbox, and private,
worker-control, control-plane, direct-IP, redirect, and DNS-rebinding variants are not certified
here. The accepted DE-08 residual remains unresolved.

This gate does not prove M1b output or coding capability. `capabilityProven: false`,
`workspacePatchArtifacts: 0`, and `taskOutputs: 0` remain the expected M1a posture.

The nine pending cases remain pending exactly as declared; this record certifies the required M1a
mechanism floor, not the later M1b/Coding floor.

## 6. QA Conclusion

`M1a-D2-MECHANISM` is certified as **pass** for the frozen M1a candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`.
