# Unified Team & Org Management Page

**Date:** 2026-03-22
**Status:** Draft
**Branch:** v2

## Problem

The UI overhaul disconnected the agent org chart (`OrgChart.tsx`) from sidebar navigation. The current `/org` route shows only human team member management (`Team.tsx`). Agents and humans are managed in complete isolation — there is no unified view of the organization.

The founder needs a single page to see the full organizational hierarchy (agents + humans), manage agents (CRUD, lifecycle), and manage humans (invites, roles, RBAC) — all from one place.

## Solution

Replace the current `Team.tsx` page at `/org` with a three-tab management console:

1. **Org Tree** (default) — read-only unified hierarchy visualization showing agents and humans in one tree
2. **Agents** — full agent CRUD and lifecycle management
3. **Humans** — team member management (current Team.tsx content)

## Design Decisions

- **D1: Users can only report to other users, never to agents.** Rationale: humans don't "report to" AI agents in an org structure. Agents can report to either agents or users. This keeps the hierarchy intuitive.
- **D2: `company_memberships` table holds human parent data, not `user_roles`.** Rationale: `user_roles` allows multiple rows per user per company (one per department). The parent relationship is per-person-per-company, which maps to `company_memberships` (unique on `companyId, principalType, principalId`).
- **D3: `children` replaces `reports` in the API response.** This is a breaking change to the `GET /org` endpoint. The old `OrgNode` type with `reports` is replaced by `UnifiedOrgNode` with `children`. Frontend code must update accordingly.

## Data Model Changes

### Unified Parent Model

Replace the agent-only `reportsTo` field with a polymorphic parent model that works for both agents and humans.

#### agents table — new columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `parentType` | text | yes | null | `'agent'` or `'user'` |
| `parentId` | text | yes | null | ID of parent agent or user |

#### company_memberships table — new columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `parentType` | text | yes | null | `'user'` (users can only report to users, per D1) |
| `parentId` | text | yes | null | ID of parent user |

**Why `company_memberships` and not `user_roles`:** The `user_roles` table has a unique index on `(companyId, userId, projectId)`, allowing multiple rows per user per company (one per department scope). A parent relationship is per-person-per-company, not per-role-assignment. `company_memberships` has a unique index on `(companyId, principalType, principalId)` — exactly one row per user per company.

#### New indexes

| Table | Index | Columns | Purpose |
|-------|-------|---------|---------|
| `agents` | `agents_company_parent_idx` | `(companyId, parentType, parentId)` | Efficient child lookup for tree building |
| `company_memberships` | `cm_company_parent_idx` | `(companyId, parentType, parentId)` | Efficient child lookup for tree building |

The existing `agents_company_reports_to_idx` on `(companyId, reportsTo)` is kept during migration and dropped when `reportsTo` is removed.

#### Migration Strategy

1. **Add columns** — non-breaking addition of `parentType` and `parentId` to `agents` and `company_memberships`. Add new indexes.
2. **Backfill agents** — for every agent where `reportsTo IS NOT NULL`, set `parentType='agent'`, `parentId=reportsTo`
3. **Backfill humans** — founders get `parentType=null, parentId=null` (roots). Team leads and members can be assigned parents later via UI.
4. **Update service code** — all queries switch from `reportsTo` to `parentType`/`parentId`
5. **Deprecate `reportsTo`** — keep column temporarily for safety, drop in a later migration

#### Constraints

- When `parentType='agent'`, `parentId` must reference a valid non-terminated agent in the same company
- When `parentType='user'`, `parentId` must reference a valid user with an active membership in the same company
- Cycle detection walks the full mixed chain (agent→user→user→stop, agent→agent→user→stop)
- Max chain depth: 50 — enforced with an explicit counter (the current `assertNoCycle` lacks this; must be added)
- An entity can have at most one parent (single-parent tree, not DAG)

#### Cross-Type Orphaning Rules

When deleting/terminating an entity that has children:

- **Agent terminated/deleted:** All children (agents AND users) that have `parentId=thisAgent` get set to `parentType=null, parentId=null` (become roots). This extends the existing behavior in `agents.remove()` which only nullifies agent children.
- **User removed from company:** All agents with `parentType='user', parentId=thisUser` get set to `parentType=null, parentId=null`. All users with `parentType='user', parentId=thisUser` in `company_memberships` get set to `parentType=null, parentId=null`.
- Error messages for orphaning should indicate which entities were affected: "Agent X was unlinked from the org chart because their manager was removed."

