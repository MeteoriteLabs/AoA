# Commander Cockpit Design

Date: 2026-07-07
Status: Proposed

## Purpose

Commander should become the user's personal command surface for AoA. The current Commander page layout stays: sessions on the left, chat in the center, optional viewer/preview, and the right-side Cockpit. This design evolves the Cockpit from a flat list of cards into a role-scoped, personal-first hybrid cockpit.

The Cockpit does not replace Inbox, Tasks, Discussions, Memory, or the viewer. It pulls the highest-signal items from those surfaces into Commander so a user can triage, ask, open, pin, watch, and act without leaving the command flow.

## Current State

The existing Cockpit already has useful primitives:

- Right-side Cockpit panel with collapsed rail, card visibility menu, and persisted preferences.
- Cards for Pinned, Running now, Review, My tasks, Today, Discussions, Approvals, Goals at risk, Budget pulse, Done today, Proactive findings, Teammates' activity, and Memory.
- Conversation refs section for current Commander output references.
- Viewer support for artifacts, replies, browser tabs, and task detail tabs.
- Pin support for task, artifact, and goal.
- Inbox Hub has mature triage primitives: dismiss, snooze, claim, release, resolve, archive, bulk actions, tabbed viewers, and source-backed mirror rules.
- Commander output refs currently support artifacts only.

Observed gaps:

- Cockpit card groups are flat; the menu shows a long undifferentiated card list.
- My tasks only shows human-assigned tasks; agent work the user is watching is not modeled.
- Discussions only show pending/failed extraction or pending items; active discussions do not surface unless they need review.
- Inbox is not represented as a first-class Cockpit source, except through approval-style queues.
- Personal notes are not a first-class Commander feature.
- Drag/drop into Commander chat is not modeled.
- Commander refs are artifact-only, while the viewer and product need task, discussion, inbox item, approval, goal, agent, note, and memory item references too.

## Product Principles

1. Personal-first, company-aware.
   The first question is "what do I need to do, know, or decide?" The founder still sees company-wide signals because their role scope includes company-wide decisions, budget, review, and escalations.

2. Cockpit is not Inbox.
   Inbox remains the deep triage surface. Cockpit surfaces the subset worth acting on while working with Commander.

3. Identity-preserving chips, not plain text.
   Dragging or inserting a task, discussion, inbox item, note, or artifact into chat should create a structured chip/reference. Text loses permissions, viewer behavior, and source identity.

4. Simple surface, scalable internals.
   Users see clear sections and cards. Internally, every object Commander can reason about should use a shared reference contract.

5. Light customization only.
   Users can show/hide sections, reorder sections/cards, and pin/watch items. Do not build a generic dashboard builder with arbitrary widgets and custom queries in this phase.

6. Source lifecycle stays authoritative.
   Inbox mirrored source-backed items follow Decision #107. Cockpit actions must respect source lifecycle rules and must not create hidden alternate ways to resolve pending source-backed items.

## Cockpit Information Architecture

The right-side Cockpit should be organized into five top-level sections. Existing card visibility preferences continue to exist, but are grouped by section.

### 1. Needs Me

The top priority section. Shows items requiring this user to decide, unblock, review, or acknowledge.

Initial contents:

- Approvals
- Inbox items needing action
- Review
- Pending discussion decisions/items
- Failed or blocked runs/work
- Budget incidents
- Join requests and runtime decisions when role-allowed

Behavior:

- This section should sort by urgency, then age.
- Source-backed Inbox items must mirror their source lifecycle.
- Safe inline actions are allowed: approve, deny, answer, snooze, dismiss, open, ask Commander.
- Complex actions open the viewer or full page.

### 2. My Work

The user's personal operating area.

Initial contents:

- My tasks
- Today/reminders
- Sticky notes
- Watched items and follow-ups

Sticky notes v1:

- Private to the current user and company.
- Simple scratchpad/sticky-note card inside Cockpit.
- Supports create, edit, delete, pin/watch, and insert into chat as a note chip.
- No sharing, task attachment, discussion attachment, or rich collaboration in v1.

### 3. Active With Me

Items involving the user even when they do not require immediate action.

Initial contents:

- Active discussions involving the user, their department, or watched scopes.
- Tasks the user created or watches.
- Agent work the user started or watches.
- Recently touched artifacts.

