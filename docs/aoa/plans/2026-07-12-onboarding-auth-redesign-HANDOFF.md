# Onboarding & Auth Redesign — Session Handoff

> **Purpose:** resume this initiative in a fresh session with zero re-derivation. Read this first, then the authority docs in §7.

---

## 1. TL;DR — where we are

Phase 1 (Stages A–D) of the Google-only auth + modular resumable onboarding redesign.

- **Branch:** `feat/onboarding-auth-redesign` — **29 commits ahead of `main`.**
- **Worktree:** `C:/Users/TK/.aoa/wt/onboarding-auth-redesign` (short path — OneDrive MAX_PATH; `core.longpaths=true`).
- **Green:** server suite **7433** tests, UI suite **3142** tests, both typechecks clean.
- **Done:** all planning (4 Codex passes → revA/B/C), **Stage A** (auth), **Stage B** (state-machine engine), **Stage C foundation + 1 of 7 steps**.
- **Remaining:** Stage C steps 2–7 + wizard deletion + Lobby replay, then all of **Stage D**, plus **A12** e2e. ~15–20 tasks.

---

## 2. Get set up (fresh session)

```bash
cd "C:/Users/TK/.aoa/wt/onboarding-auth-redesign"     # already exists; git worktree
pnpm install                                          # if node_modules missing
pnpm --filter @armyofagents/plugin-sdk build          # fixes plugin-sdk module-not-found baseline
pnpm --filter @armyofagents/shared build              # if you edit packages/shared
```

**Commands (verified):**
- Single test file: `pnpm test:run <path-substring>` (root vitest; server has NO package `test` script). Do NOT use `|` in the filter — it fails across projects; run separately.
- UI single file: `pnpm --filter @armyofagents/ui test:run <path>`.
- Typecheck: `pnpm --filter @armyofagents/server typecheck` / `pnpm --filter @armyofagents/ui typecheck`.
- Full server suite (~45s): `pnpm test:run server/src`. Full UI suite (~65s): `pnpm --filter @armyofagents/ui test:run`.
- DB schema change: edit `packages/db/src/schema/*.ts` → `pnpm db:generate` (rebuilds db + SQL migration + updates `meta/_journal.json` + snapshot — **commit all**).

**Discipline:** TDD each task (write failing test → verify red → minimal impl → verify green → commit). Run the full server suite after any change to `app.ts`, `index.ts`, `config.ts`, or `middleware/auth.ts`.

---

## 3. What's complete (commit map)

**Stage A (auth) — done except A12 e2e:**
`56715b5c3` A1 config · `5ab8803ff` A2 Google provider + R6 · `307731e8f` A6 identity gating · `0ec2f9a65` RB4/R5/R6 startup wiring + escape-hatch guard · `2705a39cf` RB3/A7 first-admin hook · `6b22976d5` A3 route removal · `c0b2878ea` A4 journey resolver · `615764b93` A5 journey endpoint · `c3551e701` A8 Google screen · `8ea39c1ab` A9 post-auth routing · `4382fdca9` A11 long session · `1174ce9d0` A10 board-claim retire

**Stage B (engine) — done:**
`e3ebc4c0b` B1 table+migration · `99f67058c` B2 state enums · `236904dfd` B3 advance service · `ba7d7d13c` B4 progress route · `40a0470ce` B5 registry · `70255ef29` B6 FlowEngine · `b47a665ee` B7 wiring + gate redirect

**Stage C — foundation + 1 step:**
`58ee1410c` foundation (engine read-only + org-layer seed) · `7872d6854` C1 user_profiles · `4d02e8f1d` C3 profile step (proves the pattern)

---

## 4. THE PROVEN STEP RECIPE (repeat for each remaining step)

The profile step (`ui/src/onboarding/steps/ProfileStep.tsx`) is the template. Each remaining step:

1. **Component** `ui/src/onboarding/steps/<X>Step.tsx` — a form/card that on submit:
   - does its data write via the **existing** API (`companiesApi.create`, `environmentsApi`, `internalAgentApi.updateConfig`, `projectsApi.create` + `assignAgent`, `agentsApi.create`, `agentsApi.testEnvironment`),
   - `await advanceOnboarding({ companyId: ctx.companyId, journey: ctx.journey, requestedState: "<STATE>" })` (from `ui/src/api/onboarding.ts`),
   - `onComplete()`.
2. **Register** a `StepDefinition` in `ui/src/onboarding/steps/index.ts` `ONBOARDING_STEPS`:
   `{ id, order, state:"<STATE>", journeys:["founder"], dependsOn:["<prev state>"], canSkip, shouldInclude:()=>true, isComplete:(ctx)=>ctx.completedStates.includes("<STATE>"), Component, title }`.
3. **RTL test** (mock the data API + `advanceOnboarding`), asserting write → advance(state) → onComplete. Confirm `validateRegistry(ONBOARDING_STEPS)` stays `[]`.

The engine (`FlowEngine.tsx`) is READ-only: it resolves the next step, and `onComplete` just re-reads progress. Steps own their advance.

---

## 5. Remaining Stage C steps (orders 2–7)

