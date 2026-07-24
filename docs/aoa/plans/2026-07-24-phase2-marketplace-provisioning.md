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
- ~~The bundled fallback `ui/src/aoa-marketplace-snapshot.json` mirrors the CDN (D11 offline bootstrap works).~~
  **❌ REFUTED during T2.3 (2026-07-24). D11 offline bootstrap does NOT work.**
  The snapshot carries only the catalog **index**. `installTeam` then fetches the
  team body, **every** agent template, and every skill body over the network
  (`team-installer.ts:109`, `:121`, `:140` — published skills have
  `content.inline === null`, so their bodies are fetched too). Independently
  confirmed. Consequences, which are product-level, not just test-level:
  - A genuinely network-isolated instance **always** degrades to the legacy
    seeders and therefore gets a permanently non-updateable `@legacy` crew —
    the exact condition this phase exists to eliminate.
  - No amount of snapshot injection can make creation offline-capable; that
    would need bundled resource bodies, not just an index.
  - Any test asserting "offline → marketplace roster" is only honest if it also
    stubs the resource fetches, and must not be described as proving offline
    bootstrap. Recorded on Decision #112.

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

Order: **T2.1 → T2.2 → T2.3 → T2.3b → T2.3c → T2.3d → T2.3e → T2.5 → T2.4 → T2.6 → T2.7 → T2.8 → T2.9 → T2.10**. (T2.5 protected-origins before T2.4 so Steward is protected the moment it becomes marketplace-managed.)

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

## T2.3 — Install the crew at company creation (P8, P8c) — ✅ SHIPPED 2026-07-24

> Landed across `9d0918162` → `c57142e5e` → `52e118108` (build + 3 review rounds,
> two full reviews plus a focused review of the fix-round logic). Decision #112.
> Two implementer push-backs were upheld: the prescribed `isCrewMarketplaceManaged`
> degrade guard was wrong (it matches Commander/Steward seeded moments earlier and
> would trade a silent clobber for a silent crewless company) — replaced with the
> `crewTeamIsInstalled` witness; and the plan's Step 5 "remove the pre-install
> gate" was declined because after T2.2 the gate anchors a live regression guard.

**This is the task that unfreezes the whole update pipeline.**

**Files:** `server/src/services/companies.ts` (~`:135-157`), `server/src/services/marketplace-install/orchestrator.ts` (`:243`), `server/src/services/marketplace-install/team-installer.ts`, catalog fetch + snapshot fallback.

### Pre-decided before implementation (2026-07-24) — do NOT relitigate mid-task

> **Execution notes (2026-07-24) — what differed from this plan.**
>
> 1. **The pre-install gate was KEPT, not removed** (Step 5). After T2.2 it is
>    `isCrewMarketplaceManaged`, and it is what pins the read-before-write
>    ordering that `aoa-bootstrap-wiring.test.ts` (`stampsOriginOnSeed`)
>    guards; it also short-circuits a concurrent create that already installed
>    the crew. One indexed query. See Decision #112 point 8.
> 2. **Step 3 as written is not achievable, and the plan's framing of it is
>    wrong in a second way.** The bundled snapshot carries only the catalog
>    **index**. `installTeam` fetches `team.json` + every `agent.json` over the
>    network, and published skills have `content.inline === null` so their
>    bodies are fetched too. So "creation never depends on the network" is
>    FALSE: a genuinely offline instance resolves a catalog from the snapshot
>    and then fails the install, degrading to legacy. The offline test proves
>    what is actually true — *CDN* down + snapshot present + resource fetches
>    stubbed → marketplace roster. Recorded as a known limitation on Decision
>    #112.
> 3. **`ensureAllCrewAgents` did not need deleting** — T2.2 had already
>    deleted it. The degrade calls `ensureCrewAgents`, as specified.
> 4. Hazards 2, 3 and 4 were all re-verified and all hold: no
>    `ensure-reviewer.ts` exists (9 required agents vs 8 legacy seeders);
>    `ui/src/aoa-marketplace-snapshot.json` is gitignored at `.gitignore:60`;
>    the boot sync is unawaited at `aoa-marketplace.ts` `startSyncLoop`.
> 5. Bonus finding: `loadCachedCatalog`'s docblock claimed it was "used by the
>    company bootstrap path (companies.ts)". It had **zero** production
>    callers. Corrected.


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

- [x] **Step 1: Read the existing pre-install gate** (`companies.ts:135-147`) and understand why it can never fire (it checks for a non-`@legacy` agent *before* any install could have run). Note T2.2 has since hoisted `ensureInternalAgentConfig` out of that block — do not push it back in.
- [x] **Step 2: Failing integration test (L4, real DB)** — a newly created company has the marketplace crew: real `agent:aoa-curated/…` `templateOrigin` (**not** `@legacy`), non-null `templateVersion`, and populated `skillKeys`. Model on `server/src/__tests__/*.integration.test.ts`; Windows-runnable (`initdbFlags: ["--encoding=UTF8","--locale=C"]`, honour `AOA_RUN_WIN_INTEGRATION=1`). **It must actually run — say so plainly if it skips.**
- [x] **Step 3: Failing test — offline path.** With the network stubbed out, the **bundled snapshot** produces the same roster (D11). This is the discriminator that proves creation never depends on the network.

  > **⚠️ This step as originally written is UNSOUND — read before writing it.**
  > Verified 2026-07-24:
  > **`ui/src/aoa-marketplace-snapshot.json` is gitignored** (`.gitignore:60`).
  > It is fetched at build time by `pnpm fetch-catalog`; it is NOT in the repo.
  > So this test would pass on a dev machine that happens to have run
  > `fetch-catalog` and prove **nothing** in CI or a fresh clone, where
  > `bundledSnapshotProvider` (`app.ts:468-486`) catches the failed import and
  > returns `null` — i.e. no fallback at all.
  > **The test must inject a snapshot fixture** (or stub
  > `bundledSnapshotProvider`) rather than depend on the file existing. If you
  > write a test whose outcome depends on whether `fetch-catalog` has been run,
  > you have written a test that lies.

