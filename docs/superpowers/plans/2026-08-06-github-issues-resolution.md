# GitHub Issues Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 6 active GitHub issues (#114, #127, #200, #204, #205, #293) across 3 structured PR phases.

**Architecture:** Add `last_event_at` idle-lease heartbeat to `internal_agent_runs` (Migration `0204`), collapse thread outbox execution to single-consumer drain (`runControllerSweep`), add outbox-key deduplication to composer `requestParticipation`, land held-back artifact-as-input version resolution and hard-delete operations, refactor `file-import.ts` with lazy dynamic imports, and configure Windows E2E Postgres container service.

**Tech Stack:** TypeScript, Node.js, Express 5.x, Drizzle ORM, PostgreSQL, Vitest, Playwright.

## Global Constraints

- Every domain entity must be scoped to a company.
- Preserve control-plane invariants (single-assignee task model, atomic issue checkout, approval gates, activity logging).
- Drizzle ORM only for schema changes (`packages/db/src/schema/`). Run `pnpm db:generate`.
- Migration sequence numbers must follow `0204_+` (since `0203` already exists).
- Strict verification before completion: `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`.

---

## Phase 1 (PR 1): Core Outbox Invariants, Heartbeat & Idempotency (#204, #205, #293)

### Task 1: Add `last_event_at` Idle Heartbeat and Refactor Zombie Reaper (Issue #204)