### Unified OrgNode Type

```typescript
interface UnifiedOrgNode {
  id: string;
  name: string;
  role: string;          // agent role or user role
  status: string;        // agent status or 'active' for humans
  nodeType: 'agent' | 'user';

  // Agent-specific (null/undefined for users)
  adapterType?: string;
  trustScore?: number;
  icon?: string;

  // User-specific (null/undefined for agents)
  email?: string;
  userRole?: 'founder' | 'team_lead' | 'team_member';
  departmentName?: string;
  avatarUrl?: string;

  // Hierarchy
  children: UnifiedOrgNode[];  // renamed from 'reports' (breaking change, see D3)
}
```

**Note on IDs:** Agent IDs are UUIDs. User IDs (from `authUsers`) are text strings that may not be UUIDs. The `parentId` field and Zod validators must accept `z.string()` (not `z.string().uuid()`).

## API Changes

### Modified Endpoints

#### `GET /companies/:companyId/org`

**Current:** Returns `OrgNode[]` (agents only, uses `reportsTo`). Response shaped by `toLeanOrgNode()` which strips to `{id, name, role, status, reports}`.

**New:** Returns `UnifiedOrgNode[]` — a tree containing both agents and humans. The `toLeanOrgNode()` function is replaced with a new mapper that includes all `UnifiedOrgNode` fields. The tree builder:

1. Fetches all non-terminated agents for the company
2. Fetches all users with active memberships in the company (via `company_memberships` + `user_roles` join for role/department info)
3. Builds a unified tree from `parentType`/`parentId` on both entities
4. Roots = nodes with `parentId IS NULL` (founder + unassigned top-level agents)
5. Returns the forest (multiple roots allowed)

**Visibility rule:** Users who have been invited but have not yet accepted (no `company_memberships` row) do not appear in the org tree.

#### `PATCH /agents/:id`

**Current body:** `{ reportsTo?: string }`

**New body adds:** `{ parentType?: 'agent' | 'user' | null, parentId?: string | null }`

When `parentType` and `parentId` are provided, they replace the `reportsTo` value. Validation:
- If `parentType='agent'`, validate agent exists in same company, not terminated, no cycle
- If `parentType='user'`, validate user has active membership in same company, no cycle
- If both null, agent becomes a root node

Backwards compatibility: if `reportsTo` is sent (old clients), translate to `parentType='agent', parentId=reportsTo`.

#### `PATCH /companies/:companyId/team/users/:userId/role`

**Current body:** `{ role, projectId }`

**New body adds:** `{ parentType?: 'user' | null, parentId?: string | null }`

Validation:
- If `parentType='user'`, validate target user has active membership in same company, no cycle
- Founders can be roots (parentId=null) or report to other founders
- Team leads typically report to a founder

### Cycle Detection Update

`assertNoCycle(entityId, entityType, newParentId, newParentType)`:

1. Start from `newParentId` / `newParentType`
2. Walk up: if parent is agent, look up agent's `parentType`/`parentId`. If parent is user, look up `company_memberships` `parentType`/`parentId`.
3. If at any step we encounter `entityId` of matching `entityType` → cycle detected, throw
4. If we reach a root (null parent) → no cycle
5. **Explicit depth counter: max 50 steps.** The current `assertNoCycle` lacks a depth limit — this must be added. `getChainOfCommand` already has this limit.
6. Error message on cycle: "Cannot set parent: [Entity A] → [Entity B] → ... → [Entity A] would create a circular reporting chain."

### Parent Validation Helper

New function `ensureParent(companyId, parentType, parentId)`:
- If `parentType='agent'`, calls existing `ensureManager()` logic (validate agent exists, same company, not terminated)
- If `parentType='user'`, validates user has active `company_memberships` row in same company
- Replaces `ensureManager()` calls in agent create/update paths

## Zod Schema Updates

### `packages/shared/src/validators/agent.ts`

- `createAgentSchema`: add `parentType: z.enum(['agent', 'user']).nullable().optional()`, `parentId: z.string().nullable().optional()`
- `updateAgentSchema`: same additions
- Keep `reportsTo` for backwards compatibility (translated server-side)
- **Note:** `parentId` uses `z.string()` not `z.string().uuid()` because user IDs may not be UUIDs

### `packages/shared/src/validators/team.ts`