- [x] **Step 3b: Failing test — the cold-cache race.** This is the failure mode most likely to ship silently, and nothing in the plan covered it.
  **The problem:** the bundled snapshot only reaches the cache *inside*
  `syncCatalog`'s catch, and only when the cache is empty
  (`aoa-marketplace.ts:119-131`). The boot sync is **fire-and-forget** —
  `startSyncLoop()` calls `void this.sync()` unawaited (`:78-88`). So on a
  fresh instance a company created in the first seconds after boot can find
  `loadCachedCatalog` still `null`, degrade to the legacy seeders, and be
  provisioned with the `@legacy` roster — **precisely the state Phase 2 exists
  to eliminate**, arrived at non-deterministically and invisible afterwards.
  **Required:** company create must not depend on the background loop winning a
  race. Await catalog availability at the create path with a bounded timeout
  (falling back to snapshot, then to legacy), and test that a create with an
  empty cache and a not-yet-completed sync still produces the marketplace
  roster. Assert on the resulting `templateOrigin`, not on whether a call was
  made.
- [x] **Step 4: Run → FAIL.**
- [x] **Step 5: Implement.** Call `installTeam("team:aoa-curated/default-crew")` from company create with `targetDepartmentId: null` (T2.1), live catalog → snapshot fallback. **Never block or fail company creation on install failure** — degrade to the legacy seeders and log loudly, so a marketplace outage cannot break onboarding. Remove the now-unreachable pre-install gate.

  **Two constraints on the fallback, found during T2.2 review — do not rediscover:**
  1. **Call `ensureCrewAgents`, NOT `ensureAllCrewAgents`.** After T2.2,
     `ensureInfrastructureAgents` has *already run* at `companies.ts:139`
     before the gate. The union would redundantly re-run Commander + Steward
     (idempotent, but wrong intent). `ensureAllCrewAgents` currently has zero
     production callers and exists only for this decision — if you pick
     `ensureCrewAgents`, say so and consider deleting the union.
  2. **The legacy fallback under-provisions, silently.** The legacy seeders
     cover 8 roles; `team:aoa-curated/default-crew`'s `requires[]` names **9**,
     including `agent:aoa-curated/aoa-reviewer` — and **no `ensure-reviewer.ts`
     exists anywhere in the tree** (verified). So a company created during a
     marketplace outage gets a roster permanently missing Reviewer, with
     nothing distinguishing it from a complete one. "Log loudly" must therefore
     name *which* roles the fallback could not provide — a generic "install
     failed, using legacy seeders" is not sufficient to diagnose this later.
- [x] **Step 6: Run → PASS.** Verify the legacy path still works as the fallback.
- [x] **Step 7: Verify + commit.**
```bash
git commit -m "feat(marketplace): install the default crew from the marketplace at company creation"
```

---

## T2.3b — Make crew provisioning repairable (the one-way door) — ✅ SHIPPED 2026-07-24

> **Execution notes — one plan instruction was overturned, deliberately.**
>
> 1. **"Reuse `provisionCompanyCrew`" is right for ONE of the three degraded
>    states and wrong for the most important one.** For a `@legacy`/NULL-origin
>    company, `installTeam` inserts a fresh row per roster entry and
>    `resolveAgentNameConflict` renames each collision — so re-running the
>    provisioner mints `Scout-2` / `Reviewer-2` / `default-crew-2`, all carrying
>    the same `templateOrigin`, and leaves the ORIGINAL rows (the ones tasks and
>    runs point at) still `@legacy` and still frozen out. It repairs nothing.
>    Deleting the legacy rows instead is worse — they own work by id.
>    So the `unmanaged` state is repaired by **adoption**: re-point each existing
>    row at its catalog template in place via `applyCrewAgentUpdate` (which gained
>    an optional `setTemplateOrigin` so origin + version + content land in one
>    transaction). Agent ids, names, titles, roles and adapters survive.
>    Adoption claims exactly the rows a fresh install would have collided with,
>    which is why it cannot duplicate them. `provisionCompanyCrew` IS reused
>    verbatim — for the `crewless` state, where nothing can collide.
>    This is proven by a permanent ABLATION test.
> 2. **Diagnosis-before-action is the whole safety property.** `repairCompanyCrew`
>    always classifies first (`healthy` / `operation-row-stale` / `crewless` /
>    `unmanaged`); the classification is the only thing standing between repair
>    and a duplicate roster.
> 3. **Step 4 was already done** — `claimOperationForDispatch` (T2.3 fix round)
>    already claims `pending`/`failure`/stale-`running`. Confirmed, built on.
> 4. **The plan's Step 4b case 2 needed narrowing.** "Operation row is not
>    `success`" is NOT the same as "stale": a FRESH `running` row belongs to a
>    live install. Repair seals only rows that `claimOperationForDispatch` would
>    actually claim (`failure`, `pending`, `running` older than
>    `OPERATION_CLAIM_STALE_AFTER_MS`) and never `requested`.
> 5. Repair also writes the `teams` row + `team_members` links an install would
>    have written, which is exactly what the already-wired `reconcileTeamMembers`
>    needs to install roster members with no legacy counterpart (Reviewer).

### Post-review revision (2026-07-24) — adoption is POINTER-ONLY

Two review blockers changed the design after the first build. Both are recorded
because the rejected shape is the one a future reader will reach for first.

**1. Repair must not touch agent CONTENT.** The first build adopted a legacy row
by calling `applyCrewAgentUpdate`. That runs
`materializeManagedBundle(..., { replaceExisting: true })`, whose first act is
`fs.rm(root, { recursive: true, force: true })` on the directory holding the
founder's instruction edits — **outside the transaction**, and **without reading
`agentUpdatePolicy`** (default `notify`). Proven by ablation: forcing the
transaction to fail leaves the DB row legacy and the founder's file *gone*.

