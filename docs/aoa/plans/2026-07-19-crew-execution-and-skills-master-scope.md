# Crew Execution + Skills + Viewer Completion — Master Scope

> **Status:** Decisions LOCKED with the product owner (2026-07-19). Phase 1 has a detailed implementation plan (`2026-07-19-crew-execution-phase1-foundation.md`). Phases 2–3 are scoped here and get their own plans when reached.

**Context:** The Viewer Upgrade initiative (Phases 0–7B) shipped and is rebased on main. Live testing proved the viewer works on Commander but could NOT complete an end-to-end Discussions/Workspace test, because **crew agent execution is broken in several stacked ways**. This scope covers fixing that, delivering the intended marketplace-driven skills model, and finishing the viewer.

---

## Locked decisions (product owner, 2026-07-19)

| # | Decision |
|---|---|
| D1 | **Priority: crew-execution hardening first**, then marketplace-managed crew, then viewer completion. |
| D2 | **Viewer is view-only.** In-place editing is explicitly OUT of scope (separate future initiative). |
| D3 | **Build Office rendering** (docx/xlsx/pptx). Google Docs/Sheets deferred. |
| D4 | **Marketplace = first-install provisioning.** Company creation installs the default crew FROM the marketplace; the company then owns its copy and can modify it; teammates share that copy. |
| D5 | **Agents ship as complete packages** — agent + its skills + instruction files together. Any marketplace agent install brings its own skills. Company-created agents are company-owned. |
| D6 | **Agent template is the source of truth** for which skills a crew agent gets (`agent.json` → `dependencies.skills`). To change an agent's skills, edit the marketplace repo + bump the catalog. |
| D7 | **Company skill library is OPEN** — users may install skills from any GitHub/URL *and* from the AoA marketplace. No curation gate at the library level. |
| D8 | **Curation is at the crew-agent level** — WE define which skills each crew agent gets. This is only meaningful if per-agent `skillKeys` scoping is ENFORCED (see P4). |
| D9 | **Isolation:** crew agents see ONLY AoA-provisioned skills scoped to that agent — nothing from the host machine's `~/.claude`. |
| D10 | **Update conflicts:** notify + explicit choice/merge (keep-mine / accept-upstream per section). Uncustomized items may auto-update. |
| D11 | **CDN failure:** bundled snapshot fallback — company creation NEVER blocks or fails on network. |
| D12 | **Default crew = today's crew, ported into marketplace packages** (behavior parity, properly provisioned + updatable). |
| D13 | **Greenfield** — no existing users, pre-beta. No legacy migration burden, BUT must land enterprise-grade and be verified before launch. |
| D14 | **Catalog authoring is ours** (the marketplace repo work is in scope for this team). |

---

## Complete problem inventory

### Group A — Crew execution (blocks Discussions + Workspace end-to-end)

| ID | Problem | Evidence |
|---|---|---|
| **P1** | **Crew runs discard ALL logs** — `onLog`/`onMeta` are literal no-ops, so crew failures are undiagnosable. Org/heartbeat runs DO persist transcripts. | `aoa-agents/runner.ts:569` |
| **P2** | **Crew runs are not hermetic** — the operator's global `~/.claude` (SessionStart hooks, gstack/superpowers skills, plugins) + the repo's `CLAUDE.md` leak in and hijack the agent. Managed HOME is docker-only; on Windows claude resolves config via `USERPROFILE`/`CLAUDE_CONFIG_DIR`, neither set; env is full `process.env`; crew is unbridged so no `--settings`. **Affects org agents too.** | `execution-target.ts:816-820`, `execute.ts:177,251,402-404`, `login.ts:15` |
| **P3** | **Crew agents receive NO company/marketplace skills at runtime** — the crew runner never sets `context.skills`. `listRuntimeSkillEntries` has exactly ONE caller (heartbeat/org). Crew agents are explicitly barred from the heartbeat. | `runner.ts:560-571`, `heartbeat.ts:4003-4013,5265-5275` |
| **P4** | **`skillKeys` scoping is UNENFORCED for crew** — `use_skill` gates on `skillKeys` only when `actorType === "commander"`; the crew bridge runs as `"board"`, so a crew agent can invoke ANY company skill. Combined with D7 (open library), a crew agent could run a skill installed from an arbitrary GitHub repo. **This is the security boundary of the whole design.** | `skill-tools.ts:90-112`, `mcp-bridge.ts:291`, `runner.ts:337-354` |
| **P5** | **Crew runs fail to complete** — agent finishes without calling `set_task_status`, run is marked failed + a failure card posted. Root cause unknown beyond P2 (a clean config alone did NOT fix it). **Undiagnosable until P1 lands.** | `runner.ts:644` |
| **P6** | **Dispatch/re-run is fragile** — crew wakeups enqueue only on specific transitions; a failed task is hard to re-run (required unassign→reassign). | `dispatcher.ts:277` |
| **P7** | **The crew Skills tab is a no-op** — the UI lets founders assign skills to crew agents and says *"Skills injected into this agent's context on every run"*, but nothing is delivered (P3) and nothing is enforced (P4). A UI that promises what the runtime doesn't honor. | `AgentSkillsTab.tsx:273-275`, mounted at `AoaAgentDetail.tsx:329-337` |

