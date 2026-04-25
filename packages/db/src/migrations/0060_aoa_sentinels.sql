-- Migrate Paperclip → AoA in-row sentinels.
-- Idempotent: every UPDATE has a WHERE that drops it to a no-op on rerun.

-- 1. project_workspaces.cwd: replace literal sentinel string.
UPDATE project_workspaces
SET cwd = '/__aoa_repo_only__'
WHERE cwd = '/__paperclip_repo_only__';
--> statement-breakpoint
-- 2. agent_runtime_state.context (jsonb): rename top-level key
--    _paperclipWakeContext → _aoaWakeContext, preserving the value
--    and any sibling keys.
UPDATE agent_runtime_state
SET context = (context - '_paperclipWakeContext')
              || jsonb_build_object('_aoaWakeContext', context -> '_paperclipWakeContext')
WHERE context ? '_paperclipWakeContext';
