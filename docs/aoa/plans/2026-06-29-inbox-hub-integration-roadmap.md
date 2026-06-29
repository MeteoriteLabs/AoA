# Inbox Hub Integration Roadmap

**Status:** Active integration roadmap; W1b and W1c are implemented in PR #244
**Date:** 2026-06-29
**Type:** Integration roadmap / planning spine
**Design authority:** `docs/aoa/plans/2026-06-26-inbox-hub-master-scope.md`
**Prototype:** `docs/aoa/inbox-hub-prototype.html`

This document keeps the Inbox/Approvals Hub implementation sequenced after W6
and W1a. It does not replace the master scope. It translates that scope into
PR boundaries, plan order, verification gates, and "do not drift" lines so the
integration branch can be tested as one coherent product before it lands.

---

## 1. Current Baseline

Completed foundations:

- **W6 - Org reporting prerequisite:** merged in PR #242. Human-at-top ownership
  resolution is now available for hub ownership.
- **W1a - Hub data core:** merged in PR #243. The unified hub index, RBAC,
  audit, emit/query/action/reconcile service, REST routes, counts, and shared
  hub contracts are on `main`.

Active branch:

- **Branch:** `feat/inbox-hub`
- **Purpose:** integrate W1b, W1c, W1d, and the final Inbox cutover into one
  user-facing "Inbox Hub UI" PR.
- **Rule:** keep this branch rebased onto `main` whenever foundation PRs land.

Implemented in the active branch / PR #244:

- **W1b - Hub UI shell:** three-pane Inbox Hub shell, rail lanes, Home overview,
  registry-backed viewer, Approvals reachability, lane/item deep links, and W1b
  Playwright coverage.
- **W1c - Lifecycle:** read/unread, personal snooze/dismiss and inverse undo,
  shared resolve/archive, board-pool Claim/Release, server audit undo,
  deterministic bulk endpoint and UI controls, history/audit UI, compact bulk
  partial-result banner, and W1c Playwright coverage.

Not yet planned or built:

- W1d
- W2 Layer 2 and Layer 3
- W3 Autopilot
- W4 Steward
- W5 runtime decision routing

---

## 2. PR Strategy

### Active Integration PR

One PR should carry the coherent user-facing hub:

1. **W1b - Hub UI shell**
2. **W1c - Lifecycle**
3. **W1d - Grouping/search/settings/mobile/performance**
4. **Final Inbox cutover and acceptance pass**

This prevents `main` from receiving a half-built attention hub while still
allowing small commits and per-phase review inside the branch.

### Separate Later PRs

These stay outside the UI integration PR:

- **W2 Layer 2:** notifications registry and single emit cleanup
- **W2 Layer 3:** realtime, toast bridge, preferences, anti-spam, digests
- **W3:** Autopilot autonomy and auto-action audit/undo
- **W4:** Steward crew agent and curation worker
- **W5:** runtime decision routing and per-adapter bridges

The roadmap tracks these later workstreams only as dependency boundaries. They
need their own investigation, implementation plans, tests, and PRs.

---

## 3. Plan Order

### Plan 1 - W1b Hub UI Shell

Goal: make the merged hub visible and useful on top of W1a.

Scope:

- Three-pane shell: rail, center lane list/Home overview, right collapsible
  tabbed viewer.
- Lanes: Home, Waiting on you, Notifications, Suggestions, Mail reserved.
- UI registry backed by shared hub semantic types.
- Source coverage/remap inventory for the old `Inbox.tsx` sections:
  approvals, discussions pending review, join requests, scope proposals,
  human-input items, notifications, failed runs, alerts, mentions, run-complete,
  stale work, and spinoff suggestions.
- Emit/backfill wiring for W1 lane sources not covered by W1a. W1a intentionally
  left the headline "Waiting on you" emitters for W1b, so W1b is not UI-only.
  Each remapped source must either emit into `hub_items` or be explicitly
  deferred with a testable reason and no lost user-visible item.
- Polling reads from W1a routes:
  - `GET /companies/:companyId/hub-items`
  - `GET /companies/:companyId/hub-items/counts`
  - `PATCH /companies/:companyId/hub-items/:id/state` only for minimal read
    state if needed.
