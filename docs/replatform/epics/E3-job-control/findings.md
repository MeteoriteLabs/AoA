# E3 — Durable Job Control — Findings

Planning and execution findings for JOB-001 through JOB-014. Findings are append-only;
resolution changes disposition but does not remove the original evidence.

## E3-F001 — E2 legacy-table grant prose is ahead of migration 0211

**Date:** 2026-08-09
**Status:** `resolved_by_corrective_E2_gate`
**Severity:** P1 STOP — locked-decision/as-built contradiction
**Affected tickets:** all E3 execution; directly JOB-001/JOB-010 through JOB-014

**Finding:** E2 QA prose says the non-owner `aoa_app` role is granted full DML on legacy
tables, but the as-built `packages/db/src/migrations/0211_tenant_rls_enforcement.sql` grants
it only `jobs`, `job_attempts`, `leases`, `workers`, `services`, `service_instances`,
`job_artifacts`, and `job_secret_handles`. E3 therefore cannot call the existing legacy
assignment/approval/budget/cost/audit/output services in the same non-owner tenant
transaction unless their exact tables receive additional grants. Falling back to the owner
pool would bypass the E2 serving-role contract and split the transaction.

**Independent-review correction:** Locked E2-D03 requires one non-owner application role,
full legacy-table DML grants, a flag-on whole-app serving connection, and privileged
migration separation. Migration 0211 and `server/src/index.ts` do not implement that
contract. The draft's least-privilege per-parity grants are a different architecture and
cannot resolve a locked E2 dependency by E3 planner fiat.

**Disposition:** STOP. The operator must choose one reviewed architecture and commit a
corrective E2 gate/handoff before E3 assignment: (A) correct E2 to its locked D03 contract;
(B) approve a successor that permits bounded parity-table grants on `aoa_app` while retaining
application-layer Company isolation for CAV-005; or (C) approve a successor with a distinct
non-owner `aoa_bridge` role/pool for legacy bridges while `aoa_app` remains the RLS-enforced
new-path role. If none is acceptable, order a dedicated E2 security/migration audit rather
than improvising. No E3 ticket is assignable meanwhile.

**Operator decision (2026-08-10):** Option B is selected. Amend E2-D03 with bounded traced
legacy-table grants on `aoa_app`, retain application-layer Company isolation for CAV-005,
and include E3-F002's metadata-only `aoa_operator` role in the same corrective E2 gate and
superseding handoff. Options A and C are not authorized.

**Resolution evidence (2026-08-10):** Independent review attempt 3 passed the corrected
serving/operator boundary at `7843b86e25eb1ff9c520308aef7f123fec6997a7`. Prerequisite
result, corrective E2 QA, and the superseding completion handoff are `complete`/`pass` in
reviewer evidence commit `6b1af52a4db8a0fa41514db564e8cb622b02e1ba`.

## E3-F002 — Platform-worker operator policy was described by E2 but not implemented

**Date:** 2026-08-09
**Status:** `resolved_by_corrective_E2_gate`
**Severity:** P1 — expected JOB-002 behavior but role model unresolved
**Affected tickets:** JOB-002, JOB-009, JOB-003

**Finding:** E2-D04/E2-D06 describe null-Organization `platform` worker rows as readable via
a distinct operator role/dedicated policy. Migration 0211 contains only the `aoa_app`
tenant policy (`organization_id = current_setting(...)::uuid`), so `aoa_app` correctly sees
and writes no null-Org worker row, but no application-serving operator policy exists yet.
Using the privileged owner connection for platform enrollment/session checks would violate
the non-owner serving contract.

**Disposition:** E2-D04/D06 make the missing operator-only behavior legitimate JOB-002
scope, but a new role/pool must be reconciled with E2-D03's “one non-owner application
role” during E3-F001 resolution. The draft candidate is a dedicated
NOSUPERUSER/NOBYPASSRLS `aoa_operator` role with least-privilege null-Org policies/grants for
both `workers` and `execution_targets`, an explicit fail-closed operator connection, and
tenant non-enumeration tests via a Decision #122 custom migration. The role cannot access
any job/attempt/lease/event/artifact/secret table. Platform polling authenticates the target
and captures a server-verified worker/target/generation principal snapshot through this
metadata-only path, then enters the selected Organization through the approved tenant/bridge
role and `runInTenant` before reading or leasing a job. The in-transaction fence guard must
recheck revocation/generation against authority visible through the chosen E3-F001 grant
model. This candidate is not authorized until the operator resolves E3-F001.

**Operator decision (2026-08-10):** Approve the proposed NOSUPERUSER/NOBYPASSRLS
`aoa_operator` role and fail-closed pool, limited to null-Organization platform target,
enrollment-route, device-proof, and revocation metadata. It receives no access to jobs,
attempts, leases, events, artifacts, or secrets. Implementation remains blocked until the
combined E2 corrective gate passes.

**Resolution evidence (2026-08-10):** The same reviewed revision proves the metadata-only
operator seam, masked-owner denial, exact effective-authority audit, target-resolver grant,
flag-off non-superuser safety, and awaited shutdown. JOB-002 still owns future enrollment,
proof, credential, routing, status, and revocation writes.

## E3-F003 — Current task checkout mechanism differs from historical shorthand

**Date:** 2026-08-09
**Status:** `resolved_by_canonical_ticket_text`
**Severity:** P2 documentation drift; no implementation blocker
**Affected ticket:** JOB-010

**Finding:** Repository guidance summarizes atomic issue checkout as `SELECT FOR UPDATE NO
WAIT`, while current `server/src/services/issues.ts` implements the single-winner behavior
with an atomic conditional update plus replay/stale-owner rules.

**Disposition:** JOB-010's canonical acceptance text explicitly says the observable
single-winner contract is authoritative and the plan must not freeze a stale SQL detail.
E3 reuses `issueService.checkout` and its current tests/service contract. No program-design
amendment is required.

## E3-F004 — Frozen-consumer checker pins the mutable repository lockfile

