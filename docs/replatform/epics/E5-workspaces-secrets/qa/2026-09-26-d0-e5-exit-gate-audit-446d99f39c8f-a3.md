# QA Result - D0 - E5 workspaces/secrets exit-gate audit - `446d99f39c8f` - a3

**Date (UTC):** `2026-09-26`
**Epic:** `E5-workspaces-secrets`
**Record path:** `docs/replatform/epics/E5-workspaces-secrets/qa/2026-09-26-d0-e5-exit-gate-audit-446d99f39c8f-a3.md`
**Scope slug:** `e5-exit-gate-audit`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `3`
**Supersedes:** `docs/replatform/epics/E5-workspaces-secrets/qa/2026-09-24-d0-e5-exit-gate-audit-7be35ae6b771-a2.md`
**Lane:** `D0`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `not_applicable`
**Campaign end (UTC):** `not_applicable`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**QA owner:** this independent review session. It is distinct from the M1 planning session that
took the decisions and dispatched the campaigns, from the session that froze `E5-A2-MATRIX`, and
from the sessions that authored the two consumed campaign records (founder ruling F2). This session
dispatched no workflow, keyed or keyless, and wrote no milestone handoff.

---

## 0. Scope and attempt allocation

This is the required successor audit for the final `M1a` candidate. Attempt `a2` remains an
immutable `fail` on candidate `7be35ae6b7719877e61f54ab552de84de8491e7d`; it is not edited or
reinterpreted. `EVID-02` requires a changed candidate to create a higher attempt linked through
`Supersedes`, so the corrected `M1a` audit is `a3` even though the frozen matrix's original
allocation described `a2` as the `M1a` attempt and `a3+` as `M1b`. The immutable `a2` record itself
records this exact collision in SS5.1: a corrected `M1a` attempt is also numbered `a3`.

The milestone is determined here by the attested candidate and the campaign set consumed, not by
the ordinal alone. This attempt applies the matrix's **`M1a` floors**, consumes `M1-D1-SPINE` and
`M1a-D2-MECHANISM`, and does **not** consume or certify `M1-D2-CODING`. It therefore cannot be used
as the later `M1b` audit, which still requires a fresh candidate and a higher attempt.

The frozen plan is
[`../audit-matrix/2026-09-21-e5-seven-clause-matrix.md`](../audit-matrix/2026-09-21-e5-seven-clause-matrix.md).
Its blob at the attested candidate is
`4d8a43a55d760bfa6fe84b91c8854082ea488643`, equal to the freeze pin in
`E5-A2-MATRIX-result.md`. This attempt changes no clause, grade vocabulary, floor, or result rule.
Decision `E5-D08` applies from `a3` onward and clarifies R2: a committed record satisfies R2 when it
attests the candidate and is pinned by path and Git blob SHA.

## 1. Candidate and consumed records

| Input | Exact evidence | Git blob SHA | Result |
|---|---|---|---|
| Candidate | `446d99f39c8f8f9bece2138252fe48c839fbc7a6` | `not_applicable` | exact |
| `M1-D1-SPINE` | `docs/replatform/milestones/M1a/qa/2026-09-26-m1-d1-spine-m1a-candidate-446d99f39c8f-a18.md` | `e97468b2c553afd7ca5ab2bc61b8342b338289c1` | `pass` |
| `M1a-D2-MECHANISM` | `docs/replatform/milestones/M1a/qa/2026-09-26-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a25.md` | `af14519fba6e709d5333027ad293318e72fdf102` | `pass` |
| Prior E5 attempt | `docs/replatform/epics/E5-workspaces-secrets/qa/2026-09-24-d0-e5-exit-gate-audit-7be35ae6b771-a2.md` | `940de0a91959b3ea87209f07a1326ba98467e44c` | immutable `fail`; superseded |

The D1 record adopts GitHub Actions run `36152472861` at
`f8cdbe92e1cdc263876734d06618fae39a07e0ba` after measuring the bounded five-file delta to the
attested candidate. It records all `29/29` required spine cases fired, two declared pending cases,
zero violations, two enabled Organizations, one refused control Organization, and a successful
rollback rehearsal. The only production file in the candidate delta adds job-submission audit
evidence for the mechanism lane; the D1 workflow, topology, fault declaration, provider images and
protocol contract are unchanged.

The mechanism record consumes keyed GitHub Actions run `36187103782`, whose head is the attested
candidate exactly. It records `17/17` required cases fired, nine explicitly retained pending cases,
zero violations, successful real-E2B journeys for both enabled Organizations, refusal of the
control Organization, hostile cross-tenant cases with positive controls, lease-binding cases,
planted redaction evidence, cost/usage/audit attribution, env probes, secret scan and teardown. The
approved M1a mechanism matrix does not require zero pending cases.

