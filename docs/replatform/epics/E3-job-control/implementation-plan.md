# E3 — Durable Job Control — Implementation Plan

**Plan status:** `approved_blocked_on_predecessor_corrections` — the operator approved the
reviewed plan and recommended E2/E1/JOB-002 choices on 2026-08-10. E3 ticket implementation
is not assignable until the named E2 and E1 corrective gates pass.

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` to execute this plan ticket by ticket
> **only after operator approval**. Every ticket uses a fresh implementer subagent
> (strict RED → GREEN) and a DISTINCT independent reviewer subagent. A separate
> Integration Gate Owner, who implemented/reviewed no E3 ticket, owns the epic gate.
> The operator approved the read-back on 2026-08-10. Only the approved predecessor
> corrections may execute first; no E3 ticket may be assigned until their committed passing
> handoffs exist. The ticket-by-ticket subagent/reviewer protocol then applies unchanged.

**Goal:** Build the dormant, durable, tenant-safe control plane for immutable job
submission, device-bound worker enrollment, authoritative hybrid placement, atomic
lease/ACK, fencing, ordered events, cancellation/retry/reconciliation, quota/revocation,
operator controls, and legacy-control parity without creating a second product engine.

**Approved architecture (pending predecessor correction):** PostgreSQL is the sole job/attempt/lease authority. Every tenant job,
poll/lease, event, control, reconciliation, and operator read executes through an
operator-approved non-owner pool and `runInTenant(appDb, organizationId, fn(repos))`; forced
RLS and composite tenant FKs remain the defense-in-depth boundary. The approved E2-D03
successor uses bounded traced legacy grants on `aoa_app` plus a metadata-only
`aoa_operator` role for null-Organization platform authority. E1's frozen v1 protocol is
consumed unchanged; device possession travels in versioned HTTP headers. Server-owned
placement intersects the registered target profile with
the worker's dynamic report before job details are released. A lease claim and its fence
are committed atomically, and one shared fence guard authorizes every later governed
mutation. Legacy task assignment, approvals, runtime decisions, budgets, cost, activity,
outputs, and summaries are called through transaction-scoped bridges; they are not
reimplemented. Distributed execution stays behind
`AOA_DISTRIBUTED_EXECUTION_ENABLED=false` and does not become authoritative for an
Organization/workload until E10 migration tickets transfer ownership.

**Tech stack:** TypeScript, Express 5, React/Vite, PostgreSQL, Drizzle ORM, E1
`@armyofagents/worker-protocol`, Vitest, and `embedded-postgres`.

---

## 0. Planning record, freeze, and dependency gates

| Item | Recorded value |
|---|---|
| Frozen `origin/main` | `003492988269a91eadfadb352bff7f413fa61adb` — present locally and an ancestor of the current `origin/main`; the crosswalk execution freeze is intact. |
| E3 Start SHA | `8e2faa590d4e97a2cbd250c55f4a2ed81a352a33` — fetched `origin/docs/replatform-program` and the `C:\e3` worktree's initial HEAD before planning commits. This exact bare 40-hex value is the `Start SHA` in `JOB-001-result.md`. |
| E0 completion | `pass` — `docs/replatform/epics/E0-foundation/handoffs/2026-08-08-epic-completion-3a469b6bec68-a1.md`. |
| E1 completion | Handoff is `pass`, but E1's frozen-consumer checker pins the whole current `pnpm-lock.yaml`; JOB-001's required declared server dependency changes that file. A protocol-custodian correction and superseding evidence are required before JOB-001 can consume the package without breaking the frozen gate. |
| E2 completion | Handoff says `pass`, but independent E3 review found its locked E2-D03 serving-role acceptance is not present in the as-built migration/boot path. E3 may not consume that interface until reconciled by an approved correction/amendment and superseding evidence. |
| `E6-D1-FOUNDATION` | **Not present / not passed at planning time.** It is a named partial gate, never a ticket-result substitute. |
| Planning worktree | `C:\e3`, branch `codex/epic-e3-job-control`; dependencies installed with `pnpm install --frozen-lockfile`. |
| Formal test authority | Linux CI under DEC-03. Windows short-path evidence is operator-directed local evidence and must be labeled as such. |
| Planning baseline smoke | `pnpm build` passed at the Start SHA. After package build, `pnpm test:run` reaches the suite but exits on Windows with the already-recorded E2 `ERR_IPC_CHANNEL_CLOSED` worker-protocol transform artifact; this is planning context only, not E3 gate evidence or a waiver. |

The canonical JOB text and frozen-main crosswalk agree with E1's protocol semantics; E1's
as-built frozen-consumer verification seam conflicts with the required later consumer
dependency (STOP below). E2's locked decision and completion prose contradict its as-built
serving-role interface (STOP below). One separate
stale implementation shorthand was resolved without amendment: the
current `issueService.checkout` uses an atomic conditional update, while older prose says
`SELECT FOR UPDATE NO WAIT`. JOB-010 explicitly makes the observable single-winner
contract authoritative and forbids freezing a stale SQL detail, so E3 reuses the service
contract and does not duplicate its SQL.

Planning findings are retained in [`findings.md`](findings.md). E3-F001/E3-F002 cover the
serving/operator-role gaps, E3-F003 records checkout shorthand drift, E3-F004 records the E1
frozen-consumer checker conflict, and E3-F005 records the approved device-proof and
worker-target binding contract. E3-F006 through E3-F008 record plan defects corrected by
this revision. The operator selected bounded-grant E2 option B, approved the E1 checker-only
correction, and approved E3-F005's HTTP-header proof/composite binding on 2026-08-10.
E3-F001/E3-F002 and E3-F004 remain execution blockers until their corrective gates and
superseding handoffs pass; E3 may not improvise beyond the approved contracts.

### APPROVED CORRECTION REQUIRED — locked E2-D03 is not the as-built serving path

Locked E2-D03 (`docs/replatform/epics/E2-tenant-kernel/decisions.md`) requires one
non-owner application role for all serving queries, full DML grants on legacy tables, a
flag-on whole-app serving connection, and privileged migrations/DDL completed before that
pool opens. The E2 completion handoff repeats that the whole-app cutover is
dormant-but-tested. At the branch tip, however:

- `packages/db/src/migrations/0211_tenant_rls_enforcement.sql` grants `aoa_app` only the
  eight new-path tables;
- `server/src/index.ts::maybeProvisionTenantAppRole` provisions LOGIN only and explicitly
  says it does not open the serving pool; and
- no flag-on whole-app switch replaces the owner `db` passed to `createApp`.

The operator selected option B on 2026-08-10. The alternatives remain recorded for review
provenance, but only B plus the metadata-only operator role is authorized:

1. **A — Correct E2 to its locked contract (review recommendation):** implement the full
   flag-on non-owner serving cutover and legacy grants, reconcile the already-described
   null-Org operator policy, rerun E2's security/integration gate, and commit a superseding
   E2 completion handoff before E3 assignment.
2. **B — SELECTED: bounded-grant successor to E2-D03:** permit only the traced parity-table
   grants on `aoa_app`, retain application-layer Company isolation for CAV-005, and add a
   distinct NOSUPERUSER/NOBYPASSRLS metadata-only `aoa_operator` role for null-Organization
   platform target/enrollment/proof/revocation authority. `aoa_operator` receives no access
   to jobs, attempts, leases, events, artifacts, or secrets. Update the locked decision and
   E2 evidence, then run a corrective E2 gate and superseding handoff.
3. **C — Approve a split-role successor to E2-D03:** use a distinct non-owner `aoa_bridge`
   role/pool for legacy parity bridges while `aoa_app` remains RLS-only for new-path tables;
   update the locked decision and E2 evidence, then run a corrective E2 gate and superseding
   handoff. This provides stronger privilege separation but adds a credential/pool. The
   amendment must also grant/policy `aoa_bridge` into the required new-path receipt/job rows
   under FORCE RLS; a legacy-only bridge cannot make one atomic new+legacy projection.

If none is acceptable, pause for a dedicated planning-only E2 security/migration audit.
No option may use an owner-pool bridge or split one parity projection across owner/new-path
transactions; either would violate the serving-role contract and JOB-013 atomicity.

Until the committed corrective evidence exists, **all E3 ticket implementation is blocked**.

### APPROVED CORRECTION REQUIRED — E1's frozen-consumer gate pins a mutable lockfile

The frozen v1 bundle and schema are valid and remain immutable. The problem is the as-built
verification seam: `scripts/check-frozen-worker-protocol-consumer.mjs` hashes the current
working `pnpm-lock.yaml` and compares it with the E1 fixture's recorded hash. JOB-001 must add
`@armyofagents/worker-protocol: workspace:*` to `server/package.json` and regenerate that
lockfile under AGENTS §7, so a legitimate consumer declaration necessarily changes the hash
and fails `pnpm check:frozen-worker-protocol-v1`. The checker also hashes working-tree bytes,
which produces a separate CRLF false failure on Windows even when the Git blob is unchanged.

The operator approved this checker-only correction on 2026-08-10; it remains owned by the E1
Protocol/Schema Custodian. Keep the frozen fixture byte-identical, but make its dependency
proof compare the recorded source-SHA Git
blobs and protocol-relevant dependency snapshot—including recorded Zod/esbuild versions—
rather than the mutable current repository lockfile/package or currently installed versions.
The check fails clearly if the recorded source commit is unavailable, retains the mutation
corpus, adds LF/CRLF-safe tests, and commits a superseding E1 QA
record/handoff. Any alternative—including changing the frozen fixture, omitting the server
manifest dependency, or bypassing the check—is a STOP requiring explicit custodian approval.
JOB-001 cannot be assigned until the corrected check passes at its assignment revision.

### Execution boundary

| Boundary | Tickets | Assignment rule |
|---|---|---|
| **Pre-D1, approved but blocked on corrections** | JOB-001, JOB-002, JOB-009, JOB-003, JOB-010 | Requires committed passing E3-F001/E3-F002 reconciliation and E3-F004 correction handoffs. E3-F005's device/binding contract is approved for JOB-002 implementation. Then respect ticket dependencies; JOB-010 may start after JOB-001. |
| **Post-D1, blocked** | JOB-004–JOB-008, JOB-011–JOB-014 | Do not assign until a committed `E6-D1-FOUNDATION` QA record **and passing handoff** cover E6F-00–E6F-08 on one revision. |
| **E3 exit gate, blocked** | all JOB-001–JOB-014 evidence | Requires every ticket complete and the post-D1 closure. A Windows-local run is not a substitute for the formal Linux lane. |

### NOT in scope (epic non-goals)

- No legacy/distributed execution cutover, shadow execution with external effects, or
  per-Organization/workload authority transfer; E10 MIG tickets own cutover.
- No E1 v1 redesign. An unavoidable wire change is an additive, versioned field only and
  is a STOP requiring the Protocol/Schema Custodian's approval plus D0-T04 evidence.
- No second assignment, approval, runtime-decision, budget, pricing, audit, output, or
  completion engine.
- No provider implementation, runner, sandbox, object-byte store, secret materialization,
  public worker ingress, realtime durability claim, desktop packaging, or mobility.
- No Firecracker support or claim (CAV-002); target/provider matching remains provider-neutral
  and implements only registered capabilities.
- No RLS retrofit on legacy Company tables (CAV-005), no unsafe owner-pool fallback, and
  no weakening of `assertCompanyAccess`.
- No `NULLIF(current_setting(...), '')` RLS-policy rewrite for E2-F012. E3 has no valid
  unwrapped new-path query: every path uses `runInTenant`. Regression tests keep that
  fail-closed assumption explicit; a future global/operator read that needs otherwise
  requires a reviewed decision and custom RLS migration.

---

## 1. Consumed as-built interfaces / what already exists and is reused

### Frozen E1 protocol — consume, do not edit

| Interface | E3 use |
|---|---|
| `packages/worker-protocol/src/job.ts` | Validate immutable `JobEnvelopeV1`, all six source variants, target requirements, requester/executor identity, policy hashes, lease offer/ACK/renew shapes. |
| `states.ts` | Apply the generated legal job/attempt/lease transitions; never invent a combined state machine. |
| `capabilities.ts` | Use `registeredTargetProfileV1Schema` and `workerSatisfiesRequirements`; registered profile/provider ceilings intersect worker hello. |
| `transport.ts` | Implement enrollment, poll/no-work, lease ACK/renew, event upload, control commands/ACKs with the frozen operation limits/audiences. |
| `events.ts` | Recompute event digest before authorization/persistence; use receiver replay/gap/stale-fence decisions and cumulative ACKs. |
| `policy.ts` | Preserve separate product approval and runtime-decision aggregates and timeout/default rules. |
| `artifacts.ts` | Expose the active-fence authorization seam for ordinary commit; stale/replaced output can only enter the separate quarantine operation owned downstream. |
| `errors.ts` | Return the closed v1 codes (`malformed`, `unauthorized`, `incompatible_*`, `stale_fence`, `sequence_gap`, `target_revoked`, `event_hash_mismatch`, `throttled`, `payload_too_large`, `attempt_terminal`, `internal_unavailable`) without existence or secret disclosure. |

### E2 tenant kernel — mandatory for every E3 path

| Interface | E3 use |
|---|---|
| `server/src/db/tenant-context.ts` | All tenant job/lease/event/control handlers, outbox drains, sweepers, bridge projections, and tenant operator reads call `runInTenant`. Platform-target enrollment/session verification is a separate operator-only path that can read no job data; after it chooses an admitted Org shard, job access enters `runInTenant`. Add an overload-compatible second callback argument only where an existing legacy service must share the same transaction; old one-argument callbacks remain source-compatible and the handle may not escape. |
| `packages/db/src/repositories/tenant/index.ts` | Extend the tenant-bound repository factory with job-control methods. No unscoped new-path reader is exported. |
| Eight E2 tables | Add rich E3 columns to `jobs`, `job_attempts`, `leases`, and `workers`; retain E2 composite FKs and FORCE RLS. `job_artifacts` and `job_secret_handles` consume the shared fence guard but their content/materialization remains E5. |
| `server/src/services/tenant-admission.ts` | JOB-001/JOB-010 call it before persistence and add the missing Organization-mapping/existence check. Sentinel or unmapped admission fails uniformly. |
| `createTenantAppDb` / `assertNonOwnerConnection` | When the deployment flag is on, boot opens only the explicit `AOA_APP_DATABASE_URL`, asserts NOSUPERUSER/NOBYPASSRLS, and fails startup on missing/privileged credentials. Flag-off boot creates no tenant pool. |
| `resolveDistributedExecutionRollout` | The global flag is necessary but never sufficient for execution authority. E3 tests deployment/Organization/workload decisions; E10 owns enabling actual Organization/workload cutover. |

### Existing engines E3 bridges

| Existing authority | Files | Reuse rule |
|---|---|---|
| Target registry / Decision #117 | `packages/db/src/schema/execution_targets.ts`, `server/src/services/execution-targets.ts`, `server/src/routes/execution-targets.ts`, `server/src/services/execution-target-resolver.ts` | Extend this registry and link E2 `workers`; do not create a second target catalog. |
| Task checkout / assignment | `server/src/services/issues.ts` | Call `issueService.checkout`, ownership validation, and release behavior. Preserve dependencies, single assignee, replay, and bounded stale-owner adoption. |
| Organization capacity | `server/src/services/org-concurrency.ts` | Refactor into one shared transaction-scoped claim/release/wakeup primitive that counts legacy runs plus distributed attempts. |
| Product approvals | `server/src/services/approvals.ts`; crew preflight services | Call existing create/resolve/preflight behavior. |
| Runtime decisions | `server/src/services/agent-runtime-decisions.ts` | Persist/answer/expire/cancel using the existing aggregate; worker events are observations only. |
| Budgets / cost | `server/src/services/budgets.ts`, `server/src/services/costs.ts`, `server/src/services/one-shot-cli-budget.ts` | Extend the existing scopes/idempotency and server-owned rate calculation; worker usage is evidence, never price authority. |
| Activity/audit | `server/src/services/activity-log.ts` and hub activity contracts | Insert accepted audit in the mutation transaction; publish only after commit. |
| Task output / summary | `server/src/services/task-outputs.ts`, `server/src/services/run-summary-comment.ts` | Reuse provider/external idempotency, primary/review semantics, and summary formatting; add durable projection identity rather than a parallel store. |
| Current execution sources | `server/src/services/heartbeat.ts`, Commander runner, crew runner, extraction/compaction/readiness services | JOB-010–014 provide admission/projection bridge seams and parity tests. The current path stays authoritative until MIG-005/006/007. |

---

## 2. Control-plane shape and transaction rules

### Source of truth and synchronization

| Aggregate/fact | Authority | Synchronization rule |
|---|---|---|
| Job, attempt, placement, lease, fence, accepted event/control, projection receipt | PostgreSQL E2/E3 tenant tables | Single writer in the tenant transaction. Worker state is a report; no peer sync or permanent dual write. |
| Registered target policy/profile | Existing `execution_targets` registry; E2 `workers` holds device/logical-profile identity | Server profile and generation are authoritative; worker hello can only narrow eligibility. |
| Legacy assignment/approval/budget/cost/activity/output | Existing product tables/services | E3 invokes the current engine transactionally and stores only a linking receipt. Ownership transfers only in E10. |
| Immutable input/base/policy hashes | Job row plus Git/object manifest references | References are immutable; E3 does not copy repository or object bytes into the DB. |
| Event/output observation | Worker, until accepted | It becomes authoritative only after digest, tenant, active-fence, sequence, state, and policy checks commit. |
| Ready/wakeup hint | Job outbox, then non-authoritative scheduler hint | Loss/duplication may affect latency only. Poll/claim transaction rechecks every authority condition. |

### Frozen lifecycle application

E3 calls E1 transition predicates directly. Database checks constrain membership; services
own guarded edges and test the exhaustive allowed/forbidden Cartesian matrix.

```text
job:     queued -> running -> succeeded | failed | dead_letter
           |          |
           +-----> cancel_requested -> cancelled | failed | dead_letter

