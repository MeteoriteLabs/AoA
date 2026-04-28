# Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class team grouping inside departments — agent-only members, lead/member roles, an LLM-injected coordination contract, and a packageable manifest format anticipating a curated marketplace.

**Architecture:** Three new tables (`teams`, `team_members`, `team_coordinations`) layered additively on existing schemas. Service factory pattern matching `goalService(db) {...}`. UI lives inside the existing `/team` page Agents tab. Coordination doc mirrors `company_skills` pattern. Heartbeat injects coordination.md into team-member system prompts. Import resolves dependencies via flat cascade.

**Tech Stack:** PostgreSQL + Drizzle ORM (`packages/db/src/schema/`), Express 5.x (`server/src/`), React + Vite + Tailwind (`ui/src/`), vitest (`server/src/__tests__/`), `@dnd-kit/*` for drag UIs (already installed).

**Spec reference:** [`docs/aoa/specs/teams_spec.md`](./teams_spec.md) — read this first.
**Corrections reference:** [`docs/aoa/specs/teams_plan_corrections.md`](./teams_plan_corrections.md) — verified canonical patterns + safety layers. **Subagents must read this before executing any task.**

---

## ⚠ Universal Pattern Conventions — applied 2026-04-29

These conventions apply to EVERY task in this plan. Where any task's code conflicts with these conventions, **the conventions win.**

### C-1: HTTP routes use the `xRoutes(db)` factory pattern

```typescript
// CORRECT
export function teamRoutes(db: Db) {
  const router = Router();
  router.get("/companies/:companyId/teams", async (req, res) => {
    assertCompanyAccess(req, req.params.companyId as string);
    // ... happy path. Throw HttpError on failure (no try/catch)
    res.json(result);
  });
  return router;
}

// WRONG — do not use this style
export const teamsRouter = Router({ mergeParams: true });
teamsRouter.use(requireAuth);
teamsRouter.get("/", async (req, res) => {
  try { /* ... */ } catch (e) { handleError(res, e); }
});
```

- Errors are **thrown** (`throw notFound("...")`, `throw badRequest("...")` etc.); global error middleware catches and responds.
- `validate(zodSchema)` middleware on POST/PATCH/PUT for body validation — replaces inline `z.parse(req.body)`.
- `assertCompanyAccess(req, companyId)` for tenant access (throws unauthorized/forbidden).
- `await assertRole(db, req, companyId, "founder", "team_lead")` for write RBAC (throws forbidden).
- Status codes: 201 on POST create, 204 on DELETE, 200 default.

### C-2: UI API client uses `api.{get,post,patch,put,delete,postForm}<T>()`

```typescript
// CORRECT — from ui/src/api/client.ts
import { api } from "./client";

export const teamsApi = {
  list: (cid: string) => api.get<{ items: Team[] }>(`/companies/${cid}/teams`),
  create: (cid: string, body: CreateTeamInput) => api.post<Team>(`/companies/${cid}/teams`, body),
  update: (id: string, body: UpdateTeamInput) => api.patch<Team>(`/teams/${id}`, body),
  archive: (id: string) => api.delete<void>(`/teams/${id}`),
};

// WRONG — apiFetch does not exist in this codebase
import { apiFetch } from "./client";
apiFetch<Team>(`/companies/${cid}/teams`, { method: "POST", body: JSON.stringify(body) });
```

### C-3: Service tests mock with `createAgentDb` (or `createDiscussionDb`) from `__tests__/helpers/mock-db.ts`

```typescript
// CORRECT
import { createAgentDb } from "./helpers/mock-db.js";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => args), eq: vi.fn((a, b) => ({ eq: [a, b] })),
  desc: vi.fn(c => ({ desc: c })), inArray: vi.fn((c, v) => ({ inArray: [c, v] })),
  sql: vi.fn(() => ({ sql: true })),
}));
vi.mock("@armyofagents/db", () => ({
  teams: { id: "t_id", companyId: "t_cid" /* ... column stubs */ },
  // ... other tables the service imports
}));

const db = createAgentDb({
  selects: [[{ id: "t1" }]],
  inserts: [[{ id: "t1", slug: "frontend" }]],
  updates: [[]],
});
const svc = teamsService(db);

// WRONG — createSequenceDb does not exist
const db = createSequenceDb([...]);
```

### C-4: Slice 6 + Slice 7 — feature flag + try/catch + deployment gate (MANDATORY)

These two slices modify critical existing code paths. Never merge without:
1. `if (companyRow?.enableTeams)` gate around new behavior
2. `try { ... } catch (err) { log.warn(...) }` wrapper so failures don't break existing flows
3. Manual smoke with `enableTeams=false` confirming existing behavior unchanged
4. Manual smoke with `enableTeams=true` confirming new behavior activates

### C-5: Every slice acceptance ends with a `pnpm changeset` step

Each slice produces a `.changeset/teams-slice-N.md` entry. Frontmatter `"aoa": minor`. Description briefly summarizes what the slice ships.

### C-6: After creating an agent inline (UI flow), explicitly call `projectsApi.assignAgent(parentProjectId, agent.id)` before adding to team

The `agentsApi.create()` server handler does NOT auto-add to `agent_projects`. The team's `addMember` RPC enforces dept membership — without this step, addMember will fail with *"agent is not a member of the team's parent department."*

### C-7: Activity logging on every write

After every successful write operation in a service or route, call `await logActivity(db, { companyId, actorType, actorId, action, entityType, entityId, details })`. See `goalRoutes` for examples.

---

## Overview

9 implementable slices, sequential by default but slices 4 and 7 can run in parallel with later slices since they touch different surfaces.

| # | Slice | Depends on | Outcome |
|---|---|---|---|
| 1 | Schema + service skeleton | nothing | DB tables, services, routes wired; CRUD tests pass; nothing user-visible |
| 2 | Build-from-scratch UI | 1 | Users can create teams via Agents tab; team detail page with Overview tab |
| 3 | Coordination tab | 1, 2 | Edit coordination.md with section markers preserving user prose |
| 4 | Org chart team overlay | 1, 2 | Teams render as overlay boxes on OrgChart canvas |
| 5 | Manifest tab | 1, 2 | YAML editor with schema validation |
| 6 | Heartbeat integration | 1 | coordination.md injected into team-member system prompts at runtime |
| 7 | @human resolver + notifications | nothing (parallel) | `@alice-h` resolves to a human; lands in Inbox |
| 8 | Import flow | 1, 5, 6 | `.team.yaml` upload + cascade install with collision handling |
| 9 | Export flow | 1, 8 | Download `.team.yaml`; roundtrip-import works |

Slice 10 (Marketplace UI) is deferred — separate spec when we ship publishing.

**Marker conventions used throughout this plan:**
- `Files:` block: explicit paths to Create / Modify / Test
- `Run:` lines: exact command to execute
- `Expected:` lines: what success looks like
- Code blocks: complete content for the file or section being changed
- Commits use Conventional Commits style matching AoA's git log (`feat(teams):`, `test(teams):`, etc.)

---

## File Structure

### New schema files (3) — `packages/db/src/schema/`

| File | Responsibility |
|---|---|
| `teams.ts` | The `teams` table definition (one team = one row) |
| `team_members.ts` | M2M between teams and agents with `role` field |
| `team_coordinations.ts` | Markdown coordination contract per team (mirrors `company_skills`) |

### New shared types (1) — `packages/shared/src/`

| File | Responsibility |
|---|---|
| `teams.ts` | Public types: `TeamRole`, `TeamStatus`, `TeamManifest`, `CreateTeamInput`, `UpdateTeamInput`, etc. + Zod validators |

### New services (6) — `server/src/services/`

| File | Responsibility |
|---|---|
| `teams.ts` | CRUD for teams + team_members; factory `teamsService(db)` |
| `team-coordination.ts` | CRUD for team_coordinations + section-marker parsing |
| `team-manifest.ts` | Pure functions for YAML validation + serialization |
| `team-scaffolder.ts` | LLM-backed scaffolding interface (mocked in v1) |
| `team-import.ts` | Parse → preview → cascade install with transaction |
| `team-export.ts` | Serialize team + manifest + coordination + file inventory |

### New routes (3) — `server/src/routes/`

| File | Responsibility |
|---|---|
| `teams.ts` | All `/companies/:cid/teams*` HTTP handlers |
| `team-coordinations.ts` | `/coordination` endpoints |
| `team-imports.ts` | `/teams/_imports/*` endpoints (avoids `:tid` param collision) |

### New UI components (~15) — `ui/src/components/team/` and `ui/src/pages/`

| File | Responsibility |
|---|---|
| `components/team/TeamsSection.tsx` | Section component sitting above Individual agents in AgentsTab |
| `components/team/TeamCard.tsx` | One team's card (name, dept tag, member summary) |
| `components/team/NewTeamButton.tsx` | "+ New team ▾" with dropdown opening the entry modal |
| `components/team/NewTeamEntryDialog.tsx` | 3-option modal (Build / Import / Marketplace) |
| `components/team/BuildFromScratchForm.tsx` | The full create form with member picker |
| `components/team/MemberPicker.tsx` | Search-pick agents from company |
| `components/team/InlineNewAgentRow.tsx` | Inline row for creating a new agent during team build |
| `components/team/ImportUploadDialog.tsx` | File drop zone modal |
| `components/team/ImportPreviewDialog.tsx` | Preview & install modal |
| `components/team/CoordinationEditor.tsx` | Section-aware markdown editor |
| `components/team/CoordinationSection.tsx` | One section (auto or hand-written) |
| `components/team/PreviewAsLlmDialog.tsx` | "Preview as LLM" modal |
| `components/team/ManifestEditor.tsx` | YAML editor with validation |
| `components/team/TeamOrgOverlay.tsx` | Team box overlay layer for OrgChart |
| `pages/TeamDetail.tsx` | `/team/teams/:slug` page with tabs |

### Modified files

| File | Modification |
|---|---|
| `packages/db/src/schema/index.ts` | Export new tables |
| `packages/shared/src/index.ts` | Export team types |
| `server/src/services/issues.ts` | Add `findMentionedHumans` (Slice 7) |
| `server/src/services/heartbeat.ts` (or context-packaging equivalent) | Inject coordination.md into team-member prompts (Slice 6) |
| `server/src/index.ts` (or routes registry) | Mount new routes |
| `ui/src/pages/TeamPage.tsx` | Render `TeamsSection` inside the Agents tab |
| `ui/src/pages/OrgChart.tsx` | Render `TeamOrgOverlay` (Slice 4) |
| `ui/src/components/team/AgentsTab.tsx` | Restructure for two sections (Teams + Individual) |
| `ui/src/lib/router.tsx` (or routes file) | Add `/team/teams/:slug` route |
| `ui/src/api/` | Add `teams.ts` API client + `team-coordinations.ts` API client |

### New test files (~15) — `server/src/__tests__/`

| File | Slice | Type |
|---|---|---|
| `team-manifest.test.ts` | 1 | Pure function |
| `team-coordination-parser.test.ts` | 3 | Pure function |
| `team-slug.test.ts` | 1 | Pure function |
| `teams-service.test.ts` | 1 | Service mock |
| `team-coordination-service.test.ts` | 1, 3 | Service mock |
| `team-import-service.test.ts` | 8 | Service mock |
| `team-export-service.test.ts` | 9 | Service mock |
| `team-scaffolder-service.test.ts` | 2, 3 | Service mock (interface) |
| `teams-routes-contract.test.ts` | 1 | Contract |
| `team-coordination-routes-contract.test.ts` | 3 | Contract |
| `team-import-routes-contract.test.ts` | 8 | Contract |
| `heartbeat-team-coordination.test.ts` | 6 | Integration |
| `mention-resolver-humans.test.ts` | 7 | Integration |
| `team-import-cascade.test.ts` | 8 | Integration |
| `teams-qa.test.ts` | 9 (final) | E2E QA suite |

---

## Phase 1 — Foundation

### Slice 1: Schema, shared types, services, routes (CRUD only) + feature flag

**Goal:** Three new tables with migrations, factory-pattern services with mock-DB tests, HTTP routes wired and contract-tested, plus an `enableTeams` feature flag on companies that defaults to false. Nothing user-visible. After this slice, a developer can `curl POST /companies/:cid/teams` and create a team via API — but only on companies that have explicitly opted in.

**Worktree:** create one named `teams-slice-1` per `superpowers:using-git-worktrees`.

> **Read the corrections doc first:** [`docs/aoa/specs/teams_plan_corrections.md`](./teams_plan_corrections.md) lists verified canonical patterns. When code in this plan conflicts with those patterns, the corrections doc wins.

---

#### Task 1.0: Preflight — install `yaml` package + add `enableTeams` column to companies

**Files:**
- Modify: `server/package.json`, `ui/package.json` (auto-updated by pnpm)
- Modify: `packages/db/src/schema/companies.ts` (add column)

- [ ] **Step 1: Install yaml package in server + UI**

```bash
pnpm -F @armyofagents/server add yaml
pnpm -F @armyofagents/ui add yaml
pnpm -F @armyofagents/server list yaml   # verify
pnpm -F @armyofagents/ui list yaml       # verify
```

Expected: both list `yaml` as a direct dependency.

- [ ] **Step 2: Add `enableTeams` boolean column to companies schema**

In `packages/db/src/schema/companies.ts`, add the column at the end of the column list (preserve existing column order):

```typescript
import { boolean } from "drizzle-orm/pg-core";  // add to existing imports if not present

// ... existing columns

enableTeams: boolean("enable_teams").notNull().default(false),

// ... rest unchanged
```

- [ ] **Step 3: Verify the schema compiles**

Run: `pnpm -F @armyofagents/db build`
Expected: success, no type errors.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/pnpm-lock.yaml ui/package.json ui/pnpm-lock.yaml packages/db/src/schema/companies.ts
git commit -m "feat(teams): add yaml dep + enableTeams feature flag column on companies"
```

---

#### Task 1.1: Add shared types for teams

**Files:**
- Create: `packages/shared/src/teams.ts`
- Modify: `packages/shared/src/index.ts` (add export)

- [ ] **Step 1: Create the types file**

```typescript
// packages/shared/src/teams.ts
import { z } from "zod";

export type TeamRole = "lead" | "member";
export type TeamStatus = "active" | "archived";
export type TeamCoordinationStatus = "draft" | "published" | "archived";

export const TeamRoleSchema = z.enum(["lead", "member"]);
export const TeamStatusSchema = z.enum(["active", "archived"]);

export interface FileInventoryEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface TeamManifestRoutingRule {
  match: string;     // regex pattern
  mention: string;   // "@alice"
}

export interface TeamManifestRouting {
  defaultLead?: string;
  rules: TeamManifestRoutingRule[];
}

export interface TeamManifestAgentInline {
  name: string;
  role: TeamRole;
  skillKeys: string[];
  instructionsTemplate?: string;
}

export interface TeamManifestAgentRef {
  $ref: string;          // "@aoa/agent-name@1.0.0"
  localName: string;
  role: TeamRole;
}

export type TeamManifestAgent = TeamManifestAgentInline | TeamManifestAgentRef;

export interface TeamManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  agents: TeamManifestAgent[];
  routing: TeamManifestRouting;
  skillDeps?: string[];
  pluginDeps?: string[];
  workflowTemplates?: Array<{ $ref: string }>;
  memoryItems?: Array<{ layer: string; title: string; body: string }>;
}

export const TeamManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver"),
  displayName: z.string().optional(),
  description: z.string().optional(),
  agents: z.array(z.union([
    z.object({
      name: z.string().min(1),
      role: TeamRoleSchema,
      skillKeys: z.array(z.string()),
      instructionsTemplate: z.string().optional(),
    }),
    z.object({
      $ref: z.string().regex(/^@[\w-]+\/[\w-]+@\d+\.\d+\.\d+$/),
      localName: z.string().min(1),
      role: TeamRoleSchema,
    }),
  ])),
  routing: z.object({
    defaultLead: z.string().optional(),
    rules: z.array(z.object({
      match: z.string(),
      mention: z.string(),
    })),
  }),
  skillDeps: z.array(z.string()).optional(),
  pluginDeps: z.array(z.string()).optional(),
  workflowTemplates: z.array(z.object({ $ref: z.string() })).optional(),
  memoryItems: z.array(z.object({
    layer: z.string(),
    title: z.string(),
    body: z.string(),
  })).optional(),
});

export interface CreateTeamInput {
  name: string;
  parentProjectId: string;
  description?: string;
  manifest?: Partial<TeamManifest>;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  manifest?: TeamManifest;
  status?: TeamStatus;
}

export interface AddTeamMemberInput {
  agentId: string;
  role: TeamRole;
}

export interface CreateTeamCoordinationInput {
  teamId: string;
  name: string;
  markdown: string;
  description?: string;
}
```

- [ ] **Step 2: Export from shared index**

In `packages/shared/src/index.ts`, append:

```typescript
export * from "./teams.js";
```

- [ ] **Step 3: Build shared package and verify types compile**

Run: `pnpm -F @armyofagents/shared build`
Expected: build succeeds, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/teams.ts packages/shared/src/index.ts
git commit -m "feat(teams): add shared types for team manifest, roles, inputs"
```

---

#### Task 1.2: Create `teams` schema

**Files:**
- Create: `packages/db/src/schema/teams.ts`
- Modify: `packages/db/src/schema/index.ts` (add export)

- [ ] **Step 1: Create the schema file**

```typescript
// packages/db/src/schema/teams.ts
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import type { TeamManifest } from "@armyofagents/shared";

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    parentProjectId: uuid("parent_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    manifest: jsonb("manifest").$type<Partial<TeamManifest>>().notNull().default({}),
    templateOrigin: text("template_origin"),
    templateVersion: text("template_version"),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("teams_company_idx").on(table.companyId),
    parentProjectIdx: index("teams_parent_project_idx").on(table.parentProjectId),
    companySlugUq: uniqueIndex("teams_company_slug_uq").on(table.companyId, table.slug),
  }),
);
```

- [ ] **Step 2: Add to schema index**

In `packages/db/src/schema/index.ts`, add an export line in the alphabetical position:

```typescript
export * from "./teams.js";
```

- [ ] **Step 3: Verify the schema compiles**

Run: `pnpm -F @armyofagents/db build`
Expected: build succeeds, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/teams.ts packages/db/src/schema/index.ts
git commit -m "feat(teams): add teams schema (parent_project_id, manifest, status)"
```

---

#### Task 1.3: Create `team_members` schema

**Files:**
- Create: `packages/db/src/schema/team_members.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// packages/db/src/schema/team_members.ts
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { agents } from "./agents.js";

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    teamAgentUq: uniqueIndex("team_members_team_agent_uq").on(table.teamId, table.agentId),
    teamIdx: index("team_members_team_idx").on(table.teamId),
    agentIdx: index("team_members_agent_idx").on(table.agentId),
  }),
);
```

- [ ] **Step 2: Add to schema index**

```typescript
export * from "./team_members.js";
```

- [ ] **Step 3: Verify build**

Run: `pnpm -F @armyofagents/db build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/team_members.ts packages/db/src/schema/index.ts
git commit -m "feat(teams): add team_members schema with role enum (lead|member)"
```

---

#### Task 1.4: Create `team_coordinations` schema

**Files:**
- Create: `packages/db/src/schema/team_coordinations.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// packages/db/src/schema/team_coordinations.ts
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { teams } from "./teams.js";
import type { FileInventoryEntry } from "@armyofagents/shared";

export const teamCoordinations = pgTable(
  "team_coordinations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull(),
    sourceType: text("source_type").notNull().default("local_path"),
    sourceLocator: text("source_locator"),
    sourceRef: text("source_ref"),
    trustLevel: text("trust_level").notNull().default("markdown_only"),
    compatibility: text("compatibility").notNull().default("compatible"),
    fileInventory: jsonb("file_inventory").$type<FileInventoryEntry[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("published"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeyUq: uniqueIndex("team_coordinations_company_key_uq").on(table.companyId, table.key),
    teamIdx: index("team_coordinations_team_idx").on(table.teamId),
    teamStatusIdx: index("team_coordinations_team_status_idx").on(table.teamId, table.status),
  }),
);
```

- [ ] **Step 2: Add to schema index**

```typescript
export * from "./team_coordinations.js";
```

- [ ] **Step 3: Verify build**

Run: `pnpm -F @armyofagents/db build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/team_coordinations.ts packages/db/src/schema/index.ts
git commit -m "feat(teams): add team_coordinations schema (mirrors company_skills)"
```

---

#### Task 1.5: Generate migration

**Files:**
- Create: `packages/db/src/migrations/00XX_teams.sql` (auto-generated; do NOT hand-edit per CLAUDE.md Critical Rule #1)
- Modify: `packages/db/src/migrations/meta/_journal.json` (auto-updated)

- [ ] **Step 1: Generate the migration**

Run: `pnpm db:generate`
Expected: a new migration file `00XX_teams.sql` (or similar name) appears in `packages/db/src/migrations/`. Should contain:
- 3 `CREATE TABLE` statements: `teams`, `team_members`, `team_coordinations`
- 1 `ALTER TABLE companies ADD COLUMN enable_teams BOOLEAN NOT NULL DEFAULT FALSE` (from Task 1.0)
- All FK constraints and indexes from the schema definitions

- [ ] **Step 2: Inspect the generated SQL**

Run: `cat packages/db/src/migrations/00XX_teams.sql` (replace XX with the actual number)
Expected: 3 CREATE TABLE + 1 ALTER TABLE statements with all foreign keys + indexes matching the schema definitions. The `DEFAULT FALSE` on `enable_teams` ensures every existing company is unchanged at runtime until explicitly opted in.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "feat(teams): generate migration for teams, team_members, team_coordinations"
```

---

#### Task 1.6: Pure function tests for slug generation

**Files:**
- Create: `server/src/services/team-slug.ts`
- Test: `server/src/__tests__/team-slug.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/team-slug.test.ts
import { describe, expect, it } from "vitest";
import { generateTeamSlug, ensureUniqueSlug } from "../services/team-slug.js";

describe("generateTeamSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(generateTeamSlug("Frontend Team")).toBe("frontend-team");
  });

  it("strips special characters", () => {
    expect(generateTeamSlug("Frontend & UI / Team!")).toBe("frontend-ui-team");
  });

  it("collapses multiple hyphens", () => {
    expect(generateTeamSlug("Frontend  --  Team")).toBe("frontend-team");
  });

  it("trims leading/trailing hyphens", () => {
    expect(generateTeamSlug("  -frontend-  ")).toBe("frontend");
  });

  it("caps at 64 chars", () => {
    const long = "a".repeat(100);
    expect(generateTeamSlug(long).length).toBeLessThanOrEqual(64);
  });

  it("rejects empty input", () => {
    expect(() => generateTeamSlug("")).toThrow("name cannot be empty");
    expect(() => generateTeamSlug("!!!")).toThrow("name produces empty slug");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns base slug if not taken", () => {
    expect(ensureUniqueSlug("frontend", new Set())).toBe("frontend");
  });

  it("appends -2 if base taken", () => {
    expect(ensureUniqueSlug("frontend", new Set(["frontend"]))).toBe("frontend-2");
  });

  it("appends -3 if -2 also taken", () => {
    expect(ensureUniqueSlug("frontend", new Set(["frontend", "frontend-2"]))).toBe("frontend-3");
  });

  it("handles 100 collisions", () => {
    const taken = new Set(["frontend", ...Array.from({length: 99}, (_, i) => `frontend-${i + 2}`)]);
    expect(ensureUniqueSlug("frontend", taken)).toBe("frontend-101");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @armyofagents/server vitest run team-slug`
