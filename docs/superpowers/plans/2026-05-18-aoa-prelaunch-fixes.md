# AoA Pre-merge Fixes — full scope (B1+mismatch, M1, M2, B2, M3, M4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Fresh implementer per milestone + two-stage review; controller code-verifies every diff against landed source (never trust reports). `- [ ]` checkboxes. Strict TDD: failing test → run fail → minimal root-cause fix → run pass → regression → commit.

**Goal:** Fix all 7 code-verified pre-merge defects from the Phase-1 whole-program review, root-cause not whack-a-mole, keeping the full M1–M6 + Plans A–D + follow-up suite green (350 files / 0 fail / tsc 0 baseline). Then Phase 2 UI verification on the fixed code.

**Worktree/branch/test/git:** worktree `AoA-2.5/.worktrees/commander-subagent-1`, branch `commander-subagent-1`. Test cmd: `cd "<worktree>/server" && npx vitest run src/__tests__/<file>`. Git: stage files BY NAME only, never `git add -A`; NEW commits; `docs/superpowers/` gitignored → `git add -f` for this plan. Never touch the main `AoA-2.5/` dir. No schema changes expected; if any, `pnpm db:generate` only.

**Risk order:** FX1 (B1 BLOCKER + prompt/tool-name mismatch — both silently defeat real §17 output) → FX2 (M1+M2 security, same file) → FX3 (B2 dual-exec) → FX4 (M3 defense-in-depth) → FX5 (M4 liveness). Each independently committable; each `[verify@exec]` re-confirms its premise against landed code before coding (symbols authoritative, not line numbers).

**Verified interaction model (informs FX3 scope):** org agents run via the heartbeat runtime; aoa agents via the AoA dispatcher (Phase-2 outbox / Phase-3 wakeup-queue, `dispatcher.ts` filters `kind='aoa'`). Cross-kind *triggering* is intended via explicit channels (@mention→`enqueueAoaMentionWakeup`, `delegate_to_subagent`, shared product state) — those bypass `enqueueWakeup`. The forbidden case (B2) is an aoa agent executed by the *heartbeat* runtime. FX3 gates only that; it does not touch the legitimate channels.

**Out of scope (nits only, logged):** hardcoded `layer:'domain'` in submit-extracted-items (cosmetic; downstream memory-layer routing) and a stale comment in `cli-mode.ts`/`agents.ts` — tracked, not fixed here.

---

## FX1 — B1 (BLOCKER) + prompt/tool-name mismatch: real §17 output works, failures don't strand entries

### Part A — B1: failed AoA extraction run must terminalize the entry (not silently strand it)
**Root cause (verified):** `runner.ts:126-134` catch marks the run `failed` but never moves the claimed `discussion_entries` row off `processing`; `dispatcher.ts:79-83` Phase-1 reclaim only matches linked runs `status='running'`+stale — a `failed` linked run is never reclaimed → entry stuck `processing` forever, no retry, no signal (silent permanent loss; breaks spec §6.3 + the CLAUDE.md "extraction failure → entry marked failed, founder notified" contract).

