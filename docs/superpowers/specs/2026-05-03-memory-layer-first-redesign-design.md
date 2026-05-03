# Memory Page Redesign — Layer-First Tree (Phase 6.2) Design Spec

**Status:** Designed 2026-05-03. Awaiting user review.
**Predecessor:** Phase 6 memory redesign (folder-first explorer, shipped through 6.1e on `memory` branch as of `33dbef5`).
**Successors:** Phase 6.2a / 6.2b / 6.2c implementation plans (to be written from this spec).

---

## 1. Problem statement

The memory explorer shipped in Phase 6 (folder-first) hides the V2 architecture from the founder. The 4 memory layers (`identity` / `domain` / `active_context` / `working`) have radically different lifecycles:

- **Identity:** permanent, always in agent context.
- **Domain:** semi-permanent, department-scoped.
- **Active Context:** temporary, goal-scoped, has `expiresAt`.
- **Working:** ephemeral, task-scoped, auto-archives at 7 days.

In the current explorer, layer is invisible. The founder cannot tell why one item sticks around forever and another disappears next week. The seeded subfolders (Decisions / Policies / References / Files) replicate the `category` field as folders, padding the tree without adding information. Pinned and Pending Review virtual folders ship but have no equivalent for cross-cutting flows like "what changed lately?" or "where are my archived items?".

Three secondary gaps:
- The MemoryHome page tiles by department but the explorer (and the architecture) is layer-shaped — split-brain mental model.
- User-created folders exist in the schema (`memory_folders`, `seedKey`) but have no UI affordance.
- Active goals are first-class entities elsewhere in the app, but in Memory they're invisible — a founder can't see what context is loaded for goal X.

## 2. Goals + non-goals

**Goals:**
- Make layer the primary navigation hierarchy.
- Show goal-level context first-class (under Active Context).
- Add user-created folders with deletion protection and unlimited nesting depth.
- Surface common cross-cutting flows (Pinned / Pending / Recent / Archived) as tree shortcuts.
- Replace dept tiles on MemoryHome with layer tiles.
- Reserve a pane in the Home view for a future graph visualization.

**Non-goals (v1 of layer-first):**
- Drag-and-drop reorganization. Kebab actions only.
- Bulk item movement. Single-item only.
- User-extensible layers. The 4 layers are system-defined.
- Goal-hierarchy nesting (vision → mission → goal) inside Active Context. Flat list of active goals only.
- Per-task tree nodes inside Working. Working stays a flat item list.
- Mobile / narrow-viewport adaptation. Desktop first.
- Layer-aware search ranking. Search treats layers equally.
- Implementing the Home graph viz. Reserved slot only.

## 3. Tree structure

```
🏠 Home                          → Center: home dashboard. Right: graph slot.
📌 Pinned                        → Items with founderPinnedToTop = true
📋 Pending Review (count)        → Items with status = 'pending', amber chip if >0
🕒 Recent                        → Last 14 days, sorted by updatedAt
📦 Archived                      → status = 'archived'
─────────────────────────────────
🪪 Identity                      [expanded by default]
  🏛️ Company
    📂 (user folders, unlimited nesting)
🏢 Domain                        [expanded by default]
  📁 Engineering (count)
    📂 Q3 Planning (user)
      📂 OKR Drafts (user)
    📂 API Migration (user)
  📁 Marketing (count)
🎯 Active Context (count)        [collapsed by default]
  🎯 Goal: Ship in EU (count)    ← every goal with status='active', even 0-item
    📂 (user folders allowed)
  🎯 Goal: Q3 OKRs (count)
⚡ Working (count)                [collapsed by default; FLAT — no task subtree]
```

