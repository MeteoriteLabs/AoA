---
"aoa": patch
---

Release v1.0.0 — first stable release.

Closes 23 validation findings from the v1.0.0-rc audit:

**Windows ship-blockers resolved:**
- Fix D — Director playbook unicode `→` replaced with `->` for postgres WIN1252 compat
- Fix J (v1 + v2) — Memory feature works without pgvector: conditional embedding
  column in SELECT projection + explicit column list in INSERT via sql template
- Fix N — Plugin worker spawns with file:// URL on Windows Node 24

**a11y fixes:**
- Fix A — TaskSlideOver SheetContent has sr-only SheetTitle + SheetDescription
- Fix T — Vision/Mission/Values pencil edit buttons have aria-labels

**Architecture simplifications:**
- API adapters removed (Decision #91): claude_api, openai_api, gemini_api no longer
  exposed via adapter registry. Agent execution is CLI-only (claude_local,
  opencode_local, openclaw, http, process, cursor, codex_local, hermes_local,
  gemini_local). Provider SDK wrappers kept as internal utility for
  extraction + embedding generation only.
- Commander defaults to CLI execution (no LLM API key required)

**Feature polish:**
- Fix L — Budget Policy creation UI
- Fix M — Budget Policy DELETE endpoint
- Fix H — Windows worktree cleanup retry sweeper
- Fix K — Workflow Templates documented as backend-ready, UI in 1.1
- Fix X — Backups tab hidden (full functionality post-1.0)
- Fix W — Instance Heartbeats scoped by company
- Fix V — Issues list server-side parentId filter
- Fix O — Skills empty-state copy clarifies built-ins come from CLI
- Fix R — Goal multi-select picker label clarity
- Fix E — Routine webhook "coming soon" hint

**Brand cleanup:**
- Fix C — PAPERCLIP banner + --help text renamed to AOA
- Fix Q — Invite token `pcp_invite_*` → `aoa_invite_*`; MCP token prefix renamed;
  plugin namespace `paperclip.*` → `aoa.*` with backward-compat aliases
- Fix G — Feedback bundle wire-format schemaVersion documented as
  intentional Paperclip-compat (see docs/telemetry.md)

**Dev/docs:**
- Fix B — `/api/companies/:cid/issues/:id` routing collision has explicit 404
- Fix F — CLAUDE.md drift corrected (`failed` status, 3-option consent modal)
- Fix I — requireBoardApprovalForNewAgents behavior documented
- Fix S — Goal completion memory-archive hook wrapped in try/catch
- Fix P — MCP auth documented: local_trusted unauth by design, cloud_auth enforces

**Known limitations (tracked for 1.1):**
- Memory semantic search requires pgvector; installs without pgvector fall back
  to keyword/ilike search. Advanced approval workflow and feedback patterns
  are beta in 1.0 pending vector DB strategy decision.
- Workflow Templates UI ships in 1.1 (backend + API ready in 1.0)
- Backup/restore feature hidden; ships in 1.1
- README.md still Paperclip-branded; full brand refresh is Phase B post-1.0
