# E9 — Long-running Service Agents

**Status:** `backlog`
**Depends on:** E7
**Tickets:** SVC-001 through SVC-007
**Exit gate:** desired state, generation, placement, health, restart, checkpoint, drain, budgets, UI, and the 72-hour D4 continuity/reconciliation canary pass without public ingress.

## Mandatory planning brief

The E9 plan models desired service, immutable generation, service instance, attempt, and lease separately. Health never renews ownership. JOB-009 placement is re-evaluated on replacement; owner/locality/credential/fallback constraints persist. D4 runs for 72 wall-clock hours across control-plane/worker restarts, partition, E2B pause/resume or replacement, drain, generation rollout, checkpoint restore, and budget/TTL stop. This is checkpoint-and-reconcile continuity under the accepted E2B caveat, not a promise of one uninterrupted sandbox. Public ingress remains unrepresentable.
