---
"aoa": patch
---

Final polish + Codex review fixes for the Teams feature (Slices 1-9 → release-ready):

**Codex P1 fixes (security/correctness):**
- Validate parentProjectId belongs to the same company before team create + import (cross-tenant isolation)
- Require board actor (not agent) for `PATCH /companies/:cid/enable-teams` toggle
- Atomic team create with members in single transaction (prevents orphan team on member-add failure)
- Preserve full manifest fields (workflowTemplates, memoryItems) during team export — fixes round-trip fidelity

**Codex P2 fixes (correctness polish):**
- Derive coordination `key` from teamId (not name slug) — eliminates same-named-team collision
- Convert duplicate addMember inserts to 409 Conflict instead of 500
- Wrap coordination upsert in db.transaction to narrow TOCTOU race window
- Convert manifest validation throws to `badRequest` HttpError (proper 400 instead of 500)
- Sanitize slug in export Content-Disposition with RFC 5987 filename* encoding
- Reject duplicate agent names in import manifest before DB collision query

**Founder decisions (Category C):**
- C4: Accept null in coordination description schema — founders can now clear an existing description
- C5: @human mention resolver now matches against email-local-part fallback (e.g. `@alice` matches `alice@example.com`) — fixes silent-miss when display names are full-name format ("Alice Smith")

**Founder escape hatch:**
- New `dismantle(teamId)` method + `DELETE /teams/:id/dismantle` endpoint — hard-deletes a team (cascades remove members + coordination via FK) but keeps agents in their department. Founders who imported the wrong team package can undo cleanly without leaving an archived shell.

**UI / org chart polish (Category B):**
- TeamDetail member list now resolves agentId → agent name (was showing UUIDs)
- Avatar letter derives from agent's first letter (was hardcoded "A")
- Breadcrumb + dismantle redirect target updated `/team` → `/org` (the actual list-page route)
- AgentsTab subtitle copy honest: "All agents in this department"
- Org chart team overlay colors keyed by hash(team.id) — stable across team add/remove (was sequential index)
- Org chart re-fits viewport on dept filter change (was leaving small depts off-screen)
- Stacking-order rationale comment added to OrgChart team-overlay layer

**Service polish:**
- Defensive notFound guard added to `regenerateAutoSections` for symmetry with archive
- `teamScaffolderService(db)` hoisted to factory time (was per-request)
- `client.ts` falls back to `body.message` for toast error surfacing (better than generic "Save failed")