### Group B — Marketplace-managed crew + skills

| ID | Problem |
|---|---|
| **P8** | **Company creation does NOT install marketplace crew** — it runs legacy seeders (`ensureAllCrewAgents` → `seedCrewAgent`) that never set `skillKeys`, and stamps `templateOrigin` `…@legacy`, which permanently excludes those agents from the marketplace crew-updater's skill refresh. |
| **P9** | **The catalog content doesn't exist yet** — no standard-crew `team.json` / per-agent `agent.json` with `dependencies.skills` published. `team-reconcile.ts` exists but is **inert by its own admission** until that lands. |
| **P10** | **Agent-template update flow is BROKEN** — `itemType:"agent"` pending rows are created and get a Review button, but `/diff` and `/merge` reject non-skill types (400/404), leaving a stuck modal. This is exactly the path D4/D6 depend on. |
| **P11** | `conflict` status is never written by any code (dead enum + dead badge); customization is never surfaced up front — a founder only discovers divergence by opening Review. |
| **P12** | Merge rewrites skill markdown only — it does **not** re-materialize bundled skill files. |
| **P13** | The non-catalog (github/url/local_path) "install update" path **blind-overwrites a customized skill** with no diff, no warning, no `customized` check — inconsistent with the careful catalog path. |

### Group C — Viewer completion

| ID | Problem |
|---|---|
| **P14** | **Office formats (docx/xlsx/pptx) don't render** — fall through to the "Preview unavailable → Open" download fallback. (D3: build this.) |
| **P15** | Code viewer has **no syntax highlighting** (plain `<pre>`). |
| **P16** | CSV parser is **naive comma-split** — breaks on quoted/embedded-comma fields. |
| **P17** | **Inline-preview coverage is inconsistent** — Discussions rich (inline + expand), Workspace image-only, Commander chip-only. |
| **P18** | Google Docs/Sheets not supported (deferred per D3). |
| **P19** | Discussion entry attachments require *composer-validated* uploads, blocking programmatic attach (minor; surfaced during testing). |

### Group D — Not problems (verified)
- **Crew Board is correctly wired** to real data (`taskScope:"crew"` filter + live pills + slide-over). It renders empty only because no crew task completes (Group A).
- Server-reaping during testing was environmental (my sandbox), not product.

---

## Phase breakdown

### Phase 1 — Crew execution foundation *(detailed plan exists; execute first)*
Fixes **P1 → P2 → P3 → P4 → P5 → P6**. Unblocks Discussions + Workspace end-to-end AND makes the crew Skills tab (P7) honest.
**Exit criteria:** a crew agent runs, its transcript is persisted, it sees only AoA-provisioned skills scoped to it, it completes a task and delivers refs into its thread.

### Phase 2 — Marketplace-managed crew
Fixes **P8 → P9 → P10 → P11 → P12 → P13**. Requires catalog authoring in the marketplace repo (D14).
**Exit criteria:** creating a company installs the standard crew from the marketplace (with snapshot fallback), each agent carries its declared skills, and an upstream agent/skill change flows down through notify → diff → merge.

### Phase 3 — Viewer completion
Fixes **P14 → P15 → P16 → P17**. Editing (D2) and Google (D18) explicitly deferred.
**Exit criteria:** every supported file type renders correctly across all three surfaces, including Office documents.

---

## Sequencing rationale
P1 first is non-negotiable: **P5 cannot be diagnosed without it**, and P2/P3/P4 changes can't be verified without seeing what the agent actually does. P2 before P3/P4 because a leaking environment invalidates any skill-scoping test. Phase 2 depends on Phase 1 (a marketplace-provisioned crew is worthless if the runtime ignores its skills). Phase 3 is independent and can run in parallel if capacity allows.
