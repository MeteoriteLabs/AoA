# Inbox Hub Integration Roadmap

**Status:** Draft for W1b/W1c/W1d planning
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

Not yet planned or built:

- W1b, W1c, W1d
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
- Polling reads from W1a routes:
  - `GET /companies/:companyId/hub-items`
  - `GET /companies/:companyId/hub-items/counts`
  - `PATCH /companies/:companyId/hub-items/:id/state` only for minimal read
    state if needed.
- Viewer composition through existing surfaces instead of rebuilt detail UIs.
- Approvals reachable from sidebar and in-hub.
- Home overview with Autopilot display/control shell only.
- Deep-link basics for lanes and item selection.

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
- Approvals are reachable in one click and open in the hub viewer or their
  canonical detail route.
- Empty/loading/error states are explicit and company-scoped.
- The UI has focused component tests and at least one Playwright flow for lane
  navigation and item selection.

### Plan 2 - W1c Lifecycle

Goal: make daily triage reliable and reversible.

Scope:

- Read/unread interaction.
- Snooze controls and return behavior.
- Resolve, dismiss, and archive as distinct flows.
- Undo timer and recovery path for supported actions.
- Bulk selection and bulk action partial-failure semantics.
- History view for resolved/archived items.
- Claim/release and basic ownership affordances for board-pool items if W1a
  source data supports them.
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
- Bulk operations have deterministic success/partial/failure UI.
- Unit, route/client, and e2e tests cover the triage loop.

### Plan 3 - W1d Grouping, Search, Settings, Mobile, Performance

Goal: make the hub usable at agent volume and on smaller screens.

Scope:

- Grouping/categorization UX for high-volume items.
- Hub search across active and history surfaces.
- Settings: default landing lane, lane visibility, Autopilot entry point, and
  link/entry to future notification preferences.
- Mobile layout: rail drawer, list/viewer stack, safe touch targets.
- Keyboard and accessibility hardening.
- Performance: pagination or virtualization, stable counters, no layout shifts.

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
- Bulk action partial failures are represented deterministically.
- Playwright: founder clears a mixed queue and sees undo/history behavior.

### W1d Minimum Tests

- Search filters active/history results without breaking lane state.
- Grouping collapses high-volume items and preserves item access.
- Settings persist default landing and lane visibility.
- Mobile viewport can navigate rail/list/viewer without overlap.
- Keyboard navigation covers lane movement and item selection.
- Playwright: desktop and mobile hub smoke with screenshots/assertions.

### Final PR Verification Commands

Run before claiming the integration PR is ready:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
pnpm -C tests/e2e test inbox-hub.spec.ts
```

If the final e2e is split across multiple specs, run the whole focused set:

```sh
pnpm -C tests/e2e test inbox-hub*.spec.ts
```

Known CI note: Windows e2e is skipped for embedded Postgres; Linux CI remains
the required gate for integration and e2e behavior.

---

## 6. Branch Hygiene

- Keep `feat/inbox-hub` rebased on `origin/main`.
- Commit each implementation task separately.
- Do not mix W2/W3/W4/W5 implementation into the W1 UI integration PR.
- Do not rename DB tables or API routes for UI naming changes.
- Preserve company scoping and RBAC checks in every route or client behavior.
- Keep docs updated when behavior, commands, or phase boundaries change.

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

Write the detailed W1b implementation plan:

`docs/aoa/plans/2026-06-29-w1b-hub-ui-shell-plan.md`

The plan must follow the W1a quality bar: exact file map, TDD steps, focused
commits, unit/component/API/e2e coverage, and final verification commands.
