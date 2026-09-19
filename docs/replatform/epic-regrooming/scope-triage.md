# Scope Triage and First-Milestone Baseline

> **Proposal only.** This triage does not close, cancel, approve, or reprioritize a ticket by itself. It is a review map for subsequent owner-approved plan amendments.

## The 50-ticket triage

Each ticket below appears exactly once in one of four proposed dispositions.

### A. Promise-truth corrections — 27

These items reconcile what the program promised with what the shipped or partially shipped mechanism actually proves. Preserve their implementation and evidence, but do not inherit an over-broad completion claim.

`FND-006`, `FND-007`, `FND-008`, `PRT-007`, `TEN-006`, `JOB-009`, `JOB-010`, `JOB-011`, `JOB-012`, `JOB-013`, `JOB-014`, `JOB-015`, `WRK-008`, `WRK-009`, `WRK-010`, `WRK-011`, `WRK-013`, `WRK-014`, `WRK-015`, `DAT-007`, `DAT-008`, `DEP-010`, `DEP-011`, `DEP-012`, `CLI-007`, `CLI-008`, `MIG-008`.

### B. Pre-milestone assurance and operations — 6

These items are required to make the narrow milestone supportable and honestly observable. Their evidence must be current for the milestone candidate even where a mechanism already exists.

`TRACK-001`, `TRACK-002`, `DEP-008`, `DEP-013`, `WRK-017`, `MIG-010`.

### C. Later original-program phase — 14

These remain required or valuable in the original broader program, but they do not block the first milestone. Deferral preserves their owners, dependencies, findings, and acceptance intent.

`WRK-012`, `DAT-006`, `DAT-009`, `DAT-010`, `DAT-011`, `SVC-008`, `DSK-003`, `DSK-004`, `MIG-001`, `MIG-005`, `MIG-006`, `MIG-007`, `MIG-009`, `DBR-001`.

### D. Optional expansion — 3

These are explicit expansion choices, not silent prerequisites for the first milestone. If selected later, they re-enter through their own approved scope and evidence gates.

`WRK-016`, `DEP-009`, `MIG-004`.

`REL-FOUNDATION-GATE` is deliberately outside this 50-ticket accounting: its current program-design entry says it is nonnumeric, inert, and retained for human traceability rather than ticket-graph coverage.

## Proposed first milestone

### Included journey

One internal Organization runs `task_run` coding work through one control-plane instance and one separately deployed worker, backed by external PostgreSQL, object storage, and real E2B. On one exact candidate revision, the journey must cover:

1. authenticated task submission and current tenant/source admission;
2. authoritative target selection, lease, ACK, renewal, fencing, cancellation, and terminal projection;
3. immutable workspace input and attributable output/artifact handling;
4. lease-scoped secret materialization with no database or raw OAuth authority in the worker;
5. a supported sandbox-local coding adapter that can use the approved tool surface and produce reviewable output;
6. provider creation, execution, teardown, reconciliation, and kill/cleanup operations on real E2B;
7. operator-visible audit, cost/budget, failure classification, and cleanup evidence; and
8. recovery from the declared control-plane, worker, network, and provider failure cases in the candidate campaign.

This is an internal alpha, not a private-beta promotion and not proof of the whole replatform program.

## Proposed milestone partial gates

These names define review boundaries for this proposal; they do not amend [`../test-gates.md`](../test-gates.md).

### `M1-D1-SPINE` — one-control-plane/one-worker local-distributed partial gate

Run the included lifecycle on one control-plane instance, one separately deployed worker, external PostgreSQL, object storage, the declared local/reference provider path, and the fault controls required by the included journey. Record exact revision, topology, production boot roots, tenant isolation, lifecycle/fence behavior, workspace/secret/output behavior, audit/cost signals, and cleanup/recovery.

This is not D1. In particular, it does not satisfy D1-00’s at-least-two-worker topology, does not certify every full-D1 fault volume or HARD invariant, cannot complete E6, and cannot substitute for an E3–E6 exit gate that normatively consumes full D1. A passing handoff unlocks only the dependency set explicitly named by the approved first-milestone plan.

### `M1-D2-CODING` — real-E2B useful-coding partial gate

On the same exact candidate, run the included real-E2B `task_run` journey through an approved sandbox-local adapter, tool surface, workspace input, attributable output, cancellation, usage, provider failure, artifact integrity, and terminal cleanup. The record must report both mechanism and useful-capability verdicts.

This is not D2. It cannot complete E7, satisfy D2’s full run counts/schedule, or substitute for full D2 in a later D5/D6 or release decision. It unlocks only the internal alpha milestone after `M1-D1-SPINE` and its named dependencies pass.

### Normative-gate boundary

