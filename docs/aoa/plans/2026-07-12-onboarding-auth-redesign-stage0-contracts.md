# Onboarding & Auth Redesign — Stage 0: Contracts & File Map

> **For agentic workers:** This is the FOUNDATION document for the Phase 1 plan set (Stages A–D). It locks the shared types, tables, interfaces, file structure, and conventions so the stages cannot drift. Read this before executing any stage plan. It contains **no executable tasks** — it is the contract every later task references.

**Goal:** Lock cross-stage contracts (DB tables, shared types, the onboarding state machine, the step-registry interface, the escape-hatch flag, the taxonomy source-of-truth) and the file map, so Stages A–D compose without type drift.

**Source spec:** `docs/aoa/plans/2026-07-12-onboarding-auth-redesign-scope.md`

**Tech stack:** TypeScript (ESM), Drizzle ORM (Postgres), Express 5, better-auth, React + Vite + Tailwind v4, Vitest, Playwright. Package manager: **pnpm**. Monorepo: `packages/db`, `packages/shared`, `server`, `ui`.

---

## 1. Stage sequence & dependencies

```
Stage 0 (this doc — contracts, no code)
   │
Stage A — Auth & Identity ─────────────► ships: Google-only login + 3-journey router + escape hatch + first-user-admin
   │  (provides: post-auth journey resolver, actor changes, GOOGLE_* config)
Stage B — Onboarding state machine + registry ─► ships: resumable flow engine + two-layer split + Lobby replay
   │  (provides: onboarding_progress table, OnboardingState, StepDefinition, flow engine, resume API)
Stage C — Workspace-setup steps ─────────► ships: full founder happy path (profile→…→agent→review)
   │  (provides: user_profiles table, the 8 step UIs + server writes, Commander install help, taxonomy)
Stage D — Invited routing + hardening ───► ships: minimal invited join + security/e2e pass
```

**Hard rule:** A stage may only depend on contracts defined in this doc or in an earlier stage. No forward references.

---

## 2. New database tables (Drizzle — `packages/db/src/schema/`)

> Per CLAUDE.md Critical Rule #1: schema changes go in `packages/db/src/schema/`, then `pnpm db:generate`. NEVER hand-write SQL migrations. Every new schema file must be exported from `packages/db/src/schema/index.ts` and re-exported by `packages/db/src/index.ts` (follow the pattern of an existing schema file, e.g. `environments.ts`).

### 2.1 `user_profiles` (Stage C creates; global per-human identity)

File: `packages/db/src/schema/user_profiles.ts`

```ts
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type UserProfileSocialLink = {
  type: string;        // "linkedin" | "github" | "x" | "website" | "other"
  label: string | null;
  url: string;
};

export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),          // better-auth user.id (text)
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  title: text("title"),
  bio: text("bio"),
  socialLinks: jsonb("social_links").$type<UserProfileSocialLink[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Note: `userId` is `text` to match `authUsers.id` (better-auth uses text ids). No FK to `authUsers` (better-auth tables are managed separately; match the existing convention in `company_user_profiles.ts`, which also stores `userId` as `text` with no FK).

### 2.2 `onboarding_progress` (Stage B creates; resumable state machine)

File: `packages/db/src/schema/onboarding_progress.ts`

```ts
import { jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const onboardingProgress = pgTable(
  "onboarding_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),                 // better-auth user.id
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }), // null for user-layer-only progress
    journey: text("journey").notNull(),                // "founder" | "invited"
    currentState: text("current_state").notNull(),     // OnboardingState value
    completedStates: jsonb("completed_states").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCompanyUq: uniqueIndex("onboarding_progress_user_company_uq").on(table.userId, table.companyId),
  }),
);
```

Resume semantics: exactly one row per `(userId, companyId)`. The user-layer row has `companyId = null` (the unique index treats null distinctly per Postgres — acceptable because there is at most one user-layer progress row per user; enforce single-row in service code by upsert-on-conflict against `(userId)` where `companyId is null`). Org-layer rows carry a real `companyId`.

---

## 3. Shared types & enums (`packages/shared/src/`)

> All values below are the single source of truth. Stages import from `@armyofagents/shared`. Do NOT redefine locally.

### 3.1 Onboarding states — `packages/shared/src/constants.ts` (append)

```ts
export const ONBOARDING_STATES = [
  "AUTHENTICATED",
  "PROFILE_SET",
  "ORGANIZATION_CREATED",
  "ENVIRONMENT_READY",
  "COMMANDER_SELECTED",
  "COMMANDER_VERIFIED",
  "DEPARTMENT_CREATED",
  "AGENT_ASSIGNED",
  "SETUP_COMPLETE",
  // Phase 2 (reserved — not implemented in Phase 1):
  "WALKTHROUGH_STARTED",
  "DISCUSSION_ANALYZED",
  "CLARIFICATIONS_RESOLVED",
  "SCOPE_CREATED",
  "SCOPE_APPROVED",
  "MEMORY_SAVED",
  "TASKS_CREATED",
  "AGENT_EXECUTION_STARTED",
  "ONBOARDING_COMPLETE",
] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const ONBOARDING_JOURNEYS = ["founder", "invited"] as const;
export type OnboardingJourney = (typeof ONBOARDING_JOURNEYS)[number];

