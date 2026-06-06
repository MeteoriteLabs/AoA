# MCP stdio bridge — robust fix (design / spec)

**Status:** approved design (2026-06-06). Next: writing-plans → plan-eng-review → implement (TDD).
**Branch:** `fix/codex-mcp-bridge` off `origin/feat/v1-combined`.
**Decision:** no shortcuts — replace the hand-rolled stdio protocol loop with the official MCP SDK transport; do not band-aid the custom loop.

## Goal

Make the AoA MCP **stdio bridge** correct and robust so CLI-adapter crew agents (codex / opencode / gemini) can actually execute their MCP tools (`post_entry`, `thread.updateSummary`, …) end-to-end, and so a transport failure can never again be reported as a silent `succeeded`. claude is unaffected and must stay working.

## Root cause (confirmed + reproduced live)

`server/src/services/internal-agent/mcp-bridge.ts` is a hand-rolled JSON-RPC-over-stdio server (readline loop + `process.stdout.write` + `process.exit`). At lines 261-263:

```js
rl.on("close", () => { process.exit(0); });
```

When the CLI client half-closes stdin between request batches, `rl`'s `close` fires and the process exits **before in-flight async `tools/call` handlers finish and write their response**. The client sees `Transport closed` for every call. The agent run still completes and reports `succeeded` while posting nothing.

**Evidence:** codex session transcripts contain *"every AoA MCP call failed with `Transport closed`, including thread.listEntries … and post_entry."* Deterministic repro: spawn the real bridge, send `initialize`→`tools/list`→`tools/call` then EOF → init+list respond, `tools/call` gets **no** response, process exits 0, stderr empty. Hold stdin open → the same `tools/call` responds correctly. So tool/DB/model/auth are all fine; the premature exit is the whole bug.

## Blast radius (verified)

| Adapter | Uses `mcp-bridge` (shared)? | Wiring |
|---|---|---|
| codex-local | ✅ | `config.toml [mcp_servers.aoa]`, `tsx mcp-bridge.ts` |
| opencode-local | ✅ | `opencode.json`, `node mcp-bridge.js` |
| gemini-local | ✅ | gemini MCP config |
| **claude-local** | ❌ | native `--mcp-config <file>` (`isClaudeFamily`, `runner.ts:360`) — **untouched** |
| cursor / grok / openclaw / acpx / pi | ❌ | no MCP bridge |

One file, three providers. The fix must keep all three working (test the shared contract); claude carries zero risk.

## Latent fragilities in the same file (all addressed)

- **Unguarded stdout:** protocol frames via raw `process.stdout.write`; any `console.log` / DB notice corrupts framing.
- **Crash on tool error:** approval path (`mcp-bridge.ts:~98,109`) awaited *outside* try/catch in the async readline handler → uncaught rejection kills the process.
- **No protocol negotiation:** hardcoded `protocolVersion "2024-11-05"`.
- **Naive line framing:** readline assumes one JSON object per line.

## Design

### A. Transport: official MCP SDK

Replace the readline/`process.stdout.write`/`process.exit` loop in `mcp-bridge.ts` with `@modelcontextprotocol/sdk`:
- `Server` (`@modelcontextprotocol/sdk/server/index.js`) + `StdioServerTransport` (`…/server/stdio.js`).
- Register `ListToolsRequestSchema` → `buildToolListResponse(filterAuthorizedToolsForContext(...))` and `CallToolRequestSchema` → existing `handleToolCall`.
- **Keep the entire tool layer unchanged:** `createToolRegistry`, `executeTool`, `authorize-tool`, env-derived `ToolContext`, `createToolCallHandler`. Only the transport/protocol switch is replaced. `createToolCallHandler` and `buildToolListResponse` stay exported (existing unit tests keep passing).
- The SDK owns framing, version negotiation, and request→response lifecycle: stdin EOF no longer drops an in-flight response (stdout stays open; the handler completes and writes). New dependency: `@modelcontextprotocol/sdk` (vet version/license/size in the plan; pin it).

### B. Lifecycle + parent-liveness watchdog

The SDK does not `process.exit` on stdin end. We add an explicit watchdog so the bridge exits when its spawning CLI dies (no orphans — the piled-up codex.exe), but **never mid-call**:
- Poll/observe the parent process (PPID liveness) on an interval; on parent death, close the transport + exit cleanly.
- On `transport.onclose` (genuine session end), exit 0 **after** in-flight handlers settle.
- Never call `process.exit` from a stdin event.

### C. stdout discipline + crash isolation

- All bridge logging → **stderr** only (stdout reserved for protocol). Add a one-line guard/assert in dev that nothing else writes stdout.
- Install `process.on('unhandledRejection')` + `process.on('uncaughtException')` → log to stderr, do **not** exit.
- Wrap every tool handler (incl. the approval path) so a throw becomes an `isError` tool result, never a process crash.

### D. Loud failure (detect → fail the run → surface)

