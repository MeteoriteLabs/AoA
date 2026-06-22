# Threads v1 — QA Test Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to run this plan task-by-task.
>
> **QA plan note:** This is a verification plan — tasks describe what to test, not what to build. Each task tests from three angles: automated tests (L1), direct API (L2), and browser UI (L3).

**Goal:** Validate all Threads v1 features (Plans 1–7) are correct end-to-end.

**Architecture under test:**
- `packages/db/src/schema/discussions.ts` + `thread_inbox_items.ts` — schema
- `server/src/services/threads.ts` — thread lifecycle service
- `server/src/routes/discussions.ts` — HTTP routes (incl. inbox ordering fix)
- `server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts` — command staff seeding
- `server/src/index.ts` — startup backfill
- `ui/src/pages/ThreadsList.tsx` — list page
- `ui/src/components/NewThreadDialog.tsx` — creation dialog
- `ui/src/pages/ThreadDetail.tsx` — detail page
- `ui/src/lib/queryKeys.ts` — canonical query keys

**App running at:** `http://localhost:5178` (Vite dev) → proxy to `http://127.0.0.1:3100` (API)

**Test layers:**
- **L1 — Unit/integration tests:** Vitest (`pnpm test --filter @armyofagents/server`)
- **L2 — API:** Direct `curl` against `http://127.0.0.1:3100`
- **L3 — UI:** Browser flows at `http://localhost:5178`

**Variables (collect once, use throughout):**
```
COMPANY_ID=057a9338-929b-4712-af26-cfa5ef43bc0e   # AoA Online
BASE=http://127.0.0.1:3100
```

---

## Pre-Task: Environment Check

- [ ] Server running: `curl -s $BASE/api/health | python3 -m json.tool` → `"status": "ok"`
- [ ] UI running: browser tab open at `http://localhost:5178/AOA/discussions`
- [ ] DB reachable: confirm `pnpm dev:server` output shows `external-postgres`

---

## Task 1 — Thread Creation & List Refresh

**What's tested:** NewThreadDialog creates a thread via `discussionsApi.create`, invalidates `queryKeys.threads.list`, and the list refreshes without a page reload.

### L1 — Unit tests
- [ ] Run: `pnpm test --filter @armyofagents/server -- --grep "threads"`
- [ ] Expect: all passing (no thread-list query-key mismatch tests)

### L2 — API
```bash
# Create a thread
curl -s -X POST "$BASE/api/companies/$COMPANY_ID/discussions" \
  -H "Content-Type: application/json" \
  -d '{"title":"L2 Test Thread"}' | python3 -m json.tool

# Verify it appears in list
curl -s "$BASE/api/companies/$COMPANY_ID/discussions?kind=thread" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print([x['title'] for x in d])"
```
- [ ] Creation returns `{"id": "...", "title": "L2 Test Thread", ...}` (2xx)
- [ ] List includes "L2 Test Thread"

### L3 — UI
- [ ] Open `http://localhost:5178/AOA/discussions`
- [ ] Note current thread count ("All N")
- [ ] Click "+ New Thread"
- [ ] Dialog opens, centered, autofocus on Title field
- [ ] Type a title; click "Create Thread"
- [ ] Toast "Thread created" appears at bottom
- [ ] List immediately shows +1 thread without page reload
- [ ] New thread appears at top of list

---

## Task 2 — New Thread Dialog — All Type Chips

**What's tested:** All 5 type chips (Idea/Discussion/Goal/Transcript/Document) are selectable; Goal type shows extra fields; non-Goal types don't show extra fields.

### L2 — API
```bash
# Create one of each type (all map to discussions table)
for TYPE in idea discussion transcript document; do
  curl -s -X POST "$BASE/api/companies/$COMPANY_ID/discussions" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Type test: $TYPE\"}" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('title','error'))"
done
```
- [ ] Each returns 200 with the correct title