- Viewer composition through existing surfaces instead of rebuilt detail UIs.
- Approvals reachable from sidebar and in-hub.
- Home overview with Autopilot display/control shell only.
- Deep-link basics for lanes and item selection.
- Baseline page-size/pagination handling for lane lists, plus cheap count usage
  from W1a counts. W1d can add virtualization and advanced high-volume UX, but
  W1b must not render an unbounded polling list.

Out of scope:

- True snooze-return mechanics.
- Undo timers.
- Bulk actions.
- Claim/reassign/escalate lifecycle.
- Realtime delivery.
- Autopilot decisions.
- W5 adapter bridges.

Exit criteria:

- The hub can replace the old flat Inbox in branch-level testing without losing
  the W1b remapped item categories.
- Seeded items for each W1b-remapped semantic type appear in the correct lane
  and open the correct viewer or canonical route.
- Approvals are reachable in one click and open in the hub viewer or their
  canonical detail route.
- Empty/loading/error states are explicit and company-scoped.
- The UI has focused component tests and at least one Playwright flow for lane
  navigation and item selection.
- The UI registry is total over `HUB_SEMANTIC_TYPES`, uses no local-only
  semantic strings, and any new semantic type includes shared-contract tests.

### Plan 2 - W1c Lifecycle

Goal: make daily triage reliable and reversible.

Implementation status: **implemented in PR #244**. Local focused verification
has covered shared contracts, DB schema, server route/service behavior, UI API
clients/hooks, page/component behavior, and targeted W1c Playwright spec authoring.
The local Windows embedded-Postgres e2e config switches to the documented skip
spec when `DATABASE_URL` is unset, so Linux CI remains the required Playwright
gate before marking the PR ready.

Scope:

- Read/unread interaction.
- Snooze controls and return behavior.
- Resolve, dismiss, and archive as distinct flows.
- Undo timer and recovery path for supported actions.
- Bulk selection and bulk action partial-failure semantics.
- History view for resolved/archived items.
- Owner display for every item.
- Authority-gated action states: hide or disable actions the actor cannot take,
  with Route/Escalate affordances instead of dead buttons.
- Claim/Release for board-pool items.
- Reassign, Escalate, and Route UI affordances with required reasons and audit
  expectations. Delegate/out-of-office automation stays later, but W1c must not
  erase the locked ownership model from the master scope.
- Action error recovery for stale version `409`, failed action, and source
  deleted.

Out of scope:

- Full realtime self-clearing.
- Autonomy auto-actions.
- Advanced grouping and search.

Exit criteria:

- Lifecycle actions call W1a action/state routes with `expectedVersion` and
  idempotency keys where required.
- Stale action and permission-denied states are visible and recoverable.
- Owner and authority are visually distinct, and non-authorized users are guided
  to Route/Escalate instead of seeing unusable decision controls.
- Bulk operations have deterministic success/partial/failure UI.
- Unit, route/client, and e2e tests cover the triage loop.

Explicit W1c deferrals:

- Full Route/Reassign/Escalate workflows and OOO/delegation automation remain
  W1d/W2+ work. W1c keeps Claim/Release scoped to board-pool items.
- Maintained counters, search, grouping, mobile hardening, and high-volume
  performance remain W1d.
- Realtime reconciliation, toast bridge, notification preferences, anti-spam,
  and digests remain W2.
- External source-side undo/relay behavior and runtime adapter bridges remain W5.
- Autopilot auto-actions and Steward curation/intelligence remain W3/W4.

### Plan 3 - W1d Grouping, Search, Settings, Mobile, Performance

Goal: make the hub usable at agent volume and on smaller screens.

Scope:

- Grouping/categorization UX for high-volume items.
- Hub search across active and history surfaces.
- Settings: default landing lane, lane visibility, Autopilot entry point, and
  link/entry to future notification preferences.
- Mobile layout: rail drawer, list/viewer stack, safe touch targets.
- Keyboard and accessibility hardening.
- Performance: virtualization, advanced high-volume UX hardening, and no layout
  shifts. Baseline page-size handling and cheap counts are W1b requirements.

Out of scope:

