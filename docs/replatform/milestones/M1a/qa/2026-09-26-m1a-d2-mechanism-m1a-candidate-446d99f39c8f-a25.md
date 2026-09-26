# QA Result - `M1a-D2-MECHANISM`, M1a candidate, `446d99f39c8f`, attempt 25

**Date (UTC):** `2026-09-26`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-26-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a25.md`
**Scope slug:** `m1a-candidate`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `25`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a24.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `2026-09-25T20:39:51Z`
**Campaign end (UTC):** `2026-09-25T21:01:12Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner - a review session distinct from the planning session that took the
M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no workflow,
keyed or keyless, and wrote no milestone handoff.

---

## Run and retained evidence

This record audits the retained keyed GitHub Actions run
[`36187103782`](https://github.com/MeteoriteLabs/AoA/actions/runs/36187103782), workflow
`M1 shipped CI boot (DEP-015)`, branch `docs/replatform-program`, event `workflow_dispatch`, head
SHA `446d99f39c8f8f9bece2138252fe48c839fbc7a6`, conclusion `success`.

The single job, `shipped-boot`, completed successfully. The decisive steps all concluded `success`:

- candidate validation and bind-to-candidate;
- three images built from source, SBOM/sign/admit;
- source-built object-store image;
- CI-generated control-plane keypair and sign/verify probe;
- two control-plane replicas;
- three Organizations seeded;
- tenant set asserted on rendered and running replicas;
- Organization targets and workers enrolled;
- per-Organization reconcile and preflight;
- adapter-manager presign probe;
- real-provider journey;
- cross-tenant/cost/legacy/lease-binding cases;
- clause-5 redaction case, both arms;
- mechanism fault-matrix verdict;
- suppressed-injection positive control;
- evidence collection, job-log/evidence secret scan, upload, and teardown.

Evidence bundle reviewed at
`C:\Users\TK\AppData\Local\Temp\aoa-m1a-keyed-36187103782\m1-shipped-boot-keyed-36187103782`.

## EVID-01 identity

| Field | Value |
|---|---|
| Candidate | `446d99f39c8f8f9bece2138252fe48c839fbc7a6` |
| Mode | `keyed` |
| Provider | `e2b` |
| Requested template | `aoa-base` |
| SDK package/version | `e2b@2.30.5` |
| Service endpoint | `api.e2b.dev` |
| Control-plane image digest | `sha256:fa3ce6e1013714151810a27196d95c455a85ef35879a45bd475708951fc2e873` |
| Worker image digest | `sha256:53c75ded390f97cf2dd82ea9294100ef8bf4d9d63f25caf206e3d67eb95555c7` |
| Adapter-manager image digest | `sha256:8ba2f03b0148c0c8b1e0d3dc562484c2cf89a856d67340dd0c85a3b16c12e283` |
| Object store | `aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z`, built from `docker/d1/minio.Dockerfile` |
| Workflow config hash | `.github/workflows/m1-shipped-boot.yml` `2fdf666a39c93a0aa39042bc98717cb527a98d085ade788ebcb580a78b1d0e0b` |
| Compose config hash | `docker/m1-boot/docker-compose.m1-boot.yml` `5320565a9324a0545a35b06f725f7b7e72c8cf016e36c3214abc5ce5461cf2c1` |
| Journey script hash | `scripts/m1-shipped-boot/journey.mjs` `8e9cb5854671315b6d6ad1fde04c44943088193d06ebc4ee1f4f09f2b8149d6c` |
| CI keypair | generated in job; Ed25519; sign/verify `pass`; public key SHA-256 `1d73f5fbf85e5ec2428642fcd202e72fef265cc10c05da02463295e8f710f1bb` |

Protocol contract (`docs/contracts/worker-protocol/v1/manifest.sha256`) at the candidate:

- `conformance.json`: `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`: `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

## Tenant topology

| Tenant | Role | Organization | Result |
|---|---|---|---|
| `a` | enabled | `6a6ff0a1-b79e-4878-b4d5-231abc0a3808` | distributed run succeeded |
| `b` | enabled | `4651d76b-e0a2-4cb5-97d1-61fca6957e0c` | distributed run succeeded |
| `c` | control | `f24343a6-9bbd-4628-bb36-1e62b8486a2e` | distributed path refused; legacy run failed only because `claude` was not installed |

Both control-plane replicas, rendered and running, carried the exact enabled tenant set. Crew rollout
was `false`; the tool surface was null/off and recorded as `mustBeOff: off`.

Worker/target evidence:

- tenant A target `2e5ad185-c536-450a-98db-b21ad3993b19`, worker
  `94afd5a1-49e1-4470-8a40-04d14fbec29a`, live and enrolled;
- tenant B target `40629443-9d33-4dcb-b2d5-3ff74d49826c`, worker
  `461164da-a713-4a92-9c92-3d6ad66361eb`, live and enrolled;
- control target `52a95f2a-770c-499d-be25-a11a39f6ee52`, worker
  `324e0e52-2eb5-496b-a6cf-7f4faed7a1c0`, live and enrolled.

## Real E2B sandbox identity

| Tenant | Job | Attempt | Sandbox ID | Lease ID |
|---|---|---|---|---|
| `a` | `a69b51be-fe5e-4550-9e0e-067a1907b8d5` | `485147a7-fb39-4605-a34b-e74c21378fef` | `iboog24edlpawowii5qe1` | `afe77e35-5e03-4bec-b4a0-feb6239ab51e` |
| `b` | `8af63bd5-bfd0-4fa4-b47b-897c929e3f5e` | `23e33a4f-9a2f-4bf1-895b-451815319817` | `iebq46cbo63k0q0g8b4zx` | `39aef7d2-5245-4020-803d-0934637a077f` |

Both enabled tenants had `verifierExit: 0`, verdict `ok: true`, status `succeeded`, owner
`distributed`, and `projectionReceiptApplied: true`. `capabilityProven:false` is expected and
acceptable for M1a; useful output/capability remains M1b work.

## Matrix decision

The approved M1a-D2 mechanism matrix for this candidate is:

- `declared: 26`
- `required: 17`
- `pending: 9`
- `fired: 17`
- `violations: []`

The retained checker output was:

`profile M1a-D2-MECHANISM: 17/17 required case(s) fired and classified as declared, 9 pending. Profile INCOMPLETE (pending cases remain).`

For this gate, that is a **pass**. The approved matrix requires all 17 required cases to fire and
classify, while preserving 9 explicitly pending cases with kind/reason/owner. This record does not
impose a zero-pending requirement.

## Assertions and evidence

| Requirement ID | Class | Observed value | Evidence | Result |
|---|---|---|---|---|
| `MECH-RUN-META` | `REQUIRED` | Run `36187103782`, head `446d99f39c8f8f9bece2138252fe48c839fbc7a6`, conclusion `success`; all decisive shipped-boot steps successful. | GitHub Actions run metadata. | `pass` |
| `MECH-EVID-01` | `REQUIRED` | Candidate, image digests, protocol hashes, provider identity, SDK version, template name, config hashes, keypair identity, and object-store provenance recorded. | `candidate.json`; candidate protocol manifest. | `pass` |
| `MECH-F10` | `REQUIRED` | Two enabled tenants plus one control; exact tenant set on both replicas; crew/tool surfaces off. | `tenant-set-and-flags.json`; `targets.json`; `workers.json`. | `pass` |
| `MECH-JOURNEY` | `REQUIRED` | Enabled tenants A/B distributed runs succeeded; control tenant had no distributed owner/job/attempt and no cost/usage/audit events. | `journey.json`. | `pass` |
| `MECH-SANDBOX` | `REQUIRED` | Real E2B sandbox IDs recorded per enabled tenant and scoped to each tenant's worker log. | `journey.json`; `logs-m1-worker-a.txt`; `logs-m1-worker-b.txt`. | `pass` |
| `MECH-MATRIX` | `REQUIRED` | `17/17` required cases fired and classified; 9 pending cases explicitly retained under the approved matrix; zero violations. | `fault-matrix-bundle.json`; `fault-matrix-verdict.json`; checker output. | `pass` |
| `MECH-USAGE` | `REQUIRED` | Exactly one accepted usage event per enabled tenant and zero for the control; no cardinality violations. | `journey.json`. | `pass` |
| `MECH-COST` | `REQUIRED` | Enabled tenant A cost row `costCents:1`, model `claude-sonnet-4-6`, receipt `applied`, `aggregateKind: cost_events`, source identity `cost:2198379f-ae35-45d4-b5d3-44cbca2eb1d2:6edd4208-1609-419a-9c77-5b2901c0a2ff`; enabled tenant B cost row `costCents:1`, receipt `applied`, source identity `cost:b2ddd33a-e899-4283-b010-c5a51568fc8b:57e94f32-0b82-4c77-85c4-a4d24823ec37`. | `journey.json`; PRs #611-#613 repair and verify the key contract. | `pass` |
| `MECH-AUDIT` | `REQUIRED` | Per enabled tenant: `job.submitted`; `job.attempt_started`; `job.attempt_terminal`; two applied activity receipts bound to the run's event IDs and activity rows. | `journey.json`. | `pass` |
| `MECH-CROSS-TENANT` | `REQUIRED` | Cross-tenant events/read/lease/cancel/secrets/outputs/staged-inputs/cost/tool-calls and wrong-lease redemption cases fired with positive controls; suppressed-injection control went red. | `cross-tenant-observations.json`; `cross-tenant-suppressed.json`. | `pass` |
| `MECH-LEGACY-TABLES` | `REQUIRED` | Legacy cost/events/activity/task_outputs/provider_credentials cases filtered foreign rows and observed anti-vacuity rows. | `cross-tenant-observations.json`. | `pass` |
| `MECH-REDACTION` | `REQUIRED` | Planted canary was scrubbed on events and logs; suppressed arm did not fire; cross-tenant canary absent. | `redaction-observations.json`. | `pass` |
| `MECH-CRED-PROBE` | `REQUIRED` | Env probes A/B passed; 18 credential classes checked; present classes empty except allowed redeemed `ANTHROPIC_API_KEY`; planted controls red. | `env-probe-a.json`; `env-probe-b.json`. | `pass` |
| `MECH-SECRET-SCAN` | `REQUIRED` | Evidence and job-log secret/key-material scan step succeeded. | GitHub Actions step 30; retained redacted evidence bundle. | `pass` |
| `MECH-H06` | `HARD` | DE-08 metadata residual recorded as reachable HTTP `401`; no H-06 network-denial claim is made. | `env-probe-a.json`; `env-probe-b.json`. | `recorded` |
| `MECH-CLEANUP` | `REQUIRED` | Teardown step succeeded. | GitHub Actions step 32. | `pass` |

## Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `gh run view 36187103782 --repo MeteoriteLabs/AoA --json databaseId,headSha,headBranch,conclusion,status,event,name,workflowName,url,createdAt,updatedAt,jobs` | `0` | Confirmed successful candidate-bound run and successful job steps. |
| `node scripts/check-m1-shipped-boot-shape.mjs C:/Users/TK/AppData/Local/Temp/aoa-m1a-keyed-36187103782/m1-shipped-boot-keyed-36187103782` | `0` | Confirmed shipped-boot workflow shape: dispatch-only, candidate-bound, source-built/admitted images, keyed secrets gated, evidence retention and teardown. |
| `node scripts/check-campaign-fault-matrix.mjs --evidence C:/Users/TK/AppData/Local/Temp/aoa-m1a-keyed-36187103782/m1-shipped-boot-keyed-36187103782/fault-matrix-bundle.json` | `0` | Confirmed `17/17` required fired/classified, `9` pending, zero violations. |
| `node --test scripts/lib/__tests__/m1-shipped-boot.test.mjs` | `0` | `99/99` shipped-boot tests passed, including audit/cost receipt fail-closed controls. |

## Failures

None.

## Cleanup

The job's teardown step ran successfully after evidence upload. Secret/key material scan succeeded
before upload. No old evidence or QA record was modified.

## Gate effect

`M1a-D2-MECHANISM` is certified as **pass** for candidate
`446d99f39c8f8f9bece2138252fe48c839fbc7a6`.

This is a non-promoting M1a partial-gate record. It does not certify M1b useful capability, output
projection, tools, H-06 network denial, full D1, or full D2.