| Order | State | Step does | Notes |
|---|---|---|---|
| 2 | `ORGANIZATION_CREATED` | `companiesApi.create({name})` → **`setSelectedCompanyId(new.id)`** → `advanceOnboarding({companyId:new.id,...})` | **RB1 handshake:** the `setSelectedCompanyId` prop-change reloads the FlowEngine to the org layer. Advance targets the NEW companyId. Drop the mission field (name only). `ensureProgress` already seeds the org-layer from the user-layer (foundation commit) so the `PROFILE_SET` dep passes. |
| 3 | `ENVIRONMENT_READY` | create `environments` row (`driver:"local"`) + set `companies.rootFolder`; run `probeEnvironmentConfig` | **BLOCKING** on probe fail (revC R13): onboarding route must require a real path + read/create/delete checks — the generic probe's `ok:true` at `environment-probe.ts:75` is NOT the gate. |
| 4 | `COMMANDER_SELECTED` | `internalAgentApi.updateConfig` (cliTool/provider) | Claude/Codex cards; no model internals. |
| 5 | `COMMANDER_VERIFIED` | `agentsApi.testEnvironment` → parse `checks[]`; in-UI install/auth help | **BLOCKING** on `status:"fail"` (T-ProbeBlocking). **Net-new:** a company/Commander-scoped **Codex login route** (Claude's `claude-login` needs an existing agent; both must be pre-agent, revC RB8/R14). |
| 6 | `DEPARTMENT_CREATED` | add `sales` to a shared `DEPARTMENT_FUNCTION_TYPES` (consumed by `NewProjectDialog.tsx` + the step) → `projectsApi.create` type=department + workspace | revC D8. Local folder default (nested under root) or GitHub picker. |
| 7 | `AGENT_ASSIGNED` | `agentsApi.create` + `projectsApi.assignAgent` **at creation** + inherit Commander runtime | Fix the gap where onboarding agent wasn't dept-assigned. Advanced settings collapsed. |
| — | `SETUP_COMPLETE` | Review summary + "Start walkthrough"(Phase 2)/"Go to dashboard" | Order 8. |

**After the steps:** delete `ui/src/components/OnboardingWizard.tsx` + `OnboardingWizardMount` in `App.tsx`; repoint `openOnboarding`/Lobby "create org" → `navigate("/onboarding")` (**B8** org-replay — now non-looping since org steps exist).

---

## 6. Stage D (not started)

- **Invited journey (minimal):** a `JoinOrg` step for the invited journey; reuse `access.ts` accept flow. Progress: `AUTHENTICATED → PROFILE_SET → JOIN_REQUESTED → SETUP_COMPLETE` (approval-gated). **Amend the approval transaction** (`server/src/routes/access.ts` ~:2419) to advance the invited progress to `SETUP_COMPLETE` after `ensureMembership` + `applyInviteRole` + role verify (revC RC2). `parseInviteRoleMetadata` is private — export it.
- **Invite-token handoff (RB6/RC3):** new `onboarding_invite_handoffs` table (nonce, hashed token, bound_user_id, expires_at, consumed_at). Carry the nonce through OAuth via better-auth `additionalData`; consume atomically `WHERE nonce=? AND bound_user_id=:currentUser AND consumed_at IS NULL AND expires_at>now()`.
- **Security tests:** OAuth `state`/PKCE (real better-auth flow), cookie flags, escape-hatch refused in hosted + on populated instance, no secrets in logs/URLs.
- **A12 e2e (also outstanding from Stage A):** mocked-Google Playwright specs (founder happy path, resume, invited join, 2nd-org-skips-user-layer). Runs on **CI/Linux only** (Windows e2e skipped). The harness MUST set `AOA_DEV_LOCAL_IDENTITY=1` (local_trusted now requires Google creds or the escape hatch).

---

## 7. Authority docs (read in this order)

All in `docs/aoa/plans/2026-07-12-onboarding-auth-redesign-*`:
1. `revC-final-gate.md` — **top authority** (RC1 advance, invited approval-txn completion, token handoff)
2. `revB-rereview-fixes.md` — amended contracts (onboarding_progress version+indexes, JOIN_REQUESTED, pendingInvitations, StepDefinition order/shouldInclude) + Commander-auth §
3. `revA-codex-fixes.md` — R1–R16
4. `stage0-contracts.md` — shared contracts + **verified commands** + file map
5. `scope.md` — design/decisions; `stageA/B/C/D-*.md` — per-stage task plans

Authority order: **revC > revB > revA > stage docs**.

---

## 8. Key gotchas
- `local_trusted` now requires Google creds OR `AOA_DEV_LOCAL_IDENTITY=1` (escape hatch). `AOA_DEV_LOCAL_IDENTITY_FORCE=1` overrides the populated-instance refusal.
- Raw `sed -i` mangles emoji on Windows Git Bash → use **python** for bulk doc edits. `grep -c $'\x00'` in bash = empty pattern = counts ALL lines (false positive).
- `company_user_profiles` is NOT on `main` (only a parallel branch) — Phase 1 uses global `user_profiles` only (revC R10). Don't seed the per-company mirror.
- Codex CLI needed upgrade to 0.144.1 (ChatGPT-account only supports the new default model). Run reviews via `codex exec -C <worktree> -s read-only`, background + medium effort (foreground 9.5-min cap is too short).
- The full onboarding walkthrough (sample-portfolio demo) is **Phase 2** — out of scope here; depends on the Assist-mode "no real tasks before approval" fix.
