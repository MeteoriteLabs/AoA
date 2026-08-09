# E2 — Tenant-safe Control-plane Kernel

**Status:** `gate_review` (all 8 ticket ledgers `complete`; gate green Windows-local; **`blocked_external`** pending the one mandatory real-Linux H-01 run — E2-D05/E2-F008)
**Depends on:** E0 (pass) — independent of E1
**Tickets:** TEN-001a/b, TEN-002, TEN-003, TEN-004, TEN-005, TEN-006a/b — **all `complete`**, each independently reviewed (reviewer ≠ implementer).
**Exit gate:** non-owner PostgreSQL role, forced RLS, mandatory tenant transactions, composite integrity, sentinel-Organization removal, and the adversarial tenant suite — **all green** at revision `acf2b32fb`.

**Artifacts:** [`implementation-plan.md`](implementation-plan.md) · [`decisions.md`](decisions.md) (E2-D01…D09) · [`findings.md`](findings.md) (E2-F001…F013, all resolved/corrected) · [`qa/`](qa/) (D0 rollup + baseline) · [`handoffs/`](handoffs/) (gate a1 = `blocked_external`).
**Execution order (as run):** TEN-001a/b → TEN-004 → TEN-006a/b → TEN-002 → TEN-003 → TEN-005 → E2 gate.
**Outstanding for `complete`:** a superseding gate `a2` records `Result: pass` after ≥1 real Linux execution of the H-01 suites; then E2 flips `gate_review → complete` and HEAD fast-forwards onto `docs/replatform-program`.

## Mandatory planning brief

The E2 plan must enumerate every new tenant-owned table, repository, background path, worker API, object key, realtime subscription, backup/restore path, and migration role. Missing Organization context fails closed; Company/Organization duplication is protected by composite constraints; no application path uses an owner/superuser role. `TEN-006 — Remove sentinel Organization defaults` inventories every legacy default/sentinel row and caller, maps it to an authoritative Organization or quarantines it, and blocks distributed admission until no implicit tenant remains. The global platform-target catalog is explicitly non-tenant data with operator-only writes and no tenant-facing list API; the internal scheduler may read eligibility but establishes job Organization/RLS scope before details are returned or leased. Property evidence must include hostile identifiers through HTTP, scheduler, platform/Organization/owner target selection, worker events, WebSockets, artifact/quarantine keys, placement, and restored data at the D1 floor in [`../../test-gates.md`](../../test-gates.md).