### L3 — UI
- [ ] Open "+ New Thread" dialog
- [ ] Click each chip: Idea → Discussion → Goal → Transcript → Document
- [ ] Non-Goal: only Title + Description fields visible (no "Goal Level" or "Projects" section)
- [ ] Goal chip: "Goal Level" selector (company/team/agent/task) appears
- [ ] Goal chip: "Projects (required)" list appears
- [ ] Selecting a project chip highlights it
- [ ] Submit with Goal type and a project selected — no error

---

## Task 3 — Inbox Route (POST-fix verification)

**What's tested:** The `/discussions/inbox` route is no longer shadowed by `/:discussionId`. Returns `{items:[], total:0}` not 500.

### L2 — API
```bash
# Must return 200 with items array, NOT 500 with "SELECT ... WHERE id='inbox'"
curl -s -w "\nHTTP %{http_code}" \
  "$BASE/api/companies/$COMPANY_ID/discussions/inbox"
```
- [ ] Response body: `{"items":[...],"total":N}` (not an error message)
- [ ] HTTP status: `200`

### L3 — UI
- [ ] Reload `http://localhost:5178/AOA/discussions`
- [ ] No error toast or blank page
- [ ] Thread list loads with correct count

---

## Task 4 — Thread Detail Navigation

**What's tested:** Clicking a thread row navigates to `/AOA/discussions/:id`, renders ThreadDetail with phase pipeline and message composer.

### L2 — API
```bash
# Get a thread ID from list
THREAD_ID=$(curl -s "$BASE/api/companies/$COMPANY_ID/discussions" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])")

# Fetch thread detail
curl -s "$BASE/api/companies/$COMPANY_ID/discussions/$THREAD_ID" | python3 -m json.tool
```
- [ ] Returns thread object with `id`, `title`, `phase`, `status` fields

### L3 — UI
- [ ] Click any thread row in the list
- [ ] URL changes to `/AOA/discussions/<uuid>`
- [ ] Page title (browser tab) shows thread name
- [ ] Breadcrumb shows "Discussions › <thread title>"
- [ ] Thread title rendered as `<h1>` or `<h2>`
- [ ] Phase pills visible: **Discuss** (active/blue), Scope, Assign, Done
- [ ] "@mention someone..." input visible
- [ ] "Thread" and "Scope" tabs visible
- [ ] "Write a message..." composer at bottom
- [ ] Right panel shows "Select an item to preview it here."
- [ ] Status shows "Unclaimed" + "Claim" button

---

## Task 5 — Thread Phase Advancement

**What's tested:** Clicking a phase pill advances the thread and persists to DB.

### L2 — API
```bash
THREAD_ID=<use id from Task 4>

# Advance to Scope phase
curl -s -X PATCH "$BASE/api/companies/$COMPANY_ID/discussions/$THREAD_ID" \
  -H "Content-Type: application/json" \
  -d '{"phase":"scope"}' | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('phase'))"

# Verify phase persisted
curl -s "$BASE/api/companies/$COMPANY_ID/discussions/$THREAD_ID" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('phase'))"
```
- [ ] PATCH returns `"scope"` for phase
- [ ] Follow-up GET confirms `phase: "scope"` persisted

### L3 — UI
- [ ] In a thread detail, click "Scope" phase pill
- [ ] "Scope" pill becomes active (highlighted)
- [ ] "Discuss" pill is no longer active
- [ ] Reload page — phase still shows "Scope"

---

## Task 6 — Message Composer (Thread Entry)

**What's tested:** Posting a message in a thread creates a `discussion_entries` row; entry appears in the thread feed.

### L2 — API
```bash
THREAD_ID=<use id from previous tasks>

curl -s -X POST "$BASE/api/companies/$COMPANY_ID/discussions/$THREAD_ID/entries" \
  -H "Content-Type: application/json" \
  -d '{"rawContent":"Hello from L2 test","inputType":"write"}' | python3 -m json.tool

# Confirm entry appears in entries list
curl -s "$BASE/api/companies/$COMPANY_ID/discussions/$THREAD_ID/entries" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print([e['rawContent'] for e in d.get('entries',d)])"
```
- [ ] POST returns entry object with `id`, `rawContent`, `inputType: "write"`
- [ ] List includes "Hello from L2 test"

