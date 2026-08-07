# E6 — Deployment and Distributed Test Harness

**Status:** `backlog`
**Depends on:** E0; `E6-D1-FOUNDATION` consumes E2 plus E3/E4 core, and completion consumes E3/E4/E5
**Tickets:** DEP-000 through DEP-009
**Exit gate:** full D1 isolated topology, fake/reference provider isolation suite, MinIO, Toxiproxy, CI evidence, staging manifests, two-replica HA, and distributed telemetry pass. Real E2B conformance is the CLI-001/D2 gate, not an E6 prerequisite.

## Mandatory planning brief

E6 has two explicit gates. The interface-only provider/fake-control-plane/clock/fault harness may be planned alongside E1/E2. The named `E6-D1-FOUNDATION` preflight lands only after JOB-003, WRK-004, DEP-000 through DEP-004, and their dependency closure; it meets the separate preflight thresholds in `test-gates.md` but is neither D1 promotion nor full E6 completion. This removes the former circular phrase “E6 test foundation.”

The plan retains one provider-neutral contract suite with opaque provider IDs and no E2B fields in common contracts. It records verified E2B runtime/TTL/resource/concurrency/template/persistence limits under the accepted caveat, and adds `DEP-008 — Managed sandbox isolation conformance` plus `DEP-009 — Two-replica control-plane HA and shared admission`. Firecracker fleet implementation is out of scope, while create/execute/cancel/kill/destroy/list/inspect/idempotent-reconcile-cleanup and negotiated checkpoint/restore/health seams remain extensible. DEP-006 owns provider-control credential injection confined to the adapter-management boundary, including account/audience scope, rotation, revocation, old-key cutoff, restart behavior, and absence from tenant sandboxes, protocol data, metadata, logs, and support evidence.

DEP-008 proves those cases against a hostile local/reference provider and packages the reusable suite. It distinguishes live-fence effect authority from the resource-bound monotonic cleanup authority, including effect-operation denial, cross-resource denial, and a management-only `list`/`inspect` projection with no tenant bytes. CLI-001/D2 then supplies the real-E2B evidence for cross-job isolation; provider credential, metadata, private, control-plane, and host denial; managed-secret rotation/revocation and old-key denial; pinned template/provenance/policy; TTL; every terminal cleanup path; crash/outage/leak reconciliation; and malicious capability claims.