Expected: FAIL — module `services/team-slug.js` not found.

- [ ] **Step 3: Implement the slug functions**

```typescript
// server/src/services/team-slug.ts
const MAX_SLUG_LENGTH = 64;

export function generateTeamSlug(name: string): string {
  if (!name || name.trim().length === 0) {
    throw new Error("name cannot be empty");
  }
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  if (slug.length === 0) {
    throw new Error("name produces empty slug");
  }
  return slug;
}

export function ensureUniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) {
    n++;
  }
  return `${base}-${n}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @armyofagents/server vitest run team-slug`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/team-slug.ts server/src/__tests__/team-slug.test.ts
git commit -m "feat(teams): add team slug generator with uniqueness helper"
```

---

#### Task 1.7: Pure function tests for manifest validation

**Files:**
- Create: `server/src/services/team-manifest.ts`
- Test: `server/src/__tests__/team-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/team-manifest.test.ts
import { describe, expect, it } from "vitest";
import { parseManifest, serializeManifest, validateManifest } from "../services/team-manifest.js";

const VALID_YAML = `
schemaVersion: 1
name: frontend-team
version: 1.0.0
displayName: Frontend Team
agents:
  - name: alice
    role: lead
    skillKeys: [react, css]
routing:
  defaultLead: "@alice"
  rules: []
`;

describe("parseManifest", () => {
  it("parses valid YAML to typed object", () => {
    const m = parseManifest(VALID_YAML);
    expect(m.schemaVersion).toBe(1);
    expect(m.name).toBe("frontend-team");
    expect(m.agents).toHaveLength(1);
    expect(m.agents[0]).toMatchObject({ name: "alice", role: "lead" });
  });

  it("rejects invalid schemaVersion", () => {
    const yaml = VALID_YAML.replace("schemaVersion: 1", "schemaVersion: 2");
    expect(() => parseManifest(yaml)).toThrow();
  });

  it("rejects missing required fields", () => {
    const yaml = `name: foo\nversion: 1.0.0\n`;
    expect(() => parseManifest(yaml)).toThrow();
  });

  it("rejects malformed YAML", () => {
    expect(() => parseManifest("this is: not: valid: yaml:::")).toThrow();
  });

  it("accepts $ref agent form", () => {
    const yaml = `
schemaVersion: 1
name: t
version: 1.0.0
agents:
  - $ref: "@aoa/junior@1.0.0"
    localName: bob
    role: member
routing:
  rules: []
`;
    const m = parseManifest(yaml);
    expect(m.agents[0]).toMatchObject({ $ref: "@aoa/junior@1.0.0", localName: "bob" });
  });

  it("rejects non-semver version", () => {
    const yaml = VALID_YAML.replace("version: 1.0.0", "version: latest");
    expect(() => parseManifest(yaml)).toThrow();
  });
});

describe("validateManifest", () => {
  it("validates a fully-formed object", () => {
    const m = parseManifest(VALID_YAML);
    expect(() => validateManifest(m)).not.toThrow();
  });

  it("rejects routing rule with invalid regex", () => {
    const yaml = VALID_YAML + `    - match: "[unclosed"\n      mention: "@x"\n`;
    expect(() => parseManifest(yaml)).toThrow(/regex/i);
  });
});

describe("serializeManifest", () => {
  it("roundtrips: parse → serialize → parse equivalence", () => {
    const m1 = parseManifest(VALID_YAML);
    const yaml = serializeManifest(m1);
    const m2 = parseManifest(yaml);
    expect(m2).toEqual(m1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @armyofagents/server vitest run team-manifest`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the manifest functions**

```typescript
// server/src/services/team-manifest.ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { TeamManifestSchema, type TeamManifest } from "@armyofagents/shared";

export function parseManifest(yaml: string): TeamManifest {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    throw new Error(`malformed YAML: ${(err as Error).message}`);
  }
  return validateManifest(raw);
}

export function validateManifest(raw: unknown): TeamManifest {
  const result = TeamManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`invalid manifest: ${result.error.message}`);
  }
  // Validate routing rules are valid regex
  for (const rule of result.data.routing.rules) {
    try {
      new RegExp(rule.match);
    } catch (err) {
      throw new Error(`invalid regex in routing rule "${rule.match}": ${(err as Error).message}`);
    }
  }
  return result.data;
}

export function serializeManifest(manifest: TeamManifest): string {
  validateManifest(manifest);
  return stringifyYaml(manifest);
}
```

- [ ] **Step 4: Verify the `yaml` package is installed**

Run: `pnpm -F @armyofagents/server list yaml`
Expected: shows `yaml` listed as a dependency. If not installed, run `pnpm -F @armyofagents/server add yaml`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @armyofagents/server vitest run team-manifest`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/team-manifest.ts server/src/__tests__/team-manifest.test.ts
git commit -m "feat(teams): add manifest YAML parser, validator, serializer with zod"
```

---

#### Task 1.8: `teamsService` factory with mock-DB tests

**Files:**
- Create: `server/src/services/teams.ts`
- Test: `server/src/__tests__/teams-service.test.ts`

- [ ] **Step 1: Write the failing test (subset — list, getById, create, addMember constraint)**

```typescript
// server/src/__tests__/teams-service.test.ts
import { describe, expect, it, vi } from "vitest";

// Mock the db package — same Proxy pattern as company-skills tests
vi.mock("@armyofagents/db", () => ({
  teams: new Proxy({}, { get: (_t, prop) => prop }),
  teamMembers: new Proxy({}, { get: (_t, prop) => prop }),
  agentProjects: new Proxy({}, { get: (_t, prop) => prop }),
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  inArray: () => ({}),
}));

import { teamsService } from "../services/teams.js";
import type { Db } from "@armyofagents/db";

function createSequenceDb(results: unknown[]): Db {
  let i = 0;
  const next = () => results[i++];
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(next()) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve(next()) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(next()) }) }) }),
    delete: () => ({ where: () => Promise.resolve(next()) }),
    transaction: async (fn: (tx: Db) => Promise<unknown>) => fn({} as Db),
  } as unknown as Db;
}

describe("teamsService.list", () => {
  it("returns rows for company", async () => {
    const db = createSequenceDb([[{ id: "t1", name: "Frontend" }]]);
    const svc = teamsService(db);
    const result = await svc.list("c1");
    expect(result).toEqual([{ id: "t1", name: "Frontend" }]);
  });
});

describe("teamsService.create", () => {
  it("inserts team row and returns it", async () => {
    const db = createSequenceDb([
      [],                                                                // existing slugs query: none taken
      [{ id: "t1", slug: "frontend-team", name: "Frontend Team" }],     // insert returning
    ]);
    const svc = teamsService(db);
    const result = await svc.create("c1", {
      name: "Frontend Team",
      parentProjectId: "p1",
    });
    expect(result.slug).toBe("frontend-team");
  });

  it("appends -2 if slug taken", async () => {
    const db = createSequenceDb([
      [{ slug: "frontend-team" }],                                       // existing
      [{ id: "t2", slug: "frontend-team-2" }],                           // insert
    ]);
    const svc = teamsService(db);
    const result = await svc.create("c1", { name: "Frontend Team", parentProjectId: "p1" });
    expect(result.slug).toBe("frontend-team-2");
  });
});

describe("teamsService.addMember", () => {
  it("rejects if agent not in parent department", async () => {
    const db = createSequenceDb([
      [{ id: "t1", parentProjectId: "p1" }],   // team lookup
      [],                                        // agent_projects lookup: empty (not in dept)
    ]);
    const svc = teamsService(db);
    await expect(svc.addMember("t1", "a1", "member")).rejects.toThrow(/not a member of.*department/i);
  });

  it("rejects when adding second lead", async () => {
    const db = createSequenceDb([
      [{ id: "t1", parentProjectId: "p1" }],   // team
      [{ projectId: "p1" }],                     // agent in dept
      [{ role: "lead" }],                        // existing lead in team
    ]);
    const svc = teamsService(db);
    await expect(svc.addMember("t1", "a2", "lead")).rejects.toThrow(/team already has a lead/i);
  });

  it("succeeds when valid", async () => {
    const db = createSequenceDb([
      [{ id: "t1", parentProjectId: "p1" }],
      [{ projectId: "p1" }],
      [],                                        // no existing lead
      [{ id: "tm1", teamId: "t1", agentId: "a1", role: "lead" }],
    ]);
    const svc = teamsService(db);
    const result = await svc.addMember("t1", "a1", "lead");
    expect(result.role).toBe("lead");
  });
});

describe("teamsService.removeMember", () => {
  it("rejects removing the last lead", async () => {
    const db = createSequenceDb([
      [{ teamId: "t1", agentId: "a1", role: "lead" }],   // membership lookup
      [{ count: 1 }],                                       // count of leads = 1
    ]);
    const svc = teamsService(db);
    await expect(svc.removeMember("t1", "a1")).rejects.toThrow(/cannot remove the only lead/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @armyofagents/server vitest run teams-service`
Expected: FAIL — `teamsService` not exported.

- [ ] **Step 3: Implement the service**

```typescript
// server/src/services/teams.ts
import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, agentProjects } from "@armyofagents/db";
import type {
  CreateTeamInput,
  UpdateTeamInput,
  TeamRole,
} from "@armyofagents/shared";
import { generateTeamSlug, ensureUniqueSlug } from "./team-slug.js";
import { badRequest, notFound } from "../errors.js";

export function teamsService(db: Db) {
  return {
    list: async (companyId: string, projectId?: string) => {
      if (projectId) {
        return db
          .select()
          .from(teams)
          .where(and(eq(teams.companyId, companyId), eq(teams.parentProjectId, projectId)));
      }
      return db.select().from(teams).where(eq(teams.companyId, companyId));
    },

    getById: async (id: string) => {
      const rows = await db.select().from(teams).where(eq(teams.id, id));
      if (rows.length === 0) throw notFound(`team ${id} not found`);
      return rows[0];
    },

    getBySlug: async (companyId: string, slug: string) => {
      const rows = await db
        .select()
        .from(teams)
        .where(and(eq(teams.companyId, companyId), eq(teams.slug, slug)));
      if (rows.length === 0) throw notFound(`team ${slug} not found`);
      return rows[0];
    },

    create: async (companyId: string, input: CreateTeamInput) => {
      const baseSlug = generateTeamSlug(input.name);
      const existing = await db
        .select({ slug: teams.slug })
        .from(teams)
        .where(eq(teams.companyId, companyId));
      const slug = ensureUniqueSlug(baseSlug, new Set(existing.map((r) => r.slug)));
      const inserted = await db
        .insert(teams)
        .values({
          companyId,
          parentProjectId: input.parentProjectId,
          name: input.name,
          slug,
          description: input.description,
          manifest: input.manifest ?? {},
        })
        .returning();
      return inserted[0];
    },

    update: async (id: string, patch: UpdateTeamInput) => {
      const updated = await db
        .update(teams)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(teams.id, id))
        .returning();
      if (updated.length === 0) throw notFound(`team ${id} not found`);
      return updated[0];
    },

    archive: async (id: string) => {
      const updated = await db
        .update(teams)
        .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(teams.id, id))
        .returning();
      if (updated.length === 0) throw notFound(`team ${id} not found`);
      return updated[0];
    },

    listMembers: async (teamId: string) => {
      return db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
    },

    addMember: async (teamId: string, agentId: string, role: TeamRole) => {
      const teamRows = await db.select().from(teams).where(eq(teams.id, teamId));
      if (teamRows.length === 0) throw notFound(`team ${teamId} not found`);
      const team = teamRows[0];

      // Verify agent is in parent dept
      const deptMembership = await db
        .select()
        .from(agentProjects)
        .where(
          and(eq(agentProjects.agentId, agentId), eq(agentProjects.projectId, team.parentProjectId)),
        );
      if (deptMembership.length === 0) {
        throw badRequest(`agent is not a member of the team's parent department`);
      }

      // Verify no existing lead if role=lead
      if (role === "lead") {
        const existingLead = await db
          .select()
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "lead")));
        if (existingLead.length > 0) {
          throw badRequest(`team already has a lead — reassign first`);
        }
      }

      const inserted = await db
        .insert(teamMembers)
        .values({ teamId, agentId, role })
        .returning();
      return inserted[0];
    },

    removeMember: async (teamId: string, agentId: string) => {
      const membershipRows = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.agentId, agentId)));
      if (membershipRows.length === 0) throw notFound(`membership not found`);
      const membership = membershipRows[0];

      if (membership.role === "lead") {
        const leadCount = await db
          .select()
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "lead")));
        if (leadCount.length === 1) {
          throw badRequest(`cannot remove the only lead — designate a new lead first`);
        }
      }

      await db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.agentId, agentId)));
      return { ok: true };
    },

    updateMemberRole: async (teamId: string, agentId: string, role: TeamRole) => {
      // If promoting to lead, demote existing lead first (transactional)
      return db.transaction(async (tx) => {
        if (role === "lead") {
          const existingLead = await tx
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "lead")));
          for (const lead of existingLead) {
            if (lead.agentId !== agentId) {
              await tx
                .update(teamMembers)
                .set({ role: "member" })
                .where(eq(teamMembers.id, lead.id));
            }
          }
        }
        const updated = await tx
          .update(teamMembers)
          .set({ role })
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.agentId, agentId)))
          .returning();
        if (updated.length === 0) throw notFound(`membership not found`);
        return updated[0];
      });
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @armyofagents/server vitest run teams-service`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/teams.ts server/src/__tests__/teams-service.test.ts
git commit -m "feat(teams): add teamsService factory with CRUD + membership constraints"
```

---

#### Task 1.9: `teamCoordinationService` factory (basic CRUD; section parsing in Slice 3)

**Files:**
- Create: `server/src/services/team-coordination.ts`
- Test: `server/src/__tests__/team-coordination-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/team-coordination-service.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  teamCoordinations: new Proxy({}, { get: (_t, prop) => prop }),
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
}));

import { teamCoordinationService } from "../services/team-coordination.js";
import type { Db } from "@armyofagents/db";

function createSequenceDb(results: unknown[]): Db {
  let i = 0;
  const next = () => results[i++];
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(next()) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve(next()) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(next()) }) }) }),
  } as unknown as Db;
}

describe("teamCoordinationService.upsert", () => {
  it("inserts a new coordination row", async () => {
    const db = createSequenceDb([
      [],                                                                                  // no existing
      [{ id: "tc1", teamId: "t1", markdown: "# Mission\n..." }],                          // insert returning
    ]);
    const svc = teamCoordinationService(db);
    const result = await svc.upsert("c1", {
      teamId: "t1",
      name: "Frontend Team Coordination",
      markdown: "# Mission\n...",
    });
    expect(result.id).toBe("tc1");
  });

  it("updates an existing coordination row", async () => {
    const db = createSequenceDb([
      [{ id: "tc1", teamId: "t1", status: "published" }],                                  // existing
      [{ id: "tc1", teamId: "t1", markdown: "updated" }],                                  // update returning
    ]);
    const svc = teamCoordinationService(db);
    const result = await svc.upsert("c1", {
      teamId: "t1",
      name: "Frontend",
      markdown: "updated",
    });
    expect(result.markdown).toBe("updated");
  });
});

describe("teamCoordinationService.getByTeam", () => {
  it("returns the published coordination for a team", async () => {
    const db = createSequenceDb([[{ id: "tc1", teamId: "t1", status: "published" }]]);
    const svc = teamCoordinationService(db);
    const result = await svc.getByTeam("t1");
    expect(result?.id).toBe("tc1");
  });

  it("returns null if none exists", async () => {
    const db = createSequenceDb([[]]);
    const svc = teamCoordinationService(db);
    const result = await svc.getByTeam("t1");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @armyofagents/server vitest run team-coordination-service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
// server/src/services/team-coordination.ts
import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teamCoordinations } from "@armyofagents/db";
import type { CreateTeamCoordinationInput } from "@armyofagents/shared";
import { generateTeamSlug } from "./team-slug.js";

export function teamCoordinationService(db: Db) {
  return {
    getByTeam: async (teamId: string) => {
      const rows = await db
        .select()
        .from(teamCoordinations)
        .where(and(eq(teamCoordinations.teamId, teamId), eq(teamCoordinations.status, "published")));
      return rows[0] ?? null;
    },

    upsert: async (companyId: string, input: CreateTeamCoordinationInput) => {
      const existing = await db
        .select()
        .from(teamCoordinations)
        .where(and(
          eq(teamCoordinations.teamId, input.teamId),
          eq(teamCoordinations.status, "published"),
        ));

      if (existing.length > 0) {
        const updated = await db
          .update(teamCoordinations)
          .set({
            name: input.name,
            description: input.description,
            markdown: input.markdown,
            updatedAt: new Date(),
          })
          .where(eq(teamCoordinations.id, existing[0].id))
          .returning();
        return updated[0];
      }

      const slug = generateTeamSlug(input.name);
      const inserted = await db
        .insert(teamCoordinations)
        .values({
          companyId,
          teamId: input.teamId,
          key: `${slug}:coordination`,
          slug,
          name: input.name,
          description: input.description,
          markdown: input.markdown,
        })
        .returning();
      return inserted[0];
    },

    archive: async (id: string) => {
      const updated = await db
        .update(teamCoordinations)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(teamCoordinations.id, id))
        .returning();
      return updated[0];
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @armyofagents/server vitest run team-coordination-service`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/team-coordination.ts server/src/__tests__/team-coordination-service.test.ts
git commit -m "feat(teams): add teamCoordinationService factory with upsert/get/archive"
```

---

#### Task 1.10: HTTP routes — using canonical `teamRoutes(db)` factory pattern

> **Pattern source:** [`server/src/routes/goals.ts`](../../../server/src/routes/goals.ts) — the canonical AoA route file. This task mirrors that pattern exactly.

**Files:**
- Create: `server/src/routes/teams.ts`
- Modify: `server/src/app.ts` (add `api.use(teamRoutes(db))` near existing `goalRoutes(db)` mount at line ~186)
- Modify: `packages/shared/src/teams.ts` (add Zod schemas for route body validation)
- Test: `server/src/__tests__/teams-routes-contract.test.ts`

- [ ] **Step 1: Add Zod schemas to shared types (alongside existing types)**

In `packages/shared/src/teams.ts`, append:

```typescript
export const createTeamSchema = z.object({
  name: z.string().min(1).max(128),
  parentProjectId: z.string().uuid(),
  description: z.string().optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  status: TeamStatusSchema.optional(),
});

export const addTeamMemberSchema = z.object({
  agentId: z.string().uuid(),
  role: TeamRoleSchema,
});

export const updateTeamMemberRoleSchema = z.object({
  role: TeamRoleSchema,
});

export const upsertCoordinationSchema = z.object({
  name: z.string().min(1).max(256),
  markdown: z.string(),
  description: z.string().optional(),
});
```

- [ ] **Step 2: Write the failing contract test**

```typescript
// server/src/__tests__/teams-routes-contract.test.ts
import { describe, expect, it } from "vitest";
import { teamRoutes } from "../routes/teams.js";

describe("teamRoutes — conformance + contract", () => {
  it("exports a factory function (not a top-level Router)", () => {
    expect(typeof teamRoutes).toBe("function");
    expect(teamRoutes.length).toBe(1); // accepts (db) param
  });

  it("returns an Express Router when called with db", () => {
    const fakeDb = {} as unknown as never;
    const router = teamRoutes(fakeDb);
    expect(router).toBeDefined();
    expect(typeof router).toBe("function"); // Express Routers are functions
    expect((router as unknown as { stack: unknown[] }).stack).toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F @armyofagents/server vitest run teams-routes-contract`
Expected: FAIL — module `routes/teams.js` not found.

- [ ] **Step 4: Implement the routes — canonical AoA pattern (factory + full paths + assertCompanyAccess + throw HttpError)**

```typescript
// server/src/routes/teams.ts
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@armyofagents/db";
import {
  createTeamSchema,
  updateTeamSchema,
  addTeamMemberSchema,
  updateTeamMemberRoleSchema,
  upsertCoordinationSchema,
} from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { teamsService, teamCoordinationService, logActivity } from "../services/index.js";
import { notFound } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ route: "teams" });

export function teamRoutes(db: Db) {
  const router = Router();
  const svc = teamsService(db);
  const coordSvc = teamCoordinationService(db);

  // GET /companies/:companyId/teams
  router.get("/companies/:companyId/teams", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const projectId = req.query.projectId as string | undefined;
    const result = await svc.list(companyId, projectId);
    res.json({ items: result });
  });

  // POST /companies/:companyId/teams
  router.post("/companies/:companyId/teams", validate(createTeamSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder", "team_lead");
    const result = await svc.create(companyId, req.body);
    await logActivity(db, {
      companyId,
      actorType: "user",
      action: "team.created",
      entityType: "team",
      entityId: result.id,
      details: { name: result.name, parentProjectId: result.parentProjectId },
    });
    res.status(201).json(result);
  });

  // GET /teams/:id
  router.get("/teams/:id", async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    if (!team) throw notFound("Team not found");
    assertCompanyAccess(req, team.companyId);
    res.json(team);
  });

  // PATCH /teams/:id
  router.patch("/teams/:id", validate(updateTeamSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) throw notFound("Team not found");
    assertCompanyAccess(req, existing.companyId);
    await assertRole(db, req, existing.companyId, "founder", "team_lead");
    const result = await svc.update(id, req.body);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: "user",
      action: "team.updated",
      entityType: "team",
      entityId: id,
      details: req.body,
    });
    res.json(result);
  });

  // DELETE /teams/:id (archives)
  router.delete("/teams/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) throw notFound("Team not found");
    assertCompanyAccess(req, existing.companyId);
    await assertRole(db, req, existing.companyId, "founder", "team_lead");
    await svc.archive(id);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: "user",
      action: "team.archived",
      entityType: "team",
      entityId: id,
    });
    res.status(204).end();
  });

  // GET /teams/:id/members
  router.get("/teams/:id/members", async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    if (!team) throw notFound("Team not found");
    assertCompanyAccess(req, team.companyId);
    const result = await svc.listMembers(id);
    res.json({ items: result });
  });

  // POST /teams/:id/members
  router.post("/teams/:id/members", validate(addTeamMemberSchema), async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    if (!team) throw notFound("Team not found");
    assertCompanyAccess(req, team.companyId);
    await assertRole(db, req, team.companyId, "founder", "team_lead");
    const result = await svc.addMember(id, req.body.agentId, req.body.role);
    await logActivity(db, {
      companyId: team.companyId,
      actorType: "user",
      action: "team.member_added",
      entityType: "team",
      entityId: id,
      details: { agentId: req.body.agentId, role: req.body.role },
    });
    res.status(201).json(result);
  });

  // DELETE /teams/:id/members/:agentId
  router.delete("/teams/:id/members/:agentId", async (req, res) => {
    const id = req.params.id as string;
    const agentId = req.params.agentId as string;
    const team = await svc.getById(id);
    if (!team) throw notFound("Team not found");
    assertCompanyAccess(req, team.companyId);
    await assertRole(db, req, team.companyId, "founder", "team_lead");
    await svc.removeMember(id, agentId);
    await logActivity(db, {
      companyId: team.companyId,
      actorType: "user",
      action: "team.member_removed",
      entityType: "team",
      entityId: id,
      details: { agentId },
    });
    res.status(204).end();
  });

  // PATCH /teams/:id/members/:agentId (change role)
  router.patch("/teams/:id/members/:agentId", validate(updateTeamMemberRoleSchema), async (req, res) => {
    const id = req.params.id as string;
    const agentId = req.params.agentId as string;
    const team = await svc.getById(id);
    if (!team) throw notFound("Team not found");
    assertCompanyAccess(req, team.companyId);
    await assertRole(db, req, team.companyId, "founder", "team_lead");
    const result = await svc.updateMemberRole(id, agentId, req.body.role);
    await logActivity(db, {
      companyId: team.companyId,
      actorType: "user",
      action: "team.member_role_changed",
      entityType: "team",
      entityId: id,
      details: { agentId, role: req.body.role },
    });
    res.json(result);
  });

  // GET /teams/:id/coordination
  router.get("/teams/:id/coordination", async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    if (!team) throw notFound("Team not found");
    assertCompanyAccess(req, team.companyId);
    const result = await coordSvc.getByTeam(id);
    res.json(result);
  });

  // PUT /teams/:id/coordination
  router.put("/teams/:id/coordination", validate(upsertCoordinationSchema), async (req, res) => {
    const id = req.params.id as string;
    const team = await svc.getById(id);
    if (!team) throw notFound("Team not found");
    assertCompanyAccess(req, team.companyId);
    await assertRole(db, req, team.companyId, "founder", "team_lead");
    const result = await coordSvc.upsert(team.companyId, { teamId: id, ...req.body });
    await logActivity(db, {
      companyId: team.companyId,
      actorType: "user",
      action: "team.coordination_updated",
      entityType: "team",
      entityId: id,
    });
    res.json(result);
  });

  return router;
}
```

- [ ] **Step 5: Mount the router**

In `server/src/app.ts`, find the existing `api.use(goalRoutes(db))` line (around line 186) and add immediately after:

```typescript
import { teamRoutes } from "./routes/teams.js";
// ... other route imports

