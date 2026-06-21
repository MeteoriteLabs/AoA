---
title: Docker
summary: Docker Compose quickstart
---

Run AoA in Docker without installing Node or pnpm locally.

## Compose Quickstart (Recommended)

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

Open [http://localhost:3100](http://localhost:3100).

Defaults:

- Host port: `3100`
- Data directory (host side): `./data/docker-aoa`
- Data directory (in-container): `/paperclip` — matches `AOA_HOME` in the published `Dockerfile`. Treat this as wire-compat with existing bind mounts; renaming the in-container path is a coordinated change with the Dockerfile (deferred).

Override with environment variables:

```sh
AOA_PORT=3200 AOA_DATA_DIR=./data/pc \
  docker compose -f docker-compose.quickstart.yml up --build
```

## Manual Docker Build

The image defaults to `AOA_DEPLOYMENT_MODE=authenticated` (see the `Dockerfile`), which **requires** `BETTER_AUTH_SECRET` — the server refuses to boot without it. Generate one with `openssl rand -base64 32`:

```sh
docker build -t aoa-local .
docker run --name aoa \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e AOA_HOME=/paperclip \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -v "$(pwd)/data/docker-aoa:/paperclip" \
  aoa-local
```

The in-container path stays `/paperclip` because that's the `AOA_HOME` default baked into the published `Dockerfile`. The host-side path (`./data/docker-aoa`), image tag (`aoa-local`), and container name (`aoa`) are user-chosen — pick anything you like.

## Data Persistence

All data is persisted under the bind mount (host: `./data/docker-aoa`, container: `/paperclip`):

- Embedded PostgreSQL data
- Uploaded assets
- Local secrets key
- Agent workspace data

## Claude and Codex Adapters in Docker

The Docker image pre-installs:

- `claude` (Anthropic Claude Code CLI)
- `codex` (OpenAI Codex CLI)

Pass API keys to enable local adapter runs inside the container:

```sh
docker run --name aoa \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e AOA_HOME=/paperclip \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-... \
  -v "$(pwd)/data/docker-aoa:/paperclip" \
  aoa-local
```

`BETTER_AUTH_SECRET` is required because the image defaults to authenticated deployment mode (generate with `openssl rand -base64 32`); the API keys are optional and only enable local adapter runs.

Without API keys, the app runs normally — adapter environment checks will surface missing prerequisites.
