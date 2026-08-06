# Design Spec: GitHub Issues Resolution (#114, #127, #200, #204, #205, #293)

**Date:** 2026-08-06  
**Status:** Spec Approved (Updated after Senior Peer Review)  
**Author:** Antigravity AI & Human Partner  

---

## 1. Overview & Context

This design document specifies the architecture, data model modifications, service updates, and multi-PR execution strategy required to resolve 6 active GitHub issues in the AoA (Army of Agents) codebase:

1. **Issue #204**: Thread-action zombie reaper idle-lease (`last_event_at` heartbeat).
2. **Issue #205**: PR-B thread-action outbox invariant consolidation (single-consumer drain & atomic seal).
3. **Issue #293**: Composer idempotency per-(entity,agent) exactly-once for crash windows.
4. **Issue #200**: Land held-back work from #197 (Artifact-as-input version resolution, Google API key config drift, and `deleteArtifact` hard-delete).
5. **Issue #127**: Lazy dynamic module imports in `file-import.ts` to fix Windows test timeouts.
6. **Issue #114**: Cross-platform E2E CI execution on `windows-latest` via runner-level PostgreSQL setup.

---

## 2. Multi-PR Breakdown Strategy

To minimize blast radius, preserve control-plane invariants, and allow clean git bisections, the work is divided into 3 independent, sequential Pull Requests:

```
  ┌───────────────────────────────────────────────────────────┐
  │ PR 1: Core Outbox Invariants, Heartbeat & Idempotency      │
  │ (#204, #205, #293)                                        │
  └─────────────────────────────┬─────────────────────────────┘
                                │
  ┌─────────────────────────────▼─────────────────────────────┐
  │ PR 2: Preserved Features & Config Drift                   │
  │ (#200)                                                    │
  └─────────────────────────────┬─────────────────────────────┘
                                │
  ┌─────────────────────────────▼─────────────────────────────┐
  │ PR 3: Cross-Platform Performance & Windows CI             │
  │ (#127, #114)                                              │
  └───────────────────────────────────────────────────────────┘
```

