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
