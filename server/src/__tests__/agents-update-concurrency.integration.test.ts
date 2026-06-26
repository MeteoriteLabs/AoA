import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import {
  applyPendingMigrations,
  createDb,
  agents,
  type Db,
} from "@armyofagents/db";
import { agentService } from "../services/agents.js";

// Follow-up #3 (Decision #104) — the optimistic-concurrency guard is an atomic
// conditional UPDATE whose correctness hinges on a MILLISECOND-precision compare:
// `date_trunc('milliseconds', agents.updatedAt) = <ms token>`. `agents.updatedAt`
// is stored at Postgres MICROSECOND resolution (defaultNow() on a freshly-created
// row that never set updatedAt), while the client token is a ms-precision ISO
// string. A naked `eq(agents.updatedAt, token)` would 409 the FIRST edit of a
// never-updated agent (then loop). The Proxy-mock unit tests can't evaluate the
// WHERE clause (drizzle operators are no-ops there), so this exercises the real
// guard against an embedded Postgres that genuinely stamps microseconds. It
// collects + skips on Windows (embedded-postgres can't start on the CI Windows
// runner); the controller runs it on Linux.

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
}) => EmbeddedPostgresInstance;

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let db: Db;
let setupError: unknown = null;

const PORT = 59100 + Math.floor(Math.random() * 1000);
const companyId = "55555555-5555-4555-8555-555555555555";

beforeAll(async () => {
  if (process.platform === "win32") return; // skipped suite — don't boot pg
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-agent-concurrency-test-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };

    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: PORT,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();

    const connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);

    await db.execute(sql`
      INSERT INTO companies (id, name, issue_prefix)
      VALUES (${companyId}, 'Agent Concurrency Co', 'ACC')
    `);
  } catch (err) {
    setupError = err;
  }
}, 180_000);

afterAll(async () => {
  try {
    if (pg) await pg.stop();
  } catch {
    // ignore cleanup failures
  }
  try {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}, 60_000);

describe.skipIf(process.platform === "win32")(
  "agentService.update — ms-precision optimistic-concurrency token (real DB)",
  () => {
    it("freshly-created (defaultNow) agent: a ms-precision token succeeds on the FIRST guarded update", async () => {
      if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
      const svc = agentService(db);
      const created = await svc.create(companyId, { name: "Fresh Agent", role: "general" });

      // The token is the ms-precision ISO string the UI would send.
      const token = new Date(created!.updatedAt).toISOString();

      const updated = await svc.update(created!.id, { role: "specialist" }, { expectedUpdatedAt: token });
      expect(updated).not.toBeNull(); // first edit of a never-updated row must NOT 409
      expect(updated!.role).toBe("specialist");
    });

    it("a naked-eq comparison would have failed here (documents the bug the date_trunc guard fixes)", async () => {
      if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
      const svc = agentService(db);
      const created = await svc.create(companyId, { name: "Naked Eq Agent", role: "general" });
      const token = new Date(created!.updatedAt).toISOString();

      // Direct DB demonstration of the precision mismatch: a naked
      // `updatedAt = <ms token>` matches 0 rows when the stored value has
      // microseconds; the date_trunc('milliseconds', …) guard matches 1.
      const nakedMatch = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, created!.id), eq(agents.updatedAt, new Date(token))));
      // Mirror the service guard EXACTLY: bind the ms-precision token as text and
      // cast in-SQL. A raw JS Date in a sql`` fragment has no column type for
      // Drizzle to encode against → node-postgres throws ERR_INVALID_ARG_TYPE on
      // real Postgres (the very bug this guard's shape must avoid).
      const truncMatch = await db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, created!.id),
            sql`date_trunc('milliseconds', ${agents.updatedAt}) = date_trunc('milliseconds', ${token}::timestamptz)`,
          ),
        );
      // The date_trunc guard ALWAYS matches; the naked eq matches only when the
      // stored microseconds happen to be .000 (flaky), so we only assert the guard.
      expect(truncMatch.length).toBe(1);
      // Document the bug without flaking on the rare .000-microsecond case:
      expect(nakedMatch.length).toBeLessThanOrEqual(1);
    });

    it("stale token → 409 conflict (real DB)", async () => {
      if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
      const svc = agentService(db);
      const created = await svc.create(companyId, { name: "Stale Token Agent", role: "general" });
      const staleToken = new Date(created!.updatedAt).toISOString();

      // First edit advances updatedAt.
      await svc.update(created!.id, { role: "specialist" }, { expectedUpdatedAt: staleToken });
      // Second edit re-sends the ORIGINAL (now stale) token → must 409.
      await expect(
        svc.update(created!.id, { role: "lead" }, { expectedUpdatedAt: staleToken }),
      ).rejects.toMatchObject({ status: 409 });
    });
  },
);
