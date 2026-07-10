# Commander Cockpit Completion Plan

**Status:** Approved for continuous implementation
**Branch:** `codex/commander-cockpit`
**Supersedes for remaining work:** the interaction and viewer portions of the 2026-07-07 and 2026-07-08 Commander Cockpit plans

## Outcome

Commander remains the daily operating surface for triage, personal work, conversations, company watch signals, and working context. It does not replace Inbox, Tasks, Discussions, Approvals, Artifacts, Goals, Agents, or Memory. Cockpit cards are compact entry points into those systems; Commander chat is the place where users combine those references and act across them.

## Information Architecture

The top-level Cockpit sections are operating modes, not ownership or urgency filters:

1. **Triage**: Inbox, Review, Approvals.
2. **My Work**: My tasks, Today, Sticky notes.
3. **Conversations**: Discussions.
4. **Watch**: Running now, Goals at risk, Budget pulse, Done today, Proactive findings, Teammates' activity.
5. **Memory & Context**: Pinned, Memory.

`Needs me`, `blocked`, `due today`, `owned by me`, `responsible through hierarchy`, and `watching` are item-level badges, filters, and ranking signals. They are not top-level sections because one item can satisfy several of them at once.

Cards remain individually configurable through show/hide and the existing lightweight card preferences. Reorder, pin, and watch may be added where supported by the current model. A free-form dashboard builder is not in scope.

## Interaction Contract

Every referenceable Cockpit row follows one contract:

| Gesture | Result |
|---|---|
| Click row/title | Open the entity inside Commander without changing the Commander route. |
| Click Ask | Add exactly one typed reference chip and seed the suggested prompt. |
| Drag into composer | Add the same typed reference chip as Ask, without duplicate identity. |
| Click external-link action | Open the entity's full feature page. |
| Click composer chip | Open the referenced entity inside Commander. |
| Remove chip | Remove only that reference before sending. |

Reference identity is `(kind, id)`. Adding an existing identity focuses or retains the existing chip rather than appending a duplicate. Chips remain removable in V1. Reordering chips is optional polish after correctness and accessibility are verified.

Draggable rows use a grab cursor, visible keyboard focus, subtle hover highlight, and a small stable translation/elevation. The affordance must not resize the card or obscure row actions.

## Entity Surface Mapping

| Entity | Commander surface | Full-page escape hatch | V1 behavior |
|---|---|---|---|
| Inbox item | Viewer tab with Hub item detail and contextual lifecycle actions | Inbox route | Reuse Hub semantics; do not leave it as a summary-only preview. |
| Task | Existing `TaskSlideOver` | Tasks route | Existing task is editable without consuming a Commander viewer tab; direct creation remains `NewIssueDialog`/Commander tool flow. |
| Discussion | Dedicated closable Commander work pane | Discussions route | Reuse the real thread/scope/branches experience outside Commander viewer tabs; the discussion keeps its own nested-entity viewer. |
| Approval | Viewer tab using embedded `ApprovalDetailCore` | Approvals/Inbox route | Preserve approve/deny and related detail behavior. |
| Artifact | Existing artifact viewer tab | Artifact route where available | Preview the real artifact and keep identity. |
| Goal | Entity-specific viewer when the existing detail can be safely embedded | Goal route | Keep route fallback until a safe body exists. |
| Agent | Entity-specific viewer when the existing detail can be safely embedded | Agent route | Keep route fallback until a safe body exists. |
| Note | Compact personal note viewer/editor | No required full page | Personal by default; sharing is deferred. |

### Discussion composition rule

Do not mount `ThreadDetail` inside `CommanderViewerPanel`. Host it as a dedicated sibling work pane, using its prop-driven embedded mode so thread, scope, branches, and nested entity inspection remain functional without Commander adding another tab bar around it.

### Inbox composition rule

Do not duplicate Hub lifecycle policy in an ad hoc Commander component. Reuse or extract the Hub item action model so resolve/archive, claim/release, dismiss, snooze, unread, and undo obey the same mirror and semantic-type rules as Inbox Hub.

## Delivery Phases

### Phase 0: Branch and migration integrity

- Rebase the isolated worktree onto `origin/main`.
- Preserve the Commander changes and regenerate any colliding Drizzle migration.
- Run focused typechecks/tests before further edits.

### Phase 1: Reference interaction consistency

- Audit every referenceable Cockpit card against the interaction contract.
- Centralize ref identity/deduplication and drag payload behavior.
- Ensure row click never also adds a chip.
- Ensure Ask and drag never navigate.
- Add consistent hover, grab, focus, and external-link affordances.

### Phase 2: Real entity viewers

- Upgrade Inbox from compact preview to Hub-backed detail/actions.
- Keep Task on `TaskSlideOver`, Approval on `ApprovalDetailCore`, and Artifact on the existing viewer registry.
- Preserve note behavior and personal ownership.
- Add graceful loading, missing, forbidden, and stale-reference states.

