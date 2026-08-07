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
- [`../../test-gates.md`](../../test-gates.md), [`../../accepted-caveats.md`](../../accepted-caveats.md), and [`../../agent-execution-guide.md`](../../agent-execution-guide.md) are normative inputs.

---

## File responsibility map

| File | Responsibility |
|---|---|
| `docs/architecture/distributed-execution-lifecycles.md` | Canonical workload and transition semantics for batch, browser session, and service workloads. |
| `docs/architecture/distributed-execution-lifecycles.json` | Machine-readable job/attempt/lease/browser/service transition authority and forbidden transitions. |
| `docs/architecture/distributed-execution-authority.md` | Source-of-truth, synchronization, single-writer cutover, and late-result rules. |
| `docs/architecture/distributed-execution-threat-model.md` | Trust boundaries, threats, required controls, residual risk, and ticket ownership. |
| `docs/architecture/distributed-execution-threat-controls.json` | Machine-readable crossing/control ownership and release-test traceability. |
| `docs/architecture/distributed-execution-delivery-policy.md` | Custodian roles, merge gates, flags, evidence, and parallel-agent rules. |
| `docs/architecture/decisions.md` | Decision #120 summary and links to the four focused records; existing Decisions #118/#119 remain unchanged. |
| `tests/fixtures/distributed-execution/*.json` | Deterministic golden journeys and failure scenarios consumed by later protocol/provider suites. |
| `tests/fixtures/distributed-execution/schema-v1.json` | Strict schema for tenant, identity, inputs, events, cost, cancellation, cleanup, and forbidden effects. |
| `scripts/check-distributed-execution-foundation.mjs` | Dependency-free structural checker used locally and in the always-on policy job. |
| `server/src/config/distributed-execution.ts` | Pure environment parsing, hosted safety assertion, and rollout decision. |
| `server/src/config.ts` | Exposes the default-off deployment flag and runs the hosted startup safety assertion. |
| `server/src/services/unsandboxed-multitenant-guard.ts` | Imports the canonical unsafe-override environment name from config; runtime sink behavior otherwise remains unchanged. |
| `server/src/__tests__/distributed-execution-policy.test.ts` | Pure rollout and hosted safety regression tests. |
| `server/src/__tests__/config.test.ts` | `loadConfig()` environment/default/startup integration tests. |
| `.github/workflows/pr.yml` | Runs the structural foundation checker in the always-on `policy` job. |
| `docs/deploy/environment-variables.md` | Documents the default-off deployment flag and hosted override prohibition. |

## Approved foundation hardening amendment

This section is normative and replaces any narrower checker, lifecycle, trust-table, fixture-shape, QA-name, or completion instruction later in this plan. The later snippets remain useful sequencing examples, but an agent must implement the stricter contract below when they conflict.

### FND-001 structured lifecycle authority

- Create both `distributed-execution-lifecycles.md` and `distributed-execution-lifecycles.json`.
- The JSON owns separate `job`, `attempt`, `lease`, `browserSession`, `serviceDesired`, and `serviceInstance` state sets, allowed edges, guarded job-edge reasons, terminal states, and forbidden cross-lifecycle edges. Job `dead_letter` edges require `policy_exhausted`; job `failed` edges require `non_retryable_failure`; no context-free predicate may bypass those guards.
- Use the exact job/attempt/lease states in [`../../program-design.md`](../../program-design.md). `dead_letter` must be reachable through exhausted job policy; retry creates a new attempt; service `healthy|stopped|lost` is not a generic attempt terminal.
- Lease loss revokes effect authority but preserves a separate resource/ownership/generation/deadline-bound monotonic cleanup authority for matching-resource list/inspect and cancel/kill/destroy/idempotent reconciliation only. It cannot create, execute, resume, checkpoint, reveal foreign resources, or open egress; lifecycle diagrams and cancellation/provider-interruption fixtures show this split.
- Include Mermaid diagrams, exhaustive allowed/forbidden transition tables, batch/browser/service examples, cancellation/fence/quarantine/cleanup deadlines, E2B pause/resume semantics, and a mapping from current heartbeat/Commander/crew/run concepts.
- The checker parses the JSON, validates graph reachability and terminal immutability, extracts the Markdown tables, and fails on any mismatch. String-fragment presence alone is insufficient.

### FND-003 complete trust-crossing contract

- Create `distributed-execution-threat-controls.json`; the Markdown table is a rendered/explained view of the same IDs.
- Every crossing contains `id`, `trustedSide`, `lessTrustedSide`, `authentication`, `authorization`, `confidentiality`, `integrity`, `revocation`, `audit`, `failureMode`, `severity`, `ownerTickets`, and `verificationLane`.
- Include browser/user, worker, sandbox, target registry/placement, provider management, object store, secret/OAuth broker, context/memory API, egress, legacy cutover, database, realtime broker, telemetry, backup/restore, desktop installer/updater, local folder, and plugin crossings.
- Add threats for malicious capability claims, owner-credential misrouting, target-generation replacement, desktop supply chain/local folder mutation, multi-replica coordination, real-provider isolation, quarantine promotion, and evidence overwrite.
- Add the post-fence cleanup crossing/threat: cleanup must remain possible, least-privilege, ownership-scoped, idempotent, deadline-bounded, and incapable of restoring effect authority.
- The checker rejects missing fields, duplicate IDs, unknown owner ticket IDs, and every Critical/High threat without a release test. It validates every control ID rather than checking only the first/last ID.

### FND-004 strict fixture corpus

