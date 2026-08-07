# E1 — Versioned Worker Protocol

**Status:** `planning`
**Depends on:** E0 completion gate
**Tickets:** PRT-001 through PRT-006
**Implementation plan:** `implementation-plan.md` is written and reviewed before E1 execution begins.

## Outcome

Create a dependency-light, runtime-portable `@armyofagents/worker-protocol` package with branded identities, lifecycle states, job/lease envelopes, events, artifacts/policies, capabilities, version negotiation, and frozen conformance vectors.

## Exit gate

- Package build, typecheck, and tests pass.
- Every protocol reference resolves and every checked-in conformance vector is pinned by hash.
- N-1 additive compatibility and unknown-state fail-closed tests pass.
- Runtime source contains no Node, server, database, adapter, or UI imports.

## Records

- [`decisions.md`](decisions.md)
- [`findings.md`](findings.md)
- [`tickets/`](tickets/)
- [`qa/`](qa/)
- [`handoffs/`](handoffs/)
