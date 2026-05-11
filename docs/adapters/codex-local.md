---
title: Codex Local
summary: OpenAI Codex local adapter setup and configuration
---

The `codex_local` adapter runs OpenAI's Codex CLI locally. It supports session persistence via `previous_response_id` chaining and skills injection through the global Codex skills directory.

## Prerequisites

- Codex CLI installed (`codex` command available)
- `OPENAI_API_KEY` set in the environment or agent config

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | No | Working directory for the agent process (absolute path; created automatically if missing when permissions allow) |
| `instructionsFilePath` | string | No | Absolute path to a markdown instructions file prepended to stdin prompt at runtime |
| `model` | string | No | Codex model to use (default: `gpt-5.3-codex`) |
| `modelReasoningEffort` | string | No | Reasoning effort override (`minimal` \| `low` \| `medium` \| `high`) — passed via `-c model_reasoning_effort=...` |
| `promptTemplate` | string | No | Prompt used for all runs |
| `search` | boolean | No | Run Codex with `--search` |
| `fastMode` | boolean | No | Enable Codex Fast tier for lower-latency runs. Currently supported on `gpt-5.4` only; ignored on other models. |
| `dangerouslyBypassApprovalsAndSandbox` | boolean | No | Skip safety checks (dev only; default: `true`) |
| `command` | string | No | CLI command to invoke (default: `codex`) |
| `extraArgs` | string[] | No | Additional CLI arguments |
| `env` | object | No | Environment variables (supports secret refs) |
| `timeoutSec` | number | No | Process timeout in seconds (0 = no timeout) |
| `graceSec` | number | No | Grace period before force-kill after timeout/cancel |

## Session Persistence

Codex uses `previous_response_id` for session continuity. The adapter serializes and restores this across heartbeats, allowing the agent to maintain conversation context.

## Skills Injection

The adapter symlinks AoA skills into the global Codex skills directory (`~/.codex/skills`). Existing user skills are not overwritten.

## Environment Test

The environment test checks:

- Codex CLI is installed and accessible
- Working directory is absolute and available (auto-created if missing and permitted)
- Authentication signal (`OPENAI_API_KEY` presence)
- A live hello probe (`codex exec --json -` with prompt `Respond with hello.`) to verify the CLI can actually run
