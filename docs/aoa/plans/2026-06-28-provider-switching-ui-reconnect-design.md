# Provider-Switching UI Reconnect — Design

> **Status:** Design (awaiting review) · **Date:** 2026-06-28
> **Branch:** `feat/provider-ui-reconnect` (off `origin/main` @ `ba4ef5228`)
> **Worktree:** `C:/Users/TK/.aoa/wt/ps-reconnect`
> **Builds on:** PRs #221 + #224 (provider-switching engine, merged to main) — see
> `[[provider-switching-org-pr224]]`, `[[codex-findings-resolution]]`.

---

## 1. Problem

The provider-switching **engine** is correct and merged, but it is **unreachable
through any UI flow**. Empirically proven twice on an isolated instance:

- Onboard as **OpenAI** → `internal_agent_config.provider` stays `"anthropic"` →
  crew seeds as **8× `claude_local`** (not codex). The OpenAI pick had no effect.
- Settings → change **CLI Tool** → `internal_agent_config.cliTool` updates, but
  `provider` is never written → crew unchanged.

### Root cause — a three-field disconnect (all code-verified on `origin/main`)

| Field | Who reads it (live) | Who writes it (UI) |
|---|---|---|
| `internal_agent_config.provider` | `resolveCrewAdapterForCompany` → the **crew** adapter (`resolve-crew-adapter.ts:104`). **Sole live reader.** | **nobody** — defaults to `"anthropic"` forever |
| `internal_agent_config.cliTool` | `cli-mode.ts` → **Commander** chat dispatch | Settings only (`CommanderSection.saveExecution`); **not onboarding** |
| `companies.{commander,crew}_adapter_config` | **nobody** — 0 read refs in `server/` (verified). The "Task D6" reader was never built. | Onboarding writes both (`OnboardingWizard.handleStep4Next`) |

So onboarding's provider picks land in **dead columns**, and Settings has **no
crew-provider control at all**. The crew is permanently `claude_local`.

### Secondary defects found while mapping this

1. **Enum fracture** — `AGENT_PROVIDERS = ["anthropic","openai","google"]`
   (`constants.ts:931`) omits `"opencode"`, but onboarding offers it and
   `resolveCrewAdapterFor` handles it. The config PATCH validator
   (`internal-agent.ts:62` + `validators/internal-agent.ts:12`) would **reject**
   `provider:"opencode"`.
2. **Gemini-for-Commander is impossible** — `cli-mode.ts` has no gemini branch,
   yet onboarding's Commander picker offers Google.
3. **Cost mislabel** — `rateModelForCliTool` (`run-cost.ts:32`) has no `opencode`
   case → opencode runs priced as Anthropic via the default branch.
4. **Model picks unwired** — onboarding's free-form `commanderModel` / `crewModel`
   inputs are ignored; `resolveCrewAdapterFor` pins a hardcoded per-provider model
   and the Commander model is honored only on the codex path.

---

## 2. Goal

Make the Commander and Crew provider **and model** picks — at onboarding and in
Settings — actually take effect, and reconcile the enum/cost fractures. After this
change, picking "OpenAI / Codex" (or "Google / Gemini" for the crew) produces a
crew/Commander that genuinely runs on that CLI with the chosen model.

---

## 3. The model (decided direction)

Two genuinely-independent execution surfaces, each with its own live field as the
**single source of truth**. `internal_agent_config` is authoritative (the engine
already reads it); the `companies.*_adapter_config` columns are deprecated no-ops.

| Surface | SoT field | Provider options | Model field |
|---|---|---|---|
| **Commander** (chat) | `internal_agent_config.cliTool` | anthropic / openai / opencode (**no google**) | `internal_agent_config.model` |
| **Crew** (8 AoA agents) | `internal_agent_config.provider` | anthropic / openai / google / opencode | `internal_agent_config.crewModel` (**new**) |

### Locked decisions (from design review)

- **D1 — Two independent picks.** Commander and Crew can differ (e.g. Commander on
  Claude for chat quality, Crew on Codex for cheap bulk runs). Honor the existing
  two-pick onboarding UI.