- **PR 1: Core Outbox Invariants, Heartbeat & Idempotency (#204, #205, #293)**
  Focuses strictly on DB outbox execution, `last_event_at` migration `0204`, single-consumer drain (`runControllerSweep`), atomic seal transactions, and composer participation deduplication.
- **PR 2: Preserved Features & Config Drift (#200)**
  Focuses on REST routes and feature resolution: pinned artifact version lookups, Google API key fallback mappings, and `deleteArtifact` hard-delete service & REST route.
- **PR 3: Cross-Platform Performance & Windows CI (#127, #114)**
  Focuses on module loading performance in `file-import.ts` and Windows CI workflow setup.

---

## 3. Detailed Technical Design by Subsystem

### A. Subsystem 1: Thread Action Outbox & GC Reaper (Issues #204 & #205)

#### Problem
- GC Step 1 currently uses a 2-hour wall-clock age from run start (`internal_agent_runs.created_at`) to force-fail running runs because no activity heartbeat exists.
- Dual write-authority exists between direct runner self-commits ([`runner.ts:1167`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/aoa-agents/runner.ts#L1167)) and controller sweeps (`sweep-controller.ts:109`), forcing reliance on per-action CAS (`claimActionForCommit`) as the primary lock.

#### Architecture & Changes
1. **Schema Update (`packages/db/src/schema/internal_agent.ts`)**:
   - Add `lastEventAt: timestamp("last_event_at", { withTimezone: true })` to `internalAgentRuns`.
   - Migration file sequence: `0204_add_last_event_at_to_internal_agent_runs.sql`.
2. **Heartbeat Leasing (`server/src/services/internal-agent/aoa-agents/runner.ts`)**:
   - Inside stream execution callbacks (`onLog`, `onMeta`, tool execution), enforce an explicit **30-second in-memory throttle** (`now - lastHeartbeatAt > 30000ms`) before updating `internal_agent_runs.last_event_at = now()`.
3. **Single-Consumer Consolidation (`runner.ts` & `sweep-controller.ts`)**:
   - Modify `runner.ts` so non-controller thread runs execute `sealRunActions` and set `pendingRun = true` on `threadOrchestrationState`, eliminating direct `commitThreadAgentActions` calls in `runner.ts`.
   - `runControllerSweep` becomes the single, unified drain consumer.
   - Wrap `sealRunActions` and `internalAgentRuns.status = 'completed'` in an atomic DB transaction `db.transaction(...)`.
4. **GC Reaper Refactor (`server/src/services/thread-agent-actions.ts`)**:
   - Update `gcOrphanedProposedActions` Step 1 to check `coalesce(lastEventAt, createdAt) < cutoff`.
   - Lower `ZOMBIE_RUN_TTL_MS` from 2 hours (7,200,000ms) to 35 minutes (2,100,000ms).

---

### B. Subsystem 2: Composer Mention Outbox Idempotency (Issue #293)

#### Problem
- If a server crashes or restarts after `requestParticipation` executes CLI participation (and posts entries to `discussion_entries`), but before `mention-outbox.ts` updates row status to `'done'`, the outbox row remains `'processing'`. Upon re-drain, `requestParticipation` is called again without checking prior completion, causing double hop count increments and duplicate posts.

#### Architecture & Changes
1. **Idempotency Key Check (`server/src/services/thread-orchestration.ts`)**:
   - Update `requestParticipation` to accept `outboxRowId?: string` or `idempotencyKey?: string`.
   - Before `incrementHop` and spawning CLI runner, check `discussion_entries` for an existing entry matching `source_action_id = idempotencyKey` or `outboxRowId`.
   - If present, skip CLI dispatch and `incrementHop`, returning `{ spawned: true, hopCount, entryId }` safely.
2. **Outbox Worker (`server/src/services/mention-outbox.ts`)**:
   - Pass outbox row ID into `requestParticipation`.

---

### C. Subsystem 3: Held-Back Features & Config Drift (Issue #200)

#### Architecture & Changes
1. **Artifact-as-Input Version Resolution (`server/src/services/run-input-bundles.ts`)**:
   - In `buildRunInputBundle`, inspect `metadataString(item.metadata, "artifactVersionId") ?? metadataString(item.metadata, "versionId")`.
   - If present, query `artifactVersions` by that ID; otherwise fall back to `artifacts.currentVersionId`.
2. **Config Drift (`server/src/services/internal-agent/providers/index.ts`)**:
   - Add `GOOGLE_API_KEY` and `GEMINI_API_KEY` to `PROVIDER_ENV_KEYS` and `PROVIDER_SECRET_NAMES` so fallback resolution succeeds when keys are supplied under standard environment names.
3. **Artifact Lifecycle Hard Delete**:
   - Land `deleteArtifact` in [`server/src/services/artifacts.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/artifacts.ts) with activity logging.
   - Land `DELETE /artifacts/:id` in [`server/src/routes/artifacts.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/routes/artifacts.ts) gated by `assertBoard` and founder role checks.

---

### D. Subsystem 4: Cross-Platform Performance & Windows CI (Issues #127 & #114)

#### Architecture & Changes
1. **Lazy Dynamic Module Loading (`server/src/services/file-import.ts`)**:
   - Remove static top-level imports `import { PDFParse } from "pdf-parse";` and `import mammoth from "mammoth";`.
   - Inside `extractTextFromBuffer`, dynamically `await import("pdf-parse")` and `await import("mammoth")` only when processing `application/pdf` or DOCX MIME types.
   - Plain text extraction (`text/plain`, `.md`, `.json`) executes natively using `buffer.toString("utf-8")` with zero module evaluation overhead.
   - Remove `it.skipIf(process.platform === "win32")` from [`server/src/__tests__/file-import-service.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/file-import-service.test.ts#L68).
2. **Windows E2E CI (`.github/workflows/cross-platform-weekly.yml`)**:
   - Note: GitHub Actions does not support `services:` containers on `windows-latest` runners.
   - Configure PostgreSQL environment step or action on Windows runner leg and supply `DATABASE_URL: postgres://postgres:postgres@localhost:5432/aoa` to Playwright step.

---

## 4. Comprehensive Testing & Verification Matrix

Every PR phase requires passing full verification before merge:
- **Type Checking**: `pnpm -r typecheck`
- **Unit & Integration Suite**: `pnpm test:run`
- **Build Validation**: `pnpm build`
- **Targeted Integration Tests**:
  - `server/src/__tests__/thread-commit-idempotency.integration.test.ts` (Outbox single consumer & CAS)
  - `server/src/__tests__/mention-outbox.integration.test.ts` (Mention outbox deduplication)
  - `server/src/__tests__/artifact-routes-authz.test.ts` (Artifact permissions & hard delete)
  - `server/src/__tests__/file-import-service.test.ts` (Lazy import performance)
