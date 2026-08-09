# E2 — Tenant-safe Control-plane Kernel

**Status:** `planning`
**Depends on:** E0 (pass) — independent of E1
**Tickets:** TEN-001 through TEN-006 (TEN-001 and TEN-006 split — see the plan)
**Exit gate:** non-owner PostgreSQL role, forced RLS, mandatory tenant transactions, composite integrity, sentinel-Organization removal, and the adversarial tenant suite are green.

**Planning artifacts (revision a2, independently reviewed):**
[`implementation-plan.md`](implementation-plan.md) · [`decisions.md`](decisions.md) (E2-D01…D07) · [`findings.md`](findings.md) (E2-F001…F008).
**Execution order:** TEN-001 → TEN-004 → TEN-006 → TEN-002 → TEN-003 → TEN-005 → E2 gate.
**Blocked until operator sign-off:** TEN-002 (E2-D01 lock + E2-D03 scope confirm).

## Mandatory planning brief

The E2 plan must enumerate every new tenant-owned table, repository, background path, worker API, object key, realtime subscription, backup/restore path, and migration role. Missing Organization context fails closed; Company/Organization duplication is protected by composite constraints; no application path uses an owner/superuser role. `TEN-006 — Remove sentinel Organization defaults` inventories every legacy default/sentinel row and caller, maps it to an authoritative Organization or quarantines it, and blocks distributed admission until no implicit tenant remains. The global platform-target catalog is explicitly non-tenant data with operator-only writes and no tenant-facing list API; the internal scheduler may read eligibility but establishes job Organization/RLS scope before details are returned or leased. Property evidence must include hostile identifiers through HTTP, scheduler, platform/Organization/owner target selection, worker events, WebSockets, artifact/quarantine keys, placement, and restored data at the D1 floor in [`../../test-gates.md`](../../test-gates.md).
