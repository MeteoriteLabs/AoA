# Human Roles Authority Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Roles` tab to the human detail page that separates company authority, reporting structure, explicit grants, and role/department editing from the profile and general settings surfaces.

**Architecture:** Reuse the existing team contracts and role update API. This scope does not add schema, migrations, or new backend routes because `TeamMemberSummary` already exposes role, department, reports-to, system-admin state, and explicit permission grants, while `MemberDependencies` already exposes reports and agent ownership counts. The UI change should promote the existing Authority card and Role & Department editor into a new `Roles` tab, leaving `Settings` for operational danger/admin notices.

**Tech Stack:** React + Vite UI, TanStack Query, existing `teamApi`, Vitest + Testing Library, Playwright E2E.

---

## Investigation Summary

- `ui/src/pages/HumanDetail.tsx` currently has two tabs: `Overview` and `Settings`.
- The `Overview` tab already renders an `Authority` card with role, department, reports-to, access, and explicit permission badges.
- The `Settings` tab already renders the editable `Role & Department` form using `teamApi.updateRole`.
- `server/src/services/team.ts` already enforces founder-only role management, protects last-founder demotion, validates user-only reporting, prevents hierarchy cycles, updates `companyMemberships.parentId`, rewrites `userRoles`, and refreshes role-derived grants.
- `packages/shared/src/types/team.ts` already contains all data needed for a read-only authority dashboard.
- `packages/shared/src/validators/team.ts` already validates role update input.
- No backend or database change is required for Scope 1.

## Product Shape

The human page will have three tabs:

- `Overview`: work dashboard only: metrics, assigned/created/responsible-agent tasks, activity, reports, and agents.
- `Roles`: authority and responsibility: company role, department, reports-to, system/admin state, explicit grants, direct reports, agent responsibility, and editable role controls for founders.
- `Settings`: operational controls only: remove member and read-only notices. No profile form and no role editor.

The key product distinction stays explicit:

- `Title` is profile metadata, edited from the profile modal.
- `Role` is company authority, edited from the Roles tab.
- `Explicit grants` are shown as authority evidence but not deeply editable in this scope.

## Files

- Modify: `ui/src/pages/HumanDetail.tsx`
  - Add `Roles` to `TAB_ITEMS`.
  - Move the existing `Authority` section from Overview to Roles.
  - Move the existing `Role & Department` editor from Settings to Roles.
  - Add compact responsibility context in Roles using `deps.teamMembers`, `deps.agentTrees`, `member.permissions`, and current manager.
  - Keep Settings focused on danger/removal and non-admin notice.
- Modify: `ui/src/__tests__/HumanDetail.test.tsx`
  - Add unit coverage for Roles tab rendering and saving role controls.
  - Update Settings expectations so role controls are absent from Settings.
- Modify: `tests/e2e/human-profile.spec.ts`
  - Update navigation assertions to visit `/team/:userId/roles`.
  - Assert role/department/reporting authority renders there.
  - Assert Settings no longer owns `Role & Department`.

## Task 1: Unit Test The New Roles Tab Contract

**Files:**
- Modify: `ui/src/__tests__/HumanDetail.test.tsx`

- [ ] **Step 1: Write the failing Roles tab rendering test**

Add a test near the current Settings test:

```tsx
it("renders authority and editable role controls in the roles tab", async () => {
  const user = userEvent.setup();
  renderHumanDetail("/team/user-1/roles");

  expect(await screen.findByText("Authority")).toBeInTheDocument();
  expect(screen.getByText("Role & Department")).toBeInTheDocument();
  expect(screen.getByText("Team Lead")).toBeInTheDocument();
  expect(screen.getByText("Product")).toBeInTheDocument();
  expect(screen.getByText("Grace Founder")).toBeInTheDocument();
  expect(screen.getByText("tasks.assign")).toBeInTheDocument();
  expect(screen.getByText("Reports")).toBeInTheDocument();
  expect(screen.getByText("Agents")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Role"), "team_member");
  await user.selectOptions(screen.getByLabelText("Department"), "none");
  await user.selectOptions(screen.getByLabelText("Reports to"), "founder-1");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(teamApi.updateRole).toHaveBeenCalledWith("company-1", "user-1", {
      role: "team_member",
      projectId: null,
      parentType: "user",
      parentId: "founder-1",
    });
  });
});
```

- [ ] **Step 2: Update the Settings test to fail until the editor moves**

Change the existing Settings test to:

```tsx
it("keeps settings focused on operational controls", async () => {
  renderHumanDetail("/team/user-1/settings");

  expect(await screen.findByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  expect(screen.queryByText("Role & Department")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Profile" })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run:

```bash
pnpm exec vitest run ui/src/__tests__/HumanDetail.test.tsx
```

Expected: FAIL because `/roles` is not a valid tab and the editor still exists in Settings.

## Task 2: Add The Roles Tab And Move Authority UI

**Files:**
- Modify: `ui/src/pages/HumanDetail.tsx`

- [ ] **Step 1: Add the tab item**

Change:

```tsx
const TAB_ITEMS = [
  { value: "overview", label: "Overview" },
  { value: "settings", label: "Settings" },
];
```

to:

```tsx
const TAB_ITEMS = [
  { value: "overview", label: "Overview" },
  { value: "roles", label: "Roles" },
  { value: "settings", label: "Settings" },
];
```

- [ ] **Step 2: Remove the Authority card from Overview**

Delete the existing `Authority` section from the Overview tab. Keep metrics, tasks, activity, team reports, and agent trees in Overview.

- [ ] **Step 3: Add a Roles tab section after Overview and before Settings**

Add:

```tsx
{activeTab === "roles" && deps && (
  <div className="space-y-4 mt-4">
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Shield className="h-4 w-4" />
        Authority
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Role</p>
          <p className="mt-1 text-sm">{ROLE_LABELS[member.role]}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Department</p>
          <p className="mt-1 text-sm">{member.departmentName ?? "No department"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Reports to</p>
          <p className="mt-1 text-sm">{manager?.displayName ?? manager?.email ?? "No manager"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Access</p>
          <p className="mt-1 text-sm">{member.isSystemAdmin ? "System admin" : "Company member"}</p>
        </div>
      </div>
      {member.permissions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {member.permissions.slice(0, 6).map((permission) => (
            <Badge key={permission} variant="outline" className="max-w-full truncate text-[10px]">
              {permission}
            </Badge>
          ))}
        </div>
      )}
    </section>

    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">Responsibilities</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Reports</p>
          <p className="mt-1 text-sm">{deps.teamMembers.length}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Agent trees</p>
          <p className="mt-1 text-sm">{deps.agentTrees.length}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Responsible tasks</p>
          <p className="mt-1 text-sm">{deps.assignedTaskCount + (agentTasksQuery.data?.length ?? 0)}</p>
        </div>
      </div>
    </section>

    {/* Move the existing Role & Department editor here unchanged. */}
  </div>
)}
```

- [ ] **Step 4: Move the existing Role & Department editor into Roles**

Move the existing `Role & Department` card from Settings into the Roles tab after `Responsibilities`. Do not change its mutation logic in this task.

- [ ] **Step 5: Simplify Settings**

Settings should keep:

- `Danger Zone` when `canRemove` is true.
- The non-admin notice when `!canManageRoles`.

Settings should not contain `Role & Department`.

- [ ] **Step 6: Run the focused unit test**

Run:

```bash
pnpm exec vitest run ui/src/__tests__/HumanDetail.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/pages/HumanDetail.tsx ui/src/__tests__/HumanDetail.test.tsx
git commit -m "feat(team): add human roles authority tab"
```

## Task 3: Update E2E Coverage For Roles Tab

**Files:**
- Modify: `tests/e2e/human-profile.spec.ts`

- [ ] **Step 1: Update the E2E flow**

After the Overview assertions, add:

```ts
await page.goto(`/${company.issuePrefix}/team/${userId}/roles`);
await expect(main.getByText("Authority")).toBeVisible({ timeout: 10_000 });
await expect(main.getByText("Role & Department")).toBeVisible();
await expect(main.getByText("Responsibilities")).toBeVisible();
await expect(main.getByText("Founder")).toBeVisible();
```

Then update the Settings assertion:

```ts
await page.goto(`/${company.issuePrefix}/team/${userId}/settings`);
await expect(main.getByText("Role & Department")).toHaveCount(0);
await expect(main.getByRole("region", { name: "Profile" })).toHaveCount(0);
```

- [ ] **Step 2: Run E2E for this spec**

Run:

```bash
$env:AOA_E2E_FORCE_WINDOWS='1'; $env:AOA_E2E_PORT='3249'; $env:AOA_E2E_DB_PORT='55479'; pnpm exec playwright test --config=tests/e2e/playwright.config.ts tests/e2e/human-profile.spec.ts
```

Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/human-profile.spec.ts
git commit -m "test(e2e): cover human roles tab"
```

## Task 4: Final Verification

**Files:**
- No code changes unless verification exposes a regression.

- [ ] **Step 1: Run focused unit test**

```bash
pnpm exec vitest run ui/src/__tests__/HumanDetail.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run UI typecheck**

```bash
pnpm --filter @armyofagents/ui typecheck
```

Expected: PASS.

- [ ] **Step 3: Run E2E profile spec**

```bash
$env:AOA_E2E_FORCE_WINDOWS='1'; $env:AOA_E2E_PORT='3249'; $env:AOA_E2E_DB_PORT='55479'; pnpm exec playwright test --config=tests/e2e/playwright.config.ts tests/e2e/human-profile.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Live smoke against the isolated app**

Use Playwright against `http://127.0.0.1:3207` to verify:

- `/MANA/team/local-board/roles` loads.
- `Authority`, `Responsibilities`, and `Role & Department` are visible.
- `/MANA/team/local-board/settings` does not show `Role & Department`.
- No page errors are emitted.

- [ ] **Step 5: Report next scope**

After Scope 1 ships, recommend Scope 2:

- Either `Responsibilities Profile` with skills/resume/ownership markdown.
- Or `Auth/RBAC preparation` if the user wants to start permission enforcement next.

## Self-Review

- Spec coverage: The plan covers the approved read-first Roles tab and includes immediate role/department/reports-to controls.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Existing `role`, `departmentId`, `parentId`, `permissions`, and `MemberDependencies` names match the current code.
- Scope discipline: No backend/schema changes because the current API already supports the product shape.
