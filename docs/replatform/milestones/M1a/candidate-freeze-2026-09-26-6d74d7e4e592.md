# M1a repaired candidate freeze

**Recorded (UTC):** `2026-09-26`
**Candidate:** `6d74d7e4e5929bc2377db58fd1a978963401d552`
**Integration branch:** `docs/replatform-program`
**Status:** pending independent freeze review; no campaign authorized until approval
**Purpose:** supersede the old `446d99f...` candidate for closure recovery, not a QA verdict

The candidate includes PR #620's implementation and PR #622's independent DEP-027
approval. PR #621 records the [ordered recovery](recovery-plan-2026-09-26.md).
No earlier-candidate run is carried forward. Automatic run `36253363996` is
pre-freeze diagnostic evidence only. This record must be committed and independently
approved before replacement campaigns start. Any code/configuration change requires
a new freeze. Later documentation dispositions do not change the named candidate.

## Ticket-result pins

Paths below are under `docs/replatform/epics/`. Each is top-level `complete` at the
candidate; historical subordinate status text is not a new disposition. These are
thirteen required results, plus DEP-027 successor evidence, not fourteen required
milestone tickets. No new acceptance approval is granted by this inventory.

| Ticket | Result path suffix | Git blob SHA |
|---|---|---|
| MIG-009 | E10-desktop-migration-realtime/tickets/MIG-009-wiring-result.md | `c82257da9899b26f9f60a73f423fd01e8d3911a5` |
| DAT-007-S3 | E5-workspaces-secrets/tickets/DAT-007-S3-result.md | `5e66a28f868bdfe8821bd19899e9f66d4f13f262` |
| E7-1-JOURNEY-ARM | E7-coding-e2b/tickets/E7-1-JOURNEY-ARM-result.md | `0afc60541607254fce86a1fd00e7e07be84c8d24` |
| WRK-013 | E4-worker-daemon/tickets/WRK-013-result.md | `d4c46a1b51923d3e7440cb0c3222a5b5b8e7d6ab` |
| WRK-018 | E4-worker-daemon/tickets/WRK-018-result.md | `ebad88a48cad04cf7b78f65d431cd4f1c989c6ea` |
| JOB-016 | E3-job-control/tickets/JOB-016-result.md | `339048ed6673665aefc5f3a1ad1ea97dac357948` |
| JOB-017 | E3-job-control/tickets/JOB-017-result.md | `568540de67215ae36283e165e41056143cf83717` |
| DEP-014 | E6-deployment-test-harness/tickets/DEP-014-result.md | `d5d7aa3f7dd70b0a63ebcc602a5cb3160cb946d7` |
| DEP-015 | E6-deployment-test-harness/tickets/DEP-015-result.md | `76d6735b118019acad657c1e42a25b4d1f8dac9c` |
| DEP-016 | E6-deployment-test-harness/tickets/DEP-016-result.md | `4f2f57b54b18317921fbbb6a35d8825a5c7fc80d` |
| DEP-017 | E6-deployment-test-harness/tickets/DEP-017-result.md | `e4dbd4b6221548321811adacc0945aab2c7feb02` |
| DEP-018 | E6-deployment-test-harness/tickets/DEP-018-result.md | `cc14feadef75b599e71020d94eac5aa20095fdef` |
| DEP-019 | E6-deployment-test-harness/tickets/DEP-019-result.md | `c8fd0b61c48a132d5f873be34e37add93dd5edcc` |
| DEP-027 (successor) | E6-deployment-test-harness/tickets/DEP-027-result.md | `247b2d1446b8f7245c519a6ea1e836f6ef74b329` |

## Configuration pins

Git blob hashes identify canonical committed bytes, not locally normalized copies.