- `updateTeamMemberRoleSchema`: add `parentType: z.enum(['user']).nullable().optional()`, `parentId: z.string().nullable().optional()`

## Config Revision System

The `CONFIG_REVISION_FIELDS` array and `buildConfigSnapshot()` in `agents.ts` currently track `reportsTo`. These must be updated:

- Add `parentType` and `parentId` to `CONFIG_REVISION_FIELDS`
- Update `buildConfigSnapshot()` to include the new fields
- Update `configPatchFromSnapshot()` to restore from snapshots containing the new fields
- Keep `reportsTo` in the revision snapshot during migration period for backwards compatibility

## Additional Service Updates

### `server/src/services/approvals.ts`

The approval flow creates agents with `reportsTo` (line ~75). Must be updated to set `parentType`/`parentId` instead when creating agents from approved hire requests.

### `server/src/services/company-portability.ts`

The export/import flow serializes `reportsTo` as slug references. Must be extended to:
- Export `parentType`/`parentId` alongside `reportsTo`
- On import, resolve parent references (agent slugs → agent IDs, user emails → user IDs)
- Handle mixed parent types in the manifest

### `server/src/routes/access-helpers.ts` / `access.ts`

`resolveJoinRequestAgentManagerId` finds the root CEO agent via `role === "ceo"` and `reportsTo === null`. Must be updated to use `parentId === null` instead.

## UI Design

### Page Structure

```
┌──────────────────────────────────────────────────┐
│  Team                                             │
│  Manage your organization                         │
│                                                   │
│  ┌───────────┐ ┌────────┐ ┌────────┐             │
│  │ Org Tree  │ │ Agents │ │ Humans │             │
│  └───────────┘ └────────┘ └────────┘             │
│  ─────────────────────────────────────────────── │
│                                                   │
│  (Active tab content below)                       │
│                                                   │
└──────────────────────────────────────────────────┘
```

Route: `/org` (unchanged). Sidebar link: "Team" under COMPANY section (unchanged).

### Tab 1: Org Tree (Default)

Reuses the existing `OrgChart.tsx` interactive canvas (pan, zoom, SVG connectors) with modifications:

**Node card design:**
- **Agent nodes:** Blue-tinted left border. Shows: icon + status dot, name, role/title, adapter type label.
- **Human nodes:** Green-tinted left border. Shows: avatar/initials, name, role badge (Founder/Team Lead/Member), department if scoped.
- Card size: 200x100px (existing). Gap: 32px horizontal, 80px vertical (existing).

**Interactions:**
- Pan (drag background), zoom (scroll wheel, +/- buttons, Fit button) — existing behavior
- Click a node → switches to the appropriate tab (Agents or Humans) and scrolls to / highlights that entity
- No drag-and-drop (read-only visualization)

**Empty state:** "Add agents and invite teammates to build your org chart"

**Layout algorithm:** Reuse existing `subtreeWidth()` / `layoutTree()` / `layoutForest()` from OrgChart.tsx. Feed it `UnifiedOrgNode[]` instead of `OrgNode[]`.

### Tab 2: Agents

Full agent management console. Distinct from the operational `/agents` page (which is for heartbeat, task assignment, runs).

**Header:** "Agents" title + `[+ New Agent]` button (founder-only)

**Agent cards** (list layout):

```
┌──────────────────────────────────────────┐
│  Claude Backend              ● active    │
│  Engineer · Adapter: claude_local        │
│  Reports to: CTO Agent                   │
│  Trust: 85% · Budget: $50/mo             │
│                                          │
│  [Edit]  [Pause]  [More ⋮]              │
└──────────────────────────────────────────┘
```

**Card actions:**
- **Edit** → opens modal with all agent fields:
  - Name, role, title, icon
  - Adapter type + adapter config
  - Budget (monthly cents)
  - "Reports to" dropdown — lists ALL agents + ALL humans as options, grouped by type
  - Runtime config, capabilities, permissions
- **Pause/Resume** toggle — immediate action with toast
- **More menu:** Terminate (confirmation dialog), Delete (confirmation dialog, founder-only)

**Create agent modal:** Same fields as edit modal, triggered by `[+ New Agent]` button. Calls `POST /companies/:companyId/agents`.

**RBAC:**
- Create/Delete: founder only
- Edit: founder + users with `agents:create` permission
- Pause/Resume: board members (existing behavior)

### Tab 3: Humans

