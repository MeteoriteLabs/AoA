---
"aoa": minor
---

Add teams architecture UI (Slice 2):

- TeamCard: presentational team summary using ClickableDiv (no nested buttons), no human-style avatars
- TeamsSection: lists teams with parallel useQueries member fetches, "+ New team" dropdown trigger with 3 options (Build / Import / Marketplace-soon)
- NewTeamEntryDialog: 3-option chooser with initialMode bypass routing to BuildFromScratchForm or ImportUploadDialog
- BuildFromScratchForm: full create form with mixed agent picker (existing + inline new), Convention C-6 enforced (assignAgent before addMember)
- MemberRow: row component with role selector + inline new-agent fields (adapter, skills)
- ImportUploadDialog: stub for Slice 8
- AgentsTab integration: TeamsSection at top, existing content relabeled as "Individual agents"
- TeamDetail page at `/team/teams/:slug`: header + 4 tabs (Overview active, others slice-deferred), members list with lead distinction
- Bug fix: createAgentSchema now includes skillKeys (was silently dropped server-side)

All UI builds on Slice 1 foundation. Feature flag (companies.enableTeams) still gates runtime behavior in Slices 6+7.