**Rules:**
- Empty scopes always show with `(0)` count badge — predictable structure trumps cleanliness.
- User folders: unlimited nesting depth. Default collapsed. Soft-warn (tooltip only) at depth > 6 levels.
- User folders cannot be created at: layer-root level, scope-root level, or anywhere under `Working`.
- Pinned / Pending / Recent / Archived = virtual filters computed at query time. No DB rows.
- Selecting an item or folder auto-expands its ancestor chain in the tree.
- When the founder switches to a different scope, the previously-expanded user folders inside the old scope stay expanded (so coming back is fast).

## 4. Layout (4-pane, resizable + collapsible)

```
┌─────────┬───────────┬───────────────┬──────────────────┐
│ AoA     │ Memory    │ Center pane   │ Right pane       │
│ Sidebar │ Tree      │               │                  │
│ (50px)  │ (240px)   │               │                  │
└─────────┴───────────┴───────────────┴──────────────────┘
```

**Pane assignments by tree selection:**

| Tree selection | Center pane | Right pane |
|---|---|---|
| `🏠 Home` | Home dashboard (banner + quick-jump + layer tiles + recents) | Reserved for future graph viz (visible empty slot) |
| Layer / scope / user folder | Items in that scope, grouped by category | Auto-collapsed if no item selected |
| Item URL (`?item=...`) | Items in the parent folder | Item viewer / editor |

**Pane behaviors:**
- All three right-of-sidebar panes are resizable (drag dividers) and collapsible (chevron in pane header).
- Right pane auto-collapses when no item is selected (in non-Home contexts) and slides open when an item is clicked.
- On Home, right pane stays visible with the graph placeholder so the founder remembers it's a future feature.

**Standalone `/memory` route:** kept. Lands on the explorer with `🏠 Home` selected (replaces today's standalone MemoryHome page). No breaking change to AoA sidebar `Memory` link.

## 5. File list — category grouping

When a non-virtual scope (layer / dept / goal / user folder) is selected, the center pane shows items in that scope grouped by `category`, with collapsible sections.

```
DOMAIN / ENGINEERING (12)               [search: search this folder]
─────────────────────────────────────
▼ Decisions (4)
  📄 Auth strategy                      decision · today
  📄 Database choice                    decision · 1w
▼ References (3)
  📄 API standards                      reference · 2d
▶ Policies (2)                          ← collapsed by default if >0 items but layer != Identity
▶ Insights (2)
▶ Procedures (1)
```

**Default expansion of category groups:**
- All categories with items expanded by default for the first 3 (sorted by item count desc).
- Categories beyond the top 3 collapse by default. Founder expands manually.
- This is the sensible default for a long file list. May need tuning via UX feedback.

**User folders inside category groups:** when items in a scope live in a user folder, the folder appears as a sub-group nested inside its category:

```
▼ Decisions (4)
  ▼ 📂 Q3 Planning (2)
    📄 Pricing tier choice
    📄 Hiring freeze
  📄 Untagged decision A
  📄 Untagged decision B
```

Clicking a user folder in the tree drills the file list to that folder's items only (one less click for power flows).

**Item row anatomy:**
- Icon (per category or asset mime)
- Title
- Category badge (colored chip)
- `expiresAt` chip (active_context only — see §7)
- Modified-relative timestamp (today / 2d / 1w / 3mo / 1y)

**Search:** existing per-Phase 6.1d behavior. Filter input above the file list, debounced, scoped to the current selection.

## 6. MemoryHome dashboard (center pane when Home selected)

Replaces today's standalone MemoryHome page. Same content, embedded in the explorer's center pane:

- **Pending banner** — self-hides at 0; amber when > 0.
- **Quick-jump button** — opens `MemoryQuickSwitcher` (existing component).
- **Layer tiles** — grid of 4: Identity / Domain / Active Context / Working. Each tile shows item count + pending count. Click → `/memory/explore?layer=<layer>` opens that layer expanded + selected.
- **Recents strip** — last 10 items by updatedAt, same as today.

Drops:
- Department tiles. Founders who want by-dept browse the tree (`Domain → <Dept>`) — one extra click, one consistent mental model.

The right pane on Home is a visible-but-empty placeholder reading "Memory graph view — coming soon." Reserved space, no auto-collapse.

## 7. Active Context items: `expiresAt` visualization

Active context items have an `expiresAt: Date | null`. When set, a chip on the right of the file-list row shows a countdown:

| Days remaining | Chip color | Text |
|---|---|---|
| > 7 days | muted gray | "expires Jun 14" |
| ≤ 7 days | amber | "expires in 5d" |
| ≤ 1 day | red | "expires today" |
| < 0 (already past) | n/a | item has been auto-archived; only visible from `📦 Archived` shortcut |

**Auto-archive trigger:** existing memory lifecycle service (`server/src/services/memory-lifecycle.ts` or similar) already runs periodic `expiresAt < now()` archival. No change needed here.

## 8. User-folder CRUD + MCP scoping

**Creation:**
- Tree node hover-kebab and right-click both expose `+ New folder` action.
- Allowed parents: any scope under Identity / Domain / Active Context (and any user folder beneath those).
- Disallowed parents: Working layer (and anything under it), layer-root nodes, scope-root nodes.
- Founder picks display name + optional emoji icon (defaults to 📂).
- New folder writes a `memory_folders` row with `seedKey: NULL`, `path: "<parent.path>/<slug>"`, `displayName`, `icon`, `companyId`, `departmentId` (inherited from parent).
- Slug is auto-derived from displayName (lowercase, dashed). Conflict on `(companyId, path)` unique index → reject with "folder name already exists at this level".

**Deletion:**
- Allowed iff `seedKey IS NULL`.
- If folder contains items, founder confirms via dialog: "Move N items to parent folder?" — items are reparented to the folder's parent (their `folderPath` is updated to the parent's path). No orphans.
- If folder contains sub-folders, recursive: dialog wording adjusts to "This folder has 3 sub-folders containing N items. They'll be moved up one level on delete." Reparenting is one-level-up, not flat-to-scope-root, to preserve user organization.

