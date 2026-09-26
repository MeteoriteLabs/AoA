# QA Result - `M1a-D2-MECHANISM`, M1a candidate, `f8cdbe92e1cd`, attempt 28

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a28.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `28`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a27.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-25T16:39:51Z`
**Campaign end (UTC):** `2026-09-25T17:01:33Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner - a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## Topology and environment

This record audits the retained keyed run
[`36162184337`](https://github.com/MeteoriteLabs/AoA/actions/runs/36162184337) and the free
keyless rehearsal [`36153039186`](https://github.com/MeteoriteLabs/AoA/actions/runs/36153039186).
Both ran workflow `M1 shipped CI boot (DEP-015)` on branch `docs/replatform-program` at head SHA
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`; both concluded `success`.

Artifacts read:

- `m1-shipped-boot-keyed-36162184337`
- `m1-shipped-boot-keyless-36153039186`

Keyed candidate identity:

- mode: `keyed`
- keypair sign/verify probe: `pass`
- control-plane digest: `sha256:8dc2a79ed32748f2a6721a628e20a486d8b2ee90fbd319431830dcfeb60fb0db`
- worker digest: `sha256:90f218fd3dc86af1c5383153fd1f7f342b19b7e844b55c45b3d21f79a5983964`
- adapter-manager digest: `sha256:5204ef8b68aac9f0320cd9e9ccacb897fd4ff68810bb5b8c21bf17a76d8d450a`
- object store image: `aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z`
- object store build source: `docker/d1/minio.Dockerfile`, `builtFromSource:true`
- CI keypair public key SHA-256: `fdce73f3d01a54cd9a4688efbeb859e1c710b12f5884f35226790e38cc9e539f`

Protocol contract (`docs/contracts/worker-protocol/v1/manifest.sha256`):

- `conformance.json`: `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`: `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

Keyed topology/configuration:

- enabled tenant A: org `a2bb888f-5e27-4322-a078-2e47178cb027`, worker `m1-worker-a`
- enabled tenant B: org `67d46191-7673-42ae-be5d-690c7dc781f9`, worker `m1-worker-b`
- control tenant C: org `b908e08e-4ea6-42e9-9a90-799bdea060b1`, worker `m1-worker-c`
- control-plane replicas: two booted replicas; render and running assertions passed.
- workers: three, each enrolled on its own Organization target.
- crew rollout: `false`
- tool surface: null/off in rendered and running control-plane replica state.

Incomplete identity fields blocking a pass:

- immutable `aoa-base` template build identity was not recorded in the keyed artifact.
- E2B service version was not recorded in the keyed artifact.
- complete execution-target configuration hashes were not recorded in the keyed artifact.

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
| `gh run view 36162184337 --json url,headSha,conclusion,workflowName,event,createdAt,updatedAt,jobs` | `0` | `not_recorded` | Confirmed keyed run success, candidate SHA, and teardown/evidence steps. |
| `gh run view 36153039186 --json url,headSha,conclusion,workflowName,event,createdAt,updatedAt,jobs` | `0` | `not_recorded` | Confirmed keyless rehearsal success and candidate SHA. |
| `gh run download 36162184337 --dir $env:TEMP/m1qa-36162184337/keyed` | `0` | `not_recorded` | Downloaded keyed shipped-boot evidence artifact. |
| `gh run download 36153039186 --dir $env:TEMP/m1qa-36162184337/keyless` | `0` | `not_recorded` | Downloaded keyless shipped-boot evidence artifact. |
| `node scripts/check-cross-tenant-suppression.mjs --evidence $env:TEMP/m1qa-36162184337/keyless/m1-shipped-boot-keyless-36153039186/cross-tenant-suppressed.json` | `0` | `not_recorded` | All `14` driver-owned required M1a-D2-MECHANISM cases reported `injectionFired:false`. |
| `node scripts/check-campaign-fault-matrix.mjs --evidence $env:TEMP/m1qa-36162184337/keyed/m1-shipped-boot-keyed-36162184337/fault-matrix-bundle.json` | `0` | `not_recorded` | `M1a-D2-MECHANISM`: `17/17` required cases fired and classified, `9` pending, profile incomplete. |

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `MECH-RUN-META` | `REQUIRED` | Keyed run binds to candidate SHA and completes. | Run `36162184337`, workflow `M1 shipped CI boot (DEP-015)`, event `workflow_dispatch`, head SHA `f8cdbe92e1cdc263876734d06618fae39a07e0ba`, conclusion `success`. | GitHub Actions run `36162184337`; `m1-shipped-boot-keyed-36162184337`. | `pass` |
| `MECH-REHEARSAL` | `REQUIRED` | Free keyless rehearsal completes at same candidate. | Run `36153039186`, head SHA `f8cdbe92e1cdc263876734d06618fae39a07e0ba`, conclusion `success`; suppressed-control checker passed with 14 cases suppressed. | GitHub Actions run `36153039186`; `cross-tenant-suppressed.json`. | `pass` |
| `MECH-EVID-01` | `REQUIRED` | Full real-provider identity must include image identity, protocol contract identity, provider/template versions, and execution-target configuration hashes. | Image digests, object store source image, keypair hash, tenant topology, and protocol hashes are recorded; immutable `aoa-base` template build identity, E2B service version, and complete execution-target configuration hashes are missing. | `candidate.json`; `tenant-set-and-flags.json`; `tenants.json`; `workers.json`; candidate protocol manifest. | `fail` |
| `MECH-MATRIX-REQ` | `REQUIRED` | Required mechanism cases fire and classify as declared with zero violations. | `17/17` required cases fired and classified; violations `[]`. | `fault-matrix-verdict.json`; `fault-matrix-bundle.json`; checker command above. | `pass` |
| `MECH-MATRIX-COMPLETE` | `REQUIRED` | Mechanism profile complete: zero violations and zero pending rows, unless amended. | `declared:26`, `required:17`, `fired:17`, `pending:9`, `complete:false`. | `fault-matrix-verdict.json`; checker command above. | `fail` |
| `MECH-AUDIT` | `REQUIRED` | Keyed real-provider journey emits journey-local operator-visible audit evidence. | Enabled tenants A/B have `signals.audit.jobSubmitted:[]` and `signals.audit.securityDenials:[]`. | `journey.json`. | `fail` |
| `MECH-COST` | `REQUIRED` | Keyed real-provider journey emits priced-cost evidence for the run. | Enabled tenants A/B have one parsed usage event each but `signals.cost.costEventsForRun:0`. | `journey.json`. | `fail` |
| `MECH-F10` | `REQUIRED` | Two enabled tenants run distributed; control tenant refuses distributed path; crew/tool surfaces off. | A/B distributed runs succeeded with verifier exit `0`; C had no distributed job/attempt/owner and failed only legacy path due missing `claude`; crew false and tool surface off/null. | `journey.json`; `tenant-set-and-flags.json`. | `pass` |
| `MECH-CRIT5` | `REQUIRED` | Environment credential probes pass and planted controls red. | Env probes A/B `pass:true`, 18 classes checked, `present:[]`, allowed provider credential present; planted controls red for datastore, cross-tenant, and provider mismatch. | `env-probe-a.json`; `env-probe-b.json`. | `pass` |
| `MECH-REDACTION` | `REQUIRED` | Clause-5 redaction case fires and proves canary scrubbing on both streams. | `d2m.redaction.planted_canary_scrubbed` fired; logs/events scrubbed; `redactedOnAllStreams:true`; positive control passed. | `redaction-observations.json`. | `pass` |
| `MECH-CROSS-TENANT` | `REQUIRED` | Driver-owned cross-tenant mechanism cases have positive control and required observations. | 14 cases observed across events/read/lease/cancel/secrets/outputs/staged inputs/cost/tool calls plus legacy surfaces; wrong-lease redemption observed. | `cross-tenant-observations.json`; `cross-tenant-suppressed.json`. | `pass` |
| `MECH-H06` | `HARD` | No promotion claim unless the H-06 residual is resolved. | Real sandbox metadata endpoint was reachable with HTTP `401`; no denial is claimed for remaining H-06 destination variants. | `env-probe-a.json`; `env-probe-b.json`. | `recorded` |
| `MECH-CAPABILITY` | `OBSERVED` | M1a does not require full capability proof. | Enabled tenant verdicts are OK, but `capabilityProven:false` remains expected and non-blocking for M1a. | `journey.json`. | `recorded` |
| `MECH-CLEANUP` | `REQUIRED` | Stack, volumes, keypair, and secrets are torn down. | Keyed run step `Tear down (stack, volumes, keypair, secrets)` concluded `success`; keyless rehearsal same teardown step concluded `success`. | GitHub Actions runs `36162184337` and `36153039186`. | `pass` |
| `MECH-EVID-RETENTION` | `REQUIRED` | Evidence artifacts retained on pass/fail. | Keyed and keyless shipped-boot bundles uploaded and downloaded for this audit. | `m1-shipped-boot-keyed-36162184337`; `m1-shipped-boot-keyless-36153039186`. | `pass` |

## Failures

- `harness`: `MECH-EVID-01` is incomplete for the real-provider lane because the retained keyed
  artifact omits immutable `aoa-base` template build identity, E2B service version, and complete
  execution-target configuration hashes.
- `harness`: `MECH-MATRIX-COMPLETE` fails because `fault-matrix-verdict.json` reports
  `complete:false` with `9` pending mechanism rows.
- `harness`: `MECH-AUDIT` and `MECH-COST` fail because the keyed journey-local evidence has empty
  audit arrays and `costEventsForRun:0` for both enabled tenants.

## Cleanup

Keyed run step `Tear down (stack, volumes, keypair, secrets)` concluded `success` at
`2026-09-25T17:01:29Z`. Keyless rehearsal teardown concluded `success` at
`2026-09-25T15:33:38Z`. The controlled evidence artifacts listed above were retained and reviewed.

## Gate effect

`M1a-D2-MECHANISM` **does not pass** for candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`.

This blocks M1a exit criterion 8 and blocks milestone handoff. A passing successor needs complete
mechanism-profile evidence, keyed journey-local audit and priced-cost evidence, and full
real-provider `EVID-01` identity.
