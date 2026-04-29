---
"aoa": minor
---

Add org chart team overlay + department filter (Slice 4):

- `computeTeamBoxes` pure function in `ui/src/components/team/teamBoundingBox.ts` — derives axis-aligned bounding rectangles from positioned org-chart nodes given a teams list with members
- `TeamOrgOverlay` render component in `ui/src/components/team/TeamOrgOverlay.tsx` — absolute-positioned divs with translucent fill + dashed border + label, rendered behind nodes (z-index ordering)
- `OrgChart.tsx` wiring — fetches teams + members + projects + dept-agents via React Query (`useQueries`), computes team boxes, renders `<TeamOrgOverlay boxes={teamBoxes} />` first in the card-transform layer, adds department filter `<Select>` dropdown in toolbar (top-3 left-3) with ancestor-preserving prune for `filteredOrgTree`
- 8 new tests (5 in `__tests__/teamBoundingBox.test.ts` + 3 in `__tests__/TeamOrgOverlay.test.tsx`)

All changes additive. Existing functionality unaffected for companies with enableTeams=false.
