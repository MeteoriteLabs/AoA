# V1 Branch, Merge & PR Strategy

## Final State (updated 2026-03-13)

V1 development is **complete**. All 8 phases (39 commits) are on `v1/phase-8`, ready to merge to `main`.

```
bb83917  Initial commit                                          ← origin/main
│
682b6a6  Session 1.0: Add source, reviewerUserId, dueDate       ← main
│
2a7ccd4  Session 1.1: Add type field to projects table
│
1633d3e  Session 1.2: Support type filter in project service
│
6dde3e6  Session 1.3: Rename Issues → Tasks in UI
│
e1bdf33  Session 1.4: Rename Dashboard/Costs/Org, reorganize sidebar
│
996160f  Session 1.5: Wire project type through dialog           ← v1/phase-1
│
├── 00359ff  Session 2.1: Add vision, mission, values to companies
│   │
│   8341af3  Session 2.2: Add Vision & Mission page
│   │
│   c2b8ccf  Session 2.3: Enforce department/project parentage for goals
│   │
│   1878f9b  Session 2.4: Add Goals tab to dept/project detail   ← v1/phase-2 (before Merge A)
│   │
│   341f5ee  Merge Point A: Phase 3 (Memory) into Phase 2        ← v1/phase-2 (after Merge A)
│   │
│   0d8d2f4  Session 4.1: Add debrief, brief, brief_items schemas
│   98167c1  Session 4.2: Add debrief service and routes
│   a4a24d1  Session 4.3: Add LLM extraction service
│   dc847f8  Session 4.4: Add brief service and routes
│   131d509  Session 4.5/4.6: Debrief modal + Brief review UI
│   e321b25  Session 4.7: Briefs list page                       ← v1/phase-4
│   │
│   dfc6a24  Session 5.1: MCP inbound endpoint
│   │
│   258c295  Session 6.1: Home data endpoint
│   4f2d8d0  Session 6.2: Home screen layout
│   036c609  Session 6.3: Onboarding flow                        ← v1/phase-6 (before Merge C)
│   │
│   9f7421a  Merge Point C: Phase 7 (Dependencies) into Phase 6  ← v1/phase-6 (after Merge C)
│   │
│   62028c2  Session 8.1: Budget alerts + goal gap nudges
│   ce2bdaf  Session 8.4: Briefs in Inbox + sidebar badges
│   cb4c7b4  Session 8.5: Dependency context for agents
│   6559dd1  Session 8.6: End-to-end testing + quality fixes
│   51c1d35  V1 review: cursor-local types, express.d.ts, mcpDebriefSchema
│   0f0d38e  V1 review: naming, goal status machine, dep validation
│   ecc4656  Fix Windows path bug — use fileURLToPath
│   52661af  Fix sidebar routing, debrief submit, activity log
│   95ba11d  Fix activity log text in Dashboard and IssueDetail   ← v1/phase-8 (HEAD)
│
└── a7b1a3e  Session 3.1: Add memory_items table schema
    001e8d4  Session 3.2: Memory service and routes
    a73e194  Session 3.3: Memory page UI
    cba0192  Session 3.4: Agent context enrichment                ← v1/phase-3
        │
        └──→ merged into v1/phase-2 at Merge Point A

    158722d  Session 7.1: task_dependencies table
    1a06148  Session 7.2: Dependencies service
    21804ba  Session 7.3: Hook into issue status transitions
    b332017  Session 7.4: Dependencies UI                         ← v1/phase-7
        │
        └──→ merged into v1/phase-6 at Merge Point C
```

### Branch status

| Branch | HEAD Commit | Sessions | Status |
|--------|-------------|----------|--------|
| `main` | `682b6a6` | 1.0 | Base (awaiting final merge) |
| `v1/phase-1` | `996160f` | 1.0–1.5 | ✅ Complete |
| `v1/phase-2` | `341f5ee` | 2.1–2.4 + Merge A | ✅ Complete |
| `v1/phase-3` | `cba0192` | 3.1–3.4 | ✅ Complete (merged at Point A) |
| `v1/phase-4` | `e321b25` | 4.1–4.7 + 5.1 | ✅ Complete |
| `v1/phase-6` | `9f7421a` | 6.1–6.3 + Merge C | ✅ Complete |
| `v1/phase-7` | `b332017` | 7.1–7.4 | ✅ Complete (merged at Point C) |
| `v1/phase-8` | `95ba11d` | 8.1–8.6 + review fixes | ✅ Complete — ready to merge |

