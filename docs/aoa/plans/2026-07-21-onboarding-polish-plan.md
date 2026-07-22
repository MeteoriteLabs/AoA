# Onboarding Polish — Three Fixes Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — task-by-task, TDD, two-stage review (spec then quality). Steps use `- [ ]`.

**Goal:** Three approved fixes to the onboarding flow — (1) the "first job" step becomes task-only with a polished card (discussion removed), (2) the braindump "Add a department" floating dropdown becomes inline "+" chips (the current menu renders but is clipped/invisible), and (3) Back navigation extends into the in-flight tail (Back everywhere except back into the Map fork).

**Architecture:** UI-only, `ui/src/onboarding/`. No schema, no server routes, no submit-contract changes. Fixes 1 & 2 are single-component; fix 3 touches the in-flight sequencer chrome (mirrors the spine's existing Back).

**Design source:** approved with the founder — mockup artifact `onboarding-decisions.html` (inline "+" chips; Back everywhere except into the Map) + "task-only, polished simple card" for first-job.

**Tech stack:** React 19 + Tailwind v4, onboarding primitives (`steps/shared.tsx`, `DarkShell`, `Reveal`, `.onboarding-dark`), Vitest + Testing Library.

---

## Task 1 — First-job step: task-only, polished

**Files:** `ui/src/onboarding/inflight/FirstJobStep.tsx`; test `ui/src/onboarding/inflight/__tests__/FirstJobStep.test.tsx` (create/extend).

Today `FirstJobStep` renders a 2-column grid: a "Create a task" card AND a "Start a discussion" card (`discussionsApi.create`), plus "Skip to Home". Remove the discussion path entirely; keep a single, centered, polished task card.

- [ ] **Failing test:** render `FirstJobStep`; assert the "Start a discussion" card is **absent** (`queryByText(/start a discussion/i)` is null, no discussion input); the task card is present (title input + assignee select + "Create task"); "Skip to Home" still present; creating a task calls `issuesApi.create` with `{title, status:"todo", assigneeAgentId?}` and fires `onDone` once. (Mock `agentsApi.list`, `issuesApi.create`; assert `discussionsApi.create` is NOT called.)
- [ ] **Run → fail.**
- [ ] **Implement:** delete the discussion card JSX + `discussionTitle`/`discussionStatus`/`discussionError` state + `handleStartDiscussion` + the `discussionsApi` import. Change the grid to a single centered card (e.g. `mx-auto max-w-md`, drop `sm:grid-cols-2`). Keep the task card behavior (title + assignee + create, `fireOnDoneOnce`) and "Skip to Home". Polish to match the redesign: use `StepCard`/`FIELD`/`LABEL` tokens already imported; tighten spacing; keep the `GradientText` heading but update the subtitle to task-only copy ("Give your agent its first task — or skip straight to Home."). No new deps.
- [ ] **Run → pass** + `cd ui && npx tsc --noEmit -p tsconfig.json`. Update any existing FirstJobStep test that asserted the discussion card. **Commit** `feat(onboarding): first-job is task-only (remove discussion) + polished card`.

---

## Task 2 — Braindump "Add a department": inline "+" chips

**Files:** `ui/src/onboarding/inflight/BraindumpStep.tsx`; extend `__tests__/BraindumpStep.test.tsx`.

Today (`BraindumpStep.tsx` ~387-412) "Add a department" toggles `addMenuOpen` and renders an `absolute z-10` `role="menu"` that gets clipped by the centered layout → invisible. Replace with inline clickable "+" chips (one per remaining department), matching the example-prompt chip pattern already in the file.

- [ ] **Failing test:** on load with ≥2 mocked departments, assert the remaining departments render as inline chips labeled like "+ <Dept>" (NOT inside a `role="menu"`); clicking "+ Software" appends that department's card (its textarea appears) and the "+ Software" chip disappears from the remaining list; there is NO `role="menu"` element. (Adapt to the existing test harness / mock setup.)
- [ ] **Run → fail.**
- [ ] **Implement:** remove `addMenuOpen` state + the `role="menu"` block + the `Plus`-button-that-toggles. Render `remainingDepartments.map(d => <button className="chip">+ {d.name}</button>)` inline under the cards (reuse the example-prompt chip classes), each calling `addDepartmentBox(d)`. Keep a small `LABEL` ("Add department knowledge") above the chip row. When `remainingDepartments` is empty, render nothing (as today). Keep `addDepartmentBox`, `remainingDepartments`, and all submit behavior unchanged.
- [ ] **Run → pass** + tsc. **Commit** `fix(onboarding): braindump add-department as inline chips (dropdown was clipped/hidden)`.

---

## Task 3 — Back navigation in the in-flight tail

**Files:** `ui/src/onboarding/inflight/InFlightFlow.tsx`; test `__tests__/InFlightFlow.test.tsx` (create/extend). Reference: `ui/src/onboarding/FlowEngine.tsx` chrome (Back on the left + `StepPosition` on the right).

Today the in-flight chrome (added in the counter work) shows only `StepPosition` on the right; there's no Back. Add a Back control that steps to the PREVIOUS in-flight surface, shown only when `index > 0` (the first surface, Departments, has no Back — that would go back into the Map fork, which is one-way). The Map (`FirstRunHome` door) and the spine are unchanged (spine already has Back).

- [ ] **Failing test:** render `InFlightFlow` at surface index 0 (Departments) → no Back button; at index ≥ 1 (e.g. Braindump) → a Back button is present, and clicking it renders the previous surface (Integrations). Assert Back never appears on Departments. (Drive index via the `aoa:inflight-step:<companyId>` localStorage key the sequencer already reads, or by advancing.)
- [ ] **Run → fail.**
- [ ] **Implement:** add `function goBack()` that does `setIndex(i => Math.max(0, i-1))` and writes the new index via the existing `writeStoredStep`. In the chrome wrapper, change `justify-end` to `justify-between` and render, on the left, `{index > 0 ? <BackButton onClick={goBack}/> : <span className="min-w-[64px]"/>}` mirroring FlowEngine's Back (ghost button, `ChevronLeft`, "Back"); keep `StepPosition` on the right. Do NOT add Back at index 0. Do NOT touch `advance()`, the surfaces, `onDone`, or `setFirstRunCompleted`. Going back and forward re-runs an idempotent surface (braindump uses its idempotencyKey) — no new writes to guard.
- [ ] **Run → pass** + tsc. Update any InFlightFlow test affected by the chrome change. **Commit** `feat(onboarding): Back navigation through the in-flight tail (not into the Map fork)`.

---

## Final verification
- [ ] `cd ui && npx tsc --noEmit -p tsconfig.json` clean; `cd ui && npx vitest run src/onboarding` green.
- [ ] Live on memstep (:3120): walk onboarding (or resume) — first-job shows only a task card (no discussion); braindump shows inline "+ <Dept>" chips that add a card on click; Back appears on braindump/first-job (steps back a surface) but NOT on departments, and the Map has no Back. Counter still continuous.
- [ ] Commit the verification marker.

## Out of scope
- The Create-task dialog (`NewIssueDialog`) — already redesigned + verified; unchanged here.
- The Map fork itself / the spine Back (already correct).
- Any change to what the in-flight surfaces write.