- W2 realtime and notification preferences implementation.
- W3 Autopilot policy engine.
- W4 Steward grouping intelligence.

Exit criteria:

- The hub remains usable with seeded high-volume items.
- Mobile and desktop flows are covered by Playwright screenshots or assertions.
- Keyboard and screen-reader affordances are covered in component tests where
  practical.

### Plan 4 - Final Cutover and Acceptance

Goal: make the integration PR ready to review as one coherent replacement.

Scope:

- Replace or retire the old flat `Inbox.tsx` behavior behind the `/inbox` route.
- Keep canonical deep links for `/approvals/pending`, `/approvals/all`, and
  approval detail pages.
- Ensure sidebar badges and header notification peeks read the intended source
  for the phase.
- Remove dead UI paths only after tests prove the new paths cover them.
- Run final feature acceptance and visual QA.

Exit criteria:

- A founder can complete the full operator flow in the browser:
  1. Open the hub from sidebar.
  2. Review Home.
  3. Navigate Waiting on you, Notifications, and Suggestions.
  4. Open an approval in the viewer.
  5. Open the canonical full approval page.
  6. Return to the hub with selection state intact.
  7. Mark/read or perform lifecycle actions covered by W1c.
  8. Search/group/filter where W1d applies.
  9. Use the hub on a mobile viewport.
- The branch passes full verification commands listed in section 5.
- The PR description includes the phase checklist and test evidence for W1b,
  W1c, W1d, and final cutover.

---

## 4. Later Workstream Queue

### W2 - Notifications System

Layer 2 should lock the persistent notification registry and single emit path
against the shared hub semantic contract. Layer 3 should replace polling with
realtime and add the toast bridge plus preferences.

Dependency boundary: W1 can use polling and W1a routes. W1 must not invent a
second notification store or toast system.

### W3 - Autopilot

Autopilot owns trust-gated auto-handle vs escalate behavior, delegated authority,
auto-action audit, and undo. W1b may show a display/control shell only.

Dependency boundary: W3 depends on W1 lifecycle and audit/action semantics being
stable.

### W4 - Steward

Steward is the dedicated curation agent and deterministic worker for grouping,
triage explanations, and draft assistance. It should not be mixed into the UI
shell work.

Dependency boundary: W4 depends on stable hub item taxonomy, lifecycle, and
Autopilot policy.

### W5 - Runtime Decision Routing

W5 routes org-agent permission prompts and substantive work questions into
Waiting on you and relays answers back to blocked runs.

Dependency boundary: W5 requires a per-adapter feasibility matrix first. Start
with one adapter behind a feature flag. W1a reserves the type; W1b can render a
reserved/empty-state path but does not build bridges.

---

## 5. Verification Strategy

Every implementation plan must include tests before implementation and must name
the exact test files and commands.

### Phase Gates

Each W1 phase must pass these gates before the next phase starts:

- Focused unit/component/API/e2e tests for the phase are green.
- No W2/W3/W4/W5 implementation code has entered the branch.
- The old Inbox equivalence matrix is updated for every source category touched.
- Seeded demo/test data verifies the new lane/viewer behavior.
- `/inbox` remains on the old route until the final cutover plan explicitly
  switches it.
- `git diff --name-only origin/main...HEAD` is reviewed so the branch contains
  only intended roadmap, plan, and implementation files.

### Per-Phase Required Coverage

- **Shared/contracts:** when shared types or validators change, add tests under
  `packages/shared/src/__tests__` or `packages/shared/src/validators/__tests__`.
- **Server:** when routes, services, RBAC, or actions change, add tests under
  `server/src/__tests__`.
- **UI API clients:** when client functions change, add tests under
  `ui/src/api/__tests__`.
- **UI components/pages:** add Vitest/Testing Library coverage under
  `ui/src/__tests__`, `ui/src/pages/__tests__`, or component-local `__tests__`.
- **E2E:** add Playwright specs under `tests/e2e` for every user-visible phase.

### W1b Minimum Tests

- Hub API client builds correct URLs for list/counts/state.
- Lane registry maps every W1a semantic type to one lane and one viewer
  strategy.
- UI registry is total over `HUB_SEMANTIC_TYPES` and rejects unknown local-only
  semantic strings in tests.
