# Phase 2 — Marketplace Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** company creation installs the crew **from the marketplace** (not legacy hardcoded seeders), each agent arrives with its declared skills, and an upstream agent/skill change flows down through detect → notify → diff → merge **without discarding founder edits**.

**Architecture:** the machinery already exists on both sides — `installTeam` is fully implemented, the catalog is published and coherent, and the update pipeline (`checkCrewUpdates`, auto-apply/notify, `skill-auto-updater`) runs on boot + every 24h. **Phase 2 is wiring, not authoring** — with one exception (T2.4) that needs upstream catalog content.

**Tech Stack:** TypeScript (NodeNext, `.js` specifiers), Express, Drizzle, Vitest, Playwright.

**Branch:** `feat/viewer-upgrade` (stacking on Phase 1 — product-owner decision 2026-07-24).

**Non-goals:** Phase 3 viewer completion; crew file-output detection (W3b, filed); idempotent crew retry (filed); crew-as-team-members (filed design initiative).

---

## Verified preconditions (re-checked 2026-07-24 — do NOT re-derive, DO verify anything you depend on)

**Code side (all still true after Phase 1):**
- `teams.parentProjectId` is `notNull()` with `onDelete: cascade` (`packages/db/src/schema/teams.ts:12`).
- `ensureAllCrewAgents` is still all-or-nothing and bundles **Commander** (`:55`) and **Steward** (`:61`) with the crew seeders (`ensure-all-crew.ts:54-67`).
- Company creation calls `installTeam` **zero times** (grep of `services/companies.ts` + `routes/companies.ts`).
- `/updates/:id/diff` rejects non-skill with 400 (`marketplace-company.ts:307-308`); `/updates/:id/merge` rejects with 404 (`:386-387`).

**Catalog side (live CDN, `generatedAt` 2026-07-24T04:06Z):**
- 514 items: **498 skills, 11 agents, 4 plugins, 1 team** (`team:aoa-curated/default-crew`).
- Published agents: Adjutant, Chronicler, Engineer, Librarian, Memory Keeper, Navigator, Planner, Reviewer, Scout, GitHub Issue Triager, Senior Engineer.
- **Steward is NOT published** → T2.4 required.
- **Chronicler, Memory Keeper, Navigator declare ZERO skills** → T2.4 required.
- The bundled fallback `ui/src/aoa-marketplace-snapshot.json` mirrors the CDN (D11 offline bootstrap works).

**The single root cause this phase fixes:** company create runs the legacy seeders, which stamp `templateOrigin` `…@legacy`, and `crew-updater.ts:151` skips `@legacy` rows **forever** — so every company is permanently frozen out of the update pipeline that is already built and running.

---

## Standing rules for this phase (scars from Phase 1 — do not relearn them)

