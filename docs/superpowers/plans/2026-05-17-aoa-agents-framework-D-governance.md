# AoA Agents Framework — Plan D: Governance + Definition-of-Done acceptance

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. `- [ ]` checkboxes.
> **Fidelity:** structural — depends on **Plans A+B+C landed**. **[verify@exec]** tags re-confirm named symbols. Spec: `…/2026-05-17-aoa-agents-framework-design.md` §10/§13/§17. This plan **closes the §17 Definition of Done** (real output) and records **Decision #100**.

**Goal:** Make the framework enterprise-safe (RBAC, least-privilege tool scoping, budget auto-pause, config revisions, audit), record Decision #100, and **prove the §17 hard bar**: drop content into a discussion → the extraction AoA agent really runs via a configured CLI adapter → real `discussion_extracted_items` appear in the Commander-Team UI.

**Architecture:** Reuse-first. Budget auto-pause + config revisions + RBAC + audit already exist keyed off `agents` (verified in design §10) — D *wires* AoA agents into them, not rebuild. Least-privilege = a per-agent tool allowlist intersected with the bridge's `enabledCapabilities` (the Decision #95 access model, now with its concrete consumer). The gated real-output acceptance provisions a real `claude_local` adapter + credential (the same precondition every worker agent has).

**Tech Stack:** TS, Drizzle, Vitest, Express. **Worktree/branch/test/git:** per Plan A header. **Plan D of 4 (final).**

---

