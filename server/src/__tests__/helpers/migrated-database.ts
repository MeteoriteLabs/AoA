// server/src/__tests__/helpers/migrated-database.ts
//
// The MINIMAL embedded-Postgres bootstrap for suites that need a real, fully-migrated
// database and a real non-owner `aoa_app` connection — nothing more.
//
// `distributed-execution-db-startup.integration.test.ts` has a bootstrap too, but its
// `beforeAll` is entangled with three extra databases and a legacy table-owner role
// because its own assertions need them. Copying that wholesale into a suite that needs
// one database is how a second, subtly-divergent bootstrap gets written. This is the
// shared one: start it, use it, tear it down.
//
// Callers are responsible for skipping on Windows without AOA_RUN_WIN_INTEGRATION=1
// (embedded-postgres cannot start on the `runneradmin` CI runner — Issue #114).

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import {
  applyPendingMigrations,
  createTenantAppDbConnection,
  type Db,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import { provisionTenantAppRoleLoginSql } from "../../db/rls-tenant.js";
import { allocateEmbeddedPgPort } from "./embedded-pg-port.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

export type MigratedDatabase = {
  /** Superuser/owner client. Seed through this — migrations run as the database owner. */
  readonly admin: Sql;
  /** Drizzle Db on the NON-OWNER `aoa_app` login role. Read through this. */
  readonly appDb: Db;
  readonly teardown: () => Promise<void>;
};

export async function startMigratedDatabase(
  options: { label?: string; appPassword?: string } = {},
): Promise<MigratedDatabase> {
  const label = options.label ?? "aoa-migrated-db-";
  const password = options.appPassword ?? "migrated-database-app-password";
  const dataDir = await mkdtemp(join(tmpdir(), label));
  const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
    default: EmbeddedPostgresCtor;
  };
  const port = await allocateEmbeddedPgPort();
  const embedded = new EmbeddedPostgres({
    databaseDir: join(dataDir, "db"),
    user: "test",
    password: "test",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  let admin: Sql | null = null;
  let app: NonOwnerDbConnection | null = null;
  const teardown = async () => {
    await app?.close({ timeoutSeconds: 5 }).catch(() => {});
    await admin?.end().catch(() => {});
    await embedded.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  };
  try {
    await embedded.initialise();
    await embedded.start();
    const adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await applyPendingMigrations(adminUrl);
    admin = postgres(adminUrl, { max: 2 });
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", password));
    app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${password}`), {
      max: 4,
    });
    return { admin, appDb: app.db, teardown };
  } catch (error) {
    await teardown();
    throw error;
  }
}
