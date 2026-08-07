# E2 — Tenant-safe Control-plane Kernel

**Status:** `backlog`
**Depends on:** E0
**Tickets:** TEN-001 through TEN-005
**Exit gate:** non-owner PostgreSQL role, forced RLS, mandatory tenant transactions, composite integrity, and adversarial tenant suite are green.

## Mandatory planning brief

The E2 plan must enumerate every new tenant-owned table, repository, background path, worker API, object key, realtime subscription, backup/restore path, and migration role. Missing Organization context fails closed; Company/Organization duplication is protected by composite constraints; no application path uses an owner/superuser role. The global platform-target catalog is explicitly non-tenant data with operator-only writes and no tenant-facing list API; the internal scheduler may read eligibility but establishes job Organization/RLS scope before details are returned or leased. Property evidence must include hostile identifiers through HTTP, scheduler, platform/Organization/owner target selection, worker events, WebSockets, artifact/quarantine keys, placement, and restored data at the D1 floor in [`../../test-gates.md`](../../test-gates.md).