Adoption now rewrites exactly two columns — `templateOrigin` and
`templateVersion` (`ADOPTED_TEMPLATE_VERSION = "0.0.0-legacy"`, a sentinel that
can never equal a published version, so the row never claims content it has not
seen). Instructions, `skillKeys`, `runtimeConfig`, triggers and adapter are left
exactly as the founder has them. That is enough to un-freeze the company;
`checkCrewUpdates` then routes the content change through the company's own
policy — auto-apply, or a founder-visible pending update. Repair also fires a
`marketplace.crew_repaired` notification.

*Known consequence:* on the default `notify` policy the founder gets a pending
**agent** update, and the agent diff/merge path is not built until **T2.7**
(`/updates/:id/diff` 400s on non-skill today). That gap is visible and temporary,
and is not new — it already applies to every marketplace-managed company on
`notify`. It is strictly better than the alternative, which was silent
destruction.

**2. Adoption is ALL-OR-NOTHING, in one transaction.** A partial adoption plus a
team row is the worst reachable state: `reconcileTeamMembers` cannot distinguish
"no local counterpart" (Reviewer, intended) from "adoption failed here", so it
installs a renamed duplicate — after which the original row is unreachable
*forever*, because the next repair sees the origin already present and skips it.
A single transient 503 was enough to reach it. If any roster member that has a
local row cannot be adopted, repair now writes nothing. `reconcileTeamMembers`
additionally refuses to install a roster member whose name is already held by an
unmanaged `kind='aoa'` row (which also closes the legacy-Steward/Chronicler
duplicate that T2.4 would otherwise hit).

**3. Adoption installs the roster's `company_skills`.** `installTeam` writes one
row per required skill; adoption did not, so a repaired crew advertised skill
keys `handleUseSkill` could not resolve — and the Reviewer that reconcile
installs next inherited the same dangling keys.

**4. Classification is roster-driven, not name-list-driven.** The hardcoded
infrastructure name set is gone. Diagnosis is `healthy` /
`operation-row-stale` / `degraded`; the crewless-vs-unmanaged split is made
against `team.json` inside repair, where the roster is authoritative. This is
what makes the T2.4 Steward move safe: a legacy Steward will name-match its
roster entry and be adopted rather than duplicated.

**5. Smaller corrections.** The cooldown moved *into* `repairCompanyCrew` so the
route is gated too (with an explicit `force` override); a fail-closed skip no
longer consumes pass budget (five unrepairable companies were starving the
sixth forever); pass counters split into
`skippedFailClosed`/`skippedCooldown`/`skippedOverBudget`; the pass gates on the
crew **team item** being present rather than on "a catalog exists"; repair stands
aside while a bootstrap install is genuinely in flight; and the whole repair runs
in one transaction behind `pg_advisory_xact_lock(companyId)` with an
in-transaction re-read.

> **Why a lock and not a unique index on `teams (companyId, templateOrigin)`.**
> The index was the other option offered. It would change `installTeam`'s
> semantics for *every* caller — a founder installing the same team twice into
> one company would hard-fail instead of getting a suffixed slug — which is a
> product decision beyond this task. The lock plus sealing the operation row
> inside the same transaction (on its unique idempotency key) excludes both a
> concurrent repair and a concurrent bootstrap. Filed as a follow-up.

### Second review round (2026-07-24) — the rename hazard, and the real skill installer

**F1 was a regression I introduced.** Removing `INFRASTRUCTURE_AGENT_NAMES` to
fix B4 also removed the signal a refusal depended on, and the refusal went with
it instead of being re-expressed. `PATCH /agents/:id` lets a founder rename a
crew agent without touching `templateOrigin`, so a name-only match read a
renamed crew as *crewless* and installed a second parallel crew beside the rows
that own every task, run and assignment — permanently, because the company then
reads `healthy`. Reproduced by ablation.

Fixed by matching the roster to local rows on **name OR legacy-origin slug**.
`backfillCrewTemplateOrigin` writes `aoa-curated/standard-crew/<slug>@legacy`
once at boot and nothing rewrites it, so the slug survives every rename and is
the join key that actually holds. A renamed crew is now *adopted in place*,
keeping the founder's names. The same matching closes **F2** (partial rename),
and `reconcileTeamMembers`'s guard matches on slug too.

The refusal is back as `unaccounted-crew-rows`, but stated precisely, because
"any leftover row" would break the legitimate crewless path (a real crewless
company has Commander stamped `…/commander@legacy`):
- **infrastructure** → accounted;
- **a `…@legacy` origin naming a role the roster does NOT carry** (a retired
  Dispatcher) → accounted; the backfill stamped that slug from the name, so the
  row provably is not a renamed roster member and cannot be duplicated;
- **a NULL-origin row with a non-roster name** → ambiguous (it may be a roster
  member renamed *before* the backfill could stamp it) → **refuse**. Known false
  positive: a company with a retired `Scribe` row and no crew at all is refused
  rather than provisioned. Rare, named in the log, and a short human decision
  beats a silent second crew.

**F3 — skills now go through the real `installSkill`.** The hand-rolled insert
dropped the bundle, hardcoded `trustLevel`/`fileInventory`, and — because it
stamped `sourceRef` to the current version — made `installSkill`'s idempotency
guard answer `alreadyInstalled` for that key **forever**, so the bundle would
never be materialized for that company. Both halves ablation-proved (`PROBE
alreadyInstalled = true`). All 17 skills the live crew team requires carry a
bundle. Skills are installed **outside** the transaction, deliberately:
`installSkill` git-clones each bundle, and holding a transaction plus an
advisory lock across 17 clones is not acceptable. That is safe in a way the
agent writes are not — additive, idempotent, version-scoped new-file writes,
never a delete of founder data — so a later transaction failure simply leaves
rows the next attempt re-uses.