### Commit summary

| Category | Count |
|----------|-------|
| Session commits (1.0–8.6) | 31 |
| Merge point commits (A + C) | 2 |
| Review + fix commits | 6 |
| **Total** | **39** |

## Executed Structure

```
main ─────────────────────────────────────────────────────────────────── PR ◄── FINAL MERGE
  │                                                                       ▲
  │                                                                       │
  └── v1/phase-1 (Sessions 1.0–1.5) ✅                                   │
        │                                                                 │
        ├── v1/phase-2 (Sessions 2.1–2.4) ✅                              │
        │     │                                                           │
        │     ◄──── MERGE POINT A ────── v1/phase-3                       │
        │     │     341f5ee              (Sessions 3.1–3.4) ✅            │
        │     │                                                           │
        │     └── v1/phase-4 (Sessions 4.1–4.7 + 5.1) ✅                 │
        │           │                                                     │
        │           └── v1/phase-6 (Sessions 6.1–6.3) ✅                  │
        │                 │                                               │
        │                 ◄──── MERGE POINT C ──── v1/phase-7             │
        │                 │     9f7421a            (Sessions 7.1–7.4) ✅  │
        │                 │                                               │
        │                 └── v1/phase-8 (8.1–8.6 + review fixes) ✅     │
        │                       │                                         │
        │                       └─────────────────────────────────────────┘
        │
        └── v1/phase-7 (Sessions 7.1–7.4) ✅ ← parallel, merged at Point C
```

## Timeline (Actual)

```
           Phase 1 (6 sessions) ✅
              │
           Phase 2 ──┐ ✅
           Phase 3 ──┤ ✅ (parallel tracks)
           Phase 7 ──┘ ✅
              │
           MERGE POINT A: phase-3 → phase-2 (341f5ee) ✅
              │
           Phase 4 (7 sessions on merged branch) ✅
              │
           Phase 5 (1 session, on phase-4 branch) ✅
              │
           Phase 6 (3 sessions) ✅
              │
           MERGE POINT C: phase-7 → phase-6 (9f7421a) ✅
              │
           Phase 8 (6 sessions + review fixes) ✅
              │
           FINAL: merge v1/phase-8 → main → PR ← YOU ARE HERE
```

## Merge Commands

### Merge Point A ✅ Done
```bash
git checkout v1/phase-2
git merge v1/phase-3 --no-ff -m "Merge Point A: Phase 3 (Memory) into Phase 2 (Goals)"
git checkout -b v1/phase-4
```

### Merge Point C ✅ Done
```bash
git checkout v1/phase-6
git merge v1/phase-7 --no-ff -m "Merge Point C: Phase 7 (Dependencies) into Phase 6"
git checkout -b v1/phase-8
```

### Final Merge (next step)
```bash
git checkout main
git merge v1/phase-8 --no-ff -m "V1: The Operating System"
git push origin main
```

## What each branch contains

| Branch | Contains |
|--------|----------|
| `v1/phase-1` | Phase 1 |
| `v1/phase-2` | Phase 1 + 2 + 3 (after Merge A) |
| `v1/phase-3` | Phase 1 + 3 |
| `v1/phase-7` | Phase 1 + 7 |
| `v1/phase-4` | Phase 1 + 2 + 3 + 4 + 5 |
| `v1/phase-6` | Phase 1 + 2 + 3 + 4 + 5 + 6 + 7 (after Merge C) |
| `v1/phase-8` | Everything (Phase 1–8 + review fixes) |
| `main` | Everything after final merge |

## PRs

Only **one PR** at the end: `v1/phase-8 → main` after all phases complete.
Everything else is local merges.
