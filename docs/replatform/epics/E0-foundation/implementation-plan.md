# Cloud Control Plane Worker E0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the distributed-execution lifecycle, authority, threat, fixture, rollout, and merge contracts before any worker-protocol or scheduler implementation begins.

**Architecture:** E0 is primarily checked-in architecture and test-fixture work. A small, pure server configuration module provides a default-off deployment flag and per-Organization rollout decision seam; `cloud_auth` startup becomes incompatible with the existing process-wide unsandboxed override. A dependency-free repository checker keeps the documents and golden fixtures present in the always-on policy CI job.

**Tech Stack:** Markdown architecture records, JSON fixtures, Node.js 24 standard library, TypeScript 5.7, Vitest 3.2, existing Express server configuration, GitHub Actions, pnpm 9.15.4.

## Global Constraints

- Support `batch`, `browser_session`, and `service` from the design stage; ship them in that order.
- PostgreSQL owns business, policy, scheduler, lease, and audit state. Git owns source history. Object storage owns immutable workspace snapshots, logs, traces, and artifacts. Worker disks are caches plus encrypted unacknowledged event buffers.
- Do not synchronize AoA databases between cloud and desktop systems.
- PostgreSQL remains authoritative for enterprise memory and its actor/visibility rules; workers receive authorized context inputs or scoped control-plane APIs, never memory-table access.
- The existing MCP OAuth broker remains authoritative for connector token storage, refresh, rotation, and revocation; workers receive only lease-scoped opaque handles and never access or refresh tokens in job envelopes.
- All worker connections are outbound; workers receive neither database credentials nor a shared writable filesystem with the control plane.
- `service` initially supports controlled outbound access and connector/queue consumption; tenant-defined public ingress is excluded.
- Existing `local_trusted` execution stays unchanged and distributed execution defaults off.
- `AOA_ALLOW_UNSANDBOXED_MULTITENANT` is forbidden at `cloud_auth` startup after this epic.
- Do not add job tables, worker routes, provider implementations, or execution calls in E0.
- Do not add dependencies. `pnpm-lock.yaml` must remain unchanged in this epic.
- Every task must pass `pnpm check:distributed-foundation`; code tasks additionally run focused Vitest and affected-package typecheck.
- Source design: `docs/replatform/program-design.md`, tickets FND-001 through FND-005.
- Every completed ticket writes `docs/replatform/epics/E0-foundation/tickets/<TICKET-ID>-result.md` using `docs/replatform/templates/ticket-result-template.md`.
- Every integration or repository-wide test campaign writes an immutable record under `docs/replatform/epics/E0-foundation/qa/` using the QA template.
- New decisions and findings are recorded in the epic-local ledgers before cross-epic promotion or follow-up tickets.

---

## File responsibility map

| File | Responsibility |
|---|---|
| `docs/architecture/distributed-execution-lifecycles.md` | Canonical workload and transition semantics for batch, browser session, and service workloads. |
| `docs/architecture/distributed-execution-authority.md` | Source-of-truth, synchronization, single-writer cutover, and late-result rules. |
| `docs/architecture/distributed-execution-threat-model.md` | Trust boundaries, threats, required controls, residual risk, and ticket ownership. |
| `docs/architecture/distributed-execution-delivery-policy.md` | Custodian roles, merge gates, flags, evidence, and parallel-agent rules. |
| `docs/architecture/decisions.md` | Decision #120 summary and links to the four focused records; existing Decisions #118/#119 remain unchanged. |
| `tests/fixtures/distributed-execution/*.json` | Deterministic golden journeys and failure scenarios consumed by later protocol/provider suites. |
| `scripts/check-distributed-execution-foundation.mjs` | Dependency-free structural checker used locally and in the always-on policy job. |
| `server/src/config/distributed-execution.ts` | Pure environment parsing, hosted safety assertion, and rollout decision. |
| `server/src/config.ts` | Exposes the default-off deployment flag and runs the hosted startup safety assertion. |
| `server/src/services/unsandboxed-multitenant-guard.ts` | Imports the canonical unsafe-override environment name from config; runtime sink behavior otherwise remains unchanged. |
| `server/src/__tests__/distributed-execution-policy.test.ts` | Pure rollout and hosted safety regression tests. |
| `server/src/__tests__/config.test.ts` | `loadConfig()` environment/default/startup integration tests. |
| `.github/workflows/pr.yml` | Runs the structural foundation checker in the always-on `policy` job. |
| `docs/deploy/environment-variables.md` | Documents the default-off deployment flag and hosted override prohibition. |

---

### Task 1: FND-001 — Workload Lifecycle Contract

**Files:**
- Create: `scripts/check-distributed-execution-foundation.mjs`
- Modify: `package.json`
- Create: `docs/architecture/distributed-execution-lifecycles.md`
- Modify: `docs/architecture/decisions.md` after Decision #119

**Interfaces:**
- Consumes: approved workload names `batch`, `browser_session`, `service` and the program design’s lifecycle rules.
- Produces: `pnpm check:distributed-foundation`; Decision #120; canonical status/transition tables consumed by E1 `states.ts`.

- [ ] **Step 1: Add a failing foundation checker and package script**

Add this script entry to the root `package.json` next to `check:tokens`:

```json
"check:distributed-foundation": "node scripts/check-distributed-execution-foundation.mjs"
```

Create `scripts/check-distributed-execution-foundation.mjs` with the following initial contract:

