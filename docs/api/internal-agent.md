---
title: Commander API
summary: Internal Agent conversations, runs, reminders, settings, and cockpit data
---

Commander is AoA's internal assistant. These routes are company-scoped and primarily serve the board UI. Treat them as authenticated operator APIs, not public unauthenticated endpoints.

## Chat, Conversation, and Runs

```
POST /api/companies/{companyId}/internal-agent/chat
POST /api/companies/{companyId}/internal-agent/confirm
GET /api/companies/{companyId}/internal-agent/conversation
DELETE /api/companies/{companyId}/internal-agent/conversation
GET /api/companies/{companyId}/internal-agent/conversations
POST /api/companies/{companyId}/internal-agent/conversations
PATCH /api/companies/{companyId}/internal-agent/conversations/reorder
DELETE /api/companies/{companyId}/internal-agent/conversations/order
PATCH /api/companies/{companyId}/internal-agent/conversations/{conversationId}/archive
PATCH /api/companies/{companyId}/internal-agent/conversations/{conversationId}/pin
PATCH /api/companies/{companyId}/internal-agent/conversations/{conversationId}/rename
DELETE /api/companies/{companyId}/internal-agent/conversations/{conversationId}
GET /api/companies/{companyId}/internal-agent/conversations/{conversationId}/messages
GET /api/companies/{companyId}/internal-agent/runs
```

`/chat` is POST-based SSE streaming (`text/event-stream`); the browser client uses `fetch`, not `EventSource`, so request bodies and abort signals work. Conversation routes persist user, assistant, and tool messages and support session list management. Run routes expose execution metadata and tool/cost traces.

## Settings, Capabilities, and Reminders

```
GET /api/companies/{companyId}/internal-agent/config
PATCH /api/companies/{companyId}/internal-agent/config
GET /api/companies/{companyId}/internal-agent/runtime-settings
GET /api/companies/{companyId}/internal-agent/greeting
GET /api/companies/{companyId}/internal-agent/skills
GET /api/companies/{companyId}/internal-agent/tool-permissions
PATCH /api/companies/{companyId}/internal-agent/tool-permissions
GET /api/companies/{companyId}/internal-agent/tool-trust-rules
DELETE /api/companies/{companyId}/internal-agent/tool-trust-rules/{ruleId}
POST /api/companies/{companyId}/internal-agent/test-connection
GET /api/companies/{companyId}/internal-agent/reminders
PATCH /api/companies/{companyId}/internal-agent/reminders/{reminderId}
```

Config includes execution mode, provider/model fields, autonomy level, enabled capabilities, budget, and proactive interval. Current execution is CLI-mode by default.

## Cockpit

```
GET /api/companies/{companyId}/cockpit
GET /api/companies/{companyId}/cockpit/counts
GET /api/companies/{companyId}/cockpit/tasks?bucket={mine|managed|awaiting_review}&limit={1..100}&cursor={opaqueCursor}
```

These board-only routes return the current user's company-scoped Commander work.

- `/cockpit` returns bounded card slices, per-slice status metadata, Active Work split into `mine` and `managed`, and a separate `awaitingReview` queue. A failed independent slice sets `meta.partial` instead of presenting a false all-clear state.
- `/cockpit/counts` supplies lightweight collapsed-rail counts without loading every Cockpit card.
- `/cockpit/tasks` provides stable cursor pagination for the three accountable-work queues. Cursors are opaque and tied to the selected bucket's ranking order.

Active Work excludes terminal and `in_review` tasks. `mine` wins when a task also matches the user's responsibility hierarchy. `managed` follows the bounded mixed human/agent reporting graph, while `awaiting_review` includes explicit reviewer assignments and review work in that responsibility scope.
