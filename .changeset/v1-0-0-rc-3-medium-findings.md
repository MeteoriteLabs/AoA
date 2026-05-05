---
"aoa": patch
---

Medium-severity findings + cleanup for v1.0.0-rc.3:

- New periodic sweeper retries `rm -rf` on execution workspaces stuck in `cleanup_failed` more than 60s after close, promoting them to `archived` on success. Addresses Windows file-lock races where agent heartbeat subprocesses briefly hold worktree handles open after a run (Finding H).
- Founders can now create Budget Policies from the UI: new `CreateBudgetPolicyDialog` with company/agent scope, monthly limit, warn-threshold slider, and hard-stop toggle. Wired into both `/TES/budget` (section header + empty-state button) and `/TES/settings?tab=budget` (next to the full-page link). Resolves the dead-end "Create one in Settings → Budget" instruction (Finding L).
- Workflow Templates in `CLAUDE.md` clarified as "backend-ready, UI in 1.1" with pointer to the programmatic `POST /api/companies/:cid/workflow-templates` route — removes promise debt for v1.0 (Finding K).
- Backups tab in Instance Settings is hidden for v1.0 pending real backup/restore implementation in 1.1. Retention config in the settings DB remains harmless; the `BackupsTab` component + its unit tests stay in the tree so the feature can be re-enabled with a one-line change when the routes land (Finding X).
- Post-goal-completion memory archive hook is wrapped in try/catch at the route layer so a memory-lifecycle failure (pgvector absent, transient DB) no longer 500s the goal status transition; the goal update already committed by that point and is returned successfully (Finding S — belt-and-suspenders alongside Finding J).
