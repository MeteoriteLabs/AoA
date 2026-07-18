# Distribution & Release Runbook

How AoA gets shipped: Docker images on GHCR + NPM packages on npmjs.org, automated via GitHub Actions, gated by Playwright smoke tests against the freshly-published image.

## Decision locks (Phase H)

| ID | Decision | Locked value |
|----|----------|--------------|
| H.D1 | Distribution format | **Docker + NPM only.** No desktop installer in Phase H. |
| H.D2 | Versioning | **SemVer** (`MAJOR.MINOR.PATCH`). First version `0.1.0`. Pre-1.0 signals "evolving — may break." Deviates from Paperclip's CalVer. |
| H.D3 | Artifact destinations | **GHCR** (`ghcr.io/${{ github.repository }}` — auto-resolves to current owner; future rename to `anthropic/aoa` is a one-line workflow edit) + **npmjs.org public** for `@armyofagents/*` scoped packages, including `@armyofagents/cli`. |
| H.D4 | CI service | **GitHub Actions.** |
| H.D5 | Multi-arch Docker | **amd64 + arm64.** arm/v7 (Raspberry Pi) deferred to Phase I. |
| H.D6 | Smoke test scope | **Founder entry plus scoped-memory workflows.** The Docker harness uses the explicit `local_trusted` identity. The suite verifies profile and organization creation, health, scoped memory in task context and a real task-agent run, plus saving and approving memory from a Discussion. MCP inbound, budgets, and artifacts remain outside this lane. |

## Artifact destinations

- **Docker:** `ghcr.io/${{ github.repository }}:<tag>`. Tags published per-release: `latest` (default-branch only), `{{version}}` (e.g. `0.1.0`), `{{major}}.{{minor}}` (e.g. `0.1`), and the git `sha`.
- **NPM:** public `@armyofagents/*` workspace packages on npmjs.org, including
  the `@armyofagents/cli` package that provides the `aoa` binary. The release
  scripts currently maintain separate package lists, so this runbook does not
  state a fixed package count.

H.D3 future: when the repo settles at `anthropic/aoa`, the GHCR image moves to `ghcr.io/anthropic/aoa` automatically (since the workflow uses `${{ github.repository }}`). NPM scope rename to `@anthropic/aoa` is a separate Changesets-driven publish.

## Required secrets

Configured in GitHub repo Settings → Secrets and variables → Actions:

| Secret | Type | How to obtain | Used by |
|--------|------|---------------|---------|
| `NPM_TOKEN` | repo secret | npmjs.com → Account → Access Tokens → Generate New Token → **Automation** type → grant publish on `@armyofagents/*` | `release.yml` (passed as `NPM_TOKEN` and `NODE_AUTH_TOKEN`) |
| `GITHUB_TOKEN` | automatic | provided by GitHub Actions, no setup | `release.yml`, `docker.yml` (used by Changesets for tags + GHCR auth) |

GHCR push uses `GITHUB_TOKEN` with `packages: write` permission — no extra secret needed.

## Release runbook (Changesets flow)

1. **Developer** creates a `.changeset/*.md` file:
   ```bash
   pnpm changeset
   ```
   Pick affected packages, bump type (patch / minor / major), write a one-line description.

2. **PR merges to main** (or current porting branch). The Changesets action in `release.yml` opens or updates a "Version Packages" PR aggregating all unprocessed `.changeset/*.md` files. That PR contains the `package.json` version bumps + generated `CHANGELOG.md` entries.

3. **Reviewing + merging the Version Packages PR** retriggers `release.yml`. The Changesets action invokes `pnpm changeset publish`, which: publishes each public package to npmjs.org, creates a git tag (`v<version>`), and drafts a GitHub Release.

4. **`docker.yml` fires on the published tag.** Multi-arch buildx (amd64 + arm64) builds the image, pushes to GHCR with 4 tag patterns (`latest`, full version, `major.minor`, sha).

5. **`release-smoke.yml` runs as `post-publish-smoke` job in `release.yml`** (gated on `changesets/action` `published == 'true'`). It pulls `@armyofagents/cli@latest` inside a freshly-built smoke Docker image and runs the complete Playwright release-smoke project. CI cannot automate a real Google account, so the founder-entry scenario uses the explicit local identity, saves a profile, creates an organization, and verifies health before the environment filesystem probe. Separate scenarios exercise scoped memory through Tasks and Discussions. Diagnostics (Docker logs, Playwright report, and test results) are uploaded as the `release-smoke-post-publish` artifact and retained for 14 days.

