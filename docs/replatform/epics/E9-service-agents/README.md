# E9 — Long-running Service Agents

**Status:** `backlog`
**Depends on:** E7; SVC-007 additionally requires `E10-REALTIME-FOUNDATION`
**Tickets:** SVC-001 through SVC-007
**Exit gate:** desired state, generation, placement, health, restart, checkpoint, drain, budgets, UI, and the 72-hour D4 continuity/reconciliation canary pass without public ingress.

## Mandatory planning brief

The E9 plan models desired service, immutable generation, service instance, attempt, and lease separately. Health never renews ownership. JOB-009 placement is re-evaluated on replacement; owner/locality/credential/fallback constraints persist. D4 runs for 72 wall-clock hours across control-plane/worker restarts, partition, E2B pause/resume or replacement, drain, generation rollout, checkpoint restore, and budget/TTL stop. This is checkpoint-and-reconcile continuity under the accepted E2B caveat, not a promise of one uninterrupted sandbox. SVC-007 cannot claim reconnect-safe continuity until `E10-REALTIME-FOUNDATION` passes. Service is a mandatory private-beta workload: E9/D4 blocks REL-005 even when its exposure flag is off. Public ingress remains unrepresentable.
