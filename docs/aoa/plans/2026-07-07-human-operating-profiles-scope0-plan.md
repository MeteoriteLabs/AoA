# Human Operating Profiles Scope 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the company-scoped human profile foundation and turn the existing Human Detail page into a useful current-state operating view: profile identity, uploaded avatar, social links, active work, created work, recent activity, authority context, reporting context, and fixed join request actions.

**Architecture:** Scope 0 adds a small company-scoped profile table layered on top of global auth identity and existing company membership/RBAC. It reuses existing company-scoped assets for avatar upload, existing Team routes/services for profile read/update, existing Issues and Activity list APIs for dashboard data, and existing Access APIs for join request actions. It does not add markdown profile docs, responsibilities/capabilities, agent-readable profile memory, availability, or HR-style records.

**Tech Stack:** Express routes and services, Drizzle queries, shared TypeScript contracts, React/Vite UI, TanStack Query, Vitest.

---

## Current Grounding

The current shipped surface already has:

- `ui/src/pages/TeamPage.tsx`: Team hub with Humans, Agents, Organization, Teams, AoA Team.
- `ui/src/components/team/HumansTab.tsx`: search, role filters, member cards, invites, add member, transfer admin.
- `ui/src/pages/HumanDetail.tsx`: Overview and Settings tabs.
- `server/src/routes/team.ts` and `server/src/services/team.ts`: team summary, member detail, role/reporting updates, dependencies, reassignment/removal.
- `ui/src/pages/Me.tsx`: self-edit global display name and avatar URL; Scope 0 moves Team/Human pages toward company-scoped profile identity.

Key gaps this scope addresses:

- Human Detail shows counts but not the actual assigned or created tasks.
- Human Detail does not show recent activity by that human.
- Human Detail does not make authority, manager, and permission context visible enough.
- The Join Request hub viewer links Approve and Decline to `/team?tab=requests`, but Team has no `requests` tab.
- Settings works only for role, department, reports-to, and removal.
- Human display name/avatar/title/bio/location/timezone/social links are not company-scoped yet.

## Non-Goals

- Do not rename Team/Humans routes or DB/API tables.
- Do not introduce "Skills" terminology for humans. Use "Capabilities" in later scopes.
- Do not make human profile data agent-readable yet.
- Do not add HR/payroll/review workflows.
- Do not add markdown profile documents or `bio.md` in Scope 0.
- Do not add responsibilities/capabilities, working hours, profile review cadence, or agent-readable summaries yet.

## TDD Rules For This Scope

- [ ] Every production behavior change starts with a failing test.
- [ ] Watch each focused test fail for the expected reason before implementing.
- [ ] Implement only the minimum code needed to pass the test.
- [ ] Keep commits small and grouped by behavior.
- [ ] Add route/service tests for backend contract changes, component/API tests for UI behavior, and full typecheck/build verification before handoff.

## Implementation Tasks

### 1. Add Company-Scoped Human Profile Schema

- [ ] Create failing schema/export tests for a `company_user_profiles` table with:
  - [ ] `id`
  - [ ] `companyId`
  - [ ] `userId`
  - [ ] `displayName`
  - [ ] `title`
  - [ ] `bio`
  - [ ] `location`
  - [ ] `timezone`
  - [ ] `socialLinks`
  - [ ] `avatarAssetId`
  - [ ] `createdAt`
  - [ ] `updatedAt`
  - [ ] `updatedByUserId`
- [ ] Add a unique index on `(companyId, userId)`.
- [ ] Add company FK with cascade delete.
- [ ] Add avatar asset FK with `set null`.
- [ ] Export the table from `packages/db/src/schema/index.ts`.
- [ ] Generate the Drizzle migration with `pnpm db:generate`.
- [ ] Verify the generated migration contains only expected table/index/FK changes.

### 2. Add Shared Profile Types And Validators

- [ ] Write failing validator/type tests for company user profile read/update payloads.
- [ ] Extend `packages/shared/src/types/team.ts` with:
  - [ ] `CompanyUserProfile`
  - [ ] `HumanSocialLink`
  - [ ] profile fields on `TeamMemberSummary`
  - [ ] edit capability fields when needed by the UI.