### L3 — UI
- [ ] Open a thread detail
- [ ] Click "Write a message..." composer
- [ ] Type "QA test message"
- [ ] Click Submit
- [ ] Message appears in thread feed immediately
- [ ] Entry count on the list page row increments

---

## Task 7 — Commander Team — All 6 AoA Agents

**What's tested:** All 6 AoA agents (Commander, Scribe, Router, Planner, Dispatcher, Memory Keeper) exist per company and are shown on the Commander Team tab.

### L1 — Unit tests
- [ ] Run: `pnpm test --filter @armyofagents/server -- --grep "command.staff|ensure-command"`
- [ ] Expect: all passing

### L2 — API
```bash
curl -s "$BASE/api/companies/$COMPANY_ID/agents?kind=aoa" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); names=[a['name'] for a in d]; print(sorted(names))"
```
- [ ] Output contains exactly: `['Commander', 'Dispatcher', 'Memory Keeper', 'Planner', 'Router', 'Scribe']`
- [ ] `adapterType` for Commander is `claude_local`
- [ ] `adapterType` for the other 5 is `process`
- [ ] `runtimeConfig.aoa.role` for Commander is `lead`, rest are `member`

### L3 — UI
- [ ] Navigate to `http://localhost:5178/AOA/team?tab=commander`
- [ ] Heading shows "Commander Team 6"
- [ ] 6 cards visible: Scribe, Router, Planner, Dispatcher, Commander, Memory Keeper
- [ ] Commander card shows "Lead" badge and `claude_local` adapter label
- [ ] All others show "Member" + `process`
- [ ] All show status "idle"

---

## Task 8 — Startup Command Staff Backfill (Idempotency)

**What's tested:** `ensureCommandStaff` in `index.ts` startup backfill is safe to run multiple times (ON CONFLICT DO NOTHING).

### L2 — API
```bash
# Count agents before restart
BEFORE=$(curl -s "$BASE/api/companies/$COMPANY_ID/agents?kind=aoa" | \
  python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "Before: $BEFORE"

# Restart server (kills and restarts in a new terminal or background)
# After restart, count again
AFTER=$(curl -s "$BASE/api/companies/$COMPANY_ID/agents?kind=aoa" | \
  python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "After restart: $AFTER"
```
- [ ] `BEFORE` equals `AFTER` (no duplicate agents created on restart)
- [ ] Server logs show no "command staff backfill failed" warnings

---

## Task 9 — Thread Claim / Unclaim

**What's tested:** A user can claim a thread (takes ownership); unclaim releases it.

### L2 — API
```bash
THREAD_ID=<use id from previous tasks>

# Claim
curl -s -X POST "$BASE/api/companies/$COMPANY_ID/discussions/$THREAD_ID/claim" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ownerId') or d.get('claimedBy') or d)"

# Unclaim
curl -s -X DELETE "$BASE/api/companies/$COMPANY_ID/discussions/$THREAD_ID/claim" \
  -w "\nHTTP %{http_code}"
```
- [ ] POST /claim returns 200 with updated thread (ownerId set)
- [ ] DELETE /claim returns 200 and releases ownership

### L3 — UI
- [ ] In thread detail, click "Claim" button
- [ ] Button changes to "Unclaim" (or shows your name)
- [ ] Status badge updates from "Unclaimed"
- [ ] Clicking "Unclaim" returns to "Unclaimed" state

---

## Task 10 — Thread Search

**What's tested:** Search box on ThreadsList filters threads by title.

### L3 — UI
- [ ] Navigate to `http://localhost:5178/AOA/discussions`
- [ ] Click the search box
- [ ] Type "QA" — only threads with "QA" in the title are shown
- [ ] Clear search — all threads return
- [ ] Type a string that matches no thread — empty state shown (or 0 results)

---

## Task 11 — Phase Filter Tabs

