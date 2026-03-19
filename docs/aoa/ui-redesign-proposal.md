# AoA UI Redesign Proposal

**Date:** March 17, 2026
**Status:** Draft for Discussion

---

## Current State Summary

After reviewing every page, component, and interaction pattern in the codebase and taking live screenshots, here's what we're working with:

- **Layout:** CompanyRail (72px) + Sidebar (240px) + Main content + optional Properties Panel (320px)
- **28 pages** across work management, agents, company settings, and auth
- **Dark theme** with OKLch color space, sharp corners (0px radius for lg/xl), shadcn/ui component library
- **Key actions** (New Task, Debrief) live in the sidebar top section
- **Company switching** via left-edge rail with draggable icons

---

## 1. LOBBY PAGE (Replace Company Rail + Companies Page)

### Problem
The CompanyRail takes 72px of permanent horizontal space on every single page. For a solo-founder tool that might have 1-3 companies, this is expensive real estate. The current Companies page is a settings-level concern hidden behind the rail.

### Proposal: Lobby as the Root Experience

**When user opens AoA (no company selected or navigates to `/`):**
- Show a **Lobby page** — a clean, spacious landing that shows all companies as large cards
- Each card shows: Company name, icon/color, quick stats (active tasks, agents running, budget used)
- A prominent "+ Create Company" card at the end
- Click a company card → enter that company's workspace (navigates to `/{prefix}/home`)

**Inside a company workspace:**
- **Remove CompanyRail entirely** — reclaim 72px for content
- Add a **company switcher** in the sidebar header: clicking the company name opens a dropdown/popover to switch or go back to Lobby
- Keyboard shortcut Cmd+1-9 still works for quick switching
- A small "Back to Lobby" or home icon at the very top

**Benefits:**
- Recovers 72px of width on every page (significant on laptops)
- Cleaner first impression — Lobby feels like a "home base"
- Company management (create, edit, delete) lives naturally on the Lobby page
- Reduces visual complexity of the always-visible rail