- **D2 — Exclude Google from the Commander picker.** `cli-mode.ts` has no gemini
  chat path; building one is out of scope. Google stays a **crew-only** option
  (`gemini_local` works headless). The two pickers therefore have different option
  sets — an honest reflection of a real capability difference.
- **D3 — Honor model picks too.** Thread the free-form model strings through, with
  per-provider validation (reusing `codex-model.ts` validators). There are **no
  stale dropdowns to replace** — `AGENT_MODELS_BY_PROVIDER` is dead/unused (only
  re-exported; referenced solely by an archived doc); onboarding model fields are
  free-form `<input>`s.
- **D4 — Deprecate the dead columns in place.** No migration. Stop writing
  `companies.{commander,crew}_adapter_config`; mark them `@deprecated` in the
  schema, kept for rollback safety (AoA's established pattern).

---

## 4. Centralized provider mapping

Today the mappings are scattered: `providerToAdapter` is **local** to
`OnboardingWizard.tsx`; `resolveCrewAdapterFor` lives server-side; there is **no**
`provider → cliTool` map anywhere. Create one shared module so UI and server agree.

**New: `packages/shared/src/provider-mapping.ts`**

```ts
// The single axis of "AI providers" AoA supports for its internal agents.
export const CREW_PROVIDERS = ["anthropic", "openai", "google", "opencode"] as const;
export type CrewProvider = (typeof CREW_PROVIDERS)[number];

// Providers that have a real Commander chat CLI path (cli-mode.ts). No google.
export const COMMANDER_PROVIDERS = ["anthropic", "openai", "opencode"] as const;
export type CommanderProvider = (typeof COMMANDER_PROVIDERS)[number];

// provider → Commander cliTool (internal_agent_config.cliTool).
export function providerToCliTool(p: CommanderProvider): "claude_cli" | "codex" | "opencode" {
  switch (p) {
    case "anthropic": return "claude_cli";
    case "openai":    return "codex";
    case "opencode":  return "opencode";
  }
}

// provider → crew adapterType (mirrors resolveCrewAdapterFor's adapter choice).
export function providerToCrewAdapter(p: CrewProvider): "claude_local" | "codex_local" | "gemini_local" | "opencode_local" {
  switch (p) {
    case "anthropic": return "claude_local";
    case "openai":    return "codex_local";
    case "google":    return "gemini_local";
    case "opencode":  return "opencode_local";
  }
}
```

- `AGENT_PROVIDERS` gains `"opencode"` → `["anthropic","openai","google","opencode"]`
  (kept as the validator source for `internal_agent_config.provider`).
- `OnboardingWizard`'s local `providerToAdapter` is replaced by the shared
  `providerToCrewAdapter`; the local `Provider` type → shared `CrewProvider`.
- `resolveCrewAdapterFor` (server) stays the runtime authority for the resolved
  `{adapterType, adapterConfig}`; `providerToCrewAdapter` is the lightweight
  UI/label map. They must agree (covered by a test asserting parity).

---

## 5. Component changes

### 5.1 Onboarding — write the live fields (`OnboardingWizard.tsx`)

- **Commander picker (step 3):** options from `COMMANDER_PROVIDERS` (drops Google).
- **Crew picker (step 4):** options from `CREW_PROVIDERS` (all 4).
- After `companiesApi.create(...)` succeeds, PATCH the new company's config
  (reusing the Settings path — see §5.3) with:
  ```ts
  { cliTool: providerToCliTool(commanderProvider),
    model: commanderModel.trim() || null,
    provider: crewProvider,
    crewModel: crewModel.trim() || null }
  ```
  The PATCH's re-ensure (§5.4) migrates the just-seeded crew to the chosen adapter.
- **Stop sending** `commanderAdapterConfig` / `crewAdapterConfig` on
  `companiesApi.create`. (The `companies.ts` create handler still seeds the crew at
  default `anthropic`; the follow-up PATCH switches it — see §6 sequencing.)
- Update the two test premises in `OnboardingWizard.test.tsx` (currently assert the
  dead-column POST shape) to assert the new config PATCH instead.

> **Why PATCH-after-create (not thread into company-create):** reuses the single
> Settings write+re-ensure path (one code path to test), and keeps company-create
> unchanged. Cost: the crew is seeded once at default then rewritten once — cheap
> and idempotent (`shouldRewriteCrewAdapter` + `mergeCrewAdapterConfig`).

### 5.2 Settings — add a Crew control (`CommanderSection.tsx`, Execution & Model tab)

- Keep the existing **CLI Tool** select (writes `cliTool`) — this is **Commander**.
  Add an optional **Commander model** text field (writes `model`).
- Add a **Crew provider** select (`CREW_PROVIDERS`) + **Crew model** text field,
  clearly labelled as governing the AoA crew agents. `saveExecution()` extends to:
  ```ts
  { executionMode: "cli", cliTool, model: commanderModel || null,
    provider: crewProvider, crewModel: crewModel || null,
    runtimeApprovalsEnabled, runtimeAllowAlwaysEnabled, vendorCliBypassEnabled }
  ```
- Hydrate the new fields from `config` in the existing `useEffect` sync.

### 5.3 Validators + API types

- `validators/internal-agent.ts` `updateInternalAgentConfigSchema`: `provider`
  already `z.enum(AGENT_PROVIDERS)` → automatically gains `opencode`; add
  `crewModel: z.string().nullable().optional()`.
- The **inline** enum at `routes/internal-agent.ts:62` must be replaced with the
  shared `AGENT_PROVIDERS` (or extended to include `opencode`) so the two
  validators can't drift again.
- `ui/src/api/internal-agent.ts`: extend `UpdateInternalAgentConfig` /
  `InternalAgentConfig` with `provider`, `crewModel`.

### 5.4 Server — single crew-bootstrap entrypoint + re-ensure on change

The crew-bootstrap sequence (`ensureCommandStaff`, `ensureAdjutant`,
`ensureChronicler`, `ensureScout`, `ensureEngineer`, `ensureCommanderAgent`) is
**duplicated** in `index.ts` (boot loop ~740-755) and `companies.ts` (create
~150-190). Extract it:

**New: `ensureAllCrewAgents(db, companyId)`** in
`server/src/services/internal-agent/aoa-agents/` — runs the full sequence (same
error-tolerant `.catch` semantics). Call it from:
1. `index.ts` boot loop (replace the inline sequence).
2. `companies.ts` create path (replace the inline sequence).
3. **The config PATCH handler** (`internal-agent.ts:789`) — **after** persisting,
   **iff** `provider` (or `crewModel`) changed vs the prior row. This makes a
   provider switch take effect immediately rather than only on next server boot.

The actual row migration is already handled inside the ensure-*/seed-crew helpers
via `shouldRewriteCrewAdapter` + `mergeCrewAdapterConfig` (allowlist neutral keys +
scrub source-provider auth env on switch). **No change to that logic.**

> The PATCH handler currently does a blind `.set({ ...req.body, updatedAt })`. We
> read the prior `provider`/`crewModel` in the same handler (a `select` before the
> update), then conditionally call `ensureAllCrewAgents` after the update.

### 5.5 Crew model override (`resolve-crew-adapter.ts`)

- `resolveCrewAdapterForCompany` selects `provider` **and** `crewModel` from
  `internal_agent_config`.
- `resolveCrewAdapterFor(provider, modelOverride?)` gains an optional override. When
  present **and valid for that provider**, it replaces the hardcoded default model;
  otherwise the default stands. Per-provider validation:

  | provider / adapter | validator | fallback if invalid |
  |---|---|---|
  | anthropic / claude_local | `SAFE_MODEL_RE` | `claude-sonnet-4-5-20250929` |
  | openai / codex_local | `isCodexCompatibleModel` | `DEFAULT_CODEX_CHAT_MODEL` (`gpt-5.5`) |
  | google / gemini_local | `SAFE_MODEL_RE` | `gemini-2.5-pro` |
  | opencode / opencode_local | `isShellSafeModel` (slash form) | `openai/gpt-5.2-codex` |

  Validation reuses `codex-model.ts` exports — no new validators. Invalid overrides
  silently fall back (never break a run); the UI may surface a soft warning later.

### 5.6 Commander model honoring (`cli-mode.ts`)

- **codex:** already honored — `config.model` → `resolveCodexChatModel` → `--model`.
  Writing `model` (§5.1/§5.2) is sufficient.
- **claude_cli / opencode:** these branches pass **no** `--model` today (claude is
  "BYTE-UNCHANGED"; uses subscription default). To honor the pick, add a
  shell-safe (`SAFE_MODEL_RE` for claude; `isShellSafeModel` for opencode) `--model`
  argument **only when `config.model` is set and valid**, leaving the byte-identical
  default path intact when it is empty. This is the **highest-risk** edit (sensitive
  file) and is sequenced **last** with its own tests; if review judges the claude
  path too sensitive, this sub-item can defer without blocking §5.1-§5.5.

### 5.7 Cost label (`run-cost.ts`)

- Add `case "opencode": return { provider: "openai", model: "gpt-5.2-codex" };`
  to `rateModelForCliTool` so opencode runs aren't priced at Claude rates.
  (`gemini` is unreachable for Commander, so no gemini case needed.)

### 5.8 Dead columns (`packages/db/src/schema/companies.ts`)

- Add `@deprecated never read; superseded by internal_agent_config` to
  `commanderAdapterConfig` / `crewAdapterConfig`. No migration. Onboarding stops
  writing them (§5.1). The company validator schemas stay (rollback-safe) but the
  fields become optional/unused.
- Fix the stale comment on `internal_agent.ts:37` (`provider` "dormant / not read"
  is now **false** — it is the crew SoT) and on `companies.ts:24-28` (the phantom
  D6 reader claim).

---

## 6. Data flow

**Onboarding (OpenAI Commander + Google crew example):**
```
create company  → crew auto-seeds as claude_local (default provider)
  → PATCH config { cliTool: codex, model, provider: google, crewModel }
      → persist row
      → provider changed (anthropic→google) → ensureAllCrewAgents
          → each crew row: shouldRewriteCrewAdapter(claude_local → gemini_local)=true
          → mergeCrewAdapterConfig: keep neutral keys, scrub ANTHROPIC_* env, apply gemini
  → crew now gemini_local; Commander chat now codex
```

**Settings provider change (codex crew → opencode crew):**
```
saveExecution → PATCH { provider: opencode, crewModel } → persist
  → provider changed → ensureAllCrewAgents → rows rewritten codex_local → opencode_local
    (OPENAI_API_KEY preserved — opencode reads it; via ADAPTER_AUTH_ENV_KEYS keep-set)
```

**Settings model-only change (same provider):** `mergeAdapterConfig` (same-adapter
branch) preserves all founder config and overrides only `model`.

---

## 7. Error handling & edge cases

- **Stale crewModel across a provider switch.** A model valid for the old provider
  (e.g. a claude id) is invalid for the new one (codex) → §5.5 validation rejects it
  → per-provider default used. The UI sends provider+model together, so a deliberate
  switch normally carries a fresh model; the validation is the safety net.
- **`ensureAllCrewAgents` partial failure.** Same `.catch`-per-agent tolerance as
  boot/create (one failed crew seed doesn't fail the whole PATCH). PATCH still
  returns 200; failures are logged. (Matches existing boot semantics.)
- **Concurrency.** Two PATCHes racing → last-writer-wins on the row; each triggers
  its own ensure; ensure helpers are idempotent. No new locking needed.
- **`provider:"opencode"` previously rejected.** After §5.3 it validates; existing
  rows with `provider=null` still resolve to the openai/codex default (unchanged).
- **No regression for existing companies.** `provider` defaults stay; nothing
  rewrites a crew until a user actually changes the provider (or a boot re-ensure
  finds a genuinely broken row, as today).

---

## 8. Testing strategy

- **Unit (shared):** `providerToCliTool`, `providerToCrewAdapter`, parity test
  asserting `providerToCrewAdapter(p)` === `resolveCrewAdapterFor(p).adapterType`
  for all `CREW_PROVIDERS`.
- **Unit (server):** `resolveCrewAdapterFor(provider, override)` — valid override
  applied, invalid override → default, per provider. `rateModelForCliTool("opencode")`.
- **Unit (server):** `ensureAllCrewAgents` runs the full sequence; PATCH handler
  calls it iff provider/crewModel changed (mock the ensure, assert call/no-call).
- **Integration (real-DB):** onboarding-style create + config PATCH (openai, google,
  opencode) → assert every crew row's `adapter_type` matches `providerToCrewAdapter`
  and the model override (or default) is applied; assert source-provider auth env is
  scrubbed on a switch.
- **e2e (Playwright, Linux gate):** extend `provider-switching.spec.ts` —
  (a) onboard as OpenAI → assert crew adapter via API; (b) Settings change crew
  provider → assert re-ensure took effect. Reuse the fake-CLI fixtures.
- **UI:** `OnboardingWizard.test.tsx` (new PATCH premise) + a `CommanderSection`
  test for the new crew control writing `provider`/`crewModel`.

---

## 9. Out of scope / follow-ups

- A gemini **chat** path for Commander (would let Google drive Commander).
- Replacing/deleting the dead `AGENT_MODELS_BY_PROVIDER` constant (separate cleanup).
- Per-agent (org-agent) provider switching — already works via the agent row's own
  `adapterType`; unaffected here.
- Surfacing a UI warning when a model override is rejected as invalid.
- **Commander's agent-row adapter** is resolved from the crew `provider`
  (existing behavior via `ensureCommanderAgent` → `resolveCrewAdapterForCompany`).
  Its interactive **chat** correctly uses `cliTool`. So with Commander=Claude +
  Crew=Codex, Commander's *chat* runs claude_cli but its *non-chat* (proactive/
  heartbeat) runs would use the crew adapter. This pre-dates this change; whether
  Commander's non-chat runs should instead follow `cliTool` is a separate question
  and is **not** altered here (we keep `ensureCommanderAgent` in the bootstrap as
  today).

---

## 10. File-level change list

| File | Change |
|---|---|
| `packages/shared/src/provider-mapping.ts` | **new** — `CREW_PROVIDERS`, `COMMANDER_PROVIDERS`, `providerToCliTool`, `providerToCrewAdapter` |
| `packages/shared/src/constants.ts` | `AGENT_PROVIDERS` += `opencode`; note `AGENT_MODELS_BY_PROVIDER` unused |
| `packages/shared/src/validators/internal-agent.ts` | add `crewModel`; `provider` enum picks up opencode |
| `packages/shared/src/index.ts` | export the new mapping module |
| `packages/db/src/schema/internal_agent.ts` | **new col** `crewModel` (additive migration); fix stale `provider` comment |
| `packages/db/src/schema/companies.ts` | `@deprecated` comments on the two adapter-config cols |
| `server/src/routes/internal-agent.ts` | inline enum → shared `AGENT_PROVIDERS`; PATCH reads prior provider/crewModel, calls `ensureAllCrewAgents` on change |
| `server/src/services/internal-agent/aoa-agents/ensure-all-crew.ts` | **new** — `ensureAllCrewAgents(db, companyId)` |
| `server/src/services/internal-agent/aoa-agents/resolve-crew-adapter.ts` | `resolveCrewAdapterFor(provider, modelOverride?)`; `resolveCrewAdapterForCompany` selects `crewModel` |
| `server/src/services/internal-agent/cli-mode.ts` | claude_cli + opencode: shell-safe `--model` when `config.model` set (sequenced last) |
| `server/src/services/internal-agent/run-cost.ts` | `rateModelForCliTool` opencode case |
| `server/src/index.ts` · `server/src/services/companies.ts` | use `ensureAllCrewAgents` |
| `ui/src/components/OnboardingWizard.tsx` | shared mapping; Commander picker drops google; PATCH config after create; stop writing dead columns |
| `ui/src/components/settings/sections/CommanderSection.tsx` | crew provider + model controls; Commander model field; extend `saveExecution` |
| `ui/src/api/internal-agent.ts` · `ui/src/api/companies.ts` | type updates |
| `ui/src/components/__tests__/OnboardingWizard.test.tsx` | new PATCH premise |
| migration | `pnpm db:generate` for the additive `crew_model` column |