**What's tested:** Phase filter tabs (All/Discuss/Scope/Assign/Done) filter the thread list correctly.

### L3 — UI
- [ ] Navigate to `http://localhost:5178/AOA/discussions`
- [ ] Click "Discuss" tab — only threads in Discuss phase shown
- [ ] Click "Scope" tab — only threads in Scope phase shown (may be 0)
- [ ] Click "All" tab — all threads return
- [ ] Count badge on "All" equals total thread count

---

## Task 12 — Real-time Presence Indicator

**What's tested:** Opening a thread records presence; presence count shows correctly.

### L3 — UI
- [ ] Open a thread detail in tab A
- [ ] Presence indicator shows "1 person here" (or similar)
- [ ] Open the same thread URL in tab B
- [ ] Tab A's presence indicator updates to "2 people here"
- [ ] Close tab B — count returns to 1 within ~10s

---

## Task 13 — Query Key Consistency

**What's tested:** `queryKeys.threads.list` / `.detail` / `.inbox` are used consistently across ThreadsList, NewThreadDialog, and ThreadDetail — no stale cache after mutations.

### L1 — Code audit
- [ ] Run: `grep -rn "\"threads\"" ui/src/` — should only appear in `queryKeys.ts` definition
- [ ] Run: `grep -rn "threads-inbox" ui/src/` — should only appear in `queryKeys.ts` definition
- [ ] Run: `grep -rn "queryKeys.threads" ui/src/` — should appear in ThreadsList, NewThreadDialog, and any inbox consumer

### L3 — UI (mutation → cache invalidation)
- [ ] Open two tabs at `http://localhost:5178/AOA/discussions`
- [ ] In tab A, create a new thread
- [ ] Refresh tab B — new thread appears
- [ ] In tab A, the list updates without manual refresh

---

## Task 14 — Goal-type Thread Creates a Goal

**What's tested:** Selecting "Goal" type in NewThreadDialog calls `threadsApi.promoteToGoal` after creating the discussion.

### L2 — API
```bash
# Create discussion
DISC_ID=$(curl -s -X POST "$BASE/api/companies/$COMPANY_ID/discussions" \
  -H "Content-Type: application/json" \
  -d '{"title":"Goal from L2"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Promote to goal (same flow as Goal type in dialog)
curl -s -X POST "$BASE/api/companies/$COMPANY_ID/threads/$DISC_ID/promote-to-goal" \
  -H "Content-Type: application/json" \
  -d '{"level":"team","projectIds":[]}' | python3 -m json.tool
```
- [ ] Returns promoted thread/goal object with goal fields
- [ ] `GET /api/companies/$COMPANY_ID/goals` includes the new goal

### L3 — UI
- [ ] Open "+ New Thread", select "Goal" type
- [ ] Select "team" level, select one project
- [ ] Click "Create Thread"
- [ ] Thread appears in list
- [ ] Navigate to Objectives — the goal is listed there

---

## Summary Checklist

| # | Test Area | L1 | L2 | L3 |
|---|-----------|----|----|-----|
| 1 | Thread creation & list refresh | ✓ | ✓ | ✓ |
| 2 | New Thread dialog — all type chips | — | ✓ | ✓ |
| 3 | Inbox route (no more 500) | — | ✓ | ✓ |
| 4 | Thread detail navigation | — | ✓ | ✓ |
| 5 | Phase advancement | — | ✓ | ✓ |
| 6 | Message composer | — | ✓ | ✓ |
| 7 | Commander Team — all 6 agents | ✓ | ✓ | ✓ |
| 8 | Startup backfill idempotency | — | ✓ | — |
| 9 | Claim / Unclaim | — | ✓ | ✓ |
| 10 | Thread search | — | — | ✓ |
| 11 | Phase filter tabs | — | — | ✓ |
| 12 | Real-time presence | — | — | ✓ |
| 13 | Query key consistency | ✓ | — | ✓ |
| 14 | Goal-type thread → goal | — | ✓ | ✓ |