### Lobby Card Layout Concept
```
┌─────────────────────────────────────────────────────────┐
│  AoA                                        [Settings]  │
│                                                         │
│  Welcome back, TK                                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  🟢 TestCo   │  │  🔵 ClientX  │  │   + Create   │  │
│  │              │  │              │  │   Company    │  │
│  │  3 agents    │  │  5 agents    │  │              │  │
│  │  12 tasks    │  │  24 tasks    │  │              │  │
│  │  $4.20 spent │  │  $12.50 spent│  │              │  │
│  │              │  │              │  │              │  │
│  │  [Enter →]   │  │  [Enter →]   │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  Recent Activity (across all companies)                 │
│  ─────────────────────────────────────────              │
│  • TestCo: Research Bot completed task          2m ago  │
│  • ClientX: Brief ready for review             15m ago  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. HOME PAGE REDESIGN

### Problem
The current Home page is functional but feels like a status board, not a command center. The "Getting Started" onboarding is useful for new setups, but once complete, the Home becomes just action queue + goals + activity. The "New Task" and "Debrief" actions only live in the sidebar — they should be more prominent on Home.

### Proposal: Home as the Founder's Control Room

**Top section — Greeting + Quick Actions:**
```
┌─────────────────────────────────────────────────────────┐
│  Good afternoon, TK                                     │
│  2 agents working · 3 tasks need attention              │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ + New    │  │ ✏ New    │  │ 🎯 New   │              │
│  │   Task   │  │  Debrief │  │   Goal   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
```

- **Prominent quick action cards** right below the greeting (not buried in sidebar)
- Subtitle shows a live status line: "2 agents working · 3 tasks need attention" (summary of what needs the founder's eyes)

**Middle section — Action Queue (redesigned as cards, not a list):**
- Instead of a flat list of links, show categorized card groups:
  - **"Needs Review"** — Briefs awaiting review + Tasks in review (these are the founder's main job)
  - **"Blocked"** — Tasks that are blocked and need the founder to unblock
  - **"Due Today"** — Time-sensitive items
  - **"Suggestions"** — Memory items pending, goal nudges
- Each card is clickable and shows enough context to decide whether to act now

**Bottom section — Dashboard widgets (2-column grid):**
- **Active Goals** — progress bars with status (keep current, it's good)
- **Agent Activity** — who's working on what right now, with live indicators
- **Today's Activity** — recent timeline (keep current)

**Key change:** The Home should feel like opening a command dashboard. The founder should see what needs their attention, have one-click access to create/debrief, and get a pulse on their agents — all without scrolling.

---

## 3. SIDEBAR RESTRUCTURE

### Problem
The current sidebar has a lot of sections (Quick Actions, Home, Inbox, Work, Departments, Projects, Team, Company) which creates a long scrollable nav. The "COMPANY" section with 5 items (Vision & Mission, Memory, Budget, Activity, Settings) takes significant space and these are infrequently accessed settings-level pages.

### Proposal: Streamlined Sidebar

```
┌──────────────────────┐
│  TestCo          🔍  │  ← Company name (clickable → switcher dropdown)
│                      │
│  + New Task          │
│  + Debrief           │
│                      │
│  ─────────────────── │
│  🏠 Home         (3) │  ← Badge = items needing attention
│  📥 Inbox        (1) │
│                      │
│  WORK                │
│  ○ Tasks             │
│  📄 Briefs           │
│  🤖 Agents           │  ← Rename "Live Agents" → "Agents" (simpler)
│  🎯 Goals            │  ← NEW: Goals promoted to sidebar
│                      │
│  DEPARTMENTS         │
│  ├ Engineering    +  │
│  └ Marketing      +  │
│                      │
│  PROJECTS            │
│  └ Website Redesign  │
│                      │
│  ─────────────────── │
│  👥 Team             │
│  ⚙ Settings          │  ← Single "Settings" entry (opens page with tabs)
│                      │
│  📖 Docs     ☀/🌙   │
└──────────────────────┘
```

**Key changes:**
1. **Goals added to WORK section** — Goals are a core daily concept, not buried in sidebar-less navigation. Currently Goals has no sidebar entry; you can only reach it via breadcrumb or URL.
2. **"COMPANY" section collapsed into Settings** — Vision & Mission, Memory, Budget, Activity, Settings → all become tabs or sub-pages within a unified Settings page. These are rarely accessed day-to-day.
3. **"Live Agents" renamed to "Agents"** — simpler label; the live indicator (pulsing dot) already conveys when agents are active.
4. **Company name in header becomes the switcher** — click to open dropdown with company list + "Back to Lobby" option.

---

## 4. TASKS PAGE IMPROVEMENTS

### Problem
The tasks page is clean but sparse. The single-line list view doesn't show enough context at a glance. The task detail page (IssueDetail) appears to have a rendering issue (was blank when I visited). The Kanban view exists but could be more visually rich.

### Proposals:

**A. Richer List Rows:**
- Add a subtle description preview (first line, truncated) below the title
- Show labels/tags as colored pills inline
- Show dependency indicator (🔗 icon if has blocking dependencies)
- Show subtask progress if subtasks exist (e.g., "2/5 subtasks")

**B. Task Detail — Split Pane Approach:**
Instead of navigating to a full new page for task detail, consider a **split-pane or slide-over panel** (like Linear or Notion):
- Click a task in the list → task opens in a right panel (60% width) while the list stays visible on the left (40%)
- This lets founders quickly scan through multiple tasks without losing context
- Full-page view still available via "expand" button or double-click
- Properties panel integrates into the detail view rather than being a separate toggle

**C. Inline Quick Actions on Tasks:**
- Hover over a task row → show quick action buttons: change status, change assignee, change priority (without opening the detail)
- Right-click context menu for power users

**D. Task Creation — Inline Option:**
- In addition to the modal dialog, allow "inline creation" at the top of the list (like Todoist or Linear)
- Type a title, hit Enter → task created with defaults
- The modal remains for when you want to set all fields upfront

---

## 5. AGENTS PAGE IMPROVEMENTS

### Problem
The agents page shows a minimal list with status tabs. For a "Hybrid Workforce OS" where agents are central to the product, the agents page should feel more like a team management dashboard.

### Proposals:

**A. Agent Cards View (default) + List View (toggle):**
```
┌────────────────────┐  ┌────────────────────┐
│  🤖 Research Bot   │  │  🤖 Code Writer    │
│  General Researcher│  │  Engineering        │
│                    │  │                    │
│  ● Active          │  │  ○ Idle            │
│  openai_api        │  │  claude_api        │
│                    │  │                    │
│  Current: TES-1    │  │  Last run: 2h ago  │
│  "Write a summary" │  │  Trust: 87%        │
│                    │  │                    │
│  ▓▓▓▓▓░░░ 63%     │  │  5 tasks done      │
│  trust score       │  │  this week         │
│                    │  │                    │
│  [Pause] [Config]  │  │  [Wake] [Config]   │
└────────────────────┘  └────────────────────┘
```

- Cards show at-a-glance: status, current task (if working), trust score, adapter type
- Quick actions right on the card (Pause/Wake, Configure)
- Clicking the card → opens agent detail

**B. Agent Detail — Tabbed Dashboard:**
Keep the current structure but improve visual hierarchy:
- **Overview tab:** Status, current/recent task, trust score chart, quick stats
- **Runs tab:** Timeline of runs with expandable log viewer
- **Configuration tab:** All settings in organized sections
- **Activity tab:** Charts and analytics

**C. "Agent is Working" Live Indicator:**
- When an agent is actively running, show a more prominent live indicator
- Streaming output preview right on the card (last 2 lines of stdout)
- A global "Agents Working" widget in the top-right of any page (like a notification center for agent activity)

---

## 6. BRIEF/DEBRIEF FLOW IMPROVEMENTS

### Problem
The Debrief modal is functional but the flow from "paste content → processing → review brief" feels disconnected. The Brief review page is where real founder work happens but it's not prominently accessible.

### Proposals:

**A. Debrief — Expanded Input Options:**
- Keep the current Paste/Write tabs
- Add a **"Voice"** tab (V2 spec already mentions voice debrief)
- Add a **"Upload"** tab for dropping files (meeting transcripts, documents)
- Show recent debriefs below the input area for quick re-access

**B. Brief Review — Inline on Home:**
- Briefs awaiting review should be reviewable directly from the Home page action queue
- Click "3 briefs awaiting review" → expands inline showing brief summaries
- One-click approve/reject individual items without navigating away
- Full review page still available for complex briefs

**C. Debrief Processing — Stay on Page:**
- Instead of navigating to the brief page after processing, show results inline in the modal
- Let the founder review and approve right there before closing
- Reduces navigation friction

---

## 7. SETTINGS PAGE CONSOLIDATION

### Problem
Currently 5 separate pages under COMPANY (Vision & Mission, Memory, Budget, Activity, Settings). The Settings page itself appeared blank in testing. These are all "company configuration" concerns spread across the sidebar.

### Proposal: Unified Settings with Tab Navigation

```
┌─────────────────────────────────────────────────────────┐
│  Settings                                               │
│                                                         │
│  [General] [Vision & Mission] [Memory] [Budget]         │
│  [Activity] [Agents] [LLM Providers] [Integrations]    │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  (Tab content here)                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- Single sidebar entry "Settings" → opens a page with horizontal tabs
- Tabs: General, Vision & Mission, Memory, Budget, Activity, Agents, LLM Providers, Integrations
- Keeps sidebar clean while making all company config easily discoverable
- Memory and Budget could also remain as standalone pages if they're used frequently enough (your call)