- Create `schema-v1.json` and validate each fixture against it without adding a new dependency. The validator checks types, formats, uniqueness, referential consistency, and bounded values—not only field presence.
- Every fixture includes Organization/Company/actor/owner identity; placement/target policy; immutable input/workspace base; job/attempt/lease/fence; ordered expected events and `eventDigest` values computed over the constrained RFC 8785 canonical immutable-event contract locked here and reused by PRT-004; artifacts; cost/usage bounds; cancellation/approval points; cleanup; timing; audit actions; and forbidden effects.
- In addition to the six original journeys, add `service-provider-pause-resume.json`, `late-output-quarantine.json`, and `plaintext-secret-in-argv-rejected.json`.
- `late-output-quarantine` proves the separate device-authenticated prefix/operation cannot update the old attempt or select a checkpoint. `service-provider-pause-resume` spans replacement instances and does not claim one uninterrupted E2B process.

### FND-005 gates and evidence integrity

- Link the delivery policy to [`../../test-gates.md`](../../test-gates.md) and make D0–D6 plus `blocked_external` valid QA lanes/decisions.
- Flags resolve deployment → Organization → workload, with hard-negative controls for public ingress, cloud plugins, and the hosted unsafe override.
- Include two-replica/shared-admission configuration ownership, named protocol/migration/security custodians, and the `E6-D1-FOUNDATION` handoff.
- Record a start SHA before Task 1. Integration diff/commit verification uses that SHA and the five recorded ticket commits, never `HEAD~5`.
- QA names are `<date>-<lane>-<scope>-<sha12>-a<attempt>.md`; reruns always increment attempt and never overwrite evidence.
- A hard-invariant or required repository failure keeps E0 in `gate_review`. A focused pass or “baseline issue” note cannot convert it to completion; this program has no baseline-failure waiver path.

---

### Task 1: FND-001 — Workload Lifecycle Contract

**Files:**
- Create: `scripts/check-distributed-execution-foundation.mjs`
- Create: `scripts/check-distributed-execution-foundation.test.mjs`
- Modify: `package.json`
- Create: `docs/architecture/distributed-execution-lifecycles.md`
- Create: `docs/architecture/distributed-execution-lifecycles.json`
- Modify: `docs/architecture/decisions.md` after Decision #119

**Interfaces:**
- Consumes: approved workload names `batch`, `browser_session`, `service` and the program design’s lifecycle rules.
- Produces: `pnpm check:distributed-foundation`; Decision #120; machine-readable and human-readable job/attempt/lease/workload transition authority consumed by E1 `states.ts`.

- [ ] **Step 1: Add a failing foundation checker and package script**

Before changing files, create `docs/replatform/epics/E0-foundation/tickets/FND-001-result.md` from the ticket-result template, set status to `in_progress`, and write the exact line `**Start SHA:** <40-lowercase-hex>` from `git rev-parse HEAD`. Commit it with the eventual FND-001 implementation, but do not defer capturing the value. Every later ticket result records its exact commit; the Integration Gate uses those identities rather than assuming commit distance.

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
  "## Job lifecycle",
  "## Attempt lifecycle",
  "## Lease lifecycle",
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

// This fragment check is only the intentional RED scaffold. Before FND-001
// turns GREEN, replace it with the structured JSON/Markdown parity,
// reachability, forbidden-edge, and terminal-immutability checks required by
// the approved hardening amendment.

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

## Job lifecycle

Statuses: `queued`, `running`, `cancel_requested`, `succeeded`, `failed`, `cancelled`, `dead_letter`.

Allowed transitions:

| From | To |
|---|---|
| `queued` | `running`, `cancel_requested`, `cancelled` |
| `running` | `cancel_requested`, `succeeded`, `failed`, `dead_letter` |
| `cancel_requested` | `cancelled`, `failed`, `dead_letter` |

`dead_letter` means retry/reconciliation policy is exhausted; `failed` is non-retryable aggregate failure. Terminal states are immutable. While retry remains possible, the job stays `running`.

## Attempt lifecycle

Statuses: `pending`, `offered`, `leased`, `running`, `cancel_requested`, `succeeded`, `failed`, `cancelled`, `expired`. Retry creates a new increasing `pending` attempt; it never reopens a terminal attempt.

## Lease lifecycle

Statuses: `offered`, `active`, `released`, `expired`, `revoked`. A replacement creates a new lease and fence. Lease terminals are immutable.

## Batch lifecycle

Batch workload completion is represented by its attempt terminal plus declared patch/artifact output. It does not add another delivery state machine.

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
- Lease loss preserves only the monotonic provider cleanup authority: matching-resource list/inspect with a management-only safe projection and cancel/kill/destroy/idempotent reconciliation remain available, while create/execute/resume/checkpoint/egress and command/env/log/secret/customer-byte inspection remain forbidden.
- A late worker may upload an orphan patch or artifact only to quarantine; it cannot update the authoritative run.
- Batch and browser attempts eventually terminate after cancellation.
- Services use graceful stop followed by a bounded force-kill deadline.
```

The command accepts an optional `--root <fixture-directory>` only for its dependency-free `node:test` harness and defaults to `process.cwd()` in normal/CI use. `scripts/check-distributed-execution-foundation.test.mjs` builds minimal temporary document trees and proves missing files, malformed JSON, missing required fields, semantic mismatch, and filesystem errors fail with the exact path/cause. Every later FND task extends this same mutation corpus before expanding the checker; string-fragment presence is never sufficient evidence for a structured contract.

Create `docs/architecture/distributed-execution-lifecycles.json` from the same state sets and transitions, including guarded edge reasons, terminal sets, and forbidden cross-lifecycle edges. Add `## Lifecycle diagrams`, `## Worked journeys`, `## Deadlines and provider interruption`, and `## Legacy concept mapping` to the Markdown; cover batch, browser, service, cancellation/fence/quarantine/cleanup, E2B pause-or-replacement, and current heartbeat/Commander/crew/run concepts. Extend the checker to parse both files, validate reachability/guarded edges/terminal immutability, and compare the rendered Markdown tables to the JSON authority. Extend the mutation tests to delete an allowed edge, add a terminal outgoing edge, remove a guard, and drift a Markdown row; every mutation must fail.

