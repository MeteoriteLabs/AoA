# QA Result - `M1-D1-SPINE`, M1a candidate, `f8cdbe92e1cd`, attempt 21

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a21.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `21`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a20.md`
**Lane:** `M1-D1-SPINE`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `2026-09-25T15:11:13Z`
**Campaign end (UTC):** `2026-09-25T15:51:37Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner - a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## Topology and environment

GitHub Actions run [`36152472861`](https://github.com/MeteoriteLabs/AoA/actions/runs/36152472861)
ran workflow `D1 Merge Train` on branch `docs/replatform-program` at head SHA
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`; jobs `m1-spine`, `d1-merge-train`, and
`m1-fault-matrix` all concluded `success`.

Artifacts read:

- `d1-image-chain-36152472861`
- `m1-spine-evidence-36152472861`
- `m1-fault-matrix-evidence-36152472861`

Images:

- control-plane image: `localhost/aoa/control-plane:f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- control-plane digest: `sha256:d0a3cbfcafd53f30d869de95d334aaa42db6d084299d3239c42442fb2abf38a4`
- worker image: `localhost/aoa/worker:f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- worker digest: `sha256:069298056d2930a3a81cfac44285ad59745075b00fdd0792c2de8de0d6af170f`
- adapter-manager image: `localhost/aoa/adapter-manager:f8cdbe92e1cdc263876734d06618fae39a07e0ba`
- adapter-manager digest: `sha256:34c81e299abb2315ea3d0417a94739bddb06ecd919915abe8520ff6ccf1de9c6`
- object store: D1 source-built MinIO image retained in the D1 image-chain artifact.

Protocol contract (`docs/contracts/worker-protocol/v1/manifest.sha256`):

- `conformance.json`: `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`: `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

Topology/configuration:

- enabled tenant A: org `0d016a00-0000-4000-8000-00000000000a`, company `0d016a01-0000-4000-8000-00000000000a`
- enabled tenant B: org `0d016b00-0000-4000-8000-00000000000b`, company `0d016b01-0000-4000-8000-00000000000b`
- control tenant C: org `0d016c00-0000-4000-8000-00000000000c`, company `0d016c01-0000-4000-8000-00000000000c`
- executor: `worker`; one separately deployed worker executor; control-plane deployment mode `authenticated`
- rollout digest: `02cebb95542abbd49ff4b646d8ee1dc730ce584e49d6287c08b04f1160a9012f`
- rollout states: tenant A `canary`, tenant B `canary`, tenant C `off`
- crew rollout: `false`
- distributed tool surface: `false` for all three Organizations
- active target profile hash: `6edeaf5119809e4970a743eebe1aafcfceed77fe261a4b2495ecd98ec88d1b74`
- provider-constraint hash: `6806f456d41a7608b6cef8db6115d2c1e7f53781ffbcecceaf0031df12823e2f`
- enabled tenant A active input/policy digest: `dd2c53b8563a2af477a5dc6870b6c92246d6c983e3bedecf3b76e281b4aa8cfd`
- control tenant legacy input/policy digest: `c7ae207c727f8a6b3dd503ba13407000653801b62154fc5015ea58769c32d0a5`

Provider/template versions: this lane uses the D1 reference provider, not E2B; real-provider
template identity belongs to the mechanism lane.

### Frozen schedule and samples (D4/D6)

| Field | Value |
|---|---|
| Schedule manifest path | `not_applicable` |
| Schedule manifest SHA-256 | `not_applicable` |
| Timezone | `not_applicable` |
| Expected samples | `not_applicable` |
| Observed samples | `not_applicable` |
| Missing samples | `not_applicable` |
| Numerator | `not_applicable` |
| Denominator | `not_applicable` |
| Exclusion count and stable fault-window reasons | `not_applicable` |

## Commands

| Command | Exit code | Duration | Result summary |
|---|---:|---:|---|
| `gh run view 36152472861 --json url,headSha,conclusion,workflowName,event,createdAt,updatedAt,jobs` | `0` | `not_recorded` | Confirmed run success, branch, candidate SHA, and successful D1 jobs. |
| `gh run download 36152472861 --dir $env:TEMP/m1qa-36162184337/d1` | `0` | `not_recorded` | Downloaded D1 image-chain, spine, and fault-matrix evidence artifacts. |
| `node scripts/check-campaign-fault-matrix.mjs --evidence $env:TEMP/m1qa-36162184337/d1/m1-fault-matrix-evidence-36152472861/profile/m1-fault-matrix-evidence.json` | `0` | `not_recorded` | `M1-D1-SPINE`: `29/29` required cases fired and classified, `2` pending, profile incomplete only because pending rows remain declared pending. |

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `SPINE-RUN-META` | `REQUIRED` | Run must bind to candidate SHA on `docs/replatform-program` and complete successfully. | Run `36152472861`, event `push`, head SHA `f8cdbe92e1cdc263876734d06618fae39a07e0ba`, conclusion `success`; jobs `m1-spine`, `d1-merge-train`, and `m1-fault-matrix` success. | GitHub Actions run `36152472861`. | `pass` |
| `SPINE-EVID-01` | `REQUIRED` | Record image identity, protocol contract identity, topology, and config/policy hashes. | Image digests, protocol manifest hashes, tenant IDs, rollout digest, rollout states, target profile hash, provider constraint hash, and input/policy digests are recorded above. | `d1-image-chain-36152472861`; `m1-spine-evidence-36152472861/profile/m1-spine-evidence.json`; candidate `docs/contracts/worker-protocol/v1/manifest.sha256`. | `pass` |
| `SPINE-MATRIX` | `REQUIRED` | Every required D1 spine fault case fires and classifies as declared; zero violations. | `29/29` required cases fired and classified; `2` pending rows remain declared pending; zero violations. | `m1-fault-matrix-evidence-36152472861/profile/m1-fault-matrix-evidence.json`; checker command above. | `pass` |
| `SPINE-F10` | `REQUIRED` | Two enabled tenants, one control tenant, crew/tool surfaces off, rollout scoped to enabled tenants. | A/B enabled with rollout `canary`; C control `off`; `crewEnabled:false`; organization tool surface `false` for all three Organizations. | `m1-spine-evidence-36152472861/profile/m1-spine-evidence.json`. | `pass` |
| `SPINE-WORKER` | `REQUIRED` | Enabled work must execute through deployed worker, with a negative control that reds on non-deployed-worker execution. | Worker-driven run used one deployed worker executor; worker-driven verdict is empty for passing arm; negative-control verdicts are non-empty. | `m1-spine-evidence-36152472861/profile/m1-spine-evidence.json`. | `pass` |
| `SPINE-COST` | `REQUIRED` | Enabled tenant run emits usage/cost evidence and authoritative cost receipt. | Usage/cost rows recorded with `costCents:81`; `authoritative_cost` receipt applied. | `m1-spine-evidence-36152472861/profile/m1-spine-evidence.json`; passing bundle DB state. | `pass` |
| `SPINE-AUDIT` | `REQUIRED` | Mutating/job lifecycle evidence must be audit-visible. | `activity_audit`, `attempt_started`, `attempt_terminal`, and authoritative-cost receipts are present. | `m1-spine-evidence-36152472861/profile/m1-spine-evidence.json`; passing bundle DB state. | `pass` |
| `SPINE-ROLLBACK` | `REQUIRED` | Rollback rehearsal succeeds without failed cancellations. | `exitCode:0`, `organizationsScanned:3`, `cancelled:5`, `failedCancellations:[]`. | `m1-spine-evidence-36152472861/profile/m1-spine-evidence.json`. | `pass` |
| `SPINE-CRIT5` | `OBSERVED` | Stage-in-env observation is recorded and scoped. | `criterion5EnvProbe.observed:true`, scope `stage_in_env_only`, `logMessages:1`; other tenant guarded by profile tripwires. | `m1-spine-evidence-36152472861/profile/m1-spine-evidence.json`. | `recorded` |
| `SPINE-H06` | `HARD` | No promotion claim unless the H-06 residual is resolved. | H-06 remains recorded, not passed, under the accepted DE-08 residual. | D1 spine evidence and milestone plan residual notes. | `recorded` |
| `SPINE-EVID-RETENTION` | `REQUIRED` | Evidence artifacts retained on pass. | Image-chain, spine, and fault-matrix artifacts retained and downloaded for this audit. | `d1-image-chain-36152472861`; `m1-spine-evidence-36152472861`; `m1-fault-matrix-evidence-36152472861`. | `pass` |
| `SPINE-CLEANUP` | `REQUIRED` | Stack/test resources are torn down after the run. | D1 run completed successfully; logs show compose stack lifecycle, and the analogous shipped-boot teardown step is explicit for D2. No D1 cleanup failure was reported by the successful workflow. | GitHub Actions run `36152472861`; D1 job logs. | `pass` |

## Failures

None.

## Cleanup

The D1 workflow concluded `success` and retained the controlled evidence artifacts listed above. No
object cleanup, test database cleanup, or sandbox termination failure was observed in the D1 run or
artifacts.

## Gate effect

`M1-D1-SPINE` is certified as **pass** for candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`.

This is a non-promoting M1a partial-gate record. It does not certify M1b capability, real-provider
mechanism coverage, tools, output, or full D1/D2 milestone completion.