---

## 8. GLOBAL UX IMPROVEMENTS

### A. Command Palette Enhancement (Cmd+K)
- Currently searches across issues, agents, projects, goals
- Add: **Quick actions** ("Create task", "New debrief", "Switch to TestCo")
- Add: **Recent pages** for quick navigation back
- Add: **Memory search** results

### B. Breadcrumb Bar → Context Bar
- Replace the simple breadcrumb with a richer context bar:
  - Left: Breadcrumbs (current)
  - Center: (empty, could show search later)
  - Right: **Live agents indicator** (e.g., "2 agents working") + **Notifications bell** + **User avatar**
- This gives a consistent place for global status without taking extra space

### C. Empty States
- The Goals, Memory, Departments, Projects pages all show basic "Nothing here" states
- Add onboarding-style illustrations and guided text explaining what each feature does
- Include "Learn more" links to documentation
- Suggest next actions (e.g., on empty Goals page: "Create your first goal to give your agents direction")

### D. Toast/Notification Improvements
- When an agent completes a task, show a richer toast with:
  - Agent name + task title
  - Quick action buttons: "Review" / "Dismiss"
- When a brief finishes processing, show a toast with "Review Brief" action

### E. Keyboard-First Navigation
- Already have good shortcuts (Cmd+K, Cmd+N, Cmd+B, Cmd+P)
- Add: `G then H` = go home, `G then T` = go to tasks, `G then A` = go to agents (vim-style "go to" shortcuts)
- Show shortcut hints in sidebar on hover