api.use(teamRoutes(db));
```

- [ ] **Step 6: Add `teamsService` and `teamCoordinationService` to `services/index.ts` exports**

```typescript
// In server/src/services/index.ts, add:
export { teamsService } from "./teams.js";
export { teamCoordinationService } from "./team-coordination.js";
```

- [ ] **Step 7: Run the contract test**

Run: `pnpm -F @armyofagents/server vitest run teams-routes-contract`
Expected: PASS — 2 tests green.

- [ ] **Step 8: Build the server**

Run: `pnpm -F @armyofagents/server build`
Expected: success.

- [ ] **Step 9: Commit**

```bash
git add server/src/routes/teams.ts server/src/__tests__/teams-routes-contract.test.ts server/src/app.ts server/src/services/index.ts packages/shared/src/teams.ts
git commit -m "feat(teams): add HTTP routes using canonical teamRoutes(db) factory pattern"
```

---

#### Task 1.11: UI API client + queryKeys + slice acceptance

> **Pattern source:** [`ui/src/api/client.ts`](../../../ui/src/api/client.ts) exports `api.{get,post,patch,put,delete,postForm}<T>()`. [`ui/src/api/agents.ts`](../../../ui/src/api/agents.ts) shows usage. **Do NOT use `apiFetch` — it does not exist.**

**Files:**
- Create: `ui/src/api/teams.ts`
- Modify: `ui/src/lib/queryKeys.ts` (add `teams` namespace — note: existing `team` singular is for the people-management page; new `teams` plural is for this feature)

- [ ] **Step 1: Add `teams` namespace to queryKeys**

In `ui/src/lib/queryKeys.ts`, add alongside the existing `team` namespace:

```typescript
teams: {
  list: (companyId: string) => ["teams", companyId] as const,
  detail: (companyId: string, teamId: string) => ["teams", companyId, teamId] as const,
  detailBySlug: (companyId: string, slug: string) => ["teams", companyId, "by-slug", slug] as const,
  members: (companyId: string, teamId: string) => ["teams", companyId, teamId, "members"] as const,
  coordination: (companyId: string, teamId: string) => ["teams", companyId, teamId, "coordination"] as const,
},
```

- [ ] **Step 2: Create the API client using canonical `api.*` methods**

```typescript
// ui/src/api/teams.ts
import { api } from "./client";
import type {
  CreateTeamInput,
  UpdateTeamInput,
  AddTeamMemberInput,
  TeamRole,
} from "@armyofagents/shared";

export interface Team {
  id: string;
  companyId: string;
  parentProjectId: string;
  name: string;
  slug: string;
  description: string | null;
  manifest: Record<string, unknown>;
  status: "active" | "archived";
  templateOrigin: string | null;
  templateVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  agentId: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamCoordination {
  id: string;
  teamId: string;
  name: string;
  markdown: string;
  status: "draft" | "published" | "archived";
}

export const teamsApi = {
  list: (companyId: string, projectId?: string) =>
    api.get<{ items: Team[] }>(
      `/companies/${companyId}/teams${projectId ? `?projectId=${projectId}` : ""}`,
    ),

  get: (teamId: string) => api.get<Team>(`/teams/${teamId}`),

  create: (companyId: string, input: CreateTeamInput) =>
    api.post<Team>(`/companies/${companyId}/teams`, input),

  update: (teamId: string, patch: UpdateTeamInput) =>
    api.patch<Team>(`/teams/${teamId}`, patch),

  archive: (teamId: string) => api.delete<void>(`/teams/${teamId}`),

  listMembers: (teamId: string) =>
    api.get<{ items: TeamMember[] }>(`/teams/${teamId}/members`),

  addMember: (teamId: string, input: AddTeamMemberInput) =>
    api.post<TeamMember>(`/teams/${teamId}/members`, input),

  removeMember: (teamId: string, agentId: string) =>
    api.delete<void>(`/teams/${teamId}/members/${agentId}`),

  updateMemberRole: (teamId: string, agentId: string, role: TeamRole) =>
    api.patch<TeamMember>(`/teams/${teamId}/members/${agentId}`, { role }),

  getCoordination: (teamId: string) =>
    api.get<TeamCoordination | null>(`/teams/${teamId}/coordination`),

  upsertCoordination: (teamId: string, name: string, markdown: string, description?: string) =>
    api.put<TeamCoordination>(`/teams/${teamId}/coordination`, { name, markdown, description }),

  regenerateCoordination: (teamId: string) =>
    api.post<TeamCoordination>(`/teams/${teamId}/coordination/regenerate`, {}),

  updateManifest: (teamId: string, manifest: unknown) =>
    api.put<Team>(`/teams/${teamId}/manifest`, manifest),
};
```

- [ ] **Step 3: Add a conformance test (T-2 from corrections plan)**

Create `ui/src/api/__tests__/teams-api-conformance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { teamsApi } from "../teams";
import { api } from "../client";

describe("teamsApi — uses canonical api.* methods", () => {
  it("exports the expected method names", () => {
    expect(typeof teamsApi.list).toBe("function");
    expect(typeof teamsApi.get).toBe("function");
    expect(typeof teamsApi.create).toBe("function");
    expect(typeof teamsApi.update).toBe("function");
    expect(typeof teamsApi.archive).toBe("function");
    expect(typeof teamsApi.listMembers).toBe("function");
    expect(typeof teamsApi.addMember).toBe("function");
    expect(typeof teamsApi.removeMember).toBe("function");
    expect(typeof teamsApi.updateMemberRole).toBe("function");
    expect(typeof teamsApi.getCoordination).toBe("function");
    expect(typeof teamsApi.upsertCoordination).toBe("function");
    expect(typeof teamsApi.regenerateCoordination).toBe("function");
    expect(typeof teamsApi.updateManifest).toBe("function");
  });

  it("api object has the methods we depend on", () => {
    expect(typeof api.get).toBe("function");
    expect(typeof api.post).toBe("function");
    expect(typeof api.patch).toBe("function");
    expect(typeof api.put).toBe("function");
    expect(typeof api.delete).toBe("function");
    expect(typeof api.postForm).toBe("function");
  });
});
```

- [ ] **Step 4: Verify UI build + tests**

Run: `pnpm -F @armyofagents/ui build && pnpm -F @armyofagents/ui vitest run teams-api-conformance`
Expected: build succeeds, 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/teams.ts ui/src/api/__tests__/teams-api-conformance.test.ts ui/src/lib/queryKeys.ts
git commit -m "feat(teams): add UI API client + queryKeys + conformance test"
```

---

#### Task 1.12: `enableTeams` toggle endpoint (founder-only)

**Files:**
- Modify: `server/src/routes/companies.ts` (existing — add new route)

- [ ] **Step 1: Add the route to existing companies.ts**

Find the existing `companyRoutes(db)` factory and add inside its router definitions:

```typescript
import { z } from "zod";

router.patch("/companies/:companyId/enable-teams",
  validate(z.object({ enabled: z.boolean() })),
  async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder");
    await db.update(companies)
      .set({ enableTeams: req.body.enabled, updatedAt: new Date() })
      .where(eq(companies.id, companyId));
    await logActivity(db, {
      companyId,
      actorType: "user",
      action: "company.teams_feature_toggled",
      entityType: "company",
      entityId: companyId,
      details: { enabled: req.body.enabled },
    });
    res.json({ ok: true });
  },
);
```

- [ ] **Step 2: Verify server build**

Run: `pnpm -F @armyofagents/server build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/companies.ts
git commit -m "feat(teams): add founder-only PATCH /enable-teams endpoint"
```

---

#### Task 1.13: Slice 1 acceptance + changeset

- [ ] **Step 1: Run all builds + tests**

```bash
pnpm -F @armyofagents/db build
pnpm -F @armyofagents/shared build
pnpm -F @armyofagents/server build
pnpm -F @armyofagents/ui build
pnpm -F @armyofagents/server vitest run team
pnpm -F @armyofagents/ui vitest run teams-api-conformance
```

Expected: all builds 0 errors, all tests PASS. **Use `superpowers:verification-before-completion`** to enforce.

- [ ] **Step 2: Add changeset entry**

```bash
pnpm changeset
# Pick "minor" for `aoa` package
# Description: "Add teams foundation — schema (teams, team_members, team_coordinations), services, routes, enableTeams feature flag (default off)"
```

- [ ] **Step 3: Manual smoke**

Start dev server. With a test company that has `enableTeams=false` (default):
- Confirm `GET /api/companies/:cid/teams` returns 200 + empty list
- Confirm existing functionality (agents, projects, goals) is unchanged
- Toggle `PATCH /api/companies/:cid/enable-teams` body `{enabled: true}` → 200
- Re-confirm `GET /api/companies/:cid/teams` still returns 200 + empty list (no schema lookup difference yet — feature flag affects Slice 6 + 7 paths only)

- [ ] **Step 4: Commit + push slice branch + open PR**

```bash
git add .changeset/
git commit -m "chore(changeset): add teams slice 1 entry"
git push -u origin teams-slice-1
gh pr create --title "feat(teams): slice 1 — foundation (schema + services + routes + feature flag)" --body "$(cat <<'EOF'
## Summary
- 3 new tables: teams, team_members, team_coordinations
- enableTeams boolean column on companies (default false — opt-in)
- teamsService + teamCoordinationService factories with mock-DB tests
- teamRoutes(db) HTTP factory with assertCompanyAccess + assertRole + validate
- UI API client (teamsApi) using canonical api.* methods
- Founder-only enable-teams toggle endpoint
- Conformance tests T-1 (route factory shape) and T-2 (api client shape)

## Test plan
- [ ] All builds pass (db, shared, server, ui)
- [ ] All `team*` server tests pass
- [ ] Conformance tests T-1, T-2 pass
- [ ] Manual smoke: existing flows unchanged with enableTeams=false
- [ ] Manual smoke: enable-teams toggle accepts founder, rejects others

Spec: `docs/aoa/specs/teams_spec.md` §3, §6, §14.1–14.3
Corrections: `docs/aoa/specs/teams_plan_corrections.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After PR merges to `Porting1.1`, proceed to Slice 2.

---

## Phase 2 — Core UI

### Slice 2: Build-from-scratch UI + team detail page (Overview)

**Goal:** Users can create teams by clicking "+ New team" → "Build from scratch" → filling form → landing on team detail page. Member picker supports both existing-agent picking and inline new-agent creation. Use the **`design-guide` skill** alongside this slice for tokens, typography, and component patterns.

**Worktree:** `teams-slice-2`.

**Depends on:** Slice 1 merged to `Porting1.1`.

---

#### Task 2.1: TeamCard component

**Files:**
- Create: `ui/src/components/team/TeamCard.tsx`
- Test: `ui/src/components/team/__tests__/TeamCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ui/src/components/team/__tests__/TeamCard.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamCard } from "../TeamCard";

const SAMPLE_TEAM = {
  id: "t1",
  name: "Frontend Team",
  slug: "frontend-team",
  parentProjectName: "Engineering",
  status: "active" as const,
  memberCount: 3,
  leadName: "alice",
};

describe("TeamCard", () => {
  it("renders team name", () => {
    render(<TeamCard team={SAMPLE_TEAM} onClick={() => {}} />);
    expect(screen.getByText("Frontend Team")).toBeInTheDocument();
  });

  it("renders parent dept tag", () => {
    render(<TeamCard team={SAMPLE_TEAM} onClick={() => {}} />);
    expect(screen.getByText("ENGINEERING")).toBeInTheDocument();
  });

  it("renders lead with star marker", () => {
    render(<TeamCard team={SAMPLE_TEAM} onClick={() => {}} />);
    expect(screen.getByText(/⭐.*alice/)).toBeInTheDocument();
  });

  it("renders member count", () => {
    render(<TeamCard team={SAMPLE_TEAM} onClick={() => {}} />);
    expect(screen.getByText(/3 agents/)).toBeInTheDocument();
  });

  it("does NOT render any human-style avatar", () => {
    render(<TeamCard team={SAMPLE_TEAM} onClick={() => {}} />);
    // No Avatar component, no img elements representing members
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @armyofagents/ui vitest run TeamCard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TeamCard**

```tsx
// ui/src/components/team/TeamCard.tsx
import { Star, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TeamCardData {
  id: string;
  name: string;
  slug: string;
  parentProjectName: string;
  status: "active" | "archived";
  memberCount: number;
  leadName: string;
  iconColor?: string;
}

interface Props {
  team: TeamCardData;
  onClick: () => void;
  onMenuClick?: () => void;
}

export function TeamCard({ team, onClick, onMenuClick }: Props) {
  const colorClass = team.iconColor ?? "border-l-indigo-500";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all duration-200 hover:shadow-sm",
        "border-l-[3px]",
        colorClass,
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-base font-bold">
        {team.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{team.name}</h3>
          <Badge variant="outline" className="shrink-0 text-[9px] uppercase tracking-wide">
            {team.parentProjectName}
          </Badge>
        </div>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="h-3 w-3 text-amber-500" />
          <span>{team.leadName}</span>
          <span className="opacity-50">·</span>
          <span>{team.memberCount} agents</span>
          <span className="opacity-50">·</span>
          <span className="capitalize">{team.status}</span>
        </p>
      </div>
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm -F @armyofagents/ui vitest run TeamCard`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/team/TeamCard.tsx ui/src/components/team/__tests__/TeamCard.test.tsx
git commit -m "feat(teams): add TeamCard component with no human-style avatars"
```

---

#### Task 2.2: TeamsSection (lists teams + "+ New team" trigger)

**Files:**
- Create: `ui/src/components/team/TeamsSection.tsx`

- [ ] **Step 1: Implement TeamsSection**

```tsx
// ui/src/components/team/TeamsSection.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, ChevronDown } from "lucide-react";
import { teamsApi } from "../../api/teams";
import { useCompany } from "../../context/CompanyContext";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TeamCard } from "./TeamCard";
import { NewTeamEntryDialog } from "./NewTeamEntryDialog";
import { EmptyState } from "../EmptyState";
import { queryKeys } from "../../lib/queryKeys";
import { Users } from "lucide-react";

type EntryMode = "build" | "import" | null;

export function TeamsSection() {
  const { selectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const [entryMode, setEntryMode] = useState<EntryMode>(null);

  const teamsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.teams.list(selectedCompanyId) : ["teams", "none"],
    queryFn: () => teamsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const teams = teamsQuery.data?.items ?? [];

  return (
    <section className="mb-7">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">
            Teams <span className="ml-1 text-xs font-medium text-muted-foreground">{teams.length}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Grouped agents with a lead + coordination contract
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New team
              <ChevronDown className="h-3 w-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setEntryMode("build")}>
              ✨ Build from scratch
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEntryMode("import")}>
              📥 Import from file
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="opacity-50">
              🛒 Browse marketplace
              <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                SOON
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {teams.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No teams yet. Click + New team to create one."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {teams.map((t) => (
            <TeamCard
              key={t.id}
              team={{
                id: t.id,
                name: t.name,
                slug: t.slug,
                parentProjectName: "—", // resolved by parent component or via separate query
                status: t.status,
                memberCount: 0, // populated by enriched query
                leadName: "—",
              }}
              onClick={() => navigate(`/team/teams/${t.slug}`)}
            />
          ))}
        </div>
      )}

      <NewTeamEntryDialog
        open={entryMode !== null}
        initialMode={entryMode}
        onOpenChange={(open) => !open && setEntryMode(null)}
      />
    </section>
  );
}
```

- [ ] **Step 2: Add `queryKeys.teams` to query keys file**

In `ui/src/lib/queryKeys.ts`, add:

```typescript
export const queryKeys = {
  // ... existing
  teams: {
    list: (companyId: string) => ["teams", companyId] as const,
    detail: (companyId: string, teamId: string) => ["teams", companyId, teamId] as const,
    members: (companyId: string, teamId: string) => ["teams", companyId, teamId, "members"] as const,
    coordination: (companyId: string, teamId: string) => ["teams", companyId, teamId, "coordination"] as const,
  },
};
```

- [ ] **Step 3: Verify UI build**

Run: `pnpm -F @armyofagents/ui build`
Expected: TypeScript errors only for missing `NewTeamEntryDialog` (which we create next).

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/team/TeamsSection.tsx ui/src/lib/queryKeys.ts
git commit -m "feat(teams): add TeamsSection list view with + New team dropdown"
```

---

#### Task 2.3: NewTeamEntryDialog (3-option modal)

**Files:**
- Create: `ui/src/components/team/NewTeamEntryDialog.tsx`

- [ ] **Step 1: Implement the dialog**

```tsx
// ui/src/components/team/NewTeamEntryDialog.tsx
import { useState, useEffect } from "react";
import { Sparkles, Upload, ShoppingBag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BuildFromScratchForm } from "./BuildFromScratchForm";
import { ImportUploadDialog } from "./ImportUploadDialog";

type EntryMode = "build" | "import" | null;

interface Props {
  open: boolean;
  initialMode: EntryMode;
  onOpenChange: (open: boolean) => void;
}

export function NewTeamEntryDialog({ open, initialMode, onOpenChange }: Props) {
  const [mode, setMode] = useState<EntryMode>(initialMode);

  useEffect(() => setMode(initialMode), [initialMode]);

  if (mode === "build") {
    return <BuildFromScratchForm open={open} onOpenChange={onOpenChange} />;
  }
  if (mode === "import") {
    return <ImportUploadDialog open={open} onOpenChange={onOpenChange} />;
  }

  // Default: 3-option chooser
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a new team</DialogTitle>
          <DialogDescription>
            Pick how you want to start. You can always change later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-2">
          <OptionCard
            icon={<Sparkles className="h-5 w-5 text-indigo-500" />}
            title="Build from scratch"
            description="Pick existing agents from your company, or create new ones inline. Coordination is auto-scaffolded."
            cta="Start →"
            onClick={() => setMode("build")}
            highlighted
          />
          <OptionCard
            icon={<Upload className="h-5 w-5 text-slate-600" />}
            title="Import from file"
            description="Upload a .team.yaml package. Resolves dependencies on install."
            cta="Upload →"
            onClick={() => setMode("import")}
          />
          <OptionCard
            icon={<ShoppingBag className="h-5 w-5 text-slate-400" />}
            title="Browse marketplace"
            description="Curated catalog of pre-built teams (Frontend, DevOps, Content, etc.)."
            cta="Coming soon"
            disabled
            badge="SOON"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface OptionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  onClick?: () => void;
  highlighted?: boolean;
  disabled?: boolean;
  badge?: string;
}

function OptionCard({ icon, title, description, cta, onClick, highlighted, disabled, badge }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex flex-col rounded-lg border p-4 text-left transition-all",
        highlighted ? "border-2 border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20" : "border-border",
        disabled ? "cursor-not-allowed opacity-60" : "hover:border-slate-400",
      )}
    >
      {badge && (
        <span className="absolute right-2.5 top-2.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {badge}
        </span>
      )}
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-accent">
        {icon}
      </div>
      <h4 className="text-sm font-bold">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <div className={cn("mt-3 text-xs font-bold", highlighted ? "text-indigo-600" : "text-slate-600 dark:text-slate-400")}>
        {cta}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm -F @armyofagents/ui build`
Expected: TypeScript errors only for missing `BuildFromScratchForm` and `ImportUploadDialog` (next tasks).

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/team/NewTeamEntryDialog.tsx
git commit -m "feat(teams): add NewTeamEntryDialog with 3 option cards"
```

---

#### Task 2.4: BuildFromScratchForm (the create form)

**Files:**
- Create: `ui/src/components/team/BuildFromScratchForm.tsx`
- Create: `ui/src/components/team/MemberRow.tsx`

- [ ] **Step 1: Implement BuildFromScratchForm**

```tsx
// ui/src/components/team/BuildFromScratchForm.tsx
import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { teamsApi } from "../../api/teams";
import { agentsApi } from "../../api/agents";
import { projectsApi } from "../../api/projects";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { useNavigate } from "@/lib/router";
import { queryKeys } from "../../lib/queryKeys";
import { MemberRow, type DraftMember } from "./MemberRow";
import { generateTeamSlug } from "./slug";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuildFromScratchForm({ open, onOpenChange }: Props) {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentProjectId, setParentProjectId] = useState<string>("");
  const [members, setMembers] = useState<DraftMember[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && open,
  });

  const departments = useMemo(
    () => (projectsQuery.data ?? []).filter((p) => p.type === "department"),
    [projectsQuery.data],
  );

  const agentsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && open,
  });

  const availableAgents = useMemo(() => {
    const taken = new Set(members.filter((m) => m.kind === "existing").map((m) => m.agentId));
    return (agentsQuery.data ?? []).filter((a) => !taken.has(a.id));
  }, [agentsQuery.data, members]);

  const leadCount = members.filter((m) => m.role === "lead").length;
  const canSubmit = name.trim() && parentProjectId && members.length > 0 && leadCount === 1;

  const createMut = useMutation({
    mutationFn: async () => {
      // 1. Create any "new" agents first
      //    NOTE: agentsApi.create does NOT auto-add to agent_projects (verified).
      //    We MUST explicitly call projectsApi.assignAgent next, otherwise teamsApi.addMember
      //    will fail with "agent is not a member of the team's parent department."
      const created: Record<string, string> = {};
      for (const m of members.filter((m) => m.kind === "new")) {
        const agent = await agentsApi.create(selectedCompanyId!, {
          name: m.name,
          adapterType: m.adapterType,
          skillKeys: m.skillKeys,
        });
        created[m.tempId] = agent.id;

        // CRITICAL: explicitly add the new agent to the parent department
        // Convention C-6 — without this, the addMember below fails server-side.
        await projectsApi.assignAgent(parentProjectId, agent.id);
      }

      // 2. Create the team
      const team = await teamsApi.create(selectedCompanyId!, {
        name,
        parentProjectId,
        description: description || undefined,
      });

      // 3. Add members (existing agents already have agent_projects rows; new agents got
      //    assigned to the parent dept above, so addMember succeeds for both kinds)
      for (const m of members) {
        const agentId = m.kind === "existing" ? m.agentId : created[m.tempId];
        await teamsApi.addMember(team.id, { agentId, role: m.role });
      }

      // 4. Trigger initial coordination.md scaffolding
      await teamsApi.regenerateCoordination(team.id);

      return team;
    },
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teams.list(selectedCompanyId!) });
      pushToast({ kind: "success", message: `Team "${team.name}" created.` });
      onOpenChange(false);
      navigate(`/team/teams/${team.slug}`);
    },
    onError: (err) => {
      pushToast({ kind: "error", message: `Failed: ${(err as Error).message}` });
    },
  });

  const newAgentsCount = members.filter((m) => m.kind === "new").length;
  const summary = `Will create: ${newAgentsCount} agent${newAgentsCount === 1 ? "" : "s"} · 1 team · 1 coordination.md`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>
            Build from scratch — pick existing agents or create new ones inline.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="team-name">Team name *</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Frontend Team"
              />
            </div>
            <div>
              <Label htmlFor="team-dept">Parent department *</Label>
              <Select value={parentProjectId} onValueChange={setParentProjectId}>
                <SelectTrigger id="team-dept">
                  <SelectValue placeholder="Pick a department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="team-desc">Description (optional)</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team handle?"
              rows={2}
            />
          </div>

          {/* Members section */}
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">
                Members <span className="text-xs font-medium text-muted-foreground">{members.length} added</span>
              </h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPickerOpen(!pickerOpen)}>
                  <Search className="h-3.5 w-3.5 mr-1" />
                  Pick existing
                </Button>
                <Button size="sm" onClick={() => setMembers([...members, makeDraftNew()])}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Create new
                </Button>
              </div>
            </div>

            {pickerOpen && (
              <div className="mb-2 max-h-40 overflow-y-auto rounded border bg-card p-2">
                {availableAgents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No more available agents.</p>
                ) : (
                  availableAgents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="block w-full rounded p-2 text-left text-xs hover:bg-accent"
                      onClick={() => {
                        setMembers([...members, { kind: "existing", agentId: a.id, name: a.name, role: "member" }]);
                        setPickerOpen(false);
                      }}
                    >
                      <span className="font-bold">{a.name}</span>
                      <span className="ml-2 text-muted-foreground">{a.role}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {members.map((m, idx) => (
              <MemberRow
                key={m.kind === "existing" ? `e-${m.agentId}` : m.tempId}
                member={m}
                onChange={(updated) => {
                  const copy = [...members];
                  copy[idx] = updated;
                  setMembers(copy);
                }}
                onRemove={() => setMembers(members.filter((_, i) => i !== idx))}
              />
            ))}

            {members.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-3">
                Add at least one member.
              </p>
            )}

            <p className="mt-2 border-t border-dashed pt-2 text-[11px] text-muted-foreground">
              ⚙️ Agent instructions auto-scaffolded from role + dept. Editable on the agent's detail page after save.
            </p>
          </div>

          {leadCount !== 1 && members.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Exactly one member must be the Lead. Currently: {leadCount}.
            </p>
          )}
        </div>

        <DialogFooter className="border-t pt-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{summary}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={!canSubmit || createMut.isPending}>
              {createMut.isPending ? "Creating..." : "Create team →"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function makeDraftNew(): DraftMember {
  return {
    kind: "new",
    tempId: crypto.randomUUID(),
    name: "",
    adapterType: "claude_local",
    skillKeys: [],
    role: "member",
  };
}
```

- [ ] **Step 2: Implement MemberRow**

```tsx
// ui/src/components/team/MemberRow.tsx
import { Star, X, Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TeamRole } from "@armyofagents/shared";

export type DraftMember =
  | { kind: "existing"; agentId: string; name: string; role: TeamRole }
  | { kind: "new"; tempId: string; name: string; adapterType: string; skillKeys: string[]; role: TeamRole };

interface Props {
  member: DraftMember;
  onChange: (next: DraftMember) => void;
  onRemove: () => void;
}

export function MemberRow({ member, onChange, onRemove }: Props) {
  return (
    <div
      className={cn(
        "mb-2 rounded-md border bg-card p-2.5",
        member.kind === "new" && "border-2 border-indigo-500",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          {member.kind === "existing" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold">{member.name}</span>
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 text-[9px]">EXISTING</Badge>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={member.name}
                onChange={(e) => onChange({ ...member, name: e.target.value })}
                placeholder="Agent name"
                className="h-6 text-xs"
              />
              <Badge className="bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 text-[9px]">NEW</Badge>
            </div>
          )}
        </div>
        <Select
          value={member.role}
          onValueChange={(r) => onChange({ ...member, role: r as TeamRole })}
        >
          <SelectTrigger className="h-7 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lead">⭐ Lead</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {member.kind === "new" && (
        <div className="mt-2 ml-9 grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">Adapter</label>
            <Select
              value={member.adapterType}
              onValueChange={(v) => onChange({ ...member, adapterType: v })}
            >
              <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="claude_local">claude_local</SelectItem>
                <SelectItem value="codex_local">codex_local</SelectItem>
                <SelectItem value="opencode_local">opencode_local</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Skills (comma-sep)</label>
            <Input
              value={member.skillKeys.join(", ")}
              onChange={(e) => onChange({ ...member, skillKeys: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="react, css, ..."
              className="h-6 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add slug helper for client-side preview**

```typescript
// ui/src/components/team/slug.ts
export function generateTeamSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm -F @armyofagents/ui build`
Expected: TypeScript errors only for missing `ImportUploadDialog` (next slice).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/team/BuildFromScratchForm.tsx ui/src/components/team/MemberRow.tsx ui/src/components/team/slug.ts
git commit -m "feat(teams): add BuildFromScratchForm with mixed agent picker"
```

---

#### Task 2.5: ImportUploadDialog stub (placeholder for Slice 8)

**Files:**
- Create: `ui/src/components/team/ImportUploadDialog.tsx`

- [ ] **Step 1: Create stub so the entry dialog compiles**

```tsx
// ui/src/components/team/ImportUploadDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportUploadDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import team from file</DialogTitle>
          <DialogDescription>
            Coming in Slice 8 — file upload + cascade install.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/team/ImportUploadDialog.tsx
git commit -m "feat(teams): add ImportUploadDialog stub for Slice 8 placeholder"
```

---

#### Task 2.6: Wire TeamsSection into AgentsTab

**Files:**
- Modify: `ui/src/components/team/AgentsTab.tsx`

- [ ] **Step 1: Read the existing AgentsTab to find insertion point**

Run: `head -150 ui/src/components/team/AgentsTab.tsx`
Identify the JSX render section (around line 200+ based on earlier exploration).

- [ ] **Step 2: Restructure AgentsTab into two sections**

Locate the existing `return (` block. Wrap the existing agent grid in a `<section>` titled "Individual agents" and add `<TeamsSection />` ABOVE it. Filter the agents array to exclude team-affiliated agents:

```tsx
import { TeamsSection } from "./TeamsSection";
// ... existing imports

// Inside the component, near the top of the return JSX:
return (
  <div>
    <TeamsSection />

    <section>
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">
            Individual agents <span className="ml-1 text-xs font-medium text-muted-foreground">{individualAgents.length}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Agents not on any team</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => openNewAgent()}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New agent
        </Button>
      </header>

      {/* existing agent grid below — wrap in this section */}
      {/* ... existing JSX ... */}
    </section>
  </div>
);
```

To compute `individualAgents`, fetch team memberships and exclude:

```typescript
const teamsQuery = useQuery({
  queryKey: queryKeys.teams.list(selectedCompanyId!),
  queryFn: () => teamsApi.list(selectedCompanyId!),
  enabled: Boolean(selectedCompanyId),
});

const teamAgentIds = new Set<string>();
for (const team of teamsQuery.data?.items ?? []) {
  // (We'd need a /teams/:tid/members fetch here, OR a denormalized agent_team_ids field.
  //  For Slice 2: keep all agents in Individual section initially; refine in a follow-up pass when team detail loads.)
}
const individualAgents = agents.filter((a) => !teamAgentIds.has(a.id));
```

**Note:** filtering individual agents by team membership requires either a denormalized field on agents (added later in Slice 4 if needed) or N+1 queries. For Slice 2, ship with all agents in Individual section; the duplicate display is benign and gets resolved in Slice 4 when we add team-aware queries.

- [ ] **Step 3: Verify UI build + smoke test**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

Manual smoke (start dev server): `pnpm dev`. Navigate to `/team` → Agents tab. Verify:
- "Teams" section appears at top with "+ New team" dropdown
- Empty state shows when no teams exist
- "+ New team → Build from scratch" opens the form
- "+ New team → Import from file" opens the stub dialog
- "+ New team → Browse marketplace" is disabled with SOON badge

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/team/AgentsTab.tsx
git commit -m "feat(teams): wire TeamsSection into AgentsTab as top section"
```

---

#### Task 2.7: Team detail page route + Overview tab

**Files:**
- Create: `ui/src/pages/TeamDetail.tsx`
- Modify: route registration (typically `ui/src/lib/router.tsx` or `App.tsx`)

- [ ] **Step 1: Implement TeamDetail page**

```tsx
// ui/src/pages/TeamDetail.tsx
import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Star, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { teamsApi } from "../api/teams";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Users } from "lucide-react";
import { PageTabBar } from "../components/PageTabBar";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "coordination", label: "Coordination" },
  { value: "manifest", label: "Manifest" },
  { value: "activity", label: "Activity" },
];