## File Structure
**Modify:** `server/src/routes/agents.ts` (RBAC on AoA create/disable/triggers — C1/C4 endpoints); `server/src/services/internal-agent/mcp-bridge.ts` + `tool-registry.ts` or `authorize-tool.ts` (per-agent tool allowlist enforcement); `server/src/services/internal-agent/aoa-agents/runner.ts` (write `agent_config_revisions` on config change path is C; D ensures the cost/budget + audit hooks fire); `docs/architecture/decisions.md` (**append Decision #100 — tracked, force-add**).
**Create:** per-agent tool-allowlist storage (spec §16(c): a column on `agents` via `pnpm db:generate`, OR a small `aoa_agent_tool_grants` table — decide at D2 Step 1); tests `server/src/__tests__/aoa-rbac.test.ts`, `aoa-tool-allowlist.test.ts`, `aoa-budget-autopause.test.ts`; `server/src/__tests__/aoa-realoutput.integration.test.ts`; `docs/guides/board-operator/aoa-agents-acceptance.md` (the manual acceptance script).
**Reuse unchanged:** `costService` auto-pause (`costs.ts:88-93`), `agent_config_revisions`, `activity_log`, `user_roles`, the pause/resume endpoints.

---

## Milestone D1 — RBAC on AoA agent mutations
- [ ] **Step 1: [verify@exec]** Re-read the auth middleware on `agents.ts` create/pause/resume + the C1/C4 AoA endpoints + `user_roles` (`founder|team_lead|team_member`) and how worker-agent routes enforce founder-only hire/disable.
- [ ] **Step 2: Failing test** (`aoa-rbac.test.ts`, supertest, mirror existing agents-route authz tests): non-founder POST `…/agents {kind:'aoa'}` → 403; founder → 201; team_member PATCH trigger → 403; founder → 200.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — apply the existing founder-gate guard (the one worker hire/disable uses) to: AoA create (C4), disable/pause of `kind='aoa'`, triggers POST/PATCH (C1). Reuse the existing RBAC helper; no new RBAC system.
- [ ] **Step 5: Run → PASS** + existing agents-route authz tests still green.
- [ ] **Step 6: Commit** `git add server/src/routes/agents.ts server/src/__tests__/aoa-rbac.test.ts && git commit -m "feat(aoa-D): RBAC — founder-gated AoA create/disable/triggers"`

---

## Milestone D2 — Per-agent tool allowlist (Decision #95 access model)
- [ ] **Step 1: [verify@exec] + decide storage (spec §16(c)).** Read `authorize-tool.ts` (how the bridge gates tools by `enabledCapabilities`/role) + `tool-registry.ts`. Decide: a `toolAllowlist text[]`/jsonb column on `agents` vs a `aoa_agent_tool_grants` join table. Recommended: a `runtimeConfig.aoa.toolAllowlist: string[]` (no migration; consistent with the Plan-A discriminator living in `runtimeConfig.aoa`). Record the decision.
- [ ] **Step 2: Failing test** (`aoa-tool-allowlist.test.ts`): a bridge tool call for a tool NOT in the agent's allowlist → denied; in-allowlist → allowed; empty/absent allowlist → **default-deny** for AoA agents (least privilege) except an explicit baseline (e.g. `submit-extracted-items` for the extraction agent via its seed).
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — the bridge/`authorize-tool` resolves the calling AoA agent's `runtimeConfig.aoa.toolAllowlist` and intersects it with the existing capability gate: effective = allowlist ∩ enabledCapabilities-derived set; default-deny when allowlist absent. `ensureExtractionAgent` (Plan A) seed updated to include `['submit-extracted-items']` in its `runtimeConfig.aoa.toolAllowlist` (note this small Plan-A seed addition; idempotent backfill).
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `git add server/src/services/internal-agent/{authorize-tool,mcp-bridge}.ts server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts server/src/__tests__/aoa-tool-allowlist.test.ts && git commit -m "feat(aoa-D): per-agent tool allowlist (default-deny; #95 access model)"`

---

## Milestone D3 — Budget auto-pause + config revisions + audit (wiring, mostly reuse)
- [ ] **Step 1: [verify@exec]** Re-read `costs.ts:84-95` (auto-pause when `budgetMonthlyCents>0 && spent>=budget`), `agent_config_revisions` write pattern (worker config edits), `activity_log` write helper.
- [ ] **Step 2: Failing test** (`aoa-budget-autopause.test.ts`): emitting a `cost_event` for a `kind='aoa'` agent whose `budgetMonthlyCents>0` and over budget flips its `status='paused'`; the Plan-A dispatcher's `listEnabledOutboxAgents`/wakeup drain then skips it (paused-aware — Plan A A4). Plus: editing an AoA agent's config writes an `agent_config_revisions` row; create/pause writes `activity_log`.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — mostly assertions that existing paths already cover AoA agents (they key off `agents.id`): confirm `costService.createEvent` (Plan A runner already emits, zeroed) flows through the auto-pause guard for `kind='aoa'`; ensure the AoA config-edit route (C) writes `agent_config_revisions` (reuse the worker helper); add `activity_log` entries `aoa_agent.created|paused|trigger_changed` at the D1/C mutation sites (reuse the audit helper). No new budget/revision/audit systems.
- [ ] **Step 5: Run → PASS** (incl. Plan-A dispatcher paused-skip still green).
- [ ] **Step 6: Commit** `git add … && git commit -m "feat(aoa-D): budget auto-pause + config revisions + audit wired for kind='aoa'"`

---

## Milestone D4 — Decision #100 ADR (exact text)
- [ ] **Step 1: [verify@exec]** `grep -nE "^## Decision #" docs/architecture/decisions.md | tail -2` — confirm #99 is the last `## Decision #` and the file ends after it (as of this session). Confirm `git ls-files docs/architecture/decisions.md` (tracked — plain `git add`, no force needed).
- [ ] **Step 2: Append Decision #100** verbatim from spec §13 (already authored + precisely scoped), after the current last decision:
```markdown

---

## Decision #100 — AoA Agents framework: Commander + sub-agents as trigger-driven first-class agents

**Status:** Locked 2026-05-17.

- **Uniform CLI-adapter execution:** every AoA agent (`kind='aoa'`: Commander + sub-agents) runs through the existing worker CLI adapter via a no-task runner; structured results persisted by the agent calling internal-agent MCP tools through the bridge (e.g. `submit-extracted-items`), not by parsing adapter stdout (`AdapterExecutionResult` returns no text). No hybrid/`structured_llm` executor. Provider-SDK stays a non-agent primitive (embeddings, transcription) — **Decision #91 honored, not superseded.**
- **Supersedes DA-27** clauses (b) no queue, (c) no atomic checkout, (d) no adapter abstraction, and the *wakeup* half of (e) — AoA agents use atomic-claim dispatch, the worker adapter, and trigger/wakeup. **Keeps** DA-27 (a) separate `internal_agent_runs` table and the *assignment/task* half of (e) (no founder-managed issue/task lifecycle).
- **Resolves Decision #95** — the deferred access model is implemented (per-agent tool allowlist, default-deny) against its now-concrete consumer.
- **Extends Decision #99** — the durable transactional-outbox trigger, atomic claim and orphan-recovery generalize framework-wide; the extraction sub-agent is the first migrated `kind='aoa'` citizen, its #99/M2 correctness preserved (the runner re-asserts the atomic `pending→processing` claim).
- **Discriminator:** `kind='aoa'` + `runtimeConfig.aoa.role` (`lead`|`member`); `agents.role` is NOT overloaded (it is special-cased: `role==='cxo'`, 0070 tiers).
- **Rationale:** a growing internal automation team needs real agentic execution + a uniform reusable model; ~70–75% is reuse of existing `agents`-keyed infrastructure. Spec: `docs/superpowers/specs/2026-05-17-aoa-agents-framework-design.md`.
```
- [ ] **Step 3: Commit** `git add docs/architecture/decisions.md && git commit -m "docs(adr): Decision #100 — AoA Agents framework (locked)"`

---

## Milestone D5 — §17 gated real-output acceptance (the hard bar)
- [ ] **Step 1: Provisioning doc** — create `docs/guides/board-operator/aoa-agents-acceptance.md`: how to configure a real `claude_local` adapter + credential for the extraction AoA agent (set `agents.adapterType='claude_local'` for the Discussion-Extraction agent + the adapter's auth, per the existing worker-agent adapter setup docs — reference them, don't duplicate), and the manual script: (1) open Team → Commander Team, (2) drop a paragraph with a decision + a task into a discussion entry, (3) within one dispatch tick (~45s) the extraction agent runs, (4) confirm real `discussion_extracted_items` appear in the discussion thread + a completed run on the agent's Runs tab + a `cost_event` (zeroed).
- [ ] **Step 2: Gated integration test** `aoa-realoutput.integration.test.ts` — `describe.skipIf(process.platform==='win32' || !process.env.AOA_ACCEPTANCE_CLI)`: with a real `claude_local` adapter available (env-gated), seed company → drop a discussion entry → run `runAoaDispatch` → poll → assert ≥1 real `discussion_extracted_items` row for the entry, `internal_agent_runs` completed for the extraction agent, entry `extraction_status='extracted'`. **This is the only test that proves real output; it cannot run credential-less** (honest §17 precondition).
- [ ] **Step 3: Run the credential-less suite** (everything except D5.2) → green. Run D5.2 **only** in an environment with `AOA_ACCEPTANCE_CLI=1` + a real adapter (CI job with a provider secret, or the documented manual run). Record the manual-run result in the acceptance doc.
- [ ] **Step 4: Commit** `git add server/src/__tests__/aoa-realoutput.integration.test.ts docs/guides/board-operator/aoa-agents-acceptance.md && git commit -m "feat(aoa-D): §17 gated real-output acceptance + manual script"`

---

## Milestone D6 — Full program regression + Definition of Done sign-off
- [ ] **Step 1:** Run the entire suite — M1–M6 backend + Plan A + B + C + D contract/unit/integration (credential-less) — **all green**; the gated D5.2 green in the credentialed environment.
- [ ] **Step 2: §17 DoD checklist** (mark each): visible (C2) ✓; configurable detail page (C3) ✓; **real output end-to-end (D5)** ✓; lifecycle pause/budget/@mention (B/D3) ✓; no M1–M6 regression ✓; verified by integration + manual script (D5) ✓.
- [ ] **Step 3:** Announce completion and invoke **superpowers:finishing-a-development-branch** for the whole program (merge/PR decision across the `commander-subagent-1` branch — backend M1–M6 + Plans A–D).

## Self-Review
**Spec coverage:** §10 RBAC→D1, tool-allowlist/#95→D2, budget/config-rev/audit→D3; §13 Decision #100→D4 (verbatim, exact); §17 DoD→D5 (gated, honest precondition stated) + D6 sign-off. **Placeholder scan:** D4 ADR text is fully written (no placeholder); D5 is the deliberately-gated acceptance (the spec mandates it cannot be credential-less — that's a stated constraint, not a placeholder); test bodies cite named existing harnesses to mirror. **[verify@exec]** on every landed-code dependency. **Type/flow consistency:** tool-allowlist in `runtimeConfig.aoa` matches Plan-A discriminator location; auto-pause/paused-skip consistent with Plan A A4; Decision #100 supersession text identical to spec §13. **Fidelity:** structural; D is mostly *wiring existing systems* + the ADR (exact) + the gated acceptance (exact) — lowest-risk of B/C/D since it reuses verified infra. Surfaced cross-plan deps (D2 adds `toolAllowlist` to the Plan-A extraction seed; flag for the A/B/C executors) recorded in commits.