**Rename:**
- `displayName` is editable inline (double-click or kebab → Rename).
- `path` stays stable for MCP idempotency. Rename only updates displayName.
- If the founder genuinely wants to move the folder elsewhere, that's "delete + create new" — no silent path migrations in v1.

**Edit icon:**
- Inline emoji picker on the folder node. Updates `memory_folders.icon`.

**MCP scoping:**
- Existing memory MCP tools accept a `scope` parameter. Today: layer + departmentId.
- Extend the schema to also accept `folderPath`. When provided, filter items where `memory_items.folderPath = '<path>'` OR `memory_items.folderPath LIKE '<path>/%'` (so a path includes its descendants).
- All addressable scopes have the shape: `companyId / layer / scopeId? / folderPath?`. Path is the source of truth.

## 9. Item movement between layers

Founder triggers via kebab → "Change layer". Free movement between any two layers, with a confirmation dialog handling the field mutations:

| From → To | Behavior on save |
|---|---|
| any → Working | Prompt for `taskId`. Item gets 7-day TTL (existing service handles archival). |
| Working → any | `taskId` cleared. No TTL on remaining target. |
| any → Active Context | Prompt for `goalId` + optional `expiresAt`. |
| Active Context → any | `goalId` + `expiresAt` cleared. |
| any → Identity | Confirm "permanent layer — agent context will always include this." |
| any → Domain | Prompt for `departmentId` if not already set. |

**Folder path:** when layer changes, item's `folderPath` is cleared (it was scoped to the old layer's tree). The dialog includes a "new home folder" picker so the founder lands in a deliberate spot.

**Audit trail:** every layer change creates a new `memory_item_versions` row with a `layer changed: <from> → <to>` changelog note. The new layer + cleared/set fields are captured in the version snapshot.

**Bulk movement:** out of scope.

## 10. Schema impact

