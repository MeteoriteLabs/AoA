---
Feature: v2_5_discussions_and_agent
Doc type: flow
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_decisions.md, v2_5_discussions_and_agent_api_contract.md
---

# V2.5 Discussions & Internal Agent — User Flows

User flows with decision points and state machines.

---

## Flow 1: Quick Capture (New Discussion)

The most common flow — founder quickly dumps a transcript or voice memo.

```
Founder is on any page
    │
    ├── Clicks "Discussion" quick action on Home page
    ├── Opens Cmd+K → selects "New Discussion"
    └── Uses keyboard shortcut
    │
    ▼
┌─────────────────────────────┐
│  DiscussionCaptureModal     │
│                             │
│  Tabs: [Paste] [Write] [🎤] │
│                             │
│  [Content input area]       │
│                             │
│  Thread: [New ▾]            │
│  ── or ──                   │
│  Thread: [Dashboard Redes▾] │
│                             │
│  [Cancel]  [Submit]         │
└─────────────────────────────┘
    │
    ▼
Decision: New thread or existing?
    │
    ├── New → POST /discussions (creates discussion + entry)
    └── Existing → POST /discussions/:id/entries
    │
    ▼
Modal closes. Founder stays on current page.
Toast: "Processing your discussion..."
    │
    ▼
Internal agent processes entry (background):
  - Loads thread context (if existing thread)
  - Loads system state (existing tasks, memory)
  - Runs extraction
  - Creates extracted items (status: pending)
    │
    ▼
Discussion entry.extractionStatus → 'completed'
WebSocket event: discussion.extraction.completed
    │
    ▼
Inbox notification: "3 items ready for review in 'Dashboard Redesign'"
Agent panel greeting updated (if open)
    │
    ▼
Founder reviews when ready (Flow 2)
```

---

## Flow 2: Inline Review of Extracted Items

Founder reviews items extracted from a discussion entry.

```
Founder opens Discussion detail page
(from Discussions list, Inbox notification, or project tab)
    │
    ▼
┌──────────────────────────────────────────────┐
│ Discussion: Dashboard Redesign               │
│                                              │
│ [Entry 1 - March 20, Paste] ✅               │
│   "Client call transcript..."                │
│   ✅ Task: Redesign dashboard (approved)     │
│   ✅ Memory: Client prefers minimal (saved)  │
│                                              │
│ [Entry 2 - March 24, Voice] ⏳               │
│   "Follow-up call notes..."                  │
│                                              │
│   ☐ Task: Update API endpoint (high)         │
│      [Priority ▾] [Dept ▾] [Assignee ▾]     │
│                                              │
│   ☐ Memory: Deadline moved to April 15       │
│      [Layer: domain ▾]                       │
│      ⚠ Conflicts with: "Deadline is April 30"│
│                                              │
│   ☐ Task: Add settings page (medium)         │
│      [Priority ▾] [Dept ▾]                   │
│      💡 Similar: "Build settings UI" exists   │
│                                              │
│   [Confirm All]  [Review Individually]       │
│                                              │
│ ─────────────────────────────────────────── │
│ [Add entry: Paste | Write | 🎤]    [Send]   │
└──────────────────────────────────────────────┘
    │
    ▼
Decision: Quick confirm or detailed review?
    │
    ├── [Confirm All] → POST /discussions/:id/approve { approveAll: true }
    │   → All pending items approved
    │   → Tasks + memory items created atomically
    │   → Items show ✅
    │
    └── [Review Individually] → Expand full controls per item
        │
        ├── For each item:
        │   ├── Edit title/description inline
        │   ├── Change priority, department, assignee
        │   ├── For memory items: choose layer, handle dedup
        │   │   ├── Create separate (new item)
        │   │   ├── Update existing (merge)
        │   │   └── Replace (archive old)
        │   ├── For conflict flags: resolve or dismiss
        │   ├── Mark as approved ✅ or rejected ✗
        │   └── Add dependency links between items
        │
        └── [Approve Selected] → POST /discussions/:id/approve { itemIds: [...] }
```

---

## Flow 3: Agent Panel Conversation

Founder interacts with the internal agent via right panel.

