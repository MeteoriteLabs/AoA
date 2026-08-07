# Re-platform Epic Index

| Epic | Status | Depends on | Ticket range | Exit gate |
|---|---|---|---|---|
| [E0 Foundation](E0-foundation/) | `planning` | approved program design | FND-001–FND-005 | foundation checker, focused config tests, repository verification |
| [E1 Worker protocol](E1-worker-protocol/) | `planning` | E0 | PRT-001–PRT-006 | package contract, conformance vectors, compatibility and boundary checks |
| [E2 Tenant kernel](E2-tenant-kernel/) | `backlog` | E0 | TEN-001–TEN-005 | non-owner RLS and adversarial tenant suite |
| [E3 Job control](E3-job-control/) | `backlog` | E1, E2, E6 foundation | JOB-001–JOB-008 | fenced distributed fake-provider lifecycle |
| [E4 Worker daemon](E4-worker-daemon/) | `backlog` | E1, E6 foundation | WRK-001–WRK-007 | restart-safe worker with encrypted event outbox |
| [E5 Workspaces and secrets](E5-workspaces-secrets/) | `backlog` | E3, E4 | DAT-001–DAT-005 | fenced artifact round trip and lease-scoped secret tests |
| [E6 Deployment/test harness](E6-deployment-test-harness/) | `backlog` | E0; implementation portions also require E2/E4 | DEP-000–DEP-007 | D1 isolated control-plane/worker topology |
| [E7 Coding/E2B](E7-coding-e2b/) | `backlog` | E3–E6 | CLI-001–CLI-006 | canary Organization coding journey and D2 E2B lane |
| [E8 Browser automation](E8-browser-automation/) | `backlog` | E7 | BRW-001–BRW-006 | D3 browser evidence/approval journey |
| [E9 Service agents](E9-service-agents/) | `backlog` | E7 | SVC-001–SVC-007 | D4 30-minute service canary and reconciliation |
| [E10 Desktop/migration/realtime](E10-desktop-migration-realtime/) | `backlog` | E7 | DSK-001–DSK-002, MIG-002–MIG-003 | desktop offline/fence proof and tenant cutover |
| [E11 Hardening/release](E11-hardening-release/) | `backlog` | E8–E10 | REL-001–REL-005 | private-beta evidence pack |

Only the Integration Gate Owner changes an epic to `complete`, and only after a committed QA result and completion handoff.
