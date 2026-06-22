# Commander Phase 4 — Confirmation Pipeline Rebuild + Autonomy Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle "parse LLM prose for markers" pipeline with "parse structured stream-json tool_result events for markers" for `claude_cli`. Keep marker-in-prose fallback for codex/opencode. Bundle the Phase 3 sidebar count fix. Set the foundation for the autonomy ladder + Permissions UI runtime enforcement.

**Key architectural insight (verified 2026-05-20):**
- Phase 2's bug wasn't "wrong marker format" — it was "wrong parsing location". The `⚡CONFIRM:...⚡` marker was correctly emitted from the MCP bridge, but parsed against the LLM's prose stdout reply (which the LLM can paraphrase/omit).
- In `--output-format stream-json`, the LLM's tool calls and tool results arrive as **discrete structured events**. The `tool_result` content from our MCP server is in `user.message.content[].tool_result.content[].text` — that's **what the MCP server returned literally**, before the LLM has any chance to interpret or paraphrase.
- We keep the **same marker text** (`⚡CONFIRM:{json}⚡`). We change **where we look for it** — from LLM prose stdout (fragile) to structured `tool_result` content (reliable).

**Scope (locked 2026-05-20):**
- B1: Claude-first, marker-in-prose fallback for codex/opencode_local.
- Commander-only. Worker agents (`server/src/adapters/`) verified untouched: zero imports of `internal-agent/cli-mode` or `internal-agent/mcp-bridge` from any non-test production file outside Commander's own stack.

**Pre-execution verifications completed:**
- ✅ V1: `claude --help` confirms `--output-format stream-json` flag.
- ✅ V2 (corrected): `--input-format stream-json` exists BUT is incompatible with `-p "text"` — using both together produces only SessionStart hook events. **Use only `--output-format stream-json` with `-p` for input.** No subprocess stdin refactor needed.
- ✅ V4 (full): Real `claude -p ... --output-format stream-json --include-partial-messages --verbose --allowedTools "Read"` capture shows complete tool roundtrip. Key shape findings:
  - `user.message.content[].tool_result.content` is a **STRING** (not array of content blocks). Marker regex runs on it directly.
  - Field names are **snake_case**: `tool_use_id`, `is_error`, `input` (not camelCase).
  - Event order: assistant(tool_use) → user(tool_result) → assistant(text). The `tool_result` arrives BEFORE the LLM writes prose, so our marker detection is structurally impossible to interfere with.
  - Additional events to silent-consume: `thinking` content blocks, `signature_delta` deltas (part of thinking), `message_start`/`message_stop`/`message_delta` wrappers.
- ✅ V3: Don't need MCP `_meta` — marker-in-string at `user.tool_result.content` is reliable. Parsed BEFORE the LLM can interpret it.
- ✅ V5: Worker agent isolation verified — `server/src/adapters/` has zero imports from `internal-agent/cli-mode` or `mcp-bridge`.

**Tech Stack:** TypeScript, Node.js subprocess streams, Claude Code CLI stream-json JSONL protocol, Vitest, React.

---

## What's changing vs Phase 2

**Before (Phase 2):**
```
mcp-bridge.ts returns text containing "⚡CONFIRM:{...}⚡"
  →  LLM reads it as tool_result
  →  LLM writes prose reply (text format stdout)
  →  prose may or may not echo the marker
  →  parseCliOutput greps stdout for marker — FRAGILE
```

**After (Phase 4 for claude_cli):**
```
mcp-bridge.ts returns text containing "⚡CONFIRM:{...,"confirmId":"<uuid>"}⚡"
  →  Claude CLI in stream-json mode emits "user" event with tool_result block
  →  tool_result.content[0].text contains our marker (LITERAL — never paraphrased)
  →  parseStreamJsonLine extracts marker from structured event
  →  emits action_confirmation chunk  →  SSE  →  amber card renders
```