```
Founder clicks agent toggle (BreadcrumbBar) or keyboard shortcut
    │
    ▼
┌──────────────────────────┐
│ Right panel slides open   │
│                          │
│ Greeting (if first open  │
│ of session):             │
│ "Good morning TK.       │
│  2 tasks completed       │
│  overnight. 1 discussion │
│  has pending items."     │
│                          │
│ [Conversation history]   │
│                          │
│ ┌──────────────────────┐ │
│ │ Ask AoA anything... │ │
│ └──────────────────────┘ │
└──────────────────────────┘
    │
    ▼
Founder types message
    │
    ▼
POST /internal-agent/chat (SSE stream)
    │
    ▼
Panel shows streaming response:

  Agent thinking...
      │
      ▼ (tool_call event)
  "Checking your tasks..."
      │
      ▼ (tool_result event)
  "Found 3 blocked tasks"
      │
      ▼ (content events)
  "You have 3 blocked tasks:
   1. Redesign dashboard — blocked by API migration
   2. Write tests — blocked by code review
   3. Deploy staging — blocked by tests"
      │
      ▼ (done event)
  Response complete. Cost: $0.004

    │
    ▼
Decision: Does the agent need to take action?
    │
    ├── No action needed → conversation continues
    │
    └── Agent proposes action (action_confirm event):
        │
        "I can unblock 'Write tests' by assigning the code
         review to your engineering agent. Should I do that?"
        │
        [Yes, assign it]  [No, I'll handle it]
        │
        ├── Yes → POST /internal-agent/confirm { approved: true }
        │   → Agent executes: assign_task tool
        │   → "Done. Code review assigned to Ada (engineering)."
        │
        └── No → POST /internal-agent/confirm { approved: false }
            → "Got it, leaving it as-is."
```

---

## Flow 4: Content Pasted in Agent Panel → Discussion

Per Decision DA-22.

```
Founder pastes substantial content in agent panel
(e.g., a meeting transcript)
    │
    ▼
Agent detects: this is content to process, not a question
(Heuristic: content length > threshold, or contains transcript markers)
    │
    ▼
Agent calls search_discussions tool
    │
    ▼
Decision: Related discussion found?
    │
    ├── Yes → Agent responds:
    │   "This looks related to your 'Dashboard Redesign'
    │    discussion (3 entries, last updated March 20).
    │    Should I add it there, or create a new discussion?"
    │
    │   [Add to Dashboard Redesign]  [Create New]
    │   │
    │   ├── Add → Agent calls add_discussion_entry tool
    │   │   → Entry created in existing discussion
    │   │   → Extraction runs with full thread context
    │   │   → "Added to 'Dashboard Redesign'. I found 2 tasks
    │   │      and 1 decision. Review them?"
    │   │
    │   └── Create → Agent calls create_discussion tool
    │       → New discussion created
    │       → Extraction runs
    │       → "Created new discussion 'Client Follow-up'.
    │          Extracted 3 items for review."
    │
    └── No related discussion →
        Agent calls create_discussion tool
        → New discussion created
        → "Created discussion 'Untitled'. Extracted 4 items.
           Want to give it a title or link it to a project?"
```

---

## Flow 5: MCP Inbound → Discussion

External system pushes content via MCP.

```
External system (Claude CLI, integration, etc.)
    │
    ▼
POST /discussions/mcp
  { content, sourceInfo: { mcpSource, mcpClientId }, discussionId? }
    │
    ▼
Decision: discussionId provided?
    │
    ├── Yes → Add entry to existing discussion
    └── No → Create new standalone discussion
    │
    ▼
Internal agent triggered (triggerSource: 'mcp_inbound')
  - Processes entry with thread context
  - Extracts items
  - Creates internal_agent_run record
    │
    ▼
Decision: Founder currently online?
    │
    ├── Online → WebSocket push:
    │   - discussion.extraction.completed event
    │   - Inbox notification appears
    │   - Agent panel shows: "New discussion from Claude CLI"
    │
    └── Offline → Notification queued
        - Next login: morning digest includes it
        - Agent panel greeting: "I processed 2 discussions
          while you were away"
```

---

## Flow 6: Morning Digest / Context Briefing

First login of the day.

```
Founder opens AoA (first time today)
    │
    ▼
Server detects: first login today (no session activity in 8+ hours)
    │
    ▼
Internal agent proactive run triggered (triggerSource: 'morning_digest')
    │
    ▼
Agent gathers:
  - Tasks completed since last session
  - Tasks that failed or errored
  - New discussion entries with pending items
  - Budget status (any warnings)
  - Stale work (untouched for 24h+)
  - Blocked task count
  - Fired reminders since last session
    │
    ▼
Agent generates briefing message
    │
    ▼
Agent panel shows greeting:

  "Good morning TK. Since yesterday:
   - 3 tasks completed (2 by Ada, 1 by Max)
   - 1 agent error: Content writer failed on blog post task
   - 2 new discussion entries pending your review
   - Engineering budget at 72%

   Reminder: Follow up on dashboard project (set March 20)"
    │
    ▼
Founder can:
  ├── Click task/agent links → navigate to entity
  ├── Ask follow-up questions in panel
  └── Dismiss and continue to work
```

