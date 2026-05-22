# AoA Codex End-to-End Acceptance Plan (§17 real-output + functional sweep)

> Verification/acceptance plan (not a feature build). Executed on the **running** isolated instance `cmdr-c-verify` (http://127.0.0.1:3211, branch `commander-subagent-1` @ all-fixes), company **"Phase2 Fixed-Code Verify" (PHA)**. Extends the existing §17 manual script `docs/guides/board-operator/aoa-agents-acceptance.md` (Plan D / D5) from `claude_local` to **codex** + a broader functional sweep. **Bar: prove each path once with real output.** Marketplace seeding explicitly OUT OF SCOPE (deferred by user).

**Goal:** Prove the framework genuinely works end-to-end with a real CLI adapter: (1) the **internal-agent Commander chat** returns a real codex response; (2) the **Discussion Extraction sub-agent** produces **real `discussion_extracted_items`** via codex + the MCP bridge (the §17 hard bar); (3) wakeup works via **@mention** and via **`delegate_to_subagent`** from the chat; (4) heartbeat/config/skills/instructions-bundle/FX7-lifecycle behave correctly — each observed with DB/run evidence (code & DB are truth, not UI labels alone).

**Two distinct "Commanders" (do not conflate):**
- **Chat** = the pre-existing internal-agent ("Commander" nav + Settings→Commander). Configured by `internal_agent` config (`executionMode` + `cliTool`). cli-mode.ts maps `cliTool:'codex'`→`codex` binary, args `["--mcp-config", mcp, "-p", msg]`.
- **AoA Commander agent** = `kind='aoa'`, role='lead' (Team→Commander Team). NOT a chat; runs when triggered/@mentioned/delegated, via `adapterType='codex_local'` + MCP bridge. codex_local adapterConfig keys (verified `packages/adapters/codex-local/src/server/execute.ts:177-317`): `command` (default `"codex"`), `model`, `modelReasoningEffort`/`reasoningEffort`, `cwd`, `extraArgs`/`args`, `instructionsFilePath`.

**Precondition (verified):** `codex-cli 0.130.0` installed + on PATH; `codex_local` adapter registered. **Gate at S1:** codex must be authenticated for non-interactive runs.

**Discipline:** `[verify@exec]` at S1/S2/S3/S4/S5 — confirm the exact API/UI/config shape against landed code/the running app before acting (don't code/act against a guessed shape). Observe **real state** (`discussion_extracted_items`, `internal_agent_runs`, agent status) — never trust a UI label alone. Any defect found → controller-verified fix (TDD, regression-gated, never weaken a test) → re-verify. App stays up between steps; never disturb ports 3100/54329.

---

## Phase S — Setup (codex on chat + AoA agents; skills; instructions bundle)

- [ ] **S1 [verify@exec] — codex auth gate.** Confirm codex runs non-interactively (e.g. `codex --version` already OK; verify an auth/login state — `codex login status` or equivalent; if a real run later 401s/prompts, the user runs `codex login` once). Record the codex invocation the adapters use. If codex is not authenticated and cannot be made so, STOP and report (real runs impossible without it) — this is the honest §17 precondition.
- [ ] **S2 — Configure the internal-agent CHAT to codex.** Via the UI (Settings → Commander → select CLI tool = `codex`, executionMode = the cli/local mode) OR the internal-agent config API. `[verify@exec]`: read the internal-agent config route/schema (`server/src/services/internal-agent/*`, `packages/db/src/schema/internal_agent.ts`) to use the exact field names/values. Verify the config persisted (GET it back; the cli-mode "No CLI tool configured" error must NOT fire).
- [ ] **S3 — Configure AoA agents to `codex_local`.** For Commander + Discussion Extraction (+ Phase2 SubAgent) in company PHA: `PATCH /api/companies/<PHA-cid>/agents/<agentId>` body `{"adapterType":"codex_local","adapterConfig":{"command":"codex","cwd":"<a safe writable dir, e.g. the instance data dir>","model":"<leave default unless needed>"}}` (founder path — FX2 gate; in local_trusted the board actor is founder-equiv). `[verify@exec]`: re-confirm the codex_local config keys from `codex-local/src/server/execute.ts` at exec time. Verify via GET that `adapterType='codex_local'` + config persisted, and `agent_config_revisions` recorded the change (D3).
- [ ] **S4 — Create + attach a real skill (no marketplace).** Create one minimal real company skill via the Skills API/UI (`[verify@exec]` the skills create route/shape — `companySkillsApi`/`/skills`). Attach it to the Discussion Extraction sub-agent (Skills tab toggle / `agentsApi.update {skillKeys}`). Verify `skillKeys` includes it via GET.
- [ ] **S5 — Create a real instructions bundle.** Now that the sub-agent is `codex_local` (a local adapter), the Instructions tab bundle UI is available (the prior "bundles only available for local adapters" message must be gone). Create a bundle with a real instruction file (concrete content, e.g. an extraction-focused instruction). `[verify@exec]` the instructions-bundle create route (`agentInstructionsService` / `/agents/:id/instructions-bundle`) — note FX6 founder-gates this for kind='aoa', so use the founder path. Verify the bundle persists and `adapterConfig.instructionsFilePath` (or the bundle linkage) is set.

## Phase V1 — Chat works (internal-agent Commander on codex)
- [ ] **V1.1** Open the Commander chat (UI "Commander" nav, company PHA). Send a concrete prompt (e.g. "List this company's AoA agents and what each does.").
- [ ] **V1.2** Assert a **real codex-generated streamed response** returns (not the "No CLI tool configured" error, not an adapter error). Observe an `internal_agent_runs`/conversation message row for it (trigger conversation). Capture the response text as evidence.
- [ ] **V1.3** If it errors: `[verify@exec]` the cli-mode codex path + S2 config; fix the config (or a real code defect, controller-verified) → re-verify.

## Phase V2 — Sub-agent real run: the §17 hard bar
- [ ] **V2.1** In company PHA, create a discussion + entry with clearly-extractable content (a decision + a task + an insight). (Reuse the API shape proven in Phase 2: `POST /api/companies/:cid/discussions` then `POST …/discussions/:did/entries {rawContent, inputType:"paste"}`.)
- [ ] **V2.2** Within a dispatch tick the Discussion Extraction sub-agent runs via **codex_local + MCP bridge** and calls `submit_extracted_items`. Poll until terminal.
- [ ] **V2.3 (ACCEPTANCE)** Assert **real `discussion_extracted_items` rows** exist for the entry (≥1; ideally a decision/task/insight matching the content), the entry `extractionStatus` is the success terminal value (`extracted`/`completed` — confirm the value), an `internal_agent_runs` row `completed` for the extraction agent, and a `cost_event`. **This is the §17 proof** (a real adapter produced real structured output through the bridge — not the `process`-fail path from Phase 2). Evidence: the actual rows (DB/API) + the discussion UI showing extracted items pending approval.
- [ ] **V2.4** If extraction fails: capture `sourceInfo.extractionError`; `[verify@exec]` whether it's a setup issue (codex auth/config/bundle) vs a real code defect. Setup → fix setup, re-run. Real defect → controller-verified fix (TDD) → re-verify. (Note: FX1 guarantees a failure is visible/`failed`, not silent — that itself is a partial proof.)

## Phase V3 — Wakeup paths (real adapter)
- [ ] **V3.1 @mention:** create a task, post a comment `@Discussion Extraction …` (or @Commander). Observe exactly **one** real AoA run via dispatcher Phase-3 (codex), and `heartbeat_runs` for that aoa agent stays **0** (B2/FX3 holds with a real adapter too).
- [ ] **V3.2 delegate via chat:** in the Commander chat, instruct it to delegate to a sub-agent (exercises `delegate_to_subagent`). Observe the sub-agent runs (one AoA run), evidence in the Runs tab + `internal_agent_runs`.
- [ ] **V3.3** Confirm both paths produced exactly one execution each (no dual-exec); capture evidence.

## Phase V4 — Config / skills / bundle / lifecycle sweep
- [ ] **V4.1 Skills + bundle injected:** confirm the attached skill and the instructions bundle actually reach the run context (inspect the run's built prompt/MCP config or the agent's observable behavior referencing them — `[verify@exec]` how skills/bundle are injected in the runner/codex adapter).
- [ ] **V4.2 Heartbeat/config:** the AoA agent's heartbeat/config (runtimeConfig) is viewable + persists via the Config tab; `agent_config_revisions` recorded edits (D3).
- [ ] **V4.3 FX7 lifecycle:** pause the extraction sub-agent (FX7 UI control, founder) → drop a new discussion entry → the **paused agent does NOT run** (dispatcher skips paused — D3) and the entry is not consumed by it; resume → it runs on the next tick. Confirms pause/resume governance works against a real dispatcher with a real adapter. Confirm **no Terminate/delete** affordance for the AoA agent (per the user's "no AoA deletion" — note: the backend hard-block + FX7 Terminate-removal is a SEPARATE pending decision/milestone; here just observe current state and record).
- [ ] **V4.4 Runs visibility:** all the above runs appear in the AoA agent's Runs tab with status/trigger/timing.

## Closeout
- [ ] Consolidated evidence report (per phase: pass/fail + the real DB/run evidence + chat text + screenshots/DOM).
- [ ] Update `docs/guides/board-operator/aoa-agents-acceptance.md` with the **codex variant** + the broader-sweep results (force-add not needed — it's tracked under docs/guides; plain `git add`). Record the manual-acceptance result (the §17 doc asks for this).
- [ ] Teardown the instance (free 3211/54341; never touch 3100/54329) OR leave running if the user wants to keep checking — ask.
- [ ] Return to the **finish-branch decision** (Phase 3) with the code-review report + Phase-2 UI report + this codex acceptance report all in hand.

## Open follow-ups carried (NOT done in this plan unless the user says so)
- **No-AoA-deletion** (user instruction): FX7 Terminate-removal + backend hard-block of `kind='aoa'` delete/terminate — pending the user's earlier scope question (UI-only vs UI+backend-hard-block). Track; decide before finish-branch.
- **Correct AoA "Run now"/Invoke** (user question): a founder-gated endpoint that enqueues an *AoA wakeup* (Phase-3), not heartbeat — optional FX8, pending user decision.