**After (Phase 4 for codex/opencode):** unchanged from Phase 2 (marker-in-prose). Commander page shows a small "best-effort confirmation" pill explaining the trade-off.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/src/services/internal-agent/mcp-bridge.ts` | Modify | Add `confirmId` to the marker JSON payload (small one-line change) |
| `server/src/services/internal-agent/cli-mode.ts` | Modify | Add `--output-format stream-json --input-format stream-json --include-partial-messages --verbose` for claude_cli; branch parser by provider |
| `server/src/services/internal-agent/parse-stream-json.ts` | Create | Parse Claude stream-json JSONL events → AoA chunk stream |
| `server/src/__tests__/parse-stream-json.test.ts` | Create | Unit tests for the new parser with real event fixtures |
| `ui/src/components/InternalAgentPanel.tsx` | Modify | Add Tanstack `invalidateQueries(["commander-conversations"])` after chat-done; (optional) show "best-effort" badge for non-claude CLIs |
| `ui/src/components/settings/sections/CommanderSection.tsx` | Modify | Update Permissions tab banner wording for the per-CLI reality |
| `docs/superpowers/uat/2026-05-20-commander-uat.md` | Modify | Run 3 results section after Phase 4 lands |

---

## Task 1: Include `confirmId` in the marker JSON payload

**Files:**
- Modify: `server/src/services/internal-agent/mcp-bridge.ts`
- Modify: `server/src/services/internal-agent/cli-mode.ts` (where parseCliOutput consumes the marker)

The existing marker JSON only carries `toolName` and `params`. Phase 2's `parseCliOutput` generates a fresh `confirmId: crypto.randomUUID()` when it parses the marker. That worked for the prose-marker fallback but couples confirmId generation to parsing time. For Phase 4, we want the server to generate confirmId once at bridge-time and have it travel through the marker so BOTH the stream-json parser AND the legacy parseCliOutput see the same id.

- [ ] **Step 1: Locate the confirmation branch in `createToolCallHandler`**

In `server/src/services/internal-agent/mcp-bridge.ts`, find the block that emits `⚡CONFIRM:...⚡` (Phase 2 Task 1 code).

- [ ] **Step 2: Generate `confirmId` at the bridge and include it in the marker**

```typescript
import { randomUUID } from "node:crypto";

// Inside createToolCallHandler, where requiresConfirmation triggers:
if (tool.requiresConfirmation) {
  const confirmId = randomUUID();
  const payload = JSON.stringify({ toolName: tool.name, params: input, confirmId });
  return {
    content: [
      {
        type: "text",
        text: `⚡CONFIRM:${payload}⚡ ${tool.name} requires user approval before it can run.`,
      },
    ],
    isError: false,
  };
}
```

- [ ] **Step 3: Update legacy `parseCliOutput` to use the marker's confirmId**

In `server/src/services/internal-agent/cli-mode.ts`, find the marker-parsing block. Currently it generates a fresh UUID. Change to:

```typescript
const parsed = JSON.parse(match[1]);
chunks.push({
  type: "action_confirmation",
  toolName: parsed.toolName,
  params: parsed.params,
  runId: parsed.confirmId ?? crypto.randomUUID(),  // fall back for older bridge output
});
```

- [ ] **Step 4: Run existing tests — must still pass**

```bash
pnpm vitest run server/src/__tests__/commander-confirm-flow.test.ts
pnpm vitest run server/src/__tests__/commander-action-confirmation.test.ts
pnpm vitest run server/src/__tests__/commander-cli-parse-confirm.test.ts
```

Expected: same baseline. The added `confirmId` field in the marker JSON is additive.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/mcp-bridge.ts server/src/services/internal-agent/cli-mode.ts
git commit -m "feat(commander): include confirmId in CONFIRM marker payload for consistent server-side id"
```

---

## Task 2: Create `parse-stream-json.ts`

**Files:**
- Create: `server/src/services/internal-agent/parse-stream-json.ts`
- Create: `server/src/__tests__/parse-stream-json.test.ts`

Parse the actual Claude CLI stream-json JSONL event shape (verified empirically).

**Real event types we handle:**
- `system` — silently consumed (init, hook_started, hook_response, status, post_turn_summary subtypes)
- `stream_event` — wrapper for token-level streaming. Inner `event.type` of interest:
  - `content_block_start` with `content_block.type === "tool_use"` → emit `tool_call` chunk
  - `content_block_delta` with `delta.type === "text_delta"` → emit `text` chunk (`delta.text`)
  - other content_block types (input_json_delta for tool_use args streaming) → accumulate or skip