Append Decision #120 to `docs/architecture/decisions.md` after the existing memory Decisions #118 and #119:

```markdown
## Decision #120 — Cloud control plane uses a fenced outbound worker protocol with distinct batch, browser-session, and service lifecycles (2026-08-07)

**Status:** Locked for the re-platform program. Implementation is phased and default-off.

AoA retains its product/domain model but moves hosted execution behind a separately deployable worker protocol. PostgreSQL remains authoritative for policy and execution state. Workers lease work outbound and may mutate the control plane only through an active attempt/lease fence. `batch`, `browser_session`, and `service` are distinct workload classes; a service is desired state plus reconciled instances, not an infinitely renewed batch job.

The canonical lifecycle status sets, allowed transitions, cancellation behavior, and lease-loss rules are in [`distributed-execution-lifecycles.md`](distributed-execution-lifecycles.md) and its machine-readable peer `distributed-execution-lifecycles.json`. This decision extends Decision #117; it does not make the deferred gVisor pool implemented and does not permit execution on the hosted control-plane process.
```

- [ ] **Step 4: Run the checker and verify GREEN**

Run:

```powershell
pnpm check:distributed-foundation
node --test scripts/check-distributed-execution-foundation.test.mjs
```

Expected: exit 0 and `distributed execution foundation: PASS`.

- [ ] **Step 5: Commit FND-001**

Before staging, update the existing `FND-001-result.md` to status `gate_review` without changing its captured Start SHA. List the lifecycle document, Decision #120, checker, and package script; record both the intentional RED run and final GREEN run; set deviations/findings/follow-ups to `None` unless an epic finding or approved decision exists.

```powershell
git add package.json scripts/check-distributed-execution-foundation.mjs scripts/check-distributed-execution-foundation.test.mjs docs/architecture/distributed-execution-lifecycles.md docs/architecture/distributed-execution-lifecycles.json docs/architecture/decisions.md docs/replatform/epics/E0-foundation/tickets/FND-001-result.md
git commit -m "docs: lock distributed workload lifecycles"
```

---

### Task 2: FND-002 — Authority and Migration Contract

**Files:**
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Modify: `scripts/check-distributed-execution-foundation.test.mjs`
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

Extend the mutation test with missing authority rows, a worker-database peer claim, dual-writer cutover, ordinary stale commit, and auto-promoted quarantine cases. Run:

```powershell
pnpm check:distributed-foundation
node --test scripts/check-distributed-execution-foundation.test.mjs
```

Expected: exit 0.

Create `docs/replatform/epics/E0-foundation/tickets/FND-002-result.md`. Record the authority matrix, single-writer rule, quarantine rule, RED/GREEN checker evidence, and any deviation/finding links.

```powershell
git add scripts/check-distributed-execution-foundation.mjs scripts/check-distributed-execution-foundation.test.mjs docs/architecture/distributed-execution-authority.md docs/architecture/decisions.md docs/replatform/epics/E0-foundation/tickets/FND-002-result.md
git commit -m "docs: lock distributed state authority"
```

---

### Task 3: FND-003 — Threat Model and Control Ownership

**Files:**
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Modify: `scripts/check-distributed-execution-foundation.test.mjs`
- Create: `docs/architecture/distributed-execution-threat-model.md`
- Create: `docs/architecture/distributed-execution-threat-controls.json`
- Modify: `docs/architecture/decisions.md` Decision #120

**Interfaces:**
- Consumes: lifecycle and authority records; existing Decision #103 plugin boundary and Decision #117 execution-target/gVisor boundary.
- Produces: stable control IDs, complete trust-crossing attributes, severity, verification gate, and owning backlog tickets in Markdown and JSON.

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
  "DE-17",
  "REL-001",
  "cloud plugins remain disabled",
]);
```

Run `pnpm check:distributed-foundation` and expect exit 1 naming the missing threat-model file.

- [ ] **Step 2: Write the trust-boundary section**

Create `docs/architecture/distributed-execution-threat-model.md` and `distributed-execution-threat-controls.json` with these actors and crossings. The four-column table below is only a reading aid; the delivered table/JSON must include every field in the approved hardening amendment:

```markdown
# Distributed Execution Threat Model

## Trust boundaries

