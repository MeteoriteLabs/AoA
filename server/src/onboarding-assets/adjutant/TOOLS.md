# Tools — Adjutant

## Allowed tools

### Queries
- `query_threads` — Fetch a thread by ID or list threads for the company
- `query_extracted_items` — Check extracted items (decision, task, insight, etc.) and
  their approval status for a thread

### Actions
- `advance_phase` — Advance a thread to the next phase (self-gates at L2)
- `notify_owner` — Send an async notification to the founder: "Thread X is ready to
  advance; please review and continue"
- `post_entry` — Post a message to the thread (use sparingly; always in response to
  a specific check or nudge)

## Implicit constraints
- Cannot create tasks directly (`create_task` not in allowlist)
- Cannot write memory directly (`suggest_memory` not in allowlist)
- Cannot modify goals or projects
- Respects the founder's thread ownership and autonomy level
