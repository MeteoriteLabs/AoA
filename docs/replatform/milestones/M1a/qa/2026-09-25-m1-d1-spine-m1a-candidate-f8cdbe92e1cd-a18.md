# QA Result — `M1-D1-SPINE`, M1a candidate, `f8cdbe92e1cd`, attempt 18

**Date (UTC):** `2026-09-25`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a18.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `18`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a17.md`
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

## 1. Verdict

`M1-D1-SPINE` **passes** on candidate `f8cdbe92e1cdc263876734d06618fae39a07e0ba`.

The gate is supported by GitHub Actions run
[`36152472861`](https://github.com/MeteoriteLabs/AoA/actions/runs/36152472861), workflow
`D1 Merge Train`, event `push`, branch `docs/replatform-program`, head SHA
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`, conclusion `success`. Jobs `m1-spine`,
`d1-merge-train`, and `m1-fault-matrix` all concluded `success`.

Artifacts read:

- `m1-spine-evidence-36152472861`
- `m1-fault-matrix-evidence-36152472861`
- `d1-image-chain-36152472861`

## 2. Candidate Identity

The D1 evidence is bound to the candidate by the run metadata (`headSha` =
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`) and the image-chain artifact. The D1 image-chain
artifact contains metadata, provenance, SBOMs, `digests.env`, and `trust-root.pub.pem` for the
control-plane, worker, and adapter-manager images.

This record does not rely on the older `7be35ae6b771...` attempt chain except as the superseded
history that identified the missing D1 worker-startup and terminal-mapping cases.

## 3. Matrix Evidence

The committed declaration check passed:

`scripts/check-campaign-fault-matrix.mjs` reported that `tests/d1/fault-matrix.json` declares 3 gate
profiles and 83 cases, with all F10 tenant-matrix surfaces present.

The evidence check against
`m1-fault-matrix-evidence-36152472861/profile/m1-fault-matrix-evidence.json` reported:

- profile: `M1-D1-SPINE`
- required cases fired and classified as declared: `29/29`
- pending cases remaining: `2`
- violations: `0`

The two pending cases are accepted declaration debt for this lane, not failed required cases. The
previous blocking cases are now covered: `d1.provider.worker_terminal_mapping` fired with
`observedClassification: worker_maps_provider_timeout_to_failed_terminal`; the worker-startup
reconcile case remains structurally documented in the declaration with its live blocker, while the
profile's required set is complete and violation-free.

## 4. Gate Requirements

**Topology and F10.** The spine profile ran the M1a tenant set with two enabled Organizations and one
control Organization. The control tenant remained on the legacy path; enabled tenants exercised the
distributed path. The tool surface and crew rollout remained off.

**Worker-driven spine.** `m1-spine-evidence.json` records one deployed worker (`deployedWorkerCount:
1`) as the executor. The worker-driven run succeeded, carried accepted worker events, and the
profile's `workerDriven` verdict list is empty. The `workerDrivenControl` negative-control verdicts
are non-empty, which proves the profile would red if a non-deployed worker produced the same events.

**Cost and audit.** The worker-driven run produced one usage event and one `cost_events` row:
`costCents: 81`, with source idempotency key
`cost:0d016a01-0000-4000-8000-00000000000a:42b0fe1a-6968-4a8a-90d8-bb87f9cb7408`.
It also records applied `activity_audit`, `attempt_started`, `attempt_terminal`, and
`authoritative_cost` receipts, plus activity rows `job.attempt_started` and `job.attempt_terminal`.

**Rollback rehearsal.** The `MIG-009` rollback rehearsal ran with `exitCode: 0`. The CLI summary
records `organizationsScanned: 3`, `cancelled: 5`, `skippedCount: 0`, and
`failedCancellations: []`, attributed to `operator-cli:m1-spine-845dbbe5`. The
`rollbackRehearsal` verdict list is empty.

**Criterion 5.** The worker-driven enabled tenant observed the DEP-017 env probe with
`observed: true`, `scope: stage_in_env_only`, and one log message. Other enabled tenants are
recorded through the profile's observability tripwires. This is the spine allocation of criterion 5;
template-baked and provider-host classes remain the mechanism lane's observation.

## 5. Limits

`H-06` is recorded, not passed. The accepted DE-08 residual remains: this milestone does not claim
default-deny sandbox egress. The D1 lane is non-promoting and does not certify M1b capability,
tools, output, or the full D1/D2 gates.

The D1 fault-matrix profile remains marked incomplete by the generic checker only because two cases
are still declared `pending`; the gate verdict here is based on the required M1a floor: all 29
required cases fired, every classification matched, and no evidence violation was reported.

## 6. QA Conclusion

`M1-D1-SPINE` is certified as **pass** for the frozen M1a candidate
`f8cdbe92e1cdc263876734d06618fae39a07e0ba`.