**No structural migration.** All required columns already exist:
- `memory_folders.seedKey` — deletion protection.
- `memory_items.layer` / `goalId` / `taskId` / `expiresAt` / `folderPath` — already in V2 schema.
- `memory_item_versions` — already wires up audit trail.

**One small index added in Phase 6.2b** for the MCP `folderPath` prefix query — a B-tree index on `memory_items(companyId, folderPath)`. One-line `pgTable` index addition + Drizzle migration.

**Existing data:** items with `folderPath: "engineering/Decisions"` (etc., from seeded subfolders) keep their value. The new tree just doesn't render that path level — items appear in their dept's flat list grouped by category. The seeded `memory_folders` rows remain for historical / MCP-path-resolution purposes; they're simply not surfaced as tree nodes.

If a founder wants to move legacy items into a user folder, the existing kebab → "Move to folder" action handles it (already shipped in Phase 6.1b).

## 11. MCP tool extension shape

Affects: `memory.search`, `memory.list`, `memory.suggest`, and the resource endpoints under `MemoryResource`.

```typescript
// Today (post-Phase-6):
type MemoryScope = {
  layer?: 'identity' | 'domain' | 'active_context' | 'working';
  departmentId?: string;
};

// Phase 6.2:
type MemoryScope = {
  layer?: 'identity' | 'domain' | 'active_context' | 'working';
  departmentId?: string;
  folderPath?: string;          // exact + prefix match: '<path>' or '<path>/%'
  goalId?: string;              // for active_context
  taskId?: string;              // for working
};
```

Filter semantics:
- All provided scope fields are AND-ed.
- `folderPath` is prefix-inclusive (`Engineering/Q3 Planning` includes `Engineering/Q3 Planning/OKR Drafts`).
- Backward compatible: existing callers passing only `layer` + `departmentId` keep working.

## 12. Sidebar entry + routing

- AoA sidebar `🧠 Memory` link → `/<companyPrefix>/memory` (unchanged).
- `/memory` redirects to `/memory/explore` (the standalone MemoryHome at `/memory` is replaced; `MemoryHome.tsx` becomes a panel component, not a page).
- `/memory/explore` is the explorer. With no query params → tree shows with `🏠 Home` selected (default). Center pane = home dashboard, right pane = graph placeholder.
- `/memory/explore?layer=domain` → opens with Domain layer expanded + selected.
- `/memory/explore?folder=<path>&dept=<id>` → opens with that scope selected.
- `/memory/explore?item=<id>&type=memory_item|asset` → opens with that item's parent scope expanded and the item loaded in the right pane.
- `/memory/legacy` (the old filter-list view) → kept as a safety net for one minor version. Removed in 6.3.

## 13. Phased delivery

The redesign is too large for a single slice. Three planned slices, sized like Phase 6.1d:

### Phase 6.2a — Layer tree + Home rebuild
**Goal:** New tree component; home tiles. Read-only redesign — no folder mutations, no item movement.
**Touch:** `MemoryTreeV2`, `LayerTilesPanel`, route swap to embed home in explorer, file-list category grouping, empty states, `expiresAt` chip.
**Tasks:** 5–6, similar shape to 6.1d (1000-line plan).

### Phase 6.2b — User folder CRUD + MCP scoping
**Goal:** Full create / rename / delete for user folders. MCP `folderPath` parameter.
**Touch:** `CreateUserFolderDialog`, kebab menu extensions on tree nodes, `memoryFoldersService.deleteUserFolder`, MCP scope schema update + tool routing.
**Tasks:** 4–5.

### Phase 6.2c — Item movement + polish
**Goal:** ChangeLayerDialog. Audit trail wiring. Soft-warn for deep nesting. Final polish pass.
**Touch:** `ChangeLayerDialog`, `memory.changeLayer` service, version-row writes, kebab additions.
**Tasks:** 3–4.

Each slice ships independently and is mergeable. No slice depends on a later slice's UI being shipped.

## 14. Risks + open questions