- `assistant` — full accumulated message at end of a content block. Use as authoritative for tool_use blocks where we need the complete `input` (input_json_delta accumulation alternative). Skip text content (already streamed via stream_event).
- `user` — tool results. **This is where we look for the marker.** Each `message.content[]` block of type `tool_result` has a `content` array; iterate text content blocks and run the marker regex. If match, emit `action_confirmation`. Otherwise emit `tool_result`.
- `result` — subtype `success` → emit `done` chunk with usage/cost from the event payload.
- `rate_limit_event` — silently consumed.

- [ ] **Step 1: Write tests first with real captured fixtures**

Create `server/src/__tests__/parse-stream-json.test.ts`. Use real JSONL captured from a `claude --output-format stream-json` invocation. Important fixtures:

1. **System init only** → no chunks emitted.
2. **Text streaming** via `stream_event.content_block_delta` → emits `text` chunk per delta with concatenable `delta` field.
3. **Tool call** via `assistant` event with `tool_use` content block → emits `tool_call` chunk with name + input + toolUseId.
4. **Plain tool result** via `user` event → emits `tool_result` chunk.
5. **Confirmation-gated tool result** via `user` event whose `tool_result.content[].text` contains `⚡CONFIRM:{...}⚡` → emits `action_confirmation` chunk with `runId` from the marker JSON.
6. **Multiple events in one push** (partial-line buffering) → each emits the right chunk in order.
7. **Malformed JSON line** → silently ignored (no throw).
8. **Empty/blank lines** → silently ignored.

Use the actual JSONL we just captured during V4 verification as the foundation for fixtures.

- [ ] **Step 2: Implement the parser**

```typescript
import { randomUUID } from "node:crypto";
import type { CliChunk } from "./types.js";

const CONFIRM_RE = /⚡CONFIRM:(.*?)⚡/;

export interface StreamJsonParser {
  push(text: string): CliChunk[];
  flush(): CliChunk[];
}

export function createStreamJsonParser(): StreamJsonParser {
  let buffer = "";

  return {
    push(text: string): CliChunk[] {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      const chunks: CliChunk[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          chunks.push(...mapEventToChunks(event));
        } catch {
          // Malformed line — silently ignore. Claude CLI in stream-json
          // mode shouldn't emit non-JSON, but be defensive.
        }
      }
      return chunks;
    },

    flush(): CliChunk[] {
      if (!buffer.trim()) return [];
      try {
        const event = JSON.parse(buffer);
        buffer = "";
        return mapEventToChunks(event);
      } catch {
        buffer = "";
        return [];
      }
    },
  };
}

function mapEventToChunks(event: any): CliChunk[] {
  if (!event?.type) return [];

  switch (event.type) {
    case "system":
    case "rate_limit_event":
      return [];

    case "stream_event": {
      const inner = event.event;
      if (!inner?.type) return [];
      if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
        return [{ type: "text", delta: inner.delta.text ?? "" }];
      }
      if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
        // tool_use start — emit tool_call shell. Real `input` arrives via
        // input_json_delta streaming OR via the final assistant event.
        // We prefer waiting for the assistant event for the complete input.
        return [];
      }
      return [];
    }

    case "assistant": {
      const content = event.message?.content ?? [];
      const chunks: CliChunk[] = [];
      for (const block of content) {
        if (block.type === "tool_use") {
          chunks.push({
            type: "tool_call",
            name: block.name,
            params: block.input,
            toolCallId: block.id,
          });
        }
        // Skip text content here — already streamed via stream_event deltas.
      }
      return chunks;
    }

    case "user": {
      const content = event.message?.content ?? [];
      const chunks: CliChunk[] = [];
      for (const block of content) {
        if (block.type !== "tool_result") continue;

        // VERIFIED: block.content is a STRING (not an array of typed blocks).
        // Even for MCP tool results, Claude CLI concatenates returned content into a string.
        const fullText: string = typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c: any) => (c?.type === "text" ? c.text : "")).join("")
            : "";

        const match = CONFIRM_RE.exec(fullText);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            chunks.push({
              type: "action_confirmation",
              toolName: parsed.toolName,
              params: parsed.params,
              runId: parsed.confirmId ?? randomUUID(),
            });
            continue;
          } catch {
            // Marker JSON malformed — fall through to plain tool_result emission
          }
        }

        chunks.push({
          type: "tool_result",
          name: block.name ?? "unknown",
          toolCallId: block.tool_use_id,  // snake_case verified
          result: fullText,
          isError: block.is_error ?? false,  // snake_case verified
        });
      }
      return chunks;
    }

    case "result":
      return [{
        type: "done",
        summary: event.subtype === "success" ? "complete" : event.subtype,
        cost: event.total_cost_usd,
        usage: event.usage,
      }];

    default:
      return [];
  }
}
```

