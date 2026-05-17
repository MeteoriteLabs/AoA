# AoA Agents Framework — Plan C: UI (Commander Team tab + per-agent pages)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. `- [ ]` checkboxes.
> **Fidelity:** structural — depends on **Plans A+B landed** and on reading `AgentDetail.tsx` (45K-token) internals at execution. Steps tagged **[verify@exec]** re-confirm named symbols/shapes against landed code before implementing. Spec: `…/2026-05-17-aoa-agents-framework-design.md` §9. This plan delivers the **visible** half of the §17 DoD ("visible + configurable"); the real-output gated proof is Plan D.

**Goal:** Commander + every `kind='aoa'` agent appear in **Team → Commander Team** sub-tab; clicking one opens a worker-style detail page (Overview / Instructions / Skills / Runs / Config / **Triggers**) — settings + runs shown transparently, like worker agents.

**Architecture:** Reuse-first. `TeamPage.tsx` already renders tabs via `TAB_ITEMS: PageTabItem[]` + `VALID_TABS` + `PageTabBar` (verified) and tab components (`AgentsTab`/`HumansTab`/`OrgTreeTab`). Add one tab item + a `CommanderTeamTab` mirroring `AgentsTab`. Reuse `AgentDetail.tsx`'s tab pattern by extracting a shared core (spec §16(b): split, don't fork); the AoA detail page differs from worker in: Runs source = `internal_agent_runs` (not `heartbeat_runs`), + a **Triggers** tab (CRUD `aoa_agent_triggers`), and Config scoped to AoA-relevant fields. API: extend the existing agents routes with a `kind` filter + an AoA-runs + triggers endpoint.

**Tech Stack:** React + Vite + Tailwind (`ui/src/`), Express, Drizzle, Vitest. **Worktree/branch/test/git:** per Plan A header. UI tests: `cd <worktree> && npx vitest run ui/src/__tests__/<file>` (UI vitest config). **Plan C of 4.**

---

## File Structure
**Modify:** `server/src/routes/agents.ts` (`GET /companies/:companyId/agents` accept `?kind=`; add `GET …/agents/:id/aoa-runs`, `GET/POST/PATCH …/agents/:id/triggers`); `ui/src/pages/TeamPage.tsx` (+ tab); `ui/src/api/agents.ts` (client fns); `ui/src/pages/AgentDetail.tsx` (extract shared core — see C3).
**Create:** `ui/src/components/team/CommanderTeamTab.tsx`; `ui/src/components/agent-detail/AgentDetailCore.tsx` (extracted shared core) + `ui/src/components/agent-detail/AoaTriggersTab.tsx`; `ui/src/pages/AoaAgentDetail.tsx`; tests `server/src/__tests__/aoa-agents-api.test.ts`, `ui/src/__tests__/CommanderTeamTab.test.tsx`, `ui/src/__tests__/AoaAgentDetail.test.tsx`.
**Reuse unchanged:** `PageTabBar`, `AgentInstructionsTab`, the Skills tab component, `AgentConfigForm`, pause/resume API, `StatusBadge`.

---

## Milestone C1 — API: list/get AoA agents, their runs, triggers