### Phase 3: Commander-safe Discussions

- Extract the reusable center discussion body or add a narrowly scoped safe mode.
- Preserve thread, scope, branches, extracted/pre-task review, and task creation workflows.
- Route nested entity opens into Commander viewer tabs.
- Prove no nested `ThreadViewer`, mobile tabs, or duplicate tab bars render.

### Phase 4: Browser QA and production checks

- Seed deterministic data covering Inbox, Task, Discussion, Approval, Artifact, Goal, Agent, and Note references where supported.
- Verify desktop and constrained-width Commander layouts.
- Run focused unit/component/integration suites, Commander E2E, full typecheck, full tests, and build.
- Start the isolated app and provide its exact URL for founder review.

## Failure And Rescue Registry

| Failure | User-visible rescue | Verification |
|---|---|---|
| Reference target was deleted | Keep the tab/chip identity and show a clear unavailable state plus close/full-page options. | Component test with 404. |
| User lacks permission | Show an access message; never fall back to leaked summary data. | Company/RBAC integration test. |
| Duplicate add from repeated click/drop | Keep one chip and one viewer tab. | Model, component, and E2E tests. |
| Drag is accidentally interpreted as click | Drop adds a chip; source row does not navigate or open another tab. | Pointer/drop E2E. |
| Inbox action races a live refresh | Optimistic state reconciles with Hub query/event state and exposes undo where Hub supports it. | Mutation integration test. |
| Discussion embeds its page shell | No nested tabs/viewer; only Commander chrome owns the outer tabs. | Component assertion and E2E DOM guard. |
| Hidden/background tab fetches heavily | Only the active detail body performs expensive work. | Component query-enable test. |
| Narrow viewport starves chat | Existing Commander panel arbitration/collapse behavior protects the center composer. | Responsive browser test. |

## Test Map

| Layer | Coverage |
|---|---|
| Unit/model | Ref identity, dedupe, serialization, viewer-tab dedupe, drag payload parsing, section/card placement. |
| Component | Each entity body, loading/error/permission states, chip remove/open, row gesture separation, hover/focus classes. |
| Integration | Hub lifecycle actions in Commander, Task/Approval embedded contracts, discussion nested-open handoff. |
| E2E | Open each supported entity from Cockpit without leaving `/commander`; Ask/drop dedupe; remove chip; no duplicate discussion tabs/viewer; full-page escape hatch. |
| Visual/browser | Desktop and constrained widths, stable card geometry, grab cursor/highlight, viewer/cockpit coexistence. |
| Repository | `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`. |

## Not In Scope

- Replacing Inbox or any domain feature with Commander.
- A free-form dashboard/card builder.
- Shared or collaborative notes.
- Persisting structured message refs server-side in this UI slice; current serialized reference context remains until the backend contract is designed.
- Rebuilding Goal and Agent detail pages solely to satisfy this wave.
- Changing company visibility, RBAC, or action permissions through references.

## Decision Audit Trail

| # | Decision | Classification | Rationale | Rejected |
|---|---|---|---|---|
| 1 | Use operating-mode sections with item-level urgency/ownership signals. | Product/UX | Categories remain understandable when responsibility and urgency overlap. | `Needs me` as a top-level bucket. |
| 2 | Keep cards as compact display units inside sections. | Product/UX | Preserves the useful existing Cockpit model and lightweight customization. | Replacing cards with one mixed feed. |
| 3 | Separate row-open, Ask, drag, and external navigation gestures. | Interaction | Prevents duplicate chips and makes outcomes predictable. | One click performing both open and attach. |
| 4 | Reuse real domain detail/action bodies. | Architecture | Keeps behavior and authorization aligned with source features. | Decorative summary-only viewers. |
| 5 | Build a Commander-safe discussion body. | Architecture | Full `ThreadDetail` owns nested tabs/viewer and cannot be embedded as-is. | Nesting the complete Discussions page. |
| 6 | Keep notes personal in V1. | Scope | Delivers the scratchpad need without introducing sharing permissions. | Shared notes in this wave. |
| 7 | Treat `(kind, id)` as ref identity. | Correctness | Dedupe remains deterministic across click, Ask, and drag. | Label- or prompt-based dedupe. |
| 8 | Require unit, integration, E2E, and live browser verification. | Quality | The highest risks cross component and navigation boundaries. | Unit-only acceptance. |

## Review Verdict

The plan is implementation-ready. The highest-risk work is the Discussion extraction/safe-mode boundary, followed by Inbox action reuse. Task, Approval, Artifact, Note, chips, and drag behavior are bounded extensions of existing patterns. Implementation should proceed in the phase order above so interaction correctness is stable before the richer bodies are composed.