The required DAT-007 Tier-3 suite executed on the candidate in PR run `36185301871`, job
`verify (4)` (`108237163562`):
`src/__tests__/distributed-run-currency.integration.test.ts` ran **14 tests** and passed; the shard
reported `664 passed (664)` test files. The overall workflow conclusion was `failure` only because
the aggregate `ci-required` job failed; the evidence-bearing `verify (4)` job and its test step were
`success`, so this record uses the job verdict rather than widening the run conclusion.

## 2. Topology and environment

This record's own lane is `D0`; it deploys nothing and consumes the two records above.

| Dimension | `M1-D1-SPINE` | `M1a-D2-MECHANISM` |
|---|---|---|
| Topology | D1 compose, one control plane, one deployed worker, real PostgreSQL through non-owner `aoa_app` with RLS, source-built MinIO, reference provider | shipped CI boot, two control-plane replicas, three source-built/admitted images, source-built MinIO, CI-generated Ed25519 control-plane keypair, real E2B |
| Tenancy | enabled A/B, control C off; crew and tools off | enabled A/B, control C off; exact tenant set on rendered and running replicas; crew and tools off |
| Campaign verdict | `29/29` required fired; 2 declared pending; zero violations | `17/17` required fired; 9 declared pending; zero violations |
| Provider identity | D1 reference provider | `e2b`, `e2b@2.30.5`, template `aoa-base`, endpoint `api.e2b.dev`; image/config/protocol hashes pinned in the consumed record |
| Cleanup | rollback rehearsal passed; no campaign cleanup failure | uploaded evidence and teardown step passed |

## 3. Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `git rev-parse 446d99f39c8f8f9bece2138252fe48c839fbc7a6:docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md` | `0` | `4d8a43a55d760bfa6fe84b91c8854082ea488643`, equal to the frozen pin |
| `git hash-object <each consumed record>` | `0` | Produced the three record blob SHAs pinned in SS1 |
| `node scripts/check-evidence-immutability.mjs --base 446d99f39c8f8f9bece2138252fe48c839fbc7a6^1 --candidate 446d99f39c8f8f9bece2138252fe48c839fbc7a6` | `0` | `75` base records remained byte-identical; two candidate commits walked; no record rewritten or removed |
| `node scripts/check-gate-clause-wiring.mjs --counts` | `0` | Relevant counts: artifact export `1`, staged-input resolver `1`, staged-input writer `2`, redaction `1`; patch apply `0`, result commit `0`, egress proxy `0` |
| `node scripts/check-gate-clause-wiring.mjs` | `0` | `OK`; 28 wired clauses, 6 declared dormant; E5 patch quarantine, denied egress and result-commit worker remain declared dormant |
| `node scripts/check-register-citation-integrity.mjs` | `0` | `397` enforced citations checked; `PASS` |
| `node scripts/check-finding-ownership.mjs` | `0` | `104` open findings across 12 registers; unowned findings are reported, including `E5-F002` through `E5-F008` |
| `gh run list --commit 446d99f39c8f8f9bece2138252fe48c839fbc7a6 ...` | `0` | Located the candidate-bound keyed run and PR verification run |
| `gh run view 36185301871 --job 108237163562 --log` | `0` | DAT-007 Tier-3 suite: 14 tests passed; shard `664 passed (664)` |

## 4. Seven-clause result

Verdict vocabulary is unchanged: `proven_in_d1`, `proven_weakly`, `not_proven`.

| # | Clause | `M1a` floor | Grade | Floor | Candidate-specific basis and retained blocker |
|---|---|---|---|---|---|
| 1 | Immutable workspace staging | graded; no floor | `proven_weakly` | met | The adjacent staged-input grant/write path is wired and exercised for both enabled tenants, and cross-tenant staged-input access is denied with controls. The lease still does not carry the DAT-001 immutable workspace manifest. **Planned and blocked:** no M1 ticket composes `buildWorkspaceManifest`; M1 does not certify this E5 clause. |
| 2 | Fenced object commit | graded; no floor | `proven_weakly` | met | D1 exercises the server half: truncated upload refusal, stale-fence commit refusal, orphan sweep, and cross-tenant output denial with a same-tenant control. `createArtifactExportSequencer` has one production caller, but M1a does not exercise the worker output/export half and `createResultCommitter` remains dormant. **Blocker:** worker output/artifact capability remains M1b work. |
| 3 | Patch conflict quarantine | graded; no floor | `not_proven` | met | `createPatchApplyService` and `createResultCommitter` each have zero production callers; no campaign reaches quarantine/non-promotion. **Planned and blocked:** no M1 ticket composes the patch-apply production path. |
| 4 | Lease-scoped secrets | `proven_in_d1` plus mechanism observation | `proven_in_d1` | met | D1's required cases `d1.credential.lease_expired_redemption_refused` and `d1.credential.wrong_lease_redemption_refused` fired within the `29/29` pass, each with its positive control. The keyed lane redeemed `ANTHROPIC_API_KEY` for both enabled tenants and fired cross-tenant secret and wrong-lease cases with controls. Retained residual: `E5-F004` placement side and deferred slice 7. |
| 5 | Redaction | `proven_in_d1` plus mechanism observation | `proven_in_d1` | met | D1's required `d1.redaction.planted_canary_scrubbed` fired in the `29/29` pass: the canary is planted through `synthesiseRunSecrets` and checked on events/logs with marker/non-vacuity controls. The keyed run independently records the planted canary scrubbed on events and logs, the suppressed arm not firing, and the cross-tenant canary absent. H-04's observed canary count is zero. |
| 6 | Denied egress | graded; no `proven_in_d1` claim; residual and mitigation recorded | `not_proven` | met | `createFenceAwareEgressProxy` remains dormant. Both enabled real-E2B sandboxes measured the metadata endpoint reachable with HTTP `401`; DE-08 therefore leaves H-06 unmet. The 18-class credential/env probe and planted controls passed. **Blocker:** DE-08; no H-06 or sandbox-egress-denial claim is made. `a1`'s container-analog basis does not transfer. |
| 7 | Brokered internal tool surface | graded; no floor; DAT-007 Tier-3 required | `proven_weakly` | met | Candidate CI ran the real-PostgreSQL DAT-007 resolver suite: 14 tests passed, including its deny/control paths. D1's per-Organization tool-surface hostile case fired, but the distributed brokered surface remained off on both campaign lanes, as M1a requires. **Blocker:** no distributed campaign call through the brokered tool surface; per-Organization enablement and live capability remain M1b work. |

