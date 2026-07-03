---
title: Claude Local
summary: Claude Code local adapter setup and configuration
---

The `claude_local` adapter runs Anthropic's Claude Code CLI locally. It supports session persistence, skills injection, and structured output parsing.

## Prerequisites

- Claude Code CLI installed (`claude` command available)
- `ANTHROPIC_API_KEY` set in the environment or agent config

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | No | Working directory for the agent process (absolute path; created automatically if missing when permissions allow) |
| `instructionsFilePath` | string | No | Absolute path to a markdown instructions file injected at runtime |
| `model` | string | No | Claude model to use (e.g. `claude-opus-4-6`) |
| `effort` | string | No | Reasoning effort passed via `--effort` (`low` \| `medium` \| `high`) |
| `chrome` | boolean | No | Pass `--chrome` when running Claude |
| `promptTemplate` | string | No | Prompt used for all runs |
| `maxTurnsPerRun` | number | No | Max agentic turns per heartbeat |
| `dangerouslySkipPermissions` | boolean | No | Pass `--dangerously-skip-permissions` to Claude (dev only) |
| `command` | string | No | CLI command to invoke (default: `claude`) |
| `extraArgs` | string[] | No | Additional CLI arguments |
| `env` | object | No | Environment variables (supports secret refs) |
| `timeoutSec` | number | No | Process timeout in seconds (0 = no timeout) |
| `graceSec` | number | No | Grace period before force-kill after timeout/cancel |

## Prompt Templates

Templates support `{{variable}}` substitution:

| Variable | Value |
|----------|-------|
| `{{agentId}}` | Agent's ID |
| `{{companyId}}` | Company ID |
| `{{runId}}` | Current run ID |
| `{{agent.name}}` | Agent's name |
| `{{company.name}}` | Company name |

## Session Persistence

The adapter persists Claude Code session IDs between heartbeats. On the next wake, it resumes the existing conversation so the agent retains full context.

Session resume is cwd-aware: if the agent's working directory changed since the last run, a fresh session starts instead.

If resume fails with an unknown session error, the adapter automatically retries with a fresh session.

## Skills Injection

The adapter creates a temporary directory with symlinks to AoA skills and passes it via `--add-dir`. This makes skills discoverable without polluting the agent's working directory.

## Environment Test

Use the "Test Environment" button in the UI to validate the adapter config. It checks:

- Claude CLI is installed and accessible
- Working directory is absolute and available (auto-created if missing and permitted)
- API key/auth mode hints (`ANTHROPIC_API_KEY` vs subscription login)
- A live hello probe (`claude --print - --output-format stream-json --verbose` with prompt `Respond with hello.`) to verify CLI readiness

## Runtime Permission Bridge (Supervised Mode)

By default the `claude_local` adapter passes `--dangerously-skip-permissions` and lets the agent proceed uninterrupted. **Supervised mode** replaces this with a `PreToolUse` hook that pauses risky tool calls and routes them to the W5a human-decision hub, where a founder can **allow** or **deny** the call before the CLI continues.

### What it covers

Permission prompts only. The `work_question` kind (`AskUserQuestion`) is **deferred** — it is SDK-only and AoA is CLI-only (Decision #91); there is no CLI hook that intercepts it.

Intercepted tools: `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `WebFetch`. Read-only tools (Read, Grep, Glob, etc.) are never intercepted.

### Enabling supervised mode

Two gates must both be open:

| Gate | How to enable |
|------|--------------|
| **Per-agent flag** | Set `runtimeConfig.runtimeDecisionRoutingEnabled = true` on the agent |
| **Instance kill-switch** | Set env `AOA_RUNTIME_DECISION_ROUTING=1` on the AoA server process |

When both are set and the agent's `executionTarget.type` is `"local"`, the adapter:

1. Omits `--dangerously-skip-permissions`.
2. Mints a per-run bearer token and writes a temporary `settings.json` with a `PreToolUse` command hook (`hook-forward.mjs`).
3. Passes the settings file via `--settings` and the token via the `AOA_RUNTIME_HOOK_TOKEN` environment variable (redacted in logs).

### Fail-safe deny

The hook forwarder is a `type:"command"` process, not a native HTTP hook. Native HTTP hooks are fail-open (the CLI continues on any non-2xx or connection error). The command forwarder is **fail-closed**: it emits `{"decision":"deny"}` on any error, so a network blip or hub unavailability defaults to deny rather than allow.

### Timeout behaviour

The hub blocks for up to **5 minutes** (`RUNTIME_HOOK_BLOCK_TIMEOUT_SEC=300`). If no decision arrives in time, the server returns `deny` to the CLI (anti-hang). Timed-out prompts remain visible in the hub with `timeoutPolicy="escalate"`.

For overnight or unattended runs, keep agents on bypass (the default) or configure trust rules (allow-always) rather than relying on a longer timeout.

### Local-target only

The bridge requires the CLI to reach `127.0.0.1`. It is automatically disabled for Docker and remote sandbox execution targets regardless of the per-agent flag.

### Relationship to `dangerouslySkipPermissions`

`--dangerously-skip-permissions` and supervised mode are mutually exclusive. When supervised mode is active, the skip-permissions flag is never passed. When supervised mode is off (the default), the flag is passed as before.
