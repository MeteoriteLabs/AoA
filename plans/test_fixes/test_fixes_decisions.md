# Test Fixes — Decisions

## D1: costUsd placement — top-level, not inside usage
**Decision:** Move `costUsd` from `usage` object to a separate top-level field on the `parseOpenCodeJsonl` return value.
**Rationale:** Cost is billing data, not token usage. The adapter test expects it separated. The consumer (`execute.ts`) already maps it to a separate field on `AdapterExecutionResult`. Clean separation of concerns.
**Impact:** `parse.ts` return shape changes. `execute.ts` line 343 updated. `parse.test.ts` assertion updated.

## D2: toolUseId field — use callID over id
**Decision:** Use `part.callID` (with `part.id` as fallback) for `toolUseId` in the UI parser.
**Rationale:** `callID` is the semantic API call identifier for correlating tool calls with results. `id` is an internal part identifier. `callID` matches what the test expects and is more useful for debugging.

## D3: Windows symlink type — 'junction' for directory symlinks
**Decision:** Use `'junction'` symlink type on Windows for Cursor skill directory symlinks.
**Rationale:** `'dir'` symlinks require admin/Developer Mode and fail with EPERM on standard Windows installations. `'junction'` works without elevated privileges and is functionally equivalent for directory linking. Changed from original `'dir'` plan after testing revealed EPERM failures on the target system.

## D4: parse.test.ts vs opencode-local-adapter.test.ts conflict
**Decision:** Update `parse.test.ts` to match the desired API shape (costUsd outside usage).
**Rationale:** The two tests disagree on the costUsd placement. The adapter test represents the correct design intent. The parse test was likely written before the API shape was finalized.

## D5: CLI formatter output structure
**Decision:** Restructure CLI formatter to output tool events as `tool_call: {name} ({callID})` + `tool_result status={status} exit={exit}` + output lines, and step finish as two separate lines: `step finished: reason={reason}` + `tokens: in=X out=X cached=X cost=$X`.
**Rationale:** Matches test expectations. Provides better traceability (callID visible) and cleaner separation of step metadata from token usage.