---

## Flow 7: Workflow Discovery & Instantiation

Founder describes a process, agent creates a workflow template.

```
Founder opens agent panel
    │
    ▼
Founder: "How do we usually handle a new feature?"
    │
    ▼
Agent: "Let me help you document that process.
        Walk me through the typical steps from
        start to finish."
    │
    ▼
Founder: "Usually the PM writes a spec, then design
          creates mockups, engineering implements it,
          QA tests, and then I do final review."
    │
    ▼
Agent calls create_workflow_template:
  steps: [
    { order: 1, title: "Write spec", role: "pm" },
    { order: 2, title: "Create mockups", role: "designer" },
    { order: 3, title: "Implement", role: "engineer" },
    { order: 4, title: "QA testing", role: "qa" },
    { order: 5, title: "Final review", role: "founder" }
  ]
  dependencies: [1→2, 2→3, 3→4, 4→5]
    │
    ▼
Agent: "I've created a 'Feature Development Pipeline'
        with 5 steps: Spec → Design → Code → Test → Review.
        Each step blocks the next. Want to use it now
        for a specific goal?"
    │
    ├── Yes → "Which goal?"
    │   Founder: "The dashboard redesign"
    │   Agent calls instantiate_workflow
    │   → 5 tasks created with dependencies
    │   → "Created 5 tasks for Dashboard Redesign
    │      linked to the goal. First up: Write spec."
    │
    └── No → "Saved as a template. You can use it
              anytime by asking me or from the
              workflow templates list."
```

---

## Flow 8: Reminder Creation & Firing

```
Founder in agent panel:
"Remind me to follow up on the dashboard project Friday"
    │
    ▼
Agent parses: content="Follow up on dashboard project",
              triggerAt=next Friday 9:00 AM (inferred)
Agent searches: finds "Dashboard Redesign" project
Agent calls internal tool to create reminder
    │
    ▼
Agent: "I'll remind you Friday at 9am to follow up
        on the Dashboard Redesign project. ✓"
    │
    ▼
... time passes ...
    │
    ▼
Friday 9:00 AM: Proactive scheduler fires reminder
  - triggerSource: 'reminder'
  - Creates internal_agent_run
    │
    ▼
Decision: Founder online?
    │
    ├── Online →
    │   - WebSocket event: internal_agent.reminder
    │   - Inbox notification: "Reminder: Follow up on dashboard project"
    │   - Agent panel notification (if open)
    │
    └── Offline →
        - Queued. Shows in morning digest on next login
```

---

## State Machines

### Discussion Status

```
active ──────────→ archived
  ↑                    │
  └────────────────────┘
  (can be unarchived)
```

Simple two-state. No terminal states — discussions can always be reopened.

### Discussion Entry Extraction Status

```
pending ──→ processing ──→ completed
                │              │
                ▼              ▼
            failed         (items created)
                │
                ▼
          (can retry → processing)
```

### Extracted Item Status

```
pending ──→ approved ──→ (task/memory created)
   │
   ├──→ rejected
   │
   └──→ edited ──→ approved
                      │
                      └──→ rejected
```

### Internal Agent Conversation Status

```
active ──→ archived (via reset)
```

New conversation created on reset. Old conversation preserved for context retrieval.

### Internal Agent Run Status

```
running ──→ completed
   │
   └──→ failed
```

### Reminder Status

```
pending ──→ fired
   │
   └──→ cancelled
```

---

## Key Decision Points Summary

| Flow | Decision | Who Decides | Fallback |
|------|----------|-------------|----------|
| Quick capture | New or existing thread? | Founder (modal dropdown) | Default: new |
| Inline review | Confirm all or review individually? | Founder | Both available |
| Agent action | Execute proposed action? | Founder (confirm/reject) | No action taken |
| Content in panel | Add to existing discussion or create new? | Founder (agent suggests) | Create new |
| MCP inbound | Which discussion to attach to? | System (discussionId param) | Create standalone |
| Morning digest | What to include? | Agent (automatic) | All categories |
| Workflow | Use template now? | Founder | Save for later |
| Reminder | When to fire? | Agent (parses natural language) | Ask for clarification |