> **Follow-up filed: `installTeam` has the identical defect.** — ✅ CLOSED by
> T2.3c (2026-07-24). `team-installer.ts` phase 3 did its own hand-rolled
> `company_skills` insert with `trustLevel: "markdown_only"` and
> `fileInventory: []`, so every freshly-bootstrapped company got the same
> bundle-less, poisoned rows and a *repaired* company ended up with strictly
> better skill rows than a newly created one.

**Also:** bounded concurrency for skill installs (F4 — sequential would have
blown the deadline and then not retried for a full cooldown); the advisory-lock
comment now states its true scope, naming the two gaps it does not cover (F5);
`team-reconcile.test.ts`'s positional mock replaced with keyed dispatch, which
had been silently answering the new query with the wrong fixture so the guard
never executed (F6); the team row keeps the published version with the
`TeamManifestSchema` `^\d+\.\d+\.\d+$` constraint recorded (F7);
`action: "none"` no longer counts as repaired or charges budget (F8); the route
docblock corrected and `force` given a 60s floor (F9); `resolver.ts` gives an
adopted row its own copy instead of a generic version-mismatch (F10).

### Step 5 — the trigger: BOTH, boot-time reconcile primary

**Chosen:** a boot/interval reconcile pass (`runCrewRepairPass`, called from
`runCrewUpdateCheck` in `server/src/index.ts`) **plus** an authenticated
founder-only route (`POST /api/companies/:cid/marketplace/crew/repair`).

**Argument.** The companies that need repair are by construction the ones whose
founder has no idea anything is wrong — the crew looks present and simply never
receives an update. A button only helps someone who already knows to press it,
so route-only would leave the majority permanently frozen. The reconcile is
affordable because it rides the pass that already exists: it reuses the catalog
`runCrewUpdateCheck` just loaded (zero extra catalog fetches), costs one indexed
diagnosis and nothing else for a healthy company, and is self-terminating (a
repaired company is permanently healthy, so the backlog only shrinks).

Guards, all required before this was acceptable:
- **No catalog → no pass.** `runCrewUpdateCheck` already returns early on an
  empty cache, so a genuinely offline instance does zero repair work and retries
  nothing. That is the "must not re-run every boot with no network" requirement.
- **`CREW_REPAIR_MAX_PER_PASS = 5`** — a many-company instance cannot turn a boot
  into a CDN stampede; the remainder are taken by later passes.
- **`CREW_REPAIR_COOLDOWN_MS = 6h`**, process-local and honestly documented as
  such. It guards tight re-entry (route in a loop, interval landing next to a
  boot), not a crash-looping process; the per-pass cap bounds that, and a failed
  repair writes nothing (adoption fetches before it writes, per agent).
- **Fail closed.** If no crew row maps onto the roster, repair installs nothing
  and logs why. A visible unrepaired company beats two parallel crews.

The route is kept because it is attributable, immediate, and returns the
diagnosis — so "is this company frozen out of crew updates?" is answerable
without DB access.

**Added 2026-07-24 during T2.3 review. This is not optional polish — without it
T2.3's core property is one network call wide.**

**Why:** `provisionCompanyCrew` has exactly **one** production caller — company
create (`companies.ts:190`) — and `crew-updater.ts:151` skips `@legacy` and
null-origin rows forever. So **any** degrade at the single instant of company
creation (CDN blip, cold cache + no snapshot, catalog timeout, aggregate
install deadline, process restart mid-install) permanently excludes that
company from every future crew update, with no recovery short of manual DB
surgery. The entire point of Phase 2 is that companies are born updateable;
today that property depends on one network call at one moment, with no retry.

This also makes the T2.3 degrade path *safe to choose*: bounded deadlines and
fail-open behaviour are only acceptable if the resulting state is recoverable.

- [x] **Step 1: Failing test** — a company whose crew is `@legacy`/unmanaged can
  be re-provisioned into a marketplace-managed crew, and afterwards
  `crew-updater` no longer skips it. **Discriminator:** assert the *origins
  change* (`@legacy`/null → `agent:aoa-curated/…`) and that a subsequent update
  check now considers the company — not merely that a route returned 200.
- [x] **Step 2: Failing test — repair must be safe to re-run** on an
  already-marketplace-managed company (no duplicate agents, no second team, no
  clobbering of founder customizations). Re-running repair is the single most
  likely operator action.
- [x] **Step 3: Run → FAIL.**
- [x] **Step 4: Implement.** Reuse `provisionCompanyCrew`. **Note the review
  finding this depends on:** `crew-bootstrap.ts:134-140` currently treats *any*
  non-`pending` operation as "someone else owns this install", including
  `failure` — so a previously-failed bootstrap would make repair a no-op and
  leave the company crewless. Narrow that guard to `pending | running | success`
  **before** wiring repair, or the repair path is dead on arrival for exactly
  the companies that need it most.
- [x] **Step 4b: Cover the two residual states T2.3 deliberately left visible.**
  Both are known, both are the *right* trade (a visible gap beats an
  unrepairable clobber), and both are only acceptable because this task exists:
  1. **`unknown` witness → crewless.** `inspectCrewTeamInstall` fails closed on
     a DB error, so a blip at exactly that moment yields a company with only
     Commander + Steward and an ERROR log as the sole signal. **Detection case:
     "has infrastructure agents but neither a crew team nor legacy crew rows."**
  2. **Unrepaired operation row.** The averted-clobber path repairs the lying
     `failure` row to `success`, but that write uses the same connection that
     just failed. If the DB is what's broken, the repair fails too and the row
     stays claimable (`operationRepaired: false`, logged ERROR). Repair will
     then find a legitimately claimable `failure` row — correct, just noisier.
     Do not "fix" this by retrying inside T2.3; retry belongs here.
- [x] **Step 5: Decide and record the trigger.** Options: an authenticated
  founder/admin route, a boot-time reconcile for degraded companies, or both.
  Boot-time reconcile is the one that fixes companies whose founder will never
  know to click anything — prefer it, but it must be rate-limited and must not
  re-run on every boot for a company that legitimately has no network.