| Boundary | Trusted side | Untrusted/less-trusted side | Authentication |
|---|---|---|---|
| Browser/UI → control plane | tenant-scoped API | browser input | Better Auth/session + live membership |
| Worker → control plane | job/lease APIs | enrolled device | device key + short-lived audience-bound session |
| Worker host → sandbox | worker supervisor | tenant workload | provider/sandbox identity + lease fence |
| Provider manager → expired/replaced resource | cleanup-only management boundary | stale tenant effect authority and foreign/sensitive resource data | resource/ownership/generation/deadline-bound monotonic cleanup authority with management-only inspect projection |
| Control plane → object store | artifact broker | object bytes/keys | scoped service identity and presigned grants |
| Control plane → secret store | secret broker | secret material | service identity + tenant/lease authorization |
| Control plane → connector provider | MCP OAuth broker | access/refresh token and remote API | company-scoped grant + fenced refresh lease |
| Worker/sandbox → context APIs | control-plane memory/context service | company memory and actor scope | worker session + tenant/job/lease/fence authorization |
| Sandbox → network | filtered egress | external destinations | destination policy and credential-injecting proxy |
| Legacy → distributed owner | cutover transaction | duplicate executor | single-writer owner and rollout flag |
```

- [ ] **Step 3: Add the seed threat/control register and all hardening-amendment crossings**

Start with these rows, then add the placement, desktop, HA, provider-isolation, quarantine, backup, broker, telemetry, and evidence-integrity controls required by the approved amendment. The checker treats the JSON as authoritative and rejects incomplete crossings:

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
| DE-17 | Cleanup is blocked after fence loss or cleanup authority is escalated | Critical | separate resource-bound monotonic cleanup authority with effect operations unrepresentable | post-fence cleanup, cross-resource denial, and escalation corpus | WRK-004/DEP-008/CLI-004/REL-004 |

Add a `## Residual risks and release exclusions` section that explicitly excludes public service ingress, cloud plugins, unvalidated gVisor bridge egress, active-active multi-region writes, and unattended orphan-output application.

The JSON validator enumerates every crossing/control object and requires the exact fields from the amendment, unique stable IDs, known severity/lane values, non-empty owner-ticket arrays whose IDs exist in `program-design.md`, and a release test for every Critical/High entry. It compares the complete JSON ID set and crossing names to the Markdown render. Extend the mutation corpus to remove each required field in turn, duplicate an ID, invent an owner ticket, omit a Markdown ID, and remove a Critical/High release test; all cases must fail before the valid corpus passes.

- [ ] **Step 4: Link the threat model from Decision #120 and verify**

Add:

```markdown
The trust boundaries, mandatory controls, verification gates, and residual release exclusions are locked in [`distributed-execution-threat-model.md`](distributed-execution-threat-model.md).
```

Run:

```powershell
pnpm check:distributed-foundation
node --test scripts/check-distributed-execution-foundation.test.mjs
```

Expected: exit 0.

- [ ] **Step 5: Commit FND-003**

Create `docs/replatform/epics/E0-foundation/tickets/FND-003-result.md`. Record every control ID, JSON/Markdown parity and traceability evidence, the release exclusions, and links for any unresolved security finding.

```powershell
git add scripts/check-distributed-execution-foundation.mjs scripts/check-distributed-execution-foundation.test.mjs docs/architecture/distributed-execution-threat-model.md docs/architecture/distributed-execution-threat-controls.json docs/architecture/decisions.md docs/replatform/epics/E0-foundation/tickets/FND-003-result.md
git commit -m "docs: define distributed execution threat model"
```

---

### Task 4: FND-004 — Golden Journey and Failure Corpus

**Files:**
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Modify: `scripts/check-distributed-execution-foundation.test.mjs`
- Create: `tests/fixtures/distributed-execution/batch-success.json`
- Create: `tests/fixtures/distributed-execution/batch-cancel-during-execution.json`
- Create: `tests/fixtures/distributed-execution/browser-approval-download.json`
- Create: `tests/fixtures/distributed-execution/browser-denied-egress.json`
- Create: `tests/fixtures/distributed-execution/service-restart-checkpoint.json`
- Create: `tests/fixtures/distributed-execution/service-budget-stop.json`
- Create: `tests/fixtures/distributed-execution/service-provider-pause-resume.json`
- Create: `tests/fixtures/distributed-execution/late-output-quarantine.json`
- Create: `tests/fixtures/distributed-execution/plaintext-secret-in-argv-rejected.json`
- Create: `tests/fixtures/distributed-execution/schema-v1.json`
- Create: `tests/fixtures/distributed-execution/README.md`

**Interfaces:**
- Consumes: workload names and lifecycle status sets from Task 1.
- Produces: `DistributedGoldenJourneyV1` JSON shape used by E1 compatibility tests, E6 fake provider, E7 coding, E8 browser, and E9 service plans.

- [ ] **Step 1: Add exact fixture validation to the checker**

Add a strict schema-driven validator to `scripts/check-distributed-execution-foundation.mjs`. Validate every required schema field and cross-reference in the exact nine-file list below. The test harness mutates each required identity, tenant-owner relationship, placement/provider reference, input/base, event sequence/digest, artifact, cost/usage bound, cancellation/approval, cleanup/timing, audit, and forbidden-effect field; it also injects bad formats, duplicates, dangling IDs, overflow values, and cross-tenant references. Every mutation must fail with the fixture path before the nine valid files pass:

`schema-v1.json` is a strict JSON Schema draft 2020-12 document, not a project-specific schema description. It has exact `$schema: "https://json-schema.org/draft/2020-12/schema"`, stable `$id: "https://aoa.dev/contracts/distributed-execution/golden-journey-v1.schema.json"`, `type: "object"`, an explicit complete `required` array, and reusable `$defs`. Every object schema sets `additionalProperties: false`; any `allOf`/conditional composition also closes the evaluated surface with `unevaluatedProperties: false`. Arrays have numeric bounds and `uniqueItems` where identities must be unique. Strings use standard `format`/`pattern` plus only standard `$comment` annotations of the exact form `aoa:utf8-max-bytes=<positive integer>` when semantic UTF-8 limits are needed; the checker consumes that convention. The dependency-free E0 checker validates this meta-shape, an allowlist of JSON Schema 2020-12 keywords, `$comment` syntax, required definition names, closed-object rules, and all fixture references; an unknown/custom keyword fails E0. E1 later compiles the same bytes in Ajv 2020-12 strict mode without custom keywords; no dialect translation is permitted.