- Source-remap tests prove every old Inbox category either emits to a hub lane
  or has an explicit, documented deferral.
- Sidebar exposes Inbox/Hub and Approvals reachability as specified.
- Hub page renders Home, lane list, empty states, loading states, and error
  states.
- Selecting an item opens a right-side viewer tab and preserves list context.
- "Open full" navigates to the canonical source page.
- Playwright: founder opens the hub, switches lanes, opens a seeded item, opens
  full detail, and returns.

### W1c Minimum Tests

- Read/unread, snooze, dismiss, resolve, archive client calls include the right
  route payload.
- Stale `409` action errors show a recovery state.
- Permission-denied actions do not leave dead buttons.
- Owner, authority, Claim/Release, Route, and Escalate states render distinctly.
- Bulk action partial failures are represented deterministically.
- Playwright: founder clears a mixed queue and sees undo/history behavior.

### W1d Minimum Tests

- Search filters active/history results without breaking lane state.
- Grouping collapses high-volume items and preserves item access.
- Settings persist default landing and lane visibility.
- Mobile viewport can navigate rail/list/viewer without overlap.
- Keyboard navigation covers lane movement and item selection.
- Playwright: desktop and mobile hub smoke with screenshots/assertions.

### Final Operator Acceptance Matrix

Create a focused Playwright acceptance spec:

`tests/e2e/inbox-hub-operator.spec.ts`

It must cover:

- Founder, team lead, and team member visibility for seeded hub items.
- Each old Inbox category remapped to its W1 lane or documented as deferred.
- Approval open in hub viewer, approval action where supported, canonical full
  detail open, and return to hub with lane/selection state intact.
- Stale `409` action recovery.
- Permission-denied action state.
- Source-deleted or auto-resolved item state.
- Snooze return, undo/history, and bulk partial failure once W1c lands.
- Mobile lane/list/viewer navigation without overlap.
- Header bell and sidebar badge deep-linking into the hub.

### Final PR Verification Commands

Run before claiming the integration PR is ready:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
pnpm test:e2e -- inbox-hub-operator.spec.ts
```

If the final e2e is split across multiple specs, run the whole focused set:

```sh
pnpm test:e2e -- inbox-hub*.spec.ts
```

Known CI note: Windows e2e is skipped for embedded Postgres; Linux CI remains
the required gate for integration and e2e behavior.

---

## 6. Branch Hygiene

- Keep `feat/inbox-hub` rebased on `origin/main`.
- Before starting W1b and before final PR review, run:
  - `git fetch origin`
  - confirm `origin/main` includes PR #243's W1a merge
  - rebase `feat/inbox-hub` onto `origin/main` if needed
  - inspect `git diff --name-only origin/main...HEAD`
- Commit each implementation task separately.
- Do not mix W2/W3/W4/W5 implementation into the W1 UI integration PR.
- Do not rename DB tables or API routes for UI naming changes.
- Preserve company scoping and RBAC checks in every route or client behavior.
- Keep docs updated when behavior, commands, or phase boundaries change.
- No dependency additions are expected for W1b/W1c/W1d. If a dependency becomes
  necessary, follow the current `AGENTS.md` dependency workflow and commit
  manifest and lockfile changes together when required.

---

## 7. Open Planning Items

These must be resolved inside the relevant implementation plan, not improvised
mid-task:

- W1b: exact route shape for lane and item deep links.
- W1b: tab persistence limit and behavior when switching lanes.
- W1b: which existing source viewers are embedded directly versus summarized
  with "Open full" only.
- W1c: exact undo duration and which actions are undoable.
- W1c: partial-failure semantics for heterogeneous bulk actions.
- W1d: grouping taxonomy and performance threshold for grouping/virtualization.
- W1d: mobile breakpoint behavior for rail, list, and viewer.

---

## 8. Next Step

Write the detailed W1d implementation plan:

`docs/aoa/plans/2026-06-29-w1d-hub-grouping-search-settings-plan.md`

The plan must follow the W1a/W1c quality bar: exact file map, TDD steps, focused
commits, unit/component/API/e2e coverage, mobile/performance checks, and final
verification commands.
