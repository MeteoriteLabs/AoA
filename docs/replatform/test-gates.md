# Distributed Execution Test and Release Gates

**Status:** Normative release contract

**Applies to:** D0 through D6 and private-beta promotion

## Threshold classes

- **HARD:** A security or correctness invariant with zero tolerance. It cannot receive a conditional pass or waiver.
- **INITIAL:** The first private-beta floor. It may change only prospectively through a dated decision approved by the Integration Gate Owner and Security Gate Owner. It cannot be lowered after a release-candidate run starts or in response to that run failing.
- **OBSERVED:** Record the value; it does not independently pass or fail the gate.

An unlabelled gate bullet is **REQUIRED**: it must pass, but it is not an adjustable numeric floor. A gate passes only when every applicable REQUIRED bullet plus every HARD and INITIAL condition passes. OBSERVED is the only non-blocking class.

Every passing record identifies the exact Git revision, image digests, protocol contract hash, topology, provider/template versions, feature flags, and configuration hashes. Product, harness, provider, and environment failures remain separately classified. `blocked_external` applies only when an external provider/environment prevents a required lane or measurement schedule from starting; it never promotes the epic and the complete gate must be rerun. Once a gate campaign or schedule starts, provider/environment-caused cases remain in the required sample set and any threshold violation is `fail`, not `blocked_external`.

## Hard invariants

Every D1–D6 gate requires all of these:

1. **Tenant isolation:** zero cross-Organization or unauthorized cross-Company reads, writes, deletes, existence disclosures, subscriptions, object-key accesses, secret resolutions, or provider-resource accesses.
2. **Lease authority:** zero accepted mutation, event, artifact commit, secret read, checkpoint selection, completion, or external effect from a stale or replaced fence.
3. **Single executor:** zero overlapping authoritative leases or simultaneously effectful service generations unless a later approved decision explicitly permits overlap.
4. **Secret containment:** zero known secret-canary values in envelopes, argv, URLs, events, logs, metrics, traces, browser artifacts, object metadata, SQLite outboxes, or QA artifacts.
5. **Sandbox boundary:** zero tenant commands executed by the worker host; workers have no database credential; control-plane replicas have no Docker or provider-control socket.
6. **Network boundary:** metadata, private, worker-control, and control-plane destinations remain denied, including direct-IP, redirect, and DNS-rebinding variants.
7. **Hosted exclusions:** public service ingress, cloud-plugin execution, and the unsafe process-wide multi-tenant override remain impossible while disabled.
8. **Supply chain:** only approved digests with a verified project signature or provider provenance attestation run; the verification policy and roots are recorded in evidence.
9. **Cleanup:** zero provider resources remain after the lane cleanup deadline and final reconciliation.
10. **Evidence integrity:** no failing run is overwritten, hidden, or converted to pass without a new immutable QA record.

## Evidence names and retention

Use `docs/replatform/epics/<epic>/qa/<YYYY-MM-DD>-<lane>-<scope>-<sha12>-a<attempt>.md`. Example: `2026-08-07-d4-service-72h-9b74b888d78b-a1.md`.

Git retains structured QA summaries permanently. **INITIAL:** controlled raw logs, traces, load results, manifests, and restore evidence are retained for at least 180 days. The record must remain meaningful after linked CI artifacts expire.

## Availability SLI contract

The D4 and D6 availability SLIs use schedules frozen before the gate starts. Raw samples retain their scheduled timestamp, observed timestamp, Organization, workload, target/provider, release revision, and success or failure reason. Every D6 sample additionally carries the immutable matrix-row ID, OS/version or `not_applicable`, credential-binding mode, locality mode, fallback mode, mobility mode, and handoff direction or `not_applicable`.