Each expected event contains exactly `protocolVersion`, `eventId`, `eventType`, `organizationId`, `companyId`, `workerId`, `jobId`, `attempt`, `leaseId`, `fenceToken`, `seq`, `occurredAt`, `payload`, and `eventDigest`. The digest input is the same object with `eventDigest` omitted. The E0 checker implements only the locked RFC 8785 subset needed by v1 fixtures: null, booleans, strings, arrays, plain objects, and finite safe integers; it rejects floats, unsafe integers, non-JSON values, lone surrogates, duplicate semantic keys, and unsupported values. Object keys sort by UTF-16 code units and JSON string/number serialization follows RFC 8785. It recomputes SHA-256 over the UTF-8 canonical bytes and rejects any mismatch. The mutation corpus changes every immutable event field, reuses a digest, and proves failure. PRT-004 imports or byte-for-byte reproduces this contract and verifies the same golden vectors rather than inventing a second digest algorithm.

```js
const fixtureFiles = [
  "batch-success.json",
  "batch-cancel-during-execution.json",
  "browser-approval-download.json",
  "browser-denied-egress.json",
  "service-restart-checkpoint.json",
  "service-budget-stop.json",
  "service-provider-pause-resume.json",
  "late-output-quarantine.json",
  "plaintext-secret-in-argv-rejected.json",
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

Expected: exit 1 naming all nine missing fixture files plus `schema-v1.json`.

- [ ] **Step 3: Create all nine deterministic JSON fixtures**

The original seed shape below is illustrative. Extend it to the strict JSON Schema draft 2020-12 `schema-v1.json` contract in the approved amendment; do not make the schema fit this narrower example:

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
    { "action": "reconcile_and_lease", "emits": ["service_instance_started"] },
    { "action": "report_healthy", "emits": ["service_health"] },
    { "action": "commit_checkpoint", "emits": ["service_checkpoint_prepared"] },
    { "action": "crash" },
    { "action": "expire_lease" },
    { "action": "reconcile_replacement" },
    { "action": "restore_checkpoint", "emits": ["service_checkpoint_restored", "service_health"] }
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
    { "action": "reconcile_and_lease", "emits": ["service_instance_started"] },
    { "action": "report_healthy", "emits": ["service_health", "usage"] },
    { "action": "exhaust_budget" },
    { "action": "request_stop" },
    { "action": "graceful_stop", "emits": ["service_graceful_stop_observed", "service_instance_stopped"] }
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

The three hardening fixtures are not free-form additions. Encode these exact behavioral sequences in the strict schema:

- `service-provider-pause-resume`: start one service instance and emit `service_instance_started`; record health and an approved checkpoint; inject a provider pause when the provider matrix supports it or a forced outage otherwise; withdraw the old effect authority; use only the resource-bound cleanup authority to inspect the management-safe projection and cancel/kill/destroy the matching old resource; issue a new lease/fence to a replacement instance; emit `service_checkpoint_restored`, `service_instance_started`, and `service_health`. Forbid old-instance resume, create/execute/checkpoint through cleanup authority, command/env/log/secret/customer-byte inspection, cross-resource cleanup, and overlapping governed effects.
- `late-output-quarantine`: run bounded local work, lose/replace the lease, reject ordinary artifact transfer and commit, obtain a device-authenticated quarantine grant bound to target generation plus exact hash/size/prefix, finalize it to an orphan receipt, and require explicit review. Forbid attempt completion/mutation, ordinary-prefix write, auto-apply, selected checkpoint, secret refresh, and any governed effect after fence loss.
- `plaintext-secret-in-argv-rejected`: place registered canaries in a command argument, URL, header, nested array, and additive extension in separate deterministic cases; every producer-safety validation fails before persistence, placement, lease, or provider invocation. Record no artifact/event containing the value and forbid redaction-only acceptance, partial dispatch, or evidence leakage.

Each sequence carries the common identity, placement, base/input, event/digest, artifact, cost, timing, audit, cleanup, and forbidden-effect fields required by `schema-v1.json`; the checker mutation corpus changes each binding independently and proves fail-closed behavior.

- [ ] **Step 4: Document fixture semantics and verify GREEN**

Create `tests/fixtures/distributed-execution/README.md` documenting that fixtures are immutable behavioral inputs, contain no credentials, use deterministic IDs/actions, and may receive only additive fields within `schemaVersion: 1`; breaking changes require a new versioned directory.

Run:

```powershell
pnpm check:distributed-foundation
node --test scripts/check-distributed-execution-foundation.test.mjs
```

Expected: exit 0.

- [ ] **Step 5: Commit FND-004**

Create `docs/replatform/epics/E0-foundation/tickets/FND-004-result.md`. Record all nine fixture IDs, strict schema and semantic validation evidence, JSON/Markdown lifecycle consistency, and the immutability/versioning rule.

```powershell
git add scripts/check-distributed-execution-foundation.mjs scripts/check-distributed-execution-foundation.test.mjs tests/fixtures/distributed-execution docs/replatform/epics/E0-foundation/tickets/FND-004-result.md
git commit -m "test: add distributed execution golden journeys"
```

---

### Task 5: FND-005 — Rollout Policy, Hosted Safety, Custodians, and CI Gate

**Files:**
- Create: `server/src/config/distributed-execution.ts`
- Create: `server/src/__tests__/distributed-execution-policy.test.ts`
- Create: `server/src/__tests__/distributed-execution-exclusions.test.ts`
- Modify: `server/src/config.ts:34-86,166-172,260-310`
- Modify: `server/src/__tests__/config.test.ts`
- Modify: `server/src/services/unsandboxed-multitenant-guard.ts:1-6`
- Create: `docs/architecture/distributed-execution-delivery-policy.md`
- Modify: `docs/architecture/decisions.md` Decision #120
- Modify: `docs/deploy/environment-variables.md`
- Modify: `scripts/check-distributed-execution-foundation.mjs`
- Modify: `scripts/check-distributed-execution-foundation.test.mjs`
- Read: `server/src/app.ts` and the server bootstrap/route registry used by `createApp()`
- Modify: `.github/workflows/pr.yml:100-111`
- Read: `docs/replatform/test-gates.md`
- Read: `docs/replatform/templates/qa-result-template.md`

**Interfaces:**
- Consumes: `DeploymentMode`, environment values, existing `AOA_ALLOW_UNSANDBOXED_MULTITENANT` behavior, and Organization rollout boolean supplied later by E3/E10.
- Produces:
  - `DISTRIBUTED_EXECUTION_ENABLED_ENV = "AOA_DISTRIBUTED_EXECUTION_ENABLED"`
  - `DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV = "AOA_DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENABLED"`
  - `DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV = "AOA_DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENABLED"`
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
  DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV,
  DISTRIBUTED_EXECUTION_ENABLED_ENV,
  DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV,
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
      workloadEnabled: true,
    })).toEqual({ enabled: true, reason: "enabled" });
    expect(resolveDistributedExecutionRollout({
      deploymentMode: "cloud_auth",
      deploymentEnabled: false,
      organizationEnabled: true,
      workloadEnabled: true,
    })).toEqual({ enabled: false, reason: "deployment_disabled" });
    expect(resolveDistributedExecutionRollout({
      deploymentMode: "cloud_auth",
      deploymentEnabled: true,
      organizationEnabled: false,
      workloadEnabled: true,
    })).toEqual({ enabled: false, reason: "organization_disabled" });
    expect(resolveDistributedExecutionRollout({
      deploymentMode: "cloud_auth",
      deploymentEnabled: true,
      organizationEnabled: true,
      workloadEnabled: false,
    })).toEqual({ enabled: false, reason: "workload_disabled" });
  });

  it("forbids the process-wide unsafe override in cloud_auth", () => {
    expect(() => assertHostedExecutionStartupSafe({
      deploymentMode: "cloud_auth",
      env: { [UNSANDBOXED_MULTITENANT_OPT_IN_ENV]: "1" },
    })).toThrow(/forbidden.*cloud_auth/i);
  });

  it.each([
    DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV,
    DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV,
  ])("hard-rejects excluded surface %s", (name) => {
    expect(() => assertHostedExecutionStartupSafe({
      deploymentMode: "local_trusted",
      env: { [name]: "true" },
    })).toThrow(new RegExp(`${name}.*excluded`, "i"));
    expect(() => assertHostedExecutionStartupSafe({
      deploymentMode: "cloud_auth",
      env: { [name]: "1" },
    })).toThrow(new RegExp(`${name}.*excluded`, "i"));
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

In `server/src/__tests__/config.test.ts`, save/restore all four execution-policy environment variables alongside the existing variables. Add:

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

  it.each([
    "AOA_DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENABLED",
    "AOA_DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENABLED",
  ])("refuses the excluded surface %s instead of silently enabling it", (name) => {
    process.env[name] = "true";
    expect(() => loadConfig()).toThrow(new RegExp(`${name}.*excluded`, "i"));
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
export const DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV =
  "AOA_DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENABLED";
export const DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV =
  "AOA_DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENABLED";
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
  workloadEnabled: boolean;
}

export type DistributedExecutionRolloutDecision =
  | { enabled: true; reason: "enabled" }
  | { enabled: false; reason: "deployment_disabled" | "organization_disabled" | "workload_disabled" };

export function resolveDistributedExecutionRollout(
  input: DistributedExecutionRolloutInput,
): DistributedExecutionRolloutDecision {
  if (!input.deploymentEnabled) return { enabled: false, reason: "deployment_disabled" };
  if (!input.organizationEnabled) return { enabled: false, reason: "organization_disabled" };
  if (!input.workloadEnabled) return { enabled: false, reason: "workload_disabled" };
  return { enabled: true, reason: "enabled" };
}

export function assertHostedExecutionStartupSafe(input: {
  deploymentMode: DeploymentMode;
  env: Env;
}): void {
  for (const name of [
    DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV,
    DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV,
  ]) {
    if (parseBooleanEnv(input.env, name, false)) {
      throw new Error(`${name} is excluded from this replatform release and cannot be enabled`);
    }
  }
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

Return `distributedExecutionEnabled` next to `deploymentMode`. Do not expose config booleans for either excluded distributed surface and do not call any scheduler, adapter, distributed route registration, distributed plugin runner, or worker code. A truthy excluded flag must stop startup; absence/false must leave the corresponding distributed route/runner unregistered. Existing legacy plugin behavior governed by Decision #103 is not silently removed or broadened by this ticket.

Create `server/src/__tests__/distributed-execution-exclusions.test.ts` through the real `createApp()` path. With the ordinary distributed flag both false and true, `/api/distributed-execution/public-services` and `/api/distributed-execution/cloud-plugins` return the normal not-found response. With either exclusion sentinel truthy, `loadConfig()` fails before app construction. This is an executable absence/startup test for the reserved paths, not a ban on unrelated legacy routes.

Extend `scripts/check-distributed-execution-foundation.mjs` with a source-boundary rule over `server/src/app.ts` and the actual startup/route registry: reject any import from a reserved distributed public-ingress or cloud-plugin-runner module and any registration of the two reserved path prefixes. Extend the dependency-free mutation test with temporary source trees that add each forbidden import/registration and assert an exact failure. Do not claim an injected registration spy or seam that the repository does not expose.

- [ ] **Step 5: Verify focused GREEN and existing unsafe-guard compatibility**

Run:

```powershell
pnpm exec vitest run server/src/__tests__/distributed-execution-policy.test.ts server/src/__tests__/distributed-execution-exclusions.test.ts server/src/__tests__/config.test.ts server/src/__tests__/unsandboxed-multitenant-guard.test.ts
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
- a link to `docs/replatform/test-gates.md`, the `E6-D1-FOUNDATION` partial gate, and the rule that HARD failures are non-waivable;
- executable hard-negative controls for public service ingress and cloud plugin execution: both default absent/off, truthy values stop startup in every deployment mode, real-app requests prove the reserved paths are 404, and the source-boundary checker rejects their imports/registration;
- shared two-replica admission/rate-limit ownership outside process memory;
- immutable QA naming and `pass | fail | blocked_external` decisions.

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

