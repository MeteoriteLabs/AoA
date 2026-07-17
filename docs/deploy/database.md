---
title: Database
summary: Embedded Postgres vs Docker Postgres vs hosted
---

AoA uses PostgreSQL via Drizzle ORM. There are three ways to run the database. The "embedded" mode bundles a real Postgres binary via [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) — **not** WASM-based PGlite. Drop-in compatibility with regular Postgres clients, dump tools, and migrations.

## 1. Embedded PostgreSQL (Default)

Zero config. If you don't set `DATABASE_URL`, the server starts an embedded PostgreSQL instance automatically.

```sh
pnpm dev
```

On first start, the server:

1. Creates `~/.aoa/instances/default/db/` for storage (legacy `~/.paperclip/` is still used as a fallback if it exists and `~/.aoa/` does not, see `cli/src/config/home.ts`)
2. Ensures the `paperclip` database exists (database NAME inside Postgres is wire-compat with the embedded cluster bootstrap, separate from the AoA brand)
3. Runs migrations automatically
4. Starts serving requests

Data persists across restarts. To reset: `rm -rf ~/.aoa/instances/default/db`.

The Docker quickstart also uses embedded PostgreSQL by default.

## 2. Docker Compose PostgreSQL

The default Docker Compose stack runs AoA with a durable PostgreSQL database that includes pgvector:

```sh
docker compose up --build -d
```

Inside the stack, the server gets `DATABASE_URL=postgres://paperclip:paperclip@db:5432/paperclip` automatically. The database is not published on `localhost:5432` by default; it is only reachable by services on the Compose network.

Open a psql shell with:

```sh
docker compose --profile tools run --rm psql
```

If you want to run the Node server on the host while using the Compose database, add a local override that publishes Postgres:

```yaml
services:
  db:
    ports:
      - "5432:5432"
```

Then set the connection string for the host process.

> **The server does NOT auto-load a repo-root `.env`.** It only reads `.env` from the AoA config directory — the directory containing the active `config.json` (default `~/.aoa/instances/default/`, or the nearest `.aoa/config.json` found by walking up from the working directory; see `server/src/paths.ts` and `server/src/config.ts`). Copying `.env.example` to the repo root has no effect. Either set `DATABASE_URL` inline / export it in your shell, or place the `.env` in the config directory.

```sh
# Either export it for the session:
export DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip
# …or write it into the AoA config dir's .env (NOT the repo root):
#   ~/.aoa/instances/default/.env
```

Push the schema:

```sh
DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip \
  npx drizzle-kit push
```

## 3. Hosted PostgreSQL (Supabase)

For production, use a hosted provider like [Supabase](https://supabase.com/).

1. Create a project at [database.new](https://database.new)
2. Copy the connection string from Project Settings > Database
3. Set `DATABASE_URL` in your `.env`

Use the **direct connection** (port 5432) for migrations and the **pooled connection** (port 6543) for the application.

If using connection pooling, disable prepared statements:

```ts
// packages/db/src/client.ts
export function createDb(url: string) {
  const sql = postgres(url, { prepare: false });
  return drizzlePg(sql, { schema });
}
```

## Switching Between Modes

| `DATABASE_URL` | Mode |
|----------------|------|
| Not set | Embedded PostgreSQL |
| `postgres://...localhost...` | Local Docker PostgreSQL |
| `postgres://...supabase.com...` | Hosted Supabase |

The Drizzle schema (`packages/db/src/schema/`) is the same regardless of mode.

## Backups

AoA includes a built-in backup utility in `packages/db/src/backup-lib.ts`. It exports `runDatabaseBackup` and `runDatabaseRestore`.

### Scope

Backups include **all non-system schemas** — `public`, `drizzle`, and any other user-created schemas. This means the Drizzle migration journal (`drizzle.__drizzle_migrations`) is always included, so restored databases reflect the correct migration state and never enter a "pending migrations" limbo.

System schemas (`pg_catalog`, `information_schema`, `pg_toast*`, `pg_temp_*`) are excluded.

### Backup engine

`runDatabaseBackup` selects an engine automatically (`backupEngine: "auto"`):

- **pg_dump** — used when no `excludeTables` / `nullifyColumns` transforms are configured. Produces a gzip-compressed SQL file.
- **JavaScript** — fallback when pg_dump is unavailable or when transforms are required. Uses `COPY … FROM stdin` for bulk tables (requires psql on restore) or `INSERT` statements when `backupEngine: "javascript"` is explicitly set.

### Retention policies

Two modes:

| Mode | Config |
|------|--------|
| Count | `{ mode: "count", count: N }` — keep the N newest backup files |
| Tiered | `{ dailyDays, weeklyWeeks, monthlyMonths }` — rolling daily/weekly/monthly windows |

The default policy (`DEFAULT_BACKUP_RETENTION`) keeps 7 daily, 4 weekly, and 1 monthly backup.

### Restore

`runDatabaseRestore` tries `psql` first. If psql is unavailable and the backup file contains AoA statement breakpoints, it falls back to the JavaScript runner (statement-by-statement via the `postgres` client). Legacy backups without breakpoints require psql.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `AOA_PG_DUMP_PATH` | Override path to the `pg_dump` binary |
| `AOA_PSQL_PATH` | Override path to the `psql` binary |