```js
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];

async function requireFile(relativePath, requiredFragments) {
  let source;
  try {
    source = await readFile(path.join(root, relativePath), "utf8");
  } catch {
    errors.push(`${relativePath}: missing`);
    return;
  }
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) {
      errors.push(`${relativePath}: missing ${JSON.stringify(fragment)}`);
    }
  }
}

await requireFile("docs/architecture/distributed-execution-lifecycles.md", [
  "# Distributed Execution Lifecycles",
  "## Batch lifecycle",
  "## Browser-session lifecycle",
  "## Service desired-state lifecycle",
  "## Service-instance lifecycle",
  "## Cancellation and lease-loss rules",
  "batch",
  "browser_session",
  "service",
]);
await requireFile("docs/architecture/decisions.md", [
  "## Decision #120 — Cloud control plane uses a fenced outbound worker protocol",
  "distributed-execution-lifecycles.md",
]);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("distributed execution foundation: PASS");
```

- [ ] **Step 2: Run the checker and verify RED**

Run:

```powershell
pnpm check:distributed-foundation
```

Expected: exit 1 with both `docs/architecture/distributed-execution-lifecycles.md: missing` and `docs/architecture/decisions.md: missing "## Decision #120 — Cloud control plane uses a fenced outbound worker protocol"`.

- [ ] **Step 3: Write the lifecycle record**

Create `docs/architecture/distributed-execution-lifecycles.md` with these exact status sets and transition rules:

```markdown
# Distributed Execution Lifecycles

## Shared identity and ownership

Every execution is identified by Organization, Company, run, job, attempt, lease, and sandbox/service-instance identity. Delivery is at least once. Only the active lease fence may emit accepted events, fetch secrets, commit artifacts, or complete an attempt.

## Batch lifecycle

Statuses: `queued`, `leased`, `running`, `cancel_requested`, `succeeded`, `failed`, `cancelled`, `expired`, `dead_letter`.

Allowed transitions:

| From | To |
|---|---|
| `queued` | `leased`, `cancelled` |
| `leased` | `queued`, `running`, `cancel_requested`, `expired` |
| `running` | `cancel_requested`, `succeeded`, `failed`, `expired` |
| `cancel_requested` | `cancelled`, `failed`, `expired` |

Terminal statuses are immutable. Retry creates a new attempt; it never reopens a terminal attempt.

## Browser-session lifecycle

Statuses: `queued`, `leased`, `starting`, `active`, `waiting_approval`, `cancel_requested`, `succeeded`, `failed`, `cancelled`, `expired`.

`active` and `waiting_approval` may transition between each other. Starting or active sessions may be canceled, fail, expire, or succeed. Cookies, storage state, downloads, screenshots, trace, and video are job-scoped sensitive artifacts with explicit retention. Retry starts clean unless an approved checkpoint is declared.

## Service desired-state lifecycle

Desired states: `running`, `paused`, `stopped`, `deleted`. `deleted` is terminal. A service update creates an immutable increasing generation; it does not mutate a running generation in place. Desired replicas are limited to one in the first release.

## Service-instance lifecycle

Statuses: `pending`, `leased`, `starting`, `healthy`, `unhealthy`, `stopping`, `stopped`, `failed`, `lost`.

The reconciler creates or replaces instances to converge on desired state. Health events never renew a lease. A replacement instance uses a new attempt and fence. No two generations may perform external effects simultaneously unless the service definition explicitly opts into overlap in a later design.

## Cancellation and lease-loss rules

- Before ACK, an expired offer returns the job to eligibility.
- After ACK, cancellation is requested durably and observed through lease renewal or polling.
- Lease loss immediately forbids secrets, artifact commit, completion, and new remote effects.
- A late worker may upload an orphan patch or artifact only to quarantine; it cannot update the authoritative run.
- Batch and browser attempts eventually terminate after cancellation.
- Services use graceful stop followed by a bounded force-kill deadline.
```

Append Decision #120 to `docs/architecture/decisions.md` after the existing memory Decisions #118 and #119:

```markdown
## Decision #120 — Cloud control plane uses a fenced outbound worker protocol with distinct batch, browser-session, and service lifecycles (2026-08-07)

**Status:** Locked for the re-platform program. Implementation is phased and default-off.

AoA retains its product/domain model but moves hosted execution behind a separately deployable worker protocol. PostgreSQL remains authoritative for policy and execution state. Workers lease work outbound and may mutate the control plane only through an active attempt/lease fence. `batch`, `browser_session`, and `service` are distinct workload classes; a service is desired state plus reconciled instances, not an infinitely renewed batch job.

The canonical lifecycle status sets, allowed transitions, cancellation behavior, and lease-loss rules are in [`distributed-execution-lifecycles.md`](distributed-execution-lifecycles.md). This decision extends Decision #117; it does not make the deferred gVisor pool implemented and does not permit execution on the hosted control-plane process.
```

- [ ] **Step 4: Run the checker and verify GREEN**

Run:

```powershell
pnpm check:distributed-foundation
```

Expected: exit 0 and `distributed execution foundation: PASS`.

- [ ] **Step 5: Commit FND-001**

Before staging, create `docs/replatform/epics/E0-foundation/tickets/FND-001-result.md` from the ticket-result template. Set status to `gate_review`; list the lifecycle document, Decision #120, checker, and package script; record both the intentional RED run and final GREEN run; set deviations/findings/follow-ups to `None` unless an epic finding or approved decision exists.

```powershell
git add package.json scripts/check-distributed-execution-foundation.mjs docs/architecture/distributed-execution-lifecycles.md docs/architecture/decisions.md docs/replatform/epics/E0-foundation/tickets/FND-001-result.md
git commit -m "docs: lock distributed workload lifecycles"
```

---

### Task 2: FND-002 — Authority and Migration Contract

**Files:**
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Create: `docs/architecture/distributed-execution-authority.md`
- Modify: `docs/architecture/decisions.md` Decision #120

**Interfaces:**
- Consumes: lifecycle identity chain from Task 1 and current AoA/PostgreSQL/Git/object-storage behavior.
- Produces: authority matrix and `ExecutionOwner = legacy | distributed` single-writer cutover rule consumed by E7/E10 migration plans.

