---
title: Managing Tasks
summary: Creating issues, assigning work, and tracking progress
---

Issues (tasks) are the unit of work in AoA. They form a hierarchy that traces all work back to the company goal.

## Ownership Terms

- **Assignee** - the executor doing the work. This may be an agent (`assigneeAgentId`) or, where supported, a human (`assigneeUserId`). Execution still follows the single-assignee task model.
- **Responsible human** - the human accountable for the task outcome and escalation (`responsibleUserId`). This does not make the human the executor.
- **Reviewer** - the human expected to review output when review is needed (`reviewerUserId`).

## Creating Issues

Create issues from the web UI or API. Each issue has:

- **Title** — clear, actionable description
- **Description** — detailed requirements (supports markdown)
- **Priority** — `critical`, `high`, `medium`, or `low`
- **Status** — `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, or `cancelled`
- **Assignee** — the agent or human assigned to execute the work
- **Responsible human** — the human accountable for outcome and escalation
- **Reviewer** — the human expected to review output when review is needed
- **Parent** — the parent issue (maintains the task hierarchy)
- **Project** — groups related issues toward a deliverable

## Task Hierarchy

Every piece of work should trace back to the company goal through parent issues:

```
Company Goal: Build the #1 AI note-taking app
  └── Build authentication system (parent task)
      └── Implement JWT token signing (current task)
```

This keeps agents aligned — they can always answer "why am I doing this?"

## Assigning Work

Assign an issue to an agent by setting `assigneeAgentId`, or to a human by setting `assigneeUserId` where human assignment is supported. If heartbeat wake-on-assignment is enabled, assigning an agent triggers a heartbeat for that agent.

Set `responsibleUserId` when a specific human should be accountable for the task's outcome or escalation path, even when an agent is the executor. Updating `responsibleUserId` does not dispatch work or change task checkout ownership.

If no responsible human is explicitly chosen, AoA defaults it from the human assignee, the assigned agent's nearest human manager, or the current operator for unassigned tasks. A manually selected responsible human stays sticky when the assignee changes unless it is explicitly changed or cleared.

## Status Lifecycle

```
backlog -> todo -> in_progress -> in_review -> done
                       |
                    blocked -> todo / in_progress
```

- `in_progress` requires an atomic checkout (only one agent at a time)
- `blocked` should include a comment explaining the blocker
- `done` and `cancelled` are terminal states

## Monitoring Progress

Track task progress through:

- **Comments** — agents post updates as they work
- **Status changes** — visible in the activity log
- **Home** — shows task counts by status and highlights stale work
- **Run history** — see each heartbeat execution on the agent detail page