// The ordered founder-journey states Phase 1 actually drives:
export const FOUNDER_PHASE1_STATES: OnboardingState[] = [
  "AUTHENTICATED",
  "PROFILE_SET",
  "ORGANIZATION_CREATED",
  "ENVIRONMENT_READY",
  "COMMANDER_SELECTED",
  "COMMANDER_VERIFIED",
  "DEPARTMENT_CREATED",
  "AGENT_ASSIGNED",
  "SETUP_COMPLETE",
];
```

### 3.2 Post-auth journey result — `packages/shared/src/onboarding.ts` (new file)

```ts
import type { OnboardingJourney } from "./constants.js";

export type PostAuthJourneyResult = {
  journey: OnboardingJourney | "returning";
  // For "invited": the company to join. For "returning": the company to land on. Null for "founder".
  targetCompanyId: string | null;
  inviteToken?: string | null;
};
```

### 3.3 Department taxonomy — single source of truth — `packages/shared/src/constants.ts` (append)

> Stage C consolidates the currently-duplicated `FUNCTION_TYPES` (hardcoded in `ui/src/components/NewProjectDialog.tsx` ~line 50) into this shared list; both onboarding and `NewProjectDialog` consume it.

```ts
export const DEPARTMENT_FUNCTION_TYPES = [
  { value: "software_development", label: "Product (Software)", icon: "💻" },
  { value: "marketing",           label: "Marketing",          icon: "📢" },
  { value: "sales",               label: "Sales",              icon: "🤝" }, // NEW
  { value: "support",             label: "Customer Support",   icon: "🎧" }, // relabeled
  { value: "finance",             label: "Finance",            icon: "💰" },
  { value: "hr",                  label: "HR",                 icon: "👥" },
  { value: "legal",               label: "Legal",              icon: "⚖️" },
  { value: "research",            label: "Research",           icon: "🔬" },
  { value: "operations",          label: "Operations",         icon: "📊" },
  { value: "general",             label: "General",            icon: "📋" },
  { value: "custom",              label: "Custom",             icon: "⚙️" },
] as const;
export type DepartmentFunctionType = (typeof DEPARTMENT_FUNCTION_TYPES)[number]["value"];
```

The `software_development` value is unchanged — it remains the workspace-tooling gate (`functionType === "software_development"`). `sales` is additive and maps to no special workspace tooling (behaves like the other non-software types).

---

## 4. The step-registry interface (Stage B defines; Stage C populates)

File: `ui/src/onboarding/registry.ts` (new)

```ts
import type { OnboardingState, OnboardingJourney } from "@armyofagents/shared";

export type StepContext = {
  userId: string;
  companyId: string | null;
  journey: OnboardingJourney;
  completedStates: OnboardingState[];
};

export type StepDefinition = {
  id: string;                                  // stable slug, e.g. "profile"
  state: OnboardingState;                       // completion state this step satisfies
  journeys: OnboardingJourney[];                // which journeys include this step
  dependsOn: OnboardingState[];                 // prior states required before this step is reachable
  canSkip: boolean;
  // Predicate over server state — true means "already done", engine advances past it (idempotent re-entry):
  isComplete: (ctx: StepContext) => boolean;
  // Lazy component for the step body:
  Component: React.LazyExoticComponent<React.ComponentType<StepProps>>;
  title: string;
};