- [ ] **Step 1: [verify@exec]** Re-read `server/src/routes/agents.ts:459` (`GET /companies/:companyId/agents`) — how it filters `kind='org'`, the response shape, and the auth middleware. Re-read `agentService.list` (Plan-A-era) for the `kind` arg. Re-read `internal_agent.ts` `internalAgentRuns` columns + `aoaAgentTriggers` (Plan A).
- [ ] **Step 2: Failing test**
```ts
// server/src/__tests__/aoa-agents-api.test.ts  (contract; mirror existing agents-route tests)
import { describe, expect, it } from "vitest";
// Assert: GET /companies/:c/agents?kind=aoa returns only kind='aoa' rows;
// GET /companies/:c/agents/:id/aoa-runs returns internal_agent_runs rows for
// that agent; GET …/triggers returns aoa_agent_triggers rows. Use the same
// supertest+seeded-db harness the existing agents route tests use (named:
// the file matching `agents` under server/src/__tests__ that hits routes).
it("kind=aoa filter + aoa-runs + triggers endpoints exist", () => { expect(true).toBe(true); }); // replace w/ supertest assertions per Step 1 harness
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement**
  - `GET /companies/:companyId/agents`: read `req.query.kind`; if `'aoa'` → list `kind='aoa'` (reuse `agentService.list` with a kind arg, or a direct `eq(agents.kind,'aoa')` query mirroring the existing one). Default unchanged (`org`) so M1 enumerations are unaffected.
  - `GET /companies/:companyId/agents/:id/aoa-runs`: `select * from internal_agent_runs where companyId=:c and (relatedEntityId/agent linkage)`. **[verify@exec]** the exact agent↔run linkage column (Plan A's runner writes `internal_agent_runs`; confirm whether it stamps `agentId` — if not, add an `agentId` column to `internalAgentRuns` as a Plan-C schema task via `pnpm db:generate`, additive, and have the Plan-A runner set it; note this dependency back to Plan A at execution).
  - `GET/POST/PATCH /companies/:companyId/agents/:id/triggers`: CRUD over `aoaAgentTriggers` (list by agent; create `{kind,config,enabled}`; patch `{enabled,config}`). Auth: same middleware as the agents routes (RBAC hardening = Plan D).
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `git add server/src/routes/agents.ts server/src/__tests__/aoa-agents-api.test.ts && git commit -m "feat(aoa-C): agents API — kind filter + aoa-runs + triggers endpoints"`

> **Plan-A dependency surfaced:** the AoA-runs endpoint needs runs attributable to an agent id. If Plan A's `internal_agent_runs` insert does not set an `agentId`, add it (additive migration) here and patch the Plan-A runner. Record this in the commit + flag for the Plan-A executor.

---

## Milestone C2 — Team → Commander Team tab

`TeamPage.tsx` (verified): `VALID_TABS`, `TAB_ITEMS: PageTabItem[]` (~line 30), `activeTab = searchParams.get("tab")`, renders `{activeTab==='agents' && <AgentsTab/>}` etc.

- [ ] **Step 1: [verify@exec]** Re-read `ui/src/pages/TeamPage.tsx` fully — `VALID_TABS` literal, `TAB_ITEMS` entries, the render switch, and `AgentsTab.tsx` (the component to mirror: how it lists agents, links to detail, shows status).
- [ ] **Step 2: Failing test**
```tsx
// ui/src/__tests__/CommanderTeamTab.test.tsx
import { render, screen } from "@testing-library/react";
import { CommanderTeamTab } from "../components/team/CommanderTeamTab";
// Mock the api client to return [Commander(lead), Discussion Extraction].
it("lists Commander (lead) + AoA agents with status + a link to each", async () => {
  // render with a QueryClient + mocked agentsApi.listAoa → assert both names
  // render, 'Lead' marker on Commander, and a link/role to open each detail.
  expect(true).toBe(true); // replace per Step 1 AgentsTab harness mirror
});
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement**
  - `ui/src/api/agents.ts`: add `listAoa(companyId)` → `GET …/agents?kind=aoa`; `getAoaRuns(agentId,companyId)`; `listTriggers/createTrigger/patchTrigger`.
  - `CommanderTeamTab.tsx`: mirror `AgentsTab.tsx` structure; query `listAoa`; render rows: name, `runtimeConfig.aoa.role==='lead'` → a "Lead" badge (Commander), status (`StatusBadge` + pause indicator reuse), last-run (from `aoa-runs` or a denormalized field), trigger summary; each row links to `/<companyPrefix>/team/aoa/:agentId` (the C3 detail route). "+ New AoA agent" button (C4).
  - `TeamPage.tsx`: add `'commander'` to `VALID_TABS`; add `{ value:'commander', label:'Commander Team' }` to `TAB_ITEMS`; add `{activeTab==='commander' && <CommanderTeamTab/>}` to the render switch. (Mirror the exact existing patterns verified in Step 1 — do not invent a new tab mechanism.)
- [ ] **Step 5: Run → PASS** + manual: `Team` page shows a **Commander Team** tab listing Commander + Discussion Extraction.
- [ ] **Step 6: Commit** `git add ui/src/components/team/CommanderTeamTab.tsx ui/src/pages/TeamPage.tsx ui/src/api/agents.ts ui/src/__tests__/CommanderTeamTab.test.tsx && git commit -m "feat(aoa-C): Team → Commander Team tab (lists Commander + AoA agents)"`

---

## Milestone C3 — AoA agent detail page (reuse AgentDetail core + Triggers tab)

`AgentDetail.tsx` is 45K-token (tabs Overview/Instructions/Runs/Skills/Config via `PageTabBar`). Spec §16(b): **split a shared core, do not fork.**

