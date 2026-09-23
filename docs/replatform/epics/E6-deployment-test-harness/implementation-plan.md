# E6 — Deployment and Distributed Test Harness — Implementation Plan (PARTIAL: `E6-D1-FOUNDATION`)

**Plan status:** `partial-draft` — this document covers **only** the five
`E6-D1-FOUNDATION` tickets (DEP-000, DEP-001, DEP-002, DEP-003, DEP-004) and the
named `E6-D1-FOUNDATION` partial gate. DEP-005 through DEP-009 (network/clock
harness, staging manifests, observability baseline, managed-provider isolation
conformance, and two-replica HA) are **out of scope** here and are owned by the
later full-E6 plan revision. Nothing in this partial plan passes D1, E6, or a
release lane.

**Scope note (forward dependencies not yet built):** DEP-000 depends on WRK-004
and DEP-001 depends on WRK-001; the E4 worker daemon does **not exist yet**
(`packages/worker-daemon` is absent; E4 is `backlog`). `E6-D1-FOUNDATION` closure
additionally requires JOB-003 (E3, currently `needs_changes`) and WRK-004. No
DEP ticket in this plan is assignable until its named upstream ticket has a
committed passing handoff. These STOPs are recorded in §0 and the execution
boundary; they are not improvised away.

**Goal:** Build the dormant, deterministic distributed **test harness** that lets
the durable job-control plane (E3) and the worker daemon (E4) be exercised end to
end without any live cloud provider: a fixture-driven networked fake sandbox
provider, separately-signed least-privilege control-plane and worker images, an
isolated Docker Compose topology (PostgreSQL, MinIO, one control-plane replica,
≥2 profiled workers, fake provider, Toxiproxy, runner), a privileged migration
job with a liveness/readiness/dependency contract and the fail-closed 0188
populated-cutover preflight, and path-filtered + merge-train CI lanes with
retained failure evidence — culminating in the independent `E6-D1-FOUNDATION` QA
record and handoff.

**Approved architecture:** The control plane remains the sole executor of tenant
effects; the harness never adds a second job/attempt/lease authority, provider
registry, or memory/task store. The fake provider is **provider-neutral** — it is
addressed by opaque provider ID, exposes only the frozen `PROVIDER_OPERATIONS`
vocabulary, and carries **no E2B fields** in any common contract (CAV-002). All
distributed behavior stays behind `AOA_DISTRIBUTED_EXECUTION_ENABLED=false`; the
harness images, compose stack, migration job, and merge-train lane are additive
and dormant until an operator opts in. Real E2B/managed-provider conformance is
the CLI-001/D2 gate, **not** an E6-D1-FOUNDATION prerequisite. Application startup
**never** runs migrations and **never** synthesizes the durable 0188 marker.

**Tech stack:** TypeScript, Node 24 / pnpm 9.15.4 workspaces, Express 5,
PostgreSQL 16, Drizzle ORM, E1 `@armyofagents/worker-protocol` (frozen v1),
Vitest, `embedded-postgres`, Docker + Docker Compose, MinIO, Toxiproxy, cosign
(test roots), an SBOM generator (syft/CycloneDX), and GitHub Actions.

---

## 0. Planning record, freeze, and dependency gates

| Item | Recorded value |
|---|---|
| Frozen `origin/main` | `003492988269a91eadfadb352bff7f413fa61adb` — the crosswalk execution freeze (same anchor as E0–E3); present locally and an ancestor of `origin/main`. |
| Planning baseline SHA | `d24dd68a755f49019833112af1bc248e17f8a193` — `C:\e3` tip of `codex/epic-e3-job-control` (cumulative E0–E3). This is the **planning** revision only; each DEP ticket's `Start SHA` is its actual assignment SHA once its E4 upstream lands. |
| E0 completion | `pass` — `docs/replatform/epics/E0-foundation/handoffs/2026-08-08-epic-completion-3a469b6bec68-a1.md`. |
| E1 completion (frozen protocol + consumer checker) | `pass` at reviewed `01ad1ab554fe25c5178c7552ec047d4df45b7dcf`. `@armyofagents/worker-protocol` v1 is frozen and consumed unchanged. |
| E2 completion (tenant kernel, **TEN-002**) | `pass` at reviewed `7843b86e25eb1ff9c520308aef7f123fec6997a7`. Non-owner `aoa_app` + metadata-only `aoa_operator`, FORCE RLS on the eight new-path tables, and `runInTenant` are available. |
| E3 (**JOB-003** lease/ACK) | `needs_changes` at planning time. `E6-D1-FOUNDATION` **closure** requires JOB-003 `complete`. Not a blocker to *planning* DEP tickets, but a blocker to the gate. |
| E4 (**WRK-001** worker package, **WRK-004** sandbox supervisor) | **Not present / `backlog`.** `packages/worker-daemon` does not exist. DEP-000 (needs WRK-004's provider-driver port) and DEP-001 (needs WRK-001's worker package + entrypoint) are **blocked** until E4 lands. |
| `E6-D1-FOUNDATION` | **Not present / not passed.** It is a named partial gate, never a ticket-result substitute, and does not certify E6 or D1. |
| Planning worktree | `C:\e3` (short path — deep-OneDrive MAX_PATH boot failure is a known hazard); dependencies installed with `pnpm install --frozen-lockfile`. |
| Formal test authority | **Linux CI under DEC-03.** Windows short-path evidence is operator-directed local evidence and must be labeled `operator-directed windows-local`. Docker/compose/image lanes have **no** Windows-local substitute for the formal Linux lane. |
| Planning baseline smoke | `pnpm build` passes at the planning SHA. `pnpm test:run` on Windows exits with the already-recorded worker-protocol cross-version `ERR_IPC_CHANNEL_CLOSED` transform artifact; planning context only, never gate evidence or a waiver. |

### STOP — E4 worker daemon must land before DEP-000/DEP-001

DEP-000's networked fake provider implements **the provider-driver port that
WRK-004 owns** (the supervisor that consumes create/execute/cancel/kill/destroy/
list/inspect/reconcile_cleanup + checkpoint/restore/health). DEP-001's worker
image packages **the `packages/worker-daemon` daemon and entrypoint that WRK-001
scaffolds**. Neither the port nor the package exists at planning time. DEP-000 and
DEP-001 may be *planned* against the frozen `capabilities.ts` vocabulary now, but
**assignment is blocked** until WRK-001/WRK-004 have committed passing handoffs.
Inventing a second provider-driver interface or a worker runtime inside E6 is a
STOP requiring an E4 amendment, not an E6 improvisation.

### RESOLVED — provider-neutrality and the shared contract suite

The DEP-000 fake provider and the reusable provider-contract suite use **opaque
provider IDs only** and no E2B-specific fields (CAV-002). The single conformance
suite authored here (`@armyofagents/sandbox-provider-contract`) is the suite E2B
consumes later at CLI-001/D2; E6 runs it only against the fake. Recorded E2B
runtime/TTL/resource/concurrency/template/persistence limits stay behind the
accepted caveat and are **not** required for this gate.

### Execution boundary

| Boundary | Tickets | Assignment rule |
|---|---|---|
| **Blocked on E4** | DEP-000, DEP-001 | Not assignable until WRK-004 (DEP-000) and WRK-001 (DEP-001) have committed passing handoffs. Plannable now against frozen E1 `capabilities.ts`. |
| **Blocked on DEP predecessors** | DEP-002, DEP-003, DEP-004 | DEP-002 needs DEP-000 + DEP-001 + TEN-002 (TEN-002 passed). DEP-003 needs DEP-002 + TEN-001 (passed). DEP-004 needs DEP-002 + FND-005 (passed). Respect the DAG in §8. |
| **Gate, blocked** | `E6-D1-FOUNDATION` | Requires DEP-000–004 **and** JOB-003 **and** WRK-004 on one revision, plus the independent QA record and passing handoff over E6F-00–E6F-08. |
| **Out of scope (later E6 plan)** | DEP-005–DEP-009 | Not in this partial plan. |

### NOT in scope (this partial plan's non-goals)

- No DEP-005 network/clock fault *scripting* (Toxiproxy is *wired* by DEP-002; its
  fault campaigns and clock control are DEP-005 + DEP-006). This plan only proves
  the proxy is in-path and the boundaries hold.
- No DEP-006 staging manifests, autoscaling, or managed provider-control secret
  injection; no DEP-008 hostile/reference-provider isolation conformance; no
  DEP-009 two-replica HA or shared admission store.
- No real E2B, Firecracker, or any managed provider execution or claim (CAV-002);
  the fake is provider-neutral and implements only the frozen registered ops.
- No release-root signing, vulnerability policy, or attestation breadth — DEP-001
  uses **test roots** only; REL-004 later replaces them.
- No second job/attempt/lease authority, provider registry, tool registry, memory
  store, or task store.
- No public worker ingress, realtime durability claim, desktop packaging, or
  mobility.
- No change to E1 v1 wire protocol. An unavoidable wire change is an additive
  versioned field only and is a STOP requiring the Protocol/Schema Custodian.
- No RLS retrofit of legacy Company tables (CAV-005) and no unsafe owner-pool
  bridge in any new path (the marker table is written only by `aoa_operator`).

---

## 1. Consumed as-built interfaces / what already exists and is reused

### Frozen E1 protocol — consume, do not edit

| Interface | E6-D1-FOUNDATION use |
|---|---|
| `packages/worker-protocol/src/capabilities.ts` | `PROVIDER_OPERATIONS` (`create, execute, cancel, kill, destroy, list, inspect, reconcile_cleanup, checkpoint, restore, health`), `CORE_PROVIDER_OPERATIONS` (8 mandatory), `OPTIONAL_PROVIDER_OPERATIONS` (`checkpoint, restore, health`), `providerConstraintProfileV1Schema` + `verifyAndBrandProviderConstraintProfileV1`, `registeredTargetProfileV1Schema`, `workerSatisfiesRequirements`. The fake provider (DEP-000) advertises and honors exactly this vocabulary; no new op is invented. |
| `packages/worker-protocol/src/canonical-json.ts` | `canonicalizeJsonV1`, `canonicalEventDigestInputV1`, `verifyWorkerEventDigestV1` (SHA-256 injected). DEP-000 recomputes and asserts `eventDigest` for every scripted event so fixture replays are byte-deterministic. |
| `packages/worker-protocol/src/events.ts`, `states.ts`, `transport.ts` | `WorkerEventV1`/batch shapes, lifecycle transition predicates, and the 10 transport operations. The fake replays fixture `expectedEvents`, and the smoke job (DEP-002) exercises enroll/poll/lease_ack against the real control-plane surface. |
| Frozen-consumer baseline `tests/fixtures/worker-protocol-consumers/v1/` + `scripts/check-frozen-worker-protocol-consumer.mjs` | Any new leaf package that imports `@armyofagents/worker-protocol` keeps the frozen source-SHA/dependency proof green. |

### FND-004 golden-journey fixtures — the corpus DEP-000 scripts from

| Interface | E6-D1-FOUNDATION use |
|---|---|
| `tests/fixtures/distributed-execution/*.json` (9 fixtures) + `schema-v1.json` | The validated golden journeys the fake provider replays. Fixture shape: `steps[]` (`{action, at?, emits?[]}`), `failureInjection` (`{point, effect}` or `null`), `expectedEvents[]` (with `eventDigest`), `cleanup` (`resource_bound_cleanup`), and `expected` (`{terminalState, artifacts[], auditActions[], forbiddenEffects[]}`). |
| `scripts/check-distributed-execution-foundation.mjs` | Meta-validates the schema, validates every fixture, and verifies digests. `GJ_FIXTURES` is the enumerated corpus; the canonicalizer/`computeEventDigest` are exported. DEP-000/DEP-004 keep this checker green and reuse its exports. |

### E2 tenant kernel + E3 job control — the harness exercises, never replaces

| Interface | Files | Reuse rule |
|---|---|---|
| Distributed flag + startup safety (FND-005) | `server/src/config/distributed-execution.ts`, `server/src/config.ts` | `AOA_DISTRIBUTED_EXECUTION_ENABLED` gates everything; `assertHostedExecutionStartupSafe` is the "exit on invalid trust configuration" template. The harness never enables authority — it only exercises the dormant path. |
| Bounded serving/operator pools | `server/src/db/distributed-execution-databases.ts`, `packages/db/src/client.ts` (`createTenantAppDbConnection`, `createOperatorDbConnection`, `RequiredMigrationIdentity`, `loadRequiredMigrationIdentity`) | The migration job (DEP-003) runs as a **privileged** role distinct from `aoa_app`/`aoa_operator`; the control plane opens only the non-owner serving pool after readiness. |
| Tenant RLS roles/tables/GUC | `server/src/db/rls-tenant.ts` (`TENANT_APP_ROLE="aoa_app"`, `OPERATOR_ROLE="aoa_operator"`, `TENANT_GUC="aoa.organization_id"`, `TENANT_RLS_TABLES`), `server/src/db/tenant-context.ts` (`runInTenant`), `server/src/db/with-tenant-tx.ts` | DEP-003's marker table follows the C14/Decision #122 custom-RLS migration pattern: `aoa_operator` write, `aoa_app` read, tenants none. The smoke job's tenancy assertions (E6F-04) run through `runInTenant`. |
| Worker-facing control-plane surface (JOB-002/003) | `server/src/routes/worker-control.ts` (`/api/worker-control/enroll|poll|leases/:id/ack`), `server/src/services/worker-enrollment.ts`, `server/src/services/job-leasing.ts`, `server/src/services/job-submission.ts`, `server/src/services/job-placement.ts` | DEP-002's fake-provider job and DEP-000's networked fake drive **these** endpoints. The harness adds no new control-plane route (event/control ingestion remains E4/JOB-005+). |
| Migration 0188 | `packages/db/src/migrations/0188_organizations.sql` | The one-way-door org migration DEP-003's populated-cutover preflight guards. DEP-003 does **not** modify 0188; it adds the operator-gated snapshot/marker machinery around it. |

### Existing infra the DEP tickets extend

| Concern | Files | Reuse rule |
|---|---|---|
| Combined image (to split) | `Dockerfile`, `scripts/docker-entrypoint.sh` | DEP-001 produces **separate** `docker/control-plane/` and `docker/worker/` images. The combined `Dockerfile` and `docker.yml` stay untouched until REL-004. |
| Multi-service compose template | `docker-compose.research.yml` (two networks, `service_healthy` gating, `AOA_E2E_FAKE_*` control-file/invocations-JSONL pattern) | DEP-002's `docker-compose.d1.yml` mirrors its structure; it is the closest existing model for deterministic startup + fake-harness wiring. |
| CI gate suite + aggregator | `.github/workflows/pr.yml` (`changes` detector, `policy`, `ci-required`), `docker.yml` | DEP-004 extends `changes` path-classing and routes new conditional jobs through `ci-required` (never a trigger-level `paths:` or an independently-required check). |
| Dependency-boundary checker template | `scripts/check-worker-protocol-boundary.mjs` + `scripts/lib/worker-protocol-boundary.mjs` | DEP-000 adds an analogous fake-provider boundary check ("no tenant/server/db code on the host worker"). |
| Health surface | `server/src/routes/health.ts` (`/api/health`) | DEP-003 splits it into liveness / readiness / dependency-health and adds the schema-compatibility serving gate. |

