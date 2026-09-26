# QA Result — `M1-D1-SPINE`, M1a candidate, `f8cdbe92e1cd`, attempt 20

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a20.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `20`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a19.md`
**Lane:** `M1-D1-SPINE`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `2026-09-25T15:11:13Z`
**Campaign end (UTC):** `2026-09-25T15:51:37Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## 1. Why Attempt 20 Exists

Attempt 19 failed the gate on an identity gap that was not real. Codex review of PR #610 pointed out
that the protocol-contract identity is present in the candidate tree at
`docs/contracts/worker-protocol/v1/manifest.sha256`, and that `EVID-01` requires topology and
configuration identity, not one aggregate digest. I confirmed both at source.

Attempt 19 is superseded. `M1-D1-SPINE` passes on this candidate.

## 2. Run Evidence

GitHub Actions run [`36152472861`](https://github.com/MeteoriteLabs/AoA/actions/runs/36152472861):

- workflow: `D1 Merge Train`
- event: `push`
- branch: `docs/replatform-program`
- head SHA: `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- conclusion: `success`
- jobs: `m1-spine`, `d1-merge-train`, and `m1-fault-matrix` all `success`

Artifacts read:

- `d1-image-chain-36152472861`
- `m1-spine-evidence-36152472861`
- `m1-fault-matrix-evidence-36152472861`

## 3. EVID-01 Identity

Images:

- control-plane image:
  `localhost/aoa/control-plane:f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- control-plane digest:
  `sha256:d0a3cbfcafd53f30d869de95d334aaa42db6d084299d3239c42442fb2abf38a4`
- worker image:
  `localhost/aoa/worker:f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- worker digest:
  `sha256:069298056d2930a3a81cfac44285ad59745075b00fdd0792c2de8de0d6af170f`
- adapter-manager image:
  `localhost/aoa/adapter-manager:f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- adapter-manager digest:
  `sha256:34c81e299abb2315ea3d0417a94739bddb06ecd919915abe8520ff6ccf1de9c6`
- object store: D1 MinIO source-built image retained in the D1 image-chain artifact.

Protocol contract (`docs/contracts/worker-protocol/v1/manifest.sha256`):

- `conformance.json`:
  `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`:
  `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

Topology/configuration:

- one control-plane replica in the `m1-spine` profile;
- one separately deployed worker executor;
- two enabled Organizations and one control Organization;
- rollout digest:
  `02cebb95542abbd49ff4b646d8ee1dc730ce584e49d6287c08b04f1160a9012f`;
- rollout states: tenant A `canary`, tenant B `canary`, tenant C `off`;
- crew rollout: `false`;
- distributed tool surface: off for all three Organizations;
- active target profile hash:
  `6edeaf5119809e4970a743eebe1aafcfceed77fe261a4b2495ecd98ec88d1b74`;
- provider-constraint hash:
  `6806f456d41a7608b6cef8db6115d2c1e7f53781ffbcecceaf0031df12823e2f`;
- enabled tenant A active input/policy digest:
  `dd2c53b8563a2af477a5dc6870b6c92246d6c983e3bedecf3b76e281b4aa8cfd`;
- control tenant legacy input/policy digest:
  `c7ae207c727f8a6b3dd503ba13407000653801b62154fc5015ea58769c32d0a5`.

Provider/template versions: this lane uses the D1 reference provider, not E2B; the mechanism lane
owns the real-provider template identity question.

## 4. Gate Evidence

`scripts/check-campaign-fault-matrix.mjs --evidence
m1-fault-matrix-evidence-36152472861/profile/m1-fault-matrix-evidence.json` reported:

- profile: `M1-D1-SPINE`
- required cases fired and classified as declared: `29/29`
- pending cases: `2`
- evidence violations: `0`

The two pending cases remain pending in the declaration, but no required M1a spine case is missing or
misclassified.

The spine profile records:

- worker-driven run succeeded with one deployed worker executor;
- worker-driven negative control is non-empty, proving the evidence would red on non-deployed-worker
  execution;
- usage event and cost row emitted for enabled tenants (`costCents: 81`);
- `activity_audit`, `attempt_started`, `attempt_terminal`, and `authoritative_cost` receipts applied;
- rollback rehearsal passed: `exitCode: 0`, `organizationsScanned: 3`, `cancelled: 5`,
  `failedCancellations: []`;
- criterion-5 stage-in-env observation recorded for the worker-driven tenant, with other enabled
  tenant observability guarded by the profile tripwires.

## 5. Limits

`H-06` is recorded, not passed. The accepted DE-08 residual remains. This is a non-promoting M1a
partial-gate record and does not certify M1b capability, tools, output, or the full D1/D2 gates.

## 6. QA Conclusion

`M1-D1-SPINE` is certified as **pass** for candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`.