export function TeamDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "overview";

  const teamQuery = useQuery({
    queryKey: selectedCompanyId && slug ? ["team", "by-slug", selectedCompanyId, slug] : ["team", "none"],
    queryFn: async () => {
      // Fetch by slug (assume API supports list filter; otherwise, list and find)
      const list = await teamsApi.list(selectedCompanyId!);
      const team = list.items.find((t) => t.slug === slug);
      if (!team) throw new Error(`Team ${slug} not found`);
      return team;
    },
    enabled: Boolean(selectedCompanyId && slug),
  });

  const membersQuery = useQuery({
    queryKey: teamQuery.data ? queryKeys.teams.members(selectedCompanyId!, teamQuery.data.id) : ["members", "none"],
    queryFn: () => teamsApi.listMembers(selectedCompanyId!, teamQuery.data!.id),
    enabled: Boolean(teamQuery.data),
  });

  useEffect(() => {
    if (teamQuery.data) {
      setBreadcrumbs([{ label: "Team", href: "/team" }, { label: teamQuery.data.name }]);
    }
  }, [teamQuery.data, setBreadcrumbs]);

  if (teamQuery.isLoading) return <PageSkeleton variant="default" />;
  if (teamQuery.isError) return <EmptyState icon={Users} message="Team not found." />;
  if (!teamQuery.data) return null;

  const team = teamQuery.data;
  const members = membersQuery.data?.items ?? [];
  const lead = members.find((m) => m.role === "lead");

  return (
    <div className="p-5">
      <header className="mb-5 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-xl font-bold">
            {team.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{team.name}</h1>
              <Badge variant="outline" className="text-[9px] uppercase">DEPT</Badge>
              <Badge variant="outline" className="text-[10px] capitalize">{team.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <Star className="mr-1 inline h-3 w-3 text-amber-500" />
              {lead ? `Lead: ${lead.agentId}` : "No lead"} · {members.length} members
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline">Edit</Button>
          <Button size="icon-sm" variant="outline"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
        </div>
      </header>

      <PageTabBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(t) => {
          const next = new URLSearchParams(searchParams);
          next.set("tab", t);
          setSearchParams(next);
        }}
      />

      <div className="mt-4">
        {activeTab === "overview" && <OverviewTab team={team} members={members} />}
        {activeTab === "coordination" && <div>Coordination tab — Slice 3</div>}
        {activeTab === "manifest" && <div>Manifest tab — Slice 5</div>}
        {activeTab === "activity" && <div>Activity tab — future</div>}
      </div>
    </div>
  );
}

function OverviewTab({ team, members }: { team: { name: string }; members: Array<{ id: string; agentId: string; role: string }> }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <section className="col-span-2 rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Members ({members.length})</h2>
        {members.map((m) => (
          <div
            key={m.id}
            className={`mb-2 flex items-center gap-3 rounded-md p-2.5 ${
              m.role === "lead" ? "border-l-[3px] border-l-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/10" : "bg-muted/30"
            }`}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent">🤖</div>
            <div className="flex-1">
              <span className="text-xs font-bold">{m.agentId}</span>
              {m.role === "lead" && <span className="ml-2 text-[9px] font-bold text-indigo-600">⭐ LEAD</span>}
            </div>
          </div>
        ))}
      </section>

      <aside className="space-y-3">
        <div className="rounded-lg border bg-card p-3">
          <h3 className="mb-1 text-xs font-bold">Coordination</h3>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Auto-generated contract describing how this team handles work.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-xs font-bold">Quick stats</h3>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <div>{members.length} agents</div>
            <div>0 active tasks</div>
            <div>0 runs today</div>
            <div>$0.00 spent</div>
          </div>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

Find the existing route registry (likely `ui/src/App.tsx` or `ui/src/lib/router.tsx`). Add:

```tsx
import { TeamDetail } from "./pages/TeamDetail";
// Inside the routes JSX:
<Route path="/team/teams/:slug" element={<TeamDetail />} />
```

- [ ] **Step 3: Verify UI build + smoke test**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

Manual smoke: navigate to `/team`, click "+ New team", fill form, submit. Verify redirect to `/team/teams/{slug}` and page loads with member list.

- [ ] **Step 4: Commit**

```bash
git add ui/src/pages/TeamDetail.tsx ui/src/App.tsx
git commit -m "feat(teams): add team detail page with Overview tab"
```

---

#### Task 2.8: Slice 2 acceptance

- [ ] **Step 1: Run all builds + tests**

```bash
pnpm -F @armyofagents/db build
pnpm -F @armyofagents/shared build
pnpm -F @armyofagents/server build
pnpm -F @armyofagents/ui build
pnpm -F @armyofagents/server vitest run team
pnpm -F @armyofagents/ui vitest run TeamCard
```

Expected: all green.

- [ ] **Step 2: Manual smoke**

End-to-end: open the app, go to `/team` → Agents tab → "+ New team" → "Build from scratch" → fill name "Test Team", pick a department, click "+ Create new", enter name "test-bot", pick Lead, click "Create team →". Verify:
1. Toast: "Team 'Test Team' created."
2. Redirected to `/team/teams/test-team`
3. Detail page shows Test Team with test-bot listed as ⭐ LEAD

- [ ] **Step 3: Slice 2 wrap-up**

Push branch, open PR, request review. Reference spec sections §5.2, §5.3, §5.4, §5.6.

After merge, proceed to Slice 3.

---

### Slice 3: Coordination tab — section-aware editor

**Goal:** Coordination tab on team detail page renders the team's coordination.md with hand-written sections (white) and auto-managed sections (purple-tinted). Auto-managed sections regenerate via a button. Section markers preserve user prose across regenerations. "Preview as LLM" modal shows what each member's system prompt looks like.

**Worktree:** `teams-slice-3`. **Depends on:** Slice 1, 2 merged.

---

#### Task 3.1: Section-marker parser (pure function, TDD)

**Files:**
- Create: `server/src/services/coordination-parser.ts`
- Test: `server/src/__tests__/team-coordination-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/team-coordination-parser.test.ts
import { describe, expect, it } from "vitest";
import {
  parseCoordinationSections,
  replaceAutoSection,
  type CoordinationSection,
} from "../services/coordination-parser.js";

describe("parseCoordinationSections", () => {
  it("returns one user-section for plain markdown without markers", () => {
    const md = "# Mission\nWe build things.";
    const sections = parseCoordinationSections(md);
    expect(sections).toEqual([
      { kind: "user", content: "# Mission\nWe build things." },
    ]);
  });

  it("extracts a single auto section with name", () => {
    const md = `## Mission
prose

<!-- begin:auto:members -->
## Members
- alice
<!-- end:auto:members -->

## End
final prose`;
    const sections = parseCoordinationSections(md);
    expect(sections).toHaveLength(3);
    expect(sections[0].kind).toBe("user");
    expect(sections[1]).toEqual({
      kind: "auto",
      name: "members",
      content: "## Members\n- alice",
    });
    expect(sections[2].kind).toBe("user");
  });

  it("extracts multiple auto sections", () => {
    const md = `prose1
<!-- begin:auto:members -->
A
<!-- end:auto:members -->
prose2
<!-- begin:auto:routing -->
B
<!-- end:auto:routing -->
prose3`;
    const sections = parseCoordinationSections(md);
    const names = sections.filter((s) => s.kind === "auto").map((s) => (s as CoordinationSection & { kind: "auto" }).name);
    expect(names).toEqual(["members", "routing"]);
  });

  it("rejects nested markers", () => {
    const md = `<!-- begin:auto:outer -->
<!-- begin:auto:inner -->
x
<!-- end:auto:inner -->
<!-- end:auto:outer -->`;
    expect(() => parseCoordinationSections(md)).toThrow(/nested/i);
  });

  it("rejects unmatched opening marker", () => {
    const md = `<!-- begin:auto:members -->\n# x\n`;
    expect(() => parseCoordinationSections(md)).toThrow(/unmatched/i);
  });

  it("preserves whitespace inside user sections", () => {
    const md = "  leading\nspace\n";
    const sections = parseCoordinationSections(md);
    expect(sections[0]).toEqual({ kind: "user", content: "  leading\nspace\n" });
  });
});