- [ ] Add a validator for updating profile fields:
  - [ ] trim display name/title/location/timezone/bio.
  - [ ] cap field lengths.
  - [ ] validate social link URL/type/label.
  - [ ] accept `avatarAssetId: string | null`.
- [ ] Keep social links visible to all company members by default; no per-link visibility in Scope 0.

### 3. Add Profile Service And API Behavior

- [ ] Write failing service tests for profile read fallback:
  - [ ] profile display name overrides auth display/name.
  - [ ] uploaded avatar asset renders as `/api/assets/:assetId/content`.
  - [ ] no uploaded avatar falls back to auth avatar/image, then initials in UI.
- [ ] Write failing route tests for profile update permissions:
  - [ ] a member can edit their own basic profile.
  - [ ] founder/system admin can edit another member's profile.
  - [ ] non-founder/non-admin cannot edit another member's profile.
  - [ ] non-member cannot update a profile for the company.
- [ ] Write failing route/service tests that `avatarAssetId` must belong to the same company and must be an image asset.
- [ ] Implement profile upsert/read helpers in `server/src/services/team.ts` or a focused companion service if the file becomes too large.
- [ ] Add `PATCH /companies/:companyId/team/users/:userId/profile`.
- [ ] Log `team.profile_updated` activity on mutation.
- [ ] Extend `listTeam` and member detail responses to include company profile fields.

### 4. Add Created-By Task Filtering

- [ ] Extend `ui/src/api/issues.ts` list filters with `createdByUserId?: string`.
- [ ] Send `createdByUserId` as a query parameter when present.
- [ ] Extend `server/src/routes/issues.ts` to parse `createdByUserId`, matching existing `assigneeUserId`, `touchedByUserId`, and `unreadForUserId` behavior.
- [ ] Support `createdByUserId=me` only for board-authenticated requests, returning `403` otherwise.
- [ ] Extend `server/src/services/issues.ts` `IssueFilters` with `createdByUserId?: string`.
- [ ] Add the Drizzle condition `eq(issues.createdByUserId, filters.createdByUserId)` in the list query.
- [ ] Keep company scoping and `taskScope` behavior unchanged.
- [ ] Add or update focused tests for:
  - [ ] `createdByUserId` is forwarded by the UI client.
  - [ ] service list filters by creator.
  - [ ] route rejects `createdByUserId=me` when the caller is not board-authenticated.

### 5. Add Actor-Based Activity Filtering

- [ ] Extend `ui/src/api/activity.ts` list filters with `actorType?: "agent" | "user" | "system" | "autonomy"` and `actorId?: string`.
- [ ] Optionally add a bounded `limit?: number` filter if the server can enforce it cleanly; otherwise slice in the UI.
- [ ] Extend `server/src/routes/activity.ts` to accept `actorType`, `actorId`, and optionally `limit`.
- [ ] Extend `server/src/services/activity.ts` `ActivityFilters`.
- [ ] Add Drizzle conditions for `activityLog.actorType` and `activityLog.actorId`.
- [ ] Preserve the existing hidden-issue suppression logic.
- [ ] Add focused tests for:
  - [ ] filtering by `actorType=user&actorId=<userId>`.
  - [ ] entity filters and actor filters composing together.
  - [ ] hidden issue activity remains suppressed.

### 6. Upgrade Human Detail Overview And Settings

- [ ] Update `ui/src/pages/HumanDetail.tsx` so the Team summary query is enabled for overview and settings. It is needed to resolve manager labels and authority context.
- [ ] Add TanStack queries for:
  - [ ] assigned tasks: `issuesApi.list(companyId, { assigneeUserId: userId, taskScope: "all" })`.
  - [ ] created tasks: `issuesApi.list(companyId, { createdByUserId: userId, taskScope: "all" })`.
  - [ ] recent activity: `activityApi.list(companyId, { actorType: "user", actorId: userId })`.
- [ ] Use distinct query keys so all-scope task lists do not poison the main task board cache.
- [ ] Add a compact "Authority" section showing:
  - [ ] role.
  - [ ] department.
  - [ ] reports-to manager, when available.
  - [ ] system admin badge/state.
  - [ ] explicit permission grants from `member.permissions`, when present.