| Repository path | Git blob SHA |
|---|---|
| docker-compose.d1.yml | `f6f47c21d9f6e25520782237b14d2d531f4b2673` |
| docker/d1/m1-spine.override.yml | `0cd5d837144f3843428c68295315da9aea978c60` |
| docker/d1/campaign.env | `4d3d0f2dbe26dd81aaf11a1c79a1e6d4a81eaa3b` |
| docker/d1/m1-spine-worker.profile.json | `75b882f5618c778f6b6440b108d0c62b51d0b87f` |
| docker-compose.staging.yml | `b45e411da9ca608f5e4da447f3b24f01f427a08b` |
| docker/m1-boot/docker-compose.m1-boot.yml | `904f94ed747c51717122159b91273fd0694ac1c7` |
| .github/workflows/d1-merge-train.yml | `da33625db2222c0e3495da9972b274a5df698407` |
| .github/workflows/m1-shipped-boot.yml | `8549a65649fdb563703fc5fe4da8a74bcfc94eab` |
| tests/d1/fault-matrix.json | `c3f6fc8417432e8fbe6b815eef30bd7c43fdd9b7` |
| docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md | `4d8a43a55d760bfa6fe84b91c8854082ea488643` |
| docs/contracts/worker-protocol/v1/manifest.sha256 | `a5198560282b95e922a955fc48ffa8fe2eb67140` |
| pnpm-lock.yaml | `205021e1a7a4be380827413f5f616a4a0c6c2e36` |

## Topology, versions and flags

D1 uses the committed Linux split-control-plane/worker topology, PostgreSQL, TLS
MinIO, Toxiproxy and fake provider. The spine/fault-matrix jobs apply the pinned
single-worker override; the foundation job uses `AOA_D1_CAMPAIGN=foundation`.
Worker protocol is v1. The fake-provider profile is `d1-fake-m1-spine`, version 1;
the profile blob above pins policy hash, provider digest, target and capability
ceilings. All source and provider build inputs are bound by the candidate tree.

Shipped boot builds control-plane, worker and adapter-manager from this candidate,
using staging plus the pinned M1 overlay. Provider is `e2b@2.30.5`, service endpoint
`api.e2b.dev`, requested template `aoa-base`. The remote service/template are not
content-addressed by these names: actual sandbox/template identifiers and any
available build/service version must be retained and explicitly graded under
EVID-01, never invented or copied from the prior run. The source-built object store
uses `RELEASE.2025-09-07T16-13-09Z`. Actual image digests and generated keypair/config
digests are run observations, to be checked against candidate labels before use.

Every campaign serves two enabled Organizations A/B and one disabled control C.
Rendered and running replica rollout sets must match. Crew and tool surfaces stay
off. Tenant UUIDs and per-run credentials/keypairs are freshly generated and their
non-secret configuration digests must be retained; no secret values enter records.
External requirements are GitHub-hosted Linux/Docker, repo GHCR access for D1,
CI signing/build dependencies and, only in the keyed mode, E2B/model-provider access
through the existing approved secret materialization path.

## Owners and dispatch conditions

Roles and identities are the explicit table in the committed recovery plan. The
planning session is partial-gate/rollback/decision owner and dispatcher under F2;
task `01a0dd9b-ba6d-79a2-8d96-9651bf242b4e` independently reviews this freeze and
authors campaign QA and audit; certifier `01a0de6b-915c-7fb0-b3d7-59e7bac3dc95`
must remain excluded from implementation, dispatch, decisions and evidence authorship.

To avoid branch-head drift, D1 dispatch uses a dedicated candidate ref
`codex/m1a-candidate-6d74d7e4e592` pinned to the exact candidate above. Check its
remote SHA immediately before dispatch and retained run head afterward. Do not
move this ref. Shipped boot is dispatched from the integration workflow with
`candidate=6d74d7e4e5929bc2377db58fd1a978963401d552`, first `mode=keyless`, then
one `mode=keyed` under the named F8 M1a-D2-MECHANISM authorization after preflight.
Its workflow head may contain later docs; runtime checkout and image labels must
equal the named candidate. No duplicate campaign may be active or already complete.

Rollback is the reviewed MIG-009 fleet drain trigger with actor-attributed per-attempt
cancellation audit, then disable Organization rollout. Failure does not authorize
extra paid dispatches. The freeze reviewer must verify ancestry, all pins, declaration,
finding/citation/ticket guards and immutable history before approval. M1a remains
`fail` until new campaign records, separately certified audit and superseding handoff.
