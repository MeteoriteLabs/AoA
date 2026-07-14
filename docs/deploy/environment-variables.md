---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that AoA reads. Grouped by concern. The list is verified against `process.env` reads in `server/src/`, `cli/src/`, and `packages/`; the brand-check CI job in `.github/workflows/pr.yml` keeps it in sync.

> **Legacy `PAPERCLIP_*` aliases.** Every `AOA_FOO` env var has a legacy `PAPERCLIP_FOO` alias that's mirrored at startup by `server/src/env-compat.ts` (and `cli/src/config/env-compat.ts` for the CLI). If both are set, `AOA_*` wins. The mirror runs only inside the spawned Node process — bash invocations of project scripts must use `AOA_*` directly.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port (alias: `AOA_LISTEN_PORT`, `AOA_SERVER_PORT`) |
| `HOST` | `127.0.0.1` | Server host binding (alias: `AOA_LISTEN_HOST`, `AOA_SERVER_HOST`) |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string. If unset, AoA boots `embedded-postgres@18.x` automatically |
| `AOA_HOME` | `~/.aoa` (with legacy `~/.paperclip` fallback) | Base directory for all AoA data. Resolved by `cli/src/config/home.ts`: prefers `~/.aoa/`, falls back to `~/.paperclip/` if the legacy dir exists and the new one does not |
| `AOA_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances on one machine) |
| `AOA_DEPLOYMENT_MODE` | `local_trusted` | `local_trusted` or `authenticated` |
| `AOA_DEPLOYMENT_EXPOSURE` | `private` | `private` or `public`. Only meaningful when `AOA_DEPLOYMENT_MODE=authenticated` |
| `AOA_PUBLIC_URL` | (derived) | Public-facing URL for deployment. Used in invite links and webhook URLs |
| `AOA_ALLOWED_HOSTNAMES` | (empty) | Comma-separated allowlist of hostnames the server will accept (Tailscale, Docker host alias, etc.) |
| `AOA_TRUST_PROXY` | `false` | Express trust-proxy setting. Set to `true` (trust any proxy), a hop count like `1` (recommended for cloud), or a comma-separated CIDR list. Required when running behind Cloudflare/ALB/nginx — without it, `req.ip` reads the proxy IP and rate limits collapse. **Never set to `true` on a directly-exposed deployment** (allows X-Forwarded-For spoofing). |
| `AOA_OPEN_ON_LISTEN` | `true` (CLI), `false` (server-only) | Auto-open default browser on first listen |
| `AOA_CONFIG` | (default path) | Override path to instance `config.json` |
| `AOA_LOG_DIR` | `<AOA_HOME>/instances/<id>/logs` | Override log directory |
| `RUN_LOG_BASE_PATH` | `<AOA_HOME>/instances/<id>/data/run-logs` | Override local-file heartbeat run log storage. Use a durable mounted volume in Docker/cloud single-node deployments |
| `WORKSPACE_OPERATION_LOG_BASE_PATH` | `<AOA_HOME>/instances/<id>/data/workspace-operation-logs` | Override local-file workspace operation log storage. Use a durable mounted volume in Docker/cloud single-node deployments |

For horizontally scaled deployments, local-file run logs require sticky routing or shared durable storage. Object-storage-backed run logs are a future backend; do not rely on per-container ephemeral disk for production run history.

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_AUTH_BASE_URL_MODE` | `auto` | `auto` (derive from request) or `explicit` (use `AOA_AUTH_PUBLIC_BASE_URL`) |
| `AOA_AUTH_PUBLIC_BASE_URL` | — | Required when `AOA_AUTH_BASE_URL_MODE=explicit`. Public URL where Better Auth callbacks resolve |
| `AOA_AUTH_STORE` | `default` | Auth-store backend selection |
| `BETTER_AUTH_BASE_URL` | (derived) | Override for Better Auth base URL — usually leave unset and let `AOA_AUTH_*` drive it |
| `BETTER_AUTH_SECRET` | (required when `AOA_DEPLOYMENT_MODE!="local_trusted"`) | HMAC secret for Better Auth session cookies. **Required** for `authenticated` (and any future non-local-trusted) deployment — the server refuses to start if unset. In `local_trusted` (loopback-only) mode the server boots with a constant dev fallback and logs a one-line WARN. `AOA_AGENT_JWT_SECRET` acts as a fallback if `BETTER_AUTH_SECRET` is not set. Auto-generated on first `pnpm aoa onboard`; set explicitly for multi-instance setups |
| `BETTER_AUTH_TRUSTED_ORIGINS` | (derived) | CORS allowlist for Better Auth |
| `BETTER_AUTH_URL` | (derived) | Better Auth canonical URL |
| `AOA_DEV_LOCAL_IDENTITY` | auto-enabled by `pnpm dev` when local Google credentials are absent | Development-only synthetic board identity for loopback `local_trusted` mode. It is ignored outside `local_trusted`; do not use it for an authenticated or exposed deployment. |
| `AOA_DEV_LOCAL_IDENTITY_FORCE` | `false` | Allows `AOA_DEV_LOCAL_IDENTITY` on an instance that already contains real users. Development/recovery only: this bypasses the populated-instance safety check. |
| `AOA_HEADLESS_BOOTSTRAP` | `false` | Enables the legacy board-ownership claim path for a headless/self-hosted server migrating from `local_trusted` when `local-board` is still the only instance admin. The claim is completed by a real Google user in a browser that can reach the server. Leave disabled for normal onboarding. |

