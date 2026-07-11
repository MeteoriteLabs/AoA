---
title: Docker
summary: Docker Compose deployment
---

Run AoA in Docker without installing Node or pnpm locally.

## Compose Deployment

The default `docker-compose.yml` is the recommended remote-dev deployment. It starts:

- `server`: the AoA API, UI, workers, adapters, and plugin runtime on port `3100`
- `db`: PostgreSQL with pgvector enabled via `pgvector/pgvector:pg18`
- `bootstrap`: a one-shot helper that prints the first CEO invite URL after the server is healthy

```sh
docker compose up --build
```

For a remote instance, set the URL users will open before the first boot:

```sh
AOA_PUBLIC_URL=https://aoa-dev.example.com docker compose up --build -d
docker compose logs bootstrap
```

If you are exposing the container directly during early testing, `AOA_PUBLIC_URL=http://<server-ip>:3100` is enough. Behind a reverse proxy, also set `AOA_TRUST_PROXY=1`; for a public internet deployment set `AOA_DEPLOYMENT_EXPOSURE=public`.

Defaults:

- Host port: `3100` (`AOA_PORT=3200` changes it)
- App data volume: `aoa-data` mounted at `/paperclip`
- Database volume: `aoa-postgres`
- Database URL: `postgres://paperclip:paperclip@db:5432/paperclip`
- Image tag: `aoa:local`

Existing Docker Compose installs that used the older `pgdata` and
`paperclip-data` named volumes are not migrated automatically by this stack.
The database image now uses Postgres 18 with pgvector and mounts storage at
`/var/lib/postgresql`. Do not point the new `aoa-postgres` volume directly at
an old Postgres 17 data directory; take a `pg_dump`/backup from the old stack
and restore it into the new database.

On a blank `/paperclip` volume, the entrypoint creates:

- `/paperclip/instances/default/config.json`
- `/paperclip/instances/default/.env` with generated `BETTER_AUTH_SECRET` and `AOA_AGENT_JWT_SECRET`
- local storage, logs, backup, secrets, and workspace directories

Pending migrations are applied automatically in the Compose stack with `AOA_MIGRATION_AUTO_APPLY=true`.

To generate another CEO invite later:

```sh
BOOTSTRAP_FORCE=true docker compose run --rm bootstrap
```

Without `BOOTSTRAP_FORCE=true`, the bootstrap helper exits cleanly when the
instance already has an admin user.

To open a psql shell against the bundled database:

```sh
docker compose --profile tools run --rm psql
```

## Configuration

Common overrides can be passed as environment variables:

```sh
AOA_PORT=3200 \
AOA_PUBLIC_URL=https://aoa-dev.example.com \
OPENAI_API_KEY=sk-... \
ANTHROPIC_API_KEY=sk-... \
docker compose up --build -d
```

Provider keys are optional. Without them, the app still boots; adapter health checks will report missing prerequisites until keys or CLI auth are configured.

Compose-specific variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `AOA_IMAGE` | `aoa:local` | Image tag used by the `server` and `bootstrap` services. |
| `USER_UID`, `USER_GID` | `1000` | Runtime UID/GID for the `node` user inside the image. |
| `AOA_BIND_ADDRESS` | `0.0.0.0` | Host interface used for the published app port. |
| `AOA_PORT` | `3100` | Host port mapped to container port `3100`. |
| `AOA_INSTANCE_ID` | `default` | Instance directory under `/paperclip/instances/`. |
| `AOA_POSTGRES_IMAGE` | `pgvector/pgvector:pg18` | Database image used by the default Compose stack and `psql` tool profile. |
| `AOA_POSTGRES_USER` | `paperclip` | Database user. |
| `AOA_POSTGRES_PASSWORD` | `paperclip` | Database password. Set this for shared or long-lived deployments. |
| `AOA_POSTGRES_DB` | `paperclip` | Database name. |
| `AOA_MIGRATION_AUTO_APPLY` | `true` | Applies pending migrations during container startup. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY_PEM`, `GITHUB_APP_WEBHOOK_SECRET` | empty | Optional GitHub App integration variables. Names match `.env.example` and server expectations. |
| `AOA_DATA_DIR` | `./data/docker-aoa` | Quickstart-only host bind path for `docker-compose.quickstart.yml`. The default multi-service stack uses named volumes. |

For S3-compatible storage:

```sh
AOA_STORAGE_PROVIDER=s3 \
AOA_STORAGE_S3_BUCKET=aoa-artifacts \
AOA_STORAGE_S3_REGION=us-east-1 \
docker compose up --build -d
```

The image includes git, GitHub CLI, curl/wget, ripgrep, Python, OpenSSH, jq, psql/pg_dump, Docker CLI, Claude Code, Codex, Gemini CLI, and OpenCode. Mounting `/var/run/docker.sock` is intentionally not enabled by default because it gives the container root-equivalent access to the host; add a local Compose override only for deployments that explicitly need sandbox-docker execution.

## Single-Container Quickstart

For quick local trials, `docker-compose.quickstart.yml` runs one AoA container with embedded PostgreSQL:

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

Data is bind-mounted by default at `./data/docker-aoa` on the host and `/paperclip` in the container.

Generate the first CEO invite from inside the running container:

```sh
docker compose -f docker-compose.quickstart.yml exec \
  -e BOOTSTRAP_BASE_URL=http://localhost:3100 \
  aoa node --import ./server/node_modules/tsx/dist/loader.mjs \
  scripts/docker-bootstrap-ceo.mjs
```

Override quickstart paths and ports with:

```sh
AOA_PORT=3200 AOA_DATA_DIR=./data/aoa-dev \
  docker compose -f docker-compose.quickstart.yml up --build
```

## Manual Docker Run

Build and run the image directly:

```sh
docker build -t aoa-local .
docker run --name aoa \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e AOA_HOME=/paperclip \
  -e AOA_PUBLIC_URL=http://localhost:3100 \
  -v aoa-data:/paperclip \
  aoa-local
```

With no `DATABASE_URL`, this uses embedded PostgreSQL. To use an external database:

```sh
docker run --name aoa \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e AOA_HOME=/paperclip \
  -e DATABASE_URL=postgres://paperclip:paperclip@db:5432/paperclip \
  -v aoa-data:/paperclip \
  aoa-local
```

The auth secrets are generated on first boot and persisted under `/paperclip/instances/default/.env`. You may still pass `BETTER_AUTH_SECRET` and `AOA_AGENT_JWT_SECRET` explicitly if secrets are managed outside the container.

## Data Persistence

The `/paperclip` volume stores instance config, generated secrets, local encrypted-secret key material, uploaded assets, run logs, backups, and agent workspace data. Do not run authenticated deployments without a durable `/paperclip` mount or volume.
