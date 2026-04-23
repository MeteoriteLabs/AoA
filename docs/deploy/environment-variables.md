---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that AoA uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `HOST` | `127.0.0.1` | Server host binding |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `AOA_HOME` | `~/.paperclip` | Base directory for all AoA data |
| `AOA_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `AOA_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `AOA_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `AOA_SECRETS_MASTER_KEY_FILE` | `~/.paperclip/.../secrets/master.key` | Path to key file |
| `AOA_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `AOA_AGENT_ID` | Agent's unique ID |
| `AOA_COMPANY_ID` | Company ID |
| `AOA_API_URL` | AoA API base URL |
| `AOA_API_KEY` | Short-lived JWT for API auth |
| `AOA_RUN_ID` | Current heartbeat run ID |
| `AOA_TASK_ID` | Issue that triggered this wake |
| `AOA_WAKE_REASON` | Wake trigger reason |
| `AOA_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `AOA_APPROVAL_ID` | Resolved approval ID |
| `AOA_APPROVAL_STATUS` | Approval decision |
| `AOA_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