## Agent JWT (signing for `AOA_API_KEY`)

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_AGENT_JWT_SECRET` | (auto-generated, persisted in instance config) | HMAC secret for agent JWTs |
| `AOA_AGENT_JWT_ISSUER` | `paperclip` (wire-compat default) | JWT `iss` claim. Legacy default kept so existing agents validate |
| `AOA_AGENT_JWT_AUDIENCE` | `aoa` | JWT `aud` claim |
| `AOA_AGENT_JWT_TTL_SECONDS` | `300` | Token TTL — keep short; the heartbeat refreshes it on each run |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_SECRETS_PROVIDER` | `local_encrypted` | Default secret-storage backend. `local_encrypted` and `aws_secrets_manager` are supported; `gcp_secret_manager` and `vault` are coming-soon stubs |
| `AOA_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw). Use the file path variant in production |
| `AOA_SECRETS_MASTER_KEY_FILE` | `~/.aoa/.../secrets/master.key` (with legacy `~/.paperclip/` fallback) | Path to key file. Auto-created by `pnpm aoa onboard` |
| `AOA_SECRETS_STRICT_MODE` | `false` | When `true`, sensitive env keys (`*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values |

## Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_STORAGE_PROVIDER` | `local_disk` | `local_disk` or `s3` |
| `AOA_STORAGE_LOCAL_DIR` | `<AOA_HOME>/instances/<id>/data/storage` | Override local-disk storage root |
| `AOA_STORAGE_S3_BUCKET` | — | S3 bucket name (required when provider is `s3`) |
| `AOA_STORAGE_S3_REGION` | — | S3 region (e.g. `us-east-1`) |
| `AOA_STORAGE_S3_ENDPOINT` | (default AWS) | Override endpoint URL for MinIO, Cloudflare R2, Backblaze B2, etc. |
| `AOA_STORAGE_S3_PREFIX` | (empty) | Object-key prefix for namespace isolation in shared buckets |
| `AOA_STORAGE_S3_FORCE_PATH_STYLE` | `false` | Force path-style URLs (required for some S3-compatible services) |
| `AOA_FILE_MAX_BYTES` | `52428800` (50 MB) | Max upload size for assets/artifacts |
| `AOA_ATTACHMENT_MAX_BYTES` | (= `AOA_FILE_MAX_BYTES`) | Max upload size for issue attachments specifically |
| `AOA_ATTACHMENTS_PER_COMMENT_MAX` | `5` | Max number of attachments accepted on a single issue comment |

## Database backups

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_DB_BACKUP_ENABLED` | `true` | Toggle automatic database backups |
| `AOA_DB_BACKUP_DIR` | `<AOA_HOME>/instances/<id>/data/backups` | Backup directory |
| `AOA_DB_BACKUP_INTERVAL_MINUTES` | `60` | Backup frequency in minutes |
| `AOA_DB_BACKUP_RETENTION_DAYS` | `30` | Keep backups this many days, then prune |
| `AOA_PG_DUMP_PATH` | `pg_dump` | Override the `pg_dump` executable used by backup export jobs |
| `AOA_PSQL_PATH` | `psql` | Override the `psql` executable used by backup restore/import jobs |

## Migrations / startup

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_MIGRATION_AUTO_APPLY` | `true` (embedded), `false` (external DB) | Apply pending Drizzle migrations automatically on boot |
| `AOA_MIGRATION_PROMPT` | `true` | Prompt before applying migrations to a non-empty DB. Set to `never` in CI/dev-runner |
| `AOA_EMBEDDED_POSTGRES_PORT` | (auto) | Override the embedded PostgreSQL port. Intended for isolated local/e2e instances that must avoid port collisions |
| `AOA_EMBEDDED_POSTGRES_STRICT_PORT` | `false` | When truthy, fail startup instead of falling back to a random embedded PostgreSQL port if `AOA_EMBEDDED_POSTGRES_PORT` is unavailable |
| `AOA_EMBEDDED_POSTGRES_VERBOSE` | `false` | Verbose logging from `embedded-postgres` (helpful for debugging boot issues) |