Document all four environment variables in `docs/deploy/environment-variables.md`: distributed execution defaults off; enabling it creates no worker by itself; Organization rollout remains separately required; the unsafe override is rejected in `cloud_auth` and is self-hosted emergency compatibility only; the public-ingress and cloud-plugin names are reserved hard-negative sentinels whose truthy values reject startup rather than enable a feature.

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
node --test scripts/check-distributed-execution-foundation.test.mjs
pnpm exec vitest run server/src/__tests__/distributed-execution-policy.test.ts server/src/__tests__/distributed-execution-exclusions.test.ts server/src/__tests__/config.test.ts server/src/__tests__/unsandboxed-multitenant-guard.test.ts
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

Create `docs/replatform/epics/E0-foundation/tickets/FND-005-result.md`. Record the rollout-policy test counts, server typecheck, hosted unsafe-override denial, both excluded-surface startup denials, real-app 404 evidence, source-boundary import/registration mutation assertions, CI policy step, documentation, and confirmation that no scheduler/provider path was enabled.

```powershell
git add server/src/config/distributed-execution.ts server/src/__tests__/distributed-execution-policy.test.ts server/src/__tests__/distributed-execution-exclusions.test.ts server/src/config.ts server/src/__tests__/config.test.ts server/src/services/unsandboxed-multitenant-guard.ts docs/architecture/distributed-execution-delivery-policy.md docs/architecture/decisions.md docs/deploy/environment-variables.md scripts/check-distributed-execution-foundation.mjs scripts/check-distributed-execution-foundation.test.mjs .github/workflows/pr.yml docs/replatform/epics/E0-foundation/tickets/FND-005-result.md
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

Recover the immutable start revision from the exact `Start SHA: <40-hex>` field in `FND-001-result.md`, then validate it before using it. Do not rely on a shell variable from an earlier agent session.

Run:

```powershell
$fnd001 = Get-Content docs/replatform/epics/E0-foundation/tickets/FND-001-result.md -Raw
$match = [regex]::Match($fnd001, '(?m)^\*\*Start SHA:\*\*\s*([0-9a-f]{40})\s*$')
if (-not $match.Success) { throw 'FND-001 result has no exact Start SHA field' }
$e0StartSha = $match.Groups[1].Value
git cat-file -e "${e0StartSha}^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'E0 start SHA is not a commit' }
git merge-base --is-ancestor $e0StartSha HEAD
if ($LASTEXITCODE -ne 0) { throw 'E0 start SHA is not an ancestor of HEAD' }
$ticketResults = Get-ChildItem docs/replatform/epics/E0-foundation/tickets/FND-*-result.md
$expectedNames = 1..5 | ForEach-Object { "FND-{0:D3}-result.md" -f $_ }
$actualNames = @($ticketResults.Name | Sort-Object)
if (Compare-Object $expectedNames $actualNames) { throw "E0 ticket-result filename set is not FND-001 through FND-005" }
foreach ($result in $ticketResults) {
  $body = Get-Content -LiteralPath $result.FullName -Raw
  if ($body -notmatch '(?m)^\*\*Status:\*\*\s*`complete`\s*$' -or
      $body -notmatch '(?m)^\*\*Disposition:\*\*\s*`approved`\s*$') {
    throw "$($result.Name) is not independently approved complete"
  }
  $implementer = [regex]::Match($body, '(?m)^\*\*Implementer:\*\*\s*(.+?)\s*$').Groups[1].Value
  $reviewer = [regex]::Match($body, '(?m)^\*\*Reviewer:\*\*\s*(.+?)\s*$').Groups[1].Value
  $reviewedShaMatch = [regex]::Match($body, '(?m)^\*\*Reviewed revision:\*\*\s*`?([0-9a-f]{40})`?\s*$')
  if (-not $implementer -or -not $reviewer -or $implementer -match '^<.*>$' -or
      $reviewer -match '^<.*>$' -or $implementer.Trim().ToLowerInvariant() -eq $reviewer.Trim().ToLowerInvariant()) {
    throw "$($result.Name) lacks an independent reviewer"
  }
  if (-not $reviewedShaMatch.Success) { throw "$($result.Name) lacks an exact reviewed revision" }
  $reviewedSha = $reviewedShaMatch.Groups[1].Value
  git cat-file -e "${reviewedSha}^{commit}"
  if ($LASTEXITCODE -ne 0) { throw "$($result.Name) reviewed revision is not a commit" }
  git merge-base --is-ancestor $reviewedSha HEAD
  if ($LASTEXITCODE -ne 0) { throw "$($result.Name) reviewed revision is not an ancestor of HEAD" }
}
git status --short
git log --oneline --decorate "${e0StartSha}..HEAD"
if ($LASTEXITCODE -ne 0) { throw 'E0 commit-range log failed' }
git diff "${e0StartSha}..HEAD" --check
if ($LASTEXITCODE -ne 0) { throw 'E0 commit range has whitespace errors' }
git diff --exit-code $e0StartSha HEAD -- pnpm-lock.yaml
if ($LASTEXITCODE -ne 0) { throw 'E0 changed pnpm-lock.yaml across committed work' }
```

Verify all five ticket results have `**Status:** \`complete\`` and `**Disposition:** \`approved\`` with a distinct reviewer and reviewed revision. Expected: clean worktree; five scoped E0 implementation commits plus their review-disposition commits; no whitespace errors; every ticket independently approved.