`scripts/release.sh` remains as a local-only escape hatch for one-shot bumps outside CI. NOT invoked by the workflow.

## Rollback runbook

```bash
pnpm release:rollback             # = ./scripts/rollback-latest.sh
pnpm release:rollback --dry-run   # preview every action without side effects
pnpm release:rollback --self-test # run 10 internal unit tests
```

3-step Changesets-aware flow (NOT a 1-step dist-tag repointer like Paperclip's):
1. `npm deprecate` each package returned by
   `rollback-latest.sh::list_publishable_packages()` at the current version
   with a message (default: `"Reverted by rollback-latest.sh on <ISO timestamp>"`;
   override with `--message <text>`). This surfaces a deprecation warning on
   subsequent installs and does not unpublish.
2. Delete local + remote git tag `v<current_version>`.
3. **Optional** (`--revert-commit`): `git revert --no-edit HEAD` if HEAD subject matches `chore: release v<current_version>`. Creates a new commit; does NOT rewrite history.

Rollback assumes the bad version is the latest published. To roll back further, re-run with the prior version listed in the deprecation messages.

## Manual release-smoke (canary)

`release-smoke.yml` is wired to `release.yml` only for the published-stable path. To smoke a canary or re-run smoke against any published version:

GitHub → Actions → "Release Smoke" workflow → "Run workflow" → pick:
- `aoa_version`: `canary` (latest canary dist-tag) or `latest` (stable)
- `host_port`: defaults to `3232`
- `artifact_name`: defaults to `release-smoke`

Auto-firing on every canary push was deliberately not wired — would burn CI minutes. Trigger manually after a canary publish if smoke verification matters.

## Local Docker testing

Before pushing release-affecting changes:

```bash
pnpm docker:build-test                # native-arch Dockerfile build + binary smoke
pnpm docker:build-test --multi-arch   # buildx amd64 + arm64 (verifies both build cleanly)
pnpm docker:build-test --dry-run      # print commands without executing
pnpm docker:smoke                     # full onboard auto-bootstrap smoke (pulls @armyofagents/cli@$VERSION)
```

`docker:smoke` requires a working docker daemon and pulls from npm — won't work against unpublished local changes. Use it after a canary publish to verify the published artifact end-to-end.

## SemVer vs CalVer

AoA uses SemVer; Paperclip uses CalVer. First AoA version is `0.1.0`, signaling "pre-1.0 evolving — APIs may change between minors." Bump rules:
- **patch** (0.1.0 → 0.1.1): bug fixes, no API changes
- **minor** (0.1.0 → 0.2.0): backward-compatible features (relaxed pre-1.0 — minors may include API changes)
- **major** (0.1.0 → 1.0.0): API breaking changes; 1.0 declares stability commitment

Pre-1.0, minor bumps signal "this changed shape" rather than strict additivity. Post-1.0 (deferred decision) the discipline tightens.

## Known gaps / Phase I follow-ups

- **`anthropic/aoa` repo rename** (H.D3 future) — image destination updates automatically via `${{ github.repository }}`; NPM scope rename is a Changesets-driven publish.
- **Canary auto-wiring** — release-smoke.yml exposes `workflow_call` but `release.yml`'s `post-publish-smoke` only fires on stable publish. Canary stays manual.
- **Desktop installer** (Electron/Tauri) — out of Phase H per H.D1; separate phase.
- **Expanded smoke coverage** (H.D6) — the founder-entry scenario stops at
  the environment step because continuing performs a real container filesystem
  probe and later verifies a local Commander CLI. Other scenarios already
  cover scoped memory through Tasks and Discussions. A future lane can supply
  the container-specific founder fixtures and add MCP inbound, budget, and
  artifact coverage.
- **GHCR image signing** (cosign) — Phase I+ security hardening.
- **arm/v7 Docker support** — tied to Phase I.12 Pi-local adapter.
- **Release notes automation** (parse conventional commits) — Phase I.
- **`compute_next_version` + `list_public_package_info` + `set_public_package_version` in `release-lib.sh`** — dead code since H.2-part-2 (`release.sh` port) was SKIPPED (Changesets handles versioning). Decide in Phase I cleanup: delete vs. keep as reference.
- **Package list duplication** — `rollback-latest.sh::list_publishable_packages()`
  and `release.sh` maintain separate hard-coded package lists that can drift.
  Reconcile them and extract a shared helper or
  `pnpm -r list --json --filter '!**/private'` lookup in Phase I.