**Date:** 2026-08-10
**Status:** `resolved_by_corrective_E1_gate`
**Severity:** P1 STOP — frozen dependency gate conflicts with required consumer declaration
**Affected tickets:** JOB-001 and therefore all downstream E3 tickets

**Finding:** JOB-001 must declare `@armyofagents/worker-protocol: workspace:*` in
`server/package.json` and regenerate `pnpm-lock.yaml` under AGENTS §7. The as-built
`scripts/check-frozen-worker-protocol-consumer.mjs` hashes the current whole-repository
lockfile and compares it with the immutable E1 fixture's `lockfileIntegrity`. A legitimate
new server importer therefore makes the frozen check fail even though E1 source and frozen
bundle bytes remain unchanged. The same checker hashes working-tree bytes and currently
false-fails on a Windows CRLF checkout while the Git blobs still match the recorded hashes.

**Disposition:** STOP. The E1 Protocol/Schema Custodian must keep the frozen fixture
byte-identical but correct the checker to validate immutable source-SHA blobs or a protocol-
relevant dependency snapshot, including recorded Zod/esbuild versions instead of current
installed versions; fail if the source commit is unavailable; retain/extend its mutation
corpus; make Git-byte verification line-ending safe; and commit superseding QA/handoff
evidence. Changing the fixture, omitting
the consumer manifest dependency, or bypassing the check is not authorized.

**Operator decision (2026-08-10):** Approve the checker-only correction exactly as scoped
above. Frozen protocol/schema/bundle fixture bytes remain unchanged. JOB-001 remains blocked
until the Protocol/Schema Custodian commits superseding passing E1 QA and handoff evidence.

**Resolution evidence (2026-08-10):** Independent review attempt 3 passed the corrected
checker at `01ad1ab554fe25c5178c7552ec047d4df45b7dcf`. The prerequisite result, corrective
E1 QA, and superseding completion handoff are `complete`/`pass` in reviewer evidence commit
`db8afd27ab134ad741a96d2ef7f157c306690c44`. Frozen source/fixture trees are unchanged.

## E3-F005 — Device proof and worker-to-target binding are not frozen E1 interfaces

**Date:** 2026-08-10
**Status:** `approved_pending_JOB-002_implementation`
**Severity:** P1 STOP — security contract and schema binding unresolved
**Affected tickets:** JOB-002, JOB-009, JOB-003 and every governed worker operation

**Finding:** E1's strict enrollment request contains the request envelope and `hello`, but
no device public key, proof, or returned session field. The prior plan promised a thumbprint-
bound session without a proof transcript or per-request possession check; a copied bearer
token would therefore retain authority. The E2 `workers` row also has no target FK and its
deferred `owner_user_id` is `uuid`, while `authUsers.id` and
`execution_targets.owner_user_id` are `text`.

**Disposition:** The revised plan proposes, but does not approve, versioned HTTP header
proof using a device key while leaving E1 JSON unchanged, fresh per-request proof/replay
enforcement, bootstrap-only treatment of `worker_token_hash`, and a many-logical-workers-to-
one-execution-target composite `target_authority_key` binding that DB-enforces platform/same-
Org/same-owner compatibility, plus owner-ID type/FK correction. Durable proof-ID records have
explicit operator-role ownership, expiry indexes, retention, bounded cleanup, and restart
coverage. An opaque routing table discovers the candidate shard, while Organization/owner
code consumption, profile creation, and replay receipt commit in one `runInTenant`; platform
facts commit in one operator transaction. Unenrolled legacy targets keep
their current heartbeat credential; enrollment upgrades that target's heartbeat auth without
transferring execution authority. The operator must ratify that
threat model and exact binding, or choose an additive versioned E1 change with custodian
review. Pure bearer sessions are rejected.

**Operator decision (2026-08-10):** Approve versioned Ed25519 HTTP-header possession proof,
fresh proof-ID/time-window enforcement, separate durable semantic replay receipts, and the
database-enforced composite target-authority binding/owner-ID correction. Frozen E1 JSON
remains unchanged; an additive E1 wire change is not authorized.

## E3-F006 — Lifecycle, fence-time, revocation, and retry allocation were incomplete

**Date:** 2026-08-10
**Status:** `resolved_in_plan`
**Severity:** P1 plan correctness
**Affected tickets:** JOB-003 through JOB-007

**Finding:** The first draft did not atomically name both lease and attempt ACK transitions,
did not assign the later running transitions, accepted an ambiguous `now`, did not require a
current target-generation recheck, and had no unique/locked retry-attempt allocation.

**Disposition:** The plan now assigns ACK to lease `offered→active` plus attempt
`offered→leased`, assigns `attempt_started` to attempt/job running transitions, uses database-
fresh `clock_timestamp()` inside conditional mutation, makes a globally locked generation
cutoff immediately invalidate every governed guard, durably fans platform revocation into
separate `runInTenant` cancellation transactions, and adds a locked unique
`(organization_id, job_id, attempt_number)` allocator with concurrency/crash tests. Durable
same-key/same-digest operation receipts make enrollment/ACK/renew lost-response retries replay
without reapplying; a fresh device proof ID remains mandatory.

## E3-F007 — Evidence commands could false-green and the exit gate depended on E5

**Date:** 2026-08-10
**Status:** `resolved_in_plan`
**Severity:** P1 evidence integrity / program DAG
**Affected tickets:** all ticket ledgers and the E3 integration gate

**Finding:** PowerShell command chains used `;` and cleanup cmdlets, so a later successful
cmdlet could mask a failed native process. The E3 exit gate also required joined E5 artifact-
byte evidence even though E5 is a parallel/downstream lane and full D1 promotion occurs only
after E3/E5/E6 contributions exist.

**Disposition:** Every native process now runs through a fail-fast wrapper that makes errors
terminating and checks both invocation success and native exit code, with cleanup in
`finally`; missing-command and nonzero-native probes both propagate. E3 exit proves only E3-owned D1 contributions, including fenced
artifact authorization/metadata; it explicitly leaves artifact bytes and remaining provider-
resource proof to the later joined D1 gate.

