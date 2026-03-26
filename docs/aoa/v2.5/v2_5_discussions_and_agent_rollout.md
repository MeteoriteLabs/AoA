---
Feature: v2_5_discussions_and_agent
Doc type: rollout
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_tasks.md, v2_5_discussions_and_agent_schema.md
---

# V2.5 Discussions & Internal Agent — Rollout Strategy

Migration plan, feature flags, phased rollout, rollback procedures, and monitoring.

---

## Migration Plan

### Phase 1: Create New Tables (Non-Breaking)

Run before deploying any new code. All new tables — no modifications to existing tables.

**Tables created:**
- `discussions`
- `discussion_entries`
- `discussion_extracted_items`
- `discussion_annotations`
- `internal_agent_config`
- `internal_agent_conversations`
- `internal_agent_messages`
- `internal_agent_runs`
- `internal_agent_reminders`
- `workflow_templates`

**Execution:**
```bash
pnpm db:generate   # generates migration from new schema files
pnpm db:migrate    # applies migration
```

**Rollback:** Drop the new tables. No existing functionality affected.

**Verification:**
- All 10 tables exist with correct columns
- All 24 indexes created
- No existing tables modified

### Phase 2: Data Migration (Debriefs → Discussions)

Migrate existing debrief and brief data into the new discussion model. Run as a one-time migration script (not a Drizzle migration — this is data, not schema).

**Migration script:** `server/src/migrations/v2_5-migrate-debriefs-to-discussions.ts`

**Mapping:**

| Old | New | Notes |
|-----|-----|-------|
| `debriefs` row | `discussions` row | One debrief = one discussion (single-entry thread) |
| `debriefs.content` | `discussion_entries` row | Entry with `inputType` inferred from debrief source |
| `debriefs.departmentId` | `discussions.scopeType='department'`, `discussions.scopeId` | Scope preserved |
| `debriefs.projectId` | `discussions.scopeType='project'`, `discussions.scopeId` | If both dept and project, prefer project |
| `debriefs.goalId` | `discussions.scopeType='goal'`, `discussions.scopeId` | Goal scope |
| `brief_items` rows | `discussion_extracted_items` rows | Status mapping: approved→approved, pending→pending, etc. |
| `brief_items.resultIssueId` | `discussion_extracted_items.resultTaskId` | Direct mapping |
| `brief_items.resultMemoryItemId` | `discussion_extracted_items.resultMemoryId` | Direct mapping |

**Migration steps:**
1. For each debrief: create `discussions` row with title from debrief (or "Migrated: " + first 50 chars)
2. Create `discussion_entries` row with debrief content, inputType based on source (voice → 'voice', MCP → 'mcp', else 'paste')
3. For each brief linked to the debrief: create `discussion_extracted_items` rows from brief_items
4. Set `extractionStatus = 'completed'` on migrated entries (they were already processed)
5. Update denormalized counts on discussions

**Idempotency:** Migration script checks for existing migrated data (via a `migratedFromDebriefId` field in discussions metadata) and skips already-migrated records.

**Rollback:** Delete all rows from new tables where `createdAt` matches migration timestamp range. Original debrief/brief data is untouched.

### Phase 3: Create Default Internal Agent Config

For each existing company, insert a default `internal_agent_config` row:

```typescript
{
  companyId: company.id,
  executionMode: 'api',
  provider: 'anthropic',          // default, changeable
  model: 'claude-sonnet-4-20250514',
  autonomyLevel: 0,
  enabledCapabilities: [
    'discussion_processing',
    'organizational_queries',
    'system_actions',
    'memory_management',
    'proactive_monitoring',
    'context_briefing',
    'workflow_discovery',
    'reminders',
  ],
  notificationPreference: 'realtime',
  contextTokenBudget: 8000,
  budgetMonthlyCents: 1000,       // $10.00 conservative default
  spentMonthlyCents: 0,
  proactiveIntervalMinutes: 240,
  maxResponseTokens: 4096,
}
```

**Rollback:** Delete `internal_agent_config` rows.

### Phase 4: Deprecate Old Tables

After migration is confirmed successful and the new system has run for ≥2 weeks:

1. Add deprecation comments to old schema files
2. Route old API endpoints to new ones (redirects)
3. **Do NOT drop old tables** — keep for rollback safety for ≥1 month
4. After 1 month with no issues: archive old tables (rename with `_deprecated_` prefix)

---

## Feature Flags

Feature flags control the rollout of v2.5 capabilities. Stored in `internal_agent_config` per company (not a separate feature flag system).

| Flag | Default | Controls |
|------|---------|----------|
| `enabledCapabilities` (array) | All 8 capabilities | Which agent capabilities are active |
| `executionMode` | `'api'` | Whether agent uses API or CLI |
| `proactiveIntervalMinutes` | `240` | How often proactive checks run (0 = disabled) |
| `notificationPreference` | `'realtime'` | Notification delivery mode |

### Gradual Capability Rollout

The recommended rollout order for capabilities:

1. **Week 1:** `organizational_queries` + `discussion_processing` — read-only queries and extraction
2. **Week 2:** Add `system_actions` + `memory_management` — agent can take actions
3. **Week 3:** Add `proactive_monitoring` + `context_briefing` — morning digests, scheduled checks
4. **Week 4:** Add `workflow_discovery` + `reminders` — workflow templates, scheduled reminders

This order ensures the lowest-risk features go live first, building confidence before enabling write actions and proactive behavior.

---

## Phased Deployment

