---
title: "Upgrading from Paperclip"
summary: "Migration steps from a Paperclip-era install to AoA"
---

If you've been running this project under the legacy "Paperclip" name (or any version &le; 1.0.0-rc.5), this guide covers exactly what changes when you upgrade to the AoA-rebranded release. Most things are automatic — read through the sections below to know what, if anything, you need to touch.

## What's automatic (no action required)

The following migrations happen silently on first boot. You do not need to run any scripts or change any config files for these.

**Home directory fallback.** The CLI checks for `~/.aoa/` at startup. If that directory does not exist but `~/.paperclip/` does, it reads from `~/.paperclip/` transparently for one release cycle (`cli/src/config/home.ts`). Your existing instance data, embedded Postgres, logs, and secrets are all picked up without copying anything.

**Environment variable mirroring.** Both `server/src/env-compat.ts` and `cli/src/config/env-compat.ts` run at module import and copy every `PAPERCLIP_<KEY>` env var to `AOA_<KEY>` unless the `AOA_` version is already set. Any shell profile or `.env` file using `PAPERCLIP_*` variables keeps working at runtime with no changes.

**localStorage migration.** On first UI load, `ui/src/lib/storage-migrations.ts` moves all `paperclip:*` and `paperclip.*` keys to their `aoa:*` equivalents — theme preference, sidebar state, selected company, project order, issue drafts, and more. The migration is idempotent; it runs on every boot but is a no-op once the old keys are gone.

**DB sentinel rewrite.** Migration `0060_aoa_sentinels.sql` runs as part of the normal `db:migrate` step and is idempotent. It rewrites two in-row sentinels:
- `project_workspaces.cwd`: `/__paperclip_repo_only__` → `/__aoa_repo_only__`
- `agent_wakeup_requests.payload` (jsonb): `_paperclipWakeContext` key → `_aoaWakeContext` key

If you roll back code after this migration has run, the server already has dual-read for both key names, so older rows remain usable.

**Log prefix change.** Adapter log lines change from `[paperclip]` to `[aoa]`. This is cosmetic, but if you have log aggregation rules (Datadog, Loki, etc.) filtering on the `[paperclip]` prefix, update those filters.

## What requires user action

**Docker host bind path.** The compose file's default host-side mount changed from `./data/docker-paperclip` to `./data/docker-aoa`. The in-container path remains `/paperclip` (the Dockerfile sets `AOA_HOME=/paperclip`), so your container data is intact — only the host directory name changed in the default.

You have two options:

| Option | How |
|--------|-----|
| Rename the host directory | `mv ./data/docker-paperclip ./data/docker-aoa` |
| Keep the old name | Set `AOA_DATA_DIR=./data/docker-paperclip` before `docker compose up` |

**Shell profile env vars.** `PAPERCLIP_HOME=/foo` continues to work at runtime via env-compat mirroring, but plan to rename it to `AOA_HOME` at your next convenience — the mirror will be removed in a future major.

**npm bin name.** `npx paperclipai onboard` still works (the alias is preserved). Once `@armyofagents/cli` is published, the canonical command becomes `npx aoa onboard`. No urgency — both work today.

## What stays the same forever

These identifiers are wire-compat and will not change. See [Wire Compatibility Reference](/aoa/reference/wire-compat) for the full contract.

- `paperclipai` CLI bin alias
- `X-Paperclip-Run-Id` HTTP header
- `_paperclipWakeContext` legacy DB key (dual-read supported)
- `paperclip_session_key` and `paperclip_stream_transport` OpenClaw wire fields
- `paperclip-feedback-envelope-v2` schema version string
- `paperclipPlugin` manifest key and plugin globals
- `@paperclipai/*` npm package scope (upstream Paperclip packages; AoA cannot rename these)

## Step-by-step upgrade

1. **Pull the new release.**
   ```bash
   git pull
   ```

2. **Stop the running server.**
   ```bash
   # local dev
   # Ctrl-C the pnpm dev process, or:
   pkill -f "pnpm dev"
   ```

3. **Install updated dependencies.**
   ```bash
   pnpm install
   ```

4. **Run database migrations.**
   ```bash
   pnpm db:migrate
   ```
   If you have `AOA_MIGRATION_AUTO_APPLY=true` set, migrations run automatically on server start — you can skip this step.

5. **Restart the server.**
   ```bash
   # local dev
   pnpm dev

   # production
   pnpm aoa run
   ```

6. **(Docker only)** If you had a custom host bind path, set `AOA_DATA_DIR` first, then pull and restart:
   ```bash
   export AOA_DATA_DIR=./data/docker-paperclip   # only if keeping old path
   docker compose pull
   docker compose up -d
   ```

7. **Verify.** The health endpoint should return `200 OK`:
   ```bash
   curl http://localhost:3100/api/health
   ```

## Rollback

If you need to return to a Paperclip-era version:

**Code rollback:**
```bash
git checkout <previous-tag>
pnpm install
```

**Database:** `0060_aoa_sentinels.sql` is data-only and idempotent. Rolling back the code is safe because the server already has dual-read for both `_paperclipWakeContext` and `_aoaWakeContext` keys. The main risk is a version that writes only the new `_aoaWakeContext` key being rolled back to code that only reads `_paperclipWakeContext`. Avoid rolling back across the migration boundary unless absolutely necessary.

## Common upgrade-time errors

**"Theme reset to dark on second reload."**
The FOUC bootstrap script in `ui/index.html` migrates `paperclip.theme` → `aoa.theme` on the first page load. The second reload reads only `aoa.theme`. If you unexpectedly land in dark mode, check:
```js
localStorage.getItem("aoa.theme")
```
Set it to `"light"` if it's missing or wrong.

**"Existing OpenClaw clients can't connect."**
The `paperclip_session_key` and `paperclip_stream_transport` wire fields are intentionally kept as `paperclip_*` per the Phase 6 wire-compat deferral. No action required — this is expected behavior.

**"Plugin won't load."**
Check the plugin manifest. The original `paperclipPlugin` key is still supported. If the plugin was updated to use the new `aoaPlugin` alias, ensure you're running a version of AoA that recognizes it (both are supported). If in doubt, revert the manifest to `paperclipPlugin`.