Behavior:

- This is broader than current "Discussions" filtering.
- It should stay high-signal and capped. The full source pages remain the place for exhaustive lists.

### 4. Company Pulse

Awareness and operating context.

Initial contents:

- Running now
- Goals at risk
- Budget pulse
- Done today
- Teammates' activity

Behavior:

- Founder sees company-wide pulse.
- Team leads see department/project-scoped pulse.
- Team members see only relevant and permitted activity.
- This section is lower priority than Needs Me and My Work.

### 5. Context

Things Commander can use or open while reasoning.

Initial contents:

- Pinned
- Memory
- Current conversation refs
- Recent viewer refs
- Artifacts and memory items explicitly inserted into chat

Behavior:

- Pinned stays visible because it is explicit user intent.
- Conversation refs remain separate from the general Cockpit data fetch when they are tied to the active chat state.

## Universal Commander References

Add a shared Commander reference model. This is the core scalable abstraction.

V1 kinds:

- task
- discussion
- inbox_item
- approval
- artifact
- goal
- agent
- note
- memory_item

Shape:

```ts
type CommanderReferenceKind =
  | "task"
  | "discussion"
  | "inbox_item"
  | "approval"
  | "artifact"
  | "goal"
  | "agent"
  | "note"
  | "memory_item";

interface CommanderReference {
  v: 1;
  kind: CommanderReferenceKind;
  id: string;
  companyId: string;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  route?: string | null;
  viewer?: {
    kind: "task" | "discussion" | "inbox_item" | "approval" | "artifact" | "goal" | "agent" | "note" | "memory_item";
    payload?: Record<string, unknown>;
  };
  actionHints?: string[];
  source?: {
    type: string;
    id: string;
  } | null;
}
```

Rules:

- A reference is a pointer, not a permission grant.
- Server-side actions that consume references must re-check company access and role access.
- Reference labels are display data only; the source entity remains authoritative.
- Artifact `CommanderOutputRef` should either migrate to this reference model or be wrapped by it without losing version fields.

## Drag/Drop And Chip UX

Dropping an item into Commander chat inserts a chip into the input. It does not auto-send.

Supported v1 drag sources:

- Cockpit cards
- Inbox Hub rows/tabs
- Task rows/details
- Discussion rows/details
- Artifact/memory rows where available
- Sticky notes

Input behavior:

- Chips are atomic, keyboard-removable tokens similar to current skill tokens.
- Users can type around chips before pressing Send.
- Pasting a copied internal reference should also create a chip when possible.
- If an object is no longer accessible, the chip shows an unavailable state and cannot be sent as trusted context.

Message behavior:

- Sent messages carry text plus structured refs.
- Commander receives refs as contextual pointers and resolves them server-side.
- The UI renders sent refs under/inside the message and allows opening them in the viewer.

## Viewer Behavior

The existing viewer remains the inspection surface.

V1 viewer support should cover:

- task: `TaskDetail`
- artifact: artifact viewer with version preservation
- discussion: discussion/thread detail or focused discussion viewer
- inbox_item: Hub tab body or embedded Hub item body
- approval: approval detail
- goal: goal detail/summary
- agent: agent detail/summary
- note: editable note viewer
- memory_item: memory item viewer

Viewer rules:

- Clicking a chip opens or activates its viewer tab.
- Opening a Cockpit item should prefer viewer tabs when the user is in Commander and full-page navigation when the item requires a dedicated workflow.
- Tabs dedupe by stable reference identity.
- Viewer state can stay page-lifetime initially, matching current Commander viewer behavior.

## Cockpit Data Model

Current `CockpitData` can evolve in phases.

Phase 1 keeps existing arrays and adds:

- grouped section metadata for display
- sticky notes
- high-signal inbox items
- active-with-me discussions
- watched items

Phase 2 can normalize around references:

```ts
interface CockpitSection {
  id: "needs_me" | "my_work" | "active_with_me" | "company_pulse" | "context";
  title: string;
  items: CommanderReference[];
  cards: CockpitCard[];
}
```

Avoid a big-bang rewrite. Existing card components can be adapted into grouped sections while the reference model grows.

## Permissions And Scoping

Role scoping:

- Founder: company-wide Needs Me and Company Pulse.
- Team lead: department/project-scoped decisions, tasks, discussions, memory approval where allowed.
- Team member: own tasks, own reminders, own notes, permitted discussions, assigned decisions, watched items.

Personal data:

- Sticky notes are user-owned and company-scoped.
- Notes are private by default.
- Future sharing requires explicit action and separate permission checks.

Security:

- Drag/drop and chips never bypass authorization.
- Source-backed Inbox item actions must use existing Hub/source action paths.
- Runtime approvals and governed actions retain their existing approval/trust rules.

## Existing Cards Mapping

Keep:

- Pinned
- Running now
- Review
- My tasks
- Today
- Discussions
- Approvals
- Goals at risk
- Budget pulse
- Done today
- Proactive findings
- Teammates' activity
- Memory

Reorganize:

- Pinned -> Context
- Running now -> Company Pulse
- Review -> Needs Me
- My tasks -> My Work
- Today -> My Work
- Discussions -> Active With Me and Needs Me, depending on item reason
- Approvals -> Needs Me
- Goals at risk -> Company Pulse
- Budget pulse -> Company Pulse
- Done today -> Company Pulse
- Proactive findings -> Needs Me or Company Pulse, depending on severity/source
- Teammates' activity -> Company Pulse
- Memory -> Context

Add:

- Sticky notes -> My Work
- Inbox items -> Needs Me
- Watched items/follow-ups -> My Work or Active With Me
- Recent refs -> Context

## Implementation Phases

### Phase 1: UX grouping without deep model rewrite

- Group existing Cockpit cards under the five sections.
- Keep the existing show/hide card menu, grouped by section.
- Add high-signal Inbox card using existing Hub item APIs and mirror rules.
- Broaden Discussions card to show active-with-me items, while keeping pending decision items in Needs Me.
- Add Sticky notes as a private user/company card.

### Phase 2: Commander references and chips

- Define shared Commander reference types and validators.
- Extend Commander input to support reference chips alongside skill tokens.
- Extend message payloads to carry structured refs.
- Add viewer tab support for reference kinds beyond artifacts.
- Support drag/drop from Cockpit cards into the input.

### Phase 3: Cross-surface drag/drop and watch

- Add drag sources in Inbox, Tasks, Discussions, Memory, Artifacts, Goals, and Agents.
- Add watch/follow behavior separate from pinning.
- Add "Ask Commander" actions from Inbox and entity detail surfaces using references.

### Phase 4: Polishing and enterprise controls

- Add keyboard and accessibility support for chip insertion and drag alternatives.
- Add audit/activity for note actions and governed actions where needed.
- Add empty states, caps, and ranking controls for noisy companies.
- Add per-role defaults and migration-safe preference handling.

## Non-Goals For V1

- Replacing Inbox.
- Building a generic dashboard builder.
- Rich collaborative notes.
- Shared/team notes.
- Custom user-defined queries.
- Full command graph automation.
- Auto-sending dropped chips.
- Letting chips bypass permission checks.

## Recommended Defaults

1. Watch/follow should be separate from pins if backend state is added.
   Pins mean "keep this close." Watch/follow means "surface updates about this." They may render near each other, but the product intent differs.

2. Notes should write activity/audit records for create, update, and delete.
   Notes are private by default, but persisted state still needs accountable mutation paths in an enterprise product.

3. Commander references should not force a big-bang replacement of artifact output refs.
   Introduce the generic model, wrap existing artifact output refs without losing version fields, then migrate persisted message shape in a focused follow-up.

4. Inbox item cards should start with Needs Me/high-signal waiting items plus failures.
   General notifications stay in Inbox so Cockpit does not become noisy.

## Acceptance Criteria

- Existing Commander layout remains recognizable.
- Cockpit sections are grouped as Needs Me, My Work, Active With Me, Company Pulse, and Context.
- Existing Cockpit cards still work after grouping.
- Sticky notes are available as a private Cockpit card.
- High-signal Inbox items appear without violating source mirror rules.
- Drag/drop inserts chips into the input and does not auto-send.
- Chips preserve identity and can open viewer tabs.
- Server-side consumers re-check permissions for every referenced object.
- Inbox, Tasks, Discussions, Memory, and entity detail pages remain authoritative deep-work surfaces.
