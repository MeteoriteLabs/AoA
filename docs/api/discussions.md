---
title: Discussions
summary: Discussion threads, entries, extracted items, annotations, and the approval flow
---

Discussions are the primary input pipeline for AoA. Paste text, write directly, record voice, or push via MCP — all routes land in a discussion thread where the LLM extracts tasks and memory suggestions for founder review.

See `CLAUDE.md` §Discussion Pipeline for the full architecture.

## List Discussions

```
GET /api/companies/{companyId}/discussions
```

Query parameters:

| Param | Description |
|-------|-------------|
| `status` | Filter by status: `active` \| `archived` |
| `scopeType` | Filter by scope: `department` \| `project` \| `goal` |
| `scopeId` | Filter by the scoped entity's ID |
| `hasPendingItems` | `true` \| `false` — filter by pending extracted item presence |
| `inputType` | Filter by entry input type: `paste` \| `write` \| `voice` \| `mcp` |

Returns `{ discussions: [...], total, limit, offset }`.

## Get Discussion

```
GET /api/companies/{companyId}/discussions/{discussionId}
```

Returns the discussion with its entries and extracted items.

## Create Discussion

```
POST /api/companies/{companyId}/discussions
```

Requires `founder` or `team_lead` role.

```json
{
  "title": "Q3 planning notes",
  "scopeType": "goal",
  "scopeId": "{goalId}",
  "tags": ["planning"],
  "entry": {
    "inputType": "paste",
    "rawContent": "We need to ship the new onboarding flow by end of Q3.",
    "departmentId": null,
    "projectId": "{projectId}",
    "goalId": "{goalId}"
  }
}
```

Fields:
- `title` — optional display name
- `scopeType` — `department`, `project`, or `goal` (optional; sets thread-level scope)
- `scopeId` — ID of the scoped entity (optional)
- `tags` — optional string array
- `entry` — optional first entry created alongside the thread (see Add Entry below)

Returns `201` with the created discussion.

## Update Discussion

```
PATCH /api/companies/{companyId}/discussions/{discussionId}
```

Requires `founder` or `team_lead` role. Updatable fields: `title`, `status` (`active` | `archived`), `tags`.

## Add Entry

```
POST /api/companies/{companyId}/discussions/{discussionId}/entries
```

Requires `founder` or `team_lead` role.

```json
{
  "inputType": "paste",
  "rawContent": "Decided: we will use SSE for all streaming endpoints.",
  "title": null,
  "departmentId": null,
  "projectId": "{projectId}",
  "goalId": null,
  "sourceInfo": null
}
```

Fields:
- `inputType` — `paste` \| `write` \| `voice` \| `mcp` (required)
- `rawContent` — the raw text content (required)
- `title` — optional entry title
- `departmentId` / `projectId` / `goalId` — entry-level scope override. Entry scope takes priority over thread scope (Decision #61)
- `sourceInfo` — arbitrary metadata (used by MCP push to carry caller context)

Returns `201` with the entry. Extraction runs asynchronously — poll the discussion to see `extractionStatus` updates on the entry.

## Reprocess Entry

```
POST /api/companies/{companyId}/discussions/{discussionId}/entries/{entryId}/reprocess
```

Requires `founder` role. Re-runs LLM extraction on a failed or completed entry. Returns the new extraction result.

## Reprocess All Entries

```
POST /api/companies/{companyId}/discussions/{discussionId}/reprocess
```

Requires `founder` role. Reprocesses all entries in the thread. Returns `{ reprocessed: N }`.

## Update Extracted Item

```
PATCH /api/companies/{companyId}/discussions/{discussionId}/entries/{entryId}/items/{itemId}
```

Requires `founder` or `team_lead` role. Edit a pending extracted item before approving it. Accepts any subset of the item's fields.

## Approve / Reject Items

```
POST /api/companies/{companyId}/discussions/{discussionId}/approve
```

Requires `founder` role. Batch approval/rejection of extracted items. Creates tasks and memory items for approved items.

```json
{
  "items": [
    { "itemId": "{itemId1}", "action": "approved" },
    { "itemId": "{itemId2}", "action": "edited", "edits": { "title": "Revised title" } },
    { "itemId": "{itemId3}", "action": "rejected" }
  ],
  "dependencies": [
    { "dependentItemId": "{itemId2}", "dependencyItemId": "{itemId1}" }
  ]
}
```

Item actions:
- `approved` — create task or memory item as-is
- `edited` — apply `edits` then create
- `rejected` — dismiss the item

The optional `dependencies` array wires blocking relationships between approved items. Both items must have been approved in this call (or previously).

Returns:
```json
{
  "approved": 2,
  "rejected": 1,
  "tasksCreated": ["{taskId1}", "{taskId2}"],
  "memoryItemsCreated": []
}
```

## Add Annotation

```
POST /api/companies/{companyId}/discussions/{discussionId}/entries/{entryId}/annotations
```

Requires `founder` or `team_lead` role. Adds an inline annotation to a character range of an entry.

```json
{
  "anchorStart": 42,
  "anchorEnd": 78,
  "content": "This needs clarification — check with the design team."
}
```

`anchorStart` and `anchorEnd` are character offsets into the entry's `rawContent`.

Returns `201` with the annotation.

## Link Entry to Different Discussion

```
POST /api/companies/{companyId}/discussions/link
```

Requires `founder` role. Moves an entry from its current discussion to a different one.

```json
{
  "entryId": "{entryId}",
  "targetDiscussionId": "{targetDiscussionId}"
}
```

Returns:
```json
{
  "entryId": "{entryId}",
  "previousDiscussionId": "{sourceDiscussionId}",
  "newDiscussionId": "{targetDiscussionId}"
}
```

## Extraction Item Types

Extracted items have a `type` field:

| Type | Creates |
|------|---------|
| `task` | A new task in `issues` |
| `memory` | A pending memory item |
| `decision` | Stored on the item; no downstream entity created automatically |
| `insight` | Same as decision |
| `context` | Same as decision |
| `reference` | Same as decision |
| `preference` | Same as decision |

## Extraction Status

Each entry tracks its extraction lifecycle:

| Status | Meaning |
|--------|---------|
| `pending` | Queued for extraction |
| `processing` | LLM extraction running |
| `completed` | Extraction succeeded; items available for review |
| `failed` | Extraction failed; founder notified via `notifications`. Use Reprocess Entry to retry. |

## Scope Fallback

Discussion scope resolves in this order (Decision #61):

1. Per-item founder override (highest priority)
2. Entry-level scope (`departmentId`/`projectId`/`goalId` on the entry)
3. Thread-level scope (`scopeType`/`scopeId` on the discussion)
4. `null` (company-wide)
