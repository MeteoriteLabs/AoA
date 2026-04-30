---
"aoa": minor
---

Add coordination.md editor (Slice 3):

- Section-marker parser: pure functions parseCoordinationSections + replaceAutoSection (server) with client mirror in UI
- teamCoordinationService.regenerateAutoSections: replaces auto-managed sections preserving user prose
- teamScaffolderService: scaffoldInitial (full first-time markdown) + regenerateAutoContent (just auto sections)
- POST /teams/:id/coordination/regenerate route: scaffolds new or regenerates existing
- BuildFromScratchForm now triggers initial scaffolding after team create (soft-fail wrapped in try/catch — coordination errors don't poison team creation)
- CoordinationEditor: section-aware editor with auto (purple-tinted) vs user-edited (white) visual distinction, Save / Regenerate / Preview as LLM actions
- PreviewAsLlmDialog: shows verbatim markdown that gets injected into team-member system prompts
- Wired into TeamDetail's Coordination tab (replaces Slice 2's placeholder)
- 9 new parser tests + 2 new service tests = 11 new tests

All changes additive. Existing functionality unaffected for companies with enableTeams=false.