**Score:** 2 `proven_in_d1` (clauses 4 and 5), 3 `proven_weakly` (1, 2 and 7), and
2 `not_proven` (3 and 6). The `M1a` floors are met without promoting any exempt or dormant clause.

## 5. Result rule

| Rule | Verdict | Evidence |
|---|---|---|
| R1 - complete | met | All seven clauses are graded; every unproven path carries its blocker. No clause is dropped. |
| R2 - exact candidate | met | Both committed campaign records attest the exact candidate and are pinned by path and blob SHA under accepted decision `E5-D08`; the mechanism and DAT-007 jobs ran on the exact candidate. Nothing is carried from `a1` or the prior candidate. |
| R3 - no over-grade | met | Only clauses 4 and 5 reach `proven_in_d1`; every partial, dormant or failing path remains below it. |
| R4 - floors | met | Clauses 4 and 5 meet their `M1a` floors; both required campaign records are `pass`; the mechanism and DAT-007 observations are present and passing. |
| R5 - tenancy | met | Both enabled tenants and the refused control are recorded. Required hostile tenant cases fired with same-tenant/anti-vacuity controls across the approved D1 and mechanism matrices. |
| R6 - non-certifications retained | met | SS6 restates every mandatory full-gate non-certification and states that E5 is not complete. |

**`Result: pass`.** This is a pass for `M1a` exit criterion 7 on this exact candidate only.

## 6. Retained full-gate non-certifications

1. **E5's normative exit gate is not certified by this attempt or by any M1 partial gate. E5 is
   not complete.** The M1 gates are non-promoting, and this record cannot support an E5
   epic-completion handoff.
2. **DE-08 leaves H-06 unmet** (clause 6). Metadata was measured reachable from both enabled E2B
   sandboxes, and no claim is made for private, worker-control, control-plane, direct-IP, redirect
   or DNS-rebinding denial.
3. **`E5-F004`'s placement-side residual and deferred slice 7 remain open** (clause 4).
4. **Clause 1, E5 immutable-manifest staging, is not certified by M1.** The adjacent staged-input
   path does not substitute for `buildWorkspaceManifest` on the lease.
5. **Every clause below `proven_in_d1` remains uncertified:** clause 1 lacks DAT-001 composition;
   clause 2 lacks exercised worker export/output; clause 3 lacks patch-apply/result-commit
   composition; clause 6 is blocked by DE-08; clause 7 lacks a distributed brokered tool call and
   per-Organization tool enablement.
6. **M1b capability is not certified.** `capabilityProven:false`, output projection, tools,
   reviewable artifacts, `M1-D2-CODING`, full D1 and full D2 remain outside this audit.

## 7. Cleanup

This D0 audit deployed nothing, created no sandbox, spent nothing and dispatched no workflow. The
consumed mechanism record reports successful evidence upload, secret scan and teardown; the spine
record reports a successful rollback rehearsal and no cleanup failure. No secret bytes are present
in this record.

## 8. Gate effect

- **Permits `M1a` exit criterion 7** for candidate
  `446d99f39c8f8f9bece2138252fe48c839fbc7a6`.
- **Promotes and completes nothing.** This D0 audit is non-promoting, does not complete E5, and does
  not write or authorize the final M1a milestone handoff.
- **Supersedes `a2` without editing it.** The earlier failure remains part of the immutable chain.
- **Cannot satisfy M1b.** A fresh M1b candidate must consume its three named campaign records and
  file a higher E5 attempt under the M1b floors.
