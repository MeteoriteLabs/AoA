# Threads — Daily Interaction Cases (UX stress-test set)

> Generated to stress-test the Threads design (see DESIGN.md). Pick cases to trace through the design; each names the primitives it exercises.

## A. Meetings & Transcripts
1. **Monday standup (voice → transcript)** — Transcript (Fireflies/MCP) · Alignment+Retro · All depts. Auto-records → Router auto-attaches to recurring "Standup" thread or Unlisted; Scribe extracts per-person updates + blockers + commitments fanning to multiple depts; recurring thread reopens to Discuss weekly (stale dot).
2. **Face-to-face whiteboard session (paste)** — Transcript (paste) · Planning · Product. Messy bullet notes pasted; Scribe runs office-hours interrogation before extracting; founder confirms which bullets → pre-tasks vs memory vs nothing.
3. **Customer discovery call (Otter)** — Transcript (Otter/MCP) · Research+Feedback · Product/Sales. Extracts pain points (→ domain memory), a feature request (→ pre-task), a competitor mention (→ reference). Routes to two depts; memory queued for approval.
4. **Sprint retro (becomes recurring template)** — Transcript (paste) · Retrospective · Engineering. Commander suggests Retro template; extracts process improvements (domain memory) + action items that become dependencies of next sprint's planning thread.

## B. Inbound & Integrations
5. **WhatsApp founder group (always-open Live thread)** — Integration (WhatsApp) · Decision+Alignment · Cross-dept. Messages stream as entries; continuous extraction surfaces a decision from chat noise; bypasses Unlisted; never Resolved (Pause/Disconnect only).
6. **Slack #bugs channel (Live → eng work)** — Integration (Slack) · Problem · Engineering. Stack trace posted → Live thread → Scribe drafts a pre-task → real task; renders code/log block.
7. **Ambiguous MCP dump needing triage** — MCP · undetermined · Unknown. Analytics tool POSTs "churn spike" JSON, no destination; Router <40% → stays in Unlisted; human uses Make thread / Add to ▾ / Dismiss; renders raw JSON.
8. **Mid-confidence inbound (Router suggests)** — MCP (via Priya) · Feedback · Growth. A/B test webhook; Router 40–80% → Unlisted with one-tap "Add to Q3 Activation?"; provenance note on accept; attaches to a goal-thread.
9. **Voice memo on the go** — Voice · Idea · Ops. 90-sec memo → Whisper → Scribe splits into two unrelated pre-tasks; audio playback; narrow-width rendering.

## C. Goals & Planning
10. **New company goal with sub-goals (Graph lens)** — Goal · Planning · Cross-dept. "$20k MRR by Q3" goal-thread (level=company, projects required); Planner proposes 3 sub-goals each a thread; layered phase + goal-status chip; Graph lens shows the goal→sub-goal→thread web.
11. **Sprint planning (goal → plan → assign to people + agents)** — Goal/Idea · Planning · Engineering. L2 autonomy; Scribe extracts → Planner sequences STEP 1/2/3 (Scope State 2) → Dispatcher matches to dev agent + a human; pre-task → Task form in viewer.
12. **A discussion that becomes a goal mid-stream** — Idea→Goal · Planning · Growth. Casual "newsletter?" idea grows into a multi-month initiative; founder promotes thread to a goal (⚑ chip appears, no data loss); Continue/Fork/Link if sub-initiatives spin off.
13. **Research brief (Research agent → artifacts)** — Idea · Research · Product. "Evaluate auth providers"; Scribe delegates to Research worker agent which posts comparison doc + pricing table artifacts; Viewer renders markdown; decision pre-task ("pick Clerk") gated on founder.

## D. Agent-driven & Coordination
14. **Commander-initiated proactive thread** — Agent (Curator) · Problem · Finance. Curator scan finds budget at 90% w/ 10 days left → opens a thread itself; agent-as-origin (no human seed); silent badge; Scribe-drafted decision pre-task awaits founder.
15. **Worker agent stalls → opens a thread (blocked task → thread)** — Agent (worker) · Problem · Engineering. Dev agent hits spec ambiguity, spins a thread back to ask; task→thread reverse handoff w/ back-link; founder's answer flows back to unblock the task.
16. **Daily proactive digest → multiple threads** — Routine · Alignment · Cross-dept. 8am routine runs proactive checks; findings auto-attach (>80%) or land in Unlisted; one run fans into multiple threads + Unlisted items; no toast storm.
17. **Memory conflict surfaced by Memory Keeper** — Agent (Memory Keeper) · Decision · Ops/Brand. Two domain memory candidates conflict (2h vs 24h SLA) after ≥3-occurrence; opens a thread for adjudication; founder-gated; resolution writes winning memory.

## E. Cross-Department Hand-offs
18. **Sales feature commitment → product + eng** — Idea (sales call) · Decision · Sales→Product→Eng. "Promised SSO by month-end"; decision + pre-tasks hand off (spec→build) across dept agents with a dependency link; dept vs company scoping.
19. **Design → Dev pipeline with live preview** — Idea · Planning · Design→Eng. "Redesign pricing page"; Design agent produces Figma embed + HTML mock on a live dev-server port; Browser viewer + Compare vN; artifact-as-input to downstream dev task.
20. **Hiring loop coordination** — Document (resume/scorecards) · Decision+Feedback · Hiring. Resume PDF seeds thread; interviewers post scorecards (nested replies) → hire/no-hire decision; Private visibility; PDF rendered in Viewer.

## F. Edge / Stress Cases
21. **Conflicting decisions across two extraction runs** — Transcript (paste, re-run) · Decision · Finance. Re-extraction produces a decision contradicting the first ($29 vs $39); Scope is status-based/always-current (add+dedupe); conflict flagged; orange stale dot.
22. **Two related threads that should merge / link** — Idea ×2 · Planning · Growth. Duplicate "Product Hunt launch" threads; @[Thread] reference creates bidirectional link; Router suggests merge (pick canonical → other archives, entries interleaved); Link vs Fork vs Continue.
