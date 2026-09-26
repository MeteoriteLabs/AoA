# M1a closure recovery execution plan

**Date (UTC):** `2026-09-26`
**Integration branch:** `docs/replatform-program`
**Status:** execution in progress; not a candidate freeze, QA result or handoff

## Authority and boundaries

Execute the approved [M1 plan](../../qa/2026-09-21-m1-execution-plan.md),
[recovery procedure](../../epic-regrooming/qa-handoff-recovery.md), and E5-D09.
The latest milestone handoff remains attempt 2, `Decision: fail`. Historic records
are not rewritten. M1b entry remains gated. DE-08/H-06, full D1/D2, epic completion,
and useful capability remain explicitly uncertified.

PR #620 repaired the D1 redaction evidence at implementation head
`ea3cdca9323fb74a6dc54c41633ac071b59bdb3a`, merged as
`583b5fc8d596edbbb39b88b7329cb2dfb3979295`. Independent review found no blocking
findings; all 16 exact-head CI checks passed. That establishes source repair, not
milestone closure.

## Ordered work and acceptance

1. Commit the distinct review disposition for DEP-027. Its result must be
   `complete` before it is pinned as accepted successor evidence.
2. Record the exact candidate before dispatch, with all thirteen required M1a
   ticket-result blobs (including DEP-019), DEP-027 successor blob, matrix blob,
   topology/configuration/feature-flag digests, protocol/provider/template versions,
   external services, owners and rollback path. Independently review this record.
3. Obtain post-freeze exact-candidate D1 evidence, including all three jobs,
   artifact-only grading, and suppressed-injection negative controls. In particular,
   the planted canary must be scrubbed and the credential-free inert control must
   appear verbatim on both nonce-scoped streams.
4. Run the keyless shipped-boot preflight on the named candidate. Check no equivalent
   keyed run is active or complete, then dispatch one fresh M1a-D2-MECHANISM campaign
   under the existing F8 named authorization. No other paid campaign is authorized
   by this plan. Failure requires diagnosis before any additional paid dispatch.
5. Commit superseding exact-candidate campaign QA records after independently
   reviewing retained artifacts: D1 attempt 19 and mechanism attempt 26, provided
   those remain the next available immutable ordinals.
6. Author E5 audit attempt 4, explicitly M1a under E5-D09, superseding attempt 3.
   Pin the committed new campaign-record blobs and grade all seven frozen clauses.
7. Obtain separate certification from an eligible independent session. A committed
   audit cannot be edited to add a certification; use a separate attributable
   certification artifact or higher superseding attempt according to artifact policy.
8. Only after certified passing evidence, prepare the higher M1a handoff superseding
   attempt 2. Pin all thirteen required results plus DEP-027, both new campaigns and
   the certified audit. This remains non-promoting. Then audit M1b gaps.

## Roles

| Role | Session |
|---|---|
| Planning, partial-gate/rollback owner, campaign dispatcher, handoff decision | Calling M1 planning session under founder F2 delegation |
| DEP-027 implementer | `01a0dd9c-ec6d-7b12-a26a-f3e9783d4506` |
| Independent implementation reviewer, campaign QA record author, E5 audit author | `01a0dd9b-ba6d-79a2-8d96-9651bf242b4e` |
| Reserved independent E5 audit certifier | `01a0de6b-915c-7fb0-b3d7-59e7bac3dc95` |

The certifier must take no relied-on decision, implement no repair, dispatch no
campaign, author no campaign QA record/audit, and prepare no milestone handoff.
Reservation is not certification; actual evidence review is still required.

## Automatic-run timing

Push-triggered D1 run `36253363996` started on merge `583b5fc8...` before this
replacement freeze was recorded. It is diagnostic evidence, not a conforming
post-freeze campaign. Do not backdate the freeze or count this run as the final
milestone evidence. Retain its artifacts, avoid a simultaneous duplicate, and run
the free D1 campaign after the conforming freeze. A later code/configuration change
requires a new candidate; documentation-only disposition carry-forward requires
explicit byte-identity proof.

## Verification

Before dispatch: clean candidate, integration ancestry, independent disposition,
complete blob/configuration inventory, declaration/finding/citation/ticket guards,
and immutable-history guard. Campaign verdicts must be measured, never inferred
from ordinary PR CI. No `pass` record may be prepared while a required run is
unfinished or its retained evidence has not been reviewed.