## E3-F008 — Submission trusted a delivery envelope and publication durability was overstated

**Date:** 2026-08-10
**Status:** `resolved_in_plan`
**Severity:** P1 trust boundary / transaction semantics
**Affected tickets:** JOB-001, JOB-005, JOB-010 through JOB-014

**Finding:** `JobEnvelopeV1` contains server-authoritative delivery identities, hashes,
policy, and placement facts, so it is unsafe as external submission input. The first draft
also called existing live publications retryable without naming a durable publication outbox.

**Disposition:** External sources now use a bounded `SubmitJobCommand`; the server derives
authority and JOB-003 constructs E1 delivery from stored facts. Idempotency is principal/
source scoped with principal kind+ID in the unique key. Required legacy mutations and receipt state remain atomic, while current live
publications are explicitly best-effort invalidations; any correctness-critical delivery must
name a durable outbox.

## E3-F009 — External Claude review used the pre-plan shared-branch revision

**Date:** 2026-08-10
**Status:** `resolved_in_plan`
**Severity:** P2 review provenance / ticket sizing
**Affected ticket:** JOB-009; E3 plan review record

**Finding:** The user-provided Claude review inspected
`origin/docs/replatform-program` at `8e2faa590d4e97a2cbd250c55f4a2ed81a352a33`, where the
E3 folder still contained only its README. Its statement that E3 had no implementation plan
was therefore true for that shared revision but did not assess the local plan added by
`5b57511e5` and hardened by `173b89685`. The review's ordering, E2 RLS/composite-FK/C14,
and gate-evidence concerns were already closed in the local plan. Every ticket named
rollback, but JOB-012 through JOB-014 lacked explicit disablement behavior for accepted
events whose cost/audit/output projection receipt was still pending. Its observation that
canonical JOB-009 could hide more than three agent-days of work was also actionable.

**Disposition:** Keep JOB-009 as the locked canonical ticket, but divide its execution into
three explicit internal TDD/commit slices of no more than one agent-day: authority/schema
normalization, pure deterministic placement policy, and transactional persistence/concurrency.
Each slice records RED/GREEN evidence; a single distinct reviewer certifies the combined
ticket revision. For JOB-012 through JOB-014, flag-off first blocks new distributed
admission/leasing, then permits every already accepted projection to reach a terminal receipt;
the rollback gate refuses bridge disablement while a receipt is pending. Do not adopt the
proposed five-ticket-only plan or E6-first reordering: the operator and canonical program
design require all fourteen E3 tickets to be planned now, while execution stops at the named
`E6-D1-FOUNDATION` boundary.

## E3-F010 — Enrollment upgrade paths could restore or retain bearer authority

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-002_implementation`
**Severity:** P1 authority downgrade / secret retention
**Affected tickets:** JOB-002 and every later worker-authenticated operation

**Finding:** Final JOB-002 conformance checks found two downgrade paths before Slice C GREEN
was committed. The existing legacy token-rotation service could repopulate
`execution_targets.worker_token_hash` after a target had enrolled a proof-bound worker, and
the first local semantic-retry draft placed the returned bearer session in the retained JSON
receipt. The former could restore bootstrap bearer authority; the latter contradicted the
approved plan's prohibition on stored raw code/session material.

**Disposition:** Enrollment clears the bootstrap token, and legacy rotation now uses one
conditional update with an atomic `NOT EXISTS` current enrolled-worker guard. Semantic
receipts store only bounded E1 response/action facts. A retry must present a fresh valid
device proof, revalidates the current worker/target/generation/key/profile/membership inside
the owning transaction, and mints a new equivalent short-lived session. Tenant and platform
rollback tests cover the final receipt boundary; revocation/rotation/transfer and no-session-
at-rest regressions pass. No nonconforming Slice C GREEN revision was committed.

## E3-F011 — JOB-002 review found transport, shared-target, replay, and fixture gaps

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-002_fix_round_1_pending_review`
**Severity:** P1 H-01/H-04, migration, and evidence correctness
**Affected ticket:** JOB-002

**Finding:** Independent review attempt 1 found seven blockers: production HTTP request logs
could serialize worker credentials; Organization profiles on a shared platform target could
not retire or heartbeat global state safely; a global worker UUID collision exposed raw 23505
details; enrollment omitted bounded expired-proof cleanup; worker-control failures did not use
frozen `ProtocolErrorV1`; migration 0219 failed exact replay; and stale E2 worker fixtures
failed before their tenant assertions.

**Disposition:** Fix round 1 added genuine RED at
`894b84cbfd79132759daf43784d2381fbeb92246` and GREEN at
`988c2a8af24a1b24b1b9b896aae94e696dda53e4`. Credential routes now have strict safe request/
error logging; a shared platform target must first have current proof-bound platform physical
authority, while tenant heartbeat records profile liveness only and sessions recheck global
revocation; collisions and all HTTP failures close in frozen protocol vocabulary; proof
cleanup is ordered and bounded; 0219 replay is guarded; and E2 fixtures establish valid
target/device facts before non-vacuous H-01 assertions. Focused lanes pass, but the ticket
remains review-pending until a distinct reviewer independently certifies the candidate.