- [ ] **Step 1: Extend the checker before creating the authority document**

Add this call before the final error check in `scripts/check-distributed-execution-foundation.mjs`:

```js
await requireFile("docs/architecture/distributed-execution-authority.md", [
  "# Distributed Execution Authority and Synchronization",
  "## Authority matrix",
  "## Single-writer cutover",
  "## Worker event synchronization",
  "## Workspace and artifact synchronization",
  "## Late and orphan output",
  "No AoA database is a peer replica",
]);
```

Also require the new link in Decision #120:

```js
await requireFile("docs/architecture/decisions.md", [
  "## Decision #120 — Cloud control plane uses a fenced outbound worker protocol",
  "distributed-execution-lifecycles.md",
  "distributed-execution-authority.md",
]);
```

- [ ] **Step 2: Run the checker and verify RED**

Run `pnpm check:distributed-foundation`.

Expected: exit 1 naming the missing `docs/architecture/distributed-execution-authority.md`.

- [ ] **Step 3: Write the authority record**

Create `docs/architecture/distributed-execution-authority.md` with this exact matrix and rules:

```markdown
# Distributed Execution Authority and Synchronization

## Authority matrix

| State | Authority | Worker behavior |
|---|---|---|
| Organizations, memberships, policy, jobs, leases, costs, audit | Control-plane PostgreSQL | Read through scoped envelopes/APIs; append events only |
| Memory items, visibility, retrieval audit, actor scope | Control-plane PostgreSQL and memory services | Consume an authorized immutable context input or scoped API; never query memory tables |
| Connector OAuth grants, refresh leases, token bundles | Control-plane MCP OAuth broker | Request a lease-scoped opaque handle; never receive refresh-token authority |
| Source history | Customer-declared Git remote/repository | Stage declared base; return patch or commit metadata |
| Snapshots, logs, traces, downloads, checkpoints, artifacts | S3-compatible object storage | Transfer through short-lived prefix-scoped grants |
| Unacknowledged worker events | Encrypted worker SQLite outbox | Retain until cumulative ACK |
| Sandbox filesystem | Ephemeral cache | Never authoritative after lease loss or sandbox termination |

No AoA database is a peer replica. Desktop and cloud workers synchronize envelopes, authorized context inputs, events, manifests, patches, and artifacts—not database rows. Memory visibility remains governed by Decisions #118/#119. Connector discovery, token refresh, rotation, and revocation remain control-plane-owned.

## Single-writer cutover

Each run has `ExecutionOwner = legacy | distributed`. The owner is selected atomically before any execution side effect. Shadow mode may compare routing and policy but cannot lease, fetch secrets, start a sandbox, or emit externally visible effects. Cutover may be deployment- and Organization-scoped. Rollback stops new distributed jobs and explicitly drains or cancels active attempts; it never silently hands an active run to the other owner.

## Worker event synchronization

Workers append events identified by job, attempt, lease, event ID, and monotonically increasing sequence. PostgreSQL uniquely enforces event ID and sequence. The control plane returns cumulative acknowledgement. Duplicate batches are harmless; gaps are rejected with the next expected sequence.

## Workspace and artifact synchronization

Inputs use immutable manifests with base hashes. Large bytes move directly through object storage. Coding output is a patch or commit tied to a base hash. Browser state and service checkpoints have sensitivity and retention metadata. Artifact promotion requires the current fence and verified object prefix, size, and hash.

## Late and orphan output

Expired or replaced attempts cannot update authoritative state. A late patch, trace, or checkpoint may be uploaded only to a quarantine prefix and surfaced for human reconciliation. It is never auto-applied or selected as the service recovery checkpoint.
```

Add this paragraph to Decision #120 after the lifecycle link:

```markdown
Authority, synchronization, single-writer cutover, and late-result quarantine are locked in [`distributed-execution-authority.md`](distributed-execution-authority.md). No desktop or worker database is a peer replica of the hosted control plane.
```

- [ ] **Step 4: Verify GREEN and commit**

Run `pnpm check:distributed-foundation`.

Expected: exit 0.

Create `docs/replatform/epics/E0-foundation/tickets/FND-002-result.md`. Record the authority matrix, single-writer rule, quarantine rule, RED/GREEN checker evidence, and any deviation/finding links.

```powershell
git add scripts/check-distributed-execution-foundation.mjs docs/architecture/distributed-execution-authority.md docs/architecture/decisions.md docs/replatform/epics/E0-foundation/tickets/FND-002-result.md
git commit -m "docs: lock distributed state authority"
```

---

### Task 3: FND-003 — Threat Model and Control Ownership

**Files:**
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Create: `docs/architecture/distributed-execution-threat-model.md`
- Modify: `docs/architecture/decisions.md` Decision #120

**Interfaces:**
- Consumes: lifecycle and authority records; existing Decision #103 plugin boundary and Decision #117 execution-target/gVisor boundary.
- Produces: stable control IDs `DE-01` through `DE-16`, severity, verification gate, and owning backlog ticket.

- [ ] **Step 1: Add a failing threat-model check**

Extend the checker with:

```js
await requireFile("docs/architecture/distributed-execution-threat-model.md", [
  "# Distributed Execution Threat Model",
  "## Trust boundaries",
  "## Threat and control register",
  "## Residual risks and release exclusions",
  "DE-01",
  "DE-16",
  "REL-001",
  "cloud plugins remain disabled",
]);
```

Run `pnpm check:distributed-foundation` and expect exit 1 naming the missing threat-model file.

- [ ] **Step 2: Write the trust-boundary section**

Create `docs/architecture/distributed-execution-threat-model.md` with these actors and crossings:

```markdown
# Distributed Execution Threat Model

## Trust boundaries

| Boundary | Trusted side | Untrusted/less-trusted side | Authentication |
|---|---|---|---|
| Browser/UI → control plane | tenant-scoped API | browser input | Better Auth/session + live membership |
| Worker → control plane | job/lease APIs | enrolled device | device key + short-lived audience-bound session |
| Worker host → sandbox | worker supervisor | tenant workload | provider/sandbox identity + lease fence |
| Control plane → object store | artifact broker | object bytes/keys | scoped service identity and presigned grants |
| Control plane → secret store | secret broker | secret material | service identity + tenant/lease authorization |
| Control plane → connector provider | MCP OAuth broker | access/refresh token and remote API | company-scoped grant + fenced refresh lease |
| Worker/sandbox → context APIs | control-plane memory/context service | company memory and actor scope | worker session + tenant/job/lease/fence authorization |
| Sandbox → network | filtered egress | external destinations | destination policy and credential-injecting proxy |
| Legacy → distributed owner | cutover transaction | duplicate executor | single-writer owner and rollout flag |
```

- [ ] **Step 3: Add the complete threat/control register**

Add a table containing exactly these rows:

| ID | Threat | Severity | Required control | Verification | Owner |
|---|---|---|---|---|---|
| DE-01 | Cross-tenant database access | Critical | non-owner role, forced RLS, tenant transaction | real PostgreSQL adversarial tests | TEN-002/TEN-003/TEN-005 |
| DE-02 | Mixed-tenant relationships | Critical | composite tenant constraints | negative SQL integration | TEN-004 |
| DE-03 | Worker credential replay | High | one-use enrollment, device key, short sessions | replay/expiry tests | JOB-002/WRK-002 |
| DE-04 | Double execution | Critical | atomic lease and fencing | concurrent claim/stale fence | JOB-003/JOB-004 |
| DE-05 | Late result overwrite | Critical | terminal immutability and quarantine | lost-ACK/replacement tests | JOB-005/JOB-006 |
| DE-06 | Cross-tenant object key | Critical | tenant/job prefixes and fenced commit | MinIO malicious-key tests | DAT-002 |
| DE-07 | Secret or connector-token exfiltration | Critical | existing OAuth broker, opaque execution handles, live lease/fence, broker-owned refresh, audit, redaction | wrong-tenant/fence/refresh/log corpus | DAT-004/DAT-005/REL-001 |
| DE-08 | Metadata/control-plane SSRF | Critical | default-deny egress and blocked ranges | DNS/IP/metadata tests | DAT-005 |
| DE-09 | Sandbox escape/host command | Critical | tenant commands only inside provider sandbox | image/capability/provider tests | WRK-004/REL-004 |
| DE-10 | Worker crash and orphan sandbox | High | restart reconciliation and provider cleanup | crash-point suite | WRK-007/CLI-004 |
| DE-11 | Browser cookie/trace leakage | High | job-scoped sensitive artifacts and TTL | browser retention/authorization | BRW-003/BRW-004/REL-001 |
| DE-12 | Service split brain | Critical | desired-state reconciler, generation, active fence | partition/drain/generation tests | SVC-002/SVC-003/SVC-005 |
| DE-13 | Noisy-neighbor starvation | High | per-Organization quotas/fair scheduling | multi-tenant load | JOB-007/REL-002 |
| DE-14 | Unsafe hosted fallback | Critical | startup rejects process-wide unsafe override | configuration test | FND-005 |
| DE-15 | Supply-chain image compromise | Critical | pinned digest, scan, signature, kill switch | release gate | REL-004 |
| DE-16 | Cloud plugin code escape | Critical | cloud plugins remain disabled pending separate worker | startup/policy tests | REL-005 |

Add a `## Residual risks and release exclusions` section that explicitly excludes public service ingress, cloud plugins, unvalidated gVisor bridge egress, active-active multi-region writes, and unattended orphan-output application.

- [ ] **Step 4: Link the threat model from Decision #120 and verify**

Add:

```markdown
The trust boundaries, mandatory controls, verification gates, and residual release exclusions are locked in [`distributed-execution-threat-model.md`](distributed-execution-threat-model.md).
```

Run `pnpm check:distributed-foundation`.

Expected: exit 0.

- [ ] **Step 5: Commit FND-003**

Create `docs/replatform/epics/E0-foundation/tickets/FND-003-result.md`. Record all 16 control IDs, threat-check RED/GREEN evidence, the release exclusions, and links for any unresolved security finding.

```powershell
git add scripts/check-distributed-execution-foundation.mjs docs/architecture/distributed-execution-threat-model.md docs/architecture/decisions.md docs/replatform/epics/E0-foundation/tickets/FND-003-result.md
git commit -m "docs: define distributed execution threat model"
```

---

### Task 4: FND-004 — Golden Journey and Failure Corpus

**Files:**
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Create: `tests/fixtures/distributed-execution/batch-success.json`
- Create: `tests/fixtures/distributed-execution/batch-cancel-during-execution.json`
- Create: `tests/fixtures/distributed-execution/browser-approval-download.json`
- Create: `tests/fixtures/distributed-execution/browser-denied-egress.json`
- Create: `tests/fixtures/distributed-execution/service-restart-checkpoint.json`
- Create: `tests/fixtures/distributed-execution/service-budget-stop.json`
- Create: `tests/fixtures/distributed-execution/README.md`

**Interfaces:**
- Consumes: workload names and lifecycle status sets from Task 1.
- Produces: `DistributedGoldenJourneyV1` JSON shape used by E1 compatibility tests, E6 fake provider, E7 coding, E8 browser, and E9 service plans.

- [ ] **Step 1: Add exact fixture validation to the checker**

Add the following functions and fixture list to `scripts/check-distributed-execution-foundation.mjs`:

```js
const fixtureFiles = [
  "batch-success.json",
  "batch-cancel-during-execution.json",
  "browser-approval-download.json",
  "browser-denied-egress.json",
  "service-restart-checkpoint.json",
  "service-budget-stop.json",
];
const allowedWorkloads = new Set(["batch", "browser_session", "service"]);

for (const name of fixtureFiles) {
  const relativePath = `tests/fixtures/distributed-execution/${name}`;
  try {
    const value = JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
    if (value.schemaVersion !== 1) errors.push(`${relativePath}: schemaVersion must be 1`);
    if (value.id !== name.replace(/\.json$/, "")) errors.push(`${relativePath}: id must match filename`);
    if (!allowedWorkloads.has(value.workloadType)) errors.push(`${relativePath}: invalid workloadType`);
    if (!Array.isArray(value.steps) || value.steps.length === 0) errors.push(`${relativePath}: steps must be non-empty`);
    if (!value.expected || typeof value.expected.terminalState !== "string") {
      errors.push(`${relativePath}: expected.terminalState is required`);
    }
    if (!Array.isArray(value.expected.auditActions) || value.expected.auditActions.length === 0) {
      errors.push(`${relativePath}: expected.auditActions must be non-empty`);
    }
  } catch (error) {
    errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

- [ ] **Step 2: Run the checker and verify RED**

Run `pnpm check:distributed-foundation`.

Expected: exit 1 naming all six missing fixture files.

- [ ] **Step 3: Create the six deterministic JSON fixtures**

Use this exact shape for every file:

```ts
interface DistributedGoldenJourneyV1 {
  schemaVersion: 1;
  id: string;
  workloadType: "batch" | "browser_session" | "service";
  purpose: string;
  steps: Array<{
    action: string;
    at?: string;
    emits?: string[];
  }>;
  failureInjection: null | {
    point: string;
    effect: string;
  };
  expected: {
    terminalState: string;
    artifacts: string[];
    auditActions: string[];
    forbiddenEffects: string[];
  };
}
```

Populate the files with these exact scenario values:

```json
// batch-success.json
{
  "schemaVersion": 1,
  "id": "batch-success",
  "workloadType": "batch",
  "purpose": "A coding job stages a base snapshot and returns a reviewable patch.",
  "steps": [
    { "action": "submit" },
    { "action": "lease_and_ack", "emits": ["attempt_started"] },
    { "action": "stage_workspace" },
    { "action": "execute_adapter", "emits": ["log", "usage"] },
    { "action": "upload_patch", "emits": ["artifact_prepared"] },
    { "action": "complete", "emits": ["terminal"] }
  ],
  "failureInjection": null,
  "expected": {
    "terminalState": "succeeded",
    "artifacts": ["workspace_patch"],
    "auditActions": ["job.submitted", "lease.issued", "artifact.committed", "job.succeeded"],
    "forbiddenEffects": ["worker_database_write", "host_command_execution"]
  }
}

// batch-cancel-during-execution.json
{
  "schemaVersion": 1,
  "id": "batch-cancel-during-execution",
  "workloadType": "batch",
  "purpose": "Cancellation during adapter execution kills the process tree and fences output.",
  "steps": [
    { "action": "submit" },
    { "action": "lease_and_ack" },
    { "action": "execute_adapter", "emits": ["attempt_started", "log"] },
    { "action": "request_cancel", "at": "running" },
    { "action": "kill_process_tree", "emits": ["terminal"] },
    { "action": "attempt_late_upload" }
  ],
  "failureInjection": { "point": "running", "effect": "cancel_requested" },
  "expected": {
    "terminalState": "cancelled",
    "artifacts": [],
    "auditActions": ["job.cancel_requested", "sandbox.killed", "job.cancelled"],
    "forbiddenEffects": ["late_artifact_commit", "late_secret_fetch", "automatic_retry"]
  }
}

// browser-approval-download.json
{
  "schemaVersion": 1,
  "id": "browser-approval-download",
  "workloadType": "browser_session",
  "purpose": "A browser session pauses for approval and commits bounded evidence.",
  "steps": [
    { "action": "submit" },
    { "action": "lease_and_ack" },
    { "action": "launch_browser", "emits": ["attempt_started"] },
    { "action": "request_approval", "emits": ["browser_approval_requested"] },
    { "action": "approve" },
    { "action": "download", "emits": ["browser_observation", "artifact_prepared"] },
    { "action": "complete", "emits": ["terminal"] }
  ],
  "failureInjection": null,
  "expected": {
    "terminalState": "succeeded",
    "artifacts": ["screenshot", "playwright_trace", "download"],
    "auditActions": ["browser.approval_requested", "browser.approval_granted", "artifact.committed", "job.succeeded"],
    "forbiddenEffects": ["public_cdp_endpoint", "cookie_in_event_payload"]
  }
}

// browser-denied-egress.json
{
  "schemaVersion": 1,
  "id": "browser-denied-egress",
  "workloadType": "browser_session",
  "purpose": "Browser access to metadata and private networks fails closed.",
  "steps": [
    { "action": "submit" },
    { "action": "lease_and_ack" },
    { "action": "launch_browser" },
    { "action": "navigate", "at": "http://169.254.169.254/" },
    { "action": "record_denial", "emits": ["network_denied", "terminal"] }
  ],
  "failureInjection": { "point": "navigation", "effect": "metadata_destination" },
  "expected": {
    "terminalState": "failed",
    "artifacts": ["screenshot"],
    "auditActions": ["network.denied", "job.failed"],
    "forbiddenEffects": ["metadata_response", "private_network_response", "credential_disclosure"]
  }
}