## Telemetry / feedback

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_FEEDBACK_ENDPOINT` | (unset) | URL where vote bundles + plugin telemetry are POSTed. When unset, falls back to local file in `~/.aoa/feedback-exports/` |
| `AOA_FEEDBACK_API_KEY` | (unset) | Optional Bearer token for the feedback endpoint |

## Plugins / dev

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_PLUGIN_DIR` | `<AOA_HOME>/plugins` | Plugin discovery directory |
| `AOA_MARKETPLACE_CDN_URL` | AoA marketplace CDN | Override the marketplace catalog URL. Developer/e2e harnesses can point this at an unreachable local URL to force the bundled catalog snapshot fallback |
| `AOA_UI_DEV_MIDDLEWARE` | `false` | Set to `true` to mount the Vite UI as Express middleware (used by `pnpm dev`) |
| `AOA_VITE_HMR_PORT` | (Vite default) | Override the Vite hot-module-reload websocket port when the UI is mounted as Express middleware. Useful for parallel local/e2e AoA instances |
| `AOA_OPENCODE_COMMAND` | `opencode` | Override path to the `opencode` CLI binary for the OpenCode Local adapter |
| `AOA_WORKTREES_DIR` | `<AOA_HOME>/instances/<id>/workspaces` | Where the worktree provisioner places per-task git worktrees |
| `AOA_ENABLE_COMPANY_DELETION` | `true` (dev), `false` (prod) | Feature flag for the destructive "delete company" action |

## Agent Runtime (injected into agent processes — not user-configurable)

The server sets these automatically when invoking adapters. They appear in the spawned agent's environment but are **not configured by operators**.

