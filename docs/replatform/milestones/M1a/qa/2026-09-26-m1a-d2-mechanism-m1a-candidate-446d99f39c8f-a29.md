# QA Result — `M1a-D2-MECHANISM`, M1a candidate, `446d99f39c8f`, attempt 29

**Date (UTC):** `2026-09-26`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-26-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a29.md`
**Scope slug:** `m1a-candidate`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `29`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a28.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `2026-09-25T20:39:51Z`
**Campaign end (UTC):** `2026-09-25T21:01:12Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** independent `M1a` QA reviewer. This session dispatched no workflow, keyed or keyless,
and wrote no milestone handoff.

---

## Why attempt 29 exists

PR #610's prior D2 head, attempt 28, failed the older candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba` because the keyed evidence lacked required mechanism
surfaces: incomplete mechanism profile, empty journey-local audit arrays, absent priced cost
evidence, and incomplete real-provider identity.

Candidate `446d99f39c8f8f9bece2138252fe48c839fbc7a6` includes the follow-up repairs and has a
successful keyed shipped-boot run:

- Run: `https://github.com/MeteoriteLabs/AoA/actions/runs/36187103782`
- Workflow: `M1 shipped CI boot (DEP-015)`
- Head SHA: `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
- Conclusion: `success`
- Downloaded evidence:
  `C:\Users\TK\AppData\Local\Temp\aoa-m1a-keyed-36187103782\m1-shipped-boot-keyed-36187103782`

## Evidence Identity

From `candidate.json`:

- Mode: `keyed`
- Provider: `e2b`
- Requested template: `aoa-base`
- SDK package/version: `e2b@2.30.5`
- Service endpoint: `api.e2b.dev`
- Control-plane image digest:
  `sha256:fa3ce6e1013714151810a27196d95c455a85ef35879a45bd475708951fc2e873`
- Worker image digest:
  `sha256:53c75ded390f97cf2dd82ea9294100ef8bf4d9d63f25caf206e3d67eb95555c7`
- Adapter-manager image digest:
  `sha256:8ba2f03b0148c0c8b1e0d3dc562484c2cf89a856d67340dd0c85a3b16c12e283`
- Object-store image: `aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z`, built from
  `docker/d1/minio.Dockerfile`
- In-job keypair: Ed25519, sign/verify probe `pass`, public key SHA-256
  `1d73f5fbf85e5ec2428642fcd202e72fef265cc10c05da02463295e8f710f1bb`

Configuration hashes recorded in `candidate.json`:

- `.github/workflows/m1-shipped-boot.yml`:
  `2fdf666a39c93a0aa39042bc98717cb527a98d085ade788ebcb580a78b1d0e0b`
- `docker/m1-boot/docker-compose.m1-boot.yml`:
  `5320565a9324a0545a35b06f725f7b7e72c8cf016e36c3214abc5ce5461cf2c1`
- `scripts/m1-shipped-boot/journey.mjs`:
  `8e9cb5854671315b6d6ad1fde04c44943088193d06ebc4ee1f4f09f2b8149d6c`

The shipped-boot shape guard passed against this bundle:

`node scripts/check-m1-shipped-boot-shape.mjs C:\Users\TK\AppData\Local\Temp\aoa-m1a-keyed-36187103782\m1-shipped-boot-keyed-36187103782`

## Matrix Verdict

`fault-matrix-verdict.json`:

```json
{
  "profile": "M1a-D2-MECHANISM",
  "declared": 26,
  "required": 17,
  "pending": 9,
  "fired": 17,
  "complete": false
}
```

The 9 pending cases are explicitly accepted as out of this required matrix. This attempt does not
require zero pending. The passing bar is the approved matrix: all 17 required cases fired, with no
violations. `fault-matrix-verdict.json` reports `violations: []`.

The 17 required fired cases in `fault-matrix-bundle.json` are:

| Case | Observed classification |
|---|---|
| `d2m.tenant.journey.A` | `distributed_run_corroborated` |
| `d2m.tenant.journey.B` | `distributed_run_corroborated` |
| `d2m.tenant.control_refused` | `legacy_for_organization_disabled` |
| `d2m.tenant.cross.events` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.cross.read` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.cross.lease` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.cross.cancel` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.cross.secrets` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.cross.outputs` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.cross.staged_inputs` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.legacy.cost_events` | `filtered_by_query_predicate_not_rls` |
| `d2m.tenant.legacy.activity_log` | `filtered_by_query_predicate_not_rls` |
| `d2m.tenant.legacy.task_outputs` | `filtered_by_query_predicate_not_rls` |
| `d2m.tenant.legacy.provider_credentials` | `filtered_by_query_predicate_not_rls` |
| `d2m.tenant.cross.cost_rows` | `denied_with_same_tenant_positive_control` |
| `d2m.tenant.cross.tool_calls` | `denied_with_same_tenant_positive_control` |
| `d2m.credential.wrong_lease_redemption_refused` | `redemption_refused_on_foreign_lease_with_own_lease_control` |