- **Default category-group expansion** (top-3 by count) is a guess. Will need usage observation; may switch to "all expanded" or "remember per-scope expansion state".
- **Working layer flat list** with no task subtree may be confusing if a single task chain has many items. Punt: revisit if user feedback complains.
- **Goal hierarchy** flat list ignores vision/mission. If founders want to filter "items related to Mission X", they'll need that as a separate filter — out of scope for now.
- **MCP `folderPath` performance** — prefix matching on a `text` column is a sequential scan unless we add a B-tree index. Index addition is a 1-line schema bump in 6.2b.
- **Migration of legacy `engineering/Decisions` folder paths** — left as-is. Founders can re-organize manually. Do not auto-migrate (risk of breaking existing item ↔ folder associations they relied on).

## 15. Appendix — visual reference

ASCII layout of the explorer with Home selected:

```
┌────┬──────────────┬────────────────────────────┬────────────────┐
│ A  │ FOLDERS      │  ⚠️  3 items waiting       │ Memory graph   │
│ o  │              │     for your review        │ — coming soon  │
│ A  │ 🏠 Home  ◀   │                            │                │
│    │ 📌 Pinned    │  [🔍 Search across …]      │  [empty slot]  │
│ S  │ 📋 Pending(2)│                            │                │
│ i  │ 🕒 Recent    │  ── LAYERS ──              │                │
│ d  │ 📦 Archived  │  ┌──────────┬──────────┐   │                │
│ e  │ ─── ─        │  │🪪 Identity│🏢 Domain │   │                │
│ b  │ 🪪 Identity  │  │ 3        │ 47       │   │                │
│ a  │   🏛️Company  │  │           │ 2 pend  │   │                │
│ r  │ 🏢 Domain    │  └──────────┴──────────┘   │                │
│    │   📁Eng (12) │  ┌──────────┬──────────┐   │                │
│    │   📁Mkt (3)  │  │🎯 Active  │⚡ Working │   │                │
│    │ 🎯 Active(2)▶│  │ 9 (3 exp)│ 5 (7d ttl)│   │                │
│    │ ⚡ Working ▶ │  └──────────┴──────────┘   │                │
│    │              │                            │                │
│    │              │  ── RECENT ──              │                │
│    │              │  📄 Auth strategy   today  │                │
│    │              │  📄 Brand voice    yesterd.│                │
│    │              │  📄 ...                    │                │
└────┴──────────────┴────────────────────────────┴────────────────┘
```

ASCII layout with `Domain → Engineering → Q3 Planning` selected:

```
┌────┬──────────────┬────────────────────────────┬────────────────┐
│ A  │ FOLDERS      │ DOMAIN/ENG/Q3 PLANNING (5) │ Item viewer    │
│ o  │              │                            │ (auto-collapsed│
│ A  │ 🏠 Home      │ [🔍 search this folder]    │  when no item) │
│    │ 📌 Pinned    │                            │                │
│ S  │ 📋 Pending(2)│ ▼ Decisions (3)            │                │
│ i  │ 🕒 Recent    │   📄 Pricing tier   today  │                │
│ d  │ 📦 Archived  │   📄 Hiring freeze  3d     │                │
│ e  │ ───          │ ▼ References (1)           │                │
│ b  │ 🪪 Identity  │   📄 EU compliance  1w     │                │
│ a  │   🏛️Company  │ ▶ Policies (1)             │                │
│ r  │ 🏢 Domain    │                            │                │
│    │   📁Eng (12) │                            │                │
│    │     📂Q3 ◀   │                            │                │
│    │       📂OKR  │                            │                │
│    │     📂API M. │                            │                │
│    │   📁Mkt      │                            │                │
│    │ 🎯 Active(2)▶│                            │                │
│    │ ⚡ Working ▶ │                            │                │
└────┴──────────────┴────────────────────────────┴────────────────┘
```

---

**End of design spec.**
