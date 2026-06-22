# V1 Upgrade Hardening Design

**Goal:** Close the security, permission, and workflow gaps found during the `v1-upgrade` branch review before creating or merging the PR.

**Status:** Design approved in conversation; implementation plan pending.

## Context

The `v1-upgrade` branch adds marketplace agent/skill installs, marketplace updates, environments, workspace Git controls, instruction bundles, and related UI. Review found that several new paths are functionally useful but too permissive or too trusting:

- Marketplace plugin updates can bypass instance-admin-only plugin management.
- Marketplace skill bundles accept local filesystem or arbitrary repository sources.
- Environment management routes allow agent/MCP actors to mutate runtime configuration.
- Workspace Git push accepts user-provided remotes in a way that can leak GitHub tokens.
- Workspace Git commit promises selected files but can include pre-staged unrelated files.
- Environment `envVars` skip the existing secret/env validation path.
- Legacy marketplace agent templates can lose `promptTemplate` instructions during conversion.
- Human Git/PR actions can race an active agent run without a clear confirmation step.

This design keeps the product direction intact: marketplace installs remain smooth, agents remain autonomous in their own workspaces, and humans get stronger safety rails around privileged/runtime-changing actions.

## Design Principles

1. **Catalog trust is enforced by AoA, not assumed.** Even curated marketplace content should be validated by the installing AoA instance.
2. **Runtime configuration is human managed.** Agents may use assigned environments, but they should not directly mutate environment definitions.
3. **Agent autonomy stays intact.** Agents can still commit, push, and create PRs through authorized workspace flows.
4. **Human actions during active runs require context.** Human commit/push/PR actions should warn before they race an active agent.
5. **Legacy agent data migrates forward.** `promptTemplate` remains compatible by converting into managed `AGENTS.md`.

## Marketplace Skills

Marketplace skill bundles use `type: "github-directory"`. AoA should enforce that name literally.

Allowed marketplace bundle `repo` values:

- `owner/repo`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`

Blocked marketplace bundle `repo` values:

- `file:` URLs
- absolute local paths
- Windows drive paths
- non-GitHub HTTP(S) URLs
- SSH URLs
- path traversal or shell-like values

This applies only to marketplace bundle metadata. The separate user-directed company skill-from-link flow can remain broader because the user is explicitly choosing the source.

## Plugin Marketplace Updates

Applying a marketplace update for an installed plugin must require the same permission as direct plugin upgrade:

- actor must be a board actor
- actor must pass company access
- actor must pass instance settings/admin permission

The UI may show pending plugin updates to regular company users, but apply/update controls must show a disabled or blocked state with a clear "requires instance admin" message when the user lacks permission.

## Environments

Environment definitions are human-managed runtime configuration. They may contain env vars, secret references, Docker execution targets, install commands, and network settings.

For v1:

- board users with company access may list/read/create/update/delete environments
- agent and MCP actors may not list/read/create/update/delete raw environment definitions
- agents may still use environments assigned to tasks, projects, or agents during execution
- future agent-requested environment changes should go through an approval/inbox flow, not direct writes

Environment writes must validate and normalize `envVars` using the same secret/env binding rules already used by agent adapter config:

- reject invalid environment variable names
- reject invalid binding shapes
- reject redacted placeholders as persisted values
- reject or gate sensitive plaintext where strict mode applies
- canonicalize binding shapes before storing
- sync secret binding rows from the canonical stored config

Deleting an environment must remove its secret binding rows so stale bindings do not keep secrets marked as referenced.

## Workspace Git Safety

Workspace Git must preserve agent autonomy and prevent accidental or unsafe human actions.

### Commit

The commit API must commit only the requested validated files, regardless of pre-existing staged state in the worktree.

Acceptable implementation options:

- `git commit --only -- <validated files>`
- isolated temporary Git index

The API must continue to skip denied files such as `.env` and private keys.

### Push

The push API must accept only configured remote names, not raw URLs.

Rules:

- default remote is `origin`
- requested remote must exist in `git remote`
- raw URL remotes are rejected
- auth headers are scoped to the validated remote URL/host
- branch names are validated as branch refs, not shell/user-controlled strings

### Human Confirmation

Human commit, push, and create-PR actions should check workspace/task context before mutating state.

If an active agent run exists on the workspace and the caller is human:

- show a confirmation modal before commit/push/create PR
- include task title, task status, run status, and action name
- allow cancel
- allow "continue anyway" for authorized users

Agent/MCP callers remain allowed to commit, push, and create PRs as part of their own workflow.

Create PR should also warn if the linked task is not in a completed/review-ready state, even when no run is active.

### Button States

Workspace Git UI should reflect state:

- no selected files: `Commit selected` disabled
- selected files: `Commit N files`
- after commit with no new changes: committed state or no committable files
- ahead of remote: `Push N commit(s)`
- not ahead: pushed/up-to-date disabled state
- no PR: `Create PR`
- PR exists: `View PR #N`

This avoids duplicate actions and makes the workflow legible.

## Agent Instructions Migration

Paperclip-era and early AoA agents may store instructions in `adapterConfig.promptTemplate`. New AoA agents should use managed instructions bundles with files such as:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `HEARTBEAT.md`

Marketplace install behavior:

1. If the marketplace agent defines an instructions bundle, materialize that bundle.
2. If it has no bundle but has `adapterConfig.promptTemplate`, convert that string into managed `AGENTS.md`.
3. Only clear `promptTemplate` after the managed bundle has been successfully materialized.
4. If it has neither bundle instructions nor legacy prompt text, block install or return a clear validation error.

The existing Instructions tab already supports additional files, managed/external modes, and skill visibility. This migration should not reduce the user's ability to add more instruction files after installation.

## Tests Required

Marketplace:

- schema/materializer rejects `file:` bundle repos
- rejects absolute paths and non-GitHub URLs
- accepts `owner/repo` and GitHub HTTPS formats
- plugin marketplace update rejects non-instance-admin board user

Environments:

- agent actor cannot list/read/create/update/delete environments
- MCP actor cannot list/read/create/update/delete environments
- board company user can manage environments
- invalid env var names are rejected at save time
- invalid secret binding shape is rejected at save time
- delete removes environment secret bindings

Workspace Git:

- commit with pre-staged denied file commits only requested safe file
- commit with pre-staged unrelated safe file commits only requested file
- push rejects raw HTTPS URL remote
- push rejects `file:` or absolute path remote values
- push accepts configured `origin`
- auth header is scoped to the configured remote

Workspace UI:

- human commit/push/create PR shows confirmation when active run exists
- agent/MCP API path can still commit/push without human confirmation
- create PR warns when task is not completed/review-ready
- buttons show view-PR state when a PR exists

Agent install:

- legacy `promptTemplate` installs as managed `AGENTS.md`
- legacy prompt is cleared only after materialization succeeds
- new instruction bundle remains preferred over promptTemplate
- agent with no instructions returns a clear install error

## Non-Goals

- Build the full agent-requested environment approval flow now.
- Remove company skill-from-link support.
- Remove `promptTemplate` support from all adapters immediately.
- Redesign the whole workspace Git UI.
- Change marketplace agent/team standards beyond what is needed for safe install behavior.

## Rollout

Implement as a focused hardening pass on `v1-upgrade` before PR. After fixes:

1. Run targeted tests for each hardened area.
2. Run `pnpm -r typecheck`.
3. Run `pnpm test:run`.
4. Run `git diff --check origin/main...HEAD`.
5. Re-review P1/P2 findings before creating the PR.
