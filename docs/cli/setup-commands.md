---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `aoa run`

One-command bootstrap and start:

```sh
pnpm aoa run
```

Does:

1. Auto-onboards if config is missing
2. Runs `aoa doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm aoa run --instance dev
```

## `aoa onboard`

Interactive first-time setup:

```sh
pnpm aoa onboard
```

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm aoa onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm aoa onboard --yes
```

## `aoa doctor`

Health checks with optional auto-repair:

```sh
pnpm aoa doctor
pnpm aoa doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `aoa configure`

Update configuration sections:

```sh
pnpm aoa configure --section server
pnpm aoa configure --section secrets
pnpm aoa configure --section storage
```

## `aoa env`

Show resolved environment configuration:

```sh
pnpm aoa env
```

## `aoa allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm aoa allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.paperclip/instances/default/config.json` |
| Database | `~/.paperclip/instances/default/db` |
| Logs | `~/.paperclip/instances/default/logs` |
| Storage | `~/.paperclip/instances/default/data/storage` |
| Secrets key | `~/.paperclip/instances/default/secrets/master.key` |

Override with:

```sh
AOA_HOME=/custom/home AOA_INSTANCE_ID=dev pnpm aoa run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm aoa run --data-dir ./tmp/paperclip-dev
pnpm aoa doctor --data-dir ./tmp/paperclip-dev
```
