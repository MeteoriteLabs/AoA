# Viewer Upgrade — Phase 7: Tier-3 Navigational Emission + Cross-Surface Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. TDD per task; checkbox tracking. Read the two investigation findings baked into this plan before executing.

**Goal:** Agents can drive the viewer with **navigational** refs (task/approval/memory_item/url/discussion — "I created task X", "see approval Y"), not just their own artifact output. Two halves:
- **7A (small, testable now):** Commander emits `task`/`memory_item`/`approval` navigational refs from the write-tools that already return those ids. Commander already has every tab body (Phase 6) + delivery pipeline, so this is emission-only.
- **7B (large):** crew runs DELIVER navigational refs to the **Discussions** and **Workspace** surfaces, which today consume no ShowRef at all. Uses **post-run synthesis** (build refs from the runner's known context at relay time) — NOT per-tool-call bridge capture.

**Key investigation facts (server `adfb98379` + UI `a6e1d642`):**
- The MCP bridge (`buildOutputRefs`) fires for crew too, BUT crew refs are discarded (`AoaRunResult` has no refs field) and surface is hardcoded `"commander"`. So crew delivery is a **separate path** — do NOT try to capture per-tool-call crew refs.
- **No MCP tool produces a `discussion` or `url` ref.** Those must be synthesized from runner context (`payload.threadId`, `issues.sourceDiscussionId`, `task_outputs.url`). `task`/`memory_item`/`approval` DO come from tool results.
- `discussion_entries` has **no** `output_refs` column (add one, mirroring `internal_agent_messages.output_refs`). The crew→thread loopback `relayCrewResult` (`server/src/services/crew-result-relay.ts:42`) already inserts an entry + fires `discussion.entry.created`/`thread.entry.created`, and the UI **already refetches the thread on those pokes** — so a ref on that entry rides for free.
- **Workspace output poke is missing:** `heartbeat.run.outputs_detected` is declared but unhandled in `LiveUpdatesProvider.tsx`; `queryKeys.taskOutputs.byIssue` is never invalidated on a live event. Tier-3 must wire it.
- Thread + Workspace consume **no ShowRef** — all payload-typed tabs. Add thin per-surface `openRef(ShowRef)` adapters (NO model merge — locked decision).
- **Reuse (already surface-agnostic, exported, self-fetching):** `TaskDetail` (by issueId), `ApprovalDetailCore` (by approvalId, `embedded`). **Extract from `CommanderViewerPanel.tsx` (file-local, unexported):** `DiscussionRefTabBody`, `OutputRefTabBody`, `MemoryItemRefTabBody`. `OutputRefChips` is nearly surface-agnostic (one `chipLabel` import).
- **Design-matrix corrections:** Thread ALREADY has a rich memory body (`MemoryLinkedViewer`) + artifact/asset/task/url. Workspace ALREADY has asset (Phase 4) + artifact/url. So Thread only needs discussion/approval/output-by-id; Workspace needs task/discussion/approval/memory/output-by-id.
- **RBAC:** `canViewThread` (`server/src/services/threads.ts:115`) already scopes `thread.*` pokes via `filterThreadEventRecipients`. Refs are pointers (opening hits an RBAC-checked REST route). The one new guard: do NOT deliver a **private-thread `discussion` ref onto a company-scoped surface**.

**Tech stack:** Drizzle (`pnpm db:generate`; hand-add `IF NOT EXISTS`), Express, React, Vitest, Zod. Migrations at meta 0174.

**Deferred (intentional):** per-tool-call crew ref capture / bridge surface plumbing for arbitrary tool results (post-run synthesis covers the founder-relevant products without it); freshness/replay auto-open gate (Phase-6 baseline); TTL-ephemeral.

---

# PART 7A — Commander navigational emission (execute first; independently testable)

## Task 1: Emit task / memory_item / approval refs from Commander tool results

**Files:** `server/src/services/internal-agent/output-refs.ts` (extend `buildOutputRefs` switch); tests `output-refs.test.ts`. (Delivery + tab bodies already exist from Phase 6 — task→`TaskDetail`, approval→`ApprovalDetailCore`, memory_item→`MemoryItemRefTabBody`.)

**CRITICAL (Codex P1-1): `buildOutputRefs` runs in the MCP bridge and sees COMMANDER'S internal-agent tool names, NOT the outbound MCP write-tools.** The hyphenated `create-task`/`suggest-memory` in `server/src/mcp/tools/write-tools.ts` are the OUTBOUND server (what external clients call) — Commander never invokes them. Commander's tools are in `server/src/services/internal-agent/tools/` (the same registry whose `create_artifact`/`get_task` `buildOutputRefs` already switches on). The real, verified tool names:
- `create_task` (`action-tools.ts:7`) → `task`, action `created`.
- `update_task` (`action-tools.ts:69`) → `task`, action `referenced`.
- `suggest_memory` (`memory-tools.ts:263`), `write_memory` (`memory-write.ts:36`), `propose_memory_from_thread` (`memory-propose.ts:38`) → `memory_item`.
- `approval_decision` (`approval-tools.ts:123`) → `approval`, action `referenced`. **(Commander has no create-approval tool — it decides on existing approvals; so approval refs are `referenced` only.)**
- `get_task` is ALREADY handled — extend, don't duplicate.

**Read each tool's handler first** to confirm the result shape actually carries the id (`created.id` / `{id,status}` / the approval id). Emit a ref ONLY when the result has a usable id.

- [ ] **Step 1 — failing tests.** In `output-refs.test.ts`, add cases keyed on the REAL tool names: `create_task` → `{v:2, kind:"task", id:<result id>, action:"created", provenance…}`; `update_task` → `kind:"task", action:"referenced"`; `suggest_memory` (and `write_memory`) → `kind:"memory_item", action:"created"`; `approval_decision` → `kind:"approval", action:"referenced"`. Each with a provenance ctx → stamped; 3-arg → `provenance:null`. Use the actual result-shape fixtures from the handlers.
- [ ] **Step 2 — implement.** Add switch cases in `buildOutputRefs` building `task`/`memory_item`/`approval` v2 refs via a small `navRef({kind,id,action}, ctx)` helper (mirrors `artifactRef` but for pointer kinds — no versionId; provenance via `buildProvenance`). Reuse the existing per-ref `nextSeq`/`provenanceBase` plumbing. Validate against `showRefsSchema`. Do NOT emit `discussion`/`url` (no producing tool). Guard each case on the id being present (a failed/empty result emits no ref).
- [ ] **Step 3 — verify + commit.** `pnpm test:run server/src/services/internal-agent/__tests__/output-refs.test.ts server/src/services/internal-agent/__tests__/mcp-bridge-output-refs.test.ts` + `pnpm --filter @armyofagents/server typecheck`. (The refs auto-flow through the Phase-6 merge/lift/deliver/render pipeline — the Commander tab bodies already exist. A quick reasoning check: a `task` ref chip → `openRefTab` `task` branch → `TaskDetail` — already wired.)
```
git commit -m "feat(commander): emit navigational task/memory_item/approval refs from tool results (Tier-3 emission)"
```

**7A checkpoint:** after Task 1, Commander navigational Tier-3 is live and testable end-to-end (Commander creates/updates a task → clickable chip → opens the task viewer). Natural point to pause for a live smoke if desired.

---

# PART 7B — Crew → Thread / Workspace delivery (post-run synthesis)

> **⚠️ STATUS: BLOCKED pending rework + product decisions (Codex review, 5 P1s).** Do NOT execute 7B as written below. The investigation-era assumptions broke down:
> - **P1-3 (delivery trigger):** `relayCrewResult` only posts on a task reaching `done`, but the default completion policy is `review_required` (Decision #109) — so a successful crew run commonly does NOT relay. Delivery is nondeterministic. Needs a decision: deliver only post-`done`, OR add a separate "run finished (in review)" delivery entry.
> - **P1-4 (run→output correlation):** there is NO durable way to identify "THIS crew run's outputs". `task_outputs.createdByRunId` → `heartbeat_runs` (not `internal_agent_runs`); crew `attach_task_artifact` sets no runId; `sameRunArtifacts` is an in-memory batch map, not queryable; artifacts keep `sourceActionId` not `runId`. Synthesis would grab ALL historical issue outputs and falsely stamp them with this run. Needs new correlation (schema linkage or `thread_agent_actions`→`artifacts.sourceActionId` join) OR an explicit "aggregate issue outputs, no run provenance" decision.
> - **P1-5 (workspace poke):** `heartbeat.run.outputs_detected` carries `{runId,agentId,count}` (no issueId) and follows a write to `heartbeat_runs.detected_outputs`, not `task_outputs`. Actual `task_outputs` mutations publish NO event. Needs a NEW `task.output.created {issueId,outputId}` event at the task-outputs upsert.
> - **P1-2 (workspace ingress):** an openRef adapter + bodies make Workspace *capable* of opening a ref but deliver none. Workspace needs an explicit ref ingress (where delivered refs live + render as chips) — not defined.
> - **Missing sources:** the synthesis list omits the origin `discussion` ref (Tasks 3/7 test it) and has no source for crew-created approval/memory refs.
>
> These require product/architecture decisions (completion-policy delivery semantics touch Decision #109; run-output correlation may need schema). **Surface to the user before proceeding.** Tasks 2-6 below are the pre-review skeleton and MUST be revised against these findings.


## Task 2: `discussion_entries.output_refs` column + shared ref-synthesis helper

**Files:** `packages/db/src/schema/discussions.ts` (+ migration), `server/src/services/viewer-ref-synthesis.ts` (NEW), tests.

- [ ] **Step 1 — schema.** Add `outputRefs: jsonb("output_refs")` (nullable, typed `ShowRef[] | null`, mirroring `internal_agent_messages.output_refs`) to `discussion_entries`. `pnpm db:generate` → `0175_*.sql`; hand-add `IF NOT EXISTS` to the ADD COLUMN; `migration-idempotency.test.ts` passes.
- [ ] **Step 2 — synthesis helper (TDD).** `synthesizeCrewDeliveryRefs({ db, companyId, issueId, threadId, runId })` → `ShowRef[]`: builds v2 refs from post-run context — (a) the completed **task** (`kind:"task"`, action:"referenced", provenance surface:"discussion", entityId:threadId), (b) its **`task_outputs`** rows (`kind:"output"` by id, or `kind:"url"` for url-type outputs, or `kind:"artifact"` for artifact-version outputs — map `task_outputs.type`), (c) its **artifacts** (reuse the Phase-3 `sameRunArtifacts` gathering if accessible). Dedup via `mergeOutputRefs`. Pure-ish (inject db reads); unit-test the ref shapes + provenance surface. Cap at `MAX_OUTPUT_REFS_PER_MESSAGE`.
- [ ] **Step 3 — commit.** schema + helper + tests; `pnpm --filter @armyofagents/db typecheck` + `@armyofagents/server` typecheck.
```
git commit -m "feat(viewer): discussion_entries.output_refs column + crew-delivery ref synthesis helper"
```

## Task 3: Write synthesized refs on the crew→thread relay + RBAC guard

**Files:** `server/src/services/crew-result-relay.ts` (`relayCrewResult`), `server/src/services/internal-agent/aoa-agents/crew-run-outcome.ts` (composition), tests.

- [ ] **Step 1 — write refs on the relay entry.** In `relayCrewResult` (the `done` path that inserts the "Completed" entry), call `synthesizeCrewDeliveryRefs(...)` and set the new `outputRefs` column on the inserted `discussion_entries` row. Best-effort (per-existing try/catch — never fail the relay). The existing `discussion.entry.created`/`thread.entry.created` pokes already fire → UI refetches.
- [ ] **Step 2 — cross-surface RBAC guard.** Ensure a `discussion` ref for a **private** thread is not synthesized onto an entry in a DIFFERENT (company-scoped) thread/surface. In practice: the relay writes onto the ORIGIN thread's own entry (same visibility), so this is naturally safe — assert it (the entry's discussionId === the ref's provenance.entityId thread), and add a test that a private-thread ref never lands on a broader surface. Opening any ref still re-checks RBAC at the REST route (pointer semantics).
- [ ] **Step 3 — commit.** `pnpm test:run` the crew-relay tests + `@armyofagents/server` typecheck.
```
git commit -m "feat(crew): deliver synthesized navigational refs onto the thread relay entry (RBAC-safe)"
```

## Task 4: Extract the reusable Commander tab bodies into a shared module

**Files:** NEW `ui/src/components/viewers/refBodies/` (or similar) — move `DiscussionRefTabBody`, `OutputRefTabBody` (+`OutputLinkCard`/`OutputDetailCard`), `MemoryItemRefTabBody` out of `CommanderViewerPanel.tsx` into exported, surface-agnostic components (they already self-fetch by id + companyId). `CommanderViewerPanel.tsx` imports them back. Tests: keep `OutputRefTabBodies.test.tsx` green (repoint imports).

- [ ] **Step 1 — extract, no behavior change.** Move the three bodies; make them take `{ companyId, refId, viewerKind? }` props explicitly (no Commander context). Commander re-imports. Confirm `OutputRefTabBodies.test.tsx` + `commanderViewerModel.test.ts` still pass unchanged (pure refactor).
- [ ] **Step 2 — commit.** `pnpm --filter @armyofagents/ui typecheck` + the viewer tests + `pnpm --filter @armyofagents/ui build`.
```
git commit -m "refactor(viewer): extract discussion/output/memory ref bodies to shared refBodies module (reuse across surfaces)"
```

## Task 5: Thread openRef adapter + chip rendering + missing bodies

**Files:** `ui/src/components/threads/threadViewerModel.ts` (add `openRef(ShowRef)` adapter), `ui/src/components/threads/EntryRow.tsx` (render `OutputRefChips` from `entry.outputRefs`), `ui/src/components/threads/ThreadViewer.tsx` (add discussion/approval/output-by-id bodies), `ui/src/pages/ThreadDetail.tsx` (wire chip-click → openRef → viewer tab), `ui/src/api/*` (surface `entry.outputRefs`). Tests.

- [ ] **Step 1 — openRef adapter.** Add `showRefToThreadTab(ref: ShowRef): ThreadViewerTab | ThreadOpenRequest` mapping the 8 kinds to Thread tabs: artifact/asset/task/memory/url → existing Thread tabs (reuse); discussion → NEW discussion body; approval → `ApprovalDetailCore`; output(-by-id) → extracted `OutputRefTabBody`. Unit-test the mapping.
- [ ] **Step 2 — chip rendering.** Thread `EntryRow` renders `OutputRefChips` (reused from commander/viewer, or moved to a shared `viewers/` location) from `entry.outputRefs`, wired to `openViewerTab(showRefToThreadTab(ref))`. Ensure `entry.outputRefs` is surfaced through the discussions API/types.
- [ ] **Step 3 — missing bodies.** Add to `ThreadViewer` body switch: `discussion` (extracted `DiscussionRefTabBody`), `approval` (`ApprovalDetailCore embedded`), `output`-by-id (extracted `OutputRefTabBody`). Reuse — do not rebuild.
- [ ] **Step 4 — commit.** thread viewer tests + `@armyofagents/ui` typecheck + build.
```
git commit -m "feat(discussions): render delivered navigational ref chips + openRef adapter + discussion/approval/output tab bodies"
```

## Task 6: Workspace poke fix + openRef adapter + missing bodies

**Files:** `ui/src/context/LiveUpdatesProvider.tsx` (handle `heartbeat.run.outputs_detected` → invalidate `taskOutputs.byIssue`), `ui/src/components/workspace/WorkspacePreviewPanel.tsx` + `WorkspaceLayout.tsx` (openRef adapter + missing bodies), tests.

- [ ] **Step 1 — poke fix.** Wire `heartbeat.run.outputs_detected` in `LiveUpdatesProvider` to invalidate `queryKeys.taskOutputs.byIssue(issueId)` (and any crew equivalent). Confirm the event carries an issueId; if not, use the broader invalidation the event supports. Test: the handler invalidates the right key.
- [ ] **Step 2 — openRef adapter + missing bodies.** Add `showRefToWorkspaceTab(ref): WorkspacePreviewTab` mapping: artifact/asset/url/output(detected) → existing; task → `TaskDetail`; approval → `ApprovalDetailCore`; discussion → extracted `DiscussionRefTabBody`; memory_item → extracted `MemoryItemRefTabBody`; output-by-id → extracted `OutputRefTabBody`. Add the new bodies to `WorkspacePreviewPanel` body switch. Wire via `openPreviewTab(..., "center")`.
- [ ] **Step 3 — commit.** workspace tests + `@armyofagents/ui` typecheck + build.
```
git commit -m "feat(workspace): wire outputs poke + openRef adapter + task/discussion/approval/memory tab bodies"
```

## Task 7: Completion gate

- [ ] `pnpm -r typecheck` → PASS.
- [ ] `pnpm test:run` the Phase-7 surface (output-refs, crew-relay, viewer-ref-synthesis, migration-idempotency, threadViewerModel, thread viewer, workspace preview, LiveUpdatesProvider) → PASS.
- [ ] `pnpm build` → PASS.
- [ ] **Reuse discipline grep:** the extracted bodies have ONE definition each (no copy-paste); `TaskDetail`/`ApprovalDetailCore` are imported, not reimplemented.
- [ ] **RBAC:** a private-thread discussion ref never synthesized onto a broader surface (Task 3 test).
- [ ] **No model merge:** the 4 viewer tab models remain separate; only thin `showRefTo*Tab` adapters were added.

---

## Self-Review / risks

- **Biggest risk: Task 2/3 synthesis correctness** — `task_outputs.type` → ref-kind mapping must be right (url-type → url ref, artifact-version → artifact ref, else → output-by-id). Get the `task_outputs` type enum from the schema.
- **Extraction (Task 4) must be behavior-preserving** — it's a pure refactor gating Tasks 5/6's reuse; keep Commander tests green unchanged.
- **Workspace poke (Task 6.1):** confirm `heartbeat.run.outputs_detected` payload shape before wiring; if it lacks issueId, a broader invalidation is acceptable.
- **`url`/`discussion` refs are context-synthesized, never tool-emitted** — do not add speculative tool cases.
- Live dogfood (final test) MUST verify: (a) codex reports `server:"aoa"` (Phase-6 P3-2), (b) a real crew run delivers clickable refs onto its thread entry, (c) clicking each ref kind opens the right body on each surface.

---

## Execution Handoff

**Subagent-driven**, spec + code-quality review per task. **7A (Task 1) lands first and is independently testable.** 7B tasks are mostly sequential (2→3 schema+write; 4 gates 5/6's reuse; 5/6 parallel-able after 4). `pnpm -r typecheck` + suites + `pnpm build` gate it; final live dogfood after Task 7.