## E3-F012 — JOB-002 review attempt 2 found revocation, protocol-error, and replay-cleanup races

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-002_review_attempt_3`
**Severity:** P1 authority/replay correctness
**Affected ticket:** JOB-002 and every later worker-authenticated operation

**Finding:** Independent review attempt 2 confirmed the seven attempt-1 corrections, then
found three remaining blockers with temporary adversarial probes. First, an Organization
session bound to a shared platform target rechecks global physical authority during
authentication, but heartbeat later commits tenant-profile liveness without rechecking that
global authority; revocation between those steps therefore loses the race. Second, a
heartbeat request with no bearer fails before the route marks the response as worker protocol
v1, so it emits the generic HTTP error rather than frozen `ProtocolErrorV1`. Third, enrollment
deletes only the oldest 100 expired proof rows before inserting a proof. If the colliding
expired proof is outside that batch, the unique insert fails and rolls back the cleanup, so
every retry repeats the same failure forever.

**Disposition:** Fix round 2 added genuine RED at
`e66f173918eda336c0340a447ae8eab0862b2c0a` and GREEN at
`d9c8aa5db73f4218ae02f1ee505623c4ffd7e509`. Shared-platform physical heartbeat now
linearizes with revocation in one bounded operator transaction and conditionally updates only
physical liveness after rechecking every pinned authority fact; tenant profiles and global
trust/capability metadata are not mutated. The heartbeat route marks protocol context before
Authorization parsing and lookup. Proof recording deletes only the exact expired collision
by fresh database clock, independently of bounded housekeeping, and preserves unexpired
replay authority. Deterministic both-order row-lock tests, frozen-envelope early failures,
positions 1/100/101/301, restart, and concurrent-replica tests pass. Focused, RLS,
startup, frozen-E1, typecheck, and build lanes pass. The exact Windows full lane remains
honestly non-green for visible non-JOB-002 contention/Windows collection failures and is not
waived. JOB-002 is `implementation_complete_review_pending` until a distinct reviewer
independently certifies the candidate.

**Review-attempt-3 closure:** Distinct reviewer `Codex /root/job002_review` reviewed exact
revision `5a9870b89dbab1b626f825ec8e8261a6f77bd641` and independently reproduced all three
closures. Deterministic revoke-first and heartbeat-first row-lock tests proved that shared
platform liveness and revocation linearize and that the revoked principal cannot write again;
an additional temporary probe proved a caller-requested status change cannot mutate global
trust/status or tenant-profile liveness. Missing bearer, malformed bearer, and lookup failure
all produced descriptor-allowed frozen `ProtocolErrorV1`. Expired collisions at the committed
1/100/101/301 positions, an additional final-row collision, unexpired replay, restart, and
concurrent replicas all behaved as specified while cleanup remained bounded. No Critical,
Important, or specification blocker remains; JOB-002 review attempt 3 passed.

## E3-F013 - JOB-009 needed proof-bound profile authority without widening legacy resolution

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-009_implementation_pending_review`
**Severity:** P1 authority boundary / compatibility evidence
**Affected ticket:** JOB-009

**Finding:** The E2 registry had the correct target identity/generation/scope and JOB-002
persisted a hash of the worker hello, but authoritative placement also needs the registered
profile/provider ceilings and the proof-bound full hello that can only narrow those ceilings.
Legacy target rows do not contain that authority and cannot be inferred safely. JOB-002 also
leaves a freshly proof-bound worker in `enrolled`; its heartbeat path updates liveness but does
not promote trust status. During aggregate verification, the first implementation additionally
widened the pre-existing heartbeat resolver projection to the new profile columns, which broke
the E2 serving-role fixture and coupled legacy resolution to placement-only authority. Its
Windows integration skip expression also allowed Linux to skip the suite, which violated the
fail-closed test-hygiene contract.

**Disposition:** JOB-009 extends the one `execution_targets` registry with an atomic registered
profile/provider-constraint snapshot and stores the proof-bound full hello on the existing
worker row; it creates no second registry or wire field. Legacy rows without an explicit
registered placement profile remain ineligible/queued rather than receiving inferred
privilege. A current proof-bound `enrolled` worker or `active` worker may be considered only
when every target/generation/profile/key/thumbprint/hello fact still matches; hello can only
reduce server authority. Rich profile reads live in the JOB-009 bounded tenant/operator
repositories, while the legacy heartbeat resolver retains its original projection. Serving
role grants add only the exact new target-profile columns, and the integration suite runs by
default on Linux while Windows requires `AOA_RUN_WIN_INTEGRATION=1`. Focused placement,
role/RLS, migration/C14, frozen-E1, typecheck, and build lanes are green. The exact Windows
aggregate remains honestly non-green for visible non-JOB-009 collection/contention/timeouts;
DEC-03 Linux CI remains formal authority and a distinct reviewer must still certify JOB-009.

## E3-F014 - JOB-009 review exposed producer, registry, resolver, replay, rollout, and lease-invariant gaps

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-009_fix_round_1_pending_review`
**Severity:** P1 authority integration / H-03 defense in depth
**Affected ticket:** JOB-009 and the JOB-001/JOB-002 seams it consumes

**Finding:** Independent review attempt 1 found six Important blockers. JOB-009 parsed a
synthetic job shape rather than JOB-001's exact persisted requirements/request; the registered
target profile columns had no production authority writer; placement recreated routing without
Decision #117 credential/pin/slug resolution; replay digests omitted immutable placement
authority; rollout mode/reason were caller supplied; and PostgreSQL admitted lease-eligible
shadow, legacy, queued, and failed decisions. These gaps made the synthetic focused matrix
green while real submitted jobs and real enrolled targets could not safely become eligible.

**Disposition:** Fix round 1 committed genuine RED at
`11849e0f59b184e8dbc8a3d6041cc00f8173bba1` and GREEN at
`03005fcfacf7b924aae76d9c81666a5487039ce2`. The trusted server now normalizes the exact
JOB-001 persisted source objects for all six sources, ratifies canonical E1 profile/provider
hashes through bounded tenant-admin and platform-admin writers on the existing target registry,
and consumes `chooseExecutionTargetRow` for Decision #117 personal credential, bound slug, and
pin authority. One canonical digest binds every submitted, normalized, credential, resolver,
rollout, and selected-profile authority fact; byte-equivalent replay converges and a committed
20-field mutation matrix rejects drift. Rollout is resolved inside the trusted service through
the established deployment -> Organization -> workload gate using only closed reasons, and
flag-off never opens the operator reader. Generated Drizzle migration `0225` plus C14 guards
enforces lease eligibility iff selected+active; custom Decision #122 migration `0226` adds only
the exact profile-writer column grants.

The real registration -> JOB-002 enrollment/heartbeat -> JOB-009 placement test also showed
that proof-bound heartbeat updated only target liveness while placement correctly requires both
target and worker liveness. The bounded correction updates the exact proof-bound worker in the
same owning transaction after rechecking generation/key/thumbprint/profile facts; it does not
change status/trust/capabilities or contact the worker. Focused placement/grant **35/35**,
JOB-001/JOB-002/tenant/RLS **96/96**, serving-role/hygiene **22/22**, migration/C14 **5/5**,
startup **14/14**, frozen protocol, typecheck, and build lanes pass locally. The exact Windows
full lane exited 1 after 106.1 seconds without an aggregate because Vitest's IPC channel closed
after an unrelated embedded-Postgres setup failure; it is recorded as non-green and not waived.
JOB-009 remains `review_pending` until a fresh distinct reviewer certifies the new candidate.

## E3-F015 - JOB-009 pre-resolution order and owner-membership races

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-009_fix_round_2_pending_review`
**Severity:** P1 placement determinism / owner authority linearization
**Affected ticket:** JOB-009 and JOB-003's later authority recheck