export type StepProps = {
  ctx: StepContext;
  onComplete: () => void;   // called after the step's server write succeeds; engine persists state + advances
  onBack: () => void;
};
```

**Flow engine contract (Stage B):** `resolveNextStep(registry, ctx)` returns the first `StepDefinition` whose `journeys` includes `ctx.journey`, whose `dependsOn` ⊆ `ctx.completedStates`, and whose `isComplete(ctx)` is false. When none remain → the journey is complete.

---

## 5. Escape-hatch & identity flags (Stage A owns)

- Env flag: `AOA_DEV_LOCAL_IDENTITY` — when truthy AND `deploymentMode === "local_trusted"`, `actorMiddleware` produces the synthetic loopback admin (today's behavior). In any other mode the flag is **ignored and a WARN is logged** (fail-closed).
- Config field (append to `Config` in `server/src/config.ts`): `devLocalIdentity: boolean` (resolved from `AOA_DEV_LOCAL_IDENTITY`, default `false`).
- Config fields for Google (append): `googleClientId: string | null`, `googleClientSecret: string | null` (from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, default `null`).
- **Default identity change:** `actorMiddleware`'s default actor is NO LONGER an auto-admin in `local_trusted`. New default: `{ type: "none", source: "none" }` unless `config.devLocalIdentity` is set (then the synthetic admin). The real identity comes from the resolved Google/persisted session in BOTH modes.

---

## 6. File map (created / modified across stages)

| Path | Stage | Responsibility |
|------|-------|----------------|
| `packages/db/src/schema/user_profiles.ts` | C | Global per-human profile |
| `packages/db/src/schema/onboarding_progress.ts` | B | Resumable state |
| `packages/shared/src/constants.ts` | A/B/C | ONBOARDING_STATES, JOURNEYS, DEPARTMENT_FUNCTION_TYPES |
| `packages/shared/src/onboarding.ts` | A | PostAuthJourneyResult |
| `server/src/auth/better-auth.ts` | A | Google provider; remove email/password; extract pure `buildBetterAuthConfig` |
| `server/src/config.ts` | A | GOOGLE_*, AOA_DEV_LOCAL_IDENTITY |
| `server/src/middleware/auth.ts` | A | Default-actor change; escape-hatch gating |
| `server/src/app.ts` | A | Remove email/password routes + limiters |
| `server/src/services/onboarding.ts` | B | onboarding_progress service (upsert/advance/resume) |
| `server/src/services/post-auth-journey.ts` | A | Pure journey resolver + server endpoint |
| `server/src/routes/onboarding.ts` | B | GET/PATCH onboarding progress; GET journey |
| `server/src/services/user-profiles.ts` | C | user_profiles CRUD + seed company_user_profiles |
| `server/src/services/commander-verify.ts` | C | Detect→verify Commander CLI (extends adapter probe) |
| `ui/src/pages/Auth.tsx` | A | Single "Continue with Google" |
| `ui/src/api/auth.ts` | A | signInSocial; remove email methods |
| `ui/src/onboarding/registry.ts` | B | StepDefinition registry |
| `ui/src/onboarding/FlowEngine.tsx` | B | Walks registry, persists, resumes |
| `ui/src/onboarding/steps/*.tsx` | C | The 8 step components |
| `ui/src/components/NewProjectDialog.tsx` | C | Consume shared DEPARTMENT_FUNCTION_TYPES |
| `ui/src/components/OnboardingWizard.tsx` | C | **Deleted** — replaced by FlowEngine + steps |

---

## 7. Testing conventions (all stages)

Per CLAUDE.md "Test Patterns":
- **Pure-function tests** — import and test directly (journey resolver, `resolveNextStep`, state reducers, profile→company-profile seed mapper). No DB.
- **Service tests with mocks** — mock `@armyofagents/db` + `drizzle-orm` with Proxy table stubs + `createSequenceDb` sequence mocks (see existing `server/src/__tests__/*.test.ts`).
- **Contract tests** — assert API shapes/constants/enums without importing drizzle internals (e.g. DEPARTMENT_FUNCTION_TYPES contains `sales`; better-auth config has google + no emailAndPassword).
- **E2E** — Playwright under `tests/e2e/`. Google is mocked via a deterministic test IdP / stubbed session (Stage A defines the harness). Windows e2e caveats per CLAUDE.md still apply (embedded-pg skip).
- **Commit discipline:** one commit per task (test+impl together), conventional-commit messages. End messages with the Co-Authored-By trailer only if the user's git config expects it (follow repo convention — recent history uses plain conventional commits).

Run commands (from repo root):
- Type/lint/build gate: `pnpm verify` (or the package-scoped script the repo uses — confirm in `package.json`).
- Server unit tests: `pnpm --filter @armyofagents/server test` (confirm filter name in `server/package.json`).
- A single test file: `pnpm --filter @armyofagents/server test -- src/__tests__/<file>.test.ts`.
- DB migration generate: `pnpm db:generate`.

> Task authors: verify the exact script names in the relevant `package.json` before writing the first test task of each stage (they are stable but confirm).

---

## 8. Non-negotiables carried from the spec

- Keep `account.password` column (do NOT drop).
- No hosted-API keys beyond embeddings (CLAUDE.md Rule #11) — Commander verify uses local CLI detection only.
- `local_trusted` divergence points (D5/D6/D8) must survive — do not alter heartbeat clamps, hire-approval defaults, or planning-mode gates.
- Every server write in the onboarding steps is idempotent + blocking-on-failure where the spec says so (environment probe, commander verify).