- **D4 service availability:** sample once per UTC-aligned minute. The denominator is every scheduled minute outside the permitted injected-fault exclusions below. A minute enters the numerator only when the authoritative desired generation has exactly one valid fenced instance, its health is current, and a synthetic operation submitted in that minute reaches its durable, readable success signal within 60 seconds.
- **D6 end-to-end availability:** schedule at least one golden-journey probe every five minutes for each enabled workload, increasing frequency as needed so every advertised matrix row receives at least 200 normal scheduled probes during the campaign. The denominator is every scheduled probe. A probe enters the numerator only when submission, placement, lease, execution, durable result or artifact commit, and authorized readback all complete within that workload's declared SLO. Report the aggregate, each enabled workload, and each advertised matrix row separately; all three levels must meet the D6 threshold.
- D4 may exclude only the scheduled 15-minute worker/control-plane partition and the scheduled 15-minute provider pause or forced-outage window, each from the recorded instant the fault becomes effective through the recorded instant it is removed. Recovery after removal, control-plane or worker restarts, drain, generation update, checkpoint restore, and budget/TTL stop remain in the denominator. D6 has no maintenance, provider, environment, beta-customer, or fault-drill exclusion; a synthetically valid request is never excluded because the platform or a dependency was unavailable.
- Missing expected samples, gaps in the source telemetry, absent SLI dimensions, or an inability to reconstruct numerator and denominator from retained evidence fail the gate. They are not removed from the denominator or classified as `blocked_external`.

## D0 — Hermetic component gate

Required on every affected ticket:

- Focused tests, affected-package typecheck/build, boundary checks, and contract-manifest checks pass with zero failures.
- Lifecycle functions test the complete legal/illegal transition matrix.
- Secret and path validators pass at least 10,000 deterministic generated vectors each, including secret values in argv, URLs, headers, nested arrays, and additive extensions.
- Protocol schemas cover every valid and invalid conformance vector.
- Critical suites pass three consecutive executions with zero flaky or retried tests.
- No network provider, customer data, or live credential is used.

## `E6-D1-FOUNDATION` — partial preflight, not D1 promotion

This named preflight exists only to unblock JOB-004 onward and WRK-005 onward. It does not pass D1, E6, or a release lane, and the D1–D6 hard-invariant preamble does not imply behavior whose owning tickets have not landed.

It requires JOB-003, WRK-004, DEP-000 through DEP-004, and their dependency closure on one revision. Its immutable QA record must prove:

- 100 submit→placement→lease→ACK races across at least two registered target profiles, with exactly one winner each;
- 25 fake-provider create→execute→kill/destroy fault cases, deterministic reset between cases, and zero provider resources after final reconciliation;
- one networked end-to-end smoke through PostgreSQL, MinIO, control plane, worker, fake provider, and runner;
- zero cross-Organization reads/existence disclosures in the available submit/enroll/placement/lease paths;
- no shared writable volume, no worker database reachability/credential, no control-plane or worker-host tenant-command execution, and only declared provider-control access;
- pinned images built from the recorded source revision, non-root/read-only-root policy, test-root signature/provenance verification, and rejection of one tampered digest;
- migration/readiness behavior and retained evidence from one deliberate failing fixture.

The record explicitly lists later behavior not certified: renewal/fence loss, event ingestion/outbox, cancellation/retry, artifact/secret/quarantine paths, full D1 fault volume, real-provider isolation, two-replica HA, and release signing policy. Those are proved by their owning tickets and the full D1/D2 gates.

## D1 — Distributed local gate

Topology: PostgreSQL, MinIO, one control-plane replica, at least two workers, fake provider, Toxiproxy, and an isolated test runner. A separate D1-HA lane adds the second control-plane replica once DEP-009 lands.