## Journey Findings

From `journey.json`, enabled tenants `a` and `b` both passed:

- Tenant `a`: run `e304c2d3-f652-4ad8-be69-08731319f4a3`, distributed job
  `a69b51be-fe5e-4550-9e0e-067a1907b8d5`, attempt
  `485147a7-fb39-4605-a34b-e74c21378fef`, status `succeeded`.
- Tenant `b`: run `0d8191bb-1846-4b8a-b87c-604698c935fb`, distributed job
  `8af63bd5-bfd0-4fa4-b47b-897c929e3f5e`, attempt
  `23e33a4f-9a2f-4bf1-895b-451815319817`, status `succeeded`.
- Control tenant `c`: rollout state `off`, no distributed job or attempt, `jobsForOrganization: 0`.

Provider evidence is present for the two enabled tenants:

- Tenant `a`: sandbox `iboog24edlpawowii5qe1`, lease
  `afe77e35-5e03-4bec-b4a0-feb6239ab51e`.
- Tenant `b`: sandbox `iebq46cbo63k0q0g8b4zx`, lease
  `39aef7d2-5245-4020-803d-0934637a077f`.

Audit and cost evidence, the prior blockers, are now present and attempt-bound:

- Tenant `a`: `job.submitted`, `job.attempt_started`, `job.attempt_terminal`, two applied
  `activity_log` receipts, usage event `6edd4208-1609-419a-9c77-5b2901c0a2ff`, cost event
  `3561ef59-2872-4ee0-918c-2690c4ca2f3e`, and applied `cost_events` receipt keyed as
  `cost:2198379f-ae35-45d4-b5d3-44cbca2eb1d2:6edd4208-1609-419a-9c77-5b2901c0a2ff`.
- Tenant `b`: `job.submitted`, `job.attempt_started`, `job.attempt_terminal`, two applied
  `activity_log` receipts, usage event `57e94f32-0b82-4c77-85c4-a4d24823ec37`, cost event
  `60f07251-52d9-4db9-a27c-cc0cdf85c666`, and applied `cost_events` receipt keyed as
  `cost:b2ddd33a-e899-4283-b010-c5a51568fc8b:57e94f32-0b82-4c77-85c4-a4d24823ec37`.

Both enabled tenants have `envProbe.pass: true`. The probe reports the full expected credential
class set absent, with the participating `ANTHROPIC_API_KEY` redeemed as the allowed runtime
credential. The planted canary control went red for `DATABASE_URL`, `OPENAI_API_KEY`, and
`ANTHROPIC_API_KEY` mismatch.

## Residuals and Non-Claims

- `H-06` is still **recorded, not passed**. The metadata endpoint was reachable with HTTP 401 in the
  real provider sandbox, and the private / worker-control / control-plane destination variants were
  not fully denied by this record.
- `capabilityProven: false` remains expected for `M1a`; no output/capability promotion is claimed.
- The control tenant proves distributed-path refusal, not legacy-path health.
- Cleanup/H-09 is not promoted by this record beyond the successful workflow teardown step.

## Gate Effect

- `M1a-D2-MECHANISM` **passes** for candidate
  `446d99f39c8f8f9bece2138252fe48c839fbc7a6`.
- This pass is non-promoting: it does not complete `D2`, `E6`, `E7`, `M1-D2-CODING`, or useful
  output capability.
- The companion `M1-D1-SPINE` record for this same candidate is **fail / missing_evidence** because
  no same-candidate D1 spine run was found. Therefore this D2 pass alone does not satisfy M1a exit
  criterion 8.