attempt: pending -> offered -> leased -> running -> succeeded | failed
            |         |         |          |
            +---------+---------+------> cancel_requested -> cancelled | succeeded | failed | expired
            \---------\---------\--------------------------> expired/cancelled

lease:   offered -> active -> released
            |         |
            +---------+-> expired | revoked
```

`failed` requires E1 `non_retryable_failure`; `dead_letter` requires
`policy_exhausted`. Retrying creates a new attempt. Terminal job/attempt/lease rows are
immutable. Browser-session and service desired/instance machines remain distinct and are
never collapsed into these delivery states.

```text
authenticated caller / worker session / operator
                    |
       resolve Organization + Company + actor
                    |
       runInTenant(non-owner appDb, orgId)
                    |
       +------------+------------------------------+
       | tenant repositories (FORCE RLS)           |
       | optional callback-local tx bridge          |
       +------------+------------------------------+
                    |
 submit -> immutable job + attempt + outbox (one tx)
                    |
 placement -> one server decision, no job disclosure
                    |
 poll -> lock oldest eligible attempt -> offered lease/fence
                    |
 ACK -> active lease -> renew/events/controls/completion
                    |
 every governed write calls authorizeActiveFence(...)
                    |
 stale/replaced/terminal -> reject; output quarantine only
```

Inline ASCII comments explaining this ordering belong in
`packages/db/src/repositories/tenant/job-control.ts` (claim/fence predicates),
`server/src/services/job-leasing.ts` (placement → lock → lease),
`server/src/services/job-events.ts` (digest → identity/fence → sequence → projection → ACK),
and `server/src/services/job-reconciliation.ts` (cancel/expire/retry winner ordering).

### Shared database changes

E3 primarily extends E2 tables. New tenant tables are limited to durable facts that do
not fit an existing aggregate:

| Owner ticket | Schema module | Purpose / key constraints |
|---|---|---|
| JOB-001 | `packages/db/src/schema/job_outbox.ts` | Transactional attempt-ready notification. Unique `(organization_id, attempt_id, kind)`; bounded claim/retry metadata; payload contains identifiers only. JOB-006 writes a new row atomically with every retry attempt. |
| JOB-002 | `packages/db/src/schema/worker_enrollment_code_routes.ts` | Opaque, unguessable locator hash→candidate Organization shard (or platform) for enrollment routing only. Operator-readable; tenant sessions insert only their current-Org rows and operator sessions insert only null-Org platform rows under FORCE RLS. Contains no secret hash/result and is never admission/consumption authority. |
| JOB-002 | `packages/db/src/schema/worker_enrollment_codes.ts` | FORCE-RLS hashed single-use code authority: Organization/owner rows have non-null Organization and are consumed with worker profile+semantic replay result in one `runInTenant`; platform rows are null-Org and commit with the platform profile in one operator transaction. Same target/key/digest can replay after a lost response; changed digest conflicts. Raw code/session material is never stored. |
| JOB-002 | `packages/db/src/schema/worker_proof_replays.ts` | Operator metadata anti-replay register keyed by `(device_thumbprint, proof_id)` with issued/expiry timestamps and no request body/tenant payload. Fresh proof IDs are required even when the E1 semantic idempotency key is retried. |
| JOB-003 | `packages/db/src/schema/worker_operation_receipts.ts` | Tenant RLS receipts for E1 ACK/renew idempotent retry. Unique `(organization_id, company_id, worker_id, operation, idempotency_key)` plus composite lease/attempt FKs, semantic request digest, and bounded response fields; JOB-004 extends it for renew. |
| JOB-005 | `packages/db/src/schema/job_events.ts` | Immutable accepted event bytes/digest with unique `(organization_id, event_id)` and `(organization_id, attempt_id, sequence)`. |
| JOB-006 | `packages/db/src/schema/job_control_commands.ts` | Durable cancel/drain/graceful-stop command sequence and worker ACK, unique per lease/command id. |
| JOB-005 | `packages/db/src/schema/job_projection_receipts.ts` | Idempotency state machine for accepted state projection and later calls into existing approval/budget/audit/output engines. Unique `(organization_id, company_id, projection_kind, source_identity)` plus `source_digest`, `job_id`, `attempt_id`, `source_fence`, `status=pending|applied`, `target_aggregate_id`, `created_at`, `applied_at`. Same identity/different digest is a hard conflict; pending is crash-recoverable; applied replays. Prefer an existing legacy unique key when it proves the same authority. |
| JOB-007 | `packages/db/src/schema/execution_target_revocations.ts` | Operator-metadata-only durable fanout record for a committed target generation cutoff. Unique `(target_id, revoked_generation)` with bounded scan/retry/cursor state; contains no job/event/secret data and is not lease authority. |

Each new table has non-null Organization identity, Company identity where applicable,
composite tenant FKs, repository-only access, FORCE RLS, and grants to `aoa_app`. Normal
table/column/index/FK DDL comes only from Drizzle schema plus generated migrations. For
each new RLS table, generate a separate delta-free `--custom` RLS migration per E2-D01 /
Decision #122. Hand-added SQL is limited to C14 idempotency guards and #122 role/GRANT/
FORCE/POLICY DDL. Expected first migration is `0213`, but execution always uses the next
unused number produced by drizzle-kit.

The operator-readable enrollment route, platform enrollment rows, proof-replay, and revocation
metadata are exceptions to ordinary tenant visibility, not to least privilege. Organization/
owner code authority remains tenant RLS data; `aoa_operator` can read its opaque routing row
but cannot read/consume its code row. These paths use the E3-F001/E3-F002-approved non-owner
policies and expose no tenant job/event/secret payload. Proof IDs/operation receipts use
expiry indexes, bounded batch deletion, and a minimum retention of session expiry plus maximum
clock skew/retry window; cleanup never removes an unexpired replay defense or an operation
receipt still needed by a live lease/enrollment response. D1 query-plan and restart tests
cover replay lookup and cleanup. No in-memory replay cache is correctness authority.
The raw enrollment code has independent ≥128-bit locator and secret components. Only their
hashes persist. Issuance inserts route+code atomically in the owning tenant transaction (or
one platform operator transaction). Enrollment uses the locator row only to choose a candidate
shard, then `runInTenant` revalidates target/scope/code secret and atomically consumes the code,
creates/rotates the worker, and records the semantic result. Missing/stale/wrong-shard lookups
are indistinguishable from an invalid code. Route cleanup cannot precede its authoritative
code/receipt retention.

Parity bridges require one non-owner transaction to call existing legacy tables. E2's
current `0211` grants `aoa_app` only the eight new-path tables, despite the locked E2-D03
contract and handoff prose. E3 therefore never assumes legacy access exists and never falls
back to the owner pool. The exact serving role and grants below are **conditional on the
operator's E3-F001 choice**: option A grants the locked full legacy DML surface to `aoa_app`;
option B grants only the traced tables to `aoa_app`; option C grants those traced legacy
tables **and** the required new-path receipt/job operations to `aoa_bridge`, adds explicit
Decision #122 FORCE-RLS policies for that role, and passes that non-owner pool through the
existing mandatory `runInTenant` entry point with identical Organization-setting and
fail-closed semantics. JOB-001 needs read access to `organizations`,
`companies`, `organization_memberships`, and `company_memberships` for admission/
authorization edge checks; JOB-002/009 need the approved access to both `workers` and
`execution_targets` for registry/profile resolution and revocation recheck. The traced
parity surfaces are:
JOB-010 (`issues`, `heartbeat_runs`
and exact source-claim tables reached by the traced services); JOB-011 (`approvals`,
`agent_runtime_decisions`, `internal_agent_runtime_approvals`); JOB-012
(`budget_policies`, `budget_incidents`, `cost_events` plus the existing counter rows touched
by the budget service); JOB-013 (`activity_log`); JOB-014 (`task_outputs`,
`issue_comments` and the task terminal row). These legacy tables remain CAV-005 app-layer
isolated—no RLS retrofit. Every bridge validates the Organization→Company edge before the
legacy service call, passes the callback-local transaction to that service, and runs direct
cross-Company negative tests. A reviewer must verify the service query trace and narrow the
grant list before each migration is accepted; any unexpected table is a plan amendment, not
an owner-pool escape.

`server/src/db/job-control-legacy-grants.ts` is the reviewed trace/allowlist for options B/C
(and a regression inventory under option A), and
`server/src/__tests__/job-control-legacy-grants.contract.test.ts` compares it with every
custom GRANT migration. Under options B/C it rejects wildcard schema/table grants; under
option A it instead proves the locked full-DML surface and whole-app non-owner cutover.
Privilege tests connect as the operator-approved serving role: required operations succeed
only through the owning bridge, an unapproved legacy operation remains permission-denied
where the chosen contract promises that restriction, and cross-Company rows remain denied
by the bridge's application guard.

Granting a table is not enough to make a legacy helper safe in an outer transaction.
`runInTenant`'s additive callback-local control context registers durable/awaited mutation
work separately from after-commit effects. Ticket adapters must change existing helpers so:

- checkout, runtime-decision, budget hard-stop, cost/counter, activity insert, output, and
  summary mutations are awaited and throw on failure before a receipt becomes `applied`;
- `issueService`/budget/runtime-decision/activity live publications are returned or
  registered as after-commit effects rather than emitted inside the outer transaction;
- fire-and-forget budget evaluation is replaced by an awaited transaction-scoped policy
  evaluation for distributed mutations; and
- `run-summary-comment` cannot swallow an error that would otherwise leave an applied
  receipt without a summary.

The existing one-argument `fn(repos)` form stays source-compatible. The additive form is
conceptually `fn(repos, { tx, afterCommit(effect) })`; the transaction handle/context cannot
escape. `runInTenant` executes registered publication effects only after `withTenantTx`
returns successfully. The current live publications are best-effort cache/UI invalidations,
not a durable correctness channel: failure is logged and metered and clients recover by the
existing read/refresh path. A ticket that needs guaranteed delivery must name and test a
durable outbox before implementation; it may not pretend a projection receipt retries an
unrelated live publication. A receipt may be committed `pending` with its accepted source;
the later projection transaction locks it, invokes the required legacy mutation, and marks
it `applied` atomically, so a crash rolls both steps back to pending. If projection is
synchronous with the source mutation, receipt insert/lock, legacy mutation, and `applied`
all occur in that one transaction.

```powershell
function Invoke-NativeGate([string]$Label, [scriptblock]$Command) {
  $priorErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Stop'
  try {
    $global:LASTEXITCODE = 0
    & $Command
    $invocationSucceeded = $?
    $code = $global:LASTEXITCODE
  }
  catch { throw "$Label failed before a valid native exit: $($_.Exception.Message)" }
  finally { $ErrorActionPreference = $priorErrorAction }
  if (-not $invocationSucceeded -or $code -ne 0) {
    throw "$Label failed with native exit $code"
  }
}