### Deploy 1: Schema + Backend Services (No UI)

**What ships:**
- New database tables and indexes
- `DiscussionService` (backend only)
- `InternalAgentService` (backend only)
- `WorkflowTemplateService` (backend only)
- API routes (all endpoints)
- Data migration script (runs post-deploy)
- MCP changes (`push-discussion` tool)

**What doesn't ship:**
- No frontend changes
- Old debrief/brief UI still works

**Verification:**
- API endpoints respond correctly (test via curl/Postman)
- MCP `push-discussion` creates discussions
- Migration script runs successfully on staging data

### Deploy 2: Discussion UI

**What ships:**
- Discussions list page
- Discussion detail page
- DiscussionCaptureModal (replaces DebriefModal)
- Sidebar update: Discussions appears under WORK
- Discussion tab on project/department pages
- Inbox notifications for extraction events

**What doesn't ship:**
- Agent panel not yet visible
- Old Brief review page still accessible (link hidden)

**Verification:**
- Quick capture flow works end-to-end
- Inline review works
- Migrated debriefs appear in discussions list
- Search includes discussions

### Deploy 3: Internal Agent Panel

**What ships:**
- Agent panel (right side, toggle in BreadcrumbBar)
- Agent panel context (state management)
- SSE streaming in agent panel
- Action confirmation UI
- Morning digest / greeting
- Mobile: agent toggle replaces Create in bottom nav

**Verification:**
- Agent answers organizational queries
- Tool calls display correctly
- Action confirmation works
- Streaming is smooth (no dropped events)
- Panel state persists across navigation

### Deploy 4: Workflow + Settings + Polish

**What ships:**
- Workflow template UI (list, create, instantiate)
- Internal agent settings page
- Reminder UI in agent panel
- Old debrief/brief routes redirect to discussions
- Performance optimizations

**Verification:**
- Full workflow creation via agent conversation
- Template instantiation creates correct task chains
- Settings changes take effect immediately
- No regressions in existing features

---

## Rollback Procedures

### Severity Levels

| Level | Condition | Action |
|-------|-----------|--------|
| **P0 — Data loss** | Migration corrupted existing data | Restore from backup, revert all deploys |
| **P1 — Feature broken** | Discussions or agent panel non-functional | Revert frontend deploy, keep backend |
| **P2 — Degraded** | Agent slow, extraction unreliable | Disable capabilities via config, investigate |
| **P3 — Cosmetic** | UI glitches, minor issues | Fix forward |

### Rollback Steps per Deploy

**Deploy 1 rollback:**
1. Revert backend code to pre-v2.5
2. Old debrief/brief routes restored
3. New tables remain (harmless, unused)
4. If migration ran: data stays in new tables (doesn't affect old tables)

**Deploy 2 rollback:**
1. Revert frontend to pre-v2.5
2. Old debrief/brief pages restored
3. Sidebar reverts to old structure
4. Backend routes still exist (just unused by frontend)

**Deploy 3 rollback:**
1. Remove agent panel component
2. Remove BreadcrumbBar toggle
3. Backend agent routes still exist but unused
4. Mobile bottom nav reverts to original

**Deploy 4 rollback:**
1. Remove workflow UI
2. Remove settings page additions
3. Re-enable old debrief/brief direct routes

### Data Rollback

Old tables (`debriefs`, `briefs`, `brief_items`) are never dropped or modified. They remain as-is throughout the entire rollout. If a full rollback is needed:

1. Revert all code to pre-v2.5
2. Old tables are still there with original data
3. New tables exist but are unused
4. No data loss possible

---

## Monitoring

### Key Metrics to Track

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Discussion creation rate | `discussions` table count | — (baseline) |
| Extraction success rate | `discussion_entries.extractionStatus` | < 90% success |
| Extraction latency (p95) | `internal_agent_runs.durationMs` where triggerSource='discussion_entry' | > 30s |
| Agent chat latency (p95) | `internal_agent_runs.durationMs` where triggerSource='user_message' | > 10s |
| Agent error rate | `internal_agent_runs.status='failed'` / total | > 5% |
| Budget burn rate | `internal_agent_config.spentMonthlyCents` | > 80% of limit |
| Provider API errors | Provider response status codes | > 2% error rate |
| Conversation count | `internal_agent_conversations` count | — (baseline) |
| Proactive run frequency | `internal_agent_runs` where triggerType='proactive' | Missed scheduled runs |

### Health Check Endpoint

```
GET /api/internal-agent/health
Response:
{
  "status": "ok",
  "provider": "anthropic",
  "lastRunAt": "2026-03-24T10:30:00Z",
  "budgetRemainingCents": 750,
  "conversationCount": 12,
  "extractionSuccessRate": 0.97
}
```

Founder-only endpoint. Included in the agent settings page.

### Log Points

Key operations that should emit structured logs:

- `internal_agent.run.start` — { runId, triggerType, triggerSource, userId }
- `internal_agent.run.complete` — { runId, durationMs, toolCallCount, costCents }
- `internal_agent.run.failed` — { runId, error, durationMs }
- `internal_agent.budget.warning` — { companyId, spentMonthlyCents, budgetMonthlyCents }
- `internal_agent.budget.exceeded` — { companyId }
- `discussion.entry.created` — { discussionId, entryId, inputType }
- `discussion.extraction.completed` — { entryId, itemCount }
- `discussion.extraction.failed` — { entryId, error }
- `migration.debrief.start` — { totalDebriefs }
- `migration.debrief.complete` — { migratedCount, skippedCount, duration }