---

## 2. Harness shape and isolation rules

### 2.1 Provider-neutral fake sandbox provider (DEP-000)

- **Two new leaf packages, no server/db import:**
  `@armyofagents/sandbox-fake-provider` (the networked fake + fixture runtime +
  invocation ledger) and `@armyofagents/sandbox-provider-contract` (the
  parameterized, provider-neutral conformance suite). Both are pure leaves whose
  runtime deps are limited to `@armyofagents/worker-protocol`, `zod`, and Node
  built-ins. A boundary check (`scripts/check-sandbox-fake-provider-boundary.mjs`)
  statically rejects any import of `@armyofagents/server`, `@armyofagents/db`,
  `drizzle-orm`, or tenant modules — this is the machine-checkable form of
  "without invoking tenant code on the host worker".
- **Addressing + inspection.** The fake exposes a small loopback HTTP control
  plane: a *control* channel (`POST /script` loads a validated golden fixture by
  provider ID; `POST /reset`; `GET /invocations` returns the append-only
  invocation ledger) and a *driver* that implements WRK-004's provider-driver
  port and is addressed by `providerId`. Every driver call appends
  `{providerId, op, args-digest, checkpoint, faultInjected, ts}` to the ledger;
  tests inspect it via `GET /invocations`.
- **Fixture-driven scripting.** For each of `create/execute/event/hang/cancel/
  crash/checkpoint/destroy`, behavior is read from the FND-004 fixture's `steps[]`
  + `failureInjection`. A fault is injectable **at each lifecycle checkpoint** by
  matching `failureInjection.point` to the checkpoint and applying
  `failureInjection.effect`. Scripted events are emitted with a recomputed
  `eventDigest` via `verifyWorkerEventDigestV1`, so two replays of one fixture are
  byte-identical.
- **Determinism + reset isolation.** A fake clock and deterministic id/digest
  fixtures make each replay reproducible; `reset` restores zero invocations and
  zero live resources, and the `list`/`inspect` projection reports zero resources
  after `reconcile_cleanup` (the E6F-02 "zero provider resources" invariant).

### 2.2 Separate signed least-privilege images (DEP-001)

- **Control-plane image** (`docker/control-plane/Dockerfile`): server + UI only.
  **No** `docker-cli`, **no** worker daemon, **no** agent CLIs. Non-root user,
  read-only root filesystem, pinned base **by digest**
  (`node:lts-trixie-slim@sha256:…`), `HEALTHCHECK` → `/api/health`, and OCI labels
  exposing health/version/source metadata (`org.opencontainers.image.revision` =
  the recorded source SHA).
- **Worker image** (`docker/worker/Dockerfile`): the `packages/worker-daemon` daemon
  only (WRK-001). **No** UI, **no** `@armyofagents/server`, **no** DB/drizzle
  tooling. Non-root, read-only root, pinned base by digest, local health/metrics
  endpoint only.
- **Supply chain (test roots).** `docker/images/build.sh` builds both
  reproducibly from the recorded source revision; `docker/images/sbom.sh` emits a
  minimum SBOM per image; `docker/images/sign.sh` signs each image digest with a
  **test** cosign key and attaches source provenance. `docker/images/allowlist.json`
  records the accepted signed digests.
- **Admission verification.** `scripts/verify-image-admission.mjs` (pure logic in
  `scripts/lib/image-admission.mjs`) verifies signature + provenance against the
  test root and admits **only** allowlisted digests; it rejects a tampered or
  unsigned digest fail-closed. DEP-002's compose consumes only admitted digests.
- **Deps-stage parity.** The `pr.yml` Dockerfile-deps validator is **extended** to
  cover both new Dockerfiles: each image's `deps` stage must `COPY` exactly its
  own dependency closure and no more. The worker image's closure is fixed by
  **E4-D01** to exactly `worker-daemon` + `worker-protocol` + the `pino` runtime
  dep (zod transitive); it does **not** copy `adapter-utils` and must not pull
  server/db/shared/drizzle.

### 2.3 Isolated D1 compose topology (DEP-002)

Network segmentation matrix (enforced by both a static validator and live denial
tests):

| Service | `data-net` | `control-net` | `worker-net` | `provider-ctl-net` |
|---|---|---|---|---|
| `postgres` | ✅ | — | — | — |
| `minio` | ✅ | ✅ (declared S3 API) | ✅ (declared S3 API) | — |
| `control-plane` (1 replica) | ✅ | ✅ | ✅ | ✅ **declared provider API only** |
| `worker-a`, `worker-b` (≥2, distinct profiles) | **❌** | ✅ (control-plane API) | ✅ | ✅ (fake execute API) |
| `fake-provider` | — | ✅ declared API | ✅ | ✅ control endpoint (workers only) |
| `toxiproxy` | in-path on worker↔control-plane, worker↔minio, control-plane↔postgres | | | |
| `migrate` (DEP-003) | ✅ privileged | — | — | — |
| `test-runner` | — | ✅ | — | — |

- **Worker cannot reach PostgreSQL:** workers are **not** attached to `data-net`;
  a live TCP-connect from a worker to `postgres:5432` must be refused.
- **Control plane reaches provider only via declared API:** the control plane may
  hit the fake's declared API but **not** its control endpoint
  (`/script`,`/reset`) — those are worker-side/test-runner-side only.
- **No shared writable volume:** each service owns its named volume or mounts
  read-only; a static `docker inspect`-style check asserts no two services share
  one `rw` mount.
- **Deterministic startup:** `depends_on: { condition: service_healthy }`;
  `migrate` completes before `control-plane` serves (readiness gate, DEP-003);
  `worker-a`/`worker-b` enroll against distinct registered target profiles.

### 2.4 Migration job + readiness contract + 0188 preflight (DEP-003)

- **Privileged migration job, separated from app startup.** A dedicated container
  command (`docker/control-plane/migrate-entrypoint.sh` → `packages/db/src/
  migrate-job.ts`) applies schema migrations under a **privileged** migration role
  (not `aoa_app`/`aoa_operator`), is **idempotent**, and **never loops
  destructively** (bounded retries, fail-closed exit). App startup runs **no**
  migrations.