$migrationSlug = 'job_control_submission' # JOB-001 exact example; use the owner map below.
Invoke-NativeGate 'db build before generation' { pnpm --filter @armyofagents/db build }
Push-Location packages/db
try {
  Invoke-NativeGate 'Drizzle generated migration' { pnpm exec drizzle-kit generate --name=$migrationSlug }
  # Add C14 IF NOT EXISTS guards to each generated CREATE TABLE/INDEX.
  Invoke-NativeGate 'Drizzle custom RLS migration' { pnpm exec drizzle-kit generate --custom --name="${migrationSlug}_rls" }
  # Add only idempotent #122 role/GRANT/ENABLE/FORCE/POLICY statements.
}
finally { Pop-Location }
```

Migration slugs are fixed per owner: JOB-001 `job_control_submission`, JOB-002
`worker_enrollment`, JOB-009 `job_placement`, JOB-003 `job_leasing`, JOB-005 `job_events`,
JOB-006 `job_controls`, and JOB-007 `job_quotas_revocation`. If drizzle-kit coalesces an
adjacent schema diff, the ticket ledger records the generated number/name and no later ticket
regenerates or hand-renumbers it.

JOB-001 adds the existing workspace package `@armyofagents/worker-protocol: workspace:*`
to `server/package.json`; `server` currently has no declared E1 dependency and must consume
the reviewed package root rather than copy its schemas. Commit `server/package.json` and the
regenerated `pnpm-lock.yaml` together after `pnpm install --no-frozen-lockfile`, then prove
`pnpm install --frozen-lockfile` is a no-op. No external dependency is expected. Any other
dependency is a STOP for controller approval. Schema-only changes commit schema, generated
migration, migration metadata, and tests; they do not fabricate a lockfile change.
This manifest change is blocked by E3-F004 until the Protocol/Schema Custodian corrects and
re-certifies `check:frozen-worker-protocol-v1`; JOB-001 then runs that check against E1's
recorded source SHA before and after its dependency commit.

```powershell
Invoke-NativeGate 'regenerate manifest lockfile' { pnpm install --no-frozen-lockfile }
Invoke-NativeGate 'verify frozen lockfile' { pnpm install --frozen-lockfile }
```

### Shared fence authorization

`packages/db/src/repositories/tenant/job-control.ts` owns one conditional predicate,
conceptually:

```ts
authorizeActiveFence({ organizationId, jobId, attemptId, leaseId, workerId,
  targetId, targetGeneration, fence })