Adapt the exact `CliChunk` type names + extra fields to match the project's existing types.

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run server/src/__tests__/parse-stream-json.test.ts
```

Expected: 8/8 pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/internal-agent/parse-stream-json.ts server/src/__tests__/parse-stream-json.test.ts
git commit -m "feat(commander): add parse-stream-json with marker detection in tool_result events"
```

---

## Task 3: Wire stream-json into `cli-mode.ts` for `claude_cli` only

**Files:**
- Modify: `server/src/services/internal-agent/cli-mode.ts`

Switch the claude_cli invocation flags and route output parsing to `createStreamJsonParser`. Keep marker-in-prose path active for `codex` and `opencode_local`.

- [ ] **Step 1: Add `--output-format stream-json --include-partial-messages --verbose` to claude_cli args**

Find lines 332 and 344 (both claude_cli return blocks). Change:

```typescript
// BEFORE
"--output-format", "text",

// AFTER (both return blocks)
"--output-format", "stream-json",
"--include-partial-messages",
"--verbose",
```

The `--include-partial-messages` flag enables `stream_event.content_block_delta` events for text streaming.

`--verbose` is recommended for stream-json modes per Claude CLI docs.

**Do NOT add `--input-format stream-json`** — empirically verified incompatible with `-p "text"` (only emits SessionStart hook events). Keep `-p` as the input channel; only the output format changes.

- [ ] **Step 2: Branch the parser by provider**

In `streamProcessOutput` (or wherever stdout is consumed line-by-line), branch:

```typescript
const useStreamJson = params.provider === "claude_cli";
const streamParser = useStreamJson ? createStreamJsonParser() : null;

// In the read loop:
for (const chunk of streamParser ? streamParser.push(text) : parseCliOutput(text)) {
  yield chunk;
}

// On stream end:
if (streamParser) {
  for (const chunk of streamParser.flush()) yield chunk;
}
```

- [ ] **Step 3: Manual smoke test (start dev server)**

Start `pnpm dev` in the worktree. Open `http://localhost:3100/AOA/commander`. Send a plain message ("hi"). Expected: response streams correctly. If garbled, parser is buggy or flag combination is wrong.

- [ ] **Step 4: Manual confirmation flow test**

Send "Update our company vision to: We are building the future of work." Expected:
- Within 10-20s, an amber confirmation card renders in chat with Approve / Cancel buttons.
- Card content shows `update_company_identity` and the vision param.

Click Approve. Verify via `curl http://localhost:3100/api/companies | jq` that the company's `vision` field is now set.

Click Cancel on a fresh attempt (e.g., "Update mission to: …"). Verify mission stays null.

- [ ] **Step 5: Run server test suite — no new failures**

```bash
pnpm vitest run server/src/__tests__
```

