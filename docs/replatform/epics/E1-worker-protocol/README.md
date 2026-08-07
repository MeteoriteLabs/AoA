# E1 — Versioned Worker Protocol

**Status:** `planning`
**Depends on:** E0 completion gate
**Tickets:** PRT-001 through PRT-007
**Implementation plan:** `implementation-plan.md` is written and reviewed before E1 execution begins.

## Outcome

Create a dependency-light, runtime-portable `@armyofagents/worker-protocol` package with branded identities, distinct job/attempt/lease states, job/lease envelopes, events, artifact/quarantine policy, transport/control/error schemas, capability negotiation, and frozen cross-version conformance vectors.

## Exit gate

- Package build, typecheck, and tests pass.
- Every protocol/operation/error reference resolves and every checked-in current/frozen-consumer vector is pinned by hash.
- The complete PRT-007 v1 consumer is frozen as an independent hash-pinned baseline. The initial gate records `baseline_established`; from the first contract change onward, the current and oldest supported frozen consumers must pass bidirectional compatibility, while unsupported critical behavior fails closed.
- Registered target authority cannot be elevated by WorkerHello claims; ordinary artifact commit and quarantine remain distinct.
- Every applicable D0 REQUIRED condition plus HARD/INITIAL threshold in `test-gates.md` passes on one revision.
- Runtime source contains no Node, server, database, adapter, or UI imports.

## Records

- [`decisions.md`](decisions.md)
- [`findings.md`](findings.md)
- [`tickets/`](tickets/)
- [`qa/`](qa/)
- [`handoffs/`](handoffs/)