| Variable | Description |
|----------|-------------|
| `AOA_AGENT_ID` | Agent's unique ID |
| `AOA_COMPANY_ID` | Company ID for this run |
| `AOA_API_URL` | AoA API base URL the agent should call back to |
| `AOA_HUMAN_QUESTION_CAPABILITIES` | JSON-encoded provider capability contract for structured human questions. Set automatically for adapter runs; `ask_and_park` persists the question and resumes later, while live relay requires a provider that explicitly supports pausing and resuming the same invocation |
| `AOA_API_KEY` | Short-lived JWT for API auth (rotates each heartbeat) |
| `AOA_RUN_ID` | Current heartbeat run ID — also sent in `X-Aoa-Run-Id` HTTP header |
| `AOA_TASK_ID` | Issue (task) that triggered this wake, if any |
| `AOA_WAKE_REASON` | Wake trigger reason (`assignment`, `timer`, `mention`, etc.) |
| `AOA_WAKE_COMMENT_ID` | Comment that triggered this wake, if any |
| `AOA_APPROVAL_ID` | Resolved approval ID, when waking from an approval decision |
| `AOA_APPROVAL_STATUS` | Approval decision (`approved` / `rejected` / `revision_requested`) |
| `AOA_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs for cross-task context |
| `AOA_WORKSPACE_CWD` | Working directory for the agent (when an execution workspace is provisioned) |
| `AOA_WORKSPACE_SOURCE` | How the workspace was provisioned (`task`, `agent_home`, `project_primary`, etc.) |
| `AOA_WORKSPACE_STRATEGY` | Workspace strategy: `isolated` / `shared` / `reuse_existing` |
| `AOA_WORKSPACE_ID` | Database ID of the execution workspace record |
| `AOA_WORKSPACE_REPO_URL` | Git remote URL when the workspace is git-backed |
| `AOA_WORKSPACE_REPO_REF` | Base ref (branch or tag) that was cloned |
| `AOA_WORKSPACE_BRANCH` | Git branch name when workspace is git-backed |
| `AOA_WORKSPACE_WORKTREE_PATH` | Filesystem path to the git worktree when applicable |
| `AGENT_HOME` | Agent's home directory (memory + life files live here) |

## Session impersonation (CLI / mcp)

| Variable | Description |
|----------|-------------|
| `AOA_SESSION_COMPANY_ID` | Override active company ID in the CLI / MCP session |
| `AOA_SESSION_USER_ID` | Override active user ID |
| `AOA_SESSION_USER_ROLE` | Override role (`founder`, `team_lead`, `team_member`) |
| `AOA_SESSION_ENABLED_CAPABILITIES` | Comma-separated list of `internal_agent_config.enabledCapabilities` consumed by the Commander MCP bridge to gate capability-bound tools (`discussion_processing`, `system_actions`, `memory_management`). Set automatically by the host process when spawning the bridge; set manually only when running the bridge subprocess directly. |

## Commander MCP bridge & internal tuning (injected / advanced)

Set automatically by the host process when spawning the Commander MCP bridge or
internal services — operators rarely set these directly.

| Variable | Description |
|----------|-------------|
| `AOA_ACTOR_TYPE` | Actor type the Commander MCP bridge runs as (`board` default, or `agent`) |
| `AOA_AGENT_KIND` | Agent kind passed into the MCP bridge for an agent-actor run |
| `AOA_COMMANDER_CONTEXT_SCOPE` | JSON-encoded context scope handed to the Commander MCP bridge |
| `AOA_DISCUSSION_RUN_MODE` | Discussion run mode for a bridge-driven discussion/thread run |
| `AOA_EFFECTIVE_AUTONOMY` | Effective autonomy level injected into the bridge run |
| `AOA_THREAD_FRESHNESS` | Thread freshness window used when resolving thread context |
| `AOA_TOOL_ALLOWLIST` | Comma-separated allowlist of tool names exposed to the bridge run |
| `AOA_KEEP_MCP_CONFIG` | When `1`, retains the generated MCP config file after a run (debugging) |
| `AOA_LOG_STDOUT` | When `0`, suppresses stdout log output (otherwise logs go to stdout) |
| `AOA_THREAD_EVENT_DEBOUNCE_MS` | Debounce window (ms) for thread live-event → Commander wakeups |
| `AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED` | Feature flag for the Scribe autonomous-drain dispatcher path |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (Codex Local + OpenCode Local adapters) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Google AI Studio key (Gemini Local adapter) |
| `CURSOR_API_KEY` | Cursor API key (Cursor adapter) |

## Test harness (developer-only)

These are read by tests and dev scripts; you should not need to set them in production.

| Variable | Description |
|----------|-------------|
| `AOA_TEST_ARGS_PATH` | Path where test harnesses dump captured argv |
| `AOA_TEST_CAPTURE_PATH` | Path where test harnesses dump captured stdin/env |
| `AOA_CONTEXT` | CLI context-file override |
| `AOA_E2E_FAKE_AWS_SECRETS_MANAGER` | Playwright/vitest harness flag for the fake AWS Secrets Manager provider |
| `AOA_E2E_PORT` / `AOA_E2E_SKIP_LLM` / `AOA_E2E_SKIP_MCP` | Playwright e2e harness — see `tests/README.md` |
| `AOA_RUN_WIN_INTEGRATION` | Opt-in flag for real embedded-Postgres integration tests on Windows. Unset ⇒ Windows skips those tests |
| `AOA_E2E_FAKE_CREW_LLM` | Playwright e2e harness flag (`=1`) that swaps the real crew CLI for the deterministic fake-crew harness (`fake-crew-llm.ts`). Never activates when `NODE_ENV=production`. |
| `AOA_E2E_FAKE_CREW_CONTROL` | E2E only. Path to a JSON control file that scripts the fake-crew harness per test (e.g. the controller-mode Adjutant scope turn). Read fresh on every fake turn; absent/invalid ⇒ legacy fake behavior. Set by `tests/e2e/playwright.config.ts`. No effect unless `AOA_E2E_FAKE_CREW_LLM=1`. |
| `AOA_ACCEPTANCE_CLI` | Selects the real CLI binary in acceptance/integration tests |
| `AOA_PI_COMMAND` | Overrides the `pi` adapter binary in adapter-model tests |
| `AOA_TEST_CODEX_MODEL` | Codex model override for live crew e2e tests |
| `AOA_CODEX_APPSERVER_LIVE` | Enables the guarded live `codex app-server` approval-loop harness (`appserver-spike.test.ts`); unset ⇒ that test skips. W5c |
| `AOA_E2E_RUNTIME_DECISION_BRIDGE_CODEX` | Opt-in flag for the guarded codex_local runtime-decision-bridge e2e (`runtime-decision-bridge-codex.spec.ts`); unset ⇒ skipped. W5c |
| `AOA_TEST_COMPANY_ID` / `AOA_TEST_THREAD_ID` | Seed IDs for the bridge stdout-purity test |
| `AOA_TEST_DATABASE_URL` | Postgres URL for tests that need a real DB connection |
| `AOA_API_BASE` | API base URL used by the Commander review seed script; defaults to `http://127.0.0.1:3100/api` |
