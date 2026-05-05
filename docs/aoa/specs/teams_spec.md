# Teams — Architecture & Design Spec

**Status:** Design locked — ready for implementation planning
**Date:** 2026-04-28
**Scope:** Adds first-class team grouping inside departments, agent-only members, lead/member roles, an LLM-injected coordination contract, and a packageable manifest format that anticipates a curated marketplace.
**Depends on:** existing `agents`, `agent_projects`, `projects`, `userRoles`, `company_skills`, `notifications` tables.

---

## 1. Overview

### Problem

Today AoA models a flat "agents in a department" relationship via `agent_projects`. As a department grows (5 → 30 agents), users have no way to group agents into smaller working units, no documented contract for how those units coordinate internally, and no way to share working configurations across companies. The architecture works for solo founders with handfuls of agents but does not scale to 50–100-person teams across multiple departments.

### What "Team" Is

A **team** is a named, optional sub-grouping of agents inside a single department. Each team has:
- A **lead** agent (the team's public interface — external callers `@mention` the lead)
- Zero or more **member** agents (do the work; receive delegated tasks from the lead)
- A **manifest** (structured config: routing rules, skill deps, plugin deps, version)
- A **coordination contract** (markdown document injected into every team member's system prompt — explains mission, scope, members, escalation, edge cases)

A team is **always anchored to one department**. Cross-department work is supported because **memory and task context flow from the task, not the agent** (see §4.5).

### Goals

1. Departments can hold humans + teams + individual agents together.
2. Agents can be on a team or standalone — teams are additive, not mandatory.
3. The team's coordination contract is editable, versioned, and packageable.
4. Teams can be exported as files and (eventually) installed from a curated marketplace.
5. The runtime and UI consume the same patterns AoA already uses (heartbeat dispatch, `company_skills`-style markdown docs, `agent_projects`-style M2M membership, the OrgChart pan/zoom canvas).

### Non-goals (v1)

- Cross-department team membership (single team instance spanning multiple departments).
- User-submitted marketplace publishing (curated catalog only at v1).
- Inter-agent RPC for dispatch (heartbeat + task graph is the primitive).
- Co-leads or multi-lead teams (one lead per team — extensible later).
- Observers / silent-listener team roles.
- Drag-to-reorganize teams in the org chart.

---

## 2. Locked Architectural Decisions

These were settled during the design pass. See §13 for the validation work that grounded them.

| # | Decision | Rationale |
|---|---|---|
| T-1 | Teams are scoped to ONE department (single FK `parent_project_id`) | Clean RBAC + budget inheritance; cross-dept needs solved by Specialists pool or own-dept model |
| T-2 | Team members are agents only — humans live at department level via `userRoles` | Humans aren't dispatched; they're notified. Already first-class via `userRoles`. |
| T-3 | One agent per team is the **lead** — the public interface for external callers | Encapsulation pattern from CrewAI's manager_agent + OpenAI Swarm handoffs |
| T-4 | Roles: `lead` and `member`. NO `senior`/`junior` | Aligns with existing `userRoles.role` (`team_lead`/`team_member`); function not skill |
| T-5 | **Routing rules** live in `manifest.yaml` (structured); **prose** lives in `coordination.md` (free-form) | Separation prevents ambiguity about which source wins when they conflict |
| T-6 | `coordination.md` storage uses **Path B** — separate `team_coordinations` table mirroring `company_skills` | Reuses skill machinery (CRUD, file inventory, trust, source tracking, marketplace pipeline); future-proofs for multi-doc-per-team, drafts, versions |
| T-7 | Manifest format is **hybrid containment + composition** — agents can be inlined OR referenced via `$ref: "@org/agent@version"` | Containment works pre-registry; composition unlocks once registry exists; same file format both ways |
| T-8 | Marketplace install resolves dependencies in a **flat cascade** (no transitive deps in v1) | Predictable, simple resolver; refuse on version collision with clear error |
| T-9 | Marketplace is **curated and read-only at v1** — no user submissions | Lower trust/security surface; revisit when demand exists |
| T-10 | Auto-managed sections of `coordination.md` use HTML comment markers (`<!-- begin:auto:NAME --> ... <!-- end:auto:NAME -->`) | Preserves user-authored prose across regeneration; mechanical and predictable |
| T-11 | Dispatch from lead → member uses existing **task graph + heartbeat + @mention** mechanisms | No new RPC layer; durable, observable, restartable |
| T-12 | `@human` mentions land in `notifications` table; humans are **passive recipients** (not dispatched) | Mirrors Slack/Linear/GitHub model; preserves agent/human distinction |

---

## 3. New & Modified Tables

### New tables (3)

#### 3.1 `teams`

```typescript
// packages/db/src/schema/teams.ts
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  parentProjectId: uuid("parent_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  // Manifest = structured config. Live-edited; portable as YAML.
  manifest: jsonb("manifest").$type<TeamManifest>().notNull().default({}),
  // Marketplace tracking
  templateOrigin: text("template_origin"),       // "@aoa/frontend-team"
  templateVersion: text("template_version"),     // "1.0.0"
  // Status
  status: text("status").notNull().default("active"),  // 'active' | 'archived'
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("teams_company_idx").on(table.companyId),
  parentProjectIdx: index("teams_parent_project_idx").on(table.parentProjectId),
  companySlugUq: uniqueIndex("teams_company_slug_uq").on(table.companyId, table.slug),
}));
```

#### 3.2 `team_members`

```typescript
// packages/db/src/schema/team_members.ts
export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  role: text("role").notNull(),  // 'lead' | 'member'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  teamAgentUq: uniqueIndex("team_members_team_agent_uq").on(table.teamId, table.agentId),
  teamIdx: index("team_members_team_idx").on(table.teamId),
  agentIdx: index("team_members_agent_idx").on(table.agentId),
}));
```

**Constraints (enforced at service layer):**
- Exactly one `role='lead'` per team (not at most — every team has a lead).
- Agent must already be a member of the team's parent department (via `agent_projects`) at insert time.
- An agent can be on multiple teams across the company (cross-team participation supported).

#### 3.3 `team_coordinations`

Mirrors `company_skills` shape; one row per team (1:1 today, schema allows >1 for future drafts/translations).

```typescript
// packages/db/src/schema/team_coordinations.ts
export const teamCoordinations = pgTable("team_coordinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  key: text("key").notNull(),                 // e.g. "frontend-team:coordination"
  slug: text("slug").notNull(),
  name: text("name").notNull(),               // e.g. "Frontend Team Coordination"
  description: text("description"),
  markdown: text("markdown").notNull(),       // the actual contract
  sourceType: text("source_type").notNull().default("local_path"),
  sourceLocator: text("source_locator"),
  sourceRef: text("source_ref"),
  trustLevel: text("trust_level").notNull().default("markdown_only"),
  compatibility: text("compatibility").notNull().default("compatible"),
  fileInventory: jsonb("file_inventory").$type<FileInventoryEntry[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("published"),  // 'draft' | 'published' | 'archived'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyKeyUq: uniqueIndex("team_coordinations_company_key_uq").on(table.companyId, table.key),
  teamIdx: index("team_coordinations_team_idx").on(table.teamId),
  teamStatusIdx: index("team_coordinations_team_status_idx").on(table.teamId, table.status),
}));
```

### Modified tables (0)

No modifications. Teams are purely additive. Existing `agents`, `agent_projects`, `userRoles`, `notifications` schemas are untouched.

---

## 4. Architecture

### 4.1 The 4-layer membership model

```
Company           agents.companyId            (existing)
  └─ Department   agent_projects M2M          (existing)
       └─ Team    team_members M2M             (NEW)
            ├─ Lead      role='lead'           (NEW)
            └─ Member    role='member'         (NEW)
```

An agent can be:
- In a department, **not on any team** (loose agent — fine, fully supported)
- In a department, on **one team** in that department
- In a department, on **multiple teams** in that department
- In **multiple departments**, optionally on teams in any/all of them

### 4.2 The two coordination artifacts

Two artifacts ship together; neither is enough on its own.

| | `manifest.yaml` (in `teams.manifest` jsonb) | `coordination.md` (in `team_coordinations.markdown`) |
|---|---|---|
| **Purpose** | Structured config — machine-routable | Human/LLM context — narrative reasoning |
| **Format** | YAML / JSON | Markdown |
| **Audience** | System routing, validators, importers | Every team member's LLM at heartbeat time |
| **Editable** | Yes, in Manifest tab UI | Yes, in Coordination tab UI |
| **Validation** | Schema-validated | None — free prose |
| **Examples** | Routing rules, member list, skill deps, plugin deps, version | Mission, scope, edge cases, escalation policy |

Both ship together in a team package and travel together through import/export.

### 4.3 Manifest format

```yaml
schemaVersion: 1
name: frontend-team           # slug-style identifier
version: 1.0.0                # semver
displayName: "Frontend Team"
description: "..."

# MEMBERS — agents on this team. Either inline OR via $ref.
agents:
  # Inline form (containment) — full definition right here
  - name: alice
    role: lead                # 'lead' | 'member'
    skillKeys: [react, css, accessibility]
    instructionsTemplate: "..."  # optional override

  # Reference form (composition) — pulled from agent registry by name+version
  - $ref: "@aoa/junior-frontend@1.0.0"
    localName: bob
    role: member

# ROUTING — structured rules. Lead's LLM reads coordination.md for nuance;
# this section is for system auto-suggestions and analytics.
routing:
  defaultLead: "@alice"
  rules:
    - match: "stripe|billing"
      mention: "@alice"
    - match: "performance|bundle"
      mention: "@bob"

# DEPENDENCIES — fetched from their respective marketplaces during install
skillDeps:
  - "@aoa/react@^2.0.0"
  - "@aoa/css@^1.0.0"
pluginDeps:
  - "@aoa/github"
  - "@aoa/figma"
workflowTemplates:
  - $ref: "@aoa/spec-design-code-test@2.0.0"

# OPTIONAL — drops into parent dept's domain memory layer on install
memoryItems:
  - layer: domain
    title: "Frontend conventions"
    body: "..."
```

### 4.4 Coordination.md structure (convention, not schema)

The body has well-known sections rendered by the Coordination tab UI; structure is convention, not enforced.

```markdown
## Mission
We handle frontend bugs and features for the customer-facing app.

## Scope
### What we handle
- React, CSS, accessibility
- Build pipeline issues for the web app

### What we don't handle
- Backend, databases, infrastructure
- Mobile (separate team)

<!-- begin:auto:members -->
## Members
- **alice** [LEAD] — react, css, accessibility
- **bob** [MEMBER] — state-mgmt
- **charlie** [MEMBER] — testing
<!-- end:auto:members -->

<!-- begin:auto:routing -->
## Routing
- pattern `stripe|billing` → @alice
- pattern `performance|bundle` → @bob
- pattern `test|spec` → @charlie
- default → @alice (lead)
<!-- end:auto:routing -->

## Escalation
If a refund-related bug appears, ping the Billing Team lead — we don't own that domain.

## Edge cases
- Alice on parental leave Mondays — route to Bob those days.
- Anything user-facing on the checkout flow: pause for human review before deploying.
```

**The auto-managed sections** (`<!-- begin:auto:NAME --> ... <!-- end:auto:NAME -->`) regenerate from team data on demand. **Everything outside the markers is preserved verbatim** across regeneration. This keeps the user's prose safe while letting member-list and routing-summary stay accurate.

### 4.5 Cross-department work

A team is anchored to ONE department. **Cross-department work is supported because memory + context are TASK-driven, not agent-driven.** When a task in Department B is assigned to an agent who lives in Team X (Department A), the heartbeat context package includes:

- Identity memory (company-wide)
- **Department B's `domain` memory** (because the task lives in B)
- **Department B's `active_context` memory** (from the task's goal)
- Working memory (task-chain-scoped)
- The team's `coordination.md` (from team_coordinations)

The agent's "home dept" doesn't constrain what context they get — the task's dept does. This already works in [Context packaging (S20)](AoA-2.5/CLAUDE.md) and is leveraged unchanged for teams.

What the team scope (`teams.parent_project_id`) actually controls:
- **RBAC**: which dept's `team_lead` user has authority over this team
- **Budget**: where team agents' costs roll up
- **UI placement**: which dept's pages the team appears under

Memory is task-driven; ownership is dept-anchored. Two clean axes.

### 4.6 Dispatch model — how lead delegates to members

When the lead's heartbeat fires (triggered by external `@mention` or task assignment):

1. Lead reads:
   - Its own per-agent instructions (`AGENTS.md`/`SOUL.md`)
   - Team's `coordination.md` (injected into system prompt)
   - Manifest routing rules (system can pre-suggest delegation target)
   - Task content
2. Lead decides: handle directly, or delegate
3. If delegate: lead either —
   - Creates a **child task** (`parentId` = current task) assigned to the chosen member, OR
   - Posts a comment `@member please look at X` (which creates a notification + heartbeat trigger)
4. Member's heartbeat fires; member runs; member posts result
5. When member's child task completes, dependency resolution wakes the lead to aggregate

This uses only **existing AoA primitives** — task graph, heartbeat, `@mention`. No new dispatch layer.

### 4.7 `@human` mention support

A net-new sister resolver handles human mentions in any text body that already runs `findMentionedAgents`:

```typescript
// server/src/services/issues.ts
findMentionedHumans: async (companyId: string, body: string) => {
  // Same regex as findMentionedAgents (lines 1418-1427), matches against
  // authUsers + userRoles for the company instead of agents.
}
```

Both resolvers run in parallel on every comment/issue/discussion body. Conflict (rare): suffix disambiguation — `@alice-h` for human, `@alice` for agent.

For each mentioned human:
- Insert into `notifications` table (existing, V2.5)
- `type: 'mention'` (new subtype)
- `sourceType: 'issue_comment' | 'discussion_entry' | 'goal' | …`
- Appears in Inbox immediately with unread badge
- External delivery (email/push/Slack DM) routed through plugins later

**Humans are passive** — they get notified, not woken. They respond in their own time.

### 4.8 RBAC

| Role | Team capabilities |
|---|---|
| `founder` | Full CRUD on all teams in the company |
| `team_lead` | Full CRUD on teams in departments where they hold the role |
| `team_member` | Read-only on teams in their departments |

Existing `userRoles` table; no new role types. RBAC enforcement at the service layer follows `goals.ts` / `projects.ts` patterns.

---

### 4.9 Note on naming overlap with existing `/team` route

CLAUDE.md naming map shows `Org → Team` as a Paperclip→AoA UI rename — the existing `/team` page is the company-wide people-management surface (with tabs Org Tree / Agents / Humans). The new "teams" entity introduced in this spec is a *sub-entity* nested within that page.

Resolution at v1: **no rename, no separate top-level surface.** Teams live as a Section inside the existing Agents tab (§5.2), and team detail pages route under `/team/teams/{slug}`. The linguistic overlap (Team page contains Teams) is mild but coherent — and a rename of the existing `/team` route would be a bigger, separate change not justified by this feature.

Future consideration: if the overlap becomes painful in user testing, rename the existing top-level page to `/workforce` or `/people` (route alias kept for backwards-compat). Out of scope here.

---

## 5. UI/UX Surfaces

### 5.1 Org Chart with team overlay (Option A)

Existing `OrgChart.tsx` uses a pan/zoom canvas with computed tree layout from `reportsTo` chains. Team support adds **one new render pass**:

- For each team, compute a bounding box around the member cards (positions are already laid out)
- Render a translucent rounded rectangle behind the cards (team color, 7% opacity fill, 50% opacity dashed border)
- Place a small color-coded label tag at the top-left of the box: `⭐ FRONTEND TEAM`
- Lead agents get a **colored card border** matching the team color (subtle differentiation)
- Standalone agents (no team) render unchanged

**Toolbar additions:**
- Department filter dropdown (`Showing: All / Engineering / Marketing / …`)
- Optional "Show teams" toggle (default on)

No layout-algorithm changes. No interactive drag-to-move. Cards stay clickable; team boxes are pure visual overlay (`pointer-events: none`).

**Why Option A** (vs. nested dept boxes / dept tints): at 30+ agents per dept, dept boxes become giant rectangles around half the screen. Departments already have their own pages for identity. The org chart's job is showing relationships — which is what teams primarily express.

### 5.2 Agents tab redesign

`/team` page → **Agents** tab → two sections in one scrollable view:

**Top: Teams section**
- Header: `Teams (N)` + `+ New team ▾` button (dropdown reveals 3 options below)
- Grid of team cards. Each card shows:
  - Team icon (auto-generated from name or chosen on create)
  - Team name + parent dept tag (small pill)
  - One-line summary: `⭐ alice + 2 members · 3 agents · active`
  - **No human-style avatars** — just text-based summary with a star marking the lead
  - 3-dot overflow menu: Edit, View members, Archive
- Colored left border in team color matches the org chart treatment

**Bottom: Individual agents section**
- Existing card layout, unchanged
- Header: `Individual agents (N)` + `+ New agent` button
- Filtered to agents not on any team (computed: `WHERE agent.id NOT IN (SELECT agent_id FROM team_members)`)

Tab name stays "Agents" (familiar). Team cards come first because they represent more org density.

### 5.3 "+ New team" entry modal (3 options)

When the user clicks `+ New team`, a modal opens with three side-by-side option cards:

1. **Build from scratch** (default highlighted) — takes them to the Create form (§5.4)
2. **Import from file** — takes them to the Import flow (§5.5)
3. **Browse marketplace** — disabled, marked `SOON`, surfaced for transparency about the future

### 5.4 Build-from-scratch (Create form)

Single slide-over modal, all fields visible, no wizard steps.

**Top section (always visible):**
- `Team name *` text input
- `Parent department *` dropdown (defaults to first dept; required)
- `Description` (optional textarea)

**Members section (always visible):**
- Header: `Members (N added)` + two action buttons:
  - `+ Pick existing` → opens search picker over company's agents not already on this team
  - `+ Create new` → expands inline new-agent form (name, role-in-team, adapter, auto-suggested skills)
- Each added member shows:
  - Agent name + status pill: `EXISTING` (blue) or `NEW` (green)
  - For NEW members: expanded inline fields (adapter, skills with auto-suggestions)
  - Role-in-team selector: `⭐ Lead ▾` or `Member ▾` (exactly one lead required)
  - Remove (×)

**Coordination section (collapsed by default):**
- "Auto-generated from member list — preview / edit before save"
- Expand to see/edit the LLM-scaffolded markdown

**Footer:**
- Live summary: `Will create: 1 agent · 1 team · 1 coordination.md`
- `Cancel` · `Create team →`

**On Create:**
1. Service creates any `NEW` agents (inheriting parent dept membership via `agent_projects` insert)
2. Creates `teams` row
3. Inserts `team_members` rows
4. Calls scaffolder service (LLM) to generate `coordination.md` from members + dept + description
5. Inserts `team_coordinations` row
6. Redirects to `/team/teams/{slug}` (team detail page)

### 5.5 Import-from-file flow

Two stages.

**Stage 1 — Upload modal:**
- Drag-drop zone OR `Browse files` button
- Accepts `.team.yaml`, `.team.yml`, `.team.zip` up to 5MB
- Note: "File is parsed and you'll get a preview before anything is written."

**Stage 2 — Preview & install modal** (the meaningful screen):
- **Header**: package name + version + signature badge (when signing ships)
- **Amber banner**: "Pick a parent department" — required because templates are dept-agnostic
- **Members list**: each member shown with status + action:
  - 🟢 `WILL BE CREATED` — clean install
  - 🔴 `NAME COLLISION` — `Rename ▾` / `Replace ▾` / `Skip ▾` action
- **Skills**: chips colored by state (green = installed, amber = will fetch from skill marketplace)
- **Plugin deps**: same green/amber treatment
- **Coordination preview**: expandable, comes pre-authored from package
- **Footer summary**: `Will: create N agents · install N skills · install N plugins · resolve N collisions`
- `Cancel` · `Install team →`

**On Install** (cascade resolver):
1. For each missing skill → fetch from skill marketplace, install into `company_skills`
2. For each missing plugin → fetch from plugin registry, install
3. For each missing workflow template → fetch, install
4. Resolve collision actions (rename, replace, skip)
5. Create new agents
6. Create team + team_members + team_coordinations
7. Redirect to `/team/teams/{slug}`

If any step fails, the entire install rolls back transactionally.

### 5.6 Team detail page

Route: `/team/teams/{slug}`

**Page header:**
- Team icon, name, parent dept tag, status badge
- `⭐ alice · N members` summary
- Actions: `Edit`, overflow menu

**Tabs:**
1. **Overview** (default) — 2-column layout:
   - Left: Members list (cards with role badges, lead has colored left border + `⭐ LEAD` label)
   - Right: Coordination preview card + Quick stats (member count, active tasks, runs today, spent)
2. **Coordination** — see §5.7
3. **Manifest** — YAML editor with schema validation (routing rules, deps); changes regenerate auto sections in coordination.md
4. **Activity** — Recent heartbeat runs by team members + recent `@mentions` of the team lead + recent task completions

### 5.7 Coordination tab

**Toolbar:**
- `↻ Regenerate auto sections` — re-runs the scaffolder for `<!-- begin:auto:* -->` regions only; preserves user-authored sections
- `👁 Preview as LLM` — modal showing exactly what each member's system prompt will look like (the team's `coordination.md` plus the member's own per-agent instructions, concatenated)
- `Save` (primary)

**Body — sectioned editor:**
- Hand-written sections (Mission, Scope, Escalation, Edge cases) — white background, `YOUR EDITS` badge in the section header, fully editable inline
- Auto-managed sections (Members, Routing) — subtle purple-tinted background, `⚙ AUTO · MEMBERS TABLE` (or `⚙ AUTO · FROM MANIFEST`) badge, italic warning: *"This section regenerates whenever team membership changes. Don't edit by hand — your changes will be overwritten."*
- Routing section deep-links to Manifest tab for editing (single source of truth)

**Storage:** the entire body is `team_coordinations.markdown`. The editor parses HTML comment markers to render section visuals; serializes back to markdown on save.

### 5.8 Marketplace (deferred to actual build)

UI not designed in this spec. Format and resolver ARE locked (§4.3 manifest, §5.5 cascade install). The third option in the `+ New team` modal stays visible with a `SOON` tag so users know it's coming and isn't a bug. When build begins, the import-flow preview-and-install screen is reused; only the source changes (file upload → marketplace browse).

---

## 6. Service Layer Plan

Following AoA convention (one service file per domain) and the **factory pattern** used by `goals.ts` / `projects.ts`:

```typescript
// server/src/services/teams.ts (skeleton, matches goalService pattern)
export function teamsService(db: Db) {
  return {
    list: async (companyId: string, projectId?: string) => { ... },
    getById: async (id: string) => { ... },
    create: async (companyId: string, input: CreateTeamInput) => { ... },
    update: async (id: string, patch: UpdateTeamInput) => { ... },
    archive: async (id: string) => { ... },
    addMember: async (teamId: string, agentId: string, role: TeamRole) => { ... },
    removeMember: async (teamId: string, agentId: string) => { ... },
    updateMemberRole: async (teamId: string, agentId: string, role: TeamRole) => { ... },
  };
}
```

| File | Purpose |
|---|---|
| `server/src/services/teams.ts` | CRUD for teams + team_members; factory pattern returning `{list, getById, create, update, archive, addMember, removeMember, updateMemberRole}` |
| `server/src/services/team-coordination.ts` | CRUD for team_coordinations + section-marker parsing/regen; factory pattern |
| `server/src/services/team-scaffolder.ts` | LLM-backed scaffold of coordination.md (called by Commander session — interface only here, implementation deferred to Commander work) |
| `server/src/services/team-manifest.ts` | Pure functions for manifest YAML validation + serialization + dependency resolution (no `db` dependency — testable as pure functions) |
| `server/src/services/team-import.ts` | Import flow: parse → preview → cascade install; factory pattern with transactional install |
| `server/src/services/team-export.ts` | Export flow: serialize team + manifest + coordination + file inventory; reuses `server/src/services/company-portability/` machinery |

### Migration

```bash
# After adding the 3 schema files in packages/db/src/schema/
pnpm db:generate    # generates migration SQL — DO NOT hand-write per CLAUDE.md Critical Rule #1
```

Migration is purely additive (3 new tables, no modifications to existing). No rollback risk; existing companies continue to work without teams.

### Routes

| Path | Purpose |
|---|---|
| `GET /companies/:cid/teams` | List teams (filter by dept, status) |
| `POST /companies/:cid/teams` | Create team (build-from-scratch flow) |
| `GET /companies/:cid/teams/:tid` | Get team detail |
| `PATCH /companies/:cid/teams/:tid` | Update team (name, manifest, archive) |
| `DELETE /companies/:cid/teams/:tid` | Delete team (cascades to team_members + team_coordinations) |
| `POST /companies/:cid/teams/:tid/members` | Add member |
| `DELETE /companies/:cid/teams/:tid/members/:aid` | Remove member |
| `PATCH /companies/:cid/teams/:tid/members/:aid` | Change role (lead reassignment) |
| `GET /companies/:cid/teams/:tid/coordination` | Get current coordination doc |
| `PUT /companies/:cid/teams/:tid/coordination` | Update coordination doc |
| `POST /companies/:cid/teams/:tid/coordination/regenerate` | Regenerate auto sections |
| `POST /companies/:cid/teams/import/preview` | Parse file, return preview JSON |
| `POST /companies/:cid/teams/import/install` | Execute install with collision resolutions |
| `GET /companies/:cid/teams/:tid/export` | Export team as `.team.yaml` |

### Heartbeat integration

When an agent's heartbeat fires, the existing context-packaging step (in `server/src/services/heartbeat.ts` or equivalent) is extended:

```typescript
// pseudocode
const teamMemberships = await db.select(...).from(teamMembers).where(eq(agentId, agent.id));
for (const tm of teamMemberships) {
  const coord = await db.select(...).from(teamCoordinations)
    .where(and(eq(teamId, tm.teamId), eq(status, 'published')))
    .limit(1);
  if (coord) systemPrompt += `\n\n# Team coordination — ${team.name}\n${coord.markdown}`;
}
```

Coordination doc is appended to the system prompt for every team member. Lead and members see the same content; their per-agent instructions differentiate role.

---

## 7. Marketplace Package Format

### Package layout

A team package is either:
- A single `.team.yaml` file (containment-only manifest) — most common at v1
- A `.team.zip` containing:
  - `manifest.yaml`
  - `coordination.md`
  - `assets/` — images, supporting markdown referenced from coordination.md (matches `fileInventory`)
  - `agents/` — optional inlined agent instruction files (only if agents are inlined, not `$ref`-d)

### Resolver behavior at install time

1. Parse `manifest.yaml` against schema (reject with clear error if invalid)
2. Verify signature if present (`trustLevel: 'signed'` requires a known signer; v1 ships `markdown_only` only)
3. For each `agents[i]` with `$ref` → fetch from agent registry
4. For each `skillDeps[i]` → check `company_skills`; if missing, fetch from skill registry
5. For each `pluginDeps[i]` → check installed plugins; if missing, fetch from plugin registry
6. For each `workflowTemplates[i]` → similar
7. Surface collisions (existing agent with same name) for user resolution
8. Once resolved → create everything in a transaction
9. Insert `teams.templateOrigin` + `templateVersion` for upgrade tracking

### Version collision policy (v1)

If an installed skill version conflicts with a required version:
- v1: **Refuse install** with a clear "incompatible version already installed; resolve first" error and a path to upgrade the global skill (with a recheck of other dependent teams)
- Future: side-by-side versioning via per-team skill scope

---

## 8. Migration & Backwards Compatibility

- All changes are **purely additive**. Existing `agents`, `agent_projects`, `userRoles`, `notifications` schemas are untouched.
- Existing companies with no teams continue to work unchanged. The Agents tab shows everyone in the "Individual agents" section.
- Existing OrgChart renders identically until a team is created, at which point the new overlay layer activates.
- Existing `findMentionedAgents` continues to work; `findMentionedHumans` is added in parallel and called alongside it.
- Existing `agent_projects` membership is unchanged; team membership is layered on top via `team_members`.

---

## 9. Telemetry & Observability

- Agent runs (heartbeat completions) gain a `team_id` field in `internal_agent_runs` / `heartbeat_runs` metadata when the agent is on a team. Enables team-level cost rollup.
- Activity feed entries on the team detail page query `activity_log` filtered by `(actor_type='agent' AND actor_id IN team_members.agent_id)`.
- Coordination regeneration events write to `activity_log` so user can audit when auto sections changed.

---

## 10. Out of scope for v1

- User-submitted marketplace publishing
- Team-level memory layers (separate from dept's `domain` layer)
- Team-level budgets (separate from dept rollup)
- Co-leads or multi-lead teams
- Observer / silent-listener roles
- Cross-department single-team-instance membership
- Drag-to-reorganize teams in the org chart
- Auto-suggested team formation (clustering agents by skill)
- Team templates created from existing live teams (export-as-template)
- Visual handoff functions (Swarm-style explicit `delegate_to(member)` tools)
- Graph-based coordination editor (LangGraph-style)

---

## 11. Open questions (deferred — not blocking implementation)

1. **Inbox dedupe window for `@human` notifications** — what's the right interval (10 min? 1 hour?) for collapsing repeated mentions on the same task into a single Inbox entry?
2. **Team archival vs deletion** — does archive cascade to coordination + manifest, or keep them readable? Default proposal: archive flips status, preserves data; deletion cascades.
3. **Coordination preview-as-LLM rendering** — should it show exactly what's injected (system prompt + user message) or just the team-level injection? Default proposal: just team-level for clarity.
4. **What happens if the lead is removed from the team?** — refuse without picking a new lead first, vs. allow with a warning. Default proposal: refuse; force user to designate new lead.
5. **Agent pause/terminate effect on team** — if a member is paused, do they still appear in coordination.md auto sections? Default proposal: yes, with status pill; LLM context can include their status.

---

## 12. Validation against reference implementations

Architecture was validated against three reference codebases (United Agents, OpenClaw, Google ADK) before locking. Key findings:

- **Senior-as-interface pattern** (CrewAI's `manager_agent`, OpenAI Swarm's handoff functions, ADK's root Workflow) confirmed as established practice. Adopted as Lead.
- **Markdown system-prompt injection** (CLAUDE.md, AGENTS.md, .cursor/rules, SKILL.md) is widely validated at project scope; team-scope variant of the same pattern is sound.
- **Routing-rules-vs-prose split** corrects a real ambiguity in the original draft (where coordination.md held both). Now: structured rules in manifest, prose in markdown — no overlap, no "which wins."
- **Heartbeat + persistent task graph** is genuinely stronger than UA's polling or ADK's in-process workflow for production team scale. Durable, observable, restartable.
- **Marketplace-first packaging** built into the format day one is novel — no reference system has this.
- **Coordination.md schema validation** was recommended by the validation but rejected after Decision T-5 — once routing moves to manifest, coordination.md has nothing structured left to validate.

Three patterns flagged as borrowable for future iterations:
- ADK's `HitlNode` (formal human-in-the-loop checkpoint primitive)
- ADK's `ParallelWorker` + `JoinNode` (formal fan-out/fan-in primitive — pairs with the missing Loop primitive)
- A2A microservice model (when teams scale to 50+ agents, agents-as-services becomes attractive)

---

## 13. Implementation slice ordering (suggested)

Each slice ships standalone value:

1. **Schema + service skeleton** — teams, team_members, team_coordinations tables; basic CRUD; backwards-compat tests
2. **Build-from-scratch UI** — Agents tab redesign + Create form + Team detail page (Overview tab)
3. **Coordination tab** — read-only first, then editor with section markers + regenerate button
4. **Org chart team overlay** — render pass + dept filter dropdown
5. **Manifest tab** — YAML editor with validation
6. **Heartbeat integration** — coordination.md injected into team-member system prompts
7. **`@human` resolver + notifications** — sister to findMentionedAgents
8. **Import flow** — file upload → preview → cascade install
9. **Export flow** — `.team.yaml` download
10. **Marketplace UI** — when ready (separate spec)

---

## 14. Testing Strategy

Follows AoA's V2 test patterns from CLAUDE.md (works around the drizzle-orm ESM cycle issue). Three test types map to three test categories:

### 14.1 Pure function tests (import directly, no mocks)

Pure utilities are testable without any DB or service mocking. Test file naming: `<module>.test.ts` in `server/src/__tests__/`.

| Test file | Target | Cases |
|---|---|---|
| `team-manifest.test.ts` | `team-manifest.ts` validation + serialization | Valid manifest parses · invalid schemaVersion rejected · missing required fields rejected · `$ref` syntax parsed correctly · YAML ↔ JSONB roundtrip preserves structure · routing rule patterns are valid regex |
| `team-coordination-parser.test.ts` | Section-marker parser in `team-coordination.ts` | `<!-- begin:auto:NAME -->` blocks extracted · auto regions replaced cleanly · user prose preserved verbatim · malformed markers fall back to no-op · nested markers rejected |
| `team-slug.test.ts` | Slug generation | Special chars stripped · uniqueness within company enforced · max length capped · collision suffix `-2`, `-3` |

### 14.2 Service tests with mocks (Proxy-based table stubs)

Per CLAUDE.md V2 Test Patterns: *"Mock `@armyofagents/db` and `drizzle-orm` with Proxy-based table stubs and no-op operators. Use sequence-based mock DBs (`createSequenceDb`) where each `select`/`update`/`insert` returns the next pre-configured result."*

Reference: existing `server/src/__tests__/helpers/mock-db.ts` already has the pattern.

| Test file | Target | Cases |
|---|---|---|
| `teams-service.test.ts` | `teamsService` | create with valid inputs · create rejects invalid parent_project_id · addMember enforces dept membership · addMember enforces single-lead-per-team · updateMemberRole reassignment from one lead to another · removeMember rejects last member if it's the lead without replacement |
| `team-coordination-service.test.ts` | `teamCoordinationService` | upsert preserves user prose across regen · regenerate auto sections only · status transitions (draft → published → archived) |
| `team-import-service.test.ts` | `teamImportService` | preview returns parsed manifest + collision report · install runs in transaction · rollback on dependency-fetch failure · refuses on version collision · resolves rename/replace/skip collision actions |
| `team-export-service.test.ts` | `teamExportService` | exports manifest + coordination + file inventory · strips runtime IDs (UUIDs → slugs) · roundtrip import after export produces equivalent team |
| `team-scaffolder-service.test.ts` | `teamScaffolderService` (interface) | scaffold called with members + dept produces well-formed markdown · auto sections wrapped in `<!-- begin:auto:NAME -->` markers — implementation mocked since real LLM call is out of scope |

### 14.3 Contract tests (API shapes)

Verify route shapes and constants without importing drizzle internals.

| Test file | Target | Cases |
|---|---|---|
| `teams-routes-contract.test.ts` | All `/companies/:cid/teams*` routes | Request/response schemas match shared types · 401 unauthenticated · 403 wrong RBAC role · 404 unknown team · 422 validation error shape |
| `team-coordination-routes-contract.test.ts` | All `/coordination` routes | Same coverage |
| `team-import-routes-contract.test.ts` | Import preview + install routes | Shape matches collision report contract · install endpoint accepts collision-resolution map |

### 14.4 Integration tests

Cover cross-component flows that pure-function and service tests can't.

| Test file | Target | Cases |
|---|---|---|
| `heartbeat-team-coordination.test.ts` | Heartbeat context-packaging extension | When agent is on a team, coordination.md is appended to system prompt · when agent is on multiple teams, all are appended · when agent is on no team, no team-coordination prefix appears · published-status only (drafts excluded) |
| `mention-resolver-humans.test.ts` | New `findMentionedHumans` alongside existing `findMentionedAgents` | `@alice-h` resolves to human · `@alice` resolves to agent · both resolve when both exist · suffix disambiguation works · mention triggers notification row insert with correct `type: 'mention'` |
| `team-import-cascade.test.ts` | Full import cascade | Skill marketplace mock returns expected packages · plugin resolver installs missing plugins · transactional rollback on partial failure |

### 14.5 V2-style QA suite

Following the pattern of `v2-memory-qa.test.ts`, `v2-artifacts-qa.test.ts`, etc.: a single high-level QA test file that covers happy paths end-to-end across the team feature.

| Test file | Coverage |
|---|---|
| `teams-qa.test.ts` | Create team → add members → edit coordination.md → trigger heartbeat (verify injection) → export team → re-import to second company → verify equivalence |

### 14.6 Test-first per slice (TDD)

Each implementation slice (§13) ships with its tests written first per the **`superpowers:test-driven-development`** skill. Acceptance gate per slice:

1. Pure function tests pass
2. Service tests pass
3. Contract tests pass
4. Integration tests pass (where applicable)
5. Build clean, typecheck 0 errors
6. Manual smoke test of the user-visible flow

No slice merges with any of the above failing. **`superpowers:verification-before-completion`** skill is invoked at slice acceptance to enforce this.

---

## 15. Skills Usage (Claude Code)

### During this design pass (already used)

| Skill | Usage |
|---|---|
| `superpowers:brainstorming` | Drove the entire design discussion: clarifying questions, alternatives proposal, section-by-section approval, spec authoring. This document is the artifact. |
| Visual companion (under brainstorming skill) | Pushed mockups for org chart team overlay (3 variants), Agents tab redesign, Create form, Import preview, Coordination tab. Each iteration locked in user feedback. |
| `Explore` agent (delegated) | Researched team-coordination patterns across United Agents, OpenClaw, Google ADK reference codebases sitting in the repo root. Findings drove Decisions T-5, T-6, and T-11. |

### During implementation (planned)

| Skill | When | Why |
|---|---|---|
| `superpowers:writing-plans` | After this spec is approved | Turns this spec into a session-by-session implementation plan (similar shape to existing `v1_plan.md` / `v2_plan.md`) |
| `superpowers:using-git-worktrees` | Start of each major slice | Isolates slice work from the live `Porting1.1` branch |
| `superpowers:test-driven-development` | Each slice, before implementation code | Tests written first per §14; acceptance gate per slice |
| `superpowers:executing-plans` | When the plan is ready to ship | Step-by-step execution with review checkpoints between sub-tasks |
| `design-guide` (Paperclip UI design system) | UI slices (§13 slices 2, 3, 5, 8) | Source of truth for design tokens, typography, component patterns. **Use alongside** `frontend-design` for visual quality |
| `superpowers:verification-before-completion` | End of each slice | Run typecheck + tests + manual smoke before claiming a slice is done |
| `superpowers:requesting-code-review` | Before merging each slice | Independent review of slice work against this spec |
| `superpowers:dispatching-parallel-agents` | Slices with independent sub-tasks (e.g., schema + UI scaffold + tests can be parallelized) | Run independent work concurrently |

### NOT to be used (out of scope or wrong fit)

- `superpowers:debug` — only invoked when bugs surface during implementation, not part of the design or planned execution
- `superpowers:incident-response` — irrelevant; this is feature work, not an outage
- `engineering:architecture` (ADR creation) — this spec already serves as the architecture record; new ADRs only if a major decision changes mid-implementation

---

## 16. Cross-references

- [`packages/db/src/schema/agents.ts`](../../../packages/db/src/schema/agents.ts) — existing agents table (reportsTo, parentType/parentId polymorphic)
- [`packages/db/src/schema/agent_projects.ts`](../../../packages/db/src/schema/agent_projects.ts) — agent ↔ department M2M (the "department membership" layer)
- [`packages/db/src/schema/company_skills.ts`](../../../packages/db/src/schema/company_skills.ts) — pattern that team_coordinations mirrors
- [`packages/db/src/schema/user_roles.ts`](../../../packages/db/src/schema/user_roles.ts) — humans-by-department, role enum (`founder`/`team_lead`/`team_member`)
- [`packages/db/src/schema/notifications.ts`](../../../packages/db/src/schema/notifications.ts) — Inbox surface for `@human` mentions
- [`server/src/services/issues.ts`](../../../server/src/services/issues.ts) — `findMentionedAgents` lives at line 1418; `findMentionedHumans` will be added alongside
- [`ui/src/pages/OrgChart.tsx`](../../../ui/src/pages/OrgChart.tsx) — pan/zoom canvas + computed tree layout; gains overlay render pass
- [`ui/src/components/team/AgentsTab.tsx`](../../../ui/src/components/team/AgentsTab.tsx) — gains Teams section above Individual agents
- [`docs/aoa/reference/decisions.md`](../reference/decisions.md) — locked architectural decisions; teams decisions T-1 through T-12 above will be appended after spec sign-off