1. **Verify, don't infer.** A prior version of this plan asserted "the catalog doesn't exist"; it did. Every factual claim in your report needs a `file:line`, a query result, or a command output.
2. **Discriminator discipline.** A test must only be able to pass for the right reason. If success and failure produce the same observable, add a distinguishing assertion. (Phase 1 shipped a "regression guard" that could not fail, and five suites silently traversing a catch.)
3. **Gates fail closed.** A guard that skips when identity/scope is missing is a hole. "Safe because the caller always sets X" is not a guarantee.
4. **Docblocks must not over-promise.** If a function says "never throws", prove it or narrow the claim.
5. **Drizzle only** — `pnpm db:generate`, never hand-written SQL (Critical Rule #1).
6. **`pnpm test:run`**, never bare root-level `vitest` (nested worktrees break it; they are off-limits).
7. **Process:** never run two committing subagents in one worktree simultaneously — the git index is shared and their commits race. Sequential, or separate worktrees.

---

## Sequencing — T2.1 and T2.2 GATE T2.3

- **T2.1 before T2.3:** `installTeam` hard-requires a department that does not exist at company-create time. Without the nullable parent there is nowhere to install to.
- **T2.2 before T2.3:** `isCrewMarketplaceManaged` suppresses the *entire* `ensureAllCrewAgents`. The moment T2.3 makes a company marketplace-managed, Commander and Steward stop being seeded — Inbox Hub curation breaks silently.

Order: **T2.1 → T2.2 → T2.3 → T2.5 → T2.4 → T2.6 → T2.7 → T2.8 → T2.9 → T2.10**. (T2.5 protected-origins before T2.4 so Steward is protected the moment it becomes marketplace-managed.)

---

## T2.1 — Decouple the crew team from departments (D21)

**Why:** AoA crew are **company-wide singletons**; parenting them to a department is semantically wrong *and* fragile — `onDelete: cascade` means deleting that department deletes the crew team row.

**Files:** `packages/db/src/schema/teams.ts`, migration via `pnpm db:generate`, `server/src/services/marketplace-install/team-installer.ts` (~`:81-84` precondition, `:276` `parentProjectId`), `server/src/routes/marketplace-installs.ts` (~`:338` the 400).

- [ ] **Step 1: Failing tests.**
  - `installTeam` succeeds with `targetDepartmentId: null` and writes a `teams` row with `parentProjectId: null`.
  - A department-scoped install still parents correctly (regression).
  - **Deleting a department does NOT cascade away a company-wide crew team** (the discriminator — this is the bug nullability fixes).
  - The **route-level 400** for a *user-initiated* team install that omits a department is **preserved** (only the internal bootstrap path may omit it).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Make `teams.parentProjectId` nullable.** `pnpm db:generate`. Existing rows keep their parent — do not backfill.
- [ ] **Step 4: Relax `installTeam`'s precondition** so a null `targetDepartmentId` is valid; keep the existing validation when one IS supplied (a supplied id must still exist and be `type:'department'`).
- [ ] **Step 5: Run → PASS.** **Step 6: Verify + commit.**
```bash
git commit -m "feat(marketplace): allow company-wide teams with no parent department (D21)"
```

---

## T2.2 — Narrow the crew-seeding gate (P8d)

**Why:** `ensureAllCrewAgents` is all-or-nothing and every caller skips the whole function when marketplace-managed (`index.ts:796-800`, `internal-agent.ts:139-140`). Commander and Steward live inside it.

> **Plan correction (2026-07-24, found during execution):** there are **three**
> call sites, not two. The third is `services/companies.ts:~136-158` (company
> create), which does not call `isCrewMarketplaceManaged` — it carries an
> **inline duplicate** of the same query. Worse, `ensureInternalAgentConfig`
> sat *inside* that gated block, so the moment T2.3 makes a company
> marketplace-managed the company would get **no `internal_agent_config` row
> at all** (no autonomy dial, no provider/model config). Both were fixed as
> part of T2.2.

**Files:** `server/src/services/internal-agent/aoa-agents/ensure-all-crew.ts`, its **three** callers (`index.ts`, `routes/internal-agent.ts`, `services/companies.ts`).

- [ ] **Step 1: Failing test** — for a marketplace-managed company, the **crew** seeders are skipped while the **infrastructure** seeders (Commander, Steward) still run. Discriminator: assert Commander/Steward were ensured AND a crew role (e.g. Scout) was not.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Split** into `ensureCrewAgents` (the marketplace-owned roster) and `ensureInfrastructureAgents` (Commander + Steward, until T2.4 publishes Steward). `isCrewMarketplaceManaged` gates **only** the crew half. Keep `ensureAllCrewAgents` as a thin wrapper if callers depend on it — do not break the boot path.
- [ ] **Step 4: Run → PASS.** **Step 5: Verify + commit.**
```bash
git commit -m "fix(crew): gate only crew seeders on marketplace management (Commander/Steward always seeded)"
```

---

## T2.3 — Install the crew at company creation (P8, P8c)

**This is the task that unfreezes the whole update pipeline.**

**Files:** `server/src/services/companies.ts` (~`:135-157`), `server/src/services/marketplace-install/orchestrator.ts` (`:243`), `server/src/services/marketplace-install/team-installer.ts`, catalog fetch + snapshot fallback.

### Pre-decided before implementation (2026-07-24) — do NOT relitigate mid-task

A reviewer flagged that T2.3 hits a hard throw at `orchestrator.ts:243`
(`"Team install requires targetDepartmentId"`), and that the choice was
"bypass the orchestrator (losing the operation store + rollback) vs. revisit
the throw". **Decision: go through the orchestrator and relax the throw.**
Verified before deciding:

1. **The user-facing guard is at the route, not the orchestrator.**
   `routes/marketplace-installs.ts:338` returns 400 for an agent/team install
   with no `targetDepartmentId`, and it fires **before** `startInstallOperation`.
   So relaxing the orchestrator throw loosens **no HTTP path** — it is a
   redundant backstop for traffic the route already rejected. Leave the route
   400 exactly as it is; T2.1 deliberately preserved it.
2. **Bypassing would fork the install path.** The orchestrator owns the
   `marketplace_install_operations` record, `cascadeResults`, and
   `idempotencyKey` dedupe — all of which **T2.7 (diff/merge) and T2.8
   (re-materialization) build on**. A second, divergent bootstrap path is the
   exact trap class this project keeps paying for.
3. **Relax it to team-only null tolerance**, citing D21 / Decision #111
   (null parent = company-wide). The agent branch never passes
   `targetDepartmentId` to `installAgent` at all, so nothing else moves.
4. **`requestedByUserId` needs no schema change.** The column is nullable
   (`marketplace_install_operations.ts:47`) though `StartInstallOpts` types it
   `string`; company create has the founding user's id, so pass it.
5. **Use a deterministic `idempotencyKey`** (e.g. `bootstrap-crew:<companyId>`).
   `startInstallOperation:76-79` returns the existing operation on a key hit,
   which makes a retried or concurrent create incapable of double-installing
   the crew. Do not skip this — company create already retries on issue-prefix
   collision.

- [ ] **Step 1: Read the existing pre-install gate** (`companies.ts:135-147`) and understand why it can never fire (it checks for a non-`@legacy` agent *before* any install could have run). Note T2.2 has since hoisted `ensureInternalAgentConfig` out of that block — do not push it back in.
- [ ] **Step 2: Failing integration test (L4, real DB)** — a newly created company has the marketplace crew: real `agent:aoa-curated/…` `templateOrigin` (**not** `@legacy`), non-null `templateVersion`, and populated `skillKeys`. Model on `server/src/__tests__/*.integration.test.ts`; Windows-runnable (`initdbFlags: ["--encoding=UTF8","--locale=C"]`, honour `AOA_RUN_WIN_INTEGRATION=1`). **It must actually run — say so plainly if it skips.**
- [ ] **Step 3: Failing test — offline path.** With the network stubbed out, the **bundled snapshot** produces the same roster (D11). This is the discriminator that proves creation never depends on the network.
- [ ] **Step 4: Run → FAIL.**
- [ ] **Step 5: Implement.** Call `installTeam("team:aoa-curated/default-crew")` from company create with `targetDepartmentId: null` (T2.1), live catalog → snapshot fallback. **Never block or fail company creation on install failure** — degrade to the legacy seeders and log loudly, so a marketplace outage cannot break onboarding. Remove the now-unreachable pre-install gate.
- [ ] **Step 6: Run → PASS.** Verify the legacy path still works as the fallback.
- [ ] **Step 7: Verify + commit.**
```bash
git commit -m "feat(marketplace): install the default crew from the marketplace at company creation"
```

---

## T2.5 — Protected origins (D23)

**Do this BEFORE T2.4** so Steward is protected the moment it becomes marketplace-managed.

**Why:** whether an agent is essential to AoA is an **AoA fact, not catalog metadata** — so the protection lives server-side, needs no schema bump, and is enforced where it matters.

**Files:** `server/src/services/marketplace-install/team-uninstaller.ts`, the agent-uninstall path, a new shared const.

- [ ] **Step 1: Failing tests** — uninstalling a **protected** origin (Commander, Steward) returns a clear refusal; uninstalling **any other** marketplace agent still succeeds (the discriminator — proves the guard isn't blanket).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** a server-side protected-origin set + refusal. **Step 4: Run → PASS.** **Step 5: Commit.**
```bash
git commit -m "feat(marketplace): refuse uninstall of protected AoA agent origins (D23)"
```

---

## T2.4 — Author + publish the missing catalog content (P13b, D18, D20)

⚠️ **This task touches TWO EXTERNAL REPOS and publishes publicly. STOP and confirm with the product owner before opening either PR.** (Write access confirmed; PRs pre-authorised in principle — still confirm at the moment of publishing.)

**Repos:** `MeteoriteLabs/aoa-marketplace` (source: `content/agents/`, `content/teams/default-crew/`) and `MeteoriteLabs/aoa-marketplace-cdn` (published `catalog.json`).

- [ ] **Step 1: Author the Steward agent package** in `aoa-marketplace/content/agents/aoa-steward/` — `agent.json` + `AGENTS.md` + `manifest.json`, modelled on `content/agents/aoa-scout/`. Source the instruction text from `ensure-steward.ts:4` and `server/src/onboarding-assets/steward/`. Preserve the **sweep trigger** (`{kind:"sweep", config:{role:"steward"}}`) and the two-tool allowlist (`hub.readCurationContext`, `hub.updateCurationSummary`).
- [ ] **Step 2: Declare skills** for **Chronicler, Memory Keeper, Navigator** (currently zero) and Steward. Per D17 these are purpose-built per agent — draw from the 498 published skills where a genuine fit exists; **do not pad**. If a role has no honest skill fit, declare none and say so.
- [ ] **Step 3: Add Steward** to `content/teams/default-crew/team.json` `agents[]` and `manifest.installOrder`.
- [ ] **Step 4: Regenerate + publish.** Rebuild `catalog.json`, PR to `aoa-marketplace`, then publish to `aoa-marketplace-cdn`. **Confirm with the owner before each PR.**
- [ ] **Step 5: Refresh the bundled snapshot** in AoA via `pnpm fetch-catalog` so offline bootstrap matches.
- [ ] **Step 6: Dependency audit as a test** — every agent's declared `requires` skills resolve against the published catalog (re-run the 42→N audit as an automated check, so a future catalog bump can't silently orphan a dependency).
- [ ] **Step 7: Commit** (AoA side).
```bash
git commit -m "feat(marketplace): publish Steward + declare skills for Chronicler/Memory Keeper/Navigator"
```

---

## T2.6 — Agent-instruction customization tracking (D22)

**This REVERSES a shipped design.** `crew-updater.ts:24-31` currently states *"instruction files are app code, not user config"* and full-replaces on update. D22 (product-owner decision) says agent instruction edits are treated like skills: `customized` + notify/diff/merge. **Record the reversal in `docs/architecture/decisions.md`.**

- [ ] **Step 1: Failing tests** — an agent whose instructions a founder edited is **not** silently overwritten by a catalog bump; an **untouched** agent still auto-updates (the discriminator).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** — set `customized` when a founder edits a marketplace-managed agent's instructions via the editor; `crew-updater` routes customized agents to notify instead of full-replace. **Step 4: Run → PASS.**
- [ ] **Step 5: Record the reversal** in `decisions.md`, superseding the `crew-updater.ts:24-31` rationale. **Step 6: Commit.**
```bash
git commit -m "feat(marketplace): treat agent instruction edits as customizations, not app code (D22)"
```

---

## T2.7 — Build the agent diff/merge path (P10, P11)

**Why:** today `/apply` returns 501 "use merge", `/merge` returns 404 "not a skill" — a closed loop. The Review button leads nowhere. D22 makes this load-bearing.

- [ ] **Step 1: Failing tests** — an agent update with a customized local copy produces a **section-level diff**, accepts keep-mine/accept-upstream **per section**, and lands a `conflict` badge.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extend** `/updates/:id/diff` and `/updates/:id/merge` to `itemType:"agent"` with section-level diffing over instruction files.
- [ ] **Step 4: WRITE the `conflict` status.** It is currently **read in three places** (`marketplace-company.ts:154`, `UpdateCard.tsx:37`, `MarketplaceUpdatesPanel.tsx:40`) and **written nowhere** — dead enum, dead badge. Make divergence surface *before* the founder opens Review.
- [ ] **Step 5: Run → PASS.** **Step 6: Commit.**
```bash
git commit -m "feat(marketplace): agent diff/merge with section-level review + live conflict status"
```

---

## T2.8 — Bundle re-materialization on merge (P12)

**Why:** merge rewrites markdown but never calls the materializer (`marketplace-company.ts` has zero materializer calls; only `skill-installer` and `skill-auto-updater` do), leaving bundled skill files stale on disk.

- [ ] **Step 1: Failing test** — after a merge, bundled files on disk match the upstream commit.
- [ ] **Step 2: Run → FAIL.** **Step 3: Call the materializer from the merge path.** **Step 4: Run → PASS.** **Step 5: Commit.**
```bash
git commit -m "fix(marketplace): re-materialize bundled skill files on reviewed merge"
```

---

## T2.9 — Guard the non-catalog install path (P13)

**Why:** the catalog path guards `customized` with an optimistic lock (`skill-auto-updater.ts:100-133`); the github/url install path has **no such check** and blind-overwrites a founder's customized skill.

- [ ] **Step 1: Failing test** — reinstalling over a **customized** skill notifies instead of overwriting; an **uncustomized** skill still updates (discriminator).
- [ ] **Step 2: Run → FAIL.** **Step 3: Apply the same `customized` check + optimistic lock** to the github/url install/reinstall path. **Step 4: Run → PASS.** **Step 5: Commit.**
```bash
git commit -m "fix(marketplace): stop the github/url install path overwriting customized skills"
```

---

## T2.10 — D18 crew/Commander autonomy dial-split

*(Folded into Phase 2 by product-owner decision 2026-07-24. Independent of the marketplace arc — do it last.)*

**Why:** `internal_agent_config.autonomyLevel` is a **single shared dial** read by Commander, crew task runs, org heartbeat, **and** Adjutant/thread scope-compilation (Decision #109 addendum). D18 wanted it Commander-only with a separate crew column "because one dial must not secretly drive two systems." Phase 1 raised its default to Assist, which moved all four at once.

- [ ] **Step 1: Enumerate every reader** — `dispatcher.ts:~803`, `heartbeat.ts:~4098`, the crew completion guard (`runner.ts`, the Manual exemption), `thread-agent-actions.ts:~864` → `resolveScopeAutoAcceptGate`, `controller-adjutant-runner.ts:119`, `thread-events.ts`, `set-task-status-tool.ts`. **Record the full list before changing anything.**
- [ ] **Step 2: Add a separate crew autonomy column** (Drizzle migration). Decide the existing-row mapping (likely: copy the shared value into the new crew column so nobody's behaviour changes).
- [ ] **Step 3: Repoint each reader** at the correct dial for its system.
- [ ] **Step 4: Tests** — each system reads its own dial; **changing one does not move the other** (the discriminator). Preserve current effective behaviour for existing companies.
- [ ] **Step 5: Update Decision #109 addendum + D18** references. **Step 6: Commit.**
```bash
git commit -m "refactor(autonomy): split the crew and Commander autonomy dials (D18)"
```

---

## Test-coverage matrix

| Task | L1 unit | L2 service+mock | L3 schema | L4 integration | L5 e2e |
|---|---|---|---|---|---|
| T2.1 | installTeam precondition | — | `parentProjectId` nullable | cascade-safety on department delete | — |
| T2.2 | — | gate splits crew vs infra | — | — | — |
| T2.3 | — | fallback-to-legacy on failure | — | **real DB: marketplace roster + offline snapshot** | company-create smoke |
| T2.4 | — | — | — | dependency-resolution audit | — |
| T2.5 | protected set | uninstall refusal | — | — | — |
| T2.6 | — | customized→notify, untouched→auto | — | — | — |
| T2.7 | section differ | diff/merge routes | — | — | conflict badge |
| T2.8 | — | materializer called on merge | — | files on disk match upstream | — |
| T2.9 | — | customized→notify | — | — | — |
| T2.10 | dial resolution | each reader's dial | new column | — | — |

---

## Exit criteria

Creating a company installs the crew **from the marketplace** (offline fallback proven by stubbing the network); each agent carries its declared skills; an upstream agent or skill change flows down through **detect → notify → diff → merge without discarding founder edits**; protected agents cannot be uninstalled; and crew/Commander autonomy are independently dialable.

**Live verification (mirroring Phase 1's T10):** boot an isolated instance, create a fresh company, and confirm the crew arrives marketplace-managed (non-`@legacy` origins, real `templateVersion`, populated `skillKeys`) — then simulate an upstream bump and watch it flow to a founder-visible notification rather than a silent overwrite.