**Finding:** Independent review attempt 2 found two Important blockers after confirming the
first fix round. The real transaction passed unordered tenant-plus-platform snapshots to the
existing Decision #117 resolver, so equivalent multi-match candidate sets could select a
different trusted target before the downstream pure policy sorted anything. Separately, owner
membership was read earlier in the tenant transaction but was not part of the final conditional
placement write. A suspension or deletion could therefore commit after the snapshot and before
the attempt update, while the old code still persisted an active, lease-eligible owner target.

**Disposition:** Fix round 2 committed genuine RED at
`d3b4f50cbcf3ce9348d2482261c098b4864f8141` and GREEN at
`372f150c9364d86caa63eb15edaa500ba44b7021`. A registered-authority comparator now orders the
combined candidate snapshot by scope/class priority plus slug/ID total-order tie-breaks before
the unchanged Decision #117 resolver runs; explicit pin and credential-bound target precedence
remain resolver-owned. All candidate permutations, equal-priority ties, tenant/platform
composition, and database enumeration changes converge on the same persisted placement.

The same final conditional attempt `UPDATE` now requires current active membership for the
exact Company, Organization, and owner principal when selecting an owner-desktop target.
Remove-first affects zero selected rows and persists only the stable unavailable,
lease-ineligible decision without a membership-existence oracle or partial tuple;
placement-first remains an immutable historical decision for JOB-003 to recheck/fence.
Delete/suspend, foreign/missing authority, retries, and non-owner targets are covered by
deterministic real-PostgreSQL barriers. No membership UPDATE grant, schema/migration, owner
fallback, lease/fence, or second registry was added. Focused JOB-009/grant **39/39**,
JOB-001/JOB-002/tenant/RLS **96/96**, startup **14/14**, serving-role/hygiene **22/22**,
migration/C14 **5/5**, frozen protocol, typecheck, and build lanes pass locally. The exact
Windows integration-enabled full lane remains honestly non-green with 17 visible failure
blocks in truncated output, none emitted from JOB-009; it is not waived. JOB-009 remains
`review_pending` until a fresh distinct reviewer certifies the candidate.

## E3-F016 - JOB-003 aggregate verification exposed receipt-grant and lifecycle-fixture drift

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-003_implementation_pending_review`
**Severity:** P1 fail-closed startup authority / deterministic regression evidence
**Affected ticket:** JOB-003

**Finding:** JOB-003 migration `0228` correctly granted tenant-serving DML on the new forced-
RLS `worker_operation_receipts` table, but the exact runtime startup authority allowlist still
expected no access to that table. The real server therefore failed closed at startup before
later negative cases could exercise `aoa_operator`. The same aggregate lane also found two
older test fixtures that seeded `active` leases without the newly required `activated_at`
fact, causing setup failures before their tenant and composite-integrity assertions.

**Disposition:** A genuine grant-contract RED was committed at
`a20758916ba18ddd9475e17ca6df9ccd595c6386` and GREEN at
`0c52ecbf1044cc1eadccfbaeb4de0fd2d8798428`. `JOB_LEASING_NEW_PATH_GRANTS` is a versioned
JOB-003 delta consumed by the fail-closed startup checker; immutable E2 grant constants and
applied migrations remain unchanged. The exact startup suite now passes 14/14, including all
role/grant/ownership drift denials. Fixture-only commits
`a1ade69e727d51ed4b8b28db1f3f4ab8adfeb8c5` and
`ee8a1005fa2a0d97f2dfcb68dbce1aa6b88f83a8` supply activation timestamps to legitimate
active-lease seeds. The adversarial tenant suite passes 11/11 across 4,460 operations and the
composite-integrity suite passes 9/9. JOB-003 remains review-pending for independent review.

## E3-F017 - JOB-003 review exposed platform composition, capacity, receipt-expiry, and upgrade gaps

**Date:** 2026-08-10
**Status:** `partially_resolved_in_JOB-003_review_attempt_2_followups_open`
**Severity:** P1 durable leasing correctness / compatibility
**Affected ticket:** JOB-003

**Finding:** Independent review attempt 1 found four Important blockers. The approved
operator-owned platform poll/outbox path exists only as uncomposed factories while HTTP proof
middleware rejects platform principals, so platform workers cannot poll and ready outbox rows
are never drained. Poll capacity counts all live leases against each candidate's one workload
slot limit and terminates the scan, allowing one batch lease or an incompatible head row to
hide valid browser work. ACK's bounded cleanup can leave the exact expired semantic receipt
outside the first 100 rows, after which an expiry-blind lookup replays stale success. Finally,
migration `0227` adds `activated_at` and an unconditional active-state check without an
idempotent compatibility step, so an E2-valid pre-upgrade active lease fails the migration.

**Disposition:** `needs_changes`. Real-PostgreSQL probes independently reproduced the
mixed-workload `no_work`, stale receipt replay behind 101 older expired rows, and SQLSTATE
23514 migration failure. The platform composition gap is also direct from the production call
graph: scheduler/outbox factories are consumed only by the focused test. A fresh implementer
round must add genuine RED coverage and (1) compose the flag-on-only operator-principal,
fair/bounded 32-shard/750-ms poll and outbox runtime while every job read remains in
`runInTenant`; (2) enforce independent applicable workload capacity and continue past
ineligible candidates; (3) validate/delete the exact expired receipt independently of bounded
housekeeping using database time; and (4) make the 0226-to-0227 upgrade compatible via a
C14-permitted idempotent data correction or narrowly proven legacy branch. Add non-vacuous
cross-tenant receipt RLS evidence before certification. Frozen E1, default-off behavior, and
the JOB-003 scope boundary must remain unchanged.

**Resolution:** Consolidated RED `6b722932e25a5e275dd3fa93d6c7b347b4e0bf7d` and GREEN
`ef972af6fde478f9e39fd36c36c23591a72c3eac` implement the independently accepted Decision
#124 successor, class-aware/no-head-of-line capacity, exact current receipt expiry, idempotent
populated-E2 migration backfill, and non-vacuous receipt RLS probes. Scheduler/legacy-authority
RED `8ce0547b68953fd1d4d8a0aa9d7180fb51b9a54e` and GREEN
`a61f028bd1fab392a08be879c7275a80a95e08cb` close the production composition and retired-token
writer gaps. All focused matrices pass locally; JOB-003 remains review-pending.

**Review attempt 2:** Exact revision `a48faac86cf3a875e5a16c487d91e88d9f78d6fd`
passes the original platform composition, mixed-class/provider capacity, exact receipt expiry,
populated upgrade, and cross-Organization receipt probes. The finding remains partially open:
E3-F021 through E3-F023 show that the composed scheduler is not bounded across target IDs or
all admitted Organizations and that restart/lost-hint pull recovery can still starve work
beyond the fixed candidate window.

## E3-F018 - Platform-physical ACK has no approved durable tenant-shard authority

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-003_review_attempt_2`
**Severity:** P1 STOP - H-01/H-02 tenant routing authority / frozen transport compatibility
**Affected tickets:** JOB-003 and later platform-session lease operations