- [ ] **Step 2: Run the required repository checks for the E0 code diff**

Run:

```powershell
function Invoke-NativeGate([string]$label, [scriptblock]$command) {
  & $command
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "$label failed with exit code $exitCode" }
}

Invoke-NativeGate 'repository typecheck' { pnpm -r typecheck }
Invoke-NativeGate 'repository test suite' { pnpm test:run }
Invoke-NativeGate 'offline recursive build' { pnpm -r build }
1..3 | ForEach-Object {
  Invoke-NativeGate "D0 critical foundation run $_" { pnpm check:distributed-foundation }
  Invoke-NativeGate "D0 foundation mutation run $_" { node --test scripts/check-distributed-execution-foundation.test.mjs }
  Invoke-NativeGate "D0 critical focused run $_" { pnpm exec vitest run server/src/__tests__/distributed-execution-policy.test.ts server/src/__tests__/distributed-execution-exclusions.test.ts server/src/__tests__/config.test.ts server/src/__tests__/unsandboxed-multitenant-guard.test.ts }
}
$dirtyAfterGate = git status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'git status failed after E0 gate' }
if ($dirtyAfterGate) { throw "E0 gate changed the worktree: $dirtyAfterGate" }
Invoke-NativeGate 'final E0 tracked diff check' { git diff --exit-code }
```