- [ ] **Step 1: [verify@exec] — the decisive read.** Read `ui/src/pages/AgentDetail.tsx` in full (chunked). Identify: (a) the smallest cohesive "core" (header/identity + `PageTabBar` + tab panels) that can take props for data sources; (b) every worker-only coupling (heartbeat-runs query, trust score, workspace, claude-login) that must become injectable/optional; (c) the exact `PageTabBar` tab-item shape. Decide the split boundary and record it in the commit. **This read gates C3 — do not write code before it.**
- [ ] **Step 2: Extract `AgentDetailCore.tsx`** — move the shared chrome (identity header, status, `PageTabBar`, tab routing) into `ui/src/components/agent-detail/AgentDetailCore.tsx` taking props: `agent`, `tabs: PageTabItem[]`, `renderTab(tabValue)`, `runsSource`. `AgentDetail.tsx` becomes a thin wrapper passing worker data sources (heartbeat runs, trust). Run the existing `ui/src/__tests__/*Agent*` tests → **must stay green** (pure refactor; behavior identical). Commit: `refactor(aoa-C): extract AgentDetailCore (no behavior change)`.
- [ ] **Step 3: `AoaTriggersTab.tsx` (failing test first)**
```tsx
// ui/src/__tests__/AoaAgentDetail.test.tsx (the Triggers part)
it("Triggers tab lists triggers and toggles enabled", async () => {
  // mock listTriggers → [{kind:'outbox',enabled:true,config:{source:'discussion_entry_pending'}}]
  // assert row renders; clicking the toggle calls patchTrigger({enabled:false}).
  expect(true).toBe(true); // replace per harness
});
```
  Implement `AoaTriggersTab.tsx`: list `aoa_agent_triggers` (via C1 API), render kind/enabled/config, enable/disable toggle (PATCH), "add trigger" (POST; v1 kinds: `outbox`,`manual` — `routine` UI deferred to a later slice, the seam exists).
- [ ] **Step 4: `AoaAgentDetail.tsx` page** — composes `AgentDetailCore` with tabs **Overview / Instructions (`AgentInstructionsTab` reuse) / Skills (reuse) / Runs (source = C1 `aoa-runs` → render mirroring the worker Runs panel) / Config (`AgentConfigForm` reuse, AoA-scoped fields) / Triggers (`AoaTriggersTab`)**. Route: add `/<prefix>/team/aoa/:agentId` → `AoaAgentDetail` (mirror how `AgentDetail`'s route is registered — **[verify@exec]** the router file). Commander opens here too (its Config surfaces `internal_agent_config` — Execution/Capabilities/Budget/Run-History, reusing the existing `/settings?tab=commander` section components if importable; else link out — decide at Step 1).
- [ ] **Step 5: Run** `npx vitest run ui/src/__tests__/AoaAgentDetail.test.tsx` + the refactor-guard `*Agent*` tests → all green.
- [ ] **Step 6: Commit** `git add ui/src/components/agent-detail/ ui/src/pages/AoaAgentDetail.tsx ui/src/__tests__/AoaAgentDetail.test.tsx <router-file> && git commit -m "feat(aoa-C): AoA agent detail page (reused core + Triggers tab)"`

---

## Milestone C4 — "+ New AoA agent" flow
- [ ] **Step 1: [verify@exec]** Re-read `NewAgentDialog.tsx` (worker create dialog) + `POST /companies/:companyId/agents` (`agents.ts:905`, `createAgentSchema`).
- [ ] **Step 2:** Failing test: creating from the Commander-Team tab posts `{kind:'aoa', name, adapterType, runtimeConfig:{aoa:{role:'member'}}}` and (optionally) a default `manual` trigger.
- [ ] **Step 3:** Implement a minimal create dialog (mirror `NewAgentDialog`, force `kind='aoa'`, collect name + adapterType + instruction); on success refetch `listAoa`. RBAC gating = Plan D (here: founder-only via the existing route auth).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add ui/src/components/team/ … && git commit -m "feat(aoa-C): create-AoA-agent flow"`

---

## Milestone C5 — Regression + the "visible+configurable" DoD slice
- [ ] **Step 1:** Full UI + server suite (Plan A+B+C) green; the worker `AgentDetail` refactor-guard tests green (no behavior change).
- [ ] **Step 2: Manual acceptance (visible+configurable half of §17):** boot the isolated instance, open **Team → Commander Team**: Commander (Lead) + Discussion Extraction listed; open each → Overview/Instructions/Skills/Runs/Config/Triggers render; toggle a trigger; edit instruction (persists). *(Real extraction output = Plan D.)* Screenshot via `/browse`.
- [ ] **Step 3: Commit** / checkpoint.

## Self-Review
**Spec coverage:** §9.1 nav → C2; §9.2 detail tabs → C3 (+ Triggers, the only net-new tab); create → C4; API → C1. **Placeholder scan:** test bodies are documented "mirror the named existing harness" instructions (AgentsTab/agents-route tests) with exact asserted behavior — same accepted precedent as Plan A; C3 Step 1 is an explicit gating read of the 45K file before code (honest, not hand-waved). **[verify@exec]** on every AgentDetail/router/Plan-A-dependent symbol. **Type consistency:** `listAoa/getAoaRuns/listTriggers` client fns ↔ C1 endpoints; `AgentDetailCore` props stable C3→reuse. **Surfaced Plan-A dependency:** `internal_agent_runs` needs an `agentId` for per-agent Runs — added (additive) + Plan-A runner patched here, flagged for the A executor. **Fidelity:** structural; C3's split boundary is decided at execution after the gating read — by design (the file is too large to pre-specify the exact diff without re-reading it then).