- [x] **Step 6: Run → PASS. Verify + commit.**
```bash
git commit -m "feat(marketplace): make crew provisioning repairable after a degraded bootstrap"
```

---

## T2.3c — Install team skills through the real installer (found via T2.3b) — ✅ SHIPPED 2026-07-24

> **Execution notes.**
>
> 1. **Seam chosen: a new phase 3, outside the transaction — the same seam
>    T2.3b settled on**, for the same reasons plus one this path adds:
>    `uninstallTeam` already leaves `company_skills` in place ("they may be
>    shared with other agents"), and the orchestrator discards `cascadeResults`
>    entirely on a failed team install (`orchestrator.ts:359` keeps them only for
>    `PackageInstallError`), so **nothing** depended on skill rows rolling back
>    with the team. The phases renumbered: 1 pre-flight, 2 plugins, **3 skills**,
>    4 team-body txn.
> 2. **An already-present key is SKIPPED, not upgraded.** `installSkill` THROWS
>    on a version mismatch ("use the update flow"), so routing blindly through it
>    would make a founder's team install fail because one required skill is pinned
>    at an older version — a new failure mode the `onConflictDoNothing` it
>    replaces did not have. A pre-filter on `key` (exactly `installMissingRosterSkills`'s
>    shape) preserves the old semantics and keeps the throw out of the team path.
> 3. **The phase-1e skill-body pre-fetch was DELETED, not kept.**
>    `installSkill` loads inline content / fetches `resourceUrl` / materializes
>    the bundle itself, so keeping 1e meant a second, discarded round-trip per
>    skill — 17 of them on the crew bootstrap, every one of which is thrown away
>    because a bundle carries its own SKILL.md.
> 4. **One thing the plan did not name: this puts N `git clone`s on the
>    synchronous company-create POST**, and `CREW_INSTALL_DEADLINE_MS` was sized
>    against "27 CDN fetches" — a claim T2.3c would have silently falsified. The
>    caller's `signal` is now threaded `installTeam → installSkill →
>    materializeSkillBundle → execFile`, so the deadline actually kills a stalled
>    clone, and is re-checked before each skill install. Both docblocks were
>    rewritten to state what it does and does not bound.
> 5. **Correction to a T2.3b docblock:** it claimed `installSkill` "owns its own
>    per-item fetch and git-clone timeouts". The fetch half was true; the clone
>    half was not — `execFile` had no timeout and no signal. Stated honestly now.
>
> **Review round 2 (CHANGES REQUESTED → addressed).** The reviewer was right on
> both blockers, and the measurement they demanded overturned my own estimate.
>
> 6. **`git clone --no-checkout` is NOT shallow** — it skips the working tree but
>    downloads the whole object database. My "lands in a few seconds" was
>    derived from that false premise. **Measured**, 17 real bundles at
>    concurrency 6 against live GitHub, two runs each:
>
>    | fetch strategy | no cache | cache |
>    |---|---|---|
>    | `clone --no-checkout` | 67.5s / 69.3s | 18.2s / 23.9s |
>    | depth-1 fetch of the pinned sha | 16.1s / 12.9s | **5.6s / 5.2s** |
>
>    At 68s the shipped commit blew `CREW_INSTALL_DEADLINE_MS` (30s) by >2×, so
>    **every live company create would have degraded to legacy**. Both fixes
>    taken: a per-install `BundleCheckoutCache` (17 fetches → 4, the roster draws
>    on only 4 repos) and the optional depth-1 fetch, which the numbers made
>    non-optional. Net 12×.
> 7. **The per-item abort comment was false and its test passed for the wrong
>    reason** — a pre-aborted signal is caught at phase 1c, whose message also
>    matches a loose `/deadline/i`, so both phase-3 checks could be deleted with
>    the test still green. Replaced with two tests that abort *after* pre-flight
>    and assert the phase-3 messages exactly; ablation-verified (both fail with
>    the checks removed).
> 8. **C5 — orphaned bundle-less rows: ACCEPTED as "heals on next version
>    bump".** Agreed with the reviewer. No path repairs them (every installer
>    matches on key and skips), but T2.3 is not on `main`, so the cohort is local
>    dev instances only; `skill-auto-updater` re-materializes on the next version
>    bump of each skill for `customized = false` rows. A backfill for a
>    local-only cohort is not worth its own failure modes.
>
> **⚠️ NEW BLOCKER found while measuring — filed, NOT fixed here.**
> Against the **live** catalog the crew install fails in pre-flight for every
> company: all 9 published crew agents declare `aoa.triggers[].enabled`, and
> `agent-runtime.ts:87-92` types `triggers[]` as `.strict()` with only
> `kind` + `config`, so `parseMarketplaceAgentTemplate` rejects them
> (`unrecognized_keys: ['enabled']`) and company create degrades to the legacy
> `@legacy` roster. **T2.3's core property does not hold in production today.**
> No test caught it because every fixture catalog in the repo hand-writes
> triggers without `enabled`. Not fixed in T2.3c because it is a real semantic
> decision, not a rubber stamp: `normalizeMarketplaceAgentTemplate` (`:306`)
> does not read `enabled`, so merely relaxing the schema would install a
> trigger the catalog marked disabled as **enabled**. Needs its own task — and
> a fixture that mirrors a real published `agent.json`.

**Why:** `team-installer.ts:243-269` (phase 3 of `installTeam`) hand-rolls the
`company_skills` insert instead of calling `installSkill`. It hardcodes
`trustLevel: "markdown_only"`, `fileInventory: []`, no `catalogSkillBundle` /
`catalogBundleInstallPath` metadata, and takes markdown from the fetched body
rather than the bundle's. **All 17 skills the default crew requires carry
`skill.bundle` in the live catalog**, so every company created by T2.3 gets 17
bundle-less rows — and because `sourceRef` is stamped to the current version,
`installSkill`'s idempotency guard (`skill-installer.ts:67-70`) later returns
`alreadyInstalled: true`, so **the bundle is never materialized. Permanently.**

T2.3b fixed this for the *repair* path. Left alone, a **repaired** company would
have strictly better skill rows than a **newly created** one — and the phase's
own goal is "each agent arrives with its declared skills". A bundle-less skill
is not the declared skill.

**Scope note:** this changes every founder-initiated team install, not just the
bootstrap. That is a *fix* for those callers too — they are getting the same
poisoned rows today.

**Files:** `server/src/services/marketplace-install/team-installer.ts`, its tests.

- [x] **Step 1: Failing test** — after `installTeam`, a bundle-carrying skill has
  real bundle metadata and a non-empty `fileInventory`, and a subsequent
  `installSkill` for the same key does **not** report `alreadyInstalled` against
  a bundle that was never materialized. **Discriminator:** assert *field parity*
  against a row the real `installSkill` wrote — the check a re-implementation
  cannot pass. (T2.3b used exactly this; reuse the approach.)
- [x] **Step 2: Run → FAIL. Step 3: Route the insert through `installSkill`.**
  Mind the transaction: `installSkill` git-clones bundles, and T2.3b concluded
  17 clones inside a transaction holding an advisory lock is unacceptable —
  match whatever seam T2.3b settled on, and say which you chose.
- [x] **Step 4: Run → PASS. Step 5: Verify + commit.**
```bash
git commit -m "fix(marketplace): install team skills through the real installer (bundles + trust level)"
```

---

## T2.3d — Accept and honour `triggers[].enabled` (T2.3 DOES NOT WORK IN PRODUCTION)

> **🔴 This is a live blocker on the phase's own deliverable. Do it before T2.5/T2.4 —
> the exit criteria cannot pass until it lands.**

**Why:** every published crew agent declares `aoa.triggers[].enabled`, but
`marketplace-install/agent-runtime.ts:87-92` types triggers as `.strict()` with
only `kind` + `config`. So pre-flight validation fails:

```
crew provisioning DEGRADED to the legacy seeders (install failed:
  code: "unrecognized_keys", keys: ["enabled"], path: ["aoa","triggers",0])
```

**Every live company create fails and lands on the `@legacy` roster** — the exact
state this phase exists to eliminate. Independently verified 2026-07-24 by
fetching all 11 published `aoa-curated` agent bodies from
`raw.githubusercontent.com`: **9/9 agents that declare triggers declare
`enabled`** (adjutant, chronicler, engineer ×2, librarian, memory-keeper,
navigator, planner, reviewer, scout). The two with zero triggers are unaffected.

**Why no test caught it:** every fixture catalog in the repo hand-writes triggers
without `enabled`, and the catalog *index* (the bundled snapshot) carries no
trigger data at all — triggers live in the separately-fetched `agent.json`. The
fixtures were not wrong about the schema; they were wrong about the **catalog**.
This is a fixture-fidelity failure, and it is the third defect this phase caused
by a fixture diverging from production.

**Do NOT just relax the schema.** `normalizeMarketplaceAgentTemplate:306` maps
only `kind`/`config`, and `agent-create.ts:105` hardcodes `enabled: true` — so a
bare schema relaxation would install a trigger the catalog marked **disabled**
as **enabled**. The DB already supports the value: `aoa_agent_triggers.enabled`
is `notNull().default(true)`.

**Files:** `server/src/services/marketplace-install/agent-runtime.ts` (`:87`
schema, `:306` normalizer), `agent-create.ts` (`:105` insert),
`crew-updater.ts` (`:111` trigger re-insert), fixtures.

- [x] **Step 1: Failing test against a PRODUCTION-SHAPED fixture.** Copy a real
  published `agent.json` body (triggers carrying `enabled`) rather than
  hand-writing one. It must fail today with `unrecognized_keys: ["enabled"]`.
- [x] **Step 2: Failing test — `enabled: false` is HONOURED.** The discriminator:
  a catalog trigger marked disabled must produce `aoa_agent_triggers.enabled =
  false`, not `true`. A test that only asserts "install succeeds" would pass a
  bare schema relaxation and miss the semantic bug entirely.
- [x] **Step 3: Run → FAIL.**
- [x] **Step 4: Implement** — accept `enabled` (default `true` when absent,
  preserving today's behaviour), thread it through the normalizer, and honour it
  at BOTH insert sites (`agent-create.ts` and `crew-updater.ts`'s re-insert;
  adoption/update must not silently re-enable a disabled trigger).
- [x] **Step 5: Audit the rest of the contract the same way.** `enabled` was
  found by accident while measuring. Diff a real published `agent.json` against
  the schema field-by-field and report **every** other divergence — do not stop
  at the first. Check `team.json` too.
- [x] **Step 6: Run → PASS. Verify + commit.**
```bash
git commit -m "fix(marketplace): accept and honour triggers[].enabled from the catalog"
```

### Step 5 audit result (2026-07-24) — field-by-field, all 11 published agents + `team.json`

Method: fetched every published `aoa-curated` body at the catalog's own
`commitSha` (`ad575a0a…`, live CDN `generatedAt` 2026-07-24T04:06:31Z) and ran
the REAL `parseMarketplaceAgentTemplate` + `normalizeMarketplaceAgentTemplate`
over each, then enumerated every leaf key path in the bodies and traced each to
its consumer.

**Hard rejections (schema refuses the body):** exactly one — `aoa.triggers[].enabled`,
on 9/11 agents (2 declare no triggers). Fixed here. After the fix all 11 parse.

**Open findings — NOT fixed here, they need a product decision. F1 is a live blocker
on the phase's exit criterion, on a par with `enabled`:**

- **F1 — a marketplace-installed crew is INERT (`status: "paused"`).** The 9 crew
  bodies declare no `aoa.install` block, so `normalizeStatus(undefined, false)`
  (`agent-runtime.ts:193-197`) returns `"paused"` and `agent-create.ts` writes it.
  The legacy seeder writes `"idle"` (`seed-crew-agent.ts:101`). Every crew
  dispatch path excludes paused: `dispatcher.ts:594`
  (`notInArray(agents.status, ["paused","terminated"])`), `triggers.ts:74`, and
  every sweep (`sweep-adjutant.ts:69`, `sweep-chronicler.ts:61`,
  `sweep-memory-keeper.ts:61`, `sweep-steward.ts:71`). Verified empirically: all
  9 normalize to `status=paused`. Fix is either upstream (`install.defaultStatus`
  in the catalog — note `agent.v1` only permits `active|paused|terminated`, so it
  cannot express the seeder's `idle`) or server-side (crew-aware default).
- **F2 — the crew installs on the wrong adapter.** The 9 bodies declare
  `aoa.adapterType: "process"` and no `adapterConfig`, so every crew agent lands
  `adapterType="process"`, `adapterConfig={}`. The legacy seeder resolves the
  company's configured CLI via `resolveCrewAdapterForCompany`
  (`seed-crew-agent.ts:93`), and no marketplace path ever calls it —
  `resolveCrewAdapterForCompany`/`shouldRewriteCrewAdapter` are referenced only
  from the `ensure-*` seeders, which T2.2's gate suppresses for a
  marketplace-managed company.
- **F3 — `install.defaultRole: "engineering"` is not a valid AoA role.**
  `AGENT_ROLES = ["cxo","lead","general"]` (`packages/shared/src/constants.ts:68`),
  so the two published non-crew agents warn-and-fall-back to `general`. Soft
  (warn-and-continue), but the catalog author believes otherwise.
- **F4 — parsed-then-never-read agent fields:**
  `aoa.adapterCompatibility.requiresInstructionsBundle` and
  `.requiresSkillInjection` (declared by both non-crew agents) have no reader
  anywhere in `server/` or `packages/`.
- **F5 — `team.json` has NO runtime validation at all.** It is an unchecked
  `JSON.parse(...) as TeamTemplateBody` (`team-installer.ts:172-174`), so no field
  can be rejected — the empty-roster guard at `:400` is the only structural check.
  Within it: `manifest.installOrder` and `manifest.adapterCompatibility`
  (`supported`, `membersInheritWhenSingleChoice`) are stored verbatim into
  `teams.manifest` and never read (install order comes from the `agents[]` array;
  lead = first entry); `agents[].overrides` is declared in the TS interface and
  never read. No live divergence today — the published `installOrder` happens to
  match the published `agents[]` order — but the coupling is unenforced.

---

## T2.3e — The installed crew must actually RUN (status + adapter)

> **🔴 Second live blocker on the phase deliverable. Found by T2.3d's Step 5 audit.
> Even with T2.3d landed, a company that successfully installs the marketplace
> crew gets a crew that never fires and is wired to the wrong runtime.**

**F1 — the marketplace crew installs INERT.** The 9 published crew bodies declare
no `aoa.install`, so `normalizeStatus(undefined, false)` returns **`"paused"`**.
The legacy seeder writes **`"idle"`** (`seed-crew-agent.ts:103`). Every crew
execution path excludes paused — `dispatcher.ts:594`
(`notInArray(agents.status, ["paused","terminated"])`), `triggers.ts:74`, and all
four sweeps. So the install succeeds, the UI shows a crew, and **nothing ever
runs**. This is worse than degrading to legacy, because it looks correct.

**F2 — wrong adapter.** All 9 declare `aoa.adapterType: "process"` with no
`adapterConfig`. The legacy seeder resolves the company's actual CLI via
`resolveCrewAdapterForCompany` (`seed-crew-agent.ts:93`). **No marketplace path
calls it**, and T2.2's gate suppresses the `ensure-*` seeders once a company is
marketplace-managed — so nothing ever corrects it.

### Decision: fix server-side, not in the catalog (locked 2026-07-24)

The implementer correctly flagged this as a product call. Resolving it:

1. **The catalog physically cannot express the right value.** `agent.v1`'s
   `install.defaultStatus` enum is `active | paused | terminated` — there is no
   `idle`. Catalog-declared parity would require widening the schema in **both**
   repos before this blocker could be fixed at all.
2. **F2 is unknowable to the catalog by construction.** Which CLI a crew agent
   should use is *per-company runtime state* (`resolveCrewAdapterForCompany`).
   No published artifact can carry it.
3. **Precedent is already set in this plan.** T2.5's "Why" states that whether an
   agent is essential to AoA is *"an AoA fact, not catalog metadata"*. How a crew
   agent must be configured in order to run is the same kind of fact.
4. It avoids gating a live blocker behind T2.4's external-repo publish + sign-off.

So: **for `kind === "aoa"` installs, the server applies crew defaults** — status
and adapter resolved the same way the legacy seeder resolves them — overriding
catalog values that cannot express the truth. Catalog `install` hints may still
be honoured for non-crew (`kind: "org"`) agents.

**Files:** `server/src/services/marketplace-install/agent-runtime.ts`
(`normalizeStatus`, adapter normalization), `agent-create.ts`,
`team-installer.ts` (crew install path), `crew-repair.ts` (adoption must not
re-break a working crew).

- [ ] **Step 1: Failing test — a marketplace-installed crew agent is dispatchable.**
  **Discriminator:** assert the agent is actually *selected* by the real
  dispatcher/trigger query (`dispatcher.ts:594` / `triggers.ts:74`), not merely
  that `status !== "paused"`. A status-string assertion would pass a fix that
  still fails the real predicate.
- [ ] **Step 2: Failing test — the installed crew agent carries the company's
  resolved crew adapter**, matching what `resolveCrewAdapterForCompany` produces
  for that company, not `"process"`.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** the crew-aware server-side defaults. Apply on the
  **install** path AND check the **adoption** path (`crew-repair.ts`) — adoption
  is pointer-only today, so a legacy row keeps its working `idle`/CLI values;
  make sure this change does not alter that, and that a repaired company and a
  freshly-created one converge on the same runnable state.
- [ ] **Step 5: Run → PASS.** Then re-run the T2.3d end-to-end bootstrap test and
  confirm the crew is both marketplace-managed **and** dispatchable — that
  conjunction is the phase's real exit criterion.
- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "fix(marketplace): install crew agents in a runnable state (status + resolved adapter)"
```

### Deferred from the same audit (F3-F5, not blockers)

- **F3** `install.defaultRole: "engineering"` is not in `AGENT_ROLES`
  (`cxo|lead|general`) — warn-and-fall-back to `general`. Affects the two
  non-crew published agents only.
- **F4** `adapterCompatibility.requiresInstructionsBundle` / `.requiresSkillInjection`
  are parsed and have **no reader** anywhere in `server/` or `packages/`.
- **F5** `team.json` has **no runtime validation at all** — unchecked
  `JSON.parse(...) as TeamTemplateBody` (`team-installer.ts:172-174`). Within it,
  `manifest.installOrder` and `manifest.adapterCompatibility` are stored into
  `teams.manifest` and never read (order comes from `agents[]`, lead = first),
  and `agents[].overrides` is declared and never read. No live divergence today
  because the published `installOrder` happens to match `agents[]` — an
  unenforced coupling. **Note this interacts with T2.3b's F4 finding** (a
  `team.json` shipping `"agents": []` would commit a witness with zero agents).

