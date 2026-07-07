# Human Operating Profiles Scope 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Human Detail page into a useful current-state operating view before adding new profile schema: show the person's active work, created work, recent activity, authority context, reporting context, and fix the broken join request action path.

**Architecture:** Scope 0 is a polish and contract-fill pass. It reuses the current company-scoped Team, Issues, Activity, and Access surfaces. It does not add a new human profile table, markdown profile documents, avatar upload, social links, or agent-readable profile memory. Those belong to later scopes in `docs/aoa/plans/2026-07-07-human-operating-profiles-scope.md`.

**Tech Stack:** Express routes and services, Drizzle queries, shared TypeScript contracts, React/Vite UI, TanStack Query, Vitest.

---

## Current Grounding

The current shipped surface already has:

- `ui/src/pages/TeamPage.tsx`: Team hub with Humans, Agents, Organization, Teams, AoA Team.
- `ui/src/components/team/HumansTab.tsx`: search, role filters, member cards, invites, add member, transfer admin.
- `ui/src/pages/HumanDetail.tsx`: Overview and Settings tabs.
- `server/src/routes/team.ts` and `server/src/services/team.ts`: team summary, member detail, role/reporting updates, dependencies, reassignment/removal.
- `ui/src/pages/Me.tsx`: self-edit display name and avatar URL.

Key gaps this scope addresses:

- Human Detail shows counts but not the actual assigned or created tasks.
- Human Detail does not show recent activity by that human.
- Human Detail does not make authority, manager, and permission context visible enough.
- The Join Request hub viewer links Approve and Decline to `/team?tab=requests`, but Team has no `requests` tab.
- Settings works only for role, department, reports-to, and removal. Rich identity/profile editing stays out of Scope 0.

## Non-Goals

- Do not add `company_user_profiles` or any new profile schema in Scope 0.
- Do not rename Team/Humans routes or DB/API tables.
- Do not introduce "Skills" terminology for humans. Use "Capabilities" in later scopes.
- Do not make human profile data agent-readable yet.
- Do not add HR/payroll/review workflows.
- Do not add avatar file upload or social links yet.

## Implementation Tasks

### 1. Add Created-By Task Filtering

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

### 2. Add Actor-Based Activity Filtering

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

### 3. Upgrade Human Detail Overview

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
- [ ] Keep the settings tab behavior unchanged except for any shared query changes.

### 4. Fix Join Request Actions From Inbox

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

### 5. Polish States and Copy

- [ ] Keep copy operational, not HR-heavy.
- [ ] Use "Tasks", "Reports", "Agents", "Authority", and "Activity" labels.
- [ ] Avoid "Skills" and "Resume" terms in Scope 0.
- [ ] Ensure cards and sections work on mobile and desktop without text overflow.
- [ ] Keep cards shallow; do not nest decorative cards inside cards.
- [ ] Add icons only where they clarify scanning.

### 6. Verification

- [ ] Run focused tests first:
  - [ ] `pnpm test:run -- ui/src/components/hub/viewers/__tests__/HubViewers.test.tsx`
  - [ ] targeted new/updated server tests for issue/activity filters.
  - [ ] targeted Human Detail UI test if added.
- [ ] Run full required checks before handoff:
  - [ ] `pnpm -r typecheck`
  - [ ] `pnpm test:run`
  - [ ] `pnpm build`
- [ ] If UI layout changes are substantial, run the dev server and verify `/team/:userId` manually in browser at desktop and mobile widths.

## Commit Plan

- [ ] Commit 1: `feat(tasks): filter tasks by creator`
- [ ] Commit 2: `feat(activity): filter activity by actor`
- [ ] Commit 3: `feat(team): enrich human overview`
- [ ] Commit 4: `fix(inbox): handle join request actions inline`
- [ ] Commit 5: `test(team): cover human overview and join request actions`

## Later Scope Handoff

When Scope 0 is complete, revisit the master scope doc and choose Scope 1: Company-Scoped Human Profiles. That is where name/image administration, title, bio, responsibilities, capabilities, social links, visibility, and profile review cadence should be designed and implemented.