Today a run whose every MCP call failed still reports `succeeded`. Detection signal = the **CLI's structured output stream**, not agent prose:
- Each CLI adapter already parses its run output (`codex` JSONL via `parse.ts`; opencode/gemini equivalents). Extend the parse to detect **MCP tool-call transport/connection failures** (e.g. `Transport closed`, MCP server disconnect, tool-call error events) and count them.
- If a run had MCP tool-call attempts and ≥1 (configurable threshold) failed with a transport/connection-class error, set the adapter result to **failed** with a clear `errorMessage` ("AoA MCP bridge transport failed: <detail>") instead of success.
- `runner.ts` propagates that to the `heartbeat_runs` row (status `failed` + error), so it shows in the run record/UI. **No auto-retry, no new UI surface** beyond the existing run record (per decision).
- Shared helper for the detection (one implementation, used by the three adapters' parse paths) to avoid drift.

### E. Cross-provider safety

The bridge change is shared by codex/opencode/gemini and must be verified for all three, not assumed (see Tests). claude is on the native `--mcp-config` path and is explicitly out of the change.

## Components / files

| File | Change |
|---|---|
| `server/src/services/internal-agent/mcp-bridge.ts` | Swap transport to SDK `Server`+`StdioServerTransport`; keep tool layer; stderr-only logging; crash handlers; watchdog. |
| `server/package.json` | Add pinned `@modelcontextprotocol/sdk`. |
| `server/src/services/internal-agent/cli-mode.ts` | `buildMcpBridgeSpec` — unchanged command/args/env contract (verify the SDK bridge still launches under `tsx …ts` and `node …js`). |
| `packages/adapters/{codex,opencode,gemini}-local/src/server/*` | No logic change expected; verify wiring + add the transport-failure detection hook to each parse path (shared helper). |
| `server/src/services/internal-agent/aoa-agents/runner.ts` | Propagate adapter "transport failed" → run `failed` + error. |
| Shared detection helper (new, small) | Detect MCP transport-class failures from a CLI run's parsed events. |
| Tests (below) | New across unit / integration / cross-provider E2E / regression. |

## Test matrix (all types — explicit)

1. **Unit (bridge handler):** `createToolCallHandler` responds for known tools; unknown tool → `isError`; approval-path throw → `isError` result (process does NOT exit). Pure, no subprocess.
2. **Unit (stdout discipline):** a tool whose handler writes to stdout does not corrupt the protocol stream (SDK owns stdout; assert frames intact).
3. **Unit (watchdog):** simulated parent death → bridge closes transport + exits; parent alive → stays up.
4. **Integration (THE regression for this bug):** spawn the real bridge subprocess (both `tsx …ts` and `node …js` invocations); send `initialize`→`tools/list`→`tools/call` then close stdin immediately; **assert the `tools/call` response lands** (the exact failing repro, automated).
5. **Unit (loud-failure detection):** given a parsed CLI run with MCP transport-failure events → detection returns failed+message; given a clean run → success. Per-adapter parse hooked to the shared helper.
6. **Cross-provider E2E (gated live):** a real crew agent posts a thread entry end-to-end through the bridge for **codex_local, opencode_local, gemini_local**. Marked gated/live (each CLI must be installed/authed); when a CLI is unavailable the test **skips loudly with a logged reason** (no silent skip). codex is confirmed available; opencode/gemini gated.
7. **Regression (loud failure):** a run whose bridge calls all fail with transport errors → `heartbeat_runs.status = failed` (not `succeeded`), with the error surfaced.
8. **Gate:** `pnpm -r typecheck`, server vitest suite green, no regression in existing `mcp-bridge` / adapter tests (`codex-config-toml.test.ts`, `opencode-config-json.test.ts`, etc.).

## Rollout

- Worktree `fix/codex-mcp-bridge` off `origin/feat/v1-combined`; TDD (failing integration repro first, then SDK swap to green).
- Land via PR. Do **not** commit to `feat/v1-combined` directly. Never `git add -A`.
- Live re-verify on the existing isolated QA instance (codex crew posts an entry) before calling it done.

## Out of scope (tracked separately)

- Consolidating the **inbound** HTTP MCP server (`server/src/mcp/server.ts`, hand-rolled JSON-RPC over Express) onto the SDK — separate, larger project.
- Auto-retry of a run on transport failure; new UI banners beyond the run record.
- The unrelated discussions findings (F1 onboarding crew-provider ignored, F2 Reviewer not seeded, F4 codex default model, hop-cap UX, etc.) — separate triage.

## Open risks / verification points (for plan-eng-review)

- **SDK launch under `tsx …ts` (codex) and `node …js` (opencode):** confirm `StdioServerTransport` works for both invocations; the SDK must not assume a build step.
- **Windows specifics:** stdin half-close → SDK `onclose` timing; watchdog PPID liveness on Windows.
- **Loud-failure signal fidelity:** each CLI reports MCP errors differently (codex JSONL vs opencode/gemini) — confirm a reliable transport-failure marker exists in each stream; if a provider doesn't expose one, document the gap rather than fake coverage.
- **New dependency:** `@modelcontextprotocol/sdk` version pin, transitive size, license, and whether it bundles cleanly in the server build / npm distribution.

## Success criteria

- A codex_local crew agent posts a real thread entry + the Chronicler writes a summary, live, on the QA instance.
- The integration repro test fails on the old code and passes on the SDK transport.
- opencode_local and gemini_local each verified (live or gated) to post through the bridge.
- A forced transport failure marks the run `failed`, not `succeeded`.
- claude_local crew still works (no regression); full server test suite + typecheck green.
