# AoA Agents Framework — Deferred Follow-ups (review ALL together, post-program)

> Self-contained. Deliberately deferred during Plan A/B execution per user decision: "do the flagged follow-ups later after everything" + "review all of them next [in the same skeptical way]". Do NOT fix these inside Plan C/D milestones — collect, then do a dedicated review+fix pass (subagent-driven, TDD, regression-gated, M1–M6 + Plan A/B tests stay green) after the program, before `finishing-a-development-branch`.
>
> Worktree: `AoA-2.5/.worktrees/commander-subagent-1` (branch `commander-subagent-1`). Test cmd: `cd "<worktree>/server" && npx vitest run src/__tests__/<file>`. Git: add by name only; `docs/superpowers/` is gitignored → `git add -f`.

## F1 — @mention → AoA agent DUAL EXECUTION (correctness; highest priority)

**Verified by code-truth (2026-05-18).** Plan B's B1 made `findMentionedAgents` (`server/src/services/issues.ts:1572`) resolve `kind='aoa'` agent ids. But the callers in `server/src/routes/issues.ts` (~lines 792–827, both the issue-comment create path ~`:787` and the patch path ~`:1170`) iterate the resolved ids and call `heartbeat.wakeup(agentId, wakeup)` — i.e. `enqueueWakeup` in `server/src/services/heartbeat.ts:3874`. For a `kind='aoa'` agent:
- `parseHeartbeatPolicy` (`heartbeat.ts:1700-1710`): `enabled=false` (their `runtimeConfig.heartbeat={enabled:false,intervalSec:0}`) but `wakeOnDemand` defaults **`true`** (unset → `asBoolean(...,true)`).
- `enqueueWakeup` guards: `:3922 if (source==="timer" && !policy.enabled)` skip — does NOT fire (mention source ≠ "timer"); `:3926 if (source!=="timer" && !policy.wakeOnDemand)` skip — does NOT fire (`wakeOnDemand=true`).
- → wakeup proceeds: heartbeat enqueues a `heartbeat_runs` row + `startNextQueuedRunForAgent` dispatches via the agent's adapter (`process` for aoa). **AND** the `agent_wakeup_requests {status:'queued'}` row it writes is *also* claimed by the AoA dispatcher Phase-3 (`dispatcher.ts` — filters `status='queued' AND agents.kind='aoa'`, **no `source` filter**) → `runAoaAgent`. **Two executions, two runtimes, one @mention.**

`delegate_to_subagent` (B3) is **NOT affected** — it inserts `agent_wakeup_requests` directly, bypassing `enqueueWakeup`; only Phase-3 runs it (correct, single execution).

**Fix:** in `server/src/routes/issues.ts`, after `findMentionedAgents` returns ids, batch-resolve each id's `kind` (one `select {id,kind} from agents where id in (...)`). For `kind='aoa'` ids: insert `agent_wakeup_requests` directly (`{companyId, agentId, source:'mention', reason:'issue_comment_mentioned', payload:{issueId, commentId}, status:'queued'}`) — mirror exactly what `delegate-to-subagent.ts` does — and SKIP `heartbeat.wakeup` for them. For `kind='org'` ids: `heartbeat.wakeup` unchanged. + a test: an aoa @mention writes exactly one `agent_wakeup_requests` row and **zero** `heartbeat_runs`; an org @mention path unchanged. Apply to BOTH caller sites (~`:787` create, ~`:1170` patch). Confirm no other `findMentionedAgents` caller exists (`grep -rn findMentionedAgents server/src`).

## F2 — `submit-extracted-items` LiveEvent parity (freshness; medium)

`server/src/services/internal-agent/tools/submit-extracted-items.ts` mirrors `extraction.ts`'s insert + `pendingItemCount` increment (I-1/I-2 fixed in Plan A) but does NOT publish the `discussion.extraction.completed` LiveEvent that `extraction.ts:630-638` emits. Consequence: UIs subscribed to that event won't refresh when an AoA agent completes extraction (they will on poll/navigation). Fix: emit the same LiveEvent from the tool after the entry is marked `completed`, mirroring `extraction.ts:630-638` exactly (same event name/shape/publisher). Add a test asserting the publish. Scope: that one tool + its test.

## F3 — retire orphaned `platform-agent.ts` (cleanup; low; spec §11 / Decision #100)

Plan A migrated extraction to `kind='aoa'` (`ensureExtractionAgent`). The old `server/src/services/internal-agent/subagents/platform-agent.ts` (`ensurePlatformAgent`, `kind='platform'`) is now **dead production code** (no production caller — confirm `grep -rn ensurePlatformAgent server/src | grep -v __tests__`). Spec §11 / Decision #100 say the `kind='platform'` row is "migrated/retired". `server/src/__tests__/platform-agent-seed.test.ts` still exists + passes as an M1–M6 guard. Fix: retire `platform-agent.ts` + `platform-agent-seed.test.ts` with documented rationale (Decision #100; superseded by `ensure-extraction-agent.ts`), confirm zero production references, ensure no migration/data path still needs the platform row (check `costs.ts`/budget attribution still works with `kind='aoa'` — Plan A already routes cost via the aoa agent). Regression must stay green minus the deliberately-retired test.

## F4 — runner MCP-config temp-file cleanup (hygiene; low)

`server/src/services/internal-agent/aoa-agents/runner.ts` writes `os.tmpdir()/aoa-mcp-<agentId>-<runId>.json` (the `buildMcpConfig` output for `--mcp-config`) and never unlinks it → unbounded tmpdir growth under load. Fix: `fs.unlink` in a `finally` after `adapter.execute` (best-effort, swallow errors — never let cleanup break the run/its hard-error boundary). Add/extend a runner test asserting the temp file is removed (or that unlink is attempted) on both success and adapter-throw paths.

## F5 — (note only, NOT in worktree scope) global `~/.claude/CLAUDE.md` tool count

The worktree `CLAUDE.md` was correctly updated (29→30 in A5, →31 in B3). The user's GLOBAL `C:/Users/TK/.claude/CLAUDE.md` still says "29 tools" — out of repo/worktree scope; flagged for awareness only. Decide separately whether to touch a global file; default = leave it.

---

### Execution note for the follow-up pass
Order by risk: **F1 (correctness) → F2 → F3 → F4**; F5 is a non-code note. Each: fresh subagent, strict TDD, code-verified by the controller (don't trust reports), regression-gated against the full Plan A+B+C+D suite. F1 especially: re-verify the `enqueueWakeup` guard logic + Phase-3 source-filter against landed code at fix time (it may have shifted if C/D touched dispatcher/routes).