- [ ] Add "Assigned Tasks" and "Created Tasks" list sections:
  - [ ] show identifier, title, status, priority, updated/created date where available.
  - [ ] link rows to `/issues/:issueId`.
  - [ ] cap visible rows to a small number, with a "View all" link when there are more.
  - [ ] keep empty, loading, and error states clear.
- [ ] Add "Recent Activity" section:
  - [ ] show action, entity type, timestamp, and any safe short detail already present.
  - [ ] link to issue pages when `entityType === "issue"`.
  - [ ] cap visible rows.
- [ ] Keep the existing Team Reports and Agents sections.
- [ ] Add a Profile section in Settings for:
  - [ ] display name.
  - [ ] avatar upload and remove.
  - [ ] title/headline.
  - [ ] bio.
  - [ ] location.
  - [ ] timezone.
  - [ ] social links.
- [ ] Keep role/department/reports-to/removal in the existing settings area and permissions model.
- [ ] Show profile edit controls only when the current actor can edit that profile.

### 7. Fix Join Request Actions From Inbox

- [ ] Replace the placeholder links in `ui/src/components/hub/viewers/JoinRequestBody.tsx`.
- [ ] Use the existing `accessApi.approveJoinRequest(companyId, requestId)` and `accessApi.rejectJoinRequest(companyId, requestId)` calls.
- [ ] Resolve `requestId` from `item.sourceId` for join request items; fall back to `item.relatedEntityId` only if the source changes later.
- [ ] Use the selected company from `CompanyContext`.
- [ ] Add loading and disabled states for the two buttons.
- [ ] On success, invalidate:
  - [ ] `queryKeys.access.joinRequests(companyId, "pending_approval")`.
  - [ ] `queryKeys.hubItems.list(...)` or the relevant hub prefix.
  - [ ] `queryKeys.sidebarBadges(companyId)`.
- [ ] Show success/error toasts.
- [ ] If no company or request id is available, show disabled actions and a clear inline fallback.
- [ ] Update `ui/src/components/hub/viewers/__tests__/HubViewers.test.tsx` so Join Request expects buttons, not links.
- [ ] Add tests that Approve and Decline call the correct API methods and invalidate relevant queries.

### 8. Polish States and Copy

- [ ] Keep copy operational, not HR-heavy.
- [ ] Use "Tasks", "Reports", "Agents", "Authority", and "Activity" labels.
- [ ] Avoid "Skills" and "Resume" terms in Scope 0.
- [ ] Use "Profile" for basic human identity fields.
- [ ] Ensure cards and sections work on mobile and desktop without text overflow.
- [ ] Keep cards shallow; do not nest decorative cards inside cards.
- [ ] Add icons only where they clarify scanning.

### 9. Verification

- [ ] Run focused tests first:
  - [ ] `pnpm test:run -- ui/src/components/hub/viewers/__tests__/HubViewers.test.tsx`
  - [ ] targeted schema/shared validator tests for `company_user_profiles`.
  - [ ] targeted team route/service tests for profile read/update and avatar validation.
  - [ ] targeted new/updated server tests for issue/activity filters.
  - [ ] targeted Human Detail UI test if added.
- [ ] Run full required checks before handoff:
  - [ ] `pnpm -r typecheck`
  - [ ] `pnpm test:run`
  - [ ] `pnpm build`
- [ ] If UI layout changes are substantial, run the dev server and verify `/team/:userId` manually in browser at desktop and mobile widths.

## Commit Plan

- [ ] Commit 1: `feat(team): add company human profiles`
- [ ] Commit 2: `feat(tasks): filter tasks by creator`
- [ ] Commit 3: `feat(activity): filter activity by actor`
- [ ] Commit 4: `feat(team): enrich human overview`
- [ ] Commit 5: `fix(inbox): handle join request actions inline`
- [ ] Commit 6: `test(team): cover human profile and overview`

## Later Scope Handoff

When Scope 0 is complete, revisit the master scope doc and choose Scope 1: Responsibilities, Capabilities, and Agent-Ready Profile Context. That is where structured responsibilities, capabilities, availability, working style, agent-readable summaries, visibility/review metadata, and profile review cadence should be designed and implemented.