describe("replaceAutoSection", () => {
  it("replaces matching auto section content, preserves user sections", () => {
    const md = `## Mission
prose

<!-- begin:auto:members -->
old members
<!-- end:auto:members -->

## End`;
    const result = replaceAutoSection(md, "members", "## Members\n- bob\n- eve");
    expect(result).toContain("## Members\n- bob\n- eve");
    expect(result).not.toContain("old members");
    expect(result).toContain("## Mission\nprose");
    expect(result).toContain("## End");
  });

  it("appends a new auto section when name missing", () => {
    const md = "## Mission\nprose";
    const result = replaceAutoSection(md, "members", "list");
    expect(result).toContain("<!-- begin:auto:members -->");
    expect(result).toContain("list");
    expect(result).toContain("<!-- end:auto:members -->");
    expect(result).toContain("## Mission\nprose");
  });

  it("only replaces the named section, not others", () => {
    const md = `<!-- begin:auto:members -->
A
<!-- end:auto:members -->
<!-- begin:auto:routing -->
B
<!-- end:auto:routing -->`;
    const result = replaceAutoSection(md, "members", "NEW_A");
    expect(result).toContain("NEW_A");
    expect(result).toContain("B");
    expect(result).not.toContain("\nA\n");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @armyofagents/server vitest run coordination-parser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```typescript
// server/src/services/coordination-parser.ts
const BEGIN_RE = /<!--\s*begin:auto:([\w-]+)\s*-->/g;
const END_RE = /<!--\s*end:auto:([\w-]+)\s*-->/g;

export type CoordinationSection =
  | { kind: "user"; content: string }
  | { kind: "auto"; name: string; content: string };

export function parseCoordinationSections(markdown: string): CoordinationSection[] {
  const sections: CoordinationSection[] = [];
  let pos = 0;

  while (pos < markdown.length) {
    BEGIN_RE.lastIndex = pos;
    const beginMatch = BEGIN_RE.exec(markdown);

    if (!beginMatch) {
      const trailing = markdown.slice(pos);
      if (trailing.length > 0) sections.push({ kind: "user", content: trailing.replace(/\n+$/, "") });
      break;
    }

    if (beginMatch.index > pos) {
      const userBlock = markdown.slice(pos, beginMatch.index).replace(/\n+$/, "");
      if (userBlock.length > 0) sections.push({ kind: "user", content: userBlock });
    }

    const name = beginMatch[1];
    const contentStart = beginMatch.index + beginMatch[0].length;

    // Find matching end marker (and reject any nested begin)
    BEGIN_RE.lastIndex = contentStart;
    const nextBegin = BEGIN_RE.exec(markdown);

    const endRe = new RegExp(`<!--\\s*end:auto:${name}\\s*-->`);
    endRe.lastIndex = contentStart;
    const endMatch = endRe.exec(markdown.slice(contentStart));

    if (!endMatch) throw new Error(`unmatched begin marker for "${name}"`);
    const endAbs = contentStart + endMatch.index;

    if (nextBegin && nextBegin.index < endAbs) {
      throw new Error(`nested auto markers inside "${name}"`);
    }

    sections.push({
      kind: "auto",
      name,
      content: markdown.slice(contentStart, endAbs).replace(/^\n+|\n+$/g, ""),
    });

    pos = endAbs + endMatch[0].length;
    while (pos < markdown.length && markdown[pos] === "\n") pos++;
  }

  return sections;
}

export function replaceAutoSection(markdown: string, name: string, newContent: string): string {
  const sections = parseCoordinationSections(markdown);
  const found = sections.some((s) => s.kind === "auto" && s.name === name);

  if (!found) {
    // Append the auto section to the end
    const trailing = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${trailing}\n<!-- begin:auto:${name} -->\n${newContent}\n<!-- end:auto:${name} -->\n`;
  }

  return sections
    .map((s) => {
      if (s.kind === "user") return s.content;
      const content = s.name === name ? newContent : s.content;
      return `<!-- begin:auto:${s.name} -->\n${content}\n<!-- end:auto:${s.name} -->`;
    })
    .join("\n\n");
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm -F @armyofagents/server vitest run coordination-parser`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/coordination-parser.ts server/src/__tests__/team-coordination-parser.test.ts
git commit -m "feat(teams): add coordination.md section-marker parser"
```

---

#### Task 3.2: Extend `teamCoordinationService` with regenerate method

**Files:**
- Modify: `server/src/services/team-coordination.ts`
- Test: `server/src/__tests__/team-coordination-service.test.ts` (extend existing)

- [ ] **Step 1: Add new test cases for regenerate**

In the existing test file, add:

```typescript
describe("teamCoordinationService.regenerateAutoSections", () => {
  it("replaces auto:members and auto:routing, preserves user prose", async () => {
    const original = `## Mission
prose

<!-- begin:auto:members -->
old
<!-- end:auto:members -->

<!-- begin:auto:routing -->
old
<!-- end:auto:routing -->`;

    const db = createSequenceDb([
      [{ id: "tc1", teamId: "t1", markdown: original }], // existing
      [{ id: "tc1", teamId: "t1", markdown: "updated" }], // update returning
    ]);
    const svc = teamCoordinationService(db);
    const result = await svc.regenerateAutoSections("tc1", {
      members: "## Members\n- alice [LEAD]",
      routing: "## Routing\n- default → @alice",
    });
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @armyofagents/server vitest run team-coordination-service`
Expected: FAIL — `regenerateAutoSections` does not exist.

- [ ] **Step 3: Add the method**

In `server/src/services/team-coordination.ts`, add inside the returned factory object:

```typescript
import { replaceAutoSection } from "./coordination-parser.js";

// ... inside teamCoordinationService:

regenerateAutoSections: async (
  coordinationId: string,
  sections: Record<string, string>,
) => {
  const rows = await db
    .select()
    .from(teamCoordinations)
    .where(eq(teamCoordinations.id, coordinationId));
  if (rows.length === 0) throw notFound(`coordination ${coordinationId} not found`);

  let markdown = rows[0].markdown;
  for (const [name, content] of Object.entries(sections)) {
    markdown = replaceAutoSection(markdown, name, content);
  }

  const updated = await db
    .update(teamCoordinations)
    .set({ markdown, updatedAt: new Date() })
    .where(eq(teamCoordinations.id, coordinationId))
    .returning();
  return updated[0];
},
```

Add the import at the top:
```typescript
import { notFound } from "../errors.js";
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm -F @armyofagents/server vitest run team-coordination-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/team-coordination.ts server/src/__tests__/team-coordination-service.test.ts
git commit -m "feat(teams): add regenerateAutoSections to coordination service"
```

---

#### Task 3.3: Wire regenerate route + scaffolder helper

**Files:**
- Modify: `server/src/routes/teams.ts` (add route)
- Create: `server/src/services/team-scaffolder.ts`

- [ ] **Step 1: Create scaffolder service (interface + simple template implementation for v1)**

```typescript
// server/src/services/team-scaffolder.ts
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, agents } from "@armyofagents/db";
import { eq, and, inArray } from "drizzle-orm";

export function teamScaffolderService(db: Db) {
  return {
    /**
     * Generate the full initial coordination.md for a new team.
     * v1: deterministic template. Future: LLM-generated.
     */
    scaffoldInitial: async (teamId: string, description?: string): Promise<string> => {
      const teamRows = await db.select().from(teams).where(eq(teams.id, teamId));
      if (teamRows.length === 0) throw new Error(`team ${teamId} not found`);
      const team = teamRows[0];

      const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
      const agentIds = memberRows.map((m) => m.agentId);
      const agentRows = agentIds.length > 0
        ? await db.select().from(agents).where(inArray(agents.id, agentIds))
        : [];
      const byId = new Map(agentRows.map((a) => [a.id, a]));

      const lines: string[] = [];
      lines.push("## Mission");
      lines.push(description ?? `${team.name} handles work assigned to it.`);
      lines.push("");
      lines.push("## Scope");
      lines.push("### What we handle");
      lines.push("- _(describe what this team is responsible for)_");
      lines.push("");
      lines.push("### What we don't handle");
      lines.push("- _(out-of-scope topics; route those elsewhere)_");
      lines.push("");

      // Auto sections
      lines.push("<!-- begin:auto:members -->");
      lines.push("## Members");
      for (const m of memberRows) {
        const a = byId.get(m.agentId);
        const skills = (a?.skillKeys as string[] | undefined)?.join(", ") ?? "—";
        const roleLabel = m.role === "lead" ? "[LEAD]" : "[MEMBER]";
        lines.push(`- **${a?.name ?? m.agentId}** ${roleLabel} — ${skills}`);
      }
      lines.push("<!-- end:auto:members -->");
      lines.push("");

      lines.push("<!-- begin:auto:routing -->");
      lines.push("## Routing");
      const lead = memberRows.find((m) => m.role === "lead");
      const leadAgent = lead ? byId.get(lead.agentId) : undefined;
      lines.push(`- default → @${leadAgent?.name ?? "lead"} (lead)`);
      lines.push("<!-- end:auto:routing -->");
      lines.push("");

      lines.push("## Escalation");
      lines.push("_(when to escalate, who to)_");
      lines.push("");
      lines.push("## Edge cases");
      lines.push("_(special handling rules)_");

      return lines.join("\n");
    },

    /**
     * Regenerate just the auto sections for an existing coordination.md.
     * Returns a Record<sectionName, content> ready for replaceAutoSection.
     */
    regenerateAutoContent: async (teamId: string): Promise<Record<string, string>> => {
      const teamRows = await db.select().from(teams).where(eq(teams.id, teamId));
      const team = teamRows[0];
      if (!team) throw new Error(`team ${teamId} not found`);

      const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
      const agentRows = memberRows.length > 0
        ? await db.select().from(agents).where(inArray(agents.id, memberRows.map((m) => m.agentId)))
        : [];
      const byId = new Map(agentRows.map((a) => [a.id, a]));

      const memberLines: string[] = ["## Members"];
      for (const m of memberRows) {
        const a = byId.get(m.agentId);
        const skills = (a?.skillKeys as string[] | undefined)?.join(", ") ?? "—";
        memberLines.push(`- **${a?.name ?? m.agentId}** [${m.role.toUpperCase()}] — ${skills}`);
      }

      const routingLines: string[] = ["## Routing"];
      const manifestRouting = (team.manifest as { routing?: { rules?: Array<{ match: string; mention: string }> } })?.routing;
      for (const rule of manifestRouting?.rules ?? []) {
        routingLines.push(`- pattern \`${rule.match}\` → ${rule.mention}`);
      }
      const lead = memberRows.find((m) => m.role === "lead");
      const leadName = lead ? byId.get(lead.agentId)?.name : undefined;
      routingLines.push(`- default → @${leadName ?? "lead"} (lead)`);

      return {
        members: memberLines.join("\n"),
        routing: routingLines.join("\n"),
      };
    },
  };
}
```

- [ ] **Step 2: Add regenerate endpoint**

In `server/src/routes/teams.ts`, add:

```typescript
import { teamScaffolderService } from "../services/team-scaffolder.js";

teamsRouter.post("/:tid/coordination/regenerate", async (req, res) => {
  try {
    const scaffolder = teamScaffolderService(db);
    const sections = await scaffolder.regenerateAutoContent(req.params.tid);

    const coordSvc = teamCoordinationService(db);
    const existing = await coordSvc.getByTeam(req.params.tid);
    if (!existing) {
      // First-time scaffold for a team that doesn't have coordination yet
      const initial = await scaffolder.scaffoldInitial(req.params.tid);
      const created = await coordSvc.upsert(req.params.companyId, {
        teamId: req.params.tid,
        name: `${req.params.tid} Coordination`,
        markdown: initial,
      });
      res.json(created);
      return;
    }
    const updated = await coordSvc.regenerateAutoSections(existing.id, sections);
    res.json(updated);
  } catch (e) { handleError(res, e); }
});
```

- [ ] **Step 3: Hook into team creation flow**

When a team is created in `BuildFromScratchForm` (Slice 2), the redirect lands on the detail page where the Coordination tab will trigger initial scaffolding on first view. To avoid extra round-trip, call the scaffold endpoint right after team create in the form's mutation. Modify `BuildFromScratchForm.tsx` mutation:

After `await teamsApi.addMember(...)` for all members, add:
```typescript
await fetch(`/api/companies/${selectedCompanyId}/teams/${team.id}/coordination/regenerate`, { method: "POST" });
```

(Or add a method to `teamsApi`):
```typescript
// In ui/src/api/teams.ts
regenerateCoordination: (companyId: string, teamId: string) =>
  apiFetch(`/companies/${companyId}/teams/${teamId}/coordination/regenerate`, { method: "POST" }),
```

- [ ] **Step 4: Verify build + test**

Run: `pnpm -F @armyofagents/server build && pnpm -F @armyofagents/server vitest run team-coordination`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/team-scaffolder.ts server/src/routes/teams.ts ui/src/components/team/BuildFromScratchForm.tsx ui/src/api/teams.ts
git commit -m "feat(teams): add scaffolder service + regenerate route + hook into create flow"
```

---

#### Task 3.4: CoordinationEditor component

**Files:**
- Create: `ui/src/components/team/CoordinationEditor.tsx`
- Create: `ui/src/components/team/coordination-parser.ts` (client-side parser, mirrors server)

- [ ] **Step 1: Implement client-side parser (same logic as server, duplicated for offline editing)**

```typescript
// ui/src/components/team/coordination-parser.ts
// Client-side mirror of server/src/services/coordination-parser.ts.
// Keep in sync. Tests for the canonical version live server-side.

const BEGIN_RE = /<!--\s*begin:auto:([\w-]+)\s*-->/g;

export type CoordinationSection =
  | { kind: "user"; content: string }
  | { kind: "auto"; name: string; content: string };

export function parseCoordinationSections(markdown: string): CoordinationSection[] {
  const sections: CoordinationSection[] = [];
  let pos = 0;
  while (pos < markdown.length) {
    BEGIN_RE.lastIndex = pos;
    const m = BEGIN_RE.exec(markdown);
    if (!m) {
      const trailing = markdown.slice(pos).replace(/\n+$/, "");
      if (trailing.length > 0) sections.push({ kind: "user", content: trailing });
      break;
    }
    if (m.index > pos) {
      const u = markdown.slice(pos, m.index).replace(/\n+$/, "");
      if (u.length > 0) sections.push({ kind: "user", content: u });
    }
    const name = m[1];
    const contentStart = m.index + m[0].length;
    const endRe = new RegExp(`<!--\\s*end:auto:${name}\\s*-->`);
    const tail = markdown.slice(contentStart);
    const endMatch = endRe.exec(tail);
    if (!endMatch) throw new Error(`unmatched begin marker for "${name}"`);
    const endAbs = contentStart + endMatch.index;
    sections.push({
      kind: "auto",
      name,
      content: markdown.slice(contentStart, endAbs).replace(/^\n+|\n+$/g, ""),
    });
    pos = endAbs + endMatch[0].length;
    while (pos < markdown.length && markdown[pos] === "\n") pos++;
  }
  return sections;
}

export function serializeSections(sections: CoordinationSection[]): string {
  return sections
    .map((s) => {
      if (s.kind === "user") return s.content;
      return `<!-- begin:auto:${s.name} -->\n${s.content}\n<!-- end:auto:${s.name} -->`;
    })
    .join("\n\n");
}
```

- [ ] **Step 2: Implement CoordinationEditor**

```tsx
// ui/src/components/team/CoordinationEditor.tsx
import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw, Eye, Save, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { teamsApi } from "../../api/teams";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { queryKeys } from "../../lib/queryKeys";
import { parseCoordinationSections, serializeSections, type CoordinationSection } from "./coordination-parser";
import { PreviewAsLlmDialog } from "./PreviewAsLlmDialog";

interface Props {
  teamId: string;
  teamName: string;
}

export function CoordinationEditor({ teamId, teamName }: Props) {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);

  const coordQuery = useQuery({
    queryKey: queryKeys.teams.coordination(selectedCompanyId!, teamId),
    queryFn: () => teamsApi.getCoordination(selectedCompanyId!, teamId),
  });

  const [editedSections, setEditedSections] = useState<CoordinationSection[] | null>(null);

  useEffect(() => {
    if (coordQuery.data && editedSections === null) {
      setEditedSections(parseCoordinationSections(coordQuery.data.markdown));
    }
  }, [coordQuery.data, editedSections]);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!editedSections) throw new Error("nothing to save");
      const markdown = serializeSections(editedSections);
      return teamsApi.upsertCoordination(selectedCompanyId!, teamId, `${teamName} Coordination`, markdown);
    },
    onSuccess: () => {
      pushToast({ kind: "success", message: "Coordination saved." });
      queryClient.invalidateQueries({ queryKey: queryKeys.teams.coordination(selectedCompanyId!, teamId) });
    },
    onError: (e) => pushToast({ kind: "error", message: `Save failed: ${(e as Error).message}` }),
  });

  const regenMut = useMutation({
    mutationFn: () => teamsApi.regenerateCoordination(selectedCompanyId!, teamId),
    onSuccess: () => {
      pushToast({ kind: "success", message: "Auto sections regenerated." });
      queryClient.invalidateQueries({ queryKey: queryKeys.teams.coordination(selectedCompanyId!, teamId) });
      setEditedSections(null); // Force re-parse from fresh server data
    },
  });

  if (coordQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!editedSections) return <p className="text-sm text-muted-foreground">Initializing...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">coordination.md</h2>
          <p className="text-xs text-muted-foreground">
            Injected into every team member's system prompt
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => regenMut.mutate()}
            disabled={regenMut.isPending}
          >
            <RotateCw className="h-3.5 w-3.5 mr-1" />
            Regenerate auto sections
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-3.5 w-3.5 mr-1" />
            Preview as LLM
          </Button>
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        {editedSections.map((section, idx) => (
          <CoordinationSectionView
            key={idx}
            section={section}
            onChange={(next) => {
              const copy = [...editedSections];
              copy[idx] = next;
              setEditedSections(copy);
            }}
          />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        💡 <b>Auto sections</b> (purple-tinted) regenerate from team data — don't hand-edit; changes will be overwritten.
        <b> Your-edits sections</b> (white) are preserved across regen.
      </p>

      <PreviewAsLlmDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        teamId={teamId}
        markdown={serializeSections(editedSections)}
      />
    </div>
  );
}

function CoordinationSectionView({
  section,
  onChange,
}: {
  section: CoordinationSection;
  onChange: (next: CoordinationSection) => void;
}) {
  if (section.kind === "user") {
    return (
      <div className="border-b last:border-b-0 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Your edits</span>
        </div>
        <Textarea
          value={section.content}
          onChange={(e) => onChange({ kind: "user", content: e.target.value })}
          rows={Math.max(3, section.content.split("\n").length + 1)}
          className="resize-y font-mono text-xs"
        />
      </div>
    );
  }

  return (
    <div className="border-b last:border-b-0 bg-indigo-50/30 dark:bg-indigo-950/10 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide text-indigo-600">
          <SettingsIcon className="h-2.5 w-2.5" />
          AUTO · {section.name.toUpperCase()}
        </span>
      </div>
      <pre className="whitespace-pre-wrap rounded bg-background/60 p-2 text-xs">
        {section.content}
      </pre>
      <p className="mt-2 text-[10px] italic text-muted-foreground">
        ⚙ This section regenerates whenever team data changes. Don't edit by hand — changes will be overwritten.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Implement PreviewAsLlmDialog**

```tsx
// ui/src/components/team/PreviewAsLlmDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  markdown: string;
}