// service-restart-checkpoint.json
{
  "schemaVersion": 1,
  "id": "service-restart-checkpoint",
  "workloadType": "service",
  "purpose": "A failed service instance is replaced from an approved checkpoint.",
  "steps": [
    { "action": "set_desired_running" },
    { "action": "reconcile_and_lease" },
    { "action": "report_healthy", "emits": ["service_health"] },
    { "action": "commit_checkpoint", "emits": ["checkpoint_prepared"] },
    { "action": "crash" },
    { "action": "expire_lease" },
    { "action": "reconcile_replacement" },
    { "action": "restore_checkpoint", "emits": ["service_health"] }
  ],
  "failureInjection": { "point": "healthy", "effect": "worker_process_crash" },
  "expected": {
    "terminalState": "healthy",
    "artifacts": ["service_checkpoint"],
    "auditActions": ["service.instance_lost", "service.instance_replaced", "service.checkpoint_restored"],
    "forbiddenEffects": ["two_active_fences", "unapproved_checkpoint_restore"]
  }
}

// service-budget-stop.json
{
  "schemaVersion": 1,
  "id": "service-budget-stop",
  "workloadType": "service",
  "purpose": "Control-plane budget exhaustion stops a running service.",
  "steps": [
    { "action": "set_desired_running" },
    { "action": "reconcile_and_lease" },
    { "action": "report_healthy", "emits": ["service_health", "usage"] },
    { "action": "exhaust_budget" },
    { "action": "request_stop" },
    { "action": "graceful_stop", "emits": ["terminal"] }
  ],
  "failureInjection": { "point": "healthy", "effect": "budget_exhausted" },
  "expected": {
    "terminalState": "stopped",
    "artifacts": [],
    "auditActions": ["budget.exhausted", "service.stop_requested", "service.instance_stopped"],
    "forbiddenEffects": ["worker_budget_override", "automatic_restart_after_budget_stop"]
  }
}
```

Remove the `// filename` separator lines when writing the individual JSON files because JSON does not support comments.

- [ ] **Step 4: Document fixture semantics and verify GREEN**

Create `tests/fixtures/distributed-execution/README.md` documenting that fixtures are immutable behavioral inputs, contain no credentials, use deterministic IDs/actions, and may receive only additive fields within `schemaVersion: 1`; breaking changes require a new versioned directory.

Run:

```powershell
pnpm check:distributed-foundation
```

Expected: exit 0.

- [ ] **Step 5: Commit FND-004**

Create `docs/replatform/epics/E0-foundation/tickets/FND-004-result.md`. Record all six fixture IDs, checker RED/GREEN evidence, JSON parse results, and the immutability/versioning rule.

```powershell
git add scripts/check-distributed-execution-foundation.mjs tests/fixtures/distributed-execution docs/replatform/epics/E0-foundation/tickets/FND-004-result.md
git commit -m "test: add distributed execution golden journeys"
```

---

### Task 5: FND-005 — Rollout Policy, Hosted Safety, Custodians, and CI Gate

**Files:**
- Create: `server/src/config/distributed-execution.ts`
- Create: `server/src/__tests__/distributed-execution-policy.test.ts`
- Modify: `server/src/config.ts:34-86,166-172,260-310`
- Modify: `server/src/__tests__/config.test.ts`
- Modify: `server/src/services/unsandboxed-multitenant-guard.ts:1-6`
- Create: `docs/architecture/distributed-execution-delivery-policy.md`
- Modify: `docs/architecture/decisions.md` Decision #120
- Modify: `docs/deploy/environment-variables.md`
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Modify: `.github/workflows/pr.yml:100-111`

**Interfaces:**
- Consumes: `DeploymentMode`, environment values, existing `AOA_ALLOW_UNSANDBOXED_MULTITENANT` behavior, and Organization rollout boolean supplied later by E3/E10.
- Produces:
  - `DISTRIBUTED_EXECUTION_ENABLED_ENV = "AOA_DISTRIBUTED_EXECUTION_ENABLED"`
  - `UNSANDBOXED_MULTITENANT_OPT_IN_ENV = "AOA_ALLOW_UNSANDBOXED_MULTITENANT"`
  - `readDistributedExecutionDeploymentFlag(env): boolean`
  - `resolveDistributedExecutionRollout(input): DistributedExecutionRolloutDecision`
  - `assertHostedExecutionStartupSafe(input): void`
  - `Config.distributedExecutionEnabled: boolean`

- [ ] **Step 1: Write failing rollout-policy tests**