**Files:**
- Modify: [`packages/db/src/schema/internal_agent.ts:395`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/packages/db/src/schema/internal_agent.ts#L395)
- Create: `packages/db/src/migrations/0204_add_last_event_at_to_internal_agent_runs.sql`
- Modify: [`server/src/services/internal-agent/aoa-agents/runner.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/aoa-agents/runner.ts)
- Modify: [`server/src/services/thread-agent-actions.ts:1412,1530`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/thread-agent-actions.ts#L1412)
- Test: [`server/src/__tests__/thread-agent-actions.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/thread-agent-actions.test.ts)

- [ ] **Step 1: Add `last_event_at` column to schema and generate migration 0204**

In [`packages/db/src/schema/internal_agent.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/packages/db/src/schema/internal_agent.ts#L395), add:
`lastEventAt: timestamp("last_event_at", { withTimezone: true })`.  
Run: `pnpm db:generate`. Confirm generated migration file is named `0204_...sql`.

- [ ] **Step 2: Add 30s throttled heartbeat in `runner.ts`**

In [`server/src/services/internal-agent/aoa-agents/runner.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/aoa-agents/runner.ts), add a 30-second in-memory throttle (`now - lastHeartbeatAt > 30000ms`) on stream events to update `internal_agent_runs.last_event_at = new Date()`.

- [ ] **Step 3: Update `gcOrphanedProposedActions` Step 1 in `thread-agent-actions.ts`**

In [`server/src/services/thread-agent-actions.ts:1540`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/thread-agent-actions.ts#L1540), check `coalesce(lastEventAt, createdAt) < zombieCutoff`. Set `ZOMBIE_RUN_TTL_MS = 35 * 60 * 1000`.

- [ ] **Step 4: Run typecheck, unit tests, and build**

Run: `pnpm -r typecheck && pnpm test:run && pnpm build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/internal_agent.ts packages/db/src/migrations/ server/src/services/internal-agent/aoa-agents/runner.ts server/src/services/thread-agent-actions.ts
git commit -m "feat(db,server): add last_event_at heartbeat and update zombie reaper cutoff (#204)"
```

---

### Task 2: Consolidate Thread Action Outbox to Single Consumer and Atomic Seal (Issue #205)

**Files:**
- Modify: [`server/src/services/internal-agent/aoa-agents/runner.ts:1167`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/aoa-agents/runner.ts#L1167)
- Modify: [`server/src/services/internal-agent/aoa-agents/sweep-controller.ts:109`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/aoa-agents/sweep-controller.ts#L109)
- Modify: [`server/src/services/thread-agent-actions.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/thread-agent-actions.ts)
- Test: [`server/src/__tests__/thread-commit-idempotency.integration.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/thread-commit-idempotency.integration.test.ts)

- [ ] **Step 1: Refactor `runner.ts` to seal and mark pendingRun without self-committing**

In [`runner.ts:1167`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/aoa-agents/runner.ts#L1167), replace direct `commitThreadAgentActions` call with `sealRunActions` + setting `pendingRun = true` on `threadOrchestrationState`.

- [ ] **Step 2: Atomic seal and completion status transaction**

Wrap `sealRunActions` and updating `internalAgentRuns.status = 'completed'` in a single DB transaction `db.transaction(...)` inside `runner.ts`.

- [ ] **Step 3: Run thread commit integration tests and local checks**

Run: `pnpm --filter server test server/src/__tests__/thread-commit-idempotency.integration.test.ts && pnpm -r typecheck && pnpm build`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/runner.ts server/src/services/internal-agent/aoa-agents/sweep-controller.ts server/src/services/thread-agent-actions.ts
git commit -m "refactor(server): consolidate thread outbox commits to single-consumer sweep (#205)"
```

---

### Task 3: Add Outbox-Key Deduplication to `requestParticipation` (Issue #293)

**Files:**
- Modify: [`server/src/services/thread-orchestration.ts:804-1042`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/thread-orchestration.ts#L804)
- Modify: [`server/src/services/mention-outbox.ts:186-251`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/mention-outbox.ts#L186)
- Test: [`server/src/__tests__/mention-outbox.integration.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/mention-outbox.integration.test.ts)

- [ ] **Step 1: Write test for `requestParticipation` deduplication**

In `server/src/__tests__/mention-outbox.integration.test.ts`, write a test simulating a crash re-drain where `requestParticipation` is invoked a second time with the same outbox key. Assert `incrementHop` is NOT called a second time and no duplicate entry is created.

- [ ] **Step 2: Add idempotency check in `requestParticipation`**

In [`server/src/services/thread-orchestration.ts:804`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/thread-orchestration.ts#L804), accept `outboxRowId?: string`. Query `discussion_entries` for `source_action_id = outboxRowId`. If found, return early without calling `incrementHop` or spawning the CLI runner.

- [ ] **Step 3: Pass outbox row ID from `mention-outbox.ts`**

In [`server/src/services/mention-outbox.ts:200`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/mention-outbox.ts#L200), pass `row.id` to `requestParticipation`.

- [ ] **Step 4: Run mention outbox integration tests & full verification**

Run: `pnpm --filter server test server/src/__tests__/mention-outbox.integration.test.ts && pnpm -r typecheck && pnpm test:run && pnpm build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/thread-orchestration.ts server/src/services/mention-outbox.ts server/src/__tests__/mention-outbox.integration.test.ts
git commit -m "fix(server): add outbox-key deduplication to requestParticipation (#293)"
```

---

## Phase 2 (PR 2): Preserved Features & Config Drift (#200)

### Task 4: Fix Config Drift and Pinned Version Resolution (Issue #200 Parts 1 & 2)

**Files:**
- Modify: [`server/src/services/run-input-bundles.ts:305-343`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/run-input-bundles.ts#L305)
- Modify: [`server/src/services/internal-agent/providers/index.ts:14,21`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/providers/index.ts#L14)
- Test: [`server/src/__tests__/run-input-bundles.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/run-input-bundles.test.ts)
- Test: [`server/src/__tests__/llm-providers.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/llm-providers.test.ts)

- [ ] **Step 1: Write test for pinned artifact version resolution and fallback chain**

In `server/src/__tests__/run-input-bundles.test.ts`, add a test checking that `item.metadata.artifactVersionId` resolves the specific pinned version rather than falling back to `artifacts.currentVersionId`.

- [ ] **Step 2: Update `run-input-bundles.ts` version resolution**

In [`server/src/services/run-input-bundles.ts:321`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/run-input-bundles.ts#L321), inspect `metadataString(item.metadata, "artifactVersionId") ?? metadataString(item.metadata, "versionId")`. If present, fetch that specific `artifactVersions` row.

- [ ] **Step 3: Update `providers/index.ts` Google env key lookups**

In [`server/src/services/internal-agent/providers/index.ts:14`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/internal-agent/providers/index.ts#L14), add `"GOOGLE_API_KEY"` and `"GEMINI_API_KEY"` to `PROVIDER_ENV_KEYS.google` and `PROVIDER_SECRET_NAMES.google`.

- [ ] **Step 4: Run unit tests and verification**

Run: `pnpm --filter server test server/src/__tests__/run-input-bundles.test.ts server/src/__tests__/llm-providers.test.ts && pnpm -r typecheck && pnpm build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-input-bundles.ts server/src/services/internal-agent/providers/index.ts server/src/__tests__/run-input-bundles.test.ts server/src/__tests__/llm-providers.test.ts
git commit -m "fix(server): resolve pinned artifact versions and fix google api key config drift (#200)"
```

---

### Task 5: Land `deleteArtifact` Hard-Delete Method and Route (Issue #200 Part 3)

**Files:**
- Modify: [`server/src/services/artifacts.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/artifacts.ts)
- Modify: [`server/src/routes/artifacts.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/routes/artifacts.ts)
- Test: [`server/src/__tests__/artifact-routes-authz.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/artifact-routes-authz.test.ts)

- [ ] **Step 1: Write test for `DELETE /artifacts/:id` route in `artifact-routes-authz.test.ts`**

In [`server/src/__tests__/artifact-routes-authz.test.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/artifact-routes-authz.test.ts), write a test asserting that `DELETE /api/companies/:companyId/artifacts/:id` permanently deletes the artifact when called by founder, writes an activity log entry, and returns 403 Forbidden when called by a non-founder actor.

- [ ] **Step 2: Implement `deleteArtifact` in `artifacts.ts` service**

In `server/src/services/artifacts.ts`, add `deleteArtifact(companyId: string, artifactId: string, actor: Actor)` method that deletes the artifact record from DB after logging activity.

- [ ] **Step 3: Implement `DELETE /artifacts/:id` in `routes/artifacts.ts`**

In `server/src/routes/artifacts.ts`, register `DELETE /:id` handler protected by `assertBoard` and founder role checks.

- [ ] **Step 4: Run artifact authorization tests and verification**

Run: `pnpm --filter server test server/src/__tests__/artifact-routes-authz.test.ts && pnpm -r typecheck && pnpm build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/artifacts.ts server/src/routes/artifacts.ts server/src/__tests__/artifact-routes-authz.test.ts
git commit -m "feat(server): land deleteArtifact hard-delete service method and route (#200)"
```

---

## Phase 3 (PR 3): Cross-Platform Performance & Windows CI (#127, #114)

### Task 6: Fix Lazy Dynamic Module Loading in `file-import.ts` (Issue #127)

**Files:**
- Modify: [`server/src/services/file-import.ts:15-16,66-120`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/file-import.ts#L15)
- Test: [`server/src/__tests__/file-import-service.test.ts:66-74`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/file-import-service.test.ts#L66)

- [ ] **Step 1: Unskip Windows plain text extraction test**

In [`server/src/__tests__/file-import-service.test.ts:68`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/__tests__/file-import-service.test.ts#L68), change `it.skipIf(process.platform === "win32")("extracts plain text from TXT buffer", ...)` to `it("extracts plain text from TXT buffer", ...)`.

- [ ] **Step 2: Replace top-level static imports with dynamic imports**

In [`server/src/services/file-import.ts`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/server/src/services/file-import.ts), remove static imports of `pdf-parse` and `mammoth` from top-level lines 15–16. Inside `extractTextFromBuffer`, update the PDF switch branch to `const { PDFParse } = await import("pdf-parse");` and the DOCX branch to `const mammoth = (await import("mammoth")).default;`.

- [ ] **Step 3: Run file-import unit tests and full verification**

Run: `pnpm --filter server test server/src/__tests__/file-import-service.test.ts && pnpm -r typecheck && pnpm test:run && pnpm build`  
Expected: PASS on Windows and Linux without timeout.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/file-import.ts server/src/__tests__/file-import-service.test.ts
git commit -m "fix(server): lazy import pdf-parse and mammoth to fix windows cold startup latency (#127)"
```

---

### Task 7: Configure Windows Runner PostgreSQL Setup in CI Workflow (Issue #114)

**Files:**
- Modify: [`.github/workflows/cross-platform-weekly.yml`](file:///c:/Users/TK/OneDrive/Desktop/Claude%20Data/Paperclip-AoA/AoA-2.5/.github/workflows/cross-platform-weekly.yml)

- [ ] **Step 1: Update `cross-platform-weekly.yml` with Postgres runner setup for Windows**

In `.github/workflows/cross-platform-weekly.yml`, add a runner-level PostgreSQL setup step for the Windows matrix leg (e.g. using `setup-postgres` action) and supply `DATABASE_URL: postgres://postgres:postgres@localhost:5432/aoa` to the Playwright E2E execution step.

- [ ] **Step 2: Validate YAML syntax & build**

Run: `pnpm -r typecheck && pnpm build`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cross-platform-weekly.yml
git commit -m "ci: configure postgres runner setup for windows e2e matrix leg (#114)"
```