---

## T2.5 — Protected origins (D23)

**Do this BEFORE T2.4** so Steward is protected the moment it becomes marketplace-managed.

**Why:** whether an agent is essential to AoA is an **AoA fact, not catalog metadata** — so the protection lives server-side, needs no schema bump, and is enforced where it matters.

**Files:** `server/src/services/marketplace-install/team-uninstaller.ts`, the agent-uninstall path, a new shared const.

> **⚠️ Blocker found during T2.2 review (2026-07-24) — read before Step 1.**
> This task is specified as a protected-origin set **keyed on `templateOrigin`**,
> but **Steward has no `templateOrigin` and never will get one.**
> `backfill-template-origin.ts:39-49` `CREW_NAMES` lists Commander, Adjutant,
> Scout, Engineer, Navigator, Planner, Dispatcher, Memory Keeper, Librarian —
> **Steward and Chronicler are absent**, so their rows keep `templateOrigin =
> NULL` permanently. Verified directly: no seeder writes `templateOrigin`; the
> backfill is its only writer.
>
> That NULL is *load-bearing elsewhere* — it is precisely why running
> `ensureInfrastructureAgents` before the marketplace gate can't flip the gate
> to "managed" (the predicate requires `templateOrigin IS NOT NULL`). So do
> **not** casually add Steward to `CREW_NAMES`: stamping it `…@legacy` is
> harmless to the gate, but stamping it anything non-`@legacy` would make every
> company self-report as marketplace-managed and suppress the entire crew.
>
> Decide deliberately in Step 1 between: (a) key the protected set on the
> agent's **name/role** rather than origin (origin-independent, works today,
> survives T2.4 publishing Steward), or (b) add Steward + Chronicler to
> `CREW_NAMES` with an explicit `@legacy` suffix and key on origin. **(a) is
> the recommendation** — protection is an AoA fact about the agent, and this
> task's own "Why" says exactly that.