Create `server/src/__tests__/distributed-execution-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertHostedExecutionStartupSafe,
  DISTRIBUTED_EXECUTION_ENABLED_ENV,
  readDistributedExecutionDeploymentFlag,
  resolveDistributedExecutionRollout,
  UNSANDBOXED_MULTITENANT_OPT_IN_ENV,
} from "../config/distributed-execution.js";

describe("distributed execution rollout policy", () => {
  it("defaults the deployment flag off", () => {
    expect(readDistributedExecutionDeploymentFlag({})).toBe(false);
  });

  it.each(["1", "true", "yes", "on", " TRUE "])("accepts enabled value %s", (value) => {
    expect(readDistributedExecutionDeploymentFlag({ [DISTRIBUTED_EXECUTION_ENABLED_ENV]: value })).toBe(true);
  });

  it.each(["0", "false", "no", "off", ""])("accepts disabled value %s", (value) => {
    expect(readDistributedExecutionDeploymentFlag({ [DISTRIBUTED_EXECUTION_ENABLED_ENV]: value })).toBe(false);
  });

  it("rejects an ambiguous deployment flag", () => {
    expect(() => readDistributedExecutionDeploymentFlag({
      [DISTRIBUTED_EXECUTION_ENABLED_ENV]: "sometimes",
    })).toThrow(DISTRIBUTED_EXECUTION_ENABLED_ENV);
  });

  it("requires both deployment and Organization enablement", () => {
    expect(resolveDistributedExecutionRollout({
      deploymentMode: "cloud_auth",
      deploymentEnabled: true,
      organizationEnabled: true,
    })).toEqual({ enabled: true, reason: "enabled" });
    expect(resolveDistributedExecutionRollout({
      deploymentMode: "cloud_auth",
      deploymentEnabled: false,
      organizationEnabled: true,
    })).toEqual({ enabled: false, reason: "deployment_disabled" });
    expect(resolveDistributedExecutionRollout({
      deploymentMode: "cloud_auth",
      deploymentEnabled: true,
      organizationEnabled: false,
    })).toEqual({ enabled: false, reason: "organization_disabled" });
  });

  it("forbids the process-wide unsafe override in cloud_auth", () => {
    expect(() => assertHostedExecutionStartupSafe({
      deploymentMode: "cloud_auth",
      env: { [UNSANDBOXED_MULTITENANT_OPT_IN_ENV]: "1" },
    })).toThrow(/forbidden.*cloud_auth/i);
  });

  it("does not change self-hosted startup", () => {
    expect(() => assertHostedExecutionStartupSafe({
      deploymentMode: "local_trusted",
      env: { [UNSANDBOXED_MULTITENANT_OPT_IN_ENV]: "1" },
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Add failing `loadConfig()` integration cases and verify RED**

In `server/src/__tests__/config.test.ts`, save/restore both new environment variables alongside the existing variables. Add:

```ts
describe("distributed execution", () => {
  it("defaults off", () => {
    delete process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
    expect(loadConfig().distributedExecutionEnabled).toBe(false);
  });

  it("parses an explicit deployment enablement", () => {
    process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "true";
    expect(loadConfig().distributedExecutionEnabled).toBe(true);
  });

  it("refuses cloud_auth with the unsafe process-wide execution override", () => {
    process.env.AOA_DEPLOYMENT_MODE = "cloud_auth";
    process.env.AOA_ALLOW_UNSANDBOXED_MULTITENANT = "1";
    expect(() => loadConfig()).toThrow(/AOA_ALLOW_UNSANDBOXED_MULTITENANT.*cloud_auth/i);
  });
});
```

Run:

```powershell
pnpm exec vitest run server/src/__tests__/distributed-execution-policy.test.ts server/src/__tests__/config.test.ts
```

Expected: FAIL because `server/src/config/distributed-execution.ts` and `Config.distributedExecutionEnabled` do not exist.

- [ ] **Step 3: Implement the pure configuration policy**

Create `server/src/config/distributed-execution.ts`:

```ts
import type { DeploymentMode } from "@armyofagents/shared";

export const DISTRIBUTED_EXECUTION_ENABLED_ENV = "AOA_DISTRIBUTED_EXECUTION_ENABLED";
export const UNSANDBOXED_MULTITENANT_OPT_IN_ENV = "AOA_ALLOW_UNSANDBOXED_MULTITENANT";

type Env = Record<string, string | undefined>;

function parseBooleanEnv(env: Env, name: string, defaultValue: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name}=${JSON.stringify(env[name])} is not a boolean flag`);
}

export function readDistributedExecutionDeploymentFlag(env: Env): boolean {
  return parseBooleanEnv(env, DISTRIBUTED_EXECUTION_ENABLED_ENV, false);
}

export interface DistributedExecutionRolloutInput {
  deploymentMode: DeploymentMode;
  deploymentEnabled: boolean;
  organizationEnabled: boolean;
}

export type DistributedExecutionRolloutDecision =
  | { enabled: true; reason: "enabled" }
  | { enabled: false; reason: "deployment_disabled" | "organization_disabled" };

export function resolveDistributedExecutionRollout(
  input: DistributedExecutionRolloutInput,
): DistributedExecutionRolloutDecision {
  if (!input.deploymentEnabled) return { enabled: false, reason: "deployment_disabled" };
  if (!input.organizationEnabled) return { enabled: false, reason: "organization_disabled" };
  return { enabled: true, reason: "enabled" };
}

export function assertHostedExecutionStartupSafe(input: {
  deploymentMode: DeploymentMode;
  env: Env;
}): void {
  if (
    input.deploymentMode === "cloud_auth" &&
    parseBooleanEnv(input.env, UNSANDBOXED_MULTITENANT_OPT_IN_ENV, false)
  ) {
    throw new Error(
      `${UNSANDBOXED_MULTITENANT_OPT_IN_ENV} is forbidden in cloud_auth; ` +
        "tenant workloads must use an isolated worker/provider boundary",
    );
  }
}
```

Modify `server/src/services/unsandboxed-multitenant-guard.ts` to import and re-export the canonical constant:

```ts
import { UNSANDBOXED_MULTITENANT_OPT_IN_ENV } from "../config/distributed-execution.js";
export { UNSANDBOXED_MULTITENANT_OPT_IN_ENV } from "../config/distributed-execution.js";
```

Delete its local constant declaration. Do not change `assertUnsandboxedMultitenantAllowed`; self-hosted direct calls and existing focused tests retain their behavior, while real `cloud_auth` startup now rejects the override earlier.

- [ ] **Step 4: Wire the default-off flag and startup assertion into `loadConfig()`**

Import the new functions into `server/src/config.ts`. Add `distributedExecutionEnabled: boolean` to `Config`. Immediately after resolving `deploymentMode`, compute and assert:

```ts
const distributedExecutionEnabled = readDistributedExecutionDeploymentFlag(process.env);
assertHostedExecutionStartupSafe({ deploymentMode, env: process.env });
```

Return `distributedExecutionEnabled` next to `deploymentMode`. Do not call any scheduler, adapter, or worker code.

- [ ] **Step 5: Verify focused GREEN and existing unsafe-guard compatibility**

Run:

```powershell
pnpm exec vitest run server/src/__tests__/distributed-execution-policy.test.ts server/src/__tests__/config.test.ts server/src/__tests__/unsandboxed-multitenant-guard.test.ts
pnpm --filter @armyofagents/server typecheck
```

Expected: all focused tests PASS and server typecheck exits 0.