```

Authorization succeeds only when the same tenant row is the current nonterminal attempt,
the lease is `active`, unexpired, unrevoked, matches worker/target/generation, carries the
exact opaque fence, and the current worker/target authority still has the same active
generation. Expiry compares `expires_at > clock_timestamp()` inside the conditional SQL
mutation; PostgreSQL `now()`/`transaction_timestamp()` and server/worker time are forbidden
because a transaction may cross the deadline. Worker `observedAt`, `ackedAt`, or event
timestamps are evidence only and never authorize time. The current-generation recheck locks
the exact `execution_targets` authority row `FOR SHARE`, and the governed
mutation executes in the same tenant transaction under the E3-F001/E3-F002-approved role
model; there is no check-then-write gap. Platform revocation cannot update every tenant RLS
shard in one transaction. Its operator transaction instead locks that authority row
`FOR UPDATE`, increments generation/disables the target, and inserts a durable revocation-
fanout record.
That commit is the linearization point: a guard that locked first may finish before cutoff;
one that starts or resumes after waits and fails the new generation/status check. An
idempotent reconciler then enumerates admitted Organizations and, separately inside each
`runInTenant`, marks old-generation leases revoked, requests attempt cancellation, and queues
termination controls. Crash between cutoff and fanout never restores write authority and the
durable scan resumes to convergence. Organization/owner targets may combine cutoff and their
single tenant's lease updates only when the approved role can do so in one `runInTenant`
transaction. Replacing or expiring a lease first makes the old predicate false; no cleanup
path revives it.

The governed repository surface is closed and enumerated: event acceptance; artifact
metadata/ordinary-commit authorization; secret-handle read; attempt/job terminal completion;
service-instance health; projection-receipt apply; and control-command ACK. A static contract
test imports every exported governed mutator from the tenant repository and fails if it does
not call the common active-fence predicate. The pre-JOB-005 surfaces may initially be test
stubs, but JOB-004 owns the guard contract before later tickets fill them in.

### API and flag surface

- Tenant/operator: `POST/GET /api/organizations/:organizationId/companies/:companyId/jobs`
  and `/job-control/*` status/control routes.
- Enrollment administration extends `/api/organizations/:organizationId/execution-targets/*`;
  platform profiles remain operator-only and never appear in tenant enumeration.
- Worker protocol: `/api/worker-control/enroll`, `/poll`, `/leases/:leaseId/ack`,
  `/renew`, `/events`, and `/control-acks`; every route validates the frozen v1 schema,
  auth audience, target, generation, and anti-replay identity.
- With the deployment flag off, worker/job-control route composition is absent and no
  outbox/sweeper starts. Enabling the deployment flag exposes dormant tested control-plane
  APIs but still cannot transfer an Organization/workload's execution authority.
- Worker errors use E1 `ProtocolErrorV1`; tenant/operator endpoints use existing
  `400/401/403/404/409/422/500` envelopes. Cross-tenant and absent identities have the same
  response status/body/timing class to the extent testable.

E1 operation idempotency is distinct from device-proof anti-replay. For `enrollment`,
`lease_ack`, and `lease_renew`, the authenticated scope plus E1 `idempotencyKey` indexes a
durable semantic receipt. Its request digest covers audience, authenticated worker/target/
generation, body, and enrollment public-key/binding facts, but excludes correlation ID,
fresh proof ID/signature, and transport timestamps. Same key+digest with a new valid device
proof replays the stored E1 outcome/authority without reapplying the effect; changed digest
returns the operation's allowed generic `malformed` error without an existence signal. A
retry always uses a fresh proof ID over the same E1 idempotency key. Enrollment stores its
receipt on the retained hashed-code row and may mint a new equivalent proof-bound session
header for the same enrolled identity; ACK/renew store bounded response fields in
`worker_operation_receipts`. Receipts are written atomically only for committed success or
deterministic rejection outcomes; pre-auth failures and `throttled`/`internal_unavailable`
leave no misleading receipt. No plaintext token or event/job payload is stored there.

Platform-worker polling never scans tenant job rows globally. Organization/dedicated/owner
sessions enter their bound Organization directly. For a platform session, an operator-owned
fair scheduler enumerates only admitted Organization IDs from the established Organization
registry, uses non-authoritative outbox readiness hints, and tries each shard through
`runInTenant`; the first tenant transaction that confirms placement/profile/capability and
atomically claims a row may release job details. The JOB-001 outbox drainer likewise obtains
candidate Organization IDs outside the new-path tables, then claims each Organization's
outbox only inside `runInTenant`. A missed/lost hint can delay a poll but can never grant
authority; bounded round-robin fallback and outbox replay recover after restart.

One platform poll inspects at most 32 admitted Organization shards and spends at most 750 ms
in database work; exhaustion returns bounded no-work/retry rather than continuing an
unbounded cross-tenant loop. A separate reconciliation sweep rebuilds readiness hints and
performs broader fair scanning. Operator job/event/worker endpoints use opaque `(createdAt,
id)` cursors with a default page of 50 and hard maximum 200.

Required query shapes/indexes are explicit: job claim
`(organization_id, status, available_at, priority, created_at, id)` with placed/queued
predicate; outbox claim `(organization_id, status, available_at, created_at, id)`; active
lease expiry `(organization_id, status, expires_at)`; pending control
`(organization_id, lease_id, status, sequence)`; event list
`(organization_id, attempt_id, sequence)`; and operator job list
`(organization_id, company_id, created_at, id)`. D1 records `EXPLAIN (ANALYZE, BUFFERS)` for
claim/sweep/list at gate volume and fails on sequential scans of the hot tables.

### Accepted-caveat / target-impact matrix

| Ticket(s) | Target / credential / locality / fallback and accepted-caveat impact |
|---|---|
| JOB-001 | Persists immutable requirements and credential handles only; no target contact. Admission denies sentinel/unmapped Org. |
| JOB-002 | Owns scope/owner/device/generation/session binding; raw credentials never persist. CAV-002: no Firecracker capability claim. |
| JOB-009 | Owns target class/scope/trust/provider/locality/credential/fallback decision. Unsupported provider/target features fail closed under CAV-002. |
| JOB-003 | Consumes the frozen placement; cannot widen target/fallback or reveal details to an incompatible worker. |
| JOB-004/005 | CAV-004: stale/offline workers cannot commit; event buffering does not preserve authority. |
| JOB-006 | CAV-003: every recovery/handoff is a new attempt/fence; CAV-004 late output is quarantine-only. |
| JOB-007 | Revocation and limits are server authority; immutable fallback alone may requeue to another target. |
| JOB-008 | Displays redacted target/reason metadata, never credentials or cross-tenant IDs; manual refresh until realtime gate. |
| JOB-010 | Source admission preserves current owner/assignment/claim; no target cutover. |
| JOB-011 | CAV-001: `park_run` releases managed compute and resumes under a new attempt/fence; no paused E2B VM. |
| JOB-012/013 | No new target/credential authority; accounting/audit use the placed job identity and existing engines. |
| JOB-014 | CAV-004: losing/offline artifacts remain quarantined and cannot become output; no automatic promotion. |

---

## 3. TDD, evidence, and commit protocol for every ticket

1. The controller creates `tickets/JOB-0XX-result.md` with the exact bare 40-hex Start
   SHA, `Status` and `Disposition` backtick-wrapped, named implementer/reviewer, acceptance
   checklist, and command ledger. JOB-001 uses the E3 Start SHA above; later tickets use
   their actual assignment SHA.
2. A fresh implementer writes focused tests first and commits/records a genuine RED on the
   unchanged behavior. The controller inspects the failure and rejects false REDs caused by
   imports, build order, or environment setup.
3. The implementer makes the smallest GREEN change, runs focused acceptance plus affected
   package typecheck/build, updates `findings.md` for non-obvious discoveries, and commits.
4. A DISTINCT reviewer checks the reviewed 40-hex revision (an ancestor of HEAD), reruns the
   focused command on that revision, appends review attempt 1, and uses plain `git commit`.
   Only the reviewer changes ticket `Status` to `complete`.
5. Any H-01/H-02/H-03 failure is a non-waivable `fail`; stop downstream assignment. A
   dependency, protocol, canonical-scope, or frozen-main contradiction is a STOP and plan
   amendment, never an improvised implementation.

Common affected-package commands:

```powershell
function Invoke-NativeGate([string]$Label, [scriptblock]$Command) {
  $priorErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Stop'
  try {
    $global:LASTEXITCODE = 0
    & $Command
    $invocationSucceeded = $?
    $code = $global:LASTEXITCODE
  }
  catch { throw "$Label failed before a valid native exit: $($_.Exception.Message)" }
  finally { $ErrorActionPreference = $priorErrorAction }
  if (-not $invocationSucceeded -or $code -ne 0) {
    throw "$Label failed with native exit $code"
  }
}

function Invoke-E3Integration([scriptblock]$Body) {
  $env:AOA_RUN_WIN_INTEGRATION = '1'
  try { & $Body }
  finally { Remove-Item Env:AOA_RUN_WIN_INTEGRATION -ErrorAction SilentlyContinue }
}

Invoke-NativeGate 'db typecheck' { pnpm --filter @armyofagents/db typecheck }
Invoke-NativeGate 'db build' { pnpm --filter @armyofagents/db build }
Invoke-NativeGate 'shared typecheck' { pnpm --filter @armyofagents/shared typecheck }
Invoke-NativeGate 'shared build' { pnpm --filter @armyofagents/shared build }
Invoke-NativeGate 'server typecheck' { pnpm --filter @armyofagents/server typecheck }
Invoke-NativeGate 'server build' { pnpm --filter @armyofagents/server build }
Invoke-NativeGate 'ui typecheck' { pnpm --filter @armyofagents/ui typecheck }
Invoke-NativeGate 'ui build' { pnpm --filter @armyofagents/ui build }

# Real PostgreSQL lane from short path C:\e3. Each integration file uses
# describe.skipIf(process.platform === "win32" && AOA_RUN_WIN_INTEGRATION !== "1")
# and embedded-postgres initdb flags --encoding=UTF8 --locale=C.
Invoke-E3Integration {
  Invoke-NativeGate '<suite>' {
    pnpm --filter @armyofagents/server exec vitest run src/__tests__/<suite>.integration.test.ts
  }
}
```

Every ledger runs each native process through `Invoke-NativeGate`; cleanup lives only in
`finally`. A later successful PowerShell cmdlet may never mask a failed test. RED and GREEN
use the identical helper invocation and record the failing/passing native exit code.

Tests are hermetic: fake clock, deterministic UUID/digest fixtures, embedded PostgreSQL,
no live provider/network/customer data/credential. Every focused result records command,
exit code, test count, duration, platform, and exact revision.

Focused commands (the implementer first records the expected assertion failure, then reruns
the identical command GREEN; append the affected package typecheck/build commands above):

| Ticket | Exact focused command from `C:\e3` |
|---|---|
| JOB-001 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-001 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/job-control-schema.integration.test.ts src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-001 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-submission.integration.test.ts src/__tests__/tenant-app-db-startup.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts src/__tests__/integration-test-hygiene.test.ts } }; Invoke-NativeGate 'JOB-001 frozen consumer' { pnpm check:frozen-worker-protocol-v1 -- --source-sha b7a842870ce7509d8baa75409e0ab19da375c88a }` |
| JOB-002 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-002 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/worker-enrollment-schema.integration.test.ts src/__tests__/worker-operator-policy.integration.test.ts src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-002 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/worker-enrollment.integration.test.ts src/__tests__/worker-session-auth.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts } }` |
| JOB-009 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-009 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-009 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-placement.property.test.ts src/__tests__/job-placement.integration.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts } }` |
| JOB-003 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-003 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/job-control-schema.integration.test.ts src/__tests__/worker-operation-receipts-schema.integration.test.ts src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-003 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-leasing.integration.test.ts src/__tests__/job-leasing-contract.test.ts } }` |
| JOB-010 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-010 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-admission-parity.integration.test.ts src/__tests__/job-source-admission-matrix.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts src/__tests__/job-legacy-after-commit.integration.test.ts } }` |
| JOB-004 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-004 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-fencing.integration.test.ts src/__tests__/job-fence-surface.contract.test.ts } }` |
| JOB-005 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-005 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/job-events-schema.integration.test.ts src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-005 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-events.integration.test.ts } }` |
| JOB-006 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-006 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/job-controls-schema.integration.test.ts src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-006 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-reconciliation.integration.test.ts src/__tests__/job-control-commands.integration.test.ts } }` |
| JOB-007 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-007 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/execution-target-revocations-schema.integration.test.ts src/__tests__/job-control-schema.integration.test.ts src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-007 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-quotas.integration.test.ts src/__tests__/worker-revocation.integration.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts } }` |
| JOB-008 | `Invoke-NativeGate 'JOB-008 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-operations-routes.test.ts }; Invoke-NativeGate 'JOB-008 ui' { pnpm --filter @armyofagents/ui exec vitest run src/__tests__/OperationsSection.test.tsx }` |
| JOB-011 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-011 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-011 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-approval-parity.integration.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts src/__tests__/job-legacy-after-commit.integration.test.ts } }` |
| JOB-012 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-012 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-012 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-budget-cost-parity.integration.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts src/__tests__/job-legacy-after-commit.integration.test.ts } }` |
| JOB-013 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-013 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-013 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-audit-parity.integration.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts src/__tests__/job-legacy-after-commit.integration.test.ts } }` |
| JOB-014 | `Invoke-E3Integration { Invoke-NativeGate 'JOB-014 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'JOB-014 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-output-parity.integration.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts src/__tests__/job-legacy-after-commit.integration.test.ts } }` |

---

## 4. Ticket implementation tasks

### JOB-001 — Submit immutable jobs transactionally (M, ≤3 agent-days, PRE-D1)

**Depends on:** PRT-003, TEN-003, TEN-006 — all passed.
**Outcome:** Authorized source submission commits one immutable job, initial attempt, and
one job-ready outbox row in a single tenant transaction.

**Ticket non-goals:** placement, leasing, worker dispatch/contact inside the transaction,
legacy cutover, and provider effects.

**Files:**
- Modify `packages/db/src/schema/jobs.ts`, `job_attempts.ts`, `schema/index.ts`.
- Create `packages/db/src/schema/job_outbox.ts`; extend
  `packages/db/src/repositories/tenant/index.ts`; create
  `packages/db/src/repositories/tenant/job-control.ts`.
- Modify `server/src/config.ts`, `server/src/index.ts`, `server/src/app.ts`,
  `server/src/db/tenant-context.ts`; create
  `server/src/db/job-control-legacy-grants.ts`; modify
  `server/src/services/tenant-admission.ts`.
- Modify `server/package.json` and regenerated `pnpm-lock.yaml` together to declare the
  frozen E1 package root.
- Create `packages/shared/src/validators/job-control.ts`,
  `packages/shared/src/types/job-control.ts`, `server/src/services/job-submission.ts`,
  `server/src/services/job-outbox.ts`,
  `server/src/routes/job-control.ts` and their barrel/API-path exports.
- Create `packages/db/src/__tests__/job-control-schema.integration.test.ts`,
  `server/src/__tests__/job-submission.integration.test.ts`, and
  `server/src/__tests__/tenant-app-db-startup.test.ts`; create shared
  `server/src/__tests__/job-control-legacy-grants.contract.test.ts`.

**Inputs/outputs:** External callers send a source-specific `SubmitJobCommand`, not an E1
`JobEnvelopeV1`. The command contains authenticated source intent and a bounded idempotency
key; it cannot choose job/attempt IDs, Organization/Company, requester authority, timestamps,
policy/input hashes, placement authority, or fence data. The server derives those fields
from the authenticated principal, admitted Organization→Company edge, current policy and
source engine, then persists the immutable facts. JOB-003 later constructs and validates the
E1 `JobEnvelopeV1` from those server-owned rows immediately before lease delivery. Output is
`{jobId, attemptId, status, replayed}` with no worker contact. Persist source kind/identity,
requester/executor, canonical input hash, policy snapshot/hash, requirements, immutable
placement request, priority/availability, and the first pending attempt plus attempt-ready
outbox row. A unique `(organization_id, company_id, authenticated_principal_kind,
authenticated_principal_id, authenticated_source_kind, authenticated_source_identity,
idempotency_key)` constraint returns the original identical submission; same scope/key with
a different canonical command digest is `409`. Two authorized principals using the same
client key cannot collide or observe one another's replay.
JOB-001 does not build the global drainer/fair scheduler; JOB-003 consumes the durable row.
This keeps submission within the ticket bound and ensures the notification's first consumer
is reviewed alongside atomic leasing.
`packages/shared` owns only board/operator/source submission DTOs; it does not duplicate E1
worker wire schemas. `server` imports validators/types from the built E1 package root only at
the worker-wire construction/validation boundary.

**Failure behavior:** malformed/protocol-invalid input is `400`; unauthorized requester,
wrong Company, forbidden sentinel, or unmapped Organization is a uniform denial before
persistence; owner-pool or missing non-owner URL fails flag-on boot; transaction/outbox
failure rolls back job and attempt; no post-commit notification is lost because the outbox
is authoritative. Logs/metrics contain IDs, source kind, replay flag, and reason code only.

**Compatibility / rollback:** additive columns/table/API. Generate normal + custom RLS
migrations. Flag-off omits routes and pool; rollback leaves inert outbox rows. Legacy
submission remains authoritative.

**RED → GREEN:**
- RED `job-submission.integration.test.ts`: duplicate-identical replay, changed-payload
  conflict, two principals using the same key, forced outbox insert failure rollback, 32 concurrent same-key submissions,
  all six source variants, requester/assignee mismatch, sentinel and nonexistent Org,
  foreign Company, and assertion that no worker adapter is called.
- RED startup test: flag on + blank/privileged app URL must fail; flag off must not open a
  serving pool.
- GREEN schema/repository/config/service/route; generate migrations; run:
  `Invoke-E3Integration { Invoke-NativeGate 'JOB-001 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-submission.integration.test.ts src/__tests__/tenant-app-db-startup.test.ts } }`.
- Run db/shared/server typecheck+build, protocol-boundary checks, and the corrected
  `check:frozen-worker-protocol-v1` against source SHA
  `b7a842870ce7509d8baa75409e0ab19da375c88a`. Expected E1 source/fixture diff: zero.

**Evidence / commit:** `tickets/JOB-001-result.md`; one schema/service commit
`feat(job-control): submit immutable tenant jobs`. Maps D0-T01/T03/T05, H-01, H-04.

**Internal TDD/commit slices (one ticket, one final reviewer):** A—declare E1 dependency,
non-owner startup/admission seam; B—schema/repository/migrations and attempt-ready outbox;
C—service/route/idempotency/concurrency. Each slice is independently green and ≤1 agent-day;
the reviewer reviews the combined revision and alone completes JOB-001.

### JOB-002 — Enroll workers with device-bound identity (M, ≤3 agent-days, PRE-D1)

**Depends on:** PRT-006, PRT-007, TEN-003 — passed.
**Outcome:** Extend the existing target registry with single-use enrollment and durable,
generation-bound logical worker profiles for platform, Organization, and owner scopes.

**Ticket non-goals:** scheduling, placement, execution, recovering a lost private device
key, or allowing worker-reported capability to change registered trust.

**Files:** modify `packages/db/src/schema/execution_targets.ts`, `workers.ts`,
`packages/db/src/client.ts`, repository modules; create
`packages/db/src/schema/worker_enrollment_code_routes.ts`,
`worker_enrollment_codes.ts`, and
`worker_proof_replays.ts` if E3-F005 selects application-layer proof; modify
`packages/shared/src/validators/execution-target.ts` and target constants; modify
`server/src/config.ts`, `server/src/index.ts`, `server/src/db/rls-tenant.ts`,
`server/src/services/execution-targets.ts`, `routes/execution-targets.ts`; create
`server/src/services/worker-enrollment.ts`, `routes/worker-control.ts`,
`middleware/worker-session-auth.ts`; tests
`packages/db/src/__tests__/worker-enrollment-schema.integration.test.ts`,
`server/src/__tests__/worker-enrollment.integration.test.ts` and
`worker-session-auth.test.ts`, plus a generated operator-role/policy custom migration and
its db/unit enforcement tests.

**Internal TDD/commit slices (one ticket, one final reviewer):** A—worker/target schema and
the operator-role correction chosen by the E3-F001 amendment; B—single-use enrollment and
device proof; C—session audience/generation/revocation. Each slice is ≤1 agent-day and no
slice is independently considered JOB-002 complete.

**Blocking contract decision (E3-F005):** E1's strict enrollment JSON has no device public
key/proof/session fields. A bearer token that merely contains a thumbprint is not device
bound. The recommended candidate preserves frozen E1 JSON and puts proof at the authenticated
HTTP transport boundary: a Node-native Ed25519 device key signs a canonical tuple of method,
normalized path, body SHA-256, E1 request/correlation identity, issued-at, and unique proof
ID. Enrollment supplies the public key and proof in versioned `AoA-Device-*` headers, consumes
the one-time code, and returns the short-lived session in an HTTP header whose claims include
the key thumbprint. Every poll/ACK/renew/event/control request must present a matching fresh
signature; the server enforces bounded clock skew and a database-unique proof ID until session
expiry. Rotation/reinstall increments generation and replaces the key. This candidate needs
an operator-approved threat model and exact header/canonicalization test vectors before
assignment. The alternative is an additive, versioned E1 body change, which triggers the
Protocol/Schema Custodian STOP and D0-T04 corpus. Pure bearer authentication is rejected.

**Interfaces:** Admin issues one hashed, expiring enrollment code for a registered target;
the raw locator+secret code is returned once and never logged. Organization/owner issuance
commits its route and authoritative code inside `runInTenant`; platform issuance commits both
with the platform target in one operator transaction. Enrollment uses the locator only to
discover a candidate shard. For Organization/owner it then consumes the unchanged E1 target-
enrollment request/response at the body boundary, verifies the approved device proof, and
atomically consumes code+creates/rotates profile+stores replay result in one `runInTenant`.
Platform enrollment performs the equivalent work in one operator transaction. It returns a
short-lived signed proof-bound session
with audience, worker, target, generation, scope, and device thumbprint. One physical device
key may back distinct Org-scoped logical profiles; it never confers cross-profile authority.
The existing `execution_targets.worker_token_hash` is bootstrap-only: successful enrollment
revokes/clears its worker-session authority, and no poll or governed operation accepts it.
Unenrolled legacy targets keep their current heartbeat credential; an enrolled target's
legacy heartbeat endpoint is upgraded to accept the proof-bound session so the authentication
upgrade does not itself transfer execution authority before E10.

The recommended registry binding is many logical `workers` profiles to one physical
`execution_targets` row, with database enforcement rather than a single target-ID FK.
JOB-002 adds explicit target scope plus a non-null, checked `target_authority_key` to the
registry (`platform`, `organization:<org-id>`, or `owner:<org-id>:<owner-id>`) and a unique
`(target_authority_key,id)` FK target. Each worker stores the selected authority key and
`execution_target_id`; a composite FK binds both to the same registry row. Worker CHECKs
permit only: platform profile→platform target; Organization profile→platform or the same
Organization target; owner profile→the same Organization+owner target. A foreign-Org target
therefore produces the same composite-FK failure as a nonexistent target and cannot become
an existence oracle. Platform targets may back multiple Organization-scoped profiles without
creating a second catalog. JOB-002 also migrates `workers.owner_user_id` from `uuid` to `text`
and adds the FK to `authUsers.id`, matching the existing target registry. Partial unique
constraints enforce one platform profile per target, one Organization profile per
`(organization,target)`, and one owner profile per `(organization,target,owner)`. This exact
binding, including safe migration/backfill of pre-E3 rows and database negative tests, must
be ratified with E3-F005 before assignment.

Organization/owner profiles and authoritative code/receipt rows are written through
`runInTenant`. **Conditional on the
E3-F001 operator choice**, the operator-metadata candidate writes/reads platform null-Org profiles
through a least-privilege `aoa_operator` role and JOB-002 Decision #122 custom policies on
both `workers` and the existing `execution_targets` registry. It can access only null-Org
registration/status/profile/enrollment/generation metadata, plus SELECT-only opaque locator→
candidate-shard rows in `worker_enrollment_code_routes`; it cannot read Organization/owner
code hashes/results, jobs, attempts,
leases, events, artifacts, or secret handles. `AOA_OPERATOR_DATABASE_URL` is explicit and
fail-closed. Tenant `aoa_app` sessions continue to see zero platform worker rows.

Platform authentication produces a bounded server-internal `VerifiedTargetPrincipal`
snapshot `{workerId,targetId,targetGeneration,deviceThumbprint,profileHash,expiresAt}` with
no tenant/job data. After selecting an admitted Org shard, `runInTenant` stores those values
on the lease and rechecks the authoritative `execution_targets.status/generation` through
the exact grant model approved for E3-F001; it does not join the invisible null-Org worker
row. A signed snapshot alone is never enough to override a later revocation. Tests race one
platform revocation against renew/event/completion in two Organizations and require both
tenant paths to deny the old generation.

**Failure behavior:** reused device proof ID/signature, expired code/session, key mismatch,
replaced generation, or revocation returns the closed unauthorized/target-revoked protocol
error before profile disclosure. In contrast, a lost-response retry with the same enrollment
code/authenticated scope/E1 idempotency key/semantic digest and a fresh valid proof replays the
stored `enrolled` identity without rotating or consuming twice; same key with a changed digest
is generic `malformed`. Forced worker/profile/receipt failure rolls back code consumption;
a stale or malicious route cannot select a different authoritative tenant. Tenant reads
never enumerate null-Org platform targets; owner removal or target transfer revokes refresh
and increments generation; deletion/reinstall creates new identity and cannot revive the
old session. Audit records issue/consume/rotate/revoke/transfer-denial without raw code/key.

**Compatibility / rollback:** extend the existing registry—no second catalog. Additive
Drizzle migration plus the operator-role/policy custom migration required above. Flag-off mounts no
enrollment route. Revocation remains safe during rollback; never re-enable a revoked
generation.

**RED → GREEN:** enrollment same-key/same-digest lost-response replay with fresh proof;
same-key/changed-digest conflict; consumed code with unrelated key; invalid/missing device
signature; proof-ID replay across replicas; replay-record expiry/cleanup and restart; clock
skew; body/path/method tamper; session copied without key; route-insert issuance rollback;
crash/failure after route lookup and at every code/profile/receipt statement; stale/wrong-shard
route with uniform denial;
platform operator auth; cross-tenant enumeration; wrong Org/owner; binding cardinality and
owner-ID migration; multi-Org profiles; owner membership removal; rotation, reinstall,
replacement, transfer denial, revocation, and wrong audience/target/generation. Run focused embedded-PG suite
and db/shared/server typecheck+build. Evidence `tickets/JOB-002-result.md`; commit
`feat(job-control): enroll device-bound workers`. Maps D0-T01/T03/T05, H-01/H-04.

### JOB-009 — Make hybrid target placement authoritative (M, ≤3 agent-days, PRE-D1)

**Depends on:** FND-002, PRT-006/007, TEN-003/004, JOB-001/002.
**Outcome:** Persist exactly one server-owned placement decision per attempt before lease.

**Ticket non-goals:** lease issuance, target cutover, provider execution, dynamic policy
rewrite, or implicit fallback.

**Files:** modify `jobs.ts`, `job_attempts.ts`, `execution_targets.ts`, tenant repositories,
shared job-control types; modify `server/src/services/execution-target-resolver.ts`; create
`server/src/services/job-placement.ts`; tests
`server/src/__tests__/job-placement.property.test.ts` and
`job-placement.integration.test.ts`.

**Interfaces:** Input combines immutable job requirements/fallback, deployment → Org →
workload rollout decision, credential binding, target scope/trust/locality/profile hash,
normalized provider constraints, registry health/capacity/generation, and E1 worker hello.
Output is an immutable placement decision `{owner, targetId, targetClass, targetScope,
targetGeneration, profileHash, providerConstraintHash, fallbackDisposition, reasonCode}` or
an attributable queued/failed reason. The worker never chooses or upgrades it.

**Failure behavior:** revoked/unmapped/offline/over-limit/hash-changed/owner-mismatched/
locality-incompatible targets queue or fail exactly per immutable fallback; forbidden
fallback never widens silently; shadow placement records a decision but is ineligible for
lease/effects. Platform targets are evaluated inside the job's tenant transaction and no
job details leave it until authorized.

**Compatibility / rollback:** additive decision columns/indexes. Legacy remains owner; flag
off performs no placement. A policy/profile mutation creates a new attempt/decision rather
than rewriting a prior decision.

**RED → GREEN:** deterministic property matrix across target scopes and all source kinds;
false privileged advertisement/provider ceiling; owner mismatch/removal; generation
replacement; concurrent capacity; drain/revoke; required offline; allowed/forbidden
fallback; personal credential vs shared target; local-only vs cloud; shadow no-effect;
deterministic replay. Run suite with 20 deterministic seeds locally (D1 later owns 20×10k),
then db/shared/server typecheck+build. Evidence `tickets/JOB-009-result.md`; commit
`feat(job-control): persist authoritative placement`. Maps D0-T01/T05, H-01/H-03/H-04.

**Internal TDD/commit slices (one canonical ticket, one final reviewer):** A—normalize the
target-authority schema/registry inputs and characterize the existing resolver, including
composite binding and cross-tenant denial; B—implement the pure deterministic placement
policy and seeded property matrix with no DB or lease side effects; C—persist the immutable
decision transactionally and prove concurrency, generation, capacity, shadow, and flag-off
behavior. Budget each slice at no more than one agent-day. Each slice records its own
RED/GREEN evidence, but JOB-009 remains `backlog` until one distinct reviewer reruns the
combined acceptance matrix on the reviewed revision and alone marks the ticket `complete`.

### JOB-003 — Lease and ACK compatible jobs atomically (M, ≤3 agent-days, PRE-D1)

**Depends on:** JOB-001, JOB-009, PRT-007.
**Outcome:** Eligible worker poll atomically returns at most one offer with a fresh fence;
ACK activates exactly that lease.

**Ticket non-goals:** renewal, event ingestion, retry/reaping, artifact bytes, or changing
the stored placement decision.

**Files:** modify `job_attempts.ts`, `leases.ts`, tenant job-control repository and worker
route; create `packages/db/src/schema/worker_operation_receipts.ts`, its generated/RLS
migrations, `server/src/services/job-leasing.ts`,
`server/src/services/job-outbox-worker.ts`, and
`server/src/services/job-ready-scheduler.ts`; tests
`packages/db/src/__tests__/worker-operation-receipts-schema.integration.test.ts`,
`server/src/__tests__/job-leasing.integration.test.ts` and
`job-leasing-contract.test.ts`.

**Interfaces:** Poll validates E1 worker session/hello/capacity, then in one tenant
transaction selects the oldest eligible placed attempt with Drizzle's PostgreSQL row-lock
API (`FOR UPDATE SKIP LOCKED`), rechecks target/profile/generation/capability/capacity, moves
attempt `pending→offered`, and inserts the `offered` lease with server ACK deadline, expiry,
and opaque fence. One conditional ACK transaction locks the same identities and moves lease
`offered→active` plus attempt `offered→leased`; a late/wrong/replayed loser changes neither.
The transaction also stores the ACK operation receipt. A lost-response retry with the same
authenticated scope/idempotency key/semantic digest and a fresh device proof returns the
original `acknowledged` outcome even though the lease is already active; it never reapplies
the transition. Same key with a changed digest is generic `malformed`.
The job remains `queued` until JOB-005 accepts the first fence-authorized
`attempt_started` event, which moves attempt `leased→running` and job `queued→running` in the
event transaction. Incompatible/no-work responses reveal no job IDs/details.
The outbox worker enumerates admitted Organization shards, claims rows only inside
`runInTenant`, and feeds non-authoritative fair-ready hints to the bounded scheduler. Pull
polling and outbox replay recover hints after restart; hints never bypass the placement/lock
transaction.

**Failure behavior:** partial unique `leases_active_per_attempt_idx` plus the locked
transition makes concurrent claim losers return no-work; late/wrong ACK is stale-fence or
attempt-terminal; disconnected pre-ACK offers remain for JOB-006 reaping; target revocation
or generation change invalidates ACK. Database serialization/internal errors return bounded
`internal_unavailable`, never a second lease.

**Compatibility / rollback:** additive lease/attempt columns. Flag-off has no poll/ACK
route. Rollback stops offers and lets already offered leases expire; never transfers their
fence.

**RED → GREEN:** real embedded PostgreSQL barrier tests with ≥100 concurrent claim/ACK races,
two compatible plus one incompatible worker, oldest-eligible ordering, target/generation
change, ACK same-key/same-digest response loss, same-key/changed-digest conflict, fresh proof
ID on semantic replay, late/wrong ACK, rollback between each lease/attempt update (proving the whole ACK
transaction rolls back), restart consistency, and no-detail response. JOB-005 later adds the
started-event job/attempt transition test. Run focused suite three
times because it is H-03 critical, plus db/server build. Evidence
`tickets/JOB-003-result.md`; commit `feat(job-control): lease placed jobs atomically`.
Maps D0-T01/T02/T05, H-01/H-02/H-03, E6F-01/E6F-04 inputs.

### JOB-010 — Preserve admission and assignment invariants (parity-exempt, PRE-D1)

**Depends on:** TEN-006, JOB-001.
**Outcome:** Bridge every execution source to its existing admission/assignment authority;
task runs reuse current checkout with one legacy/distributed winner.

**Ticket non-goals:** execution cutover, mixed legacy/distributed quota enforcement (owned
only by JOB-007), a new assignment/capacity store, fabricated task identity for non-task
sources, or model/provider effects in shadow mode.

**Files:** modify `server/src/db/tenant-context.ts` (overload-compatible callback-local tx),
`services/tenant-admission.ts`, `services/issues.ts` only for a reusable transaction seam if
needed, plus exact current source seams `services/heartbeat.ts`,
`services/internal-agent/cli-mode.ts`, `services/internal-agent/commander-sandbox.ts`,
`services/internal-agent/aoa-agents/runner.ts`, `services/crew-task-service.ts`,
`services/extraction-engine.ts`, `services/extraction-cli.ts`,
`services/internal-agent/cli-summarizer.ts`, and
`services/sandbox-readiness-probe.ts`; create
`server/src/services/job-admission-bridge.ts`; tests
`server/src/__tests__/job-admission-parity.integration.test.ts` and
`job-source-admission-matrix.test.ts`.

**Interfaces:** `admitAndSubmit(source, actor, idempotencyKey)` resolves Org/Company,
validates E2 sentinel/unmapped admission, and within one authoritative transaction invokes:
task `issueService.checkout`/ownership; Commander conversation authority; crew dispatch
claim/preflight; extraction claim, compaction hash, or readiness probe identity; browser
request and service reconcile source-specific idempotency (net-new, no fabricated issue).
Only task_run carries issue/run identity. A stable bridge claim identity links legacy and
distributed submissions while the legacy path is owner.

**Failure behavior:** dependency/assignee/status/membership mismatch rejects before job;
same source replays; concurrent legacy/distributed attempts have one winner; submit failure
or pre-lease rollback releases the existing claim exactly once; reassignment/status change
requests cancel and permanently fences the losing distributed attempt. No new assignment
column is authoritative.

**Compatibility / rollback:** no cutover. The bridge may be invoked in parity/shadow mode
only when it performs no model/provider effect. Flag-off keeps all current paths unchanged.
Rollback disables bridge invocation and releases unleased claims through the same engine.

**RED → GREEN:** full FND-007 source admission/assignment matrix. Capacity is
characterization-only here: record each source's current claim/release/wakeup behavior and
prove failed submit releases the existing authoritative claim, but do not add distributed
capacity authority before JOB-007. Test task
dependency, replay, bounded stale adoption, assignee removal/reassignment, status change,
legacy/distributed race; six source variants; duplicate key; failed submission/release.
Focused suite runs against embedded PG and existing heartbeat/crew/one-shot characterization
tests. Evidence `tickets/JOB-010-result.md`; commit
`feat(job-control): bridge legacy admission authority`. Maps D0-T01/T05, H-01/H-02/H-03.

> **STOP AFTER PRE-D1:** No following ticket may be assigned until the controller verifies
> a committed passing `E6-D1-FOUNDATION` QA record and handoff on the current ancestry.

### JOB-004 — Renew leases and enforce fencing (M, ≤3 agent-days, POST-D1)

**Depends on:** JOB-003 + passing `E6-D1-FOUNDATION`.
**Outcome:** Only the active lease renews, and the shared fence guard protects every
governed surface.

**Ticket non-goals:** event storage/projection, artifact-byte storage, secret
materialization, retry policy, or service reconciliation.

**Files:** modify lease repository/schema if timestamps are missing and worker routes;
create `server/src/services/job-fencing.ts`; in
`packages/db/src/repositories/tenant/job-control.ts` define guarded methods
`acceptEvent`, `authorizeArtifactCommit`, `readSecretHandle`, `completeAttempt`,
`recordServiceHealth`, `applyProjectionReceipt`, and `ackControlCommand`. JOB-004 lands the
shared predicate/closed interface and negative contract; JOB-005/006/011 fill the event,
control, and projection storage behind that already-guarded interface. Wire existing
`job_artifacts`, `job_secret_handles`, `job_attempts`, and `service_instances` methods; tests
`server/src/__tests__/job-fencing.integration.test.ts` and
`job-fence-surface.contract.test.ts`.

**Interfaces/failure:** server policy supplies lease duration/renew interval; worker cannot
extend it arbitrarily, and E1 `observedAt` never authorizes expiry. Conditional renew uses a
fresh SQL `clock_timestamp()` in the mutation (not transaction-start time), matches all lease
identity plus the current worker/target status and generation, and increments no authority. It stores the renewed
`expiresAt`/cancel response in the operation receipt atomically. Same scope/idempotency key/
digest with a fresh proof replays that exact renewal result and cannot extend twice; changed
digest is generic `malformed`. A new idempotency key is required for a later renewal effect.
Expired/replaced/revoked/terminal returns stale_fence/target_revoked/
attempt_terminal. One matrix proves stale fences cannot mutate events, ordinary artifact
metadata/commit authorization, secret handles, completion, or service health.

**Observability/rollback:** metric by renewal disposition and guard surface, redacted audit
for rejected stale authority. Flag-off no renew endpoint; rollback stops renewal and fences
leases by expiry, never extends them. RED transaction begins before expiry but conditional
mutation runs after expiry; same-key/same-digest lost-response replay returns the original
expiry without extending; changed digest conflicts; plus boundary/clock/revoked/replacement
races;
GREEN common guard; run critical suite 3×. Evidence `tickets/JOB-004-result.md`; commit
`feat(job-control): enforce active lease fences`. Maps D0-T01/T02/T05, H-01/H-02/H-03/H-04.

### JOB-005 — Ingest events and terminal results idempotently (M, ≤3 agent-days, POST-D1)

**Depends on:** JOB-004, PRT-004.
**Outcome:** Commit valid ordered events once and return a stable cumulative ACK while
transactionally applying legal job/attempt transitions.

**Ticket non-goals:** realtime fan-out/catch-up claims, artifact bytes, worker pricing,
cancellation policy, or legacy product projection.

**Files:** create `schema/job_events.ts`, extend tenant repositories, create
`schema/job_projection_receipts.ts`, `server/src/services/job-events.ts`, extend worker
routes/shared response types and tenant repositories; tests
`packages/db/src/__tests__/job-events-schema.integration.test.ts`,
`server/src/__tests__/job-events.integration.test.ts`; generated normal + custom RLS
migrations.

**Interfaces:** Import E1 `canonicalEventDigestInputV1` and
`verifyWorkerEventDigestV1`—do not reimplement RFC8785—then validate authenticated delivery
identity/current fence, then batch duplicates/gap, then persist events and state projection,
then cumulative ACK—all inside one tenant transaction. The first valid `attempt_started`
event owns attempt `leased→running` and job `queued→running`. Same event ID+digest/sequence replays
the prior ACK; changed digest, in-batch duplicate, gap, or illegal transition is rejected.
Terminal result wins once.

**Failure behavior:** crash before commit yields no ACK and safe replay; crash after commit
before response replays same ACK; partial invalid batch commits none; concurrent terminal
loser sees terminal and cannot overwrite. Payload bounds and secret canaries fail before
persistence. Metrics track accepted/replayed/gap/hash/stale/terminal without event content.

**Compatibility/rollback:** new RLS event table only; events are durable source for later
realtime but no live catch-up claim. Flag-off no ingest. RED duplicate/out-of-order/partial
retry/concurrent terminal/restart/hashes; GREEN and 3× critical suite. Evidence
`tickets/JOB-005-result.md`; commit `feat(job-control): ingest fenced job events`.
Maps D0-T01/T02/T03/T05, H-01/H-02/H-03/H-04, D1-03 input.

### JOB-006 — Cancellation, expiry, retry, and reconciliation (M, ≤3 agent-days, POST-D1)

**Depends on:** JOB-004, JOB-005.
**Outcome:** Durable controls and reconciliation converge abandoned or canceled work to one
winner/new attempt/terminal result.

**Ticket non-goals:** provider adapter/resource implementation, checkpoint byte handling,
mobility, or reviving an expired fence.

**Files:** modify `jobs.ts`, `job_attempts.ts` (including unique
`(organization_id, job_id, attempt_number)`); create
`schema/job_control_commands.ts`, repository methods,
`server/src/services/job-reconciliation.ts`, `job-control-sweeper.ts`; extend worker and
operator routes; tests `server/src/__tests__/job-reconciliation.integration.test.ts` and
`job-control-commands.integration.test.ts`; normal + custom RLS migrations.

**Interfaces:** cancellation transaction marks requested state and queues a monotonically
sequenced E1 cancel command; worker poll/renew returns pending controls until ACK. Reaper
locks the authoritative job/current-attempt row plus expired offer/lease, permanently revokes
the fence, applies server retry policy, allocates `max(attempt_number)+1` under that lock, and
either creates the uniquely constrained attempt N+1 plus its attempt-ready outbox row in the same transaction
with immutable backoff or terminates/dead-letters with explicit reason. Reconciliation finds
leaked attempts/commands and repeats idempotently.

**Failure behavior:** two concurrent retry/reconciliation creators produce one N+1 attempt
and one ready row; the loser idempotently observes it. Disconnect before/after ACK, during execution/upload, and after
terminal commit converges; late result never overwrites winner; retry exhaustion alone can
dead-letter; CAV-003 restart always creates a new attempt/fence; CAV-004 offline output is
quarantine-only. Reaper has bounded batches/backoff and one in-flight tick per process.

**Compatibility/rollback:** new RLS control table/additive columns. Flag-off stops sweeper
and routes. Rollback cancels/drains or lets leases expire; never deletes evidence or revives
fences. RED five disconnect phases + restart/retry/dead-letter/duplicate sweeper; GREEN and
3× critical suite. Evidence `tickets/JOB-006-result.md`; commit
`feat(job-control): reconcile cancellation and retries`. Maps D0-T01/T02/T05,
H-01/H-02/H-03/H-10, D1-04/D1-05/D1-07 inputs.

### JOB-007 — Organization quotas and worker revocation (M, ≤3 agent-days, POST-D1)

**Depends on:** JOB-003, JOB-006.
**Outcome:** One shared concurrency/capacity authority enforces Org/workload limits and
immediate target revocation without double release.

**Ticket non-goals:** a parallel quota counter, commercial billing, worker-owned limits,
or fallback beyond the immutable placement policy.

**Files:** modify `server/src/services/org-concurrency.ts`, `execution-targets.ts`,
`job-leasing.ts`, `job-reconciliation.ts`, budget bridge seam, attempt capacity columns and
tenant repository; create `packages/db/src/schema/execution_target_revocations.ts` plus its
approved operator-policy migration/repository; tests
`packages/db/src/__tests__/execution-target-revocations-schema.integration.test.ts`,
`server/src/__tests__/job-quotas.integration.test.ts` and
`worker-revocation.integration.test.ts`.

**Interfaces:** Refactor the current advisory-lock capacity transaction to count/claim both
legacy runs and distributed attempts, keyed by Organization plus workload; claim is stored
on the attempt and released by one conditional transition. Admission/effect checks call
existing budget policy. Revocation's operator transaction locks the target, increments its
generation/disables it, and writes the durable fanout record; it never attempts a cross-Org
lease transaction. The committed cutoff immediately blocks refresh/new leases and every
governed guard through the locked current-generation recheck. The fanout worker scans admitted
Organizations and separately uses `runInTenant` to mark matching old-generation leases
`revoked`, request attempt cancellation, enqueue termination, and wake queued work only when
immutable fallback permits.

**Failure behavior:** crash after global cutoff but before/during any Organization fanout
still denies all old-generation effects; restart resumes the durable idempotent scan until
every matching tenant lease converges. Concurrent claims never exceed cap; retry/reaper/
revocation/cost exhaustion can race but release once; unavailable shared admission storage fails closed;
revoked worker cannot renew/emit events/read secrets/upload/apply projections/report health/
ACK control/complete from the instant that transaction commits. Metrics: queued/running/reserved,
claim/release/reconcile/revocation dispositions, and queue-reason cardinality bounded by code.

**Compatibility/rollback:** extends the existing capacity service, not a new counter. Flag
off excludes distributed attempts. Revocation is irreversible for old generation. RED
concurrent quota, mixed legacy/distributed clamp (CM-014), authority-row lock ordering,
crash after cutoff/before fanout, multi-Org platform revoke at every lease phase,
budget exhaustion, double-release and reconciliation; GREEN 3×. Evidence
`tickets/JOB-007-result.md`; commit `feat(job-control): enforce shared organization quotas`.
Maps D0-T01/T05, H-01/H-02/H-03, D1-01/D1-02/D1-07 inputs.

### JOB-008 — Operator job and worker controls (M, ≤3 agent-days, POST-D1)

**Depends on:** JOB-005/006/007/009.
**Outcome:** Tenant-authorized operators can inspect redacted durable status and invoke
cancel/drain/revoke with explicit refresh.

**Ticket non-goals:** durable realtime, live log streaming, displaying secret/event
payloads, cross-tenant platform inventory, or execution cutover.

**Files:** extend `server/src/routes/job-control.ts`; create
`server/src/services/job-operations.ts`; create `ui/src/api/job-control.ts`,
`ui/src/components/settings/sections/OperationsSection.tsx`; modify
`ui/src/components/settings/SettingsLayout.tsx`, `ui/src/pages/SettingsPage.tsx`,
`ui/src/lib/queryKeys.ts`; tests `server/src/__tests__/job-operations-routes.test.ts` and
`ui/src/__tests__/OperationsSection.test.tsx`.

**Interfaces:** tenant-scoped list/detail for job/attempt/event/worker/placement; response
contains redacted envelopes, reason codes, target class/scope (not cross-tenant target IDs),
event metadata/digests (not payload secrets), and control status. Mutations call JOB-006/007
services. UI supports manual Refresh and states queued/leased/canceling/failed/revoked/stale.
It explicitly says realtime catch-up is unavailable until `E10-REALTIME-FOUNDATION`.

**Failure behavior:** board actor without Company/Org authority gets uniform 404/403; null-
Org platform rows are summarized only after job-scoped placement authorization; errors are
visible, no silent toast-only failure; repeat cancel/drain/revoke is idempotent. Audit every
mutation; read metrics avoid user/secret labels.

**Compatibility/rollback:** additive APIs/settings tab, route absent when flag off; legacy
settings untouched. RED API auth/cross-tenant/redaction and UI state/action/error/refresh
tests; GREEN server+UI typecheck/build. Evidence `tickets/JOB-008-result.md`; commit
`feat(job-control): add operator controls`. Maps D0-T01/T05, H-01/H-02/H-04/H-10.

### JOB-011 — Preserve approvals and completion policy (parity-exempt, POST-D1)

**Depends on:** PRT-007, JOB-006, JOB-010, passing foundation.
**Outcome:** Distributed attempts call existing product approval/runtime-decision/completion
authorities exactly once.

**Ticket non-goals:** a new approval/policy engine, worker-created policy, approval UI
redesign, or holding managed compute while parked.

**Files:** use the JOB-005 projection-receipt repository; create
`server/src/services/job-approval-bridge.ts`; minimally adapt `approvals.ts`,
`agent-runtime-decisions.ts`, crew dispatch/completion policy seams for callback-local tx;
tests `server/src/__tests__/job-approval-parity.integration.test.ts`; normal + custom RLS
migrations.

**Interfaces/failure:** server creates product approval or runtime decision with source
revision, nonce/digest/version/TTL/default, writes a projection receipt linking the existing
aggregate, and sends only the E1 control. Worker cannot create/approve/override it. Denial,
timeout, invalid/missing/multiple default, and forbidden persistent timeout grant fail before
effect. `park_run` ends attempt/releases compute and resumes through a new fence.

**Compatibility/rollback:** existing aggregates remain authoritative. Flag/cutover rollback
continues resolving their current rows and never duplicates them. Matrix covers task,
Commander, crew, one-shot, browser, service, allow/deny/timeout/default/retry/stale event and
active rollback. Evidence `tickets/JOB-011-result.md`; commit
`feat(job-control): bridge approval and completion policy`. Maps D0-T01/T02/T05,
H-01/H-02/H-03/H-10.

### JOB-012 — Preserve budget and authoritative cost policy (parity-exempt, POST-D1)

**Depends on:** JOB-005, JOB-007, JOB-010, passing foundation.
**Outcome:** Existing budget/cost authority prices accepted usage once and stops governed
effects at every applicable scope.

**Ticket non-goals:** commercial billing/payment, worker-supplied pricing, a parallel cost
ledger, or relaxing current hard stops.

**Files:** create `server/src/services/job-budget-cost-bridge.ts`; modify existing
`budgets.ts`, `costs.ts`, `one-shot-cli-budget.ts`, `org-concurrency.ts`; extend existing
budget/cost schemas only for department scope, server rate/version/rounding, and a stable
source idempotency key; use projection receipts; test
`server/src/__tests__/job-budget-cost-parity.integration.test.ts`.

**Interfaces:** worker event supplies bounded usage units only. Server resolves provider,
model, biller, billing type, rate/version, currency/rounding and calls `costService` once per
accepted event/attempt identity. Existing agent/Company policies plus the existing
project/department surface are extended inside the same budget engine. Checks occur at
admission, before next governed effect, and after authoritative cost.

**Failure behavior:** worker price/rate rejected; unknown rate fails closed before effect;
replay uses receipt and does not charge; exhaustion creates warning/incident/pause/cancel and
releases reservation/capacity exactly once even under race. Rollback preserves current
hard-stop and cannot erase charged events.

**Compatibility/rollback:** additive fields/scopes in existing engines, no parallel ledger.
Legacy callers retain defaults. Flag-off blocks new distributed admission/leasing, but an
accepted usage event must reach a terminal projection receipt before its bridge may disable;
the rollback gate fails closed while a cost receipt is pending, so disabling cannot erase or
skip an authoritative charge. RED server pricing fixtures, duplicate usage, all scopes,
warning/incident, concurrent exhaustion, retry attribution, pending-receipt flag-off, release
race, active rollback; GREEN existing cost/budget regression suites + focused embedded PG. Evidence
`tickets/JOB-012-result.md`; commit `feat(job-control): bridge budget and cost authority`.
Maps D0-T01/T05, H-01/H-02/H-03/H-10, D1-01/D1-07 inputs.

### JOB-013 — Preserve transactional activity audit (parity-exempt, POST-D1)

**Depends on:** JOB-005, JOB-010/011/012, passing foundation.
**Outcome:** Accepted state/control/accounting mutations write existing activity/hub audit
in the same transaction; publication occurs after commit.

**Ticket non-goals:** a new audit store, treating worker observations as product actions,
or publishing before commit.

**Files:** create `server/src/services/job-audit-bridge.ts`; modify
`server/src/services/activity-log.ts` only for callback-local transaction and post-commit
publication seam; use projection receipts; tests
`server/src/__tests__/job-audit-parity.integration.test.ts`.

**Interfaces/failure:** accepted mutation supplies typed actor/source/job/attempt/domain
resource and existing activity action. Receipt + mutation + activity insert commit together;
an after-commit callback publishes. Worker observation alone never becomes accepted product
action. Replay/stale/rejected events produce no duplicate/accepted activity; rollback
publishes nothing.

**Compatibility/rollback:** existing activity contract remains source of truth; self-hosted
callers unchanged. Flag-off blocks new distributed admission/leasing, while already accepted
mutations finish their same-transaction activity insert and terminal receipt; the rollback
gate refuses bridge disablement while a receipt is pending. RED per-source accepted/rejected/
stale, approval/budget, duplicate, pending-receipt flag-off, rollback,
publication-before-commit denial, tenant and actor attribution; GREEN. Evidence
`tickets/JOB-013-result.md`; commit `feat(job-control): project transactional activity audit`.
Maps D0-T01/T05, H-01/H-02/H-04/H-10.

### JOB-014 — Preserve task outputs and run summaries (parity-exempt, POST-D1)

**Depends on:** JOB-005/006/010/011/012/013, passing foundation.
**Outcome:** Accepted artifact/result and terminal winner project into existing output,
review, primary-selection, summary, and task terminal contracts exactly once.

**Ticket non-goals:** artifact-byte storage, automatic quarantine promotion, fabricating
task outputs for inapplicable sources, or changing the current review/primary contract.

**Files:** create `server/src/services/job-output-bridge.ts`; minimally adapt
`task-outputs.ts`, `run-summary-comment.ts`, and task terminal update seam for
transaction/idempotency; use projection receipts; tests
`server/src/__tests__/job-output-parity.integration.test.ts`.

**Interfaces/failure:** ordinary fenced artifact commit remains distinct from explicit
output projection. Existing provider/external identity and review/primary rules apply;
creator/source is typed. The terminal winner creates success/failure/cancel/dead-letter
summary once. Stale/losing output is only quarantine metadata and cannot become primary or
change terminal state. Commander/crew/one-shot use their applicable output/summary mapping
without fabricated task IDs.

**Compatibility/rollback:** existing task outputs/comments/status remain authoritative;
receipt makes fallback safe. Flag-off blocks new distributed admission/leasing, while an
accepted terminal/artifact event must finish or resume its idempotent projection before its
bridge disables; the rollback gate fails closed on pending receipts. RED duplicate provider
identity, review/primary, retry/stale winner/quarantine, six-source projections, every
terminal, pending-receipt flag-off, and rollback before/after accepted artifact; GREEN
existing output/comment regressions + focused lane. Evidence
`tickets/JOB-014-result.md`; commit `feat(job-control): project outputs and run summaries`.
Maps D0-T01/T02/T05, H-01/H-02/H-03/H-10, D1-06/D1-07 inputs.

---

## 5. Legacy parity mapping (FND-007 / frozen-main crosswalk)

`JOB-010`–`JOB-014` are exempt from the three-agent-day limit. Their scope is bounded by
this matrix, not by permission to build new engines.

| Ticket | FND-007 parity dimensions | Current-main crosswalk rows bridged | Required disposition |
|---|---|---|---|
| JOB-010 | `checkout_assignment`; characterize `capacity_claim_release_wakeup` and release the existing claim on failed submission | CM-002 heartbeat/agent-run; CM-003 crew; CM-004 Commander; CM-005 extraction; CM-006 compaction; CM-007 readiness; CM-014 current behavior | Reuse checkout/assignment and record current capacity semantics. JOB-007 alone implements mixed legacy/distributed claim/release/wakeup authority and full CM-014 proof; browser/service are net-new with explicit source idempotency, not task identity. |
| JOB-011 | `product_runtime_approval`, completion-policy portion of `completion_cancel_retry` | CM-002/003/004/005/006/007 plus source-specific `not_applicable` rows | Reuse product approvals, crew preflight, runtime decisions, timeout/default, completion policy. |
| JOB-012 | `budget`, `cost`, capacity release on hard stop | CM-002/003/004/005/006/007 and CM-014 | Reuse/extend budget and cost services; preserve source-specific N/A rationale; no worker pricing. |
| JOB-013 | `audit` | CM-002/003/004/005/006/007; CM-008 artifact/output attribution | Existing activity/hub audit only; accepted product mutations, not observations. |
| JOB-014 | `output_run_summary`, remaining `completion_cancel_retry` | CM-002/003/004/005/006/007 and CM-008 | Existing task-output/run-summary/status contracts; browser/service N/A until their owning epics define projections. |

Each parity test iterates all six frozen execution-source variants and every applicable
dimension. A `not_applicable` result must match the FND-007 rationale; absence of a current
crosswalk row for `browser_request` or `service_reconcile` is recorded as net-new, not silently
treated as parity passed.

---

## 6. Failure-mode coverage and observability

| Code path | Realistic production failure | Test | Handling / user signal |
|---|---|---|---|
| Flag-on tenant pool boot | Owner URL, missing app URL, role revoked | JOB-001 startup | Boot fails loudly; never falls back. |
| Submit/outbox | DB fails after job insert | JOB-001 rollback | Whole tx rolls back; retry by idempotency key. |
| Enrollment/session | Code replay or stolen old generation | JOB-002 | Uniform unauthorized/revoked; audited, no profile disclosure. |
| Placement | Worker self-advertises privileged capability | JOB-009 property | Server profile intersection rejects/queues with reason. |
| Lease claim | Two workers race | JOB-003 barrier | Row lock + partial unique yields one offer; loser gets no-work. |
| Renew/governed write | Lease expires between check and write | JOB-004 | Conditional in-tx guard rejects stale fence. |
| Event upload | Commit succeeds but ACK response is lost | JOB-005 restart/replay | Same digest replays cumulative ACK. |
| Cancel/reaper | Worker disconnects during artifact upload | JOB-006 | Fence first; late ordinary commit denied/quarantined downstream. |
| Capacity/revoke | Reaper and budget exhaustion both release | JOB-007 | Conditional release receipt makes second release no-op. |
| Operator UI | Poll fails or data is stale | JOB-008 UI | Visible error + last refresh time; no realtime claim. |
| Assignment bridge | Legacy and distributed submit concurrently | JOB-010 | Existing checkout has one winner; loser releases/no job. |
| Approval bridge | Worker forges an approval result | JOB-011 | No matching server aggregate/version/digest → deny before effect. |
| Cost bridge | Usage event replayed after restart | JOB-012 | Projection receipt/idempotency key prevents double charge. |
| Audit projection | Publish called before transaction commit | JOB-013 | After-commit callback only; rollback test proves no publication. |
| Output projection | Losing attempt completes late | JOB-014 | Active-fence/terminal-winner check blocks output/status/summary. |

No listed path is silent without both a test and handling. Stable metrics use bounded labels:
operation, source kind, target class, result/reason code, and workload—not Organization,
Company, actor, job, event content, or secret. Structured logs may include opaque IDs under
existing redaction policy. Activity/audit covers mutations; rejected security events are
attributable without becoming accepted product actions.

---

## 7. Gate traceability

### D0 REQUIRED / HARD / INITIAL map

| Requirement | Owning evidence |
|---|---|
| D0-T01 focused acceptance | Every ticket's result ledger and reviewer rerun. |
| D0-T02 lifecycle ownership | JOB-003/004/005/006/011/014 legal+illegal transition matrices against E1 state functions. |
| D0-T03 validators | JOB-001/002/003/004/005 run 10,000 deterministic vectors for any new auth/idempotency/secret-bearing validator; E1 validators remain unchanged. |
| D0-T04 protocol ownership | Expected N/A (zero E1 diff). Any additive protocol field triggers custodian review and full affected cross-version corpus. |
| D0-T05 hermetic inputs | All focused suites use embedded PG/fake clock/fixtures; no provider, customer, network, or live credential. |
| D0-R01 | Exact gate revision: through `Invoke-NativeGate`, build workspace packages, then run `pnpm -r typecheck`, `pnpm test:run`, `pnpm -r build`; classify only committed DEC-03 baseline failures as pre-existing/not-E3-touched. |
| D0-R02 | Root `pnpm build` through `Invoke-NativeGate`, with no tracked-byte mutation. |
| D0-R03 | JOB-003/004/005/006/007 and the final H-01/H-02/H-03 integration suite pass 3 consecutive times. |
| D0-R04 / EVID-01–03 | Byte-clean worktree and immutable QA/handoff with exact 40-hex revision, flags/config/protocol hash, commands/counts/durations, requirement IDs. |
| H-01 tenant isolation | Every ticket; final hostile cross-Org/Company submit/enroll/place/lease/event/control/operator/parity matrix through `runInTenant`. Zero tolerance. |
| H-02 lease authority | JOB-003–007/011–014; one shared stale/replaced fence surface matrix. Zero tolerance. |
| H-03 single executor | JOB-003/004/006/007/010/014 concurrent lease/replace/legacy races. Zero tolerance. |
| H-04 secret containment | E1 validators + JOB-001/002/005/008/013 redaction/canary tests. |
| H-05 sandbox boundary | E3 sends only protocol control and no DB credential/tenant command to a worker; E6F-05 supplies the topology proof and E3 changes may not weaken it. |
| H-06 network boundary | E3 exposes no public ingress and no new egress; worker-control auth/topology negative enters E6/D1. |
| H-07 hosted exclusions | Default-off flag and existing distributed-exclusion checks remain green. |
| H-08 supply chain | E3 adds no image; the exact candidate consumes E6F-06 pinned-image/provenance evidence and may not certify an unapproved worker/control-plane digest. |
| H-09 cleanup | JOB-006/007 contribute attempt/lease cleanup; provider resources remain E6 worker/provider owners. |
| H-10 evidence integrity | Append-only ticket/QA/handoff attempts and rejected/stale audit rules. |
| RET-01 INITIAL retention | Gate summary stays in Git permanently; controlled raw event/race/load evidence is retained ≥180 days. |
| D1-00 topology | PostgreSQL, MinIO, one control-plane replica, ≥2 workers, fake provider, Toxiproxy, isolated runner; E3 records joined E6 owner evidence. |
| D1-01 INITIAL 20×10k/≥10 Orgs | Final E3 tenant property campaign; focused tickets use smaller deterministic RED/GREEN samples. |
| D1-02 ≥1,000 lease races | Final claim/ACK/renew/replacement campaign; exactly one winner. |
| D1-03 ≥100k events + ≥10k each fault class | Final duplicate/gap/out-of-order/lost-ACK/restart/hash campaign. |
| D1-04 ≥100 lifecycle faults | E3 exit proves job/attempt/lease/control recovery against the E6 foundation fake-worker seam. Provider-resource kill/cleanup remains a later E6 contribution; E3 does not certify it. |
| D1-05 cancel ≤30s, cleanup ≤5m | E3 measures job/lease/control convergence only. Provider-resource cleanup remains E6's later contribution. |
| D1-06 artifact integrity 100% | E3 proves fenced artifact metadata/authorization as a non-certifying contribution. E5/DAT owns byte round trips and the later joined D1 gate; no E5 evidence is an E3 exit dependency. |
| D1-07 zero orphans | E3 exit requires no active E3 lease, unACKed terminal event, or capacity claim. Provider resources remain a later E6 joined-gate contribution. |

### `E6-D1-FOUNDATION` consumption

Before JOB-004+, verify E6F-00 dependency closure, E6F-01 100 two-profile races, E6F-02
25 fake-provider fault cases/zero resources, E6F-03 networked PG/MinIO/control-plane/worker
smoke, E6F-04 tenancy, E6F-05 topology, E6F-06 image policy, E6F-07 deliberate failure
evidence, and E6F-08 explicit non-certification. The E3 controller records the exact QA and
handoff paths/SHA in the first post-D1 ticket result. A ticket marked complete is not this
gate.

### E3 integration gate (independent Gate Owner)

1. Freeze one candidate revision after all fourteen reviewer-completed ledgers.
2. Build workspace packages before tests. Run focused critical suites 3×, then D0-R01/R02,
   foundation/protocol-boundary/idempotency/integration-hygiene checks, and byte-clean check.
3. Run the E3-owned D1 contributions at their INITIAL volumes/topology, retaining seeds and
   raw-log references. This is not full D1 promotion: E5 artifact bytes and the remaining E6
   provider-resource slices are downstream in the program DAG. H-01/H-02/H-03 failure is
   `fail`, never conditional/waived.

   ```powershell
   $env:AOA_RUN_WIN_INTEGRATION='1'
   $env:AOA_D1_TENANT_SEEDS='20'; $env:AOA_D1_OPS_PER_SEED='10000'; $env:AOA_D1_ORGS='10'
   $env:AOA_D1_LEASE_RACES='1000'; $env:AOA_D1_EVENTS='100000'; $env:AOA_D1_EVENT_FAULTS_EACH='10000'
   $env:AOA_D1_LIFECYCLE_FAULTS='100'
    try {
      Invoke-NativeGate 'E3 D1 contributions' {
        pnpm --filter @armyofagents/server exec vitest run `
          src/__tests__/job-control-d1-tenant.property.integration.test.ts `
          src/__tests__/job-control-d1-leases.load.integration.test.ts `
          src/__tests__/job-control-d1-events.load.integration.test.ts `
          src/__tests__/job-control-d1-lifecycle.integration.test.ts `
          src/__tests__/job-control-d1-artifact-authorization.integration.test.ts `
          src/__tests__/job-control-d1-reconciliation.integration.test.ts
      }
    }
    finally {
      Remove-Item Env:AOA_D1_TENANT_SEEDS,Env:AOA_D1_OPS_PER_SEED,Env:AOA_D1_ORGS,Env:AOA_D1_LEASE_RACES,Env:AOA_D1_EVENTS,Env:AOA_D1_EVENT_FAULTS_EACH,Env:AOA_D1_LIFECYCLE_FAULTS,Env:AOA_RUN_WIN_INTEGRATION -ErrorAction SilentlyContinue
    }
   ```

   The suites emit the exact ordered seed manifest, expected/observed operation counts,
   cancellation/cleanup timings, query plans, and reconciliation totals. Run the H-01/H-02/
   H-03 subset three consecutive times on the frozen revision. The QA record marks D1-04's
   provider-resource portion, D1-06 bytes, and provider-resource D1-07 closure as downstream/
   not certified by E3. Full D1 promotion joins E3, E5, and remaining E6 evidence later.
4. On Windows local, set `AOA_RUN_WIN_INTEGRATION=1` from `C:\e3` and label the result
   `operator-directed windows-local`. Linux CI is the formal DEC-03 authority.
5. Gate Owner writes a new immutable
   `qa/<date>-d1-e3-job-control-<sha12>-a1.md`, then a distinct
   `handoffs/<date>-epic-completion-<sha12>-a1.md`, pinning every ticket ledger blob and
   reviewed revision. No self-certification.
6. Only after both records say `pass` on the same revision: change E3 README and epics index
   `backlog` → `complete`, commit evidence, fetch origin, verify
   `origin/docs/replatform-program` is an ancestor of HEAD, and—only with operator go-ahead—
   push `HEAD:docs/replatform-program`. Divergence is a STOP; never force-push.

---

## 8. Controller sequence and parallelization

The operator requested ticket-local fresh implementer/reviewer pairs. To keep migration and
shared service conflicts reviewable, the default controller sequence is:

```text
PRE-D1:
  JOB-001 -> JOB-002 -> JOB-009 -> JOB-003 -> JOB-010
                         |                     |
                         +---- E6/E4 work can consume interfaces after review

WAIT FOR committed passing E6-D1-FOUNDATION QA + handoff

POST-D1:
  JOB-004 -> JOB-005 -> JOB-006 -> JOB-007 -> JOB-008
                                      |
                                      +-> JOB-011 -> JOB-012 -> JOB-013 -> JOB-014

  all ticket reviews -> independent E3 gate -> operator push approval
```

At program level, JOB-001 and JOB-002 are independent enough to run in parallel worktrees,
and JOB-010 can follow JOB-001 while JOB-002/JOB-009 proceed. This E3 worktree deliberately
serializes them because all touch DB schema, shared route composition, and the one tenant
repository; avoiding migration-number and integration-ledger conflicts is cheaper than
parallel merge repair. Across epics, E4/E6 lanes may run independently according to Wave 2.

| Step | Modules touched | Depends on |
|---|---|---|
| Submit/admission foundation | db schema/repositories, server config/routes | E1/E2 |
| Enrollment | target registry, worker auth | E1/E2 |
| Placement | resolver, job repository | submit + enrollment |
| Lease/ACK | attempt/lease repository, worker route | submit + placement |
| Admission parity | legacy source services + submit | submit |
| Runtime lifecycle | lease/event/control/quota services | foundation partial gate + lease |
| Operator UI | server job-control API, UI settings | runtime lifecycle + placement |
| Legacy projections | existing policy/accounting/audit/output services | runtime lifecycle + admission parity |

### Commit/evidence boundaries

- Implementer code/migration commit per ticket; reviewer follow-up commit contains the
  append-only review result and is the only commit that completes the ticket.
- If one ticket needs a short commit series, every commit is scoped and the result ledger
  identifies the reviewed tip; no drive-by cleanup.
- Reviewers use plain `git commit` (never `--no-verify`).
- `findings.md` records discovered behavior, rejected hypotheses, STOP conditions, and
  resolution; a behavior-changing choice also updates `decisions.md` and this plan before
  implementation resumes.

---

## 9. Planner self-review

- All JOB-001–014 canonical outcomes/dependencies/failures are represented; standard tickets
  stay ≤3 agent-days and parity tickets are explicitly matrix-sized exemptions.
- JOB-009 precedes JOB-003; no job detail is exposed before tenant-scoped placement/claim.
- Every E3 entry point, background path, and bridge uses the E2 non-owner
  `runInTenant` transaction; E2-F012's requested NULLIF hardening is preserved because E3
  introduces no legitimate unwrapped tenant read and no raw unscoped repository.
- One conditional fence guard proves H-02 across every governed surface; row locking plus
  partial uniqueness and conditional transitions prove H-03.
- E1 v1 is consumed without edits and the custodian STOP is explicit.
- JOB-010–014 call the current engines, including the as-built conditional checkout rather
  than a stale SQL mechanism; CM-002/003/004/005/006/007/008/014 and every FND-007 dimension
  are mapped.
- Flag-off composition, no-effect shadow behavior, E10 cutover ownership, caveats
  CAV-001–004, migrations/#122, observability, rollback, evidence, and Linux-vs-Windows
  authority are explicit.
- The post-D1 named partial gate is a hard assignment boundary and the E3 gate has a distinct
  owner.

---

## 10. Implementation Tasks

Synthesized from the independent engineering review. Checkbox only after the named outcome
is committed and independently reviewed; these tasks do not authorize implementation.

- [ ] **T1 (P1 STOP, human: ~1 day / agent: ~2h)** — E2 serving role — choose and ratify A, B, or C.
  - Surfaced by: Architecture — locked E2-D03 contradicts migration 0211 and boot wiring.
  - Files: E2 decisions/findings/QA/handoff, migration/schema and startup files selected by the amendment.
  - Verify: corrective E2 security/integration gate and superseding `pass` handoff.
- [ ] **T2 (P1, human: ~2 days / agent: ~4h)** — legacy bridges — make outer transactions and publications safe.
  - Surfaced by: Architecture/Code Quality — current helpers publish early, fire-and-forget, or swallow errors.
  - Files: `issues.ts`, `costs.ts`, `budgets.ts`, `run-summary-comment.ts`, `agent-runtime-decisions.ts`, bridge adapters.
  - Verify: `job-legacy-after-commit.integration.test.ts` plus the owning parity suites.
- [ ] **T3 (P1, human: ~1 day / agent: ~2h)** — platform identity — close operator target and revocation authority.
  - Surfaced by: Architecture — enrollment needs both worker and target rows, while tenant fencing must see current generation.
  - Files: JOB-002 operator policy/pool, worker session auth, placement and fence authorization modules.
  - Verify: two-Organization revocation races against renew, event, secret, artifact, and completion.
- [ ] **T4 (P1, human: ~4h / agent: ~1h)** — capacity ownership — separate JOB-010 from JOB-007.
  - Surfaced by: Architecture — canonical admission parity and mixed capacity enforcement had overlapped.
  - Files: JOB-010 admission bridge/tests; JOB-007 capacity claim/release/wakeup service/tests.
  - Verify: source characterization pre-D1 and mixed legacy/distributed CM-014 proof post-D1.
- [ ] **T5 (P2, human: ~4h / agent: ~1h)** — readiness outbox — make retry wakeups attempt-aware.
  - Surfaced by: Code Quality — job-keyed readiness cannot reliably rearm attempt N+1.
  - Files: `job_outbox.ts`, JOB-001 submit, JOB-003 drainer, JOB-006 retry/reconciliation.
  - Verify: retry attempt and readiness row commit atomically; fallback scan is not correctness authority.
- [ ] **T6 (P2, human: ~4h / agent: ~1h)** — projection receipts — define durable exactly-once state.
  - Surfaced by: Code Quality — identity alone did not cover digest conflict, pending recovery, or target aggregate.
  - Files: `job_projection_receipts.ts`, tenant repository, parity bridge adapters.
  - Verify: same identity/same digest replays; different digest conflicts; pending resumes after crash.
- [ ] **T7 (P2, human: ~4h / agent: ~1h)** — acceptance commands — include every promised schema/security/load proof.
  - Surfaced by: Tests — focused commands omitted created DB/RLS/grant suites and exact D1 volume controls.
  - Files: ticket result ledgers, QA record, named DB/server integration suites.
  - Verify: command table in section 3 and D1 invocation in section 7 run on the reviewed revision.
- [ ] **T8 (P2, human: ~4h / agent: ~1h)** — fence contract — enumerate and guard all governed mutators.
  - Surfaced by: Tests — event, artifact, secret, completion, health, projection, and control ACK need one predicate.
  - Files: `job-fence-authorization.ts`, tenant repositories, contract and integration tests.
  - Verify: exported-governed-mutator contract test and stale/replaced fence matrix pass 3×.
- [ ] **T9 (P2, human: ~1 day / agent: ~2h)** — hot queries — bound polling and operator reads.
  - Surfaced by: Performance — claim/sweeper/control/outbox indexes and numeric fan-out limits were missing.
  - Files: schema indexes, poll/reconciliation services, operator list routes, D1 load suites.
  - Verify: query-plan assertions at INITIAL volumes, ≤32 Org shards/750 ms poll, cursor default 50/max 200.
- [ ] **T10 (P2, human: ~4h / agent: ~1h)** — ticket sizing — keep standard tickets within reviewable slices.
  - Surfaced by: Code Quality / external Claude delta review — JOB-001/JOB-002/JOB-009 combine several independently testable changes.
  - Files: ticket result ledgers and commit sequences defined in JOB-001/JOB-002/JOB-009.
  - Verify: each slice has RED/GREEN evidence; one distinct reviewer certifies the combined ticket revision.
- [ ] **T11 (P1 STOP, human: ~1 day / agent: ~2h)** — E1 frozen check — decouple immutable fixture proof from the mutable repository lockfile.
  - Surfaced by: Architecture/Tests — JOB-001's required manifest+lock change otherwise fails the E1 frozen gate.
  - Files: E1 checker/mutation corpus and superseding E1 QA/handoff; frozen fixture bytes remain unchanged.
  - Verify: original fixture mutation failures still fail, LF/CRLF-safe Git-byte proof passes, and JOB-001's declared consumer dependency does not invalidate frozen v1.
- [ ] **T12 (P1 STOP, human: ~2 days / agent: ~4h)** — device proof/binding — ratify and test the JOB-002 threat model and registry relationship.
  - Surfaced by: Security/Architecture — frozen E1 JSON has no proof field; bearer thumbprint claims and an unlinked worker row are insufficient.
  - Files: JOB-002 schema, transport-auth middleware, enrollment/session services, threat-model vectors, E2 operator decision.
  - Verify: copied token without key, proof replay/tamper/skew/cleanup, route-only shard discovery, atomic tenant code+profile+receipt, DB-enforced target authority key, owner-type migration, multi-profile cardinality, rotation and revocation all fail closed.
- [ ] **T13 (P1, human: ~1 day / agent: ~2h)** — lifecycle authority — make ACK, start, time, generation, and retry allocation explicit.
  - Surfaced by: Architecture/Tests — independent review found incomplete state transitions and race ownership.
  - Files: JOB-003–007 plan-owned repositories/services/tests.
  - Verify: atomic lease+attempt ACK, started-event transition, fresh DB clock at mutation, globally linearized cutoff plus crash-safe tenant fanout, current-generation guard, and one N+1 retry under concurrency.
- [ ] **T14 (P1, human: ~4h / agent: ~1h)** — evidence/DAG — fail fast and keep E5/E6 remainder out of E3 exit.
  - Surfaced by: Evidence integrity/Architecture — PowerShell cleanup could mask failure and E5 was an undeclared completion dependency.
  - Files: focused-command table, E3 gate command, QA requirement map.
  - Verify: missing command and forced native exit both remain failures after cleanup; E3 QA marks downstream D1 slices not certified.
- [ ] **T15 (P1, human: ~4h / agent: ~1h)** — trust/transaction boundary — accept source intent and describe publication durability honestly.
  - Surfaced by: Security/Code Quality — `JobEnvelopeV1` is server-to-worker authority and existing live publications have no durable retry channel.
  - Files: JOB-001 submission DTO/service tests and JOB-005/010–014 receipt/bridge planning.
  - Verify: caller cannot choose authoritative delivery facts; principal+source-scoped idempotency, atomic durable projection, and best-effort live invalidation behavior are tested.
- [ ] **T16 (P1, human: ~1 day / agent: ~2h)** — E1 idempotent retry — persist enrollment/ACK/renew semantic outcomes separately from proof replay.
  - Surfaced by: Protocol/Tests — frozen E1 marks all three operations `idempotent_retry`.
  - Files: enrollment-code receipt fields, `worker_operation_receipts.ts`, JOB-002/003/004 services and tests.
  - Verify: same scope/key/digest plus fresh proof replays the original outcome, changed digest fails, and ACK/renew never reapply or extend twice across response loss/restart.

Review history is retained rather than overwritten. The first independent reviewer accepted
the earlier revision as a blocked plan. A fresh second reviewer then read committed revision
`5b57511e53d42a9c6d11e358379807389a285e87` and returned `REVISE / BLOCKED`: 7 P1 and
3 P2 findings, including device proof, fence-time/revocation, ACK transitions, retry
uniqueness, fail-fast evidence, and the E5 gate dependency. Controller verification added
the E1 lockfile-pinning STOP and the submission trust-boundary correction. After the
amendments, that fresh reviewer re-ran every affected area and returned
`ACCEPT AS BLOCKED PLAN` with no remaining P0/P1/P2 plan finding.

The user-provided Claude review was then provenance-checked. It reviewed the shared branch at
`8e2faa590d4e97a2cbd250c55f4a2ed81a352a33`, before either local planning commit, so its
headline that no implementation plan existed was accurate for that remote revision but stale
for this worktree. Its ordering, RLS/migration, and gate-evidence concerns were already
explicit here. Every ticket named rollback, but delta checking found that JOB-012–014 still
needed explicit pending-receipt flag-off semantics; those are now defined. Its JOB-009 sizing
concern also remained useful; the canonical ticket now has three bounded internal TDD/commit
slices without changing its locked outcome or number.
The suggestion to plan only the startable five or build E6 first was not adopted because the
operator and canonical program design require all of E3 to be planned now, with execution
split at the named `E6-D1-FOUNDATION` partial gate.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | Not run; not required for this backend planning pass. |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Not run. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 4 | `ACCEPT AS BLOCKED PLAN` | Current delta triage confirmed no new P0/P1; JOB-009 received one P2 sizing clarification. |
| Claude Code | `claude -p` | User-requested outside-model review | 0 | `AUTH BLOCKED` | Claude Code 2.1.126 is installed, but `claude auth status` reports `loggedIn: false`; no Claude review occurred. |
| Claude (user-provided) | pasted review | External plan delta review | 1 | `TRIAGED — STALE BASE` | Reviewed origin `8e2faa590`, not the local plan; three concerns were already closed, while JOB-009 sizing and explicit JOB-012–014 disablement were valid deltas and are now resolved in plan. |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Not run; E3 operator UI follows existing patterns. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Not run. |

**VERDICT:** APPROVED, BLOCKED ON PREDECESSOR CORRECTIONS — independently review-complete;
the operator selected E2 option B plus the metadata-only operator role, approved the E1
checker-only correction, and approved JOB-002's HTTP-header proof/composite binding. No E3
ticket is assignable until the E2 and E1 corrective gates commit passing handoffs.

NO UNRESOLVED DECISIONS