- Tenant property suite: **INITIAL:** 20 seeds × 10,000 operations across at least 10 Organizations.
- Lease suite: at least 1,000 concurrent claim/ACK/renew/replacement races; exactly one authoritative winner in every race.
- Event suite: at least 100,000 events, including at least 10,000 cases **in each** event-fault class: duplicate, gap, out-of-order, lost ACK, restart/replay, and hash mismatch.
- Sandbox suite: at least 100 lifecycle faults spanning create, execute, cancel, kill, destroy, worker crash, and control-plane restart.
- **INITIAL:** cancellation reaches worker-visible terminal or force-kill state within 30 seconds; cleanup completes within 5 minutes.
- Artifact round trips reproduce expected bytes, hash, size, prefix, tenant, attempt, and fence in 100% of cases.
- Final reconciliation reports zero orphan sandboxes, uploads, active leases, or unacknowledged terminal events.

## D2 — Real E2B coding gate

- Three consecutive passing runs on the same release candidate.
- **INITIAL:** at least 120 jobs total, covering at least 20 each for success, cancellation, timeout, lost ACK, artifact commit, and leaked-resource reconciliation.
- Zero product failures and zero hard-invariant violations.
- **INITIAL:** cancellation p95 ≤30 seconds and maximum ≤60 seconds.
- **INITIAL:** sandbox cleanup p95 ≤2 minutes and maximum ≤5 minutes.
- Patches reproduce the declared base/result hashes and never auto-apply on base mismatch.
- Provider outage/backoff produces an alert and no leaked or unattributable sandbox.
- The QA record includes the verified E2B limit matrix required by [`accepted-caveats.md`](accepted-caveats.md).

## D3 — Browser gate

- **INITIAL:** at least 100 journeys over three consecutive passing runs.
- Coverage includes approval allow/deny/timeout, reconnect catch-up, download, upload policy, cancellation, trace/video retrieval, credential rotation/revocation, private/metadata denial, and stale fence.
- Zero public or cross-tenant CDP/control endpoints.
- Zero cookie, access-token, refresh-token, authorization-header, or storage-state value in events/logs.
- **INITIAL:** cancellation maximum ≤60 seconds and session cleanup maximum ≤5 minutes.
- Every screenshot, trace, video, and download is ordered by event sequence and matches its digest.

## D4 — Long-running service gate

Run on the same release candidate for at least **72 consecutive wall-clock hours**. This is a continuity/reconciliation test, not a claim that one E2B process runs uninterrupted for 72 hours.

Inject at minimum two control-plane restarts, two worker restarts, one 15-minute worker/control-plane partition, one worker drain, one generation update, one checkpoint restore, and one budget/TTL stop. If the recorded provider capability matrix supports pause/resume, also pause the provider for 15 minutes and resume it. Otherwise force a 15-minute provider outage, permanently fence the affected instance, and recover through a replacement instance using the approved checkpoint or replayable input; evidence must show the old instance cannot resume governed effects.

- Zero overlapping active fences or effectful generations.
- Zero post-fence secret/context/connector/artifact operations.
- Health events never extend lease ownership.
- **INITIAL:** healthy availability ≥99.5% under the availability SLI contract above.
- **INITIAL:** convergence after control-plane restart ≤2 minutes and after worker/provider resume or fenced replacement ≤10 minutes.
- Any duplicate external effect is bounded to at most one per ambiguous-ACK point, carries the same idempotency identity, and is fully attributable.
- Checkpoint hash, service ID, and generation match before restore.
- Budget/TTL stop cannot be overridden by the worker.
- Final cleanup leaves zero service instances or provider resources.

## D5 — Staging HA, load, and disaster recovery gate

Topology: at least two control-plane replicas behind the production load balancer, at least four workers across two failure domains, external PostgreSQL/object storage, shared realtime broker and shared rate/admission store, managed secret store, and production-equivalent TLS, telemetry, backup, and image policy.

HA requirements:

- Loss of either control-plane replica causes zero accepted-write loss and zero double execution.
- **INITIAL:** application failover RTO ≤60 seconds; accepted-mutation RPO = 0.
- Rolling deployment, worker drain, broker outage/catch-up, and migration-first startup pass. The initial distributed release uses the independent frozen-v1 baseline on both sides; the first and every later protocol-changing release must additionally pass non-identical N/N-1 producer/consumer tests.
- **INITIAL:** realtime catch-up completes within 5 minutes after broker recovery.

