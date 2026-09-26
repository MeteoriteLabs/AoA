# QA Result — `M1-D1-SPINE`, M1a candidate, `f8cdbe92e1cd`, attempt 19

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a19.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `19`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a18.md`
**Lane:** `M1-D1-SPINE`
**Result:** `fail`
**Failure class:** `evidence_identity`
**Campaign start (UTC):** `2026-09-25T15:11:13Z`
**Campaign end (UTC):** `2026-09-25T15:51:37Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## 1. Why Attempt 19 Exists

Attempt 18 was too optimistic. Codex review on PR #610 raised a P1 that the record did not satisfy
`EVID-01` because the immutable record itself did not identify the full candidate identity. I
confirmed the finding at source. Attempt 18 is superseded.

This attempt keeps the behavioral measurements, but changes the gate verdict to **fail** because the
identity evidence is incomplete.

## 2. What Passed Behaviorally

GitHub Actions run [`36152472861`](https://github.com/MeteoriteLabs/AoA/actions/runs/36152472861)
ran on branch `docs/replatform-program` at head SHA
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`; jobs `m1-spine`, `d1-merge-train`, and
`m1-fault-matrix` all concluded `success`.

The D1 fault-matrix checker reported:

- profile: `M1-D1-SPINE`
- required cases fired and classified as declared: `29/29`
- pending cases remaining: `2`
- violations: `0`

The spine profile also contains the expected behavioral evidence:

- two enabled Organizations and one control Organization;
- distributed rollout `canary` for A and B, `off` for C;
- crew rollout false and tool surface off;
- worker-driven cost rows for enabled tenants (`costCents: 81`);
- applied `activity_audit`, `attempt_started`, `attempt_terminal`, and `authoritative_cost`
  receipts;
- rollback rehearsal `exitCode: 0`, `organizationsScanned: 3`, `cancelled: 5`,
  `failedCancellations: []`;
- criterion-5 stage-in-env observation for the worker-driven tenant.

## 3. Identity Evidence Re-Read

Artifacts read:

- `d1-image-chain-36152472861`
- `m1-spine-evidence-36152472861`
- `m1-fault-matrix-evidence-36152472861`

Identity values found:

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
- rollout digest:
  `02cebb95542abbd49ff4b646d8ee1dc730ce584e49d6287c08b04f1160a9012f`
- enabled tenant A active input/policy digest:
  `dd2c53b8563a2af477a5dc6870b6c92246d6c983e3bedecf3b76e281b4aa8cfd`
- control tenant legacy input/policy digest:
  `c7ae207c727f8a6b3dd503ba13407000653801b62154fc5015ea58769c32d0a5`
- active target profile hash:
  `6edeaf5119809e4970a743eebe1aafcfceed77fe261a4b2495ecd98ec88d1b74`
- provider-constraint hash:
  `6806f456d41a7608b6cef8db6115d2c1e7f53781ffbcecceaf0031df12823e2f`

Identity values **not found** in the retained artifacts:

- protocol-contract hash required by `EVID-01`;
- a single complete topology/configuration digest covering both `m1-spine` and `m1-fault-matrix`
  evidence, rather than scattered per-row digests.

The evidence rows contain `protocolVersion: 1`, but that is not the protocol-contract hash
`EVID-01` requires.

## 4. Gate Effect

`M1-D1-SPINE` remains behaviorally strong on candidate `f8cdbe92...`, but this QA attempt must be
`Result: fail` because the immutable evidence identity is incomplete. A passing successor needs a
record, or a retained artifact cited by the record, that identifies every `EVID-01` identity field:
image digests, protocol-contract hash, provider/template versions if applicable, feature flags,
topology, and configuration hashes.

This blocks M1a exit criterion 8 for this gate.