Expected: baseline preserved.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/cli-mode.ts
git commit -m "feat(commander): use stream-json + structured marker parsing for claude_cli (marker-in-prose remains for codex/opencode)"
```

---

## Task 4: Bundle the Phase 3 sidebar count refresh

**Files:**
- Modify: `ui/src/components/InternalAgentPanel.tsx`

After the chat round-trip completes, invalidate the conversation-list query so the sidebar's `… · N msgs` count refreshes.

- [ ] **Step 1: Locate the `finally` block in `sendText`**

Around lines 269-281 of `InternalAgentPanel.tsx`. The existing block already calls `queryClient.invalidateQueries({ queryKey: queryKeys.agentConversation(companyId) })`.

- [ ] **Step 2: Add the sidebar-list invalidation**

```typescript
queryClient.invalidateQueries({ queryKey: ["commander-conversations"] });
```

Place immediately after the existing invalidate so both fire together at chat-done.

- [ ] **Step 3: TypeScript check**

```bash
pnpm --filter ui tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/InternalAgentPanel.tsx
git commit -m "fix(commander): refresh sidebar message count after chat round-trip completes"
```

---

## Task 5: UI "best-effort" badge for non-claude CLIs + banner update

**Files:**
- Modify: `ui/src/pages/Commander.tsx`
- Modify: `ui/src/components/settings/sections/CommanderSection.tsx`

- [ ] **Step 1: Get current CLI tool in Commander page**

Use the existing `internalAgentApi.getConfig(companyId)` (or whichever query already pulls config). Field name is likely `cliTool` (per Phase 2 Task 7 Settings page inspection). Verify by reading the existing Settings code.

- [ ] **Step 2: Show a pill when cliTool is NOT `claude_cli`**

In `Commander.tsx`, above the chat area:

```tsx
{config && config.cliTool && config.cliTool !== "claude_cli" && (
  <div className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 inline-flex items-center gap-1.5">
    <Info className="h-3 w-3" />
    Confirmation gates use best-effort detection on {config.cliTool}. Switch to Claude CLI for strict gating.
  </div>
)}
```

- [ ] **Step 3: Update the Permissions tab banner in CommanderSection.tsx**

Change the existing "stored but not yet enforced at runtime" banner text to:

```
Per-tool permissions are stored. Runtime enforcement: Claude CLI is fully gated; codex and opencode use best-effort marker detection. For guaranteed gating, set Commander to Claude CLI under Execution & Model.
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm --filter ui tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/Commander.tsx ui/src/components/settings/sections/CommanderSection.tsx
git commit -m "feat(commander): surface CLI-specific confirmation reliability (badge + banner)"
```

---

## Task 6: Manual UAT Run 3 + Sections D, E, I

**Files:**
- Modify: `docs/superpowers/uat/2026-05-20-commander-uat.md`

Re-run UAT with the new pipeline. Must-pass behaviour:

- "Update our company vision to: <text>" → amber card appears within 10-20s (during the Claude reply) → click Approve → vision committed.
- Click Cancel on a different prompt → no commit; `pendingConfirmations` Map entry cleared server-side.
- Send any message → sidebar `… · N msgs` updates within 1s of chat-done.
- Run Sections D (options prompt), E (use_skill), I (edge cases) that were deferred in Run 1.

- [ ] **Append Run 3 results to UAT doc** — same shape as Run 1.

- [ ] **Commit**

```bash
git add docs/superpowers/uat/2026-05-20-commander-uat.md
git commit -m "docs(uat): record Run 3 results — stream-json confirmation flow verified end-to-end"
```

---

## Self-review checklist

Before Phase 4 is done:

- [ ] "Update vision" prompt with claude_cli triggers the amber card. Approve commits. Cancel does not.
- [ ] codex/opencode users still get the marker-in-prose path AND see the "best-effort" badge.
- [ ] Sidebar msg-count refreshes after each chat round-trip.
- [ ] `pnpm vitest run server/src/__tests__` — same baseline (zero new failures).
- [ ] `pnpm --filter ui tsc --noEmit` and `pnpm --filter server tsc --noEmit` clean.
- [ ] Worker agents untouched — `server/src/adapters/` has no new imports from `internal-agent/`.
- [ ] UAT Run 3 results documented.

---

## What's still NOT in this phase

- **Autonomy ladder UI** — Phase 5.
- **Runtime enforcement of `commanderToolPermissions`** — Phase 5.
- **Per-CLI structured parsing for codex / opencode** — Phase 6, only if demand exists.
- **DB-persisted `pendingConfirmations`** — Phase 7 hardening.
- **Migrate Commander to Claude Agent SDK** — Phase 8 evolution. This Phase 4 stream-json work is the stepping stone toward it.

---

## Execution

Recommended: `superpowers:subagent-driven-development`. 6 tasks, mostly independent, benefit from fresh-context isolation. Two-stage review per task (spec compliance, then code quality).

Estimated effort: ~2-2.5 working days at subagent pace.