---

## 9. VISUAL DESIGN REFINEMENTS

### A. Color & Contrast
- Current design is very monochrome (almost entirely grayscale in dark mode)
- Add subtle color accents for different entity types:
  - Tasks: Blue tints
  - Agents: Green/teal tints
  - Briefs: Purple tints
  - Goals: Amber/gold tints
- This creates visual differentiation across pages

### B. Typography Hierarchy
- The current UPPERCASE section headers (HOME, TASKS, AGENTS, etc.) in the breadcrumb bar feel industrial
- Consider: Sentence case or Title Case for a warmer feel
- Add a page description subtitle under page titles for context

### C. Spacing & Density
- The current layout has generous spacing which is good for readability
- Consider a "compact mode" toggle for power users who want to see more items on screen
- Especially useful for the tasks list and agents list

---

## 10. MOBILE IMPROVEMENTS

The mobile layout already has swipe-to-open sidebar and bottom nav. Additional suggestions:

- **Bottom nav items:** Home, Tasks, Agents, Inbox, More (instead of current 5-fixed)
- **"More" opens:** Debrief, Goals, Briefs, Settings
- **Pull-to-refresh** on Home page for action queue
- **Swipe actions** on task rows (swipe right = change status, swipe left = reassign)

---

## Priority Recommendation

If I were to suggest an implementation order:

1. **Lobby Page + Remove Company Rail** — Biggest structural change, cleanest first impression
2. **Home Page Quick Actions** — Easy win, makes the core actions more accessible
3. **Sidebar Restructure** — Goals in sidebar, Settings consolidation
4. **Task Detail Split Pane** — Major UX improvement for daily workflow
5. **Agent Cards View** — Better represents the "workforce" concept
6. **Settings Consolidation** — Cleanup, reduces sidebar clutter
7. **Brief Review Improvements** — Streamlines the debrief pipeline
8. **Visual Refinements** — Polish pass across all pages
9. **Mobile Improvements** — Depends on mobile usage priority

---

## Open Questions for Discussion

1. **Memory & Budget:** Should these stay as standalone sidebar items or fold into Settings? They might be accessed frequently enough to warrant their own entry.
2. **Goals placement:** Currently no sidebar link — should it go under WORK, or should goals be visible as a summary on Home only?
3. **Agent detail:** Full page or slide-over panel? The agent config form is 53KB and quite complex.
4. **Onboarding flow:** Should the lobby handle onboarding for new companies, or keep the current wizard overlay?
5. **Properties panel:** Keep the right-side toggle panel, or integrate properties into the detail views directly?