Both partial gates are non-promoting. They may support a separately named milestone decision, but not an epic-completion handoff for E3–E7. Full D1/D2 and any E6/E7 completion still require the current normative gates, including H-06, or a separately reviewed and approved amendment to `test-gates.md`.

### Excluded from the first milestone, retained for later phases

- browser-session execution and its D3 campaign;
- long-running service execution and its D4/72-hour campaign;
- installed desktop packaging, updater, desktop beta, and device-loss campaigns;
- cross-target mobility and handoff advertising;
- Commander, crew, and one-shot cutovers;
- two-control-plane high availability and replicated/autoscaled worker fleets;
- the three-Organization, all-workload private-beta campaign and its D6 matrix;
- public ingress, cloud plugin execution, multi-region active-active writes, and a self-hosted Firecracker fleet.

These are deferred, not deleted. Their program-design entries, findings, implemented slices, and conditional gates remain available for later milestone proposals.

## Dormant default-deny egress qualification

The checked-in default-deny/allowlist shape is not an enforcement claim while the provider path does not enforce it. For this milestone:

- no document may say sandbox egress denial passed merely because a policy object or allowlist was constructed;
- the managed-shared internal alpha may proceed only under the recorded accepted-residual model: host, operator, control-plane, cross-tenant, and unrelated connector credentials do not enter the sandbox; only the participating Organization’s approved runtime credential and scoped data are exposed;
- metadata/control-plane reachability is recorded as an unresolved provider-boundary risk rather than silently treated as denied;
- browser, service, public-ingress, and external beta claims remain blocked; and
- any self-hosted or tenant-hosted tier that promises egress denial must produce live packet-path enforcement evidence before enablement.

The accepted managed-shared DE-08 residual conflicts with the still-normative H-06/D2 network boundary: H-06 requires metadata, private, worker-control, and control-plane destinations to remain denied, including direct-IP, redirect, and DNS-rebinding variants. The DE-08 scope decision did not amend that gate. `M1-D1-SPINE` and `M1-D2-CODING` must record the residual and the credential-taxonomy mitigation explicitly, but neither may mark H-06 passed. Any full D1/D2, E6, or E7 completion requires live evidence satisfying the current requirement or a separately approved normative amendment.

The qualification limits blast radius; it does not turn a dormant control into a delivered one or a hard-invariant failure into a pass.

## Entry criteria

The milestone candidate may enter its integrated QA campaign only when:

- the proposal is approved and its dispositions are reflected in owner-approved epic plan amendments;
- E0–E2 historical completion evidence has passed a current dependency/delta review, including superseding records for any immutable-record breach;
- every required E3–E7 ticket has either a canonical approved result or a policy-compliant successor/adoption record that pins the retained historical blob and closes its stated delta;
- E3–E6 have candidate-specific ledgers showing which mechanisms are production-reachable rather than merely present and which clauses are certified only by `M1-D1-SPINE`;
- E5 has a new audit attempt superseding a1 and every first-milestone gate clause is `pass`, not `proven_weakly` or `not_proven`;
- the supported adapter, tools, workspace, output, audit/cost, and cleanup paths are enabled only for the named internal Organization;
- no excluded workload, desktop, mobility, cutover, HA, or beta flag is enabled; and
- the candidate revision, topology, configuration digests, external dependencies, partial-gate owner, QA owner, and rollback owner are frozen before the run starts; and
- reviewers acknowledge that the accepted DE-08 residual leaves H-06 unsatisfied for full D1/D2 and therefore prevents E6/E7 completion absent a separately approved normative amendment.

## Exit criteria

The first milestone passes only when one exact candidate has:

1. all required ticket results approved with no pending review sentinel;
2. a fresh `M1-D1-SPINE` partial-gate campaign on the declared one-control-plane/one-worker topology;
3. a fresh `M1-D2-CODING` partial-gate campaign covering the included journey, hostile tenant/credential cases, cancellation, output/artifact integrity, and every terminal cleanup path;
4. useful-agent capability evidence: the sandboxed adapter can use the approved tools/workspace and return attributable reviewable output; a mechanism-only run with `capabilityProven=false` cannot satisfy this criterion;
5. explicit observation of the dormant-egress residual and credential-taxonomy checks, without an egress-enforcement claim;
6. zero unresolved milestone-blocking findings and a recorded rollback rehearsal for the enabled path;
7. committed `Result: pass` QA records for both named partial gates on the exact candidate; and
8. a later committed, explicitly non-epic-completing `Decision: pass` milestone handoff by the named owner for the same candidate.

Ticket shipment or an earlier mechanism run cannot substitute for items 2–8. Passing this milestone does not change E3–E7 to `complete`; their normative epic gates remain outstanding.