Use `pnpm -r build`, not root `pnpm build`: the root lifecycle runs mutable catalog-fetch prebuild scripts and is not a same-revision evidence command. The recursive package build consumes the checked-in snapshots. Expected: all commands exit 0 and the worktree remains byte-clean. Preserve and classify any pre-existing failure, but do not pass E0 on focused evidence alone. Any required repository failure keeps the handoff at `fail` and E0 in `gate_review`; there is no baseline-failure waiver.

- [ ] **Step 3: Record E0 evidence**

Create the QA record path produced by this command from the QA-result template:

```powershell
$utcDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$sha12 = (git rev-parse HEAD).Substring(0, 12)
$attempt = 1
do {
  $selectedAttempt = $attempt
  $qaRecord = "docs/replatform/epics/E0-foundation/qa/$utcDate-d0-e0-completion-$sha12-a$selectedAttempt.md"
  $handoffRecord = "docs/replatform/epics/E0-foundation/handoffs/$utcDate-epic-completion-$sha12-a$selectedAttempt.md"
  $attempt += 1
} while ((Test-Path -LiteralPath $qaRecord) -or (Test-Path -LiteralPath $handoffRecord))
$qaRecord
$handoffRecord
```

Record:

- commit IDs for FND-001 through FND-005;
- exact commands and exit codes;
- ticket IDs covered;
- confirmation that `pnpm-lock.yaml` did not change;
- confirmation that distributed execution remains default-off;
- three consecutive same-revision critical-suite passes and both excluded-surface negative tests;
- confirmation that no job, worker, provider, or database schema code was added.

Create `$handoffRecord` from the handoff template. Link FND-001 through FND-005 results and `$qaRecord`. Set the decision to `pass` only if every applicable REQUIRED condition and every HARD/INITIAL D0 threshold passed on the same revision, including the three consecutive critical-suite runs; otherwise use `fail` or `blocked_external` as defined by `test-gates.md` and keep E0 in `gate_review`.

Ticket owners move E0 from `planned` to `in_progress` when execution starts; the Integration Gate Owner moves it to `gate_review` only after all five result records are independently reviewed with status `complete` and disposition `approved`. Change E0 from `gate_review` to `complete` in `docs/replatform/epics/E0-foundation/README.md` and `docs/replatform/epics/README.md` only for a passing handoff. Commit these evidence files separately:

```powershell
git add docs/replatform/epics/E0-foundation docs/replatform/epics/README.md
git commit -m "docs: record E0 completion evidence"
```

- [ ] **Step 4: Mark E1 unblocked**

E1 may begin only when:

- `pnpm check:distributed-foundation` is green on main;
- Decision #120 and all four architecture records are merged;
- all nine fixtures and the strict schema are merged;
- the unsafe hosted override regression test is green;
- the worktree is clean.