- **Liveness / readiness / dependency health, distinguished.**
  `/api/health` → liveness (process up); a new `/api/ready` → readiness = applied
  migration identity is **compatible** with the image's
  `loadRequiredMigrationIdentity()` **and** dependency health (PostgreSQL + MinIO
  reachable). The control plane **serves no tenant/app route until ready** (503
  from a readiness middleware, not a crash). Worker readiness (consumed from
  WRK-001's local health surface) requires a valid session **and** provider
  health.
- **0188 populated-cutover preflight — fail-closed, operator-gated.** The first
  populated single-tenant→`cloud_auth` flip runs, in order, in the migration job
  (never at app startup):
  1. Require **explicit operator opt-in** (`AOA_0188_CUTOVER_OPT_IN=1`) **and**
     the **exact candidate SHA** (`AOA_0188_CANDIDATE_SHA` == the image's recorded
     source revision). Missing/either mismatched → **STOP, no marker**.
  2. Take a snapshot to the object store, **checksum-validate** it. Snapshot or
     checksum failure → **STOP, no marker**.
  3. **Restore** the snapshot into an **isolated pre-cutover database** and verify
     it restores cleanly (restore-validation). Failure → **STOP, no marker**.
  4. Write the **durable 0188 marker** row (only now), keyed by candidate SHA with
     snapshot ref + checksum + verified-at.
  5. **Verify** the marker by read-back. Verify failure → **STOP** (do not deploy).
  6. **Idempotent repeat:** a second invocation with a present, verified marker for
     the same candidate SHA is a no-op success.
  Application startup **reads** the marker but can **never write or synthesize**
  it; marker absence → refuse cutover, stay single-tenant. The marker table is
  written only by `aoa_operator` (custom RLS migration, C14/Decision #122;
  slug `distributed_cutover_marker`), read-only for `aoa_app`, invisible to
  tenants.

### 2.5 CI lane routing rule (DEP-004)

- **Path classification, not trigger filters.** Extend the existing `changes` job
  to emit path-class outputs (`protocol`, `schema`, `fixtures`, `provider`,
  `compose`). **Never** add a trigger-level `paths:`/`paths-ignore:` to `pr.yml`
  (a skipped required check passes silently) and **never** make a conditional job
  an independently-required check — route the verdict through `ci-required`.
- **Mandatory consumers.** A protocol/schema/fixtures/provider change **must**
  trigger its consumer job (`distributed-contract`); `ci-required` requires it to
  pass **only when** its trigger class changed, exactly like the existing
  `verify`/`e2e` docs-only skip pattern.
- **Merge-train with evidence.** A separate `d1-merge-train.yml` (merge_group /
  push-to-main) brings up `docker-compose.d1.yml`, runs a bounded E6F subset, and
  on failure **retains** distributed logs, events, DB-state dump, and MinIO object
  manifests via `actions/upload-artifact`. Its config is statically validated on
  every PR by `scripts/check-ci-lanes.mjs`.

---

## 3. TDD, evidence, and commit protocol for every ticket

1. The controller creates `tickets/DEP-00X-result.md` with the exact **bare
   40-hex** Start SHA, `Status` and `Disposition` **backtick-wrapped**, named
   implementer/reviewer, acceptance checklist, and command ledger. The Start SHA
   is the actual assignment SHA (after the E4 upstream lands for DEP-000/001).
2. A fresh implementer writes focused tests first and commits/records a **genuine
   RED** on unchanged behavior. The controller rejects false REDs (import/build-
   order/env-setup artifacts).
3. The implementer makes the smallest GREEN change, runs the focused acceptance
   plus affected-package typecheck/build, updates `findings.md`, and commits.
4. A **DISTINCT reviewer** checks the reviewed 40-hex revision (an ancestor of
   HEAD), reruns the focused command, appends review attempt 1 with a plain
   `git commit`, and alone flips `Status` → `complete`.
5. Any harness isolation-invariant failure (no-tenant-code-on-worker, worker↔DB
   reachability, control-plane→provider-control reachability, shared-rw-volume,
   marker auto-synthesis, unsigned/tampered image admitted) is a **non-waivable
   `fail`**. A dependency/protocol/frozen-main contradiction is a **STOP + plan
   amendment**, never an improvised implementation.

Shared PowerShell helpers (identical to the E3 lane so red/green run from `C:\e3`):

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
```

Affected-package gates (each through `Invoke-NativeGate`): `pnpm --filter
@armyofagents/{sandbox-fake-provider,sandbox-provider-contract,db,shared,server,ui}
{typecheck,build}`.

**Lane classification (DEC-03).** Pure leaf-package and `node --test` script lanes
run **locally on Windows** (no PG, no Docker). Embedded-PostgreSQL integration
lanes run locally only when wrapped in `Invoke-E3Integration { … }` (which exports
`AOA_RUN_WIN_INTEGRATION=1`) with `embedded-postgres` `--encoding=UTF8 --locale=C`.
**Docker/image/compose live lanes have no Windows-local substitute** and are the
formal **Linux CI** authority; a local Linux docker host is operator-directed
evidence only.

Tests are hermetic: fake clock, deterministic UUID/digest fixtures, embedded
PostgreSQL, in-process/loopback fakes — **no live provider, network egress,
customer data, or real credential**. Every focused result records command, exit
code, test count, duration, platform, and exact revision.

| Ticket | Exact focused command (lane) |
|---|---|
| DEP-000 | **Local + CI:** `Invoke-NativeGate 'DEP-000 fake' { pnpm --filter @armyofagents/sandbox-fake-provider exec vitest run }; Invoke-NativeGate 'DEP-000 contract' { pnpm --filter @armyofagents/sandbox-provider-contract exec vitest run }; Invoke-NativeGate 'DEP-000 boundary' { node scripts/check-sandbox-fake-provider-boundary.mjs }; Invoke-NativeGate 'DEP-000 foundation' { node scripts/check-distributed-execution-foundation.mjs }` |
| DEP-001 | **Local (pure):** `Invoke-NativeGate 'DEP-001 admission' { node --test scripts/lib/__tests__/image-admission.test.mjs }`. **Linux/CI only (docker):** `Invoke-NativeGate 'DEP-001 images' { bash docker/images/build.sh && node --test docker/images/__tests__/image-contents.test.mjs docker/images/__tests__/image-startup-smoke.test.mjs }` |
| DEP-002 | **Local (static):** `Invoke-NativeGate 'DEP-002 compose-config' { node scripts/check-d1-compose.mjs; node --test scripts/lib/__tests__/d1-compose-invariants.test.mjs }`. **Linux/CI only (compose up):** `Invoke-NativeGate 'DEP-002 topology' { node --test tests/d1/network-denial.test.mjs tests/d1/fake-provider-job.test.mjs }` |
| DEP-003 | **Local (pure):** `Invoke-NativeGate 'DEP-003 preflight' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/cutover-0188-preflight.test.ts src/__tests__/readiness-liveness.test.ts }`. **Local (embedded PG):** `Invoke-E3Integration { Invoke-NativeGate 'DEP-003 db' { pnpm --filter @armyofagents/db exec vitest run src/__tests__/distributed-cutover-marker-schema.integration.test.ts src/__tests__/migration-idempotency.test.ts }; Invoke-NativeGate 'DEP-003 server' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/migration-readiness.integration.test.ts src/__tests__/migration-rollback-startup.integration.test.ts } }` |
| DEP-004 | **Local (pure):** `Invoke-NativeGate 'DEP-004 ci-lanes' { node scripts/check-ci-lanes.mjs; node --test scripts/lib/__tests__/ci-lanes.test.mjs scripts/lib/__tests__/d1-evidence-bundle.test.mjs }`. **Linux/CI only:** the `d1-merge-train.yml` deliberate-failing-fixture proof + evidence-artifact retention. |
| DEP-014 | **Local (pure):** `Invoke-NativeGate 'DEP-014 admission' { node --test scripts/lib/__tests__/image-admission.test.mjs }`. **Linux/CI only (docker):** the `d1-merge-train` job that builds, signs and admits all three images; the evidence is that job, cited by job name. |
| DEP-015 | **Local (pure):** `Invoke-NativeGate 'DEP-015 staging manifest' { node scripts/check-staging-manifest.mjs; node --test scripts/check-staging-manifest.test.mjs scripts/lib/__tests__/staging-manifest.test.mjs }; Invoke-NativeGate 'DEP-015 boot shape' { node scripts/check-m1-shipped-boot-shape.mjs; node --test scripts/check-m1-shipped-boot-shape.test.mjs }` (the shape guard is **created** by the ticket). **Linux/CI only, keyed (F8):** one `workflow_dispatch` of `m1-shipped-boot.yml` on a named candidate. |
| DEP-016 | **Local (static):** `Invoke-NativeGate 'DEP-016 compose' { node scripts/check-d1-compose.mjs; node --test scripts/lib/__tests__/d1-compose-invariants.test.mjs }`. **Linux/CI only (docker):** `AOA_D1_LIVE=1 node --test tests/d1/m1-spine.test.mjs` inside the `d1-merge-train` job with `AOA_D1_CAMPAIGN=m1-spine`, plus the usage-suppressed positive-control run; the evidence is the retained on-pass bundle. |
| DEP-017 | **Local (pure):** the probe's unit test (created by the ticket). **Linux/CI:** the probe observed inside the `DEP-015` lane, plus the planted-canary positive-control run (which runs inside every probed sandbox). ★ *Amended 2026-09-23 by DEP-017's build, after the Codex review of PR #565, and RATIFIED by the M1 planning session under founder delegation F2 on 2026-09-23. NOT a narrowing of criterion 5:* the probe cannot be observed inside the `DEP-016` profile from `DEP-017`, because `tests/d1/m1-spine.test.mjs` does not exist yet (`DEP-016` is unbuilt) and because the D1 lane runs the FAKE provider, whose `execute` returns a canned `executed` result and runs no command (`packages/sandbox-fake-provider/src/fake-driver.ts`, the `case "execute"` arm) — arming the probe there today would fail every D1 distributed run `env_probe_not_run` while observing nothing. The obligation is therefore CARRIED INTO `DEP-016` (see its task section), which owns the profile and must arm `AOA_WORKER_ENV_PROBE` and assert the probe summary per enabled tenant on whatever provider that profile runs. `DEP-017` delivers the probe and its observation in the `DEP-015` lane. |
| DEP-018 | **Local (pure):** `Invoke-NativeGate 'DEP-018 matrix' { node scripts/check-campaign-fault-matrix.mjs; node --test scripts/check-campaign-fault-matrix.test.mjs }` (created by the ticket). **Linux/CI only (docker):** `AOA_D1_LIVE=1 node --test tests/d1/m1-fault-matrix.test.mjs` per profile; the evidence is one injection-fired line per declared case. |
| DEP-019 | **Local (pure):** `Invoke-NativeGate 'DEP-019 provider' { npx vitest run --root packages/sandbox-fake-provider; node --test scripts/lib/__tests__/m1-spine-assertions.test.mjs }`. **Linux/CI only (docker):** `AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-spine node --test tests/d1/m1-spine.test.mjs` in the `m1-spine` job with the worker-driven override, plus the NOT-THE-EXECUTOR control run, the usage-suppressed control run and the probe-disarmed control run; the evidence is the retained on-pass bundle, which names the deployed worker's identity and the env-probe summary per enabled tenant. |

---

## 4. Ticket implementation tasks

### DEP-000 — Deterministic fake sandbox provider (M, ≤3 agent-days, FOUNDATION)

**Depends on:** WRK-004 (provider-driver port — **not built**, E4), FND-004
(fixtures — built). **Blocked on E4.**

**Outcome:** A networked fake provider that scripts create/execute/event/hang/
cancel/crash/checkpoint/destroy behavior from validated golden fixtures, is
addressable by provider ID, exposes an inspectable invocation ledger, injects a
failure at each lifecycle checkpoint, and packages a provider-neutral contract
suite shared with E2B.

**Ticket non-goals:** real E2B/managed provider behavior; a second provider-driver
port (WRK-004 owns it); event/control **ingestion** on the control plane (E4/
JOB-005+); Toxiproxy fault scripting (DEP-005); image/compose packaging (DEP-001/
002).

**Files:**
- Create leaf `packages/sandbox-provider-contract/{package.json,tsconfig.json,
  vitest.config.ts}` and `src/{index.ts,vectors.ts,checkpoints.ts}` —
  `runSandboxProviderContract(makeDriver, options)` exporting the provider-neutral
  conformance suite (opaque provider IDs, no E2B fields; loads `GJ_FIXTURES` from
  `tests/fixtures/distributed-execution/` and the core/optional op vectors).
- Create leaf `packages/sandbox-fake-provider/{package.json,tsconfig.json,
  vitest.config.ts}` and `src/{index.ts,control-server.ts,fake-driver.ts,
  fixture-runtime.ts,invocation-ledger.ts}` — the loopback control server
  (`/script`,`/reset`,`GET /invocations`), the driver implementing WRK-004's port
  addressed by `providerId`, the fixture-step interpreter with per-checkpoint
  `failureInjection`, and the append-only ledger.
- Create `scripts/check-sandbox-fake-provider-boundary.mjs` (+ reuse
  `scripts/lib/worker-protocol-boundary.mjs` helpers) rejecting server/db/drizzle/
  tenant imports; wire into the `policy` job.
- Create tests: `packages/sandbox-fake-provider/src/__tests__/{fixture-determinism,
  reset-isolation,invocation-inspection,checkpoint-fault-injection}.test.ts`;
  `packages/sandbox-provider-contract/src/__tests__/contract-self.test.ts`
  (runs the suite against the fake in-process).

**Interfaces:** The driver honors the frozen `PROVIDER_OPERATIONS` vocabulary and
returns cleanup **status**, never throwing (`{cleanupStatus:"success"|"failed"}`
mirror). Control API: `POST /script {providerId, fixtureId}` (fail-closed on a
fixture that does not schema-validate), `POST /reset`, `GET /invocations →
{providerId, op, argsDigest, checkpoint, faultInjected, seq, ts}[]`. Every scripted
event carries a recomputed `eventDigest` (`verifyWorkerEventDigestV1`).

**Acceptance (incl. failure behavior):** a test addresses a fake by `providerId`,
scripts a fixture, and reads the exact invocation ledger; a fault injected at each
of the lifecycle checkpoints (`create/execute/event/hang/cancel/crash/checkpoint/
destroy`) yields the fixture's declared `failureInjection.effect` deterministically;
two replays of one fixture produce byte-identical ledgers and event digests;
`reset` restores zero invocations and, after `reconcile_cleanup`, `list`/`inspect`
reports **zero** provider resources; an unschema-valid fixture is **rejected**
(fail-closed) rather than partially scripted; an unknown op is rejected; the
boundary check proves **no** server/db/tenant import (no tenant code on the host
worker).

**Compatibility / rollback:** two additive leaf packages under `packages/*`
(auto-included by `pnpm-workspace.yaml`); no runtime wiring into server/db. Removing
them is inert. No migration.

**Observable signals:** the invocation ledger (per-op, per-checkpoint, fault flag,
seq); deterministic replay digests; the `list`/`inspect` zero-resource projection;
the boundary-check pass/fail line in `policy`.

**RED → GREEN:**
- RED: `fixture-determinism.test.ts` (two replays diverge before the runtime
  exists); `checkpoint-fault-injection.test.ts` (each checkpoint fault not yet
  honored); `reset-isolation.test.ts` (residual invocations/resources);
  `invocation-inspection.test.ts` (ledger missing/incomplete);
  `contract-self.test.ts` (core-op conformance unmet); boundary check RED if a
  forbidden import is present.
- GREEN: implement the two packages; run the DEP-000 focused command (local + CI)
  and the two leaf typecheck/build gates. Foundation checker stays green.

**Evidence / commit:** `tickets/DEP-000-result.md`; one commit
`feat(deploy-harness): deterministic fixture-driven fake sandbox provider`. Maps
E6F-02, E6F-05 (no-tenant-code seam).

**Internal TDD/commit slices (one ticket, one final reviewer):** A — the
provider-neutral contract package + core/optional op vectors + `contract-self`
against a minimal driver; B — the fake driver + fixture-step interpreter + per-
checkpoint `failureInjection` + event-digest recompute; C — networked control
server + invocation ledger + reset-isolation + boundary check. Each slice ≤1
agent-day and independently green; the distinct reviewer reruns the combined
suite and alone completes the ticket.

---

### DEP-001 — Separate signed control-plane and worker images (M, ≤3 agent-days, FOUNDATION)

**Depends on:** WRK-001 (worker package + entrypoint — **not built**, E4),
FND-005 (root build-input pinning — built). **Blocked on E4.**

**Outcome:** Pinned, non-root, read-only-root control-plane and worker images with
distinct dependencies/permissions, a minimum SBOM, source provenance, test-root
signing, and an admission verifier that D1 uses to accept only recorded signed
digests and reject tampered/unsigned ones.

**Ticket non-goals:** release-root signing, vulnerability policy, attestation
breadth (all REL-004); compose topology (DEP-002); the worker daemon's runtime
behavior (WRK-001/004).

**Files:**
- Create `docker/control-plane/{Dockerfile,entrypoint.sh}` — server+UI, pinned
  base **by digest**, non-root, read-only root, `HEALTHCHECK /api/health`, OCI
  revision/version/source labels; **no** docker-cli/worker/agent CLIs.
- Create `docker/worker/{Dockerfile,entrypoint.sh}` — `packages/worker-daemon` daemon
  only, pinned base by digest, non-root, read-only root, local health/metrics;
  **no** UI/server/db/drizzle.
- Create `docker/images/{build.sh,sbom.sh,sign.sh,allowlist.json,provenance.sh}`
  (reproducible build, min SBOM, test-root cosign signing, recorded signed digests,
  provenance label injection).
- Create `scripts/verify-image-admission.mjs` + pure `scripts/lib/image-admission.mjs`
  (verify signature+provenance against the test root; admit only allowlisted
  digests; reject tampered/unsigned fail-closed).
- Modify `.github/workflows/pr.yml` Dockerfile-deps validator to cover both new
  Dockerfiles (each `deps` stage copies exactly its dependency closure); wire the
  admission-lib test into `policy` and the image jobs into DEP-004's lanes.
- Create tests: `scripts/lib/__tests__/image-admission.test.mjs` (node --test:
  allow recorded digest, reject tampered digest, reject unsigned, provenance
  mismatch); `docker/images/__tests__/{image-contents,image-startup-smoke}.test.mjs`
  (assert tooling exclusion, non-root user, read-only root, health/version/source
  metadata, reproducible source linkage — **built-image lane, Linux/CI only**).

**Interfaces:** `image-admission.mjs` → `evaluateAdmission({digest, signature,
provenance, allowlist, trustRoot}) → {admitted:boolean, reason}`. Images expose
`org.opencontainers.image.revision` = recorded source SHA; `/api/health` (control
plane) and local `/metrics`/`/health` (worker).

**Acceptance (incl. failure behavior):** the control-plane image contains **no**
Docker or worker tooling and the worker image contains **no** UI/server/DB
tooling (image-contents test); both run non-root on a read-only root; both expose
health/version/source metadata; the admission verifier **admits** a recorded
signed digest and **rejects** one tampered digest and one unsigned digest
(fail-closed, non-zero); a build missing the provenance label **fails**; a
worker-image `deps` stage that would pull server/db **fails** the extended
deps-validator.

**Compatibility / rollback:** additive `docker/control-plane/`, `docker/worker/`,
`docker/images/`, and one CI validator extension; the combined `Dockerfile` and
`docker.yml` are untouched (REL-004 owns the release cutover). Test roots only —
never release trust. No migration.

**Observable signals:** SBOM artifacts per image; the signed-digest allowlist; the
admission verifier's admit/reject reason lines; image labels (revision/version/
source); the deps-validator pass/fail.

**RED → GREEN:**
- RED: `image-admission.test.mjs` (tampered/unsigned currently admitted or
  verifier absent); `image-contents.test.mjs` (combined tooling still present /
  images not yet split); startup-smoke RED (no image).
- GREEN: author both Dockerfiles + supply-chain scripts + admission lib; run the
  local admission lane always, and the **Linux/CI** image build+contents+smoke
  lane. Extend and keep the deps-validator green.

**Evidence / commit:** `tickets/DEP-001-result.md`; one commit
`feat(deploy-harness): split signed least-privilege control-plane and worker images`.
Maps E6F-06, E6F-05 (topology least-privilege inputs).

**Internal TDD/commit slices:** A — control-plane image + entrypoint + deps-
validator extension + contents test; B — worker image + boundary/deps closure +
contents test; C — SBOM/provenance/test-root signing + admission verifier +
allow/deny + startup smoke. Each ≤1 agent-day, independently green; one distinct
reviewer completes.

---

### DEP-002 — D1 Docker Compose topology (M, ≤3 agent-days, FOUNDATION)

**Depends on:** DEP-000, DEP-001, TEN-002 (tenant kernel — passed).

**Outcome:** An isolated-network Compose stack with PostgreSQL, MinIO, one
control-plane replica, ≥2 workers with distinct registered profiles, the fake
provider, Toxiproxy, and a test runner; no shared writable volume; worker cannot
reach PostgreSQL; control plane reaches provider control only through declared
APIs; deterministic startup.

**Ticket non-goals:** the migration job/readiness gate content (DEP-003 provides
the `migrate` service body + readiness); Toxiproxy fault campaigns and clock
control (DEP-005/006); the CI merge-train job (DEP-004); the second control-plane
replica (DEP-009).

**Files:**
- Create `docker-compose.d1.yml` (`name: aoa-d1`) — the four segmented networks
  and the services in §2.3; `depends_on: {condition: service_healthy}`; per-service
  named volumes / read-only mounts; consumes only DEP-001 admitted image digests.
- Create `docker/d1/{.env.example,toxiproxy.json,worker-a.profile.json,
  worker-b.profile.json,minio-init.sh,README.md}` — env, proxy definitions,
  two **distinct** registered target profiles, MinIO bucket bootstrap.
- Create `scripts/check-d1-compose.mjs` + pure `scripts/lib/d1-compose-invariants.mjs`
  (static: assert network attachment matrix, no worker on `data-net`, no shared
  `rw` volume, control-plane→provider-control not wired, images are admitted
  digests) — runnable **locally**.
- Create tests: `scripts/lib/__tests__/d1-compose-invariants.test.mjs` (node
  --test, local); `tests/d1/network-denial.test.mjs` and
  `tests/d1/fake-provider-job.test.mjs` (**Linux/CI, compose up**: worker→postgres
  TCP refused; control-plane→fake control endpoint refused but declared API
  reachable; one submit→placement→lease→ACK→fake-execute job succeeds).

**Interfaces:** `d1-compose-invariants.mjs` →
`evaluateComposeInvariants(parsedCompose) → {violations: string[]}` (empty =
pass). Worker profiles are `registeredTargetProfileV1`-shaped and distinct
(different capability/slot/locality mix so placement can pick between them).

**Acceptance (incl. failure behavior):** the static validator passes on the
committed compose and **fails** if a worker is attached to `data-net`, if two
services share an `rw` volume, if the control-plane is wired to the provider
control endpoint, or if any image is an unadmitted digest; live, a worker's TCP
connect to `postgres:5432` is **refused**, the control-plane's connect to the fake
control endpoint is **refused** while its declared API is reachable, and one
fake-provider job completes end to end; startup is deterministic (no service
serves before its `service_healthy` deps).

**Compatibility / rollback:** additive `docker-compose.d1.yml` + `docker/d1/` +
one static validator; existing compose files untouched; the stack is dormant until
explicitly brought up. No migration.

**Observable signals:** `docker compose config` render; the invariant validator's
violation list; per-service health transitions; the network-denial test outcomes;
the single fake-provider job's terminal state.

**RED → GREEN:**
- RED: `d1-compose-invariants.test.mjs` against a deliberately-wrong fixture
  compose (worker on `data-net`, shared volume) must flag violations before the
  lib exists; `network-denial.test.mjs`/`fake-provider-job.test.mjs` RED with no
  stack.
- GREEN: author `docker-compose.d1.yml` + `docker/d1/*` + the invariant lib; run
  the local static lane always and the **Linux/CI** live lane.

**Evidence / commit:** `tickets/DEP-002-result.md`; one commit
`feat(deploy-harness): isolated D1 compose topology with network-denial proofs`.
Maps E6F-03, E6F-05, E6F-01 (two-profile placement substrate).

**Internal TDD/commit slices:** A — networks/services/volumes + static invariant
lib + wrong-fixture RED; B — two distinct worker profiles + fake-provider + MinIO
init + admitted-image wiring; C — Toxiproxy in-path + live network-denial + one
fake-provider job. Each ≤1 agent-day; one distinct reviewer completes.

---

### DEP-003 — Migration job and readiness contract (M, ≤3 agent-days, FOUNDATION)

**Depends on:** DEP-002, TEN-001 (passed).

**Outcome:** Privileged migrations separated from application startup; distinct
liveness/readiness/dependency health; and the preserved fail-closed populated-
instance migration-0188 snapshot/marker preflight (operator opt-in + candidate
SHA, snapshot-before-marker, checksum + isolated restore-validation, marker
verify, idempotent).

**Ticket non-goals:** rewriting migration `0188` itself; enabling any real
Organization/workload cutover (E10 MIG owns authority transfer); dropping the
sentinel org (`0210`); worker-daemon health internals (WRK-001).

**Files:**
- Create `packages/db/src/schema/distributed_cutover_markers.ts` + export in
  `schema/index.ts`; generate the normal migration + the custom RLS migration
  (slug **`distributed_cutover_marker`**; `aoa_operator` write, `aoa_app` read,
  tenants none; C14/Decision #122 idempotent role/GRANT/ENABLE/FORCE/POLICY only).
- Create `packages/db/src/migrate-job.ts` (privileged, idempotent, non-destructive
  migration runner, distinct from `src/migrate.ts` app path) and
  `docker/control-plane/migrate-entrypoint.sh`.
- Create `server/src/services/cutover-0188-preflight.ts` (orchestrator; injected
  object-store + pg-dump/restore ports) and `server/src/services/
  cutover-0188-preflight-state.ts` (pure fail-closed state machine).
- Create `server/src/services/schema-compatibility.ts` (compare applied migration
  identity vs `loadRequiredMigrationIdentity()`); create
  `server/src/routes/readiness.ts` (`/api/ready`); modify
  `server/src/routes/health.ts` (add `/live` liveness; keep `/api/health`) and add
  a readiness-gate middleware in `server/src/app.ts` that 503s tenant/app routes
  until ready.
- Create tests: `server/src/__tests__/cutover-0188-preflight.test.ts` (pure:
  no-opt-in, snapshot failure→no marker, checksum mismatch, isolated restore-
  validation failure, marker-write failure, marker-verify failure, idempotent
  repeat, unavailable object store/provider); `server/src/__tests__/
  readiness-liveness.test.ts` (liveness up while readiness down; dependency
  health); `packages/db/src/__tests__/distributed-cutover-marker-schema.integration.test.ts`
  (embedded PG: marker table + RLS matrix); `server/src/__tests__/
  migration-readiness.integration.test.ts` (old schema→503, new→ready; failed
  migration non-destructive; app startup never writes the marker);
  `server/src/__tests__/migration-rollback-startup.integration.test.ts`
  (incompatible newer schema → refuse serve).

**Interfaces:** `cutover-0188-preflight-state.ts` → a deterministic transition
function over `{optIn, candidateSha, imageSha, snapshotResult, checksumResult,
restoreValidationResult, markerWriteResult, markerVerifyResult}` →
`{action:"proceed"|"stop", markerWritten:boolean, reason}`. Readiness →
`{live:true, ready:boolean, schemaCompatible:boolean, dependencies:{postgres,
minio}}`. Marker row: `{candidateSha, snapshotRef, snapshotChecksum, verifiedAt}`.

**Acceptance (incl. failure behavior, verbatim contract):** the control plane does
**not** serve before a compatible schema (readiness 503, not crash); worker
readiness requires valid session/provider health; failed migrations do **not**
loop destructively (idempotent, bounded, fail-closed exit). The first populated
single-tenant→`cloud_auth` flip requires **explicit operator intent + exact
candidate SHA**, takes and **checksum-validates** a snapshot **before** writing the
durable `0188` marker, **validates that snapshot by restoring it to an isolated
pre-cutover database**, **verifies the marker**, and is **idempotent**. Missing
opt-in, snapshot/restore-validation failure, marker-write failure, or verification
failure **stops before deployment/cutover with no marker written**; **application
startup cannot auto-bypass** the gate (startup reads, never writes/synthesizes,
the marker). Unavailable object store/provider → stop, no marker. Rollback-startup:
an incompatible newer schema refuses to serve.

**Compatibility / rollback:** additive marker table + custom RLS migration + two
readiness routes + one startup middleware; the preflight is **opt-in** and dormant
unless the operator sets opt-in + candidate SHA; single-tenant deployments never
trigger it; `pnpm db:migrate` behavior for non-cutover migrations is unchanged;
flag-off leaves app startup unchanged except the additive readiness split.

**Observable signals:** `/api/ready` JSON (ready/schemaCompatible/dependencies);
the migration-job exit code + step log (opt-in → snapshot → checksum → restore-
validate → marker-write → marker-verify); the durable marker row; the readiness-
gate 503s while incompatible.

**RED → GREEN:**
- RED: `cutover-0188-preflight.test.ts` (each fail-closed case currently proceeds
  or writes a marker); `readiness-liveness.test.ts` (readiness not distinguished);
  `distributed-cutover-marker-schema.integration.test.ts` (table/RLS absent);
  `migration-readiness.integration.test.ts` (serves before compatible schema; app
  startup writes marker); `migration-rollback-startup.integration.test.ts`
  (serves on incompatible newer schema).
- GREEN: schema + custom RLS migration (generate via the C14 recipe), migrate-job
  entrypoint, preflight state machine + orchestrator, schema-compat + readiness
  routes + startup gate. Run the DEP-003 pure lane locally, the embedded-PG lane
  via `Invoke-E3Integration`, and the live migration-job container on **Linux/CI**.

**Evidence / commit:** `tickets/DEP-003-result.md`; one commit
`feat(deploy-harness): privileged migration job, readiness contract, and 0188 cutover preflight`.
Maps E6F-07, E6F-03 (readiness in the smoke).

**Internal TDD/commit slices:** A — liveness/readiness/dependency split + schema-
compatibility serving gate; B — privileged migration-job entrypoint separated from
app startup + marker schema/RLS; C — the fail-closed 0188 preflight state machine +
snapshot/checksum/isolated-restore-validation/marker-verify + idempotent repeat.
Each ≤1 agent-day; one distinct reviewer completes.

---

### DEP-004 — Focused and merge-train CI lanes (M, ≤3 agent-days, FOUNDATION)

**Depends on:** FND-005 (passed), DEP-002.

**Outcome:** Path-filtered unit/contract jobs whose protocol/schema paths trigger
their mandatory consumers, plus a D1 distributed merge-train job that retains
distributed logs, events, database state, and object manifests on failure.

**Ticket non-goals:** release/publish workflows (`release.yml`/`docker.yml` stay
as-is); the full D1 fault volume (owning tickets + D1); adding a trigger-level
`paths:` filter (forbidden — routes through `ci-required`).

**Files:**
- Modify `.github/workflows/pr.yml`: extend the `changes` job to emit `protocol`,
  `schema`, `fixtures`, `provider`, `compose` path-class outputs; add a
  `distributed-contract` job (runs the DEP-000 contract + fixture-determinism +
  foundation checker + DEP-003 preflight suites) gated on those classes; add it to
  `ci-required.needs` and to the aggregator verdict (required **only when** its
  class changed, mirroring the `code`-gated pattern).
- Create `.github/workflows/d1-merge-train.yml` (`merge_group` + push-to-main):
  bring up `docker-compose.d1.yml`, run a bounded E6F subset, upload the evidence
  bundle on failure via `actions/upload-artifact`.
- Create `scripts/collect-d1-evidence.mjs` + pure `scripts/lib/d1-evidence-bundle.mjs`
  (assemble logs/events/DB-state/object-manifest bundle) and
  `scripts/check-ci-lanes.mjs` + pure `scripts/lib/ci-lanes.mjs` (assert every
  protocol/schema/provider path class maps to a mandatory consumer in
  `ci-required`, no trigger-level `paths:`/`paths-ignore:`, merge-train uploads
  the required evidence on failure).
- Create the deliberate-failing-fixture proof: `tests/d1/fixtures/
  deliberate-failure.mjs` + `tests/d1/evidence-retention.test.mjs` (assert the
  evidence bundle is assembled on failure).
- Create tests: `scripts/lib/__tests__/{ci-lanes,d1-evidence-bundle}.test.mjs`
  (node --test, local: valid config passes; a protocol path with no consumer
  fails; a trigger-level `paths:` fails; a merge-train missing evidence-upload
  fails; the bundle contains logs/events/DB-state/object-manifest sections).

**Interfaces:** `ci-lanes.mjs` → `evaluateCiLanes({workflows, requiredNeeds}) →
{violations: string[]}`. `d1-evidence-bundle.mjs` → `buildEvidenceBundle(inputs) →
{sections:{logs,events,dbState,objectManifests}, manifest}`.

**Acceptance (incl. failure behavior):** a protocol/schema/provider path change
triggers `distributed-contract`, and `ci-required` marks it required for that PR; a
docs-only PR skips it (and `ci-required` allows the skip); the static ci-lanes
validator **fails** if a protocol/schema path has no mandatory consumer, if any
trigger-level `paths:`/`paths-ignore:` is present on `pr.yml`, or if the merge-train
lacks evidence-upload-on-failure; the deliberate-failing fixture turns the
merge-train red and the evidence bundle (distributed logs, events, DB-state,
object manifests) is **retained**.

**Compatibility / rollback:** additive `changes` outputs, one new conditional job
routed through `ci-required`, one new workflow, and static validators; no
trigger-level path filter; `release.yml`/`docker.yml` untouched. No migration.

**Observable signals:** the `changes` path-class outputs; `ci-required`'s verdict
line naming `distributed-contract`; the merge-train artifact bundle on failure; the
ci-lanes validator's violation list.

**RED → GREEN:**
- RED: `ci-lanes.test.mjs` (a fixture workflow with an unconsumed protocol path /
  a trigger-level `paths:` / a merge-train missing evidence-upload must flag
  violations before the lib exists); `d1-evidence-bundle.test.mjs` (bundle missing
  a required section); `evidence-retention.test.mjs` RED with no collector.
- GREEN: extend `changes`; add `distributed-contract` + wire `ci-required`; author
  `d1-merge-train.yml` + evidence collector; author the validators. Run the local
  pure lane always; prove the merge-train + deliberate-failing fixture on
  **Linux/CI**.

**Evidence / commit:** `tickets/DEP-004-result.md`; one commit
`feat(deploy-harness): path-filtered contract lanes and D1 merge-train with retained evidence`.
Maps E6F-07 (retained failure evidence), and the CI substrate for E6F-01..06.

**Internal TDD/commit slices:** A — `changes` path-class extension + static
ci-lanes validator + node --test; B — `distributed-contract` mandatory-consumer
job + `ci-required` wiring; C — `d1-merge-train.yml` + evidence collection/
retention + deliberate-failing-fixture proof. Each ≤1 agent-day; one distinct
reviewer completes.

---

## 4b. M0 disposition-B evidence-currency tasks

> **Added 2026-09-21 (M0 unit 3).** `scope-triage.md`'s `M0` exit requires *"an approved,
> candidate-current result for every disposition-B ticket"*, and `qa-handoff-recovery.md` section 2
> forbids treating a prose `LANDED` / `complete` header as canonical approval. E6 owns two B
> tickets and the epic-implementation-plan wave (PR #524) did not cover E6, so neither had a task.
> A required result with no task cannot be produced, which is why M0 files these before building —
> the same Step-0 shape `M1a` has.

### `TRACK-002-B1` - current census evidence on the milestone candidate (S, <=1 agent-day, M0)

**Disposition:** B. **Depends on:** nothing. **Already built:**
[`tickets/TRACK-002-result.md`](./tickets/TRACK-002-result.md) records `Status: LANDED` -
`scripts/check-execution-census.mjs` plus pure logic and 13 unit tests, wired into the `policy` job.
Re-measured at this tip: the guard runs and exits 0. **Nothing here is a rebuild.**

★★★ **AND THE RE-MEASURE HAS ALREADY FOUND ITS DELTA, so this task starts from a known one rather
than from a hope.** The result doc records the manifest as **"48 files - 44 running, 4 unrun"**. At
`169be1f2c` the guard reports **70 `*.test.mjs` on disk, 67 declared running, 3 declared unrun**,
across 28 packages with vitest specs of which 25 own a vitest config, among 29 projects. The
mechanism is intact; the *numbers* in the record are stale, which is precisely the condition an
evidence-currency record exists to correct.

**Outcome:** a committed re-measure on the exact milestone candidate carrying the current counts,
confirming the guard is still wired into `policy`, still declared in `guard-inventory.json`, and
that every `*.test.mjs` on disk is still declared either `runs` (naming a workflow + step, verified
against that step's `run:` block) or `unrun` (with a reason). Exit criterion 1 can then cite a
current record instead of a landed-once one.

★ **Carry the guard's own caveat verbatim into the record.** It prints it: *"'runs' means the
declaration still matches the tree, NOT observed execution"*. A currency record that quotes the
count without the caveat would upgrade a declaration check into an execution claim - this
programme's most repeated failure class, one register over.

**Ticket non-goals:** changing the manifest's declarations; wiring a currently-`unrun` file; adding
a package to `vitest.config.ts`'s `projects[]`; making the guard assert observed execution.

**Files:** `tickets/TRACK-002-B1-result.md`. `TRACK-002-result.md` is `LANDED`, so it is **not**
edited - a correction gets a new ticket and a new record. No source file changes expected.

**Interfaces:** unchanged.

**Failure behavior:** if a `*.test.mjs` is found undeclared, or a declared-`runs` file names a step
whose `run:` block no longer invokes it, the ticket **stops** and files an E6 finding rather than
amending the manifest to match - amending it is how a census stops being a census.

**Migration/compatibility / rollback:** documentation only; revert the commit.

**Observability:** the record must state both the old and new counts and say plainly that the
difference is tree growth, not a regression, if that is what the measurement shows.

**RED -> GREEN:** RED is the positive control the guard already supports - introduce a deliberately
undeclared `*.test.mjs` and observe the guard fail, then remove it. GREEN is
`node scripts/check-execution-census.mjs` exiting 0 with the counts recorded verbatim.

**Evidence / commit:** `tickets/TRACK-002-B1-result.md`; one documentation commit
`docs(e6): re-measure the execution census on the M0 candidate`.

---

### `DEP-008-B1` - current isolation-conformance evidence on the milestone candidate (S, <=1 agent-day, M0)

**Disposition:** B. **Depends on:** nothing. **Already built:**
[`tickets/DEP-008-result.md`](./tickets/DEP-008-result.md) records `Status: complete` /
`Disposition: pass` - `runSandboxIsolationConformance` with 8 hostile checks, a separate
`HostileSandboxProvider` reference driver, and 9 sabotage tests each asserting the target's failure
*reason*. Production wiring re-measured at this tip: exported from
`packages/sandbox-provider-contract/src/index.ts:36`, defined at
`src/isolation-contract.ts:89`, and **consumed** at
`packages/sandbox-e2b-provider/src/__tests__/conformance.test.ts:46`. It is not a zero-caller
suite. **Nothing here is a rebuild.**

**Outcome:** a committed re-measure on the exact milestone candidate showing the eight hostile
checks are all still present and still paired with a sabotage mutant that must fail them, and
restating the ticket's own `CI caveat` in current terms: the live `tests/d1/e6f-08-*.mjs` probes
are Docker/CI-only and have no Windows-local substitute (DEC-03).

★ **The acceptance boundary must be restated, not softened.** `DEP-008-result.md` says E6 certifies
*"the suite + hostile reference over the frozen invoke-driver port - NOT E2B and NOT any real
adapter"*. The currency record repeats that limit in its own words; a record that omits it would
read as isolation proof against a real provider, which no evidence here supports.

**Ticket non-goals:** running the hostile suite against real E2B; adding a ninth check; changing
`HostileSandboxProvider`; re-opening the two finder framings the adversarial review correctly
refuted (the section 2.6 "circular egress check" and the "params-handshake overclaim").

**Files:** `tickets/DEP-008-B1-result.md`. `DEP-008-result.md` is `complete` and therefore **frozen**
- a correction is a finding plus a new ticket, never an edit. No source file changes expected.

**Interfaces:** unchanged.

**Failure behavior:** if a sabotage mutant no longer reds its target check, that is a **vacuous
test** and the ticket stops and files an E6 finding. A check that cannot fail is the thing this
programme counts as not existing.

**Migration/compatibility / rollback:** documentation only; revert the commit.

**Observability:** the record names the exact focused command and its exit code, and states the
Docker/CI-only probes as unrun-here rather than passing.

**RED -> GREEN:** RED is a sabotage mutant reddening its paired check (the suite ships nine of
them; run them, do not assume them). GREEN is the focused conformance suite passing with its counts
recorded.

**Evidence / commit:** `tickets/DEP-008-B1-result.md`; one documentation commit
`docs(e6): re-measure the sandbox isolation conformance suite on the M0 candidate`.

---

## 4c. M1a tasks — filed at M1 Step 0 (S0-3)

*Filed 2026-09-21 from `docs/replatform/qa/2026-09-21-m1-execution-plan.md` §4 (founder-approved,
F10 overruled to **multi-tenant**). Every file path below was checked to exist at the program tip
`1cc7e2fdb`, or is marked **create**. Line numbers are hints; re-find by symbol. §3's protocol
applies: a distinct reviewer alone sets `complete`.*

★ **What these replace.** `scope-triage.md`'s `M1a` result set carried two rows with no id —
*"DEP-011's remaining deploy half"* and *"the parity bridges + the usage producer"* — and a
campaign that no ticket owned. `DEP-014` + `DEP-015` are the deploy half; `DEP-016`, `DEP-017` and
`DEP-018` are the campaign's harness. **The daemon consumer is not among them because it is built:**
`packages/worker-networked-host/src/bin/networked-host.ts` (DEP-011 Slice 2b-ii) ships inert.

★ **`DEP-019` was filed LATER, on 2026-09-23, and is not one of the S0-3 four.** It was filed by
the M1 planning session under founder delegation F2 after the distinct reviewer of `DEP-016` found
that `M1-D1-SPINE`'s worker clause is not satisfiable from that profile alone: its deployed worker
is present but its journey is harness-driven. `DEP-019` closes exactly that gap and nothing more,
and it carries `DEP-016` acceptance item 6 with it — the item that was discharged by the
“the reference provider runs no command” fork, which `DEP-019` removes.

★★★ **M1 IS MULTI-TENANT (founder ruling F10).** Every campaign runs **at least three
Organizations**: two enabled through the existing per-Organization rollout policy
(`AOA_DISTRIBUTED_EXECUTION_ROLLOUT`, parsed by `parseDistributedExecutionRolloutMap` in
`server/src/config/distributed-execution-rollout-source.ts`) and one **not** enabled, as the control.
Isolation runs through the non-owner `aoa_app` pool with RLS, which flag-on already provisions
(`maybeProvisionDistributedExecutionRoles` in `server/src/index.ts`). No lane, fixture or profile
in this section may seed a single Organization. The live D1 tenancy suite
`tests/d1/e6f-04-tenancy.test.mjs` is the existing precedent to build on.

**Registration rules these tickets inherit (each one reds `policy` if skipped):** a new workflow file
needs an entry in `scripts/workflow-verdict-manifest.json` (DEP-013's consumer; every declared branch
its own); a new `*.test.mjs` needs a `runs`/`unrun` declaration in `scripts/test-execution-census.json`
(TRACK-002); a new guard is declared in `scripts/guard-inventory.json` and wired into the `policy` job;
only `ci-required` is a required check (`scripts/lib/ci-lanes.mjs`), so no new job becomes one.

### DEP-014 — The adapter-manager image in the signed image build, admitted in CI; NOT pushed (M, ≤3 agent-days, M1a)

**Depends on:** DEP-001 and DEP-012 (shipped).

**Current state, measured:** `build_one()` in `docker/images/build.sh` builds **two** images —
`control-plane` (`docker/control-plane/Dockerfile`) and `worker` (`docker/worker/Dockerfile`) —
with `--provenance=true --sbom=true`, writing `docker/images/<name>.metadata.json` and appending to
`docker/images/digests.env`. `docker/images/sbom.sh`, `sign.sh` (test-root signing into
`docker/images/allowlist.json` via `scripts/lib/image-admission.mjs`) and `provenance.sh` follow.
`docker/adapter-manager/Dockerfile` exists, but the **only** build of it is
`.github/workflows/deploy-replatform-campaign.yml` (`docker build … -f docker/adapter-manager/Dockerfile
-t aoa-adapter-manager:campaign`), which is `workflow_dispatch` to the operator's staging host.
`docker-compose.staging.yml` names `aoa-adapter-manager:staging` for a service nothing builds in CI,
and `docker-compose.d1.yml` has no adapter-manager service.

**Outcome:** the adapter-manager is a third image in the same signed build — built, digested, SBOM'd and
admitted in CI; **NOT pushed** — and the D1 train builds it on every run. Nothing is deployed or published
by this ticket.

**★ Amended 2026-09-21 — the push is DESCOPED** (decided under founder delegation F2 (M1 planning session, 2026-09-21), after DEP-014's build measured that no push mechanism exists for any of the three split images). Superseded text: title *"…in the signed
image build, pushed by CI"*; outcome *"digest, SBOM, provenance, admission — pushed by CI, and the D1 train
builds it on every run"*. Founder ruling **F3** has the shipped CI boot (`DEP-015`) **build** all three
images from source, so nothing in M1 consumes a pushed tag. No push mechanism exists for the control-plane
or worker image either (the only push in the repository, `docker.yml`, publishes the combined image), and
adding GHCR login + `packages: write` to D1 or a new publish lane is an outward-facing publication decision —
pre-checkpoint publication must be deliberate and authorized, never a side effect. Publishing all three split
images belongs to the **M5 release lane** at the integration checkpoint.

**Acceptance:**
1. `build.sh` emits an adapter-manager digest, metadata, SBOM and admission entry beside the other two.
2. Admission (`scripts/verify-image-admission.mjs`) rejects a tampered or unsigned adapter-manager
   digest — the **positive control**.
3. Image-content assertions: no `E2B_API_KEY` baked in, no server/UI/database tooling, non-root; the
   provider SDK is present only in the adapter-manager image (matching
   `checkProviderControlBoundary` in `scripts/lib/staging-manifest-invariants.mjs`).
4. `d1-merge-train.yml` builds the image on every run it runs.

**Ticket non-goals:** pushing or publishing any image (M5 release lane; F2 ruling above); booting the adapter-manager (that is `DEP-015`); the control-plane keypair;
mTLS on worker→adapter-manager (M1 plan §8); release-root signing (REL-004).

**Files:** `docker/images/build.sh`, `docker/images/sbom.sh`, `docker/images/sign.sh`,
`docker/images/provenance.sh`; `docker/adapter-manager/Dockerfile` only if an image-content assertion
reds; `.github/workflows/d1-merge-train.yml` (build step); the image-content and admission tests the
D1 lane already runs for the two existing images, extended to three (`scripts/verify-image-admission.mjs`,
`scripts/check-release-admission.mjs`).

**Interfaces:** `digests.env` gains an `ADAPTER-MANAGER_IMAGE` key in the existing `${name^^}` form;
consumers read it by that key.

**Failure behavior:** a failed build or admission fails the lane; no fallback to an operator-built
image.

**Migration/compatibility / rollback:** CI-only; revert the build step.

**Observability:** the digest, SBOM and admission record in the lane's evidence.

**Focused verify command:** see the `DEP-014` row in §3.

**RED → GREEN:** RED — the admission check for an adapter-manager digest fails today (no entry);
positive control — a tampered digest is refused; GREEN — all three images built, signed and admitted
in one D1 run.

**Evidence / commit:** `tickets/DEP-014-result.md` citing the D1 job (not only the run id); one commit
`ci(images): build, sign and admit the adapter-manager image`.

---

### DEP-015 — The shipped CI boot lane (M, ≤3 agent-days, M1a)

**Depends on:** `DEP-014`; DEP-011 (the consumer, built); founder ruling **F3** — ruled 2026-09-21,
which is this ticket's specification. **Keyed:** yes, inside the F8 envelope.

**F3, verbatim in substance:** a **dispatch-only** CI job, never on push, bound to a named candidate,
that on the frozen candidate **builds** the control-plane, worker and adapter-manager images from
source and boots them together with a **CI-generated control-plane keypair**. The journey then runs in
that boot, in a keyed lane. **Not** the operator campaign deploy. Boot-only is too weak: the gate asks
for a journey.

**Current state, measured:** `checkDispatchDefaultOff` (`scripts/lib/staging-manifest-invariants.mjs`)
rejects any worker service that declares `AOA_WORKER_DISPATCH_ENABLED`, `AOA_WORKER_SANDBOX_PROVIDER`
or `AOA_WORKER_PROVIDER_URL` (`DISPATCH_SWITCH_ENVS`) as a "DISPATCH-DEFAULT VIOLATION". The
consumer bin exists (`networked-host.ts`, which reads `AOA_WORKER_PROVIDER_URL` through
`resolveProviderUrl`) and runs only in the operator's `docker/campaign/docker-compose.campaign.yml`.
**No workflow runs `pnpm verify:e7-1-distributed-run`** (`server/src/cli/verify-e7-1-distributed-run.ts`);
it is run by hand today. The adapter-manager bin fail-closes without the control-plane public key.

**Outcome:** **create** `.github/workflows/m1-shipped-boot.yml` — `on: workflow_dispatch` only, with
a required candidate input — that checks out the candidate, builds the three images from its source,
generates a control-plane keypair inside the job, boots the stack with a **worker provider-URL
overlay** (**create** an overlay compose file beside `docker-compose.staging.yml`) that runs
`networked-host.js` with `AOA_WORKER_PROVIDER_URL` set, seeds the F10 Organization set through the
rollout policy, runs the journey, and runs `pnpm verify:e7-1-distributed-run` on a run it executed.
`checkDispatchDefaultOff` is amended **for that overlay only**.

**Acceptance:**
1. One dispatched run on a named candidate builds all three images from that candidate, boots them,
   runs the journey and records the verifier's verdict; `capabilityProven=false` is acceptable for
   `M1a` (the verdict recorded is the mechanism verdict).
2. The keypair exists only inside that job and appears in no artifact or log.
3. The default-off invariant still reds on **every** manifest except the overlay — **positive
   control**: the same env on the base `docker-compose.staging.yml` reds.
4. A workflow-shape guard proves the job cannot run on `push`/`pull_request`/`schedule` and refuses
   to start without a candidate input; the guard itself has a positive control (a re-added `push`
   trigger reds it).
5. Keyed spend happens only inside the F8 envelope, on a named candidate.
6. **Multi-tenant (F10):** the boot seeds two enabled Organizations and one control Organization;
   the journey runs for each enabled tenant; the control tenant's run stays on the legacy path.
   ★ *Made explicit at M1 Step 0 (S0-8):* the seeding **is** `AOA_DISTRIBUTED_EXECUTION_ROLLOUT`
   (`DISTRIBUTED_EXECUTION_ROLLOUT_ENV`, `server/src/config/distributed-execution-rollout-source.ts`)
   on the control-plane service, naming the two enabled Organizations in `organizations` and
   **omitting** the control Organization (absent from the map = `off`). Neither
   `docker-compose.staging.yml` nor `docker-compose.d1.yml` sets it today (both set only
   `AOA_DISTRIBUTED_EXECUTION_ENABLED`; verified), so the overlay or the job must.
7. **Crew switch off.** *Added at S0-8 (F2 delegation):* the boot asserts
   `AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED` is unset or false on every control-plane service — it is
   deployment-wide (`readDistributedCrewRolloutFlag`, `server/src/config/distributed-execution.ts`),
   so on it would arm crew for both enabled tenants at once — and records the assertion in the
   retained evidence, matching the M1 plan's §6 freeze checklist.

**Ticket non-goals:** the operator campaign deploy (unchanged); mTLS worker→adapter-manager (M1 plan
§8, a named residual); promoting `E7-1-coding-journey` (that is `E7-1-JOURNEY-ARM`, which consumes
this lane's run); a required check.

**Files:** **create** `.github/workflows/m1-shipped-boot.yml`; **create** the worker provider-URL
overlay compose file; `scripts/lib/staging-manifest-invariants.mjs` (the scoped amendment) and
`scripts/check-staging-manifest.test.mjs` (its positive control); **create**
`scripts/check-m1-shipped-boot-shape.mjs` + its `.test.mjs` (the workflow-shape guard, declared in
`scripts/guard-inventory.json` and wired into `policy`); `scripts/workflow-verdict-manifest.json`
(the new workflow's entry); `scripts/test-execution-census.json` (the new `.test.mjs`).

**Interfaces:** the workflow's `candidate` input; the overlay's env contract
(`AOA_WORKER_PROVIDER_URL`, the control-plane public key path).

**Failure behavior:** any build, admission, boot or verifier failure fails the job with evidence
retained; the job never falls back to a pre-built image.

**Migration/compatibility / rollback:** CI and manifests only; delete the workflow and the overlay.

**Observability:** retained evidence on pass and fail — image digests, boot logs (redacted), the
verifier's RESULT line and exit code.

**Focused verify command:** see the `DEP-015` row in §3.

**RED → GREEN:** RED — the scoped amendment's positive control (base manifest still reds) and the
shape guard's positive control; GREEN — both guards and the staging-manifest self-test pass, then one
dispatched keyed run recorded as the acceptance evidence.

**Evidence / commit:** `tickets/DEP-015-result.md` citing the dispatched job; commits
`ci(m1): a dispatch-only shipped CI boot lane` and the guard commit.

---

### DEP-016 — The `m1-spine` campaign profile on the D1 compose (M, ≤3 agent-days, M1a)

**Depends on:** `JOB-016` and `JOB-017` merged; DEP-004 (shipped).

**Current state, measured:** `d1-merge-train.yml` runs `docker-compose.d1.yml` — postgres, minio,
toxiproxy, migrate, two control-plane replicas, `worker-a`, `worker-b`, `fake-provider`,
`test-runner`. Evidence is collected (`scripts/collect-d1-evidence.mjs`) and uploaded **only under
`if: failure()`**. The campaign scope is `AOA_D1_CAMPAIGN=bounded|foundation` in
`docker/d1/campaign.env`; there is **no `m1-spine` scope**. The fake provider
(`packages/sandbox-fake-provider`, served by `docker/d1/fake-provider-entry.mjs`) replays fixture
`expectedEvents` from `tests/fixtures/distributed-execution/*.json`; it has **no usage-specific
code**, so canned usage must be a scripted `usage` event in a fixture (the protocol's
`usagePayloadV1Schema`), verified before relying on it.

**Outcome:** an `m1-spine` profile: one worker, evidence retained **on pass**, the reference provider
emitting **canned usage**, and assertions that each priced attempt produced exactly one `cost_events`
row with cost > 0 and the named audit rows. It is the harness the `M1-D1-SPINE` gate record is made
from, including the rollback rehearsal through the `MIG-009` CLI.

★ *Amended 2026-09-23 (F2), NOT a change to this ticket's own scope:* this profile is the harness
the gate record is made from **once `DEP-019` has made its journey worker-driven**. As `DEP-016`
delivered it the journey is harness-driven, so the gate's *"one separately deployed worker"* clause
is satisfied as a topology and not as a journey — see `DEP-016-result.md` §5.3, which states the
limitation, and `DEP-019` below, which closes it. `DEP-016`'s acceptance is unchanged; acceptance
item 6 is carried into `DEP-019`, whose Unit B replaces the tripwire with the positive assertion.

**Acceptance:**
1. A passing profile run retains its evidence bundle.
2. Per priced attempt: exactly one `cost_events` row with cost > 0 and one `authoritative_cost`
   receipt; the named audit rows present.
3. **Positive control:** the same profile with usage suppressed **reds**. Without it, the spine prices
   nothing and still passes.
4. **Multi-tenant (F10):** three Organizations — two enabled, one control; the journey, audit and
   `cost_events` attribution are asserted **per enabled tenant**; the control tenant is refused
   distributed execution and stays on the legacy path.
   ★ *Added at M1 Step 0 (S0-8), verified at source:* `docker-compose.d1.yml` sets
   `AOA_DISTRIBUTED_EXECUTION_ENABLED: "true"` on both control-plane replicas and **no
   `AOA_DISTRIBUTED_EXECUTION_ROLLOUT`**, so as shipped every Organization resolves to `off` and the
   profile would run nothing distributed. The profile must set `AOA_DISTRIBUTED_EXECUTION_ROLLOUT`
   (`DISTRIBUTED_EXECUTION_ROLLOUT_ENV`, parsed by `parseDistributedExecutionRolloutMap`) on **both**
   replicas, identically, with the two enabled Organizations in `organizations` and the control
   Organization **absent**; the retained bundle records its digest.
5. **Crew switch off.** *Added at S0-8:* the profile asserts `AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED`
   is unset or false on both replicas (deployment-wide, per the M1 plan §6 freeze checklist) and
   records it in the retained bundle.
6. **The DEP-017 env probe, CARRIED IN** *(added 2026-09-23 from DEP-017's build after the Codex
   review of PR #565, and RATIFIED by the M1 planning session under founder delegation F2 on
   2026-09-23 — not a build agent's own authority)*: the profile arms `AOA_WORKER_ENV_PROBE=1` on its worker(s) and asserts, per
   enabled tenant, a clean live env-absence summary with a RED planted control, read from the
   attempt's `job_events` exactly as the `DEP-015` journey does
   (`evaluateEnvProbeEvidence`, `scripts/lib/m1-shipped-boot.mjs`). `DEP-017` could not deliver this
   half: the profile did not exist, and the D1 lane's FAKE provider runs no command, so the probe
   would report nothing there. If this profile still runs the fake provider, `DEP-016` must either
   make the fake execute the probe command faithfully or record, in its result, that criterion 5 is
   observed ONLY in the `DEP-015` lane — an unobserved probe must not be reported as a pass.

**Ticket non-goals:** the fault matrix (`DEP-018`); real E2B; changing the `foundation`/`bounded`
scopes.

**Files:** `docker/d1/campaign.env` and `.github/workflows/d1-merge-train.yml` (the `m1-spine`
scope and on-pass retention); `docker-compose.d1.yml` (one-worker topology, via profile or
override, **and the `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` tenant set on both control-plane replicas**
— added S0-8); **create** a canned-usage fixture under `tests/fixtures/distributed-execution/`;
**create** `tests/d1/m1-spine.test.mjs` (declared in `scripts/test-execution-census.json`);
`tests/d1/lib/e6f-harness.mjs` for shared helpers; `scripts/collect-d1-evidence.mjs` if on-pass
collection needs it.

**Interfaces:** the `m1-spine` scope value; the fixture's `usage` event.

**Failure behavior:** a missing cost row, a zero-cost row or a missing audit row fails the profile.

**Migration/compatibility / rollback:** CI and fixtures only; the existing scopes are untouched.

**Observability:** the retained bundle: per-tenant cost, receipt and audit rows.

**Focused verify command:** see the `DEP-016` row in §3.

**RED → GREEN:** RED — the profile against a tree without `JOB-016`'s registration (no cost row);
positive control — usage suppressed reds; GREEN — the profile passes on the candidate and retains
evidence.

**Evidence / commit:** `tickets/DEP-016-result.md` citing the D1 job; one commit
`test(d1): an m1-spine campaign profile with priced canned usage`.

---

### DEP-017 — A live env-absence probe on the distributed stage-in path (M, ≤3 agent-days, M1a)

**Depends on:** DEP-008 and DAT-008 (shipped); founder ruling **F9** — build it (ruled 2026-09-21).

**Current state, measured:** `E8-F012` (HIGH, `unowned`, `docs/replatform/epics/E8-browser-automation/findings.md`)
records that DE-08's confidentiality now rests on the credential taxonomy and that no CI-run test
checks it on every sandbox stage-in path. **No env-absence probe exists** (no code matches it). The
closest checks are allow-list unit tests: `buildSandboxEnvAllowlist`
(`packages/adapter-utils/src/sandbox-env-allowlist.ts`), `server/src/__tests__/commander-sandbox-env-allowlist.test.ts`
and `server/src/__tests__/sandbox-env-allowlist-interlock.test.ts`. They check what is **built**, not
what a sandbox **observes**.

**Outcome:** a probe that runs **inside** a distributed sandbox after stage-in and reports which
credential classes are present in its environment (names and classes only, never values), used by
the campaign profiles to observe criterion 5. It closes `E8-F012`'s gap **for the M1 distributed path
only**. It does not make DE-08 meet H-06; the reviewers' acknowledgement that H-06 is still unmet is
part of every record that cites the probe.

**Acceptance:**
1. On a clean run the probe reports absence, naming every variable class it checked.
2. **Positive control:** a canary credential planted in the stage-in path turns the probe **red**.
3. The probe's output passes through the per-run canary redaction before it leaves the worker.
4. **Multi-tenant (F10):** the probe runs for each enabled tenant, and another tenant's credential is
   one of the planted cases.

**Ticket non-goals:** the metadata-endpoint half of `E8-F012` (`169.254.169.254`) unless it is cheap
to include — if left out, the record says so; a DE-08 amendment; non-distributed stage-in paths
(Commander, warm resume) — named as outside the M1 claim.

**Files:** **create** the probe (a small script staged into the sandbox, under
`packages/worker-daemon/src/` or `tests/fixtures/distributed-execution/`, decided and recorded);
**create** its unit test; the campaign profiles that invoke it (the `DEP-015` lane; `DEP-016`'s
`tests/d1/m1-spine.test.mjs` is carried into `DEP-016` — ★ *Amended 2026-09-23 by DEP-017's build, after the Codex review of PR #565, and RATIFIED by the M1 planning session under founder delegation F2 on 2026-09-23. NOT a narrowing of criterion 5:* the probe cannot be observed inside the `DEP-016` profile from `DEP-017`, because `tests/d1/m1-spine.test.mjs` does not exist yet (`DEP-016` is unbuilt) and because the D1 lane runs the FAKE provider, whose `execute` returns a canned `executed` result and runs no command (`packages/sandbox-fake-provider/src/fake-driver.ts`, the `case "execute"` arm) — arming the probe there today would fail every D1 distributed run `env_probe_not_run` while observing nothing. The obligation is therefore CARRIED INTO `DEP-016` (see its task section), which owns the profile and must arm `AOA_WORKER_ENV_PROBE` and assert the probe summary per enabled tenant on whatever provider that profile runs. `DEP-017` delivers the probe and its observation in the `DEP-015` lane.); `scripts/test-execution-census.json`; `scripts/finding-ownership.json` —
**`E8-F012` stays `unowned`**; this ticket only **amends that entry's `reason`** to record that
`DEP-017` covers the M1 distributed stage-in path only, and that the other stage-in paths (Commander,
U13 extraction, warm resume, and the non-distributed org/crew paths) and the metadata-endpoint half
remain without an owner. `DEP-017` does **not** take ownership, partial or otherwise.
★ *Amended 2026-09-21 at M1 Step 0 (S0-8), a planning-session decision under founder delegation
(ruling F2). Verified at source: the manifest has no partial ownership —
`FINDING_OWNERSHIP_STATUSES` in `scripts/lib/finding-ownership.mjs` is exactly `owned`, `unowned`,
`accepted`, and `owned` means *"a ticket owns this finding"* — the whole finding, with no field for a part of it. Superseded text: "an
ownership update for `E8-F012` in `scripts/finding-ownership.json` narrowed to the M1 path, with its
reason."*

**Interfaces:** the probe's report: `{checked: string[], present: string[]}` of class names.

**Failure behavior:** any present credential class fails the run; a probe that did not run fails the
run (a check that nothing runs is not a check).

**Migration/compatibility / rollback:** test/harness only.

**Observability:** the report in the retained evidence.

**Focused verify command:** see the `DEP-017` row in §3.

**RED → GREEN:** RED — the planted-canary positive control; GREEN — a clean run reports absence, per
tenant.

**Evidence / commit:** `tickets/DEP-017-result.md`; one commit
`test(e6): a live env-absence probe on the distributed stage-in path`.

---

### DEP-018 — Campaign fault matrix and injection harness, per gate profile (M, ≤3 agent-days, M1a)

**Depends on:** `DEP-016`, `DEP-015`, `WRK-013`; DEP-005 (shipped).

**Current state, measured:** Toxiproxy runs in D1 (`docker-compose.d1.yml`, configured by
`docker/d1/toxiproxy.json`: control-plane→postgres, worker→control-plane, worker→control-plane-b,
worker→minio), and faults are injected through `setToxiproxyToxic`, `removeToxiproxyToxic`,
`setProxyEnabled` and `probeProxyReachable` in `tests/d1/lib/e6f-harness.mjs`, used by
`e6f-05-live-minio`, `e6f-09-lease-faults` and `e6f-11-two-replica`. **No declared, per-profile
matrix exists**, and no record proves an injection fired.

**Outcome:** a committed, declared fault matrix — per gate profile, each case with its expected
classification — a checker that refuses an undeclared or unevidenced case, and the harness that
injects each case:
- **`M1-D1-SPINE`:** the journey's fault controls (Toxiproxy), restart and reconciliation
  (`WRK-013`), cancellation.
- **`M1a-D2-MECHANISM`:** cancellation, provider failure, reconciliation, every cleanup path.
- **`M1-D2-CODING`:** all of that plus the credential cases.
- **Every profile — the F10 tenant matrix:** per-tenant journey correctness for each enabled
  tenant; cross-tenant denial — A cannot lease, read, cancel or see B's jobs, events, secrets, staged
  inputs, outputs, cost rows or tool calls; refusal of the control tenant.

**Acceptance:**
1. Every declared case has a run showing **its injection fired** and the observed classification
   matching the expected one; a case whose injection did not fire is a failure, not a pass.
2. Every cross-tenant denial is **denied, not merely empty**, through the non-owner `aoa_app` pool
   with RLS, and has a **positive control**: the same request by the owning tenant succeeds.
3. The control tenant is refused distributed execution and stays on the legacy path.
4. The checker reds on an undeclared case, a case with no injection evidence, or a profile missing
   the tenant matrix (its own positive controls).
5. ★★★ **Legacy rows the distributed path writes or reads are tested DIRECTLY — `cost_events`,
   `activity_log`, `task_outputs` and `provider_credentials`.** *Added 2026-09-21 at M1 Step 0
   (S0-8), from the E0–E2 delta review
   (`docs/replatform/milestones/M1a/2026-09-21-e0-e2-delta-review-b71f0dd539fe.md` §4, "F10
   consequence"); a planning-session decision under founder delegation (ruling F2) carrying ruling
   F10.* Per **E2-D03** (`docs/replatform/epics/E2-tenant-kernel/decisions.md`, **locked** — not
   relitigated here), legacy `companyId` tables are granted to the non-owner role and carry **no
   RLS**; E2-D10 bounds those grants, and `JOB_CONTROL_LEGACY_GRANTS`
   (`server/src/db/job-control-legacy-grants.ts`) gives `aoa_app` `SELECT`/`INSERT` on `cost_events`
   and `activity_log`, `SELECT`/`INSERT`/`UPDATE` on `task_outputs`, and `SELECT` on
   `provider_credentials` (verified at source). So acceptance 2's *"denied … with RLS"* **cannot
   hold** for these four: isolation rests on **query predicates**, and E2's RLS evidence must not be
   cited for them. For each table, B's row is planted and A's request goes through the **production
   query path the distributed path uses** (the bridge, service or route that reads or writes it, not
   a hand-written test query); the result is **denied or filtered** — B's row absent from what A
   reads, and A's write never lands on B's Company. Each has a **same-tenant positive control** (the
   owning tenant's identical request returns or writes the row), and an **anti-vacuity control**: the
   same read with the tenant predicate removed does return B's row, so an empty result is shown to be
   the filter's work, not an empty table.

**Ticket non-goals:** HA/replica failover (M4); load/fairness (REL-002); desktop or browser faults.

**Files:** **create** `tests/d1/fault-matrix.json` (the declaration) and
`scripts/check-campaign-fault-matrix.mjs` + its `.test.mjs` (declared in `scripts/guard-inventory.json`);
**create** `tests/d1/m1-fault-matrix.test.mjs`; `tests/d1/lib/e6f-harness.mjs` (injection helpers);
`docker/d1/toxiproxy.json` if a new link is needed; the `DEP-015` workflow for the D2 profiles;
`scripts/test-execution-census.json`.

**Interfaces:** the matrix schema: `{profile, case, injection, expectedClassification, tenantCase?}`.

**Failure behavior:** an unfired injection, a mismatched classification, or an empty-rather-than-
denied cross-tenant result fails the profile.

**Migration/compatibility / rollback:** test/harness only.

**Observability:** a per-case evidence line (injection fired, classification observed) in each
retained bundle.

**Focused verify command:** see the `DEP-018` row in §3.

**RED → GREEN:** RED — the checker's positive controls; RED — each cross-tenant denial against a
deliberately unscoped fixture read; RED — for each of the four legacy tables of acceptance 5, the
predicate-removed read returns B's row (added S0-8); GREEN — every case fired and classified on the candidate, per
profile.

**Evidence / commit:** `tickets/DEP-018-result.md` citing the jobs; commits
`test(d1): a declared campaign fault matrix with injection evidence` and the checker commit.

---

### DEP-019 — The `m1-spine` journey, driven by the DEPLOYED worker (M, ≤3 agent-days, M1a)

**Depends on:** `DEP-016` merged; `DEP-011` Slice 2b-ii (the container networked boot root),
`WRK-017` (the enrolling worker container), `WRK-018` (the usage producer), `JOB-016` (the
accepted-usage pricing), `DEP-017` (the env-absence probe) — all shipped.

**Current state, measured 2026-09-23 at `b3c5aa417`.** `DEP-016`'s `m1-spine` profile has a
deployed worker service, and its journey is nevertheless HARNESS-driven:

- `tests/d1/m1-spine.test.mjs` plays the worker itself — `enroll` / `poll` / `ack` / `uploadEvents`
  are ordinary authenticated HTTP calls the harness makes, and the provider is reached through the
  fake's `/invoke` control API from `test-runner`. `tests/d1/lib/e6f-harness.mjs` says so in its own
  header: *"There is NO live worker-daemon loop."*
- The D1 workers do not dispatch: `AOA_WORKER_DISPATCH_ENABLED` is declared **ABSENT** for both
  (`scripts/d1-dispatch-expectation.json`, enforced by `check-d1-dispatch-declared`), and
  `decideDispatchComposition` (`packages/worker-daemon/src/lifecycle/compose-dispatch.ts`) refuses
  without it.
- The reference provider runs no command: `FakeSandboxProvider`'s `case "execute"`
  (`packages/sandbox-fake-provider/src/fake-driver.ts`) returns a terminal state and, since
  `DEP-016`, canned usage on the CONTRACT driver's result — a shape only a harness reads. The
  authoritative per-op `ExecuteResult` (`packages/worker-daemon/src/supervisor/provider.ts`) has no
  usage field at all; a deployed worker derives usage from the run's stdout through `observeRun`
  (composed at `dispatch-runtime.ts`) and `parseClaudeStreamJsonUsage`.

So `M1-D1-SPINE`'s *"one control-plane instance, one separately deployed worker"* is satisfied as a
TOPOLOGY and not as a JOURNEY. `DEP-016-result.md` §5.3 records exactly this, names the two
blockers, and flags it for a D1 topology ticket. This is that ticket.

**Outcome:** the `m1-spine` journey is performed by the DEPLOYED worker — lease → execute → events
→ terminal — on the reference provider, keylessly, with the harness reduced to DISPATCHING (seeding
the job) and ASSERTING. Three units.

★ *All three units are BUILT and the journey was proven on a live D1 stack (`DEP-019-result.md` §3:
9/9, the deployed worker's own workerId on every event and lease, one 81-cent cost row, the DEP-017
probe reporting `absent`). The unit split is kept because it is how the work is reviewed, not
because any part of it is outstanding.*

---

#### Unit A — the reference provider EXECUTES

`packages/sandbox-fake-provider` gains deterministic command execution:

- `scripted-command.ts` — `executeScriptedCommand` writes a `claude --output-format stream-json`
  transcript to the stdout channel (`ExecuteInput.onStdout`, WRK-018), ending in the `type:"result"`
  line that carries `FAKE_PROVIDER_CANNED_USAGE_V1`'s counts under claude's own field names, and
  returns a real `ExecuteResult`. The script rides the TENANT COMMAND's own `args`
  (`--aoa-fake-usage|exit|timeout`), **not** the fake's `/script` control endpoint: a worker-driven
  journey mints the provider id inside the worker, so the harness has no id to script. An
  unrecognised, malformed or repeated scripting flag is a refusal — a script that degraded to the
  default would make every positive control vacuous.
- `node-eval.ts` — the `DEP-017` probe is EXECUTED, not scripted: `node -e <script> <argv…>` in a
  child process whose environment is EXACTLY the `env` the provider was handed, with nothing of the
  provider host's inherited. Only the committed `sh -c` wrapper is recognised; a recognised probe
  reaching a provider with no runner THROWS rather than answering with the transcript.

**Unit A non-goals:** the per-op `SandboxProvider` façade and the provider-wire host (Unit C).

#### Unit B — the verdicts, extended in place

`scripts/lib/m1-spine-assertions.mjs` gains a worker-driven arm; it is **extended, never forked**,
and the harness-driven and worker-driven lanes are held to one verdict set by a drift test.

- `evaluateWorkerDrivenJourney` — the attempt's rows name the DEPLOYED worker's enrolled identity
  (the worker id the WRK-017-style boot enrolment minted, read from `execution_targets` /
  `workers`), the accepted `usage` event of that attempt was produced by that worker, and no event
  of the attempt carries a harness-minted worker id.
- The env-probe read side is **REUSED, not re-implemented**: `extractEnvProbeSummary` and
  `evaluateEnvProbeEvidence` (`scripts/lib/m1-shipped-boot.mjs`) are profile-agnostic — they judge
  any attempt's `job_events` log rows — and the spine calls them, exactly as it reuses
  `DEP-016`'s verdicts.
- `evaluateEnvProbeObservability` (the `DEP-016` tripwire that reds if a probe summary EVER appears
  in this profile) is **REPLACED by the positive assertion, not deleted silently**: the profile
  asserts, per enabled tenant, that the probe RAN and reported `absent`. The replacement is recorded
  in this ticket's result with pointers to `DEP-016` acceptance item 6 and `DEP-016-result.md` §4b.

#### Unit C — the topology

1. **The reference provider hosts the gated per-op wire.** `docker/d1/fake-provider-entry.mjs`
   serves `createProviderServer` (`packages/adapter-manager`) over a per-op `SandboxProvider`
   façade of the fake, on a third port, pinned with the control plane's PUBLIC key so the ownership
   gate is REAL (an ungated server is Unit A's not-deploy-safe posture and must not be what the
   gate record rests on). The shipped `bin/adapter-manager.ts` composition root is **untouched** —
   it stays `e2b`-only; a `fake` arm there would let a deployed provider host boot with no isolation.
2. **The control plane mints the run's capability.** `AOA_CONTROL_PLANE_SIGNING_KEY_FILE` on the
   spine control plane, over a committed throwaway ed25519 keypair of the same class as
   `docker/d1/certs`. Without it `loadControlPlaneSigningKey` returns `undefined`, no
   `ownedLabelsCapability` rides the secret-resolve reply, and every networked run dies
   `no_run_capability` before create (`supervisor.ts`). The seeded job must therefore carry one
   `env` / `sandbox_local_only` secret handle on an allow-listed target
   (`PROVIDER_AUTH_ENV_TARGETS`, `lease/secret-redemption.ts`) — the cap only arrives attached to a
   resolved handle.
3. **The one deployed worker dispatches.** In the OVERRIDE only: the networked container boot root
   (`/worker-net-app/dist/bin/networked-host.js`), `AOA_WORKER_DISPATCH_ENABLED=1`,
   `AOA_WORKER_EVENT_OUTBOX_PATH`, `AOA_WORKER_ENV_PROBE=1`, and `AOA_WORKER_PROVIDER_URL` pointed
   at the wire port. The base `docker-compose.d1.yml` and `scripts/d1-dispatch-expectation.json` are
   UNCHANGED, so `check-d1-dispatch-declared` still holds both base workers to ABSENT — and because
   that guard reads only the base file, `evaluateSpineOverrideText` is extended to hold the
   OVERRIDE's dispatch and probe posture explicitly. A guard that silently stops covering the
   topology under test is the failure class this programme names first.
4. **Exactly one worker still runs**, and the lane's `ps --services --status running | grep -c
   '^worker-'` assertion is unchanged.

**Ticket non-goals:** the fault matrix (`DEP-018`); real E2B or any keyed spend; the
`foundation`/`bounded` scopes; arming dispatch anywhere outside this override; changing
`DEP-016`'s tenant set, cost expectation or rollback rehearsal.

**Files:** `packages/sandbox-fake-provider/src/{scripted-command,node-eval,per-op-provider}.ts` +
their suites; `docker/d1/fake-provider-entry.mjs`; `docker/d1/fake-provider.Dockerfile`;
`docker/d1/m1-spine.override.yml`; the spine worker's committed profile + enrolment ticket and the
committed throwaway control-plane keypair under `docker/d1/`; `scripts/lib/m1-spine-assertions.mjs`
+ `scripts/lib/__tests__/m1-spine-assertions.test.mjs`; `tests/d1/m1-spine.test.mjs` +
`tests/d1/lib/e6f-harness.mjs`; `.github/workflows/d1-merge-train.yml` (the not-the-executor
control); `scripts/test-inventory.json`, `scripts/test-execution-census.json`.

**Interfaces:** the `--aoa-fake-*` scripted-command flags; the provider-wire port on the reference
provider; the spine worker's target profile and enrolment ticket.

**Failure behavior:** a journey whose events do not name the deployed worker fails the profile; a
probe that did not run, could not be read, or reported any present class fails it; a suppressed-usage
run that still prices fails it.

**Acceptance:**
1. **Worker-driven, provably.** The attempt's lease, execute, events and terminal are the DEPLOYED
   worker's, asserted against that worker's own enrolled identity.
2. **The not-the-executor control REDS.** A control run in which the worker is not the executor —
   the same profile driven by the harness worker, and a reference provider that returns canned
   output instead of executing — turns the worker-driven assertion red. Without it "worker-driven"
   is claimable vacuously, and a fake `execute` that answers with canned output instead of running
   is exactly that case.
3. **The usage positive control still reds**, now at the worker's real parser rather than the
   harness's forwarding: `--aoa-fake-usage=suppressed` removes the stream-json result line, the
   worker emits no `usage` event, and the cost assertion goes red.
4. **`DEP-016` acceptance item 6, CLOSED properly.** The profile arms `AOA_WORKER_ENV_PROBE=1` and
   asserts that the probe RAN and reported `absent`, read from the attempt's `job_events` through
   `evaluateEnvProbeEvidence`.
   ★★★ *Amended 2026-09-23 by `DEP-019`'s build, from a Codex P1 on PR #572 verified at source.
   Superseded text: “asserts, **per enabled tenant**, that the probe RAN”. It is not achievable on this
   lane, and the cause is a collision between two LOCKED requirements rather than an oversight: the
   probe runs INSIDE a sandbox, only a DISPATCHING worker creates one, and `M1-D1-SPINE` is “one
   control-plane instance, **one separately deployed worker**”. One worker drives one tenant's
   sandbox; a second worker would satisfy this clause and break the gate's own topology clause. So
   the profile asserts the probe RAN and reported `absent` for the WORKER-DRIVEN tenant, and
   **RECORDS it unobserved for every other enabled tenant with the `DEP-016` tripwire
   (`evaluateEnvProbeObservability`) still holding that record in both directions** — it reds if a
   summary ever appears on such an attempt, and if observation is claimed without one.
   **For the planning session:** if criterion 5 must be observed for EVERY enabled tenant on this
   lane, `M1-D1-SPINE` needs one deployed worker PER enabled tenant, which contradicts its topology
   clause. That is a gate question; `DEP-019` does not resolve it by widening what it claims.* A missing or blind summary fails the profile,
   exactly as the keyed lane does; the `DEP-016` tripwire is replaced by this positive assertion and
   the replacement is recorded. **Control:** a worker without the probe env reds the new assertion.
   ★ The evidence must state the narrowing: a reference sandbox has no baked image env and no
   provider-host env, so this lane observes the STAGE-IN env only; the template-baked and
   provider-host classes stay the `DEP-015` lane's to observe.
5. **Multi-tenant (F10), unchanged and re-proven.** Every per-tenant `DEP-016` property still holds
   — per-tenant journey, audit and `cost_events` attribution, the hostile cross-tenant cases denied
   with their same-tenant positive controls, and the control tenant refused and left legacy. The
   deployed worker is offered no work for the other enabled tenant or for the control tenant, each
   with the owning tenant's offer as the positive control.
6. **Keyless.** The whole profile runs on the D1 lane with no provider key and no E2B spend.

**Migration/compatibility / rollback:** CI, the D1 override and the reference provider only. The
base `docker-compose.d1.yml`, the `foundation`/`bounded` campaigns, the dispatch declaration and the
shipped adapter-manager composition root are untouched; reverting the override restores the
`DEP-016` harness-driven profile exactly.

**Observability:** the retained bundle gains, per enabled tenant, the deployed worker's identity,
the env-probe summary, and which lane (harness- or worker-driven) produced the attempt.

**Focused verify command:** see the `DEP-019` row in §3.

**RED → GREEN:** RED — the not-the-executor control; RED — the usage-suppressed control; RED — a
worker without `AOA_WORKER_ENV_PROBE`; RED — a reference provider that returns canned output instead
of executing the probe (`env_probe_not_run`, which is fail-closed working, never a verdict to
loosen); GREEN — the profile passes worker-driven on the candidate and retains its evidence.

**Evidence / commit:** `tickets/DEP-019-result.md`; commits
`feat(d1): the reference provider executes a scripted command deterministically`,
`feat(d1): the reference provider RUNS the DEP-017 env-absence probe`, and the topology commit.

---

## 5. Existing-infra crosswalk (what DEP extends vs leaves authoritative)

| Concern | Existing authority | DEP disposition |
|---|---|---|
| Sandbox provider seam | `server/src/services/sandbox-provider-runtime.ts` (`SandboxRuntimeProvider`; in-process `fake`, `e2b`, `gvisor`) | DEP-000 adds a **networked, fixture-driven, invocation-inspectable** fake implementing WRK-004's port; it does **not** replace the in-process CI stand-in or invent a second registry. |
| Container image | combined `Dockerfile` (+ `docker-cli`, server, UI, CLIs) | DEP-001 adds **split** least-privilege images; the combined image + `docker.yml` remain for existing single-image deploy until REL-004. |
| Compose stacks | `docker-compose.yml` (prod), `docker-compose.research.yml` (E2E), `docker-compose.quickstart.yml` | DEP-002 adds `docker-compose.d1.yml`; existing stacks untouched. |
| Migration path | `pnpm db:migrate` = `tsx packages/db/src/migrate.ts`; `0188_organizations.sql`; `loadRequiredMigrationIdentity()` | DEP-003 adds a **privileged** `migrate-job.ts` + readiness gate + fail-closed 0188 preflight; `0188` itself and normal `db:migrate` are unchanged. |
| CI gate | `pr.yml` (`changes`,`policy`,`ci-required`), `docker.yml` | DEP-004 extends `changes`, adds one conditional consumer + a merge-train workflow; **no** trigger-level path filter; verdict via `ci-required`. |
| Fixtures + digest checker | `tests/fixtures/distributed-execution/`, `scripts/check-distributed-execution-foundation.mjs` | DEP-000/DEP-004 reuse and keep green; no fixture schema change. |

---

## 6. Failure-mode coverage and observable signals

| Failure mode | Owning ticket(s) | Detection / signal |
|---|---|---|
| Tenant/server/db code reachable from the host worker/fake | DEP-000 | `check-sandbox-fake-provider-boundary.mjs` fail-closed in `policy`. |
| Non-deterministic fixture replay / residual resources after cleanup | DEP-000 | determinism + reset-isolation suites; `list`/`inspect` zero-resource projection (E6F-02). |
| Fault not honored at a lifecycle checkpoint | DEP-000 | per-checkpoint fault-injection suite over `failureInjection`. |
| Combined tooling in an image / root user / writable root | DEP-001 | image-contents test (Linux/CI); non-root + read-only-root assertions. |
| Unsigned/tampered image admitted | DEP-001 | `image-admission` allow/deny (node --test) — fail-closed. |
| Worker reaches PostgreSQL / control-plane reaches provider control | DEP-002 | static invariant validator + live network-denial (E6F-05). |
| Shared writable volume | DEP-002 | static `rw`-mount uniqueness check. |
| Control plane serves before compatible schema | DEP-003 | readiness 503 + `migration-readiness` integration test. |
| Destructive migration loop | DEP-003 | idempotent non-destructive migrate-job; rollback-startup test. |
| 0188 marker synthesized without opt-in/snapshot/restore-validate/verify | DEP-003 | pure preflight state machine (each fail-closed case) + app-startup-never-writes assertion (E6F-07). |
| Protocol/schema change with no mandatory consumer / silent trigger-skip | DEP-004 | `check-ci-lanes.mjs` fail-closed in `policy`. |
| Merge-train failure loses evidence | DEP-004 | evidence-bundle lib + `upload-artifact` on failure + deliberate-failing-fixture proof. |

Retention: gate summaries live in Git permanently; controlled raw distributed
logs/events/DB-state/object manifests are retained on failure per the merge-train
lane. High-cardinality tenant identifiers stay in access-controlled logs, never
in metric labels.

---

## 7. Gate traceability — `E6-D1-FOUNDATION`

### 7.1 E6F requirement → owning evidence

| Requirement (`test-gates.md`) | Owning evidence |
|---|---|
| **E6F-00** scope + dependency closure | DEP-000–004 on one revision **plus** TEN-002 (passed), JOB-003 (E3 — must be `complete`), WRK-004 (E4 — must be `complete`). The controller records each upstream QA/handoff path + SHA in the gate record. |
| **E6F-01** 100 submit→placement→lease→ACK races across ≥2 registered profiles, one winner each | DEP-002 two distinct worker profiles + JOB-001/009/003 control-plane path; the gate campaign runs 100 races on the live stack. |
| **E6F-02** 25 fake-provider create→execute→kill/destroy fault cases, deterministic reset, zero resources | DEP-000 fixture-driven fake + per-checkpoint fault injection + `list`/`inspect` zero-resource projection. |
| **E6F-03** one networked end-to-end smoke (PG, MinIO, control plane, worker, fake provider, runner) | DEP-002 stack + DEP-003 readiness + the single fake-provider job. |
| **E6F-04** zero cross-Organization reads/existence disclosures in the available submit/enroll/placement/lease paths | E2 `runInTenant` + JOB-001/002/003 tenancy; the gate's hostile cross-Org matrix on the live stack. |
| **E6F-05** topology boundaries (no shared rw volume; no worker DB reach/credential; no control-plane/worker-host tenant-command execution; only declared provider-control access) | DEP-002 network-denial + static invariants; DEP-000 no-tenant-code boundary; DEP-001 least-privilege images. |
| **E6F-06** pinned images from recorded source, non-root/read-only-root, test-root signature/provenance verify, reject one tampered digest | DEP-001 build + admission verifier + image-contents/startup. |
| **E6F-07** migration/readiness behavior + retained evidence from one deliberate failing fixture | DEP-003 readiness + fail-closed preflight; DEP-004 merge-train evidence retention + deliberate-failing fixture. |
| **E6F-08** explicit non-certification list | The QA record lists renewal/fence loss, event ingestion/outbox, cancellation/retry, artifact/secret/quarantine, full D1 fault volume, real-provider isolation, two-replica HA, and release signing policy as **not certified** — owned by their tickets + full D1/D2. |

### 7.2 Closure dependencies (must be `complete`/`pass` on one revision)

- **TEN-002** (E2 tenant kernel) — passed at `7843b86e25eb1ff9c520308aef7f123fec6997a7`.
- **JOB-003** (E3 lease/ACK) — currently `needs_changes`; **must be `complete`**
  before the gate can run.
- **WRK-004** (E4 sandbox supervisor / provider-driver port) — **not built**;
  **must be `complete`** (it also unblocks DEP-000/001 assignment).
- **DEP-000–004** — all `complete` on the **same main revision**.

### 7.3 Independent gate procedure (Integration Gate Owner)

1. The Integration Gate Owner **implemented/reviewed no DEP ticket** and is
   distinct from the Security Gate Owner.
2. Freeze one implementation candidate after all five DEP reviewer-completed
   ledgers **and** the TEN-002/JOB-003/WRK-004 closure exist on one revision.
3. Build workspace packages, then run the focused DEP lanes (§3) once more on the
   frozen revision, then bring up `docker-compose.d1.yml` from DEP-001 **admitted
   image digests** only.
4. Run the gate campaign (Linux CI is the DEC-03 authority; a Linux docker host
   locally is operator-directed evidence only):

   ```powershell
   $env:AOA_RUN_WIN_INTEGRATION='1'
   $env:AOA_E6F_LEASE_RACES='100'; $env:AOA_E6F_TARGET_PROFILES='2'
   $env:AOA_E6F_PROVIDER_FAULTS='25'
   try {
     Invoke-NativeGate 'E6-D1-FOUNDATION races (E6F-01)'   { node --test tests/d1/e6f-01-lease-races.test.mjs }
     Invoke-NativeGate 'E6-D1-FOUNDATION faults (E6F-02)'  { node --test tests/d1/e6f-02-provider-faults.test.mjs }
     Invoke-NativeGate 'E6-D1-FOUNDATION smoke (E6F-03)'   { node --test tests/d1/e6f-03-networked-smoke.test.mjs }
     Invoke-NativeGate 'E6-D1-FOUNDATION tenancy (E6F-04)' { node --test tests/d1/e6f-04-tenancy.test.mjs }
     Invoke-NativeGate 'E6-D1-FOUNDATION topology (E6F-05)'{ node --test tests/d1/network-denial.test.mjs }
     Invoke-NativeGate 'E6-D1-FOUNDATION images (E6F-06)'  { node --test docker/images/__tests__/image-contents.test.mjs }
     Invoke-NativeGate 'E6-D1-FOUNDATION failure (E6F-07)' { node --test tests/d1/evidence-retention.test.mjs }
   }
   finally {
     Remove-Item Env:AOA_E6F_LEASE_RACES,Env:AOA_E6F_TARGET_PROFILES,Env:AOA_E6F_PROVIDER_FAULTS,Env:AOA_RUN_WIN_INTEGRATION -ErrorAction SilentlyContinue
   }
   ```

   The suites emit the ordered race seeds + single-winner proofs, the 25 fault
   cases with deterministic reset and zero post-reconciliation resources, the
   networked smoke trace, the cross-Org zero-disclosure matrix, the topology
   denial results, the image policy proofs, and the retained deliberate-failure
   evidence bundle. Run the E6F-04/E6F-05 subset three consecutive times.
5. Any isolation-invariant or tenancy failure is a **non-waivable `fail`**, never
   conditional.
6. The Gate Owner writes an immutable
   `qa/<UTC-date>-e6-d1-foundation-<scope>-<sha12>-a<attempt>.md` (Lane
   `E6-D1-FOUNDATION`; Result `pass|fail|blocked_external`; Failure class
   `none|product|harness|provider|environment`; the E6F-00..08 assertions table
   with Class `REQUIRED|HARD|INITIAL|OBSERVED`, required vs observed, and evidence
   links). The distinct Security Gate Owner verifies the raw archive and writes
   `handoffs/<UTC-date>-e6-d1-foundation-<sha12>-a<attempt>.md` (Gate slug
   `e6-d1-foundation`; Decision `pass|fail|blocked_external`; pinning each DEP
   ticket-result blob SHA + reviewed implementation SHA + latest disposition, the
   TEN-002/JOB-003/WRK-004 closure evidence, and the QA record blob). Both are
   write-once; a rerun is a new attempt with `Supersedes`.
7. Only a `pass` QA **and** `pass` handoff on the **same** revision unblock JOB-004
   through JOB-008, JOB-011 through JOB-014, and WRK-005 onward. This gate does
   **not** certify the event outbox, full failure harness, staging, managed-provider
   isolation, two-replica HA, or release readiness (E6F-08).

---

## 8. Controller sequence and parallelization

```text
WAIT FOR committed passing E4 handoffs: WRK-001 (image) + WRK-004 (provider port)
WAIT FOR JOB-003 complete (E3)

FOUNDATION (this plan):
  DEP-000 (fake provider) ----+
                              +--> DEP-002 (compose) --> DEP-003 (migration/readiness)
  DEP-001 (split images) -----+           |
                                          +--> DEP-004 (CI lanes + merge-train)

  all five DEP reviews + TEN-002/JOB-003/WRK-004 closure
     -> independent E6-D1-FOUNDATION QA + handoff
     -> unblocks JOB-004..008, JOB-011..014, WRK-005+
```

DEP-000 and DEP-001 are independent of each other (fake-provider packages vs image
build) and may run in parallel worktrees once E4 lands; DEP-002 joins them and
depends on TEN-002; DEP-003 follows DEP-002; DEP-004 follows DEP-002 and may run in
parallel with DEP-003 (different file areas: CI/workflows vs migration/readiness).
Because DEP-002/003/004 touch overlapping compose/CI surface, the default single-
worktree sequence serializes DEP-002 → DEP-003 → DEP-004 to avoid compose/workflow
merge repair.

| Step | Modules touched | Depends on |
|---|---|---|
| Fake provider | `packages/sandbox-fake-provider`, `packages/sandbox-provider-contract`, `scripts/*boundary*` | WRK-004, FND-004 |
| Split images | `docker/control-plane`, `docker/worker`, `docker/images`, `scripts/*admission*`, `pr.yml` deps-validator | WRK-001, FND-005 |
| Compose topology | `docker-compose.d1.yml`, `docker/d1`, `scripts/*d1-compose*`, `tests/d1` | DEP-000, DEP-001, TEN-002 |
| Migration/readiness | `packages/db/schema+migrate-job`, `server/routes/{health,readiness}`, `server/services/cutover-0188-preflight*` | DEP-002, TEN-001 |
| CI lanes | `pr.yml`, `d1-merge-train.yml`, `scripts/*ci-lanes*`, `scripts/*d1-evidence*` | FND-005, DEP-002 |

### Commit/evidence boundaries

- One implementer code commit per ticket (`feat(deploy-harness): …`); the reviewer
  follow-up commit contains the append-only review result and is the only commit
  that completes the ticket (plain `git commit`, never `--no-verify`).
- Migration slugs are fixed per ticket: **DEP-003 = `distributed_cutover_marker`**
  (+ `distributed_cutover_marker_rls`); the coalesced drizzle diff is recorded
  once and never renumbered by a later ticket.
- `findings.md` uses stable `E6-F<nnn>` IDs (never deleted); `decisions.md` uses
  `E6-D<nn>` / `#<product>` promotion. A behavior-changing plan edit after
  execution begins requires a `decisions.md` entry + an Integration-Gate-Owner-
  reviewed amendment.

---

## 9. Planner self-review

- All five DEP-000..004 canonical outcomes, dependencies, acceptance (incl. failure
  behavior), and tests are represented; each is `M, ≤3 agent-days` with A/B/C
  slices, and none claims the exemption reserved for parity/matrix tickets.
- Forward dependencies are honored as hard STOPs: DEP-000/DEP-001 are blocked on
  WRK-004/WRK-001 (E4 absent), and the gate is blocked on JOB-003 + WRK-004 — no
  ticket invents the missing worker port, worker package, or a second provider
  registry.
- Provider-neutrality is preserved end to end (opaque provider IDs, frozen op
  vocabulary, no E2B fields; CAV-002); test roots only for DEP-001 (REL-004 owns
  release roots); the 0188 preflight is fail-closed and app-startup can never
  synthesize the marker.
- Every ticket names a focused test lane with exact commands and labels which are
  Linux/CI-only (docker/compose/image) vs runnable locally (pure leaf, `node
  --test`, or embedded-PG via `Invoke-E3Integration`); Linux CI under DEC-03 is the
  formal authority.
- The `E6-D1-FOUNDATION` gate maps E6F-00..08 to owning evidence, states the
  TEN-002/JOB-003/WRK-004 closure, and specifies the independent QA record +
  handoff (slug `e6-d1-foundation`) with the explicit non-certification list — it
  is neither D1 promotion nor E6 completion.
- CI conditional execution routes through `ci-required` (no trigger-level `paths:`,
  no independently-required conditional check), preserving the aggregator-gate
  invariant.