**Finding:** JOB-003 review requires the platform-worker scheduler and outbox path to be
composed, but the approved single platform-physical session cannot durably route an ACK into
the mandatory tenant transaction. The frozen strict Lease ACK v1 body contains worker, job,
attempt, lease, fence, and timestamp facts but no Organization identifier; the current ACK URL
is lease-only. A platform-scoped worker session is structurally bound to
`organizationId: null`. No durable lease-to-Organization locator exists, and Decision #123 /
E3-F002 deliberately deny `aoa_operator` access to jobs, attempts, leases, outbox rows, and
operation receipts. An in-memory offer map is not restart-safe, a bounded tenant scan can miss
the ACK before its deadline, an unbounded scan creates a tenant oracle, and widening operator
lease access violates H-01. The existing Organization-scoped logical worker sessions on a
shared platform target are routable because their authenticated session carries the tenant,
but that is different from the plan's single platform-session scheduler prose.

**Independent review:** A distinct reviewer confirmed the STOP against the frozen E1 schemas,
current proof middleware, routes, grants, migrations, and call graph. Directly adding an
Organization field to the strict v1 JSON is incompatible. An unsigned header or query value
would not be authoritative; a signed/versioned path could only be a routing hint and still
does not by itself solve the platform-physical-worker to tenant-logical-worker binding.

**Recommendation:** Amend JOB-003 so tenant job poll/offer/ACK uses the existing
Organization-scoped logical session even when its physical target is platform-scoped. Keep
the platform-scoped session limited to physical registry and lifecycle control. This preserves
the frozen wire schema, makes the authenticated Organization select `runInTenant`, retains the
tenant logical worker identity used by lease foreign keys, and adds no operator job metadata.
The flag-on scheduler can still discover admitted Organization shards fairly and durably, but
must issue tenant work only through the corresponding Organization-scoped session.

If one platform-physical session must serve many tenants, an explicit architecture amendment
is required instead: a dedicated tenant-written locator containing only a domain-separated
hash of the opaque lease ID, candidate Organization, and expiry, inserted atomically with the
offer; FORCE RLS; own-Organization `aoa_app` DML; exact-lookup-only operator authority; no raw
lease, fence, job, or payload; and complete tuple/fence/deadline revalidation inside the
selected `runInTenant` transaction. That option must also define physical-to-logical worker
binding, revocation linearization, uniform missing/foreign behavior, retention, cleanup, and
exact startup-grant audits. It has residual operator-visible activity metadata and is therefore
not the preferred option.

**Disposition:** No fix-round RED or production change was started after this contradiction
was found. On 2026-08-10 the operator approved the recommended Organization-scoped-session
amendment as the production design. Decision #124 and the JOB-003 plan now require tenant
poll/offer/ACK and every later tenant worker operation to authenticate through the logical
Organization profile; the platform-scoped session remains physical-control-only. No lease
locator or E1 change is authorized. JOB-003 remains `needs_changes` until a fresh TDD fix
round and distinct review prove the amendment plus E3-F017; JOB-010 remains paused until that
review closes.

Implementation RED `6b722932e25a5e275dd3fa93d6c7b347b4e0bf7d` and GREEN
`ef972af6fde478f9e39fd36c36c23591a72c3eac`, followed by scheduler/legacy-authority RED/GREEN
`8ce0547b68953fd1d4d8a0aa9d7180fb51b9a54e` /
`a61f028bd1fab392a08be879c7275a80a95e08cb`, now enforce the approved logical-session design.
Platform sessions remain physical-control-only; no locator, operator job access, or frozen E1
change was added. The prior `needs_changes` disposition is now resolved in implementation,
pending a fresh distinct JOB-003 review; JOB-010 remains paused until that review passes.

