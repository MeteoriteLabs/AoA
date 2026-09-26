# QA Result — `M1-D1-SPINE`, M1a candidate, `446d99f39c8f`, attempt 22

**Date (UTC):** `2026-09-26`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-26-m1-d1-spine-m1a-candidate-446d99f39c8f-a22.md`
**Scope slug:** `m1a-candidate`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `22`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a21.md`
**Lane:** `M1-D1-SPINE`
**Result:** `fail`
**Failure class:** `missing_evidence`
**Campaign start (UTC):** `not observed for this candidate`
**Campaign end (UTC):** `not observed for this candidate`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** independent `M1a` QA reviewer. This session dispatched no workflow, keyed or keyless,
and wrote no milestone handoff.

---

## Why attempt 22 exists

This attempt records the D1 half of the independent QA requested for candidate
`446d99f39c8f8f9bece2138252fe48c839fbc7a6`, after PR #610's prior record chain ended with a
`M1-D1-SPINE` pass on the earlier candidate `f8cdbe92e1cdc263876734d06618fae39a07e0ba`.

The new candidate has a successful keyed shipped-boot run:

- Run: `https://github.com/MeteoriteLabs/AoA/actions/runs/36187103782`
- Workflow: `M1 shipped CI boot (DEP-015)`
- Head SHA: `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
- Conclusion: `success`

That run is not a D1 spine run. Its job steps drive the `M1a-D2-MECHANISM` journey and matrix:
`Run the journey`, `Drive the M1a-D2-MECHANISM cross-tenant, cost, legacy-table and lease-binding
cases`, `Drive the M1a-D2-MECHANISM clause-5 redaction case`, and `Run the M1a-D2-MECHANISM fault
matrix over the journey's observations`.

## Evidence Read

Evidence bundle inspected in full:

`C:\Users\TK\AppData\Local\Temp\aoa-m1a-keyed-36187103782\m1-shipped-boot-keyed-36187103782`

Key files:

- `candidate.json`
- `journey.json`
- `fault-matrix-bundle.json`
- `fault-matrix-verdict.json`
- `reconcile-and-preflight.json`
- `tenant-set-and-flags.json`
- `workers.json`
- `targets.json`
- `env-probe-a.json`
- `env-probe-b.json`
- `redaction-observations.json`
- `cross-tenant-observations.json`
- `manifest-check-pre-boot.txt`
- `manifest-check-post-rollout.txt`

Repository/remote evidence:

- `gh run view 36187103782 --json name,event,headSha,headBranch,conclusion,status,createdAt,updatedAt,jobs,url`
- `gh run list --branch docs/replatform-program --limit 50 --json databaseId,name,workflowName,headSha,conclusion,status,createdAt,url`
- PR #610 metadata for the prior immutable QA records.

## Finding

No `D1 Merge Train` / `M1-D1-SPINE` run was found at
`446d99f39c8f8f9bece2138252fe48c839fbc7a6` in the inspected GitHub run list. The latest observed
D1 pass remains run `36152472861` at `f8cdbe92e1cdc263876734d06618fae39a07e0ba`, as recorded by
PR #610.

Because the QA record attests an exact revision, the older D1 pass cannot be re-used as a passing
D1 verdict for this later candidate. This is not a product failure and not a contradiction of the
older D1 measurement; it is missing same-candidate evidence for this gate.

## Gate Effect

- `M1-D1-SPINE` does **not** pass for candidate
  `446d99f39c8f8f9bece2138252fe48c839fbc7a6`.
- `M1a` exit criterion 8 remains unmet for this candidate because one named partial gate lacks a
  committed same-candidate `Result: pass` record.
- The companion `M1a-D2-MECHANISM` chain has a same-candidate passing attempt in this folder. That
  does not promote the D1 half.

## Passing Successor

Dispatch and retain a `D1 Merge Train` / `M1-D1-SPINE` campaign at
`446d99f39c8f8f9bece2138252fe48c839fbc7a6` or a later frozen candidate. If it passes, file the next
attempt on this chain with `Supersedes` naming this record.
