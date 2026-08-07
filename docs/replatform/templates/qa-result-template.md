# QA Result — <Lane, scope, revision, and attempt>

**Date (UTC):** `<YYYY-MM-DD>`
**Epic:** `<E#-name>`
**Revision:** `<git SHA>`
**Attempt:** `<positive integer>`
**Lane:** `D0`, `D1`, `D1-HA`, `D2`, `D3`, `D4`, `D5`, `D6`, `desktop`, `weekly`, or `release`
**Result:** `pass`, `fail`, or `blocked_external`
**Failure class:** `none`, `product`, `harness`, `provider`, or `environment`

## Topology and environment

Record control-plane replicas, worker count/failure domains, database, object store, realtime/admission stores, provider/fake provider, image and desktop artifact digests, protocol contract hash, provider/template/policy versions, and feature/configuration hashes. For D6, link the immutable support matrix and list every row ID with workload, target/provider, OS/version, credential/locality/fallback, mobility mode, and directed handoff or `not_applicable`. Do not record secrets.

## Commands

| Command | Exit code | Duration | Result summary |
|---|---:|---:|---|
| `<exact command>` | `<code>` | `<duration>` | `<counts>` |

## Assertions and evidence

| Requirement | Evidence | Result |
|---|---|---|
| `<requirement>` | `<redacted log/metric/artifact reference>` | `pass` or `fail` |

## Failures

For every failure, classify `product`, `harness`, `provider`, or `environment`; include the first causal error and stable finding/ticket link.

## Cleanup

Record sandbox termination, object cleanup/quarantine, test database cleanup, and any retained controlled artifacts.

## Gate effect

State which ticket, merge train, or epic gate this run permits or blocks.

State every applicable REQUIRED condition and each HARD and INITIAL threshold from `docs/replatform/test-gates.md`, its observed value, and the decision. D6 records aggregate, per-workload, and per-matrix-row SLI numerator/denominator plus disabled desktop/mobility negative evidence. REQUIRED/HARD/INITIAL failures block `pass`; a HARD failure always makes the overall result `fail`. `blocked_external` is valid only when the external lane/schedule could not start; after a campaign starts, scheduled external failures count and a missed threshold is `fail`.
