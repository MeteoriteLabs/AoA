# Commander Content Viewer — Phase 1 Design

**Date:** 2026-06-11
**Branch:** `feat/v1-commander-chat` (worktree `AoA-commander`, base `feat/v1-combined` @ `469ea6e44`)
**Status:** Approved design, pre-implementation

---

## 1. Purpose

Integrate the shared content viewer (already used by Workspace, Memory, and Discussions) into the Commander chat page, so a founder can **see** the work products Commander creates or references — without leaving the conversation.

Today, Commander tool results are reduced to a name + status in the UI; structured results (including artifact IDs from `create_artifact`) are discarded, unpersisted, and unrenderable. The viewer component stack is ready; Commander simply has no content source feeding it. This design adds that source (persisted **output refs**), the UI handles (**chips**), and the rendering surface (**viewer panel**).

Vocabulary: **chip** (clickable handle under a Commander reply) → opens a **tab** (rendered document in the right-side panel) → panel collapses to a **rail/strip** (thin right-edge tab rail).

## 2. Locked product decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Phase 1 scope | Viewer panel + artifact chips (persisted tool-result refs) + home tab + "open reply in viewer" pop-out. `get_task` artifact chips included. |
| 2 | Auto-open | Panel **always auto-expands** when a `created` ref arrives (desktop). No exceptions for user-collapsed state. |
| 3 | Layout | Collapsible right panel with **always-visible thin rail** (~28px: ⌂ + open-tab icons + chevron). Expanded default ~40% width, **drag-to-resize** (min 320px, max 60%). Discussions (`ThreadViewer`) pattern. |
| 4 | Tab memory | Per-conversation while the page is open (switching chats restores that chat's tabs). Hard reload starts clean. No storage. |
| 5 | Home tab (⌂) | Two groups: **"From this conversation"** (derived from the chat's own refs) above **"Recent in company"** (existing artifacts list API). Capital-D Documents system excluded until P2. |
| 6 | Mobile (<1024px) | Panel is a full-screen Sheet; rail becomes a floating tab pill. Exception to #2: creation **badges/pulses the pill** — never auto-opens the sheet. |
| 7 | Persistence approach | **JSON `outputRefs` column on `internal_agent_messages`** + enriched SSE. No refs table (promotion path documented in §10). |
| 8 | Host gating | Commander page only. `AgentPanelContent` gains `enableViewerPanel` prop; only `Commander.tsx` passes `true`. The unused `w-80` docked `InternalAgentPanel` variant stays viewer-free. |

## 3. Backend design

### 3a. `CommanderOutputRef` (new type, `packages/shared/src/`)

```ts
interface CommanderOutputRef {
  v: 1;                              // ref schema version
  kind: "artifact";                  // P1. P2 extends: "asset" | "task" | "thread" | "file" | "document"
  id: string;                        // artifactId
  versionId?: string | null;
  versionNumber?: number | null;     // chip "v2" badge
  title: string;                     // chip label
  action: "created" | "referenced";  // created → auto-open; referenced → click-only
  toolCallId?: string | null;
  mimeType?: string | null;          // viewer-resolution hint
}
```

Rules: **max 20 refs/message** (builder truncates; `created` survives trimming first); dedupe by `(kind, id, versionId)` with `created` winning over `referenced`. Refs carry IDs + labels only — never content.

### 3b. Ref-builder (new file `server/src/services/internal-agent/output-refs.ts`)

`buildOutputRefs(toolName: string, result: ToolResult): CommanderOutputRef[]` — pure function, no DB access. ToolResult shape: `{ success, data, summary, error? }` (`server/src/services/internal-agent/types.ts:40`).

| Tool | Mapping |
|------|---------|
| `create_artifact` | `created` ref from result data |
| `create_artifact_version` | `created` ref with new versionId/versionNumber |
| `query_artifacts` | `referenced` ref per result row (cap applies) |
| `attach_task_artifact` | `referenced` ref for the linked artifact |
| `get_task` | `referenced` ref iff `data.artifactId` non-null (`get-task-tool.ts:81`); title falls back to task title — viewer resolves the real artifact name at open time |
| anything else | `[]` |

`read_file` is excluded from P1 (its content has no stable fetch URL; joins P2 as `file` kind).

### 3c. Live path (SSE enrichment)

The internal stream chunk already carries the full ToolResult (`agent-loop.ts:37`: `{ type: "tool_result"; name; result }`). The route currently strips it to `{ name }` (`server/src/routes/internal-agent.ts:248-250`).

Change: `agent-loop.ts` computes `refs` once per tool completion and attaches them to the chunk; the route forwards `{ name, refs? }` in the existing `tool_result` SSE event. `refs` omitted when empty — backward compatible; no new event type. The client's auto-open trigger is a live ref with `action === "created"`.

### 3d. Persistence path

- Schema: add `outputRefs: jsonb("output_refs")` to `internalAgentMessages` (`packages/db/src/schema/internal_agent.ts:191-204`), beside existing `toolCalls`/`toolResults`. Migration via `pnpm db:generate` (Drizzle only). Additive + nullable = safe.
- Write: agent-loop accumulates the run's refs (dedupe + cap applied across the run) and passes them to `conversation.addMessage(...)` (`conversation.ts:48-53`) when the assistant message persists post-stream.
- Read: history endpoint adds `outputRefs` to its message projection; client `AgentMessage` type (`ui/src/api/internal-agent.ts:23`) gains `outputRefs`.

Not touched: the existing-but-unwritten `toolResults` column (refs are the distilled projection; we do not start persisting full tool payloads); no new tables; no new endpoints.

### 3e. Why a JSON column, not a refs table (decision rationale)

- Refs are **presentation anchors** — read 100% of the time with their message (history loads are paginated, `getRecentMessages` limit 50); never queried across conversations in P1.
- Entities and audit already live in the right layers: `artifacts`/`artifact_versions` (normalized, immutable, source-attributed) and `activity_log`/`internal_agent_runs` (audit). A refs table would duplicate audit duty — two sources of truth that can disagree.
- Established repo pattern: `internal_agent_messages` already carries `toolCalls` jsonb.
- Owner-scoped conversations give multi-user isolation for free; a new table = another place to hand-implement company/user scoping.
- Deletion semantics: conversation hard-delete already exists; column refs die with messages automatically.
- Summarization is safe: `conversation.ts:154` writes `summarizedContext` on the conversation; message rows are never deleted/pruned.
- Promotion path if P2 ever needs indexed ref queries: boring backfill (scan JSON → insert rows), zero data loss.

## 4. Frontend design

### 4a. New components (`ui/src/components/commander/viewer/`)

| File | Job |
|------|-----|
| `CommanderViewerPanel.tsx` | Right-edge shell: collapsed rail ⇄ expanded resizable panel; hosts tab bar + active tab body. Resized width persists for the page session only (component state, not stored). |
| `CommanderViewerHome.tsx` | ⌂ tab: "From this conversation" (refs aggregated from currently loaded messages — last page of history; no new API) + "Recent in company" (existing artifacts list API). |
| `OutputRefChips.tsx` | Chip row under assistant bubbles: type icon + title + version badge; `created` gets accent treatment; click → focus existing tab or open new. |
| `useCommanderViewer.ts` | State hook: `Map<conversationId, TabState>` (per-chat tab sets, reload starts clean), expand/collapse, active tab, `openRef()`. Pure logic exported for unit tests (pattern: `commanderInputModel.ts`). |

Rendering reuses the existing viewer stack unchanged: `ViewerTabs` + `SharedContentViewer` + `resolveViewer` (`ui/src/components/viewers/`). Artifact tabs fetch via the existing artifacts API and feed version content as `inlineTextContent` (or asset URL) — same pattern as `ThreadViewer`'s artifact tabs (`ThreadViewer.tsx:531-535`).

### 4b. Integration (`InternalAgentPanel.tsx` + `Commander.tsx`)

- `AgentPanelContent` gains `enableViewerPanel?: boolean`; chat column + viewer panel wrap in a flex row (messages keep centered max-width).
- Live: SSE `tool_result.refs` accumulate onto the streaming message's local state → chips render immediately → every `created` ref auto-expands the panel (if collapsed) and focuses its tab.
- History: `AgentMessage.outputRefs` renders the same chips after reload.
- Reply pop-out: hover affordance on assistant bubbles ("⧉ Open in viewer") opens a markdown tab with the message text as `inlineTextContent`. Client-only; no file/artifact is created.
- `Commander.tsx` passes `enableViewerPanel` (one-line change).

### 4c. Required states

- Tab loading: skeleton while artifact/version fetches.
- Unavailable: deleted artifact or 403 → one friendly "no longer available" tab state (both causes), with retry.
- Home tab empty: "Nothing yet — ask Commander to draft something."
- Streaming interplay: panel expansion respects existing `shouldAutoScroll` logic.

## 5. Multi-user & RBAC model

- **Zero new authorization surface.** Refs are pointers, not capability grants. Content loads through existing artifact/asset endpoints, which authorize the requester at fetch time — per person, per click. Role changes, deletions, founder-viewing-another-user's-chat all resolve correctly at open time.
- Refs are born under the requester's authority: derived only from tool calls that passed existing `requiredRole`/capability/confirmation gates.
- Isolation by construction: refs ride owner-scoped conversations/messages.
- SSE refs go only to the requesting user's stream.
- Rendering safety inherited: chip titles are escaped React text; html/svg render in `SharedContentViewer`'s existing sandboxed iframes.

## 6. Failure behavior

Prime directive: **chips must never break chat.**

- Ref-builder is defensive: malformed tool data → skip ref, log, never throw. Ref extraction cannot fail a tool call or a reply.
- Refs are zod-validated at the write path; invalid refs are dropped, the message always saves.
- Client ignores unknown `kind` values and future `v` values (forward compatible with P2).
- Old server + new client (or vice versa): chips simply don't appear; chat unaffected.

## 7. Testing

- **Server pure:** `output-refs.test.ts` — per-tool mapping, dedupe precedence, 20-cap, malformed-data tolerance. No drizzle imports.
- **Server contract:** SSE `tool_result` payload shape `{ name, refs? }`; `addMessage` persists `outputRefs` (sequence-mock DB style if needed).
- **UI pure:** `commanderViewerModel.test.ts` — tab reducer (open/focus/close, per-conversation map, reload reset), auto-open predicate (created × desktop vs mobile-badge), streaming ref accumulation.
- **UI component:** `OutputRefChips` render/click; collapsed-rail render. (Conventions: `commanderInputModel.test.ts`, `SessionRow.a11y.test.tsx`.)
- E2E smoke: optional follow-up; not P1 scope.

## 8. Change inventory

| Layer | Changes |
|-------|---------|
| `packages/shared` | + `CommanderOutputRef` type (exported) |
| `packages/db` | + `outputRefs` jsonb on `internalAgentMessages`; `pnpm db:generate` migration |
| `server` | + `services/internal-agent/output-refs.ts`; `agent-loop.ts` (compute/accumulate refs, chunk carries refs); `conversation.ts` (persist); `routes/internal-agent.ts` (SSE enrichment + history projection) |
| `ui` | + 4 files under `components/commander/viewer/`; `InternalAgentPanel.tsx` (prop-gated row layout, chips, SSE accumulation, auto-open, pop-out); `Commander.tsx` (prop); `api/internal-agent.ts` (types) |

No feature flag — additive everywhere; ship direct.

## 9. Out of scope for Phase 1

- Editing inside the viewer (artifact versions are immutable; iteration happens through Commander → new version).
- Inline thumbnails/previews inside chat bubbles (chips stay light).
- `read_file` refs, task/memory/thread attachment refs, `task_outputs` index refs.
- Capital-D Documents system anywhere (chips or home tab).
- True canvas-style streaming of replies.
- E2E coverage.

## 10. Phase 2 roadmap (recorded, not designed)

- New ref kinds: `asset`, `task`, `thread`, `file`, `document`.
- Thread tools return attachment refs → "pull a discussion and see its attachments" becomes fully seamless.
- `get_task`/task tools surface `task_outputs` (unified product index: files, preview URLs, PRs).
- Memory assets; Documents in home tab; canvas streaming.
- Refs-table promotion (backfill from JSON) only if backlink-style queries ("all chats touching artifact X") materialize as a product surface.