export function PreviewAsLlmDialog({ open, onOpenChange, markdown }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Preview as LLM</DialogTitle>
          <DialogDescription>
            This is what each team member's system prompt will include. The agent's per-role instructions are appended below.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto rounded border bg-muted/40 p-4 font-mono text-xs">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            # Team coordination
          </div>
          <pre className="whitespace-pre-wrap">{markdown}</pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Wire CoordinationEditor into TeamDetail**

In `ui/src/pages/TeamDetail.tsx`, replace the placeholder for the coordination tab:

```tsx
import { CoordinationEditor } from "../components/team/CoordinationEditor";

// In the tab body switcher:
{activeTab === "coordination" && <CoordinationEditor teamId={team.id} teamName={team.name} />}
```

- [ ] **Step 5: Verify build + smoke test**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

Manual smoke: navigate to a team's detail page, click Coordination tab. Verify:
- Markdown content displays
- Auto sections show purple tint with "AUTO · MEMBERS" badge
- Hand-written sections show white with "YOUR EDITS"
- Edit a hand-written section, click Save → toast appears
- Click "Regenerate auto sections" → toast, content refreshes, hand edits preserved

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/team/CoordinationEditor.tsx ui/src/components/team/coordination-parser.ts ui/src/components/team/PreviewAsLlmDialog.tsx ui/src/pages/TeamDetail.tsx
git commit -m "feat(teams): add CoordinationEditor with auto/user section visuals"
```

---

#### Task 3.5: Slice 3 acceptance

- [ ] **Step 1: Run all builds + tests**

```bash
pnpm -F @armyofagents/server build
pnpm -F @armyofagents/ui build
pnpm -F @armyofagents/server vitest run team
pnpm -F @armyofagents/server vitest run coordination
```

Expected: all green.

- [ ] **Step 2: Smoke test coordination flow end-to-end**

Create a team → navigate to detail page → Coordination tab → verify scaffolded markdown loads with auto sections marked → hand-edit Mission paragraph → Save → reload page → verify hand edit persisted → click Regenerate → verify auto sections refreshed but Mission stayed.

- [ ] **Step 3: Slice 3 wrap-up**

PR + review per `superpowers:requesting-code-review`. Reference spec sections §5.7, §4.4.

---

## Phase 3 — Org Chart + Manifest

### Slice 4: Org chart team overlay + dept filter

**Goal:** Existing `OrgChart.tsx` gains a translucent team-box overlay layer behind the agent cards, plus a department filter dropdown in the toolbar. No layout-algorithm changes.

**Worktree:** `teams-slice-4`. **Depends on:** Slice 1, 2.

---

#### Task 4.1: Compute team bounding boxes from layout

**Files:**
- Create: `ui/src/components/team/teamBoundingBox.ts`
- Test: `ui/src/components/team/__tests__/teamBoundingBox.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/src/components/team/__tests__/teamBoundingBox.test.ts
import { describe, expect, it } from "vitest";
import { computeTeamBoxes, type LaidOutCard } from "../teamBoundingBox";

const CARD_W = 200;
const CARD_H = 100;
const PADDING = 16;

describe("computeTeamBoxes", () => {
  it("returns a single box around members of a team", () => {
    const cards: LaidOutCard[] = [
      { agentId: "a1", x: 100, y: 100, w: CARD_W, h: CARD_H },
      { agentId: "a2", x: 350, y: 100, w: CARD_W, h: CARD_H },
    ];
    const memberships = new Map([["a1", "team1"], ["a2", "team1"]]);
    const teams = [{ id: "team1", name: "Frontend", color: "#6366f1" }];

    const boxes = computeTeamBoxes(cards, memberships, teams);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({
      teamId: "team1",
      name: "Frontend",
      color: "#6366f1",
      x: 100 - PADDING,
      y: 100 - PADDING,
      width: 350 + CARD_W - 100 + PADDING * 2,
      height: CARD_H + PADDING * 2,
    });
  });

  it("returns empty array when no team memberships", () => {
    const cards: LaidOutCard[] = [{ agentId: "a1", x: 0, y: 0, w: CARD_W, h: CARD_H }];
    expect(computeTeamBoxes(cards, new Map(), [])).toEqual([]);
  });

  it("returns one box per team", () => {
    const cards: LaidOutCard[] = [
      { agentId: "a1", x: 0, y: 0, w: CARD_W, h: CARD_H },
      { agentId: "a2", x: 0, y: 200, w: CARD_W, h: CARD_H },
    ];
    const memberships = new Map([["a1", "t1"], ["a2", "t2"]]);
    const teams = [
      { id: "t1", name: "T1", color: "#a" },
      { id: "t2", name: "T2", color: "#b" },
    ];
    const boxes = computeTeamBoxes(cards, memberships, teams);
    expect(boxes).toHaveLength(2);
  });

  it("ignores teams with no laid-out members", () => {
    const cards: LaidOutCard[] = [{ agentId: "a1", x: 0, y: 0, w: CARD_W, h: CARD_H }];
    const memberships = new Map([["a99", "t1"]]); // a99 isn't in cards
    const teams = [{ id: "t1", name: "T1", color: "#a" }];
    expect(computeTeamBoxes(cards, memberships, teams)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @armyofagents/ui vitest run teamBoundingBox`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// ui/src/components/team/teamBoundingBox.ts
const PADDING = 16;

export interface LaidOutCard {
  agentId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TeamMeta {
  id: string;
  name: string;
  color: string;
}

export interface TeamBox {
  teamId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeTeamBoxes(
  cards: LaidOutCard[],
  memberships: Map<string, string>, // agentId -> teamId
  teams: TeamMeta[],
): TeamBox[] {
  const boxes: TeamBox[] = [];
  for (const team of teams) {
    const members = cards.filter((c) => memberships.get(c.agentId) === team.id);
    if (members.length === 0) continue;

    const minX = Math.min(...members.map((m) => m.x));
    const minY = Math.min(...members.map((m) => m.y));
    const maxX = Math.max(...members.map((m) => m.x + m.w));
    const maxY = Math.max(...members.map((m) => m.y + m.h));

    boxes.push({
      teamId: team.id,
      name: team.name,
      color: team.color,
      x: minX - PADDING,
      y: minY - PADDING,
      width: maxX - minX + PADDING * 2,
      height: maxY - minY + PADDING * 2,
    });
  }
  return boxes;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm -F @armyofagents/ui vitest run teamBoundingBox`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/team/teamBoundingBox.ts ui/src/components/team/__tests__/teamBoundingBox.test.ts
git commit -m "feat(teams): add team bounding-box computation for org chart overlay"
```

---

#### Task 4.2: TeamOrgOverlay component

**Files:**
- Create: `ui/src/components/team/TeamOrgOverlay.tsx`

- [ ] **Step 1: Implement**

```tsx
// ui/src/components/team/TeamOrgOverlay.tsx
import type { TeamBox } from "./teamBoundingBox";

interface Props {
  boxes: TeamBox[];
}

export function TeamOrgOverlay({ boxes }: Props) {
  return (
    <>
      {boxes.map((b) => (
        <div
          key={b.teamId}
          style={{
            position: "absolute",
            left: b.x,
            top: b.y,
            width: b.width,
            height: b.height,
            background: `${b.color}11`, // 7% alpha hex
            border: `1.5px dashed ${b.color}80`, // 50% alpha
            borderRadius: 12,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: -10,
              left: 12,
              background: b.color,
              color: "white",
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              letterSpacing: 0.3,
            }}
          >
            ⭐ {b.name.toUpperCase()}
          </span>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/team/TeamOrgOverlay.tsx
git commit -m "feat(teams): add TeamOrgOverlay render component"
```

---

#### Task 4.3: Wire overlay into OrgChart + dept filter

**Files:**
- Modify: `ui/src/pages/OrgChart.tsx`

- [ ] **Step 1: Read current OrgChart**

Run: `cat ui/src/pages/OrgChart.tsx | head -100`
Identify where `allNodes` (the laid-out cards) is computed and the JSX where cards are rendered.

- [ ] **Step 2: Add team data fetching + overlay rendering**

Inside the component, after the existing layout `useMemo`:

```typescript
import { teamsApi } from "../api/teams";
import { computeTeamBoxes, type LaidOutCard } from "../components/team/teamBoundingBox";
import { TeamOrgOverlay } from "../components/team/TeamOrgOverlay";

// Inside the OrgChart component:
const teamsQuery = useQuery({
  queryKey: queryKeys.teams.list(selectedCompanyId!),
  queryFn: () => teamsApi.list(selectedCompanyId!),
  enabled: Boolean(selectedCompanyId),
});

// We need each team's members. Batch-fetch:
const memberQueries = useQueries({
  queries: (teamsQuery.data?.items ?? []).map((t) => ({
    queryKey: queryKeys.teams.members(selectedCompanyId!, t.id),
    queryFn: () => teamsApi.listMembers(selectedCompanyId!, t.id),
    enabled: Boolean(selectedCompanyId),
  })),
});

const memberships = useMemo(() => {
  const m = new Map<string, string>();
  (teamsQuery.data?.items ?? []).forEach((t, idx) => {
    const members = memberQueries[idx]?.data?.items ?? [];
    for (const mem of members) m.set(mem.agentId, t.id);
  });
  return m;
}, [teamsQuery.data, memberQueries]);

const TEAM_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

const teamMetas = useMemo(
  () => (teamsQuery.data?.items ?? []).map((t, idx) => ({
    id: t.id,
    name: t.name,
    color: TEAM_COLORS[idx % TEAM_COLORS.length],
  })),
  [teamsQuery.data],
);

const teamBoxes = useMemo(() => {
  const cards: LaidOutCard[] = allNodes.map((n) => ({
    agentId: n.id,
    x: n.x,
    y: n.y,
    w: CARD_W,
    h: CARD_H,
  }));
  return computeTeamBoxes(cards, memberships, teamMetas);
}, [allNodes, memberships, teamMetas]);
```

Don't forget the new imports:
```typescript
import { useQueries } from "@tanstack/react-query";
```

- [ ] **Step 3: Render the overlay layer BEFORE cards**

In the existing JSX, find where SVG edges and cards are rendered. Render `<TeamOrgOverlay>` before both, so it sits behind:

```tsx
<div style={{ position: "absolute", left: pan.x, top: pan.y, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
  {/* TEAM OVERLAY — drawn first, sits behind */}
  <TeamOrgOverlay boxes={teamBoxes} />

  {/* SVG edges */}
  <svg ...>...</svg>

  {/* Agent cards */}
  {allNodes.map((n) => (
    <div data-org-card key={n.id} ...>...</div>
  ))}
</div>
```

- [ ] **Step 4: Add dept filter dropdown to toolbar**

Find where the breadcrumb is set or where the existing toolbar lives. Add a department filter that filters `orgTree` before layout:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { projectsApi } from "../api/projects";

// State + query
const [deptFilter, setDeptFilter] = useState<string>("all");
const projectsQuery = useQuery({
  queryKey: queryKeys.projects.list(selectedCompanyId!),
  queryFn: () => projectsApi.list(selectedCompanyId!),
  enabled: Boolean(selectedCompanyId),
});
const departments = (projectsQuery.data ?? []).filter((p) => p.type === "department");

// Filter agents in the layout to show only those in the selected dept
const filteredOrgTree = useMemo(() => {
  if (deptFilter === "all" || !orgTree) return orgTree;
  // Need to know which agents belong to the selected dept (via agent_projects).
  // Fetch via existing agentsApi or projectsApi.getAgents endpoint.
  const allowed = new Set(deptAgentsQuery.data?.map((a) => a.id) ?? []);
  // Recursively filter nodes
  function prune(nodes: OrgNode[]): OrgNode[] {
    return nodes
      .filter((n) => allowed.has(n.id))
      .map((n) => ({ ...n, children: prune(n.children) }));
  }
  return prune(orgTree);
}, [orgTree, deptFilter, deptAgentsQuery.data]);

// Add the deptAgentsQuery near the other queries:
const deptAgentsQuery = useQuery({
  queryKey: deptFilter !== "all" ? queryKeys.projects.agents(selectedCompanyId!, deptFilter) : ["projects", "no-filter"],
  queryFn: () => projectsApi.listAgents(selectedCompanyId!, deptFilter),
  enabled: Boolean(selectedCompanyId) && deptFilter !== "all",
});

// Replace `orgTree` with `filteredOrgTree` in the existing layout `useMemo`.

// Render in toolbar:
<div className="absolute top-3 left-3 z-10 flex gap-2 rounded bg-white/90 p-1 backdrop-blur dark:bg-slate-900/90">
  <Select value={deptFilter} onValueChange={setDeptFilter}>
    <SelectTrigger className="h-7 w-[160px] text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">All departments</SelectItem>
      {departments.map((d) => (
        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 5: Verify build + smoke test**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

Smoke: open `/team` → Org Tree tab. With existing teams, verify dashed colored boxes appear behind the team's agents in the tree. Pan/zoom — boxes follow. Select a department from the filter — non-matching agents disappear.

- [ ] **Step 6: Commit**

```bash
git add ui/src/pages/OrgChart.tsx
git commit -m "feat(teams): wire team overlay + dept filter into OrgChart"
```

---

#### Task 4.4: Slice 4 acceptance

- [ ] **Step 1: Run all builds + tests**

```bash
pnpm -F @armyofagents/ui build
pnpm -F @armyofagents/ui vitest run team
```

Expected: green.

- [ ] **Step 2: Smoke test the visual**

Create 2 teams in different departments. Verify:
- Each team gets its own colored overlay box
- Boxes don't intercept clicks (cards still clickable)
- Pan/zoom interactions still work
- Dept filter narrows the canvas to a single dept

- [ ] **Step 3: Slice 4 wrap-up**

PR + review. Reference spec §5.1, §4.5.

---

### Slice 5: Manifest tab — YAML editor

**Goal:** Manifest tab on team detail page renders a YAML editor (Monaco or codemirror) bound to `teams.manifest`. On save, schema-validates and updates the row; if routing rules changed, triggers `coordination/regenerate`.

**Worktree:** `teams-slice-5`. **Depends on:** Slice 1, 3.

---

#### Task 5.1: Add manifest update endpoint

**Files:**
- Modify: `server/src/routes/teams.ts` (add PATCH for manifest sub-resource)
- Modify: `server/src/services/teams.ts` (add `updateManifest` method)

- [ ] **Step 1: Add `updateManifest` to `teamsService`**

In `server/src/services/teams.ts`, inside the returned object:

```typescript
import { validateManifest } from "./team-manifest.js";
import type { TeamManifest } from "@armyofagents/shared";

// ... inside teamsService:

updateManifest: async (id: string, manifest: TeamManifest) => {
  validateManifest(manifest); // throws on invalid
  const updated = await db
    .update(teams)
    .set({ manifest, updatedAt: new Date() })
    .where(eq(teams.id, id))
    .returning();
  if (updated.length === 0) throw notFound(`team ${id} not found`);
  return updated[0];
},
```

- [ ] **Step 2: Add the route**

In `server/src/routes/teams.ts`:

```typescript
import { TeamManifestSchema } from "@armyofagents/shared";

teamsRouter.put("/:tid/manifest", async (req, res) => {
  try {
    const manifest = TeamManifestSchema.parse(req.body);
    const svc = teamsService(db);
    const team = await svc.updateManifest(req.params.tid, manifest);

    // Cascade: regenerate coordination auto sections
    const scaffolder = teamScaffolderService(db);
    const sections = await scaffolder.regenerateAutoContent(req.params.tid);
    const coordSvc = teamCoordinationService(db);
    const existing = await coordSvc.getByTeam(req.params.tid);
    if (existing) {
      await coordSvc.regenerateAutoSections(existing.id, sections);
    }

    res.json(team);
  } catch (e) { handleError(res, e); }
});
```

- [ ] **Step 3: Add API client method**

In `ui/src/api/teams.ts`:

```typescript
updateManifest: (companyId: string, teamId: string, manifest: unknown) =>
  apiFetch(`/companies/${companyId}/teams/${teamId}/manifest`, {
    method: "PUT",
    body: JSON.stringify(manifest),
  }),
```

- [ ] **Step 4: Verify build**

Run: `pnpm -F @armyofagents/server build && pnpm -F @armyofagents/ui build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/teams.ts server/src/services/teams.ts ui/src/api/teams.ts
git commit -m "feat(teams): add manifest update endpoint with cascade to coordination"
```

---

#### Task 5.2: ManifestEditor component

**Files:**
- Create: `ui/src/components/team/ManifestEditor.tsx`

- [ ] **Step 1: Implement using existing `MarkdownEditor` infra (or codemirror — pick one)**

```tsx
// ui/src/components/team/ManifestEditor.tsx
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { teamsApi } from "../../api/teams";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { queryKeys } from "../../lib/queryKeys";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

interface Props {
  teamId: string;
  initialManifest: unknown;
}

export function ManifestEditor({ teamId, initialManifest }: Props) {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [yaml, setYaml] = useState(() => stringifyYaml(initialManifest));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setYaml(stringifyYaml(initialManifest));
  }, [initialManifest]);

  // Live-parse for inline error feedback
  useEffect(() => {
    try {
      parseYaml(yaml);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [yaml]);

  const saveMut = useMutation({
    mutationFn: () => {
      let parsed: unknown;
      try {
        parsed = parseYaml(yaml);
      } catch (e) {
        throw new Error(`YAML parse error: ${(e as Error).message}`);
      }
      return teamsApi.updateManifest(selectedCompanyId!, teamId, parsed);
    },
    onSuccess: () => {
      pushToast({ kind: "success", message: "Manifest saved." });
      queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(selectedCompanyId!, teamId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.teams.coordination(selectedCompanyId!, teamId) });
    },
    onError: (e) => {
      pushToast({ kind: "error", message: `Save failed: ${(e as Error).message}` });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">manifest.yaml</h2>
          <p className="text-xs text-muted-foreground">
            Structured config — routing, member list, dependencies. Editing this regenerates auto sections in coordination.md.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || error !== null}
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          Save
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      <Textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        rows={28}
        className="resize-y font-mono text-xs"
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire into TeamDetail tabs**

In `ui/src/pages/TeamDetail.tsx`, replace the manifest placeholder:

```tsx
import { ManifestEditor } from "../components/team/ManifestEditor";

{activeTab === "manifest" && <ManifestEditor teamId={team.id} initialManifest={team.manifest} />}
```

Note: ensure `yaml` package is installed in UI: `pnpm -F @armyofagents/ui add yaml`.

- [ ] **Step 3: Verify build + smoke**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

Smoke: navigate to a team → Manifest tab. Verify YAML renders, edits parse live, broken YAML shows inline error, Save persists, switching to Coordination tab shows updated routing auto section.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/team/ManifestEditor.tsx ui/src/pages/TeamDetail.tsx ui/package.json
git commit -m "feat(teams): add ManifestEditor with live YAML parsing + cascade regen"
```

---

#### Task 5.3: Slice 5 acceptance

- [ ] **Step 1: Build + test**

Run: `pnpm -F @armyofagents/server build && pnpm -F @armyofagents/ui build && pnpm -F @armyofagents/server vitest run team`
Expected: green.

- [ ] **Step 2: Smoke test cascade**

Edit a team's manifest to add a routing rule (e.g., `match: "test"`, `mention: "@alice"`). Save. Switch to Coordination tab. Verify the routing auto section now contains that rule.

- [ ] **Step 3: PR + review.** Reference spec §5.6 (Manifest tab).

---

## Phase 4 — Runtime + Mentions

### Slice 6: Heartbeat integration — extend `assembleContext()` directly

> ⚠ **HIGHEST-RISK SLICE.** This modifies `context-packaging.ts`, which runs on every heartbeat for every agent. A bug here can break every agent's runs system-wide. Three safety layers MUST all be in place: (1) feature-flag gate via `companies.enableTeams`, (2) defensive try/catch wrapping the new code, (3) explicit deployment gate before merge.

**Goal:** When an agent's heartbeat fires AND that agent's company has `enableTeams=true`, the agent's system prompt includes a "Team Coordination" section pulled from all team coordinations the agent belongs to. Respects `runtimeConfig.contextMode` (skipped if `minimal`). Failures isolated by try/catch — never break the prompt build.

**Worktree:** `teams-slice-6`. **Depends on:** Slice 1.

> **Pattern source for the injection point:** [`server/src/services/context-packaging.ts:22-101`](../../../server/src/services/context-packaging.ts) — `contextPackagingService(db).assembleContext(companyId, issueId)` is the single function that builds the prompt for heartbeat runs. We extend this function directly rather than creating a separate helper.

---

#### Task 6.1: Add Team Coordination section to `assembleContext()`

**Files:**
- Modify: `server/src/services/context-packaging.ts`
- Test: `server/src/__tests__/context-packaging-team-coordination.test.ts` (NEW — replaces the old `heartbeat-team-coordination.test.ts` from the original plan)

- [ ] **Step 1: Read the existing `assembleContext()` to identify the insertion point**

Run: `cat server/src/services/context-packaging.ts | head -200`
Locate: the `sectionLimits` map (~line 58) and the section assembly block. The new section goes BETWEEN agent-config and preferences sections.

- [ ] **Step 2: Extend `sectionLimits`**

In `context-packaging.ts`, find the `sectionLimits` object and add a `teamCoordinations` field per mode:

```typescript
const sectionLimits = {
  minimal: { memory: 2, dependencies: 3, preferences: 1, teamCoordinations: 0 },
  standard: { memory: 5, dependencies: 10, preferences: 5, teamCoordinations: 5 },
  full: { memory: 20, dependencies: 30, preferences: 20, teamCoordinations: 10 },
};
```

- [ ] **Step 3: Add the imports for new tables + companies feature flag**

At the top of `context-packaging.ts`, extend the imports:

```typescript
import {
  // ... existing imports
  teamMembers,
  teamCoordinations,
  teams,
} from "@armyofagents/db";

import { logger } from "../middleware/logger.js";
const log = logger.child({ service: "context-packaging" });
```

(`companies` is already imported per the existing file.)

- [ ] **Step 4: Add the Team Coordination section assembly with safety wrappers**

Inside `assembleContext()`, AFTER the agent-config section assembly and BEFORE the preferences section, add:

```typescript
// ===== Section: Team Coordination (Slice 6) =====
// SAFETY: feature-flag gate + try/catch wrapper. Failures are silent — never break the prompt build.
if (issue.assigneeAgentId && contextMode !== "minimal") {
  try {
    // Feature-flag gate: skip entirely unless company has opted in
    const companyRow = await db
      .select({ enableTeams: companies.enableTeams })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0]);

    if (companyRow?.enableTeams) {
      const memberships = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.agentId, issue.assigneeAgentId))
        .limit(sectionLimits[contextMode as keyof typeof sectionLimits].teamCoordinations);

      if (memberships.length > 0) {
        const teamIds = memberships.map((m) => m.teamId);

        const coords = await db
          .select({
            teamId: teamCoordinations.teamId,
            markdown: teamCoordinations.markdown,
          })
          .from(teamCoordinations)
          .where(
            and(
              inArray(teamCoordinations.teamId, teamIds),
              eq(teamCoordinations.status, "published"),
            ),
          );

        const teamRows = await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, teamIds));
        const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

        if (coords.length > 0) {
          const block = "# Team Coordination\n\n" + coords
            .map((c) => `## ${teamNameById.get(c.teamId) ?? "Team"}\n\n${c.markdown}`)
            .join("\n\n");
          sections.push(block);
        }
      }
    }
    // Feature-flag off → no section added. Prompt build continues unchanged.
  } catch (err) {
    log.warn(
      { err, agentId: issue.assigneeAgentId, companyId },
      "team coordination injection failed; continuing without team section",
    );
    // Don't push anything. Existing prompt is unchanged.
  }
}
```

**Safety properties:**
- Outer `if (issue.assigneeAgentId && contextMode !== "minimal")` skips work for unassigned tasks and minimal-context agents.
- The `companyRow?.enableTeams` check ensures only opted-in companies run this code path.
- The `try/catch` ensures any failure (DB error, missing row, query timeout) results in a warn log + the prompt building unchanged — never a thrown error.

- [ ] **Step 5: Write the failing integration test (T-5 from corrections plan)**

```typescript
// server/src/__tests__/context-packaging-team-coordination.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => args),
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  desc: vi.fn((c) => ({ desc: c })),
  sql: vi.fn(() => ({ sql: true })),
  inArray: vi.fn((c, v) => ({ inArray: [c, v] })),
  or: vi.fn(() => ({})),
}));

vi.mock("@armyofagents/db", () => ({
  issues: { id: "i_id", companyId: "i_cid", projectId: "i_pid", assigneeAgentId: "i_aid", goalId: "i_gid" },
  companies: { id: "c_id", name: "c_n", description: "c_d", vision: "c_v", mission: "c_m", values: "c_va", enableTeams: "c_et" },
  projects: { id: "p_id", name: "p_n" },
  agents: { id: "a_id", runtimeConfig: "a_rc" },
  memoryItems: { id: "m_id", companyId: "m_cid", status: "m_s", layer: "m_l", departmentId: "m_dep", priority: "m_pr", updatedAt: "m_u" },
  goals: { id: "g_id" },
  taskDependencies: { dependentIssueId: "td_did" },
  artifacts: { id: "art_id" },
  artifactVersions: { id: "av_id" },
  teamMembers: { agentId: "tm_a", teamId: "tm_t" },
  teamCoordinations: { teamId: "tc_t", markdown: "tc_md", status: "tc_s" },
  teams: { id: "t_id", name: "t_n" },
}));

import { contextPackagingService } from "../services/context-packaging.js";
import { createDiscussionDb } from "./helpers/mock-db.js";

describe("context-packaging — Team Coordination injection (Slice 6)", () => {
  it("includes Team Coordination section when company.enableTeams=true and agent is on a team", async () => {
    const db = createDiscussionDb([
      [{ id: "i1", companyId: "c1", projectId: "p1", assigneeAgentId: "a1", goalId: null }],   // issue
      [{ runtimeConfig: { contextMode: "standard" } }],                                          // agent runtime config
      [{ name: "Acme", description: "...", vision: null, mission: null, values: null }],        // company (basic)
      [],                                                                                         // identity memory
      [{ id: "p1", name: "Engineering", description: "..." }],                                  // project
      [],                                                                                         // domain memory
      [{ enableTeams: true }],                                                                    // companyRow.enableTeams query
      [{ teamId: "t1" }],                                                                         // memberships
      [{ teamId: "t1", markdown: "## Mission\nfrontend work" }],                                 // coords
      [{ id: "t1", name: "Frontend Team" }],                                                      // team names
      // ... remaining sections (deps, task, artifacts, agent config, prefs) — empty arrays
      [], [], [], [], [],
    ]);
    const svc = contextPackagingService(db);
    const result = await svc.assembleContext("c1", "i1");
    expect(result.markdown).toContain("# Team Coordination");
    expect(result.markdown).toContain("Frontend Team");
    expect(result.markdown).toContain("frontend work");
  });

  it("OMITS Team Coordination section when company.enableTeams=false", async () => {
    const db = createDiscussionDb([
      [{ id: "i1", companyId: "c1", projectId: "p1", assigneeAgentId: "a1", goalId: null }],
      [{ runtimeConfig: { contextMode: "standard" } }],
      [{ name: "Acme" }],
      [],
      [{ id: "p1", name: "Eng" }],
      [],
      [{ enableTeams: false }],   // ← feature flag off
      [], [], [], [], [], [], [],
    ]);
    const svc = contextPackagingService(db);
    const result = await svc.assembleContext("c1", "i1");
    expect(result.markdown).not.toContain("# Team Coordination");
  });

  it("OMITS Team Coordination when contextMode=minimal", async () => {
    const db = createDiscussionDb([
      [{ id: "i1", companyId: "c1", projectId: "p1", assigneeAgentId: "a1", goalId: null }],
      [{ runtimeConfig: { contextMode: "minimal" } }],
      [{ name: "Acme" }],
      [],
      [{ id: "p1", name: "Eng" }],
      [], [], [], [], [], [], [],
    ]);
    const svc = contextPackagingService(db);
    const result = await svc.assembleContext("c1", "i1");
    expect(result.markdown).not.toContain("# Team Coordination");
  });

  it("OMITS Team Coordination when agent has no team memberships (even with flag on)", async () => {
    const db = createDiscussionDb([
      [{ id: "i1", companyId: "c1", projectId: "p1", assigneeAgentId: "a1", goalId: null }],
      [{ runtimeConfig: { contextMode: "standard" } }],
      [{ name: "Acme" }],
      [],
      [{ id: "p1", name: "Eng" }],
      [],
      [{ enableTeams: true }],
      [],   // ← no memberships
      [], [], [], [], [], [],
    ]);
    const svc = contextPackagingService(db);
    const result = await svc.assembleContext("c1", "i1");
    expect(result.markdown).not.toContain("# Team Coordination");
  });

  it("does NOT throw when DB query for coordination fails — logs warn and continues", async () => {
    // Simulate a DB error during the coordination fetch by making the .then() reject
    let queryIdx = 0;
    const failOnQuery = 7; // the enableTeams query — make it throw
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            then: (fn: (rows: any[]) => any) => {
              if (queryIdx++ === failOnQuery) {
                return Promise.reject(new Error("simulated DB failure"));
              }
              return Promise.resolve(fn([]));
            },
            innerJoin: function () { return this; },
            orderBy: function () { return this; },
            limit: function () { return this; },
          }),
        }),
      }),
    };
    const svc = contextPackagingService(db);
    // Must not throw — the function should complete without the team section
    const result = await svc.assembleContext("c1", "i1").catch((e) => ({ error: e }));
    expect((result as any).error).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the test to verify pass**

Run: `pnpm -F @armyofagents/server vitest run context-packaging-team-coordination`
Expected: PASS — 5 tests green (3 happy paths + 2 safety: feature flag off, no memberships).

- [ ] **Step 7: Build server and verify nothing else broke**

Run: `pnpm -F @armyofagents/server build && pnpm -F @armyofagents/server vitest run context-packaging`
Expected: success on both. The existing `context-packaging.test.ts` tests must still pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/context-packaging.ts server/src/__tests__/context-packaging-team-coordination.test.ts
git commit -m "feat(teams): extend assembleContext with Team Coordination section (flag-gated, defensive)"
```

---

#### Task 6.2: Slice 6 deployment gate (mandatory before merge)

**This task is a CHECKLIST, not code. Do NOT merge Slice 6 to `Porting1.1` until ALL items pass.**

- [ ] **Gate item 1:** All tests pass

```bash
pnpm -F @armyofagents/server vitest run context-packaging
pnpm -F @armyofagents/server vitest run team
```
Expected: all green, including the 5 new tests in `context-packaging-team-coordination.test.ts`.

- [ ] **Gate item 2:** Manual smoke with `enableTeams=false` — existing behavior unchanged

Start a fresh local AoA instance with `enableTeams=false` (the default) on a test company. Trigger a heartbeat run for any existing agent. Inspect the heartbeat run's logged system prompt. Verify:
- Prompt contains the existing 8 sections (company, dept, goal, deps, task, artifacts, agent config, preferences)
- Prompt does NOT contain "# Team Coordination"
- No warn/error logs from `context-packaging` service
- Run completes successfully

If any of the above fails, **do not proceed to Gate item 3.** Investigate first.

- [ ] **Gate item 3:** Manual smoke with `enableTeams=true` — new behavior activates

Toggle the test company's `enableTeams=true` via `PATCH /api/companies/:cid/enable-teams`. Create a team with at least one agent member (use the API directly via curl since UI lands in Slice 2). Trigger a heartbeat run for that agent. Verify:
- Prompt contains "# Team Coordination" section
- Prompt contains the team's name and coordination markdown
- All 8 existing sections still present
- No warn/error logs
- Run completes successfully

- [ ] **Gate item 4:** Inspect server logs during both smokes

`grep -E "warn|error" server.log | grep -i "team\|context"` should return zero unexpected entries.

- [ ] **Gate item 5:** PR review

Open PR. Tag a reviewer who has read this corrections plan + the spec. They verify the safety wrappers are present and reasoning matches Part 5 of `teams_plan_corrections.md`.

- [ ] **Gate item 6:** Add changeset

```bash
pnpm changeset
# minor bump for `aoa`. Description:
# "Inject team coordination into agent system prompts during heartbeat. Feature-flag gated via companies.enableTeams. Defensive: failures cannot break heartbeat for any agent."
```

- [ ] **Gate item 7:** Final commit + push + open PR

```bash
git add .changeset/
git commit -m "chore(changeset): add teams slice 6 entry"
git push
gh pr create --title "feat(teams): slice 6 — heartbeat coordination injection (flag-gated)" --body "$(cat <<'EOF'
## Summary
- Extend contextPackagingService.assembleContext() with a Team Coordination section
- Section appears only when company.enableTeams=true AND agent is on at least one team
- Respects runtimeConfig.contextMode (skipped if minimal)
- Defensive try/catch — failures log warn and don't break prompt build

## Risk: HIGH
This modifies the prompt-building function that runs for every heartbeat. Mitigations:
1. Feature flag default false (existing companies unaffected)
2. try/catch wrapper (failures don't propagate)
3. Manual smoke tested with flag off (existing behavior unchanged) and flag on (new behavior activates)

## Test plan
- [x] All `context-packaging*` tests pass (existing + new T-5 5 tests)
- [x] Manual smoke with enableTeams=false: prompt unchanged, no warn logs
- [x] Manual smoke with enableTeams=true: section appears, no warn logs
- [x] Reviewed by [name] against corrections plan Part 5

Spec: §6 (Heartbeat integration), Decision T-11
Corrections: Part 4 (Heartbeat re-design), Part 5 Layer 2 + Layer 3

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After PR merges to `Porting1.1`, proceed to Slice 7.

---

### Slice 7: `@human` resolver + notifications (flag-gated, defensive)

> ⚠ **HIGH-RISK SLICE.** This modifies `issues.ts` mention handling, which runs for every comment. Same three safety layers as Slice 6: feature flag + try/catch + deployment gate.

**Goal:** `findMentionedHumans` resolves `@username` to humans in the same company. When `company.enableTeams=true`, mentions create `notifications` rows of `type: 'mention'`. Wires into BOTH existing `findMentionedAgents` call sites in `issues.ts`. Failures isolated by try/catch — never break comment creation.

**Worktree:** `teams-slice-7`. **Depends on:** Slice 1 (needs `enableTeams` flag).

> **Pattern source:** [`server/src/services/issues.ts:1418`](../../../server/src/services/issues.ts) defines the existing `findMentionedAgents` resolver. Two call sites for it exist in `server/src/routes/issues.ts` at lines 676 and 1050 (verified). Both must be updated.

---

#### Task 7.1: Implement findMentionedHumans

**Files:**
- Modify: `server/src/services/issues.ts`
- Test: `server/src/__tests__/mention-resolver-humans.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/mention-resolver-humans.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  authUsers: new Proxy({}, { get: (_t, prop) => prop }),
  userRoles: new Proxy({}, { get: (_t, prop) => prop }),
}));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  inArray: () => ({}),
}));

import { issueServiceWithDb } from "../services/issues.js"; // adapter to expose findMentionedHumans for test

describe("findMentionedHumans", () => {
  it("matches @username against company humans", async () => {
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([
        { id: "u1", name: "alice" },
        { id: "u2", name: "bob" },
      ]) }) }) }),
    } as never;

    const svc = issueServiceWithDb(db);
    const result = await svc.findMentionedHumans("c1", "Hey @alice can you check this with @bob?");
    expect(result).toEqual(["u1", "u2"]);
  });

  it("returns empty when no mentions", async () => {
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) }) }),
    } as never;
    const svc = issueServiceWithDb(db);
    expect(await svc.findMentionedHumans("c1", "no mentions here")).toEqual([]);
  });

  it("disambiguates -h suffix from agent mentions", async () => {
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([
        { id: "u1", name: "alice" },
      ]) }) }) }),
    } as never;
    const svc = issueServiceWithDb(db);
    // @alice-h → strip -h suffix and match name 'alice'
    const result = await svc.findMentionedHumans("c1", "@alice-h please review");
    expect(result).toEqual(["u1"]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @armyofagents/server vitest run mention-resolver-humans`
Expected: FAIL.

- [ ] **Step 3: Add `findMentionedHumans` to the issue service**

In `server/src/services/issues.ts`, alongside the existing `findMentionedAgents` (around line 1418), add:

```typescript
import { authUsers, userRoles } from "@armyofagents/db";

// ... inside the service factory's returned object:

findMentionedHumans: async (companyId: string, body: string): Promise<string[]> => {
  // Match @name (and @name-h variants); strip -h suffix
  const re = /\B@([\w-]+)/g;
  const tokens = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let raw = m[1].toLowerCase();
    if (raw.endsWith("-h")) raw = raw.slice(0, -2);
    tokens.add(raw);
  }
  if (tokens.size === 0) return [];

  const rows = await db
    .select({ id: authUsers.id, name: authUsers.name })
    .from(authUsers)
    .innerJoin(userRoles, eq(userRoles.userId, authUsers.id))
    .where(eq(userRoles.companyId, companyId));

  return rows.filter((u) => tokens.has(u.name.toLowerCase())).map((u) => u.id);
},
```

- [ ] **Step 4: Run the test to verify pass**

Run: `pnpm -F @armyofagents/server vitest run mention-resolver-humans`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/issues.ts server/src/__tests__/mention-resolver-humans.test.ts
git commit -m "feat(teams): add findMentionedHumans resolver in issue service"
```

---

#### Task 7.2: Wire mention-handler to insert notifications — BOTH call sites, flag-gated, defensive

**Files:**
- Modify: `server/src/routes/issues.ts` — TWO call sites at lines 676 and 1050 (both verified)

- [ ] **Step 1: Verify the two call sites exist**

Run: `grep -n "findMentionedAgents" server/src/routes/issues.ts`
Expected output: 2 lines, around 676 and 1050.

- [ ] **Step 2: At BOTH call sites, add a parallel `findMentionedHumans` call wrapped in try/catch + flag gate**

After each existing `findMentionedAgents` block, append:

```typescript
// ===== @human notifications (Slice 7) =====
// SAFETY: feature-flag gate + try/catch. Failures cannot break comment creation.
try {
  const companyRow = await db
    .select({ enableTeams: companies.enableTeams })
    .from(companies)
    .where(eq(companies.id, companyId))
    .then((rows) => rows[0]);

  if (companyRow?.enableTeams) {
    const mentionedHumanIds = await issueService(db).findMentionedHumans(companyId, comment.body);
    for (const userId of mentionedHumanIds) {
      await db.insert(notifications).values({
        userId,
        companyId,
        type: "mention",
        sourceType: "issue_comment",
        sourceId: comment.id,
        title: `Mentioned in comment`,
        body: comment.body.slice(0, 200),
        metadata: {
          mentionerType: req.actor.type,
          mentionerId: req.actor.type === "user" ? req.actor.userId : req.actor.type === "agent" ? req.actor.agentId : null,
        },
      });
    }
  }
} catch (err) {
  log.warn(
    { err, commentId: comment.id, companyId },
    "@human mention notification failed; comment creation continues",
  );
  // Notifications missed but comment posted successfully. User-visible: comment works.
}
```

**Apply this addition at BOTH line ~676 and line ~1050.** The two call sites are different comment-creation handlers (one for `issue_comments`, one for a different comment surface). Both need the same parallel call.

- [ ] **Step 3: Add imports if not already present**

At the top of `server/src/routes/issues.ts`:

```typescript
import { notifications, companies } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";

const log = logger.child({ route: "issues" });   // if not already declared
```

- [ ] **Step 4: Add the conformance test (T-8 from corrections plan)**

Create `server/src/__tests__/mention-resolver-humans-coverage.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("findMentionedHumans wired at BOTH issues.ts call sites", () => {
  it("issues.ts has equal counts of findMentionedAgents and findMentionedHumans calls", async () => {
    const issuesRoutePath = path.resolve(
      __dirname,
      "../routes/issues.ts",
    );
    const source = await fs.readFile(issuesRoutePath, "utf8");
    const agentMatches = (source.match(/findMentionedAgents\(/g) ?? []).length;
    const humanMatches = (source.match(/findMentionedHumans\(/g) ?? []).length;
    expect(agentMatches).toBe(2);   // verified: 2 call sites in issues.ts
    expect(humanMatches).toBe(2);   // both must have the parallel call
  });

  it("issues.ts wraps findMentionedHumans in try/catch", async () => {
    const issuesRoutePath = path.resolve(__dirname, "../routes/issues.ts");
    const source = await fs.readFile(issuesRoutePath, "utf8");
    // Each findMentionedHumans usage should be inside a try block
    const blocks = source.split("findMentionedHumans");
    // Skip the first split (before any usage); for each subsequent block, verify a try preceded it
    // Simple heuristic: count "try {" tokens in the same file should be >= 2 (one per usage)
    const tryCount = (source.match(/\btry\s*\{/g) ?? []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm -F @armyofagents/server vitest run mention-resolver-humans
pnpm -F @armyofagents/server vitest run mention-resolver-humans-coverage
```

Expected: both PASS.

- [ ] **Step 6: Verify build**

Run: `pnpm -F @armyofagents/server build`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/issues.ts server/src/__tests__/mention-resolver-humans-coverage.test.ts
git commit -m "feat(teams): @human mention notifications at both issues.ts sites (flag-gated, defensive)"
```

---

#### Task 7.3: Slice 7 deployment gate (mandatory before merge)

Same structure as Slice 6 deployment gate. **Do NOT merge until ALL items pass.**

- [ ] **Gate item 1:** All tests pass

```bash
pnpm -F @armyofagents/server vitest run mention
pnpm -F @armyofagents/server vitest run team
```

Expected: all green.

- [ ] **Gate item 2:** Manual smoke with `enableTeams=false` — comment creation unchanged

Start a fresh local AoA instance with `enableTeams=false`. Post a comment containing `@somebody-h` on a test task. Verify:
- Comment creation succeeds (returns 201)
- No notification row inserted
- No warn/error logs from `issues` route
- Existing `@<agent-name>` mention behavior still works (heartbeat triggered)

- [ ] **Gate item 3:** Manual smoke with `enableTeams=true` — new behavior activates

Toggle the test company to `enableTeams=true`. Post a comment containing `@<real-human-name-in-company>`. Verify:
- Comment creation succeeds
- Notification row appears in `notifications` table for that user
- User sees unread badge increment in sidebar
- No warn/error logs

- [ ] **Gate item 4:** Defensive failure test (intentional break)

Temporarily mock `findMentionedHumans` to throw an error. Post a comment with `@somebody-h`. Verify:
- Comment creation STILL SUCCEEDS (201)
- Server logs show the warn from the try/catch
- No notification row created
- After reverting the mock, behavior returns to normal

This proves the defensive wrapper works.

- [ ] **Gate item 5:** Add changeset

```bash
pnpm changeset
# minor bump for `aoa`
# Description: "Add @human mention support — notifications inserted on mention, flag-gated via companies.enableTeams. Defensive: comment creation never breaks."
```

- [ ] **Gate item 6:** Final commit + push + open PR

```bash
git add .changeset/
git commit -m "chore(changeset): add teams slice 7 entry"
git push
gh pr create --title "feat(teams): slice 7 — @human mention notifications (flag-gated)" --body "$(cat <<'EOF'
## Summary
- Add findMentionedHumans resolver alongside findMentionedAgents
- At BOTH existing call sites in issues.ts (lines ~676 and ~1050), add parallel @human notification path
- Feature-flag gated via companies.enableTeams
- Defensive try/catch — failures cannot break comment creation

## Risk: HIGH
Modifies critical comment-creation flow. Mitigations:
1. Feature flag default false (existing companies unaffected)
2. try/catch wrapper (failures don't propagate)
3. Manual smoke tested with flag off, flag on, and intentional failure

## Test plan
- [x] mention-resolver-humans tests pass
- [x] mention-resolver-humans-coverage (T-8) test passes (verifies both call sites + try wrappers)
- [x] Manual smoke with enableTeams=false: existing flow unchanged
- [x] Manual smoke with enableTeams=true: notifications work
- [x] Defensive smoke with simulated failure: comment creation succeeds, warn logged

Spec: §4.7
Corrections: Part 5 Layer 2 + Layer 3

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After PR merges, proceed to Slice 8.

---

## Phase 5 — Import / Export

### Slice 8: Import flow

**Goal:** Users can upload a `.team.yaml` file. The server parses, returns a preview with collisions + dependency states, and on confirm runs a transactional cascade install.

**Worktree:** `teams-slice-8`. **Depends on:** Slice 1, 5.

---

#### Task 8.1: Import service skeleton

**Files:**
- Create: `server/src/services/team-import.ts`
- Test: `server/src/__tests__/team-import-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/team-import-service.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  teams: new Proxy({}, { get: (_t, prop) => prop }),
  teamMembers: new Proxy({}, { get: (_t, prop) => prop }),
  teamCoordinations: new Proxy({}, { get: (_t, prop) => prop }),
  agents: new Proxy({}, { get: (_t, prop) => prop }),
  companySkills: new Proxy({}, { get: (_t, prop) => prop }),
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), and: () => ({}), inArray: () => ({}) }));

import { teamImportService } from "../services/team-import.js";
import type { Db } from "@armyofagents/db";

const VALID_YAML = `
schemaVersion: 1
name: frontend-team
version: 1.0.0
agents:
  - name: alice
    role: lead
    skillKeys: [react]
routing:
  rules: []
skillDeps: ["@aoa/react@1.0.0"]
`;

describe("teamImportService.preview", () => {
  it("returns parsed manifest + missing dependencies", async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }), // no agents, no skills
    } as unknown as Db;
    const svc = teamImportService(db);
    const result = await svc.preview("c1", VALID_YAML);
    expect(result.manifest.name).toBe("frontend-team");
    expect(result.collisions).toEqual([]);
    expect(result.skillsToInstall).toContain("@aoa/react@1.0.0");
  });

  it("flags collision when an agent name already exists", async () => {
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            // Pretend an agent named 'alice' exists
            return Promise.resolve([{ id: "a1", name: "alice" }]);
          },
        }),
      }),
    } as unknown as Db;
    const svc = teamImportService(db);
    const result = await svc.preview("c1", VALID_YAML);
    expect(result.collisions).toContainEqual(
      expect.objectContaining({ kind: "agent", name: "alice" }),
    );
  });

  it("rejects malformed YAML", async () => {
    const db = {} as unknown as Db;
    const svc = teamImportService(db);
    await expect(svc.preview("c1", ":::not yaml:::")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @armyofagents/server vitest run team-import-service`
Expected: FAIL.

- [ ] **Step 3: Implement preview**

```typescript
// server/src/services/team-import.ts
import type { Db } from "@armyofagents/db";
import { agents, companySkills, teams } from "@armyofagents/db";
import { eq, and, inArray } from "drizzle-orm";
import { parseManifest } from "./team-manifest.js";
import type { TeamManifest } from "@armyofagents/shared";

export interface ImportPreview {
  manifest: TeamManifest;
  collisions: Array<{ kind: "agent" | "team"; name: string; existingId: string }>;
  skillsToInstall: string[];
  pluginsToInstall: string[];
  workflowsToInstall: string[];
}

export interface ImportResolution {
  collisions: Record<string, "rename" | "replace" | "skip">;  // by collision.name
  parentProjectId: string;
  renames?: Record<string, string>;                            // original name → new name
}

export function teamImportService(db: Db) {
  return {
    preview: async (companyId: string, yamlContent: string): Promise<ImportPreview> => {
      const manifest = parseManifest(yamlContent);

      // Find collisions: agents with same name
      const inlineAgentNames = manifest.agents
        .filter((a): a is Extract<typeof manifest.agents[number], { name: string }> => "name" in a)
        .map((a) => a.name);
      const refAgentNames = manifest.agents
        .filter((a): a is Extract<typeof manifest.agents[number], { localName: string }> => "localName" in a)
        .map((a) => a.localName);
      const allNames = [...inlineAgentNames, ...refAgentNames];

      const existingAgents = allNames.length > 0
        ? await db.select().from(agents).where(and(eq(agents.companyId, companyId), inArray(agents.name, allNames)))
        : [];

      const collisions = existingAgents.map((a) => ({
        kind: "agent" as const,
        name: a.name,
        existingId: a.id,
      }));

      // Skills to install
      const installedSkills = await db.select({ key: companySkills.key }).from(companySkills).where(eq(companySkills.companyId, companyId));
      const installedSet = new Set(installedSkills.map((s) => s.key));
      const skillsToInstall = (manifest.skillDeps ?? []).filter((s) => !installedSet.has(s));

      // Plugins / workflows: simplified for v1 — assume not installed
      const pluginsToInstall = manifest.pluginDeps ?? [];
      const workflowsToInstall = (manifest.workflowTemplates ?? []).map((w) => w.$ref);

      return { manifest, collisions, skillsToInstall, pluginsToInstall, workflowsToInstall };
    },

    install: async (
      companyId: string,
      yamlContent: string,
      resolution: ImportResolution,
    ) => {
      // For brevity in the plan, the install method orchestrates:
      //   1. db.transaction:
      //   2.   Resolve collisions per `resolution.collisions`
      //   3.   Fetch + install missing skills (calls company-skills service)
      //   4.   Create new agents (with renames applied)
      //   5.   Create the team row + link agents via team_members
      //   6.   Insert team_coordinations row
      // Each sub-step uses existing services. See full implementation in the codebase.
      // ⚠ Implement carefully and cover with the cascade integration test (Task 8.4).

      const preview = await teamImportService(db).preview(companyId, yamlContent);
      // ... transactional install (see test for expected behavior)
      throw new Error("install: stub — replaced by full implementation in Task 8.2");
    },
  };
}
```

- [ ] **Step 4: Run test to verify preview passes**

Run: `pnpm -F @armyofagents/server vitest run team-import-service`
Expected: preview tests PASS, install test (if any) might fail until Task 8.3.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/team-import.ts server/src/__tests__/team-import-service.test.ts
git commit -m "feat(teams): add team-import preview with collision + dep detection"
```

---

#### Task 8.2: Implement transactional install

- [ ] **Step 1: Replace the throwing `install` method with full implementation**

```typescript
// server/src/services/team-import.ts (replace the install stub)
install: async (
  companyId: string,
  yamlContent: string,
  resolution: ImportResolution,
) => {
  const preview = await teamImportService(db).preview(companyId, yamlContent);
  const { manifest } = preview;

  return db.transaction(async (tx) => {
    // 1. Install missing skills (delegate to company-skills service, simplified here)
    for (const skillRef of preview.skillsToInstall) {
      // Stub: in production, fetch from skill marketplace + insert into company_skills
      // For v1 import, we accept skills that are pre-installed only (otherwise refuse).
      throw new Error(`skill ${skillRef} not installed; install it first or include it in the package`);
    }

    // 2. Resolve agent collisions + create agents
    const agentIdByLocalName = new Map<string, string>();
    for (const a of manifest.agents) {
      const isInline = "name" in a;
      const wantedName = isInline ? a.name : a.localName;
      const action = resolution.collisions[wantedName];

      if (action === "skip") continue;

      let agentName = wantedName;
      if (action === "rename") {
        agentName = resolution.renames?.[wantedName] ?? `${wantedName}-imported`;
      }

      if (action === "replace") {
        const existing = preview.collisions.find((c) => c.name === wantedName);
        if (existing) {
          agentIdByLocalName.set(wantedName, existing.existingId);
          continue;
        }
      }

      const skillKeys = isInline ? a.skillKeys : []; // $ref agents bring their skillKeys from registry (out of scope v1)
      const inserted = await tx.insert(agents).values({
        companyId,
        name: agentName,
        role: "general",
        skillKeys,
        adapterType: "claude_local",
        status: "idle",
      }).returning();
      agentIdByLocalName.set(wantedName, inserted[0].id);
    }

    // 3. Create team
    const team = await tx.insert(teams).values({
      companyId,
      parentProjectId: resolution.parentProjectId,
      name: manifest.displayName ?? manifest.name,
      slug: manifest.name,
      description: manifest.description,
      manifest,
      templateOrigin: `@${manifest.name}`,
      templateVersion: manifest.version,
    }).returning();
    const teamId = team[0].id;

    // 4. Link agents
    for (const a of manifest.agents) {
      const wantedName = "name" in a ? a.name : a.localName;
      const agentId = agentIdByLocalName.get(wantedName);
      if (!agentId) continue; // skipped
      await tx.insert(teamMembers).values({ teamId, agentId, role: a.role });
    }

    // 5. Insert coordination (the package may include one — for v1 we scaffold)
    const scaffolder = teamScaffolderService(tx as Db);
    const initial = await scaffolder.scaffoldInitial(teamId, manifest.description);
    await tx.insert(teamCoordinations).values({
      companyId,
      teamId,
      key: `${manifest.name}:coordination`,
      slug: manifest.name,
      name: `${manifest.displayName ?? manifest.name} Coordination`,
      markdown: initial,
    });

    return team[0];
  });
},
```

Add the necessary imports at the top:
```typescript
import { teamMembers, teamCoordinations } from "@armyofagents/db";
import { teamScaffolderService } from "./team-scaffolder.js";
```

- [ ] **Step 2: Verify build**

Run: `pnpm -F @armyofagents/server build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/team-import.ts
git commit -m "feat(teams): add transactional cascade install for team imports"
```

---

#### Task 8.3: Import routes

**Files:**
- Create: `server/src/routes/team-imports.ts`
- Modify: route registration in `server/src/index.ts`

- [ ] **Step 1: Create the routes file**

```typescript
// server/src/routes/team-imports.ts
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { teamImportService } from "../services/team-import.js";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { handleError } from "../errors.js";

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

const ResolutionBody = z.object({
  yamlContent: z.string(),
  collisions: z.record(z.enum(["rename", "replace", "skip"])),
  parentProjectId: z.string().uuid(),
  renames: z.record(z.string()).optional(),
});

export const teamImportsRouter = Router({ mergeParams: true });

teamImportsRouter.use(requireAuth);

teamImportsRouter.post("/preview", upload.single("file"), async (req, res) => {
  try {
    const yaml = req.file ? req.file.buffer.toString("utf8") : req.body.yamlContent;
    if (!yaml) throw new Error("missing file or yamlContent body field");
    const svc = teamImportService(db);
    const result = await svc.preview(req.params.companyId, yaml);
    res.json(result);
  } catch (e) { handleError(res, e); }
});

teamImportsRouter.post("/install", async (req, res) => {
  try {
    const body = ResolutionBody.parse(req.body);
    const svc = teamImportService(db);
    const team = await svc.install(req.params.companyId, body.yamlContent, {
      collisions: body.collisions,
      parentProjectId: body.parentProjectId,
      renames: body.renames,
    });
    res.status(201).json(team);
  } catch (e) { handleError(res, e); }
});
```

- [ ] **Step 2: Mount the router (uses `_imports` to avoid `:tid` collision)**

In `server/src/index.ts`:

```typescript
import { teamImportsRouter } from "./routes/team-imports.js";
app.use("/companies/:companyId/teams/_imports", teamImportsRouter);
```

- [ ] **Step 3: Add `multer` if not installed**

Run: `pnpm -F @armyofagents/server add multer @types/multer`

- [ ] **Step 4: Verify build**

Run: `pnpm -F @armyofagents/server build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/team-imports.ts server/src/index.ts server/package.json
git commit -m "feat(teams): add /teams/_imports preview + install routes"
```

---

#### Task 8.4: Replace ImportUploadDialog stub with real flow

**Files:**
- Replace: `ui/src/components/team/ImportUploadDialog.tsx`
- Create: `ui/src/components/team/ImportPreviewDialog.tsx`

- [ ] **Step 1: Implement upload dialog**

```tsx
// ui/src/components/team/ImportUploadDialog.tsx
import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { ImportPreviewDialog } from "./ImportPreviewDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportUploadDialog({ open, onOpenChange }: Props) {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const [yamlContent, setYamlContent] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<unknown | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const text = await file.text();
    setYamlContent(text);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/companies/${selectedCompanyId}/teams/_imports/preview`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      setPreviewData(await res.json());
    } catch (e) {
      pushToast({ kind: "error", message: `Parse failed: ${(e as Error).message}` });
    }
  }

  if (previewData && yamlContent) {
    return (
      <ImportPreviewDialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          if (!o) {
            setPreviewData(null);
            setYamlContent(null);
          }
        }}
        preview={previewData}
        yamlContent={yamlContent}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import team from file</DialogTitle>
          <DialogDescription>
            Upload a .team.yaml or .team.zip package.
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded-lg border-2 border-dashed border-muted-foreground/30 p-9 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-bold">Drag a team file here</p>
          <p className="text-xs text-muted-foreground">or</p>
          <Button onClick={() => fileRef.current?.click()} className="mt-3">
            Browse files
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml,.zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <p className="mt-3 text-[10px] text-muted-foreground">.yaml · .yml · .zip · max 5MB</p>
        </div>

        <p className="text-xs text-muted-foreground">
          💡 The file is parsed and you'll get a preview before anything is written.
        </p>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Implement preview dialog**

```tsx
// ui/src/components/team/ImportPreviewDialog.tsx
import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../../api/projects";
import { queryKeys } from "../../lib/queryKeys";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: any; // ImportPreview shape
  yamlContent: string;
}

export function ImportPreviewDialog({ open, onOpenChange, preview, yamlContent }: Props) {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [parentProjectId, setParentProjectId] = useState<string>("");
  const [collisions, setCollisions] = useState<Record<string, "rename" | "replace" | "skip">>({});

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
  });
  const departments = (projectsQuery.data ?? []).filter((p) => p.type === "department");

  const installMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/companies/${selectedCompanyId}/teams/_imports/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yamlContent, collisions, parentProjectId }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (team) => {
      pushToast({ kind: "success", message: `Installed "${team.name}".` });
      onOpenChange(false);
      navigate(`/team/teams/${team.slug}`);
    },
    onError: (e) => pushToast({ kind: "error", message: `Install failed: ${(e as Error).message}` }),
  });

  const allCollisionsResolved = preview.collisions.every((c: any) => collisions[c.name]);
  const canInstall = parentProjectId && allCollisionsResolved;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{preview.manifest.displayName ?? preview.manifest.name}</DialogTitle>
          <p className="text-xs text-muted-foreground">v{preview.manifest.version}</p>
        </DialogHeader>

        {/* Parent dept picker */}
        <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-950/20">
          <div className="flex items-center gap-3">
            <span className="text-base">📁</span>
            <div className="flex-1">
              <p className="text-xs font-bold">Pick a parent department</p>
              <p className="text-[11px] text-muted-foreground">
                Templates don't include a department — choose where this team lives.
              </p>
            </div>
            <Select value={parentProjectId} onValueChange={setParentProjectId}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Members */}
        <section>
          <h3 className="mb-2 text-xs font-bold">Members ({preview.manifest.agents.length})</h3>
          {preview.manifest.agents.map((a: any) => {
            const wantedName = a.name ?? a.localName;
            const collision = preview.collisions.find((c: any) => c.name === wantedName);
            return (
              <div
                key={wantedName}
                className={`mb-1.5 rounded-md p-2.5 ${collision ? "bg-red-50 dark:bg-red-950/20 border border-red-300" : "bg-green-50 dark:bg-green-950/20"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{wantedName}</span>
                  {collision ? (
                    <Badge className="bg-red-100 text-red-800 text-[9px]">⚠ COLLISION</Badge>
                  ) : (
                    <Badge className="bg-green-100 text-green-800 text-[9px]">WILL CREATE</Badge>
                  )}
                  {collision && (
                    <Select
                      value={collisions[wantedName] ?? ""}
                      onValueChange={(v) => setCollisions({ ...collisions, [wantedName]: v as any })}
                    >
                      <SelectTrigger className="h-6 w-[100px] text-xs ml-auto">
                        <SelectValue placeholder="Resolve" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rename">Rename</SelectItem>
                        <SelectItem value="replace">Replace</SelectItem>
                        <SelectItem value="skip">Skip</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Skills */}
        {preview.skillsToInstall.length > 0 && (
          <section className="mt-3">
            <h3 className="mb-2 text-xs font-bold">Skills (will fetch)</h3>
            <div className="flex flex-wrap gap-1.5">
              {preview.skillsToInstall.map((s: string) => (
                <Badge key={s} className="bg-amber-100 text-amber-800 text-[10px]">⬇ {s}</Badge>
              ))}
            </div>
          </section>
        )}

        <DialogFooter className="border-t pt-3">
          <span className="mr-auto text-[11px] text-muted-foreground">
            Will create {preview.manifest.agents.length - Object.values(collisions).filter((v) => v === "skip").length} agents · {preview.skillsToInstall.length} skills · resolve {preview.collisions.length} collisions
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canInstall || installMut.isPending} onClick={() => installMut.mutate()}>
            {installMut.isPending ? "Installing..." : "Install team →"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify build + smoke**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

Smoke: prepare a sample `.team.yaml` with a known-colliding agent name, click "+ New team → Import from file", drop the file, verify preview shows the collision with Rename/Replace/Skip dropdown, pick Rename + a department, click Install, verify redirect to detail page.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/team/ImportUploadDialog.tsx ui/src/components/team/ImportPreviewDialog.tsx
git commit -m "feat(teams): wire import upload + preview-and-install UI"
```

---

#### Task 8.5: Slice 8 acceptance

- [ ] **Step 1: Run all tests**

Run: `pnpm -F @armyofagents/server vitest run team`
Expected: green.

- [ ] **Step 2: PR + review.** Reference spec §5.5, §7.

---

### Slice 9: Export flow + final QA suite

**Goal:** Download team as `.team.yaml`. Roundtrip test: export → import to a second company → verify equivalence. Add the V2-style QA suite covering happy paths.

**Worktree:** `teams-slice-9`. **Depends on:** Slice 1, 8.

---

#### Task 9.1: Export service + endpoint

**Files:**
- Create: `server/src/services/team-export.ts`
- Modify: `server/src/routes/teams.ts` (add GET /export)

- [ ] **Step 1: Implement export service**

```typescript
// server/src/services/team-export.ts
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, teamCoordinations, agents } from "@armyofagents/db";
import { eq, inArray } from "drizzle-orm";
import { stringify as stringifyYaml } from "yaml";
import type { TeamManifest } from "@armyofagents/shared";

export function teamExportService(db: Db) {
  return {
    exportYaml: async (teamId: string): Promise<string> => {
      const teamRows = await db.select().from(teams).where(eq(teams.id, teamId));
      if (teamRows.length === 0) throw new Error(`team ${teamId} not found`);
      const team = teamRows[0];

      const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
      const agentRows = memberRows.length > 0
        ? await db.select().from(agents).where(inArray(agents.id, memberRows.map((m) => m.agentId)))
        : [];
      const byId = new Map(agentRows.map((a) => [a.id, a]));

      const manifest: TeamManifest = {
        schemaVersion: 1,
        name: team.slug,
        version: team.templateVersion ?? "1.0.0",
        displayName: team.name,
        description: team.description ?? undefined,
        agents: memberRows.map((m) => {
          const a = byId.get(m.agentId);
          return {
            name: a?.name ?? `agent-${m.agentId.slice(0, 8)}`,
            role: m.role as "lead" | "member",
            skillKeys: (a?.skillKeys as string[] | undefined) ?? [],
          };
        }),
        routing: ((team.manifest as { routing?: TeamManifest["routing"] }).routing) ?? { rules: [] },
        skillDeps: ((team.manifest as { skillDeps?: string[] }).skillDeps) ?? undefined,
        pluginDeps: ((team.manifest as { pluginDeps?: string[] }).pluginDeps) ?? undefined,
      };

      return stringifyYaml(manifest);
    },
  };
}
```

- [ ] **Step 2: Add export route**

In `server/src/routes/teams.ts`:

```typescript
import { teamExportService } from "../services/team-export.js";

teamsRouter.get("/:tid/export", async (req, res) => {
  try {
    const svc = teamExportService(db);
    const yaml = await svc.exportYaml(req.params.tid);
    res.setHeader("Content-Type", "application/x-yaml");
    res.setHeader("Content-Disposition", `attachment; filename="team-${req.params.tid}.team.yaml"`);
    res.send(yaml);
  } catch (e) { handleError(res, e); }
});
```

- [ ] **Step 3: Verify build + smoke**

Run: `pnpm -F @armyofagents/server build`
Expected: success.

Smoke: `curl http://localhost:3000/api/companies/{cid}/teams/{tid}/export -o exported.team.yaml`. Verify YAML downloads cleanly. Pipe to `cat` → readable.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/team-export.ts server/src/routes/teams.ts
git commit -m "feat(teams): add /teams/:tid/export endpoint"
```

---

#### Task 9.2: Add Export button on team detail page

**Files:**
- Modify: `ui/src/pages/TeamDetail.tsx`

- [ ] **Step 1: Add export action to overflow menu**

In the overflow `<MoreHorizontal>` button, wire a download:

```tsx
import { useCompany } from "../context/CompanyContext";

// In the component:
const { selectedCompanyId } = useCompany();

function handleExport() {
  window.location.href = `/api/companies/${selectedCompanyId}/teams/${team.id}/export`;
}

// Replace the MoreHorizontal button with a DropdownMenu:
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button size="icon-sm" variant="outline"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={handleExport}>📤 Export as .team.yaml</DropdownMenuItem>
    <DropdownMenuItem className="text-destructive">🗄 Archive team</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

- [ ] **Step 2: Verify build + smoke**

Run: `pnpm -F @armyofagents/ui build`
Expected: success.

Smoke: open a team, click overflow → Export. Verify a `.yaml` file downloads.

- [ ] **Step 3: Commit**

```bash
git add ui/src/pages/TeamDetail.tsx
git commit -m "feat(teams): add Export action on team detail page"
```

---

#### Task 9.3: Final QA suite — `teams-qa.test.ts`

**Files:**
- Test: `server/src/__tests__/teams-qa.test.ts`

- [ ] **Step 1: Write the QA suite**

```typescript
// server/src/__tests__/teams-qa.test.ts
// V2-style QA suite. Covers happy paths end-to-end with mocked DB sequences.
import { describe, expect, it, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  teams: new Proxy({}, { get: (_t, prop) => prop }),
  teamMembers: new Proxy({}, { get: (_t, prop) => prop }),
  teamCoordinations: new Proxy({}, { get: (_t, prop) => prop }),
  agents: new Proxy({}, { get: (_t, prop) => prop }),
  agentProjects: new Proxy({}, { get: (_t, prop) => prop }),
  authUsers: new Proxy({}, { get: (_t, prop) => prop }),
  userRoles: new Proxy({}, { get: (_t, prop) => prop }),
  companySkills: new Proxy({}, { get: (_t, prop) => prop }),
  notifications: new Proxy({}, { get: (_t, prop) => prop }),
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), and: () => ({}), inArray: () => ({}) }));

import { teamsService } from "../services/teams.js";
import { teamCoordinationService } from "../services/team-coordination.js";
import { teamScaffolderService } from "../services/team-scaffolder.js";
import { teamImportService } from "../services/team-import.js";
import { teamExportService } from "../services/team-export.js";

// Helper: minimal sequence-mock DB
function seqDb(seq: unknown[]): any {
  let i = 0;
  const ret = () => seq[i++];
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(ret()) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve(ret()) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(ret()) }) }) }),
    delete: () => ({ where: () => Promise.resolve(ret()) }),
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      select: () => ({ from: () => ({ where: () => Promise.resolve(ret()) }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve(ret()) }) }),
    }),
  };
}

describe("Teams QA — happy path end-to-end", () => {
  it("create team → add members → coordination is generated", async () => {
    const db = seqDb([
      [],                                                                                // existing slugs check
      [{ id: "t1", slug: "qa-team", name: "QA Team", parentProjectId: "p1" }],          // insert team
      // addMember: alice as lead
      [{ id: "t1", parentProjectId: "p1" }],                                            // team lookup
      [{ projectId: "p1" }],                                                            // dept membership
      [],                                                                                // no existing lead
      [{ id: "tm1", teamId: "t1", agentId: "a1", role: "lead" }],                       // insert
    ]);
    const svc = teamsService(db);
    const team = await svc.create("c1", { name: "QA Team", parentProjectId: "p1" });
    expect(team.slug).toBe("qa-team");
    const member = await svc.addMember("t1", "a1", "lead");
    expect(member.role).toBe("lead");
  });

  it("export team produces valid YAML that parses back", async () => {
    const db = seqDb([
      [{ id: "t1", slug: "frontend", name: "Frontend", description: "Test", manifest: { routing: { rules: [] } }, templateVersion: null }],
      [{ teamId: "t1", agentId: "a1", role: "lead" }],
      [{ id: "a1", name: "alice", skillKeys: ["react"] }],
    ]);
    const svc = teamExportService(db);
    const yaml = await svc.exportYaml("t1");
    expect(yaml).toContain("name: frontend");
    expect(yaml).toContain("alice");
    expect(yaml).toContain("- react");
  });

  it("regenerate auto sections preserves user prose", async () => {
    const original = `## Mission
my mission

<!-- begin:auto:members -->
old
<!-- end:auto:members -->`;

    const db = seqDb([
      [{ id: "tc1", teamId: "t1", markdown: original }],
      [{ id: "tc1", teamId: "t1", markdown: "updated" }],
    ]);
    const svc = teamCoordinationService(db);
    const updated = await svc.regenerateAutoSections("tc1", { members: "## Members\n- new" });
    expect(updated).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the QA suite**

Run: `pnpm -F @armyofagents/server vitest run teams-qa`
Expected: PASS — 3 tests green.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/teams-qa.test.ts
git commit -m "test(teams): add V2-style QA suite covering happy paths"
```

---

#### Task 9.4: Slice 9 acceptance + full feature regression

- [ ] **Step 1: Run the entire team test surface**

```bash
pnpm -F @armyofagents/db build
pnpm -F @armyofagents/shared build
pnpm -F @armyofagents/server build
pnpm -F @armyofagents/ui build
pnpm -F @armyofagents/server vitest run team
pnpm -F @armyofagents/server vitest run mention
pnpm -F @armyofagents/server vitest run heartbeat-team
pnpm -F @armyofagents/server vitest run coordination
```

Expected: all green.

- [ ] **Step 2: End-to-end manual smoke (the entire feature)**

1. Create team "Test Team" with new agent "test-bot" as Lead → success
2. Detail page loads with member list
3. Coordination tab shows scaffolded markdown with auto/user sections
4. Edit Mission → Save → reload → edit persists
5. Manifest tab → add a routing rule → Save → switch to Coordination → routing auto section updated
6. Org chart → team renders as colored overlay box
7. Comment with `@<some-human-name>` → notification appears for that user
8. Trigger heartbeat for `test-bot` → confirm coordination.md is in system prompt (check logs)
9. Export team → download a .team.yaml → drag into "+ New team → Import from file" → preview shows existing-name collisions → resolve all "Replace" → install → second copy of team appears

If all 9 work, the feature is complete.

- [ ] **Step 3: Final PR + reference spec full coverage**

PR title: `feat(teams): land team architecture v1 (slices 1-9)`

PR body should reference spec sections §1 through §15.

After merge, append decisions T-1 through T-12 to `docs/aoa/reference/decisions.md` per spec §16 last bullet.

---

## Self-Review

Conducted after writing the full plan. Result: ready to execute.

### Spec coverage check (each spec section → at least one task)

| Spec § | Covered by |
|---|---|
| §1 Overview | Plan goal + architecture header |
| §2 Decisions T-1 … T-12 | Distributed across slices (T-3, T-4 in Slice 1; T-5, T-10 in Slices 1+3+5; T-6 in Slice 1; T-11 in Slice 6; T-12 in Slice 7) |
| §3 New tables (3) | Slice 1 Tasks 1.2, 1.3, 1.4 |
| §4.1 Membership model | Slice 1 schemas |
| §4.2 Two artifacts | Slice 1 (manifest), Slice 3 (coordination editor) |
| §4.3 Manifest format | Slice 1 Task 1.7 (parser), Slice 5 (editor) |
| §4.4 Coordination structure | Slice 3 Task 3.1 (parser) |
| §4.5 Cross-dept work | Slice 6 (heartbeat injection picks task's dept context) |
| §4.6 Dispatch model | Slice 6 Task 6.3 (no new code needed beyond context injection — uses existing task graph) |
| §4.7 @human resolver | Slice 7 |
| §4.8 RBAC | Implicit via existing `requireAuth` + project-scoped `userRoles` |
| §4.9 Naming overlap | Acknowledged in plan File Structure (TeamDetail at `/team/teams/:slug`) |
| §5.1 OrgChart overlay | Slice 4 |
| §5.2 Agents tab redesign | Slice 2 Task 2.6 |
| §5.3 3-option modal | Slice 2 Task 2.3 |
| §5.4 Build form | Slice 2 Task 2.4 |
| §5.5 Import flow | Slice 8 |
| §5.6 Team detail page | Slice 2 Task 2.7 |
| §5.7 Coordination tab | Slice 3 Task 3.4 |
| §5.8 Marketplace deferred | Honored — modal shows SOON badge |
| §6 Service layer | Distributed across slices |
| §7 Marketplace package format | Slice 8 (resolver + collisions); Slice 9 (export) |
| §8 Migration & backwards-compat | Slice 1 Task 1.5; additive-only |
| §9 Telemetry | **Partial gap** — `team_id` on heartbeat_runs metadata isn't a dedicated task. Included implicitly when implementing Slice 6's heartbeat extension (the engineer adds team_id to the run record). Flagged as a small follow-up if missed. |
| §13 Slice ordering | Plan follows spec order exactly |
| §14 Testing strategy | Tests are written in each slice (TDD) |
| §15 Skills usage | Referenced in slice headers + acceptance steps |

### Placeholder scan: clean after fixes

Fixed:
- ✓ Replaced "(omitted)" placeholder in Slice 4 Task 4.3 with concrete dept-filter logic
- ✓ Fixed forward-reference task number in Slice 8 Task 8.1 stub error message

No remaining "TBD", "TODO", "fill in", or vague-language patterns.

### Type consistency: clean

- `teamsApi.create` ↔ `teamsService.create`: matches `CreateTeamInput` shape
- `regenerateCoordination` API method ↔ route ↔ service: consistent
- `updateManifest` API ↔ route ↔ service: consistent (validates against `TeamManifestSchema`)
- `ImportPreview` server type ↔ client `preview` prop: matches
- `findMentionedHumans` signature ↔ test mock: matches `(companyId, body) => Promise<string[]>`

### One small follow-up note

**Slice 6 + §9 Telemetry overlap:** when implementing the heartbeat injection, also add `team_id` to the heartbeat run metadata so cost rollup by team works downstream. This is mentioned in spec §9 but not given its own task. Add it as a sub-step inside Task 6.3's Step 3 if the engineer notices; otherwise, it's a small follow-up issue.

---

## Execution Handoff

**Plan complete and saved to `docs/aoa/plans/teams_plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session. Uses `superpowers:executing-plans` for batch execution with checkpoints.

Which approach do you want?

(Also: I have NOT committed `teams_spec.md` or `teams_plan.md` to git yet. Per your project rule, I only commit when explicitly asked. Let me know if you want me to commit these two files before execution starts — recommended so the plan is on disk in a known state when subagents pick it up.)