Load/fairness model:

- **INITIAL:** at least 20 Organizations, 2,000 queued jobs, 100 active leases, and 10,000 events/minute for 60 minutes plus 15 minutes of worker churn.
- One noisy Organization submits at least 10× the quiet-tenant rate.
- Quiet-tenant throughput remains ≥90% of its isolated baseline and p95 queue delay remains ≤2× its isolated baseline.
- API 5xx rate ≤0.1%.
- **INITIAL:** submit p95 ≤750 ms, lease poll p95 ≤1 second, and event ACK p95 ≤500 ms.
- Quota/spend exhaustion never exceeds configured concurrency and never releases capacity twice.

Disaster-recovery requirements:

- Database backup/restore and object-manifest reconciliation run on the same release candidate.
- **INITIAL:** database RPO ≤15 minutes and full-service RTO ≤4 hours.
- **INITIAL:** object-store RPO ≤15 minutes, measured as the age at the declared fault time of the newest committed authoritative manifest whose matching bytes are recoverable. Object-store reconciliation RTO is ≤4 hours from restore start until every object referenced by the recovered authoritative manifest set is either verified readable or the restore is declared failed.
- Every object in the recovered authoritative manifest set matches its recorded SHA-256 digest, byte size, tenant/Organization scope, object prefix, and artifact/checkpoint identity. Inject at least one missing object and one corrupt object; neither may be promoted or served, and a successful gate has zero unresolved missing or mismatched authoritative objects.
- Missing or mismatched objects are quarantined, never silently promoted.
- Restored state rejects every pre-restore stale fence.
- Worker re-enrollment/revocation and the applicable frozen-baseline or non-identical N/N-1 protocol rollout succeed after restore.

## D6 — Private-beta canary gate

All D0–D5 records must be current for the same release candidate.

**INITIAL:** at least three external beta Organizations each participate throughout the same 14 consecutive calendar days; at least 1,000 attempts complete; end-to-end availability is ≥99.5% under the availability SLI contract above; zero Severity 0/1 incidents and zero open Critical/High security findings occur; every Medium finding has an owner, mitigation, and due date.

Enabled workload floors are conjunctive, not interchangeable: coding enabled requires at least 100 completed coding jobs; browser enabled requires at least 50 completed browser journeys; service enabled requires at least 72 accumulated healthy service-hours. A disabled workload contributes neither traffic nor credit toward another workload's floor.

Before the canary starts, commit the advertised support matrix. Each immutable row has a stable row ID and names Organization, workload, target class, provider, OS/version or `not_applicable`, credential-binding mode, locality mode, allowed fallback, and mobility mode. Mobility is `disabled` or `fenced_restart`; an enabled row lists exact directed source-row→destination-row handoffs, never an implicit all-target claim. Every advertised row requires at least 200 normal scheduled probes, **INITIAL:** availability ≥99.5% under the D6 SLI contract, and at least three deliberate fail-closed samples covering applicable owner/credential mismatch, target/locality mismatch, forbidden fallback or capability escalation. Deliberate denial probes are evaluated separately and do not enter the normal availability numerator or denominator. An inapplicable denial class requires an approved rationale; aggregation across rows cannot hide an untested or unreliable combination.

When mobility is `disabled`, deployment, API, UI, and workload handoff flags remain hard off; a handoff request is rejected; loss of a selected target queues or fails according to immutable fallback policy and never creates a cross-target attempt; and same-candidate negative evidence proves no route can advertise or invoke mobility. When `fenced_restart` is advertised, MIG-004 and its conditional desktop closure apply, and every declared direction has at least 10 successful handoffs plus three partition/destination-failure cases proving permanent source fencing, zero concurrent governed effects, and no source-authority revival.

Each external design partner has a completed, access-controlled legal and data-handling checklist before its first real workload. At minimum it records:

- the legal entity, authorized beta sponsor, and named technical, security, privacy, incident, and offboarding contacts;
- executed beta/confidentiality and applicable data-processing terms approved through the project's legal process;
- allowed and prohibited data classifications, approved use cases, data subjects, and any regulated-data exclusion;
- approved processing regions, residency constraints, subprocessors/providers, cross-border handling, and locality/fallback policy;
- credential/connector ownership, least-privilege access, revocation, audit access, retention/deletion periods, export, and verified offboarding deletion;
- incident-notification route and timing, support boundaries, rollback/disable authority, and consent for the telemetry and evidence retained by these gates.

Billing, pricing, invoicing, payment collection, and commercial metering are explicitly outside this gate.

During the canary:

- dashboards and alerts are observed by the named on-call owner;
- one scheduling-disable/provider-kill rehearsal completes;
- **INITIAL:** new scheduling stops within 60 seconds, and active work is drained, canceled, or explicitly quarantined within 60 minutes;
- one tenant cutover and rollback occurs with active work;
- support intake, incident severity, customer communication, and rollback ownership are exercised;
- every Organization has workload flags, quotas, spend/runtime caps, known limitations, and a named rollback path.

A canary resets after any hard-invariant failure, Severity 0/1 incident, incompatible schema/protocol change, or release-candidate image change.

## Desktop beta gate

Desktop remains optional. If desktop execution is disabled, deployment, Organization, and workload flags remain off; release documentation says it is unavailable; and the same-candidate negative evidence proves that API/UI configuration cannot advertise or select a desktop target, enrollment cannot create an enabled desktop target, a desktop-required request queues or fails closed, and no fallback silently routes work to desktop. If desktop execution is enabled for any beta Organization or workload, every advertised OS/version must pass this gate on the same release candidate.

For every advertised OS/version:

- signed/notarized installer and binary verification pass;
- clean install, uninstall, N-1→N update, rollback to an allowed N-1 version, and explicit downgrade refusal when compatibility policy forbids rollback pass;
- OS-keychain storage, enrollment, device loss, rotation, and revocation pass;
- every advertised device-local credential mode passes its per-OS broker contract: the value remains in OS-protected storage; only redacted handle metadata leaves the device; wrong OS user/owner/Organization/target is denied; a control-plane partition with public Internet still reachable, lease/fence replacement, owner-membership removal, target generation replacement, and explicit handle revocation each block the next governed request and destroy per-job activation; the underlying personal login may remain stored but carries no AoA job authority; direct broker/egress bypass and secret-canary leakage are zero;
- at least 10,000 traversal/symlink/case-collision property cases produce zero folder escape;
- a 24-hour offline run buffers encrypted events, loses its lease, and cannot auto-commit;
- orphan patches require explicit review;
- online revocation blocks refresh/new lease within 60 seconds and active work reaches cancel/kill within 5 minutes;
- at least one complete online end-to-end journey of each type passes through the installed desktop host: successful enroll→place→lease→stage→execute→commit→authorized-readback; cancellation with worker-visible stop and permanent fence; disconnect/reconnect with cumulative ACK, duplicate suppression, and durable catch-up; stale-fence output accepted only by the quarantine operation and never ordinary commit; and uninstall/revoke cleanup with zero running worker/sandbox process, active lease, temporary grant, or unreviewed promoted output;
- diagnostics and support bundles contain no secret or customer-source bytes.

## Gate decision rule

The Integration Gate Owner records `pass`, `fail`, or `blocked_external` on one exact revision. A hard-invariant or REQUIRED failure is always `fail`; there is no baseline-failure waiver path. `blocked_external` is reserved for an unavailable provider or environment that prevents the required lane/schedule from starting after the same revision has passed every locally runnable REQUIRED/HARD/INITIAL condition, and it never promotes the epic. After a campaign starts, scheduled provider/environment failures count and a missed threshold is `fail`. A focused lane or an assertion that a failure predates the diff cannot convert a required repository failure to `pass`.
