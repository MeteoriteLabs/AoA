# QA Result — <Lane and run ID>

**Date (UTC):** `<YYYY-MM-DD>`
**Epic:** `<E#-name>`
**Revision:** `<git SHA>`
**Lane:** `focused`, `D1`, `D2`, `D3`, `D4`, `weekly`, or `release`
**Result:** `pass`, `fail_product`, `fail_harness`, or `blocked_external`

## Topology and environment

Record control-plane replicas, worker count, database, object store, provider/fake provider, image digests, protocol version, and relevant feature flags. Do not record secrets.

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
