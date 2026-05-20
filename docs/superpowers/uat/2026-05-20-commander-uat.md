# Commander UAT Checklist

**Date:** 2026-05-20
**Branch:** commander-subagent-1
**Covers:** Sprints 1–4 (original plan) + Phase 2 (confirmation flow, actor type, permissions UI, conversation switching)

## Setup

1. Start dev server: `pnpm dev`
2. Open browser at `http://localhost:3000`
3. Log in / ensure you have a company with Commander configured
4. Navigate to Commander page

---

## Section A: Sessions Sidebar (Sprint 3)

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| A1 | Open Commander page | Sessions sidebar visible on left, "Sessions" header + "New chat" button | |
| A2 | Click "New chat" button | New session appears at top of list; chat area clears | |
| A3 | Send a message in the new chat | Session updates in sidebar with message count | |
| A4 | Hover over a session row | Archive button (box-arrow icon) appears on the right | |
| A5 | Click archive on a session | Session disappears from list | |
| A6 | Click collapse chevron (left arrow) | Sidebar collapses to 36px strip; only expand chevron visible | |
| A7 | Click expand chevron | Sidebar expands back to full width with session list | |
| A8 | Click a different session in the sidebar | Chat area loads that session's message history | |
| A9 | Type and send a message in the loaded session | Message appended to the loaded session's history | |

---

## Section B: Toolbar (Sprint 4)

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| B1 | Look at the message input area | Toolbar row with Attach, Skills, Mention, Voice buttons visible above send | |
| B2 | Click each toolbar button | No action — buttons are disabled (visually muted, no pointer events) | |

---

## Section C: Action Confirmation Gate (Sprints 1–2)

These require Commander to emit a CONFIRM marker. Trigger by asking Commander to perform identity changes.

| # | Prompt to type | Expected | Pass? |
|---|---------------|----------|-------|
| C1 | "Update our company vision to: We are building the future of work." | Amber confirmation card appears in chat — shows tool name `update_company_identity` + params | |
| C2 | Click "Confirm" on the confirmation card | Card status changes to "Confirmed"; Commander receives the result and continues conversation | |
| C3 | Ask Commander again: "Change our mission to: Empower founding teams with AI." | Amber confirmation card appears again | |
| C4 | Click "Cancel" on the card | Card status changes to "Cancelled"; tool not executed; Commander notes the cancellation | |
| C5 | Verify: after C2, go to Settings > Company — check if vision actually updated | Vision field in company settings shows the new value | |

---

## Section D: Options Prompt (Sprint 2)

| # | Prompt to type | Expected | Pass? |
|---|---------------|----------|-------|
| D1 | "What should I focus on today — tasks, goals, or discussions?" | Commander responds with clickable option chips (not plain text) | |
| D2 | Click one of the option chips | That option text is sent as a message; Commander responds to the selection | |

---

## Section E: AoA Native Skills + use_skill (Sprint 4)

| # | Prompt to type | Expected | Pass? |
|---|---------------|----------|-------|
| E1 | "Help me brainstorm product ideas" | Commander invokes `use_skill` with `key: "skill:aoa/brainstorm"` (visible in tool call indicator) | |
| E2 | "Help me set up company identity" | Commander invokes `use_skill` with identity-setup skill | |

---

## Section F: Permissions UI (Phase 2)

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| F1 | Navigate to Settings > Commander | Commander settings page loads | |
| F2 | Click "Permissions" sub-tab | Permissions tab content renders — table with tool names, Enabled checkboxes, Confirm checkboxes, Min Role dropdowns | |
| F3 | Uncheck "Enabled" for `update_company_identity` | Checkbox unchecks | |
| F4 | Click "Save permissions" | Success message: "Permissions saved." | |
| F5 | Go to Commander, ask: "Update our vision to X" | Commander should now report the tool is disabled | |
| F6 | Go back to Settings > Permissions, re-enable `update_company_identity` | Checkbox checks; save works | |
| F7 | Change `update_company_identity` minimumRole to "Founder" | Dropdown selects Founder | |
| F8 | Save — then ask Commander to update identity | Tool executes normally (you are a founder) | |

---

## Section G: Conversation Switching (Phase 2 — full round-trip)

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| G1 | Create two new conversations (New chat × 2) | Two sessions visible in sidebar | |
| G2 | In Session 1: send "What are my current tasks?" | Commander responds; message visible | |
| G3 | In Session 2: send "What are my current goals?" | Commander responds; message visible | |
| G4 | Click Session 1 in the sidebar | Chat area loads Session 1's history — shows "What are my current tasks?" + response | |
| G5 | Click Session 2 in the sidebar | Chat area loads Session 2's history — shows "What are my current goals?" + response | |
| G6 | Send a new message while Session 1 is active | New message appended to Session 1's history; Session 2 history unchanged | |

---

## Section H: Role Enforcement (Phase 2)

_(Requires a second test user with team_member role)_

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| H1 | Log in as team_member user | — | |
| H2 | Open Commander | — | |
| H3 | Ask: "Update our company vision to X" | Commander should report: tool requires founder role; action blocked | |
| H4 | Log back in as founder | — | |
| H5 | Same prompt | Confirmation card appears as normal | |

---

## Section I: Edge Cases

| # | Scenario | Expected | Pass? |
|---|----------|----------|-------|
| I1 | Reload the page while a confirmation card is pending | On reload, the pending confirmation is gone (in-memory, not persisted — expected behavior) | |
| I2 | Open Commander on mobile-width screen (< 768px) | Sidebar collapses automatically; chat takes full width | |
| I3 | Archive all sessions | Sidebar shows "No sessions yet"; chat area shows empty state | |
| I4 | Create a new chat after archiving all | New session appears; chat area is fresh | |

---

## Sign-Off

| Section | Tester | Date | Notes |
|---------|--------|------|-------|
| A (Sidebar) | | | |
| B (Toolbar) | | | |
| C (Confirmation gate) | | | |
| D (Options prompt) | | | |
| E (Skills) | | | |
| F (Permissions UI) | | | |
| G (Conversation switching) | | | |
| H (Role enforcement) | | | |
| I (Edge cases) | | | |