Current `Team.tsx` content moved into this tab with one addition:

**Existing features (unchanged):**
- Member cards with name, email, role badge, department selector
- Role selector dropdown (founder/team_lead/team_member)
- Department scope selector
- `[Invite Teammate]` button → InviteDialog
- Pending invites section
- RBAC: founder-only for role management and invites

**New feature:**
- **"Reports to" dropdown** on each member card — shows other humans in the company
- Founder can assign who each team lead/member reports to
- Founders can be roots or report to other founders

## What Gets Reused vs Built New

| Component | Action | Notes |
|-----------|--------|-------|
| `OrgChart.tsx` layout engine | Reuse + adapt | Feed UnifiedOrgNode, add node type styling |
| `Team.tsx` member cards | Reuse | Move into Humans tab, add "Reports to" dropdown |
| `InviteDialog.tsx` | Reuse | No changes needed |
| `useTeamAccess.ts` hook | Reuse | No changes needed |
| `agentsApi` (CRUD calls) | Reuse | Already has create/update/pause/resume/terminate/delete |
| `teamApi` | Extend | Add parentType/parentId to updateRole |
| `orgForCompany()` service | Rewrite | Unified tree builder for agents + humans |
| `assertNoCycle()` | Rewrite | Handle mixed agent/user chains + add depth limit |
| `getChainOfCommand()` | Extend | Walk mixed chains |
| `ensureManager()` | Replace | New `ensureParent()` handles both types |
| `toLeanOrgNode()` | Replace | New mapper for UnifiedOrgNode with all fields |
| Agent create/update validation | Extend | Accept parentType/parentId, validate cross-type refs |
| Config revision system | Extend | Track parentType/parentId in snapshots |
| Tab container component | New | Three-tab layout wrapping the views |
| Agent management cards + modals | New | CRUD UI for agents on team page |
| DB migration | New | Add columns to agents + company_memberships, backfill |

## Files Affected

### Schema
- `packages/db/src/schema/agents.ts` — add `parentType`, `parentId` columns + new index
- `packages/db/src/schema/company_memberships.ts` — add `parentType`, `parentId` columns + new index

### Validators
- `packages/shared/src/validators/agent.ts` — add `parentType`, `parentId` to create/update schemas
- `packages/shared/src/validators/team.ts` — add `parentType`, `parentId` to role update schema

### Services
- `server/src/services/agents.ts` — update `orgForCompany`, `assertNoCycle`, `getChainOfCommand`, `ensureManager`→`ensureParent`, `create`, `update`, `remove` (cross-type orphaning), config revision fields
- `server/src/services/team.ts` — update `updateUserRole` to accept and persist parent fields via `company_memberships`
- `server/src/services/approvals.ts` — update agent creation to use `parentType`/`parentId`
- `server/src/services/company-portability.ts` — update export/import for polymorphic parent model

### Routes
- `server/src/routes/agents.ts` — update PATCH validation, update GET /org response shape, replace `toLeanOrgNode`
- `server/src/routes/team.ts` — update PATCH validation for parent fields
- `server/src/routes/access-helpers.ts` — update `resolveJoinRequestAgentManagerId` to use `parentId`
- `server/src/routes/access.ts` — same join-request manager resolution update

### Shared Types
- `packages/shared/src/types/agent.ts` — add `parentType`, `parentId` to Agent type
- `packages/shared/src/types/team.ts` — add `UnifiedOrgNode` type

### UI
- `ui/src/pages/Team.tsx` — rewrite as tabbed container
- `ui/src/pages/OrgChart.tsx` — adapt for unified nodes (both agent + human cards)
- New: agent management components (cards, create modal, edit modal)
- `ui/src/api/agents.ts` — update org() return type (`OrgNode` → `UnifiedOrgNode`)
- `ui/src/api/team.ts` — update updateRole params

### Tests
- New migration test (backfill verification)
- Update `orgForCompany` tests for unified tree
- Update cycle detection tests for mixed chains (agent→user→agent)
- Update `invite-join-manager` tests for new parent model
- UI component tests for new tabs

## Out of Scope

- Drag-and-drop tree reorganization (future enhancement)
- Agent operational views (heartbeat, task assignment, runs) — stays on `/agents` page
- Changes to the Agents list page (`/agents`)
- V3 autonomy tiers, pipeline templates, blueprints
- Department-agent auto-assignment (agents are explicitly assigned parents)