- [ ] **Step 1: Failing tests** — uninstalling a **protected** origin (Commander, Steward) returns a clear refusal; uninstalling **any other** marketplace agent still succeeds (the discriminator — proves the guard isn't blanket). Include a case for a **protected agent whose `templateOrigin` is NULL** (Steward today) — a set keyed only on origin would silently fail to protect it.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** a server-side protected-origin set + refusal. **Step 4: Run → PASS.** **Step 5: Commit.**
```bash
git commit -m "feat(marketplace): refuse uninstall of protected AoA agent origins (D23)"
```

---

## T2.4 — Author + publish the missing catalog content (P13b, D18, D20)

⚠️ **This task touches TWO EXTERNAL REPOS and publishes publicly. STOP and confirm with the product owner before opening either PR.** (Write access confirmed; PRs pre-authorised in principle — still confirm at the moment of publishing.)

**Repos:** `MeteoriteLabs/aoa-marketplace` (source: `content/agents/`, `content/teams/default-crew/`) and `MeteoriteLabs/aoa-marketplace-cdn` (published `catalog.json`).

> **⚠️ Cross-repo blast radius, found during T2.3 (2026-07-24).** After T2.3,
> **an edit in the catalog repo can silently regress provisioning in this one.**
> Two specific couplings to check in Step 6's dependency audit — not optional:
> 1. **Adding a plugin dependency to `default-crew` breaks company creation's
>    marketplace path.** The bootstrap plugin installer throws by design; the
>    team has no plugin deps today, so it is unreachable — the moment one is
>    added, the whole install fails and every new company silently degrades to
>    the legacy `@legacy` roster. Fail-closed and logged, but the *symptom*
>    appears in AoA while the *cause* is a merge in the other repo.
> 2. **Publishing Steward must be paired with reconciling the pre-existing
>    legacy Steward row**, or companies created between T2.3 and T2.4 end up
>    with **two** Steward agents (both carrying the `sweep` trigger → duplicated
>    hub curation). `team-reconcile.ts:96-107` builds `installedOrigins` from a
>    join on `teamMembers`, so a legacy Steward fails the lookup twice over —
>    it is neither a team member nor origin-stamped, making the duplicate
>    install unavoidable rather than merely likely. Chronicler has the identical
>    NULL-origin gap. See the T2.5 blocker note for why that NULL must not
>    simply be stamped non-`@legacy`.

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