**Review attempt 2 resolution:** The distinct reviewer confirmed the approved Decision #124
logical-Organization session design at exact revision
`a48faac86cf3a875e5a16c487d91e88d9f78d6fd`. Platform physical sessions remain control-only;
tenant poll/offer/ACK is routed by authenticated logical Organization authority, with no
locator, operator tenant-job access, or frozen E1 change. This finding is resolved, although
JOB-003 remains `needs_changes` for E3-F021 through E3-F024.

## E3-F019 - Initial Decision #124 guard and platform-profile liveness were not implementable

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-003_review_attempt_2`
**Severity:** P1 H-02 cutoff linearization / platform logical-profile availability
**Affected ticket:** JOB-003, with bounded JOB-002/JOB-009 synchronization seams

**Finding:** Independent review of the first E3-F018 amendment revision found two blocking
defects before implementation. First, an outer operator `FOR SHARE` transaction held across
`runInTenant` conflicts with JOB-003's tenant `FOR UPDATE` on the same null-Organization
platform target. Real PostgreSQL showed the current tenant UPDATE policy returns zero rows;
widening it would grant unsafe global mutation authority, while a widened probe deadlocked
with SQLSTATE 57014. Removing only the inner row lock still leaves a stale-commit window if
the operator connection dies before the tenant transaction commits, and operator→app nesting
opposes the existing app→operator pool order. Second, a real Organization logical profile on
a platform target is inserted with `workers.last_seen_at = NULL`, while its heartbeat updates
only physical operator metadata. The prior JOB-003 freshness predicate therefore rejected the
first real poll; seeded workers hid the circular prerequisite.

**Disposition:** Decision #124 and JOB-003 now specify an app-outer advisory handoff. Operator
locks physical target→worker `FOR SHARE`; while held, the app transaction acquires a shared
transaction-scoped advisory lock and plain-rechecks the target; operator validation commits;
the app retains the lock through tenant commit. Every platform authority writer locks
target→worker `FOR UPDATE`, takes the matching exclusive advisory lock, then changes status,
generation, device binding, or registered profile. Lock timeout, connection/process failure,
guard-first/cutoff-first, static writer inventory, and no-grant-widening tests are mandatory.
For liveness, a fresh session-bound device proof plus guarded fresh physical worker/target
heartbeat authorizes the platform logical operation; tenant `last_seen_at` is updated after
success for observability but is not a prior prerequisite. Real enrollment→physical
heartbeat→logical poll/ACK and stale-physical cases are mandatory. No production or test edit
may begin until the distinct reviewer accepts this successor plan revision.

The distinct JOB-003 reviewer accepted the complete amended plan at exact revision
`2e9217c1e900d42547fd8a1f432efc60f1af71f3` after the exact focused command, helper API/key,
0227 backfill, runtime test inventory, and stale cross-tenant polling prose were corrected.
This acceptance authorizes a fresh TDD fix round; it is not a JOB-003 implementation pass.

Implementation GREEN `ef972af6fde478f9e39fd36c36c23591a72c3eac` realizes the app-outer
shared-advisory handoff, exclusive-writer inventory, connection-loss rollback, and physical-
heartbeat/logical-session liveness rules without grant widening. The accepted DB and server
matrices pass locally. This resolves implementation feasibility but is not a review pass.

**Review attempt 2 resolution:** Exact revision
`a48faac86cf3a875e5a16c487d91e88d9f78d6fd` passed both lock orders, operator-connection-loss
rollback, target-to-worker/shared-advisory handoff, and platform physical-heartbeat/logical-
profile liveness without role/grant widening. The live call graph has no discovered authority
writer bypass. This finding is resolved; E3-F024 separately records that the required static
regression inventory is too weak to certify future bypass detection.

## E3-F020 - Outbox readiness lost PostgreSQL sub-millisecond precision

**Date:** 2026-08-10
**Status:** `resolved_in_JOB-003_review_attempt_2`
**Severity:** P1 durable scheduling liveness / deterministic local evidence
**Affected ticket:** JOB-003

**Finding:** A combined embedded-PostgreSQL run intermittently published an older ready hint
but skipped the newly inserted ready row. The repository sampled database time, converted it
to a JavaScript `Date`, and rebound that millisecond value as the readiness cutoff. PostgreSQL
retained microseconds on `available_at`, so a row at `.123456` could compare after a caller
cutoff of `.123000` even though the claim statement itself ran later. The same precision gap
applied to both outbox and job availability predicates.

**Disposition:** Deterministic RED `617661bc294bb7030a6bd7f41ab85927edfe07e5`
sets both availability facts to a sampled millisecond plus 500 microseconds, waits until the
database clock is later, passes the truncated JavaScript timestamp, and keeps a true future
row as a negative control. GREEN `d7f726ca65430551420a6ed6db764138d06c0d1a`
uses one database-native, stable, index-friendly `statement_timestamp()` cutoff for both
ready predicates while retaining caller time for durable claim/update timestamps and the
stale threshold. The focused regression passes and the complete H-03 lane passes 14/14 on
three consecutive fresh runs. No fence-time predicate, E1 wire field, grant, or migration
changed. JOB-003 remains review-pending.

**Review attempt 2 resolution:** The distinct reviewer reran the deterministic microsecond
eligibility/future-negative matrix at exact revision
`a48faac86cf3a875e5a16c487d91e88d9f78d6fd` and inspected both job and outbox predicates.
Database-native `statement_timestamp()` supplies the readiness cutoff without a JavaScript
millisecond round trip. This finding is resolved.

## E3-F021 - Ready-scheduler hint memory is unbounded across execution targets

**Date:** 2026-08-10
**Status:** `open_JOB-003_review_attempt_2`
**Severity:** P1 Important - bounded scheduler contract / process-memory liveness
**Affected ticket:** JOB-003

**Finding:** `server/src/services/job-ready-scheduler.ts` stores an Organization map whose
values are target maps whose values are attempt sets. `maxHintsPerShard` is checked only
against one target's attempt set. Neither target-map cardinality nor the aggregate hints for
an Organization has a limit or expiry, and only `take(organizationId, targetId)` removes a
target entry. Outbox delivery is committed after the scheduler accepts the hint, so a hint
for an offline, revoked, or historical target is not durably retried and may remain in memory
indefinitely.

**Review evidence:** A read-only built-runtime probe configured
`maxOrganizationShards: 1, maxHintsPerShard: 1` and published 1,000 distinct valid target and
attempt UUID pairs in one Organization. All 1,000 calls returned accepted and `size()` returned
`{ organizations: 1, hints: 1000 }`. Existing tests bound duplicate/one-target sets and reject
a second full Organization but do not vary target cardinality within one Organization.

**Disposition:** JOB-003 remains `needs_changes`. Bound aggregate hints and target cardinality
per Organization or globally, define deterministic cleanup/eviction that preserves durable
pull recovery, and add multi-target churn, offline/revoked-target, and delivered-row evidence.

## E3-F022 - Lost-hint pull recovery can starve compatible work beyond 256 candidates

**Date:** 2026-08-10
**Status:** `open_JOB-003_review_attempt_2`
**Severity:** P1 Important - H-03 scheduling liveness / no head-of-line blocking
**Affected ticket:** JOB-003

**Finding:** Each poll initializes its lexical cursor and scan count anew, examines at most
256 ready candidates, and then returns `no_work`. SQL selection filters durable placement and
readiness but cannot filter worker-advertised workload slots, dynamic capabilities, resource
fit, or class/provider capacity; those permanently incompatible candidates are rejected later.
The next request therefore scans the same oldest 256 again. A hint accepted before restart is
already marked delivered while scheduler memory is process-local, so restart or hint loss
removes the only path that could prefer a later compatible attempt.

**Review evidence:** A temporary real-PostgreSQL probe queued 256 older batch attempts, used a
poll advertising `batchSlots=0` and `browserSessionSlots=1`, and queued a compatible browser
attempt at position 257. The poll returned `no_work` instead of the browser offer. The probe
was run once and completely removed. The existing no-head-of-line test has only two
incompatible heads and does not cross the scan bound or restart the scheduler.

**Disposition:** JOB-003 remains `needs_changes`. Provide restart-safe bounded fairness by a
durable or retained cursor, capability/capacity-aware selection, or another mechanism that
cannot repeatedly pin the same window. Add greater-than-256, restart/lost-hint, worker-churn,
and concurrent-poller evidence.

## E3-F023 - Outbox ticks enumerate all Organizations and have no real 750-ms DB budget

**Date:** 2026-08-10
**Status:** `open_JOB-003_review_attempt_2`
**Severity:** P1 Important - bounded traversal / scheduler availability
**Affected ticket:** JOB-003

**Finding:** Runtime startup queries and materializes every active admitted Organization on
every tick. The outbox worker then deduplicates and sorts that full collection before slicing
at most 32. The tick has no elapsed deadline, statement timeout, or cancellation budget; the
750-ms value controls only interval cadence. Organization discovery is therefore O(all
Organizations), and sequential tenant claims can exceed 750 ms without stopping at a cursor.
This does not satisfy the locked at-most-32-Organization and at-most-750-ms database-work
contract.

**Disposition:** JOB-003 remains `needs_changes`. Push keyset/limit selection into the
database-facing traversal, enforce an actual monotonic or statement deadline, and retain or
persist cursor progress across bounded ticks. Add more-than-32-Organization and deliberately
slow-tenant tests that prove both work and time bounds plus eventual rotation.

## E3-F024 - Platform-authority writer inventory does not fail on new bypasses

**Date:** 2026-08-10
**Status:** `open_JOB-003_review_attempt_2`
**Severity:** P1 Important - H-02 cutoff regression certification
**Affected ticket:** JOB-003

**Finding:** The mandatory static writer-inventory test reads four broad source files and
only asserts that each file contains the exclusive guard helper symbol somewhere. It does not
bind each status, generation, device-binding, or registered-profile mutation to target-to-
worker row locks and the exclusive advisory, and it does not discover mutation sites in
unlisted files. Generic worker-enrollment mutation methods remain available. Adding an
unguarded mutation in a listed file beside an existing helper, or in another file, leaves the
test green.

**Review evidence:** The distinct review found no bypass in the current live production call
graph, and the real guard-first, cutoff-first, operator-loss, and liveness tests pass. The
blocker is the explicitly required proof that every current writer is inventoried and that a
new bypass makes the static contract fail.

**Disposition:** JOB-003 remains `needs_changes`. Replace substring presence with an exact
AST/allowlist inventory or expose only a narrow guarded mutation API; enumerate all mutation
sites and callers, preserve only the exact approved last-seen exemption, and include a
negative unguarded-writer fixture that must fail.

## E3-F025 - Two-field lease scan cursor contradicts the locked job-claim order

**Date:** 2026-08-10
**Status:** `blocked_pending_independent_plan_amendment_review`
**Severity:** P1 STOP - durable scheduling semantics / restart-safe fairness
**Affected ticket:** JOB-003

**Finding:** Fix-round-2 RED correctly required restart-safe progress beyond 256 incompatible
attempts, but its proposed worker cursor stored only `(created_at, id)`. The locked claim index
and repository order are `(available_at ASC, priority DESC, created_at ASC, id ASC)`. A
two-field cursor cannot identify a continuation in that total order. Reordering claims to
`(created_at, id)` would regress availability and priority semantics; looking up omitted
cursor facts through a referenced job would be deletion/mutation unstable and would turn a
tenant-local pagination value into an unnecessary existence dependency.

**Disposition:** Implementation stopped before editing `workers`, generating migration
`0229`, or changing the leasing repository/service. The plan amendment specifies four
nullable no-FK worker columns—`lease_scan_cursor_available_at`,
`lease_scan_cursor_priority`, `lease_scan_cursor_created_at`, and
`lease_scan_cursor_id`—with an all-or-none CHECK. The continuation predicate preserves the
complete sort direction, no-offer scans atomically persist the last examined tuple under the
existing logical-worker lock, and end-of-order clears all four for a bounded wrap. A distinct
reviewer must accept the amended plan before the committed RED or production code changes.
