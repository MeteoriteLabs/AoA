# QA Result - `M1-D1-SPINE`, M1a candidate, `446d99f39c8f`, attempt 18

**Date (UTC):** `2026-09-26`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-26-m1-d1-spine-m1a-candidate-446d99f39c8f-a18.md`
**Scope slug:** `m1a-candidate`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `18`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a17.md`
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

## What this attempt decides

This attempt supersedes the old `7be35ae6b771` D1 chain after the M1a candidate moved to
`446d99f39c8f8f9bece2138252fe48c839fbc7a6`.

The D1 spine pass is carried forward from the independently reviewed prior QA record prepared in
PR #610 for candidate `f8cdbe92e1cdc263876734d06618fae39a07e0ba`: GitHub Actions run
[`36152472861`](https://github.com/MeteoriteLabs/AoA/actions/runs/36152472861), workflow
`D1 Merge Train`, branch `docs/replatform-program`, with jobs `m1-spine`, `d1-merge-train`, and
`m1-fault-matrix` all successful.

The later candidate delta from `f8cdbe92e1cdc263876734d06618fae39a07e0ba` to
`446d99f39c8f8f9bece2138252fe48c839fbc7a6` is limited to the M1a shipped-boot evidence and
admission-audit/cost receipt repair:

- `scripts/lib/__tests__/m1-shipped-boot.test.mjs`
- `scripts/lib/m1-shipped-boot.mjs`
- `scripts/m1-shipped-boot/journey.mjs`
- `server/src/__tests__/job-admission-parity.integration.test.ts`
- `server/src/services/job-admission-bridge.ts`

That delta does not change the D1 spine campaign topology, D1 fault-matrix declaration, D1 workflow
shape, D1 reference-provider images, or the worker-protocol contract. The one production change
(`job-admission-bridge`) adds job-submission audit evidence used by the real-provider mechanism lane;
it does not weaken any D1 denial, lease, rollback, worker-driven, tenant-matrix, cost, or cleanup
assertion.

## Prior D1 evidence adopted

| Requirement ID | Class | Observed value | Result |
|---|---|---|---|
| `SPINE-RUN-META` | `REQUIRED` | Run `36152472861`, head `f8cdbe92e1cdc263876734d06618fae39a07e0ba`, conclusion `success`; `m1-spine`, `d1-merge-train`, and `m1-fault-matrix` successful. | `pass` |
| `SPINE-MATRIX` | `REQUIRED` | `29/29` required D1 spine cases fired and classified as declared; `2` explicitly pending rows remained pending and did not block the D1 pass. | `pass` |
| `SPINE-F10` | `REQUIRED` | Two enabled tenants plus one control tenant; enabled tenants in canary, control off; crew/tool surfaces off. | `pass` |
| `SPINE-WORKER` | `REQUIRED` | D1 work executed through the deployed worker path, with negative controls for non-worker execution. | `pass` |
| `SPINE-COST` | `REQUIRED` | Enabled tenant cost evidence and applied `authoritative_cost` receipts were present. | `pass` |
| `SPINE-AUDIT` | `REQUIRED` | Lifecycle and activity-audit evidence was present. | `pass` |
| `SPINE-ROLLBACK` | `REQUIRED` | MIG-009 rollback rehearsal succeeded: three Organizations scanned, five cancellations, no failed cancellations. | `pass` |
| `SPINE-CRIT5` | `OBSERVED` | Stage-in-env observation recorded and scoped; not an H-06 network-denial claim. | `recorded` |
| `SPINE-H06` | `HARD` | H-06 remains recorded, not passed, under the accepted DE-08 residual. | `recorded` |

## Additional verification for this superseding record

| Command | Exit code | Result summary |
|---|---:|---|
| `git diff --name-status f8cdbe92e1cdc263876734d06618fae39a07e0ba..446d99f39c8f8f9bece2138252fe48c839fbc7a6` | `0` | Confirmed the post-D1-pass delta is the five M1a shipped-boot/admission-audit files listed above. |
| `gh pr view 610 --repo MeteoriteLabs/AoA --json number,title,state,baseRefName,headRefName,body,files,url` | `0` | Confirmed prior independent QA PR #610 recorded `M1-D1-SPINE: pass` via attempt 21 and retained run `36152472861`. |

## Failures

None.

## Gate effect

`M1-D1-SPINE` is certified as **pass** for the M1a candidate
`446d99f39c8f8f9bece2138252fe48c839fbc7a6`, by adopting the immutable successful D1 run and
recording the bounded post-run candidate delta.

This is a non-promoting M1a partial-gate record. It does not certify M1b useful capability, real
E2B capability output, tools, H-06 network denial, full D1, or full D2.
