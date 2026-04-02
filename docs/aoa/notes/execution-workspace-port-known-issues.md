# Execution Workspace Port — Known Issues

Ported from Paperclip in P3 branch. These are known issues to address in a future session.

## Important

### 1. Project LIST endpoint doesn't gate `executionWorkspacePolicy`

- **File:** `server/src/routes/projects.ts` — `GET /companies/:companyId/projects`
- **Problem:** The list endpoint returns raw `executionWorkspacePolicy` from DB without calling `gateProjectExecutionWorkspacePolicy` or `parseProjectExecutionWorkspacePolicy`. The detail (`GET /projects/:id`) and update (`PATCH /projects/:id`) endpoints correctly gate/parse it.
- **Impact:** Clients calling the list endpoint see the raw policy JSON even when `enableIsolatedWorkspaces` is false.
- **Fix:** Apply `gateProjectExecutionWorkspacePolicy(parseProjectExecutionWorkspacePolicy(...), isolatedWorkspacesEnabled)` in the list response mapping (~10 lines).

### 2. `ProjectWorkspace` type interface missing 8 new schema fields

- **File:** `packages/shared/src/types/project.ts` — `ProjectWorkspace` interface
- **Problem:** The `project_workspaces` schema has 8 new fields (`sourceType`, `defaultRef`, `visibility`, `setupCommand`, `cleanupCommand`, `remoteProvider`, `remoteWorkspaceRef`, `sharedWorkspaceKey`) that are not reflected in the `ProjectWorkspace` type.
- **Impact:** No runtime error (services use direct DB queries), but typed consumers lack autocomplete/type safety.
- **Fix:** Add the 8 fields to the `ProjectWorkspace` interface.

### 3. Policy resolution runs unconditionally in heartbeat (even when disabled)

- **File:** `server/src/services/heartbeat.ts` (~lines 1425-1463)
- **Problem:** `parseProjectExecutionWorkspacePolicy`, `resolveExecutionWorkspaceMode`, and `buildExecutionWorkspaceAdapterConfig` run on every heartbeat run regardless of the `enableIsolatedWorkspaces` flag. This adds an extra DB query to `projects` table per run and could strip `workspaceStrategy`/`workspaceRuntime` keys from agent config if `legacyUseProjectWorkspace=false`.
- **Impact:** Negligible DB overhead. Config stripping edge case only matters if agents already use those keys (they don't yet).
- **Fix:** Wrap the policy fetch + config building inside the `if (isolatedWorkspacesEnabled)` block.

## Minor

### 4. `context.paperclipWorkspace` has new fields in disabled path

- **File:** `server/src/services/heartbeat.ts`
- New fields (`mode`, `strategy`, `branchName`, `worktreePath`, `agentHome`) are added to `context.paperclipWorkspace` even when the feature is disabled. Values are sensible defaults. Could theoretically affect strict adapter config validation.

### 5. Multiple `new Date()` calls in persist block

- **File:** `server/src/services/heartbeat.ts` (~lines 1560-1561)
- `lastUsedAt: new Date()` and `openedAt: new Date()` create slightly different timestamps. Use a single `const now = new Date()`.

### 6. `sanitizeForDb` declaration between import blocks

- **File:** `server/src/services/heartbeat.ts` (lines 34-37)
- Function declaration between two import groups. Cosmetic.

### 7. `executionWorkspacesSvc.create()` can return null

- **File:** `server/src/services/execution-workspaces.ts` (line 84)
- Uses `.returning().then(rows => rows[0] ?? null)`. Theoretically returns null on insert failure. Downstream code handles this correctly.

## Windows-Specific Test Notes

- 2 tests in `workspace-runtime.test.ts` are skipped on Windows (`it.skipIf(process.platform === "win32")`):
  - "does not leak parent Paperclip instance env" — MSYS2 path translation issues
  - "stops execution workspace runtime services by executionWorkspaceId" — process tree kill timing
- `provision-worktree.sh` was copied from Paperclip source (was missing in AoA)
- Shell fallback changed to `"bash"` on win32 (line ~1125 in `workspace-runtime.ts`)