- [ ] **Step 6: Add delivery policy and environment documentation**

Create `docs/architecture/distributed-execution-delivery-policy.md` with:

- named roles `Protocol Custodian`, `Migration Custodian`, `Integration Gate Owner`, and `Security Gate Owner`;
- one ticket/branch/worktree per implementation agent;
- protocol and migration edits serialized through their custodian;
- focused tests on every ticket, D1 every 5–10 merges, provider lanes nightly;
- rollout order deployment flag → Organization flag → workload flag;
- rollback order stop new leases → drain/cancel active leases → disable Organization → disable deployment;
- a statement that feature-flagged code still requires tests;
- a statement that the control plane never receives a Docker socket and workers never receive database credentials.

Extend the foundation checker:

```js
await requireFile("docs/architecture/distributed-execution-delivery-policy.md", [
  "# Distributed Execution Delivery Policy",
  "Protocol Custodian",
  "Migration Custodian",
  "Integration Gate Owner",
  "Security Gate Owner",
  "AOA_DISTRIBUTED_EXECUTION_ENABLED",
  "one ticket",
  "5–10",
]);
```

Document both environment variables in `docs/deploy/environment-variables.md`: distributed execution defaults off; enabling it creates no worker by itself; Organization rollout remains separately required; the unsafe override is rejected in `cloud_auth` and is self-hosted emergency compatibility only.

Add delivery-policy and threat-model links to Decision #120.

- [ ] **Step 7: Make the foundation checker an always-on policy gate**

In `.github/workflows/pr.yml`, after `Setup Node.js` in the `policy` job, add:

```yaml
      - name: Distributed execution foundation contracts
        run: node scripts/check-distributed-execution-foundation.mjs
```

This job deliberately uses only Node standard-library APIs because `policy` does not install dependencies.

- [ ] **Step 8: Run the complete E0 verification gate**

Run:

```powershell
pnpm check:distributed-foundation
pnpm exec vitest run server/src/__tests__/distributed-execution-policy.test.ts server/src/__tests__/config.test.ts server/src/__tests__/unsandboxed-multitenant-guard.test.ts
pnpm --filter @armyofagents/server typecheck
git diff --check
git diff -- pnpm-lock.yaml
```

Expected:

- foundation checker exits 0;
- focused tests pass;
- server typecheck exits 0;
- `git diff --check` exits 0;
- `git diff -- pnpm-lock.yaml` prints nothing.

- [ ] **Step 9: Commit FND-005**

Create `docs/replatform/epics/E0-foundation/tickets/FND-005-result.md`. Record the rollout-policy test counts, server typecheck, hosted unsafe-override denial, CI policy step, documentation, and confirmation that no scheduler/provider path was enabled.

```powershell
git add server/src/config/distributed-execution.ts server/src/__tests__/distributed-execution-policy.test.ts server/src/config.ts server/src/__tests__/config.test.ts server/src/services/unsandboxed-multitenant-guard.ts docs/architecture/distributed-execution-delivery-policy.md docs/architecture/decisions.md docs/deploy/environment-variables.md scripts/check-distributed-execution-foundation.mjs .github/workflows/pr.yml docs/replatform/epics/E0-foundation/tickets/FND-005-result.md
git commit -m "feat: gate distributed execution rollout"
```

---

### Task 6: E0 Integration Gate and Handoff

**Files:**
- Read: all files changed by Tasks 1–5
- Modify only if verification exposes a scoped defect

**Interfaces:**
- Consumes: FND-001 through FND-005 commits.
- Produces: evidence that E1 may rely on immutable workload names, authority rules, threat control IDs, fixtures, rollout policy, and CI gate.

- [ ] **Step 1: Verify commit and file boundaries**

Run:

```powershell
git status --short
git log -6 --oneline
git diff HEAD~5..HEAD --check
```

Expected: clean worktree; five scoped E0 commits; no whitespace errors.

- [ ] **Step 2: Run the required repository checks for the E0 code diff**

Run:

```powershell
pnpm -r typecheck
pnpm test:run
pnpm build
```

Expected: all commands exit 0. If the existing repository baseline fails outside E0 paths, preserve full output, prove the focused E0 gate remains green, and open a separate baseline ticket rather than weakening E0 tests.

- [ ] **Step 3: Record E0 evidence**

Create the QA record path produced by this command from the QA-result template:

```powershell
$utcDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$qaRecord = "docs/replatform/epics/E0-foundation/qa/$utcDate-focused-e0-completion.md"
$qaRecord
```

Record:

- commit IDs for FND-001 through FND-005;
- exact commands and exit codes;
- ticket IDs covered;
- confirmation that `pnpm-lock.yaml` did not change;
- confirmation that distributed execution remains default-off;
- confirmation that no job, worker, provider, or database schema code was added.

Create the handoff path `docs/replatform/epics/E0-foundation/handoffs/$utcDate-epic-completion.md` from the handoff template. Link FND-001 through FND-005 results and `$qaRecord`. Set the decision to `pass` only if Step 2 passed on the same revision; otherwise use `fail` and keep E0 in `gate_review`.

Ticket owners move E0 from `planned` to `in_progress` when execution starts; the Integration Gate Owner moves it to `gate_review` after all five result records exist. Change E0 from `gate_review` to `complete` in `docs/replatform/epics/E0-foundation/README.md` and `docs/replatform/epics/README.md` only for a passing handoff. Commit these evidence files separately:

```powershell
git add docs/replatform/epics/E0-foundation docs/replatform/epics/README.md
git commit -m "docs: record E0 completion evidence"
```

- [ ] **Step 4: Mark E1 unblocked**

E1 may begin only when:

- `pnpm check:distributed-foundation` is green on main;
- Decision #120 and all four architecture records are merged;
- all six fixtures are merged;
- the unsafe hosted override regression test is green;
- the worktree is clean.