**Fix (mirror the legacy `extraction.ts` failure terminalizer — CORRECTED after [verify@exec]: `extraction.ts:639-659` does NOT write any `notifications` row; `notifications` is not even imported there. The authoritative failure shape is ONLY: guarded entry update + `discussion.extraction.failed` LiveEvent. NO notification insert — mirroring the legacy path exactly means the AoA path behaves identically; any LiveEvent→notification subscriber fires for both. The CLAUDE.md "founder notified" line is realized by LiveEvent consumers, not inline in extraction.ts.):**
1. Runner: track `claimedEntryId` (set only after the atomic claim at `runner.ts:55-72` succeeds, claimed.length>0). In the `catch`, AFTER the existing run→`failed` update, if `claimedEntryId` is set, atomically transition that entry mirroring `extraction.ts:643-658` **verbatim**: `db.update(discussionEntries).set({ extractionStatus:'failed', sourceInfo: sql\`jsonb_set(COALESCE(${discussionEntries.sourceInfo},'{}'::jsonb),'{extractionError}',${JSON.stringify(errMessage)}::jsonb)\` }).where(and(eq(id, claimedEntryId), eq(extractionStatus,'processing'), eq(extractionRunId, runId)))` (the extra `extractionStatus='processing' AND extractionRunId=runId` guards are FX1-added — `extraction.ts` guards only by id because it owns the lifecycle linearly; we add them because the runner is concurrent), then `publishLiveEvent({ companyId, type:'discussion.extraction.failed', payload:{ discussionId, entryId: claimedEntryId, error: errMessage } })` (resolve `discussionId` via `select discussionId from discussionEntries where id=claimedEntryId`, same pattern `submit-extracted-items.ts` uses). **NO `notifications` insert** (extraction.ts has none). All best-effort/guarded so the catch never throws.
2. Dispatcher Phase-1 safety net: extend so `processing` entries whose **linked run is `failed`** are also reclaimed → terminalized to `extractionStatus='failed'` (guarded on `extractionStatus='processing'`) + per-entry `discussion.extraction.failed` LiveEvent (resolve discussionId) + a generic `sourceInfo` reclaim marker (mirror the existing Phase-1 running-orphan reclaim's generic-message discipline; the original error is gone by reclaim time). NOT → `pending` (a failed run is a completed attempt; resetting would infinite-loop on a broken adapter). Keep the existing `running`+stale → `pending` branch byte-unchanged. NO notification insert.

### Part B — prompt/tool-name mismatch
**Root cause (verified):** `ensure-extraction-agent.ts:6-10` `EXTRACTION_INSTRUCTION` tells the LLM to "Call the `submit-extracted-items` tool" (hyphen) but the registered MCP tool `name` is `submit_extracted_items` (underscore, `submit-extracted-items.ts:33`); `EXTRACTION_AGENT_TOOL_ALLOWLIST` correctly uses underscore. Once a real adapter is provisioned, the LLM is instructed to call a tool that doesn't exist → tool-not-found → no items → silent no-output (post-Part-A: entry → `failed`). Silently defeats the §17 real-output DoD.

**Fix:** change the instruction string `` `submit-extracted-items` `` → `` `submit_extracted_items` `` so it matches the registered tool name + the allowlist constant. Add a drift-guard test pinning instruction ⊇ canonical name and `allowlist[0] === submitExtractedItemsTool.name`.

**Files:** Modify `server/src/services/internal-agent/aoa-agents/runner.ts`, `server/src/services/internal-agent/aoa-agents/dispatcher.ts`, `server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts`. Reference (read only): `server/src/services/extraction.ts` (failure branch :639-659 — authoritative shape, NO notification), `server/src/services/internal-agent/tools/submit-extracted-items.ts` (`name`). Tests: new `server/src/__tests__/aoa-runner-failure-terminalize.test.ts`, extend `aoa-dispatcher.test.ts`, new `aoa-extraction-instruction-contract.test.ts`. **AUTHORIZED superseded-test update** (controller-adjudicated; A5/A6/F2 precedent): `server/src/__tests__/aoa-ensure-extraction-agent.test.ts:17` currently asserts `.toContain("submit-extracted-items")` (it enshrines the Part-B bug). Change ONLY that line's literal `"submit-extracted-items"` → `"submit_extracted_items"` (the post-fix-correct assertion + a drift guard naming the real registered tool). Do NOT touch line 16 or line 19 (the D2 toolAllowlist contract — must stay green). Rationale documented in the commit.

- [ ] **Step 1 [verify@exec]:** Read runner catch+claim, dispatcher Phase-1, `extraction.ts` failure branch (record exact status value, `sourceInfo` jsonb_set key, LiveEvent type string, notification insert shape), `ensure-extraction-agent.ts:6-13`, `submit-extracted-items.ts` `name`. Confirm premises (runner doesn't reset; Phase-1 only `running`; instruction hyphen vs tool underscore). If false → STOP NEEDS_CONTEXT.
- [ ] **Step 2 (failing tests):** (a) runner: claimed entry + throwing adapter → entry → `extractionStatus='failed'` with the guarded where-clause (incl. `extractionRunId=runId` AND `extractionStatus='processing'`), `discussion.extraction.failed` LiveEvent published with `{companyId,type,payload:{discussionId,entryId,error}}`, run row `failed`; the not-claimable path does NOT terminalize the entry. **NO notification assertion** (extraction.ts writes none). (b) dispatcher: `processing` entry w/ linked `failed` run → entry terminalized `extractionStatus='failed'` (NOT `pending`) + failed LiveEvent; `running`+stale entry still → `pending` (unchanged). (c) contract (`aoa-extraction-instruction-contract.test.ts`, pure import): `EXTRACTION_INSTRUCTION` contains `submit_extracted_items` and NOT `submit-extracted-items`; `EXTRACTION_AGENT_TOOL_ALLOWLIST[0] === "submit_extracted_items"`. Run → FAIL.
- [ ] **Step 3 (implement)** Parts A+B per above; guarded transitions only; no change to the not-claimable path or the `running`+stale→pending branch.
- [ ] **Step 4 (run → PASS)** new tests + existing `aoa-runner.test.ts`, `aoa-dispatcher.test.ts`, `aoa-ensure-extraction-agent.test.ts` green.
- [ ] **Step 5 (regression):** `npx vitest run` over `aoa-*`, `extraction*`, `submit-extracted*`, `dispatcher`, `runner` + `npx tsc --noEmit` (0). All green.
- [ ] **Step 6 (commit):** `git add server/src/services/internal-agent/aoa-agents/runner.ts server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts server/src/__tests__/aoa-runner-failure-terminalize.test.ts server/src/__tests__/aoa-dispatcher.test.ts server/src/__tests__/aoa-extraction-instruction-contract.test.ts server/src/__tests__/aoa-ensure-extraction-agent.test.ts && git commit -m "fix(aoa): terminalize entry on extraction failure + correct seeded tool name (B1; §6.3/§17)"` (commit body must note the authorized `aoa-ensure-extraction-agent.test.ts:17` superseded-test update + rationale).

**Consumer outcome:** real extraction actually works once an adapter is provisioned (correct tool name); any failure (un-provisioned seed OR transient prod) marks the entry `failed` + notifies the founder (existing "retry" UX) — no silent loss.

---

## FX2 — M1 + M2: founder-gate AoA agent mutation (PATCH + resume)
**Root cause (verified):** `PATCH /agents/:id` (`agents.ts:1175-1182`) only calls `assertCanUpdateAgent`, whose agent-actor branch (`:131-149`) passes for `role==='cxo'`/`canCreateAgents` with no `kind='aoa'` founder gate → non-founder agent can rewrite `runtimeConfig.aoa.toolAllowlist`/`adapterType`/`adapterConfig`/`status`. `/agents/:id/resume` (`:1318`) lacks the `kind='aoa'` founder gate `/pause` has (`:1282-1283`).

**Fix:** (M1) add the `kind='aoa' → assertRole(founder)` enforcement **inside the shared `assertCanUpdateAgent`** (covers PATCH, rollback `:705`, every caller) — change its signature to receive the target `kind` (callers already hold the full row), enforce founder for all actor types when `kind==='aoa'`, before existing logic. (M2) add the `kind='aoa'` founder guard to `/resume`, byte-mirroring `/pause`.

**Files:** Modify `server/src/routes/agents.ts`. Tests: extend `server/src/__tests__/aoa-rbac.test.ts`.

- [ ] **Step 1 [verify@exec]:** Re-read `assertCanUpdateAgent` (~125-150), PATCH/pause/resume handlers; `grep -n "assertCanUpdateAgent(" server/src/routes/agents.ts` — enumerate ALL callers, confirm each can pass kind & none needs non-founder aoa edits. STOP NEEDS_CONTEXT if not.
- [ ] **Step 2 (failing tests):** aoa-rbac.test.ts: (a) agent-actor cxo non-founder PATCH `kind='aoa'` → 403; (b) founder PATCH → 200; (c) non-founder board resume `kind='aoa'` → 403; (d) founder resume → 200; (e) `kind='org'` PATCH/resume unchanged. Run → new cases FAIL.
- [ ] **Step 3 (implement)** centralized helper gate (signature takes kind; all callers updated) + resume guard; `kind='org'` byte-unchanged.
- [ ] **Step 4 (run → PASS)** + full existing aoa-rbac/agents authz suites green.
- [ ] **Step 5 (regression):** `aoa-*`, `*rbac*`, `agents*` + `tsc --noEmit` (0).
- [ ] **Step 6 (commit):** `git add server/src/routes/agents.ts server/src/__tests__/aoa-rbac.test.ts && git commit -m "fix(aoa): founder-gate AoA PATCH + resume (M1/M2; §10 governance)"`

---

## FX3 — B2: `enqueueWakeup` must refuse `kind='aoa'` agents
**Root cause (verified):** `routes/issues.ts:609-621` (issue CREATE) calls `heartbeat.wakeup(assigneeAgentId,…)` with no kind check; an aoa assignee → heartbeat run **and** AoA Phase-3 = dual execution, violating the runtime boundary.

**Fix (single chokepoint):** in `heartbeat.ts` `enqueueWakeup`, after the agent is resolved, if `kind==='aoa'` (or `'platform'`): write a `skipped` `agent_wakeup_requests` row (reason `"heartbeat.skipped.aoa_kind"`, mirror the existing skipped-request pattern ~`3906-3920`) and return `null` — structurally impossible for any route to drive an aoa agent through heartbeat. F1's `enqueueAoaMentionWakeup`/`delegate_to_subagent` bypass `enqueueWakeup` → unaffected; Decision #100: aoa runs via the AoA runner only → nothing legit relies on this.

**Files:** Modify `server/src/services/heartbeat.ts`. Tests: new `server/src/__tests__/aoa-heartbeat-kind-guard.test.ts`.

- [ ] **Step 1 [verify@exec]:** Re-read `enqueueWakeup` (~3874-3930): agent fetch, existing skip guards, `writeSkippedRequest`; confirm agent row exposes `kind`; confirm `routes/issues.ts:609-621` still calls `heartbeat.wakeup` directly with no kind check; confirm no production path intends `enqueueWakeup` for aoa. STOP NEEDS_CONTEXT if false.
- [ ] **Step 2 (failing test):** `enqueueWakeup` for `kind='aoa'` (source `'assignment'`) → returns null, one `agent_wakeup_requests` `status:'skipped'` row w/ the reason, zero `heartbeat_runs`; `kind='org'` unaffected. Run → FAIL.
- [ ] **Step 3 (implement)** the kind guard alongside the existing skip guards; `kind='org'` byte-unchanged.
- [ ] **Step 4 (run → PASS)** + existing `aoa-mention-wakeup-routing.test.ts` + heartbeat/mention suites green.
- [ ] **Step 5 (regression):** `aoa-*`, `mention*`, `heartbeat*`, `issues-routes*` + `tsc --noEmit` (0).
- [ ] **Step 6 (commit):** `git add server/src/services/heartbeat.ts server/src/__tests__/aoa-heartbeat-kind-guard.test.ts && git commit -m "fix(aoa): enqueueWakeup refuses kind='aoa' (B2; runtime-boundary)"`

---

## FX4 — M3: `submit_extracted_items` must verify the entry's company
**Root cause (verified):** `submit-extracted-items.ts` resolves/writes by `entryId` only; no `discussions.companyId === ctx.companyId` assertion (only `companyId` refs: `:101` comment, `:169` LiveEvent). Latent (no current path feeds a cross-company entryId) but a defense-in-depth inconsistency vs. every other write path (`costs.ts:46` etc. enforce company match).

**Fix:** before any write, join entry→`discussions` and assert `discussions.companyId === ctx.companyId`; on mismatch return `{ success:false, data:null, error, summary }` (tool error-result convention, mirror `delegate-to-subagent.ts` not-found) — no writes, no LiveEvent.

**Files:** Modify `server/src/services/internal-agent/tools/submit-extracted-items.ts`. Tests: extend `server/src/__tests__/aoa-submit-extracted-items.test.ts` or `submit-extracted-items-live-event.test.ts`.

- [ ] **Step 1 [verify@exec]:** Re-read the tool; confirm no company scoping exists; confirm the discussionId/company resolution shape to reuse (it already resolves discussionId — extend to also fetch `discussions.companyId`).
- [ ] **Step 2 (failing test):** entry whose discussion.companyId ≠ ctx.companyId → tool returns `success:false`, performs **no** insert/update and **no** LiveEvent; same-company unchanged (all existing tests still green). Run → FAIL.
- [ ] **Step 3 (implement)** the company-match guard reusing the existing entry→discussion resolution (no extra round-trip beyond the join); same-company path byte-unchanged.
- [ ] **Step 4 (run → PASS)** + all existing submit-extracted-items tests (I-1/I-2/F2/NIT) green.
- [ ] **Step 5 (regression):** `submit-extracted*`, `aoa-*`, `extraction*` + `tsc --noEmit` (0).
- [ ] **Step 6 (commit):** `git add server/src/services/internal-agent/tools/submit-extracted-items.ts server/src/__tests__/<test file> && git commit -m "fix(aoa): submit_extracted_items enforces caller-company isolation (M3)"`

---

## FX5 — M4: dispatcher must not serialize Phase-3 behind the full Phase-2 batch
**Root cause (verified):** single `limiter` (`dispatcher.ts:138`), Phase-2 fully `await`ed (`:146-167`) **before** Phase-3 even queries (`:169+`); `limiterMax:4`, Phase-2 `.limit(200)` FIFO, no per-company fairness → @mention/delegate work waits behind the entire extraction batch each tick; one company starves others.

**Fix (minimal, correctness-preserving):** keep **Phase-1 first and fully awaited** (its reclaim→pending must precede Phase-2's pending drain — ordering invariant). Run **Phase-2 and Phase-3 concurrently** (they are independent: extraction entries vs wakeup queue) via `Promise.all`, each with its **own limiter** (so extraction load can't consume all wakeup slots). No double-processing (Phase-2 keyed by entry, Phase-3 by wakeup-row atomic claim — both already idempotent). Per-company round-robin/cap is explicitly deferred (spec §15 fairness *tuning*); this fix removes the *structural* serialization only.

**Files:** Modify `server/src/services/internal-agent/aoa-agents/dispatcher.ts`. Tests: extend `server/src/__tests__/aoa-dispatcher.test.ts`.

- [ ] **Step 1 [verify@exec]:** Re-read `runAoaDispatch` end-to-end: confirm Phase-1→Phase-2 ordering dependency (reclaimed orphans become pending for Phase-2), confirm Phase-2 and Phase-3 have no data dependency on each other, confirm the single shared limiter + sequential await. STOP NEEDS_CONTEXT if Phase-3 actually depends on Phase-2 output.
- [ ] **Step 2 (failing test):** with a pending entry AND a queued aoa wakeup, assert (deterministically via the mock harness) that Phase-3's wakeup drain is **not** gated on Phase-2 completion — e.g. both `runExtractionConsumer` and `runAoaAgent` are invoked, and a slow/large Phase-2 does not prevent the Phase-3 claim/run in the same tick. Plus: existing Phase-1 reclaim + Phase-3 kind-filter behaviors unchanged. Run → FAIL (current code serializes).
- [ ] **Step 3 (implement)** Phase-1 awaited first; `await Promise.all([phase2Drain(), phase3Drain()])` with a dedicated limiter each; preserve all existing guards/atomic claims and the final log line (drained/reclaimed/wakeups counts).
- [ ] **Step 4 (run → PASS)** new test + existing `aoa-dispatcher.test.ts` (6) green (Phase-1 reclaim, Phase-3 no-source-filter, atomic claim all unchanged).
- [ ] **Step 5 (regression):** `aoa-*`, `dispatcher`, `extraction*`, `runner`, `mention*` + `tsc --noEmit` (0).
- [ ] **Step 6 (commit):** `git add server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/__tests__/aoa-dispatcher.test.ts && git commit -m "fix(aoa): run dispatcher Phase-2 and Phase-3 concurrently (M4; delegation no longer starved)"`

---

## Closeout
- [ ] **Full regression sweep:** whole AoA + mention + extraction + dispatcher + runner + rbac + issues-routes suite + `tsc --noEmit` — confirm the 350-file / 0-fail / tsc-0 baseline holds (Windows-skipped integration tests stay skipped, not failed).
- [ ] **Final independent code-review** subagent over the FX1–FX5 cumulative diff; controller code-verifies the verdict.
- [ ] Update the Phase-1 review report (B1/mismatch/M1/M2/B2/M3/M4 → RESOLVED + SHAs; nits logged). `git add -f` this plan + the report.
- [ ] Hand back → **Phase 2 UI verification** (isolated instance + `/browse`, flows 1–8 incl. Commander + extraction sub-agent, founder-gates, failed-extraction notification, @mention single-exec) on the fixed code → then the finish-branch decision.

### Discipline
Fresh implementer per milestone (FX1 = correctness-critical). Two-stage review. Controller code-verifies every diff against landed source + re-runs targeted + regression suites independently — never trust subagent reports. STOP / NEEDS_CONTEXT / BLOCKED rather than guess or weaken any existing test; superseded-test updates only with documented rationale + real contract preserved (A5/A6/F2 precedent), escalated to the controller.
