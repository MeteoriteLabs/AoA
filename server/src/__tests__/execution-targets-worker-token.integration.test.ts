// Real-Postgres proof for the rotatable worker token (Finding #3). The
// execution-target row id is NO LONGER a credential; a separately-issued
// token (hash stored, plaintext shown once) is. Also proves environmentService
// surfaces the executionTargetId FK but never the worker secret.
// Linux-only in CI (skipIf); Windows runs it via the temporary flip documented
// in the batch plan. Windows-visible unit coverage lives in
// execution-targets-worker-token.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, executionTargets, type Db } from "@armyofagents/db";
import {
  createWorkerToken,
  hashWorkerToken,
  registerWorkerHeartbeat,
  resolveWorkerTargetId,
} from "../services/execution-targets.js";
import { environmentService } from "../services/environments.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
}) => EmbeddedPostgresInstance;

const ORG = "00000000-0000-0000-0000-0000000000d1";
const CO = "00000000-0000-0000-0000-0000000000d2";
const PORT = 56000 + Math.floor(Math.random() * 1000);

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let db: Db;
let setupError: unknown = null;

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-wtk-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: EmbeddedPostgresCtor };
    pg = new EmbeddedPostgres({ databaseDir: join(dataDir, "db"), user: "test", password: "test", port: PORT, persistent: false });
    await pg.initialise();
    await pg.start();
    const url = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(url);
    db = createDb(url);
    await db.execute(sql`INSERT INTO organizations (id, name, slug) VALUES (${ORG}, 'Org WTK', 'org-wtk')`);
    await db.execute(sql`INSERT INTO companies (id, name, issue_prefix, organization_id) VALUES (${CO}, 'Co WTK', 'WTK', ${ORG})`);
  } catch (e) {
    setupError = e;
  }
}, 180_000);

afterAll(async () => {
  try { if (pg) await pg.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

describe.skipIf(process.platform === "win32")("worker token round-trip (real DB, Finding #3)", () => {
  it("an issued token authorizes; the raw row id does NOT", async () => {
    if (setupError) throw new Error(String(setupError));
    const token = createWorkerToken();
    const [row] = await db
      .insert(executionTargets)
      .values({ organizationId: ORG, slug: "wkr-1", kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "offline", workerTokenHash: hashWorkerToken(token) })
      .returning();
    expect(await resolveWorkerTargetId(db, token)).toBe(row!.id); // token → id
    expect(await resolveWorkerTargetId(db, row!.id)).toBeNull(); // raw PK → nothing
    const { updated } = await registerWorkerHeartbeat(db, { targetId: row!.id, status: "active" });
    expect(updated).toBe(1);
  }, 90_000);

  it("rotating the token invalidates the old one", async () => {
    if (setupError) throw new Error(String(setupError));
    const token1 = createWorkerToken();
    const [row] = await db
      .insert(executionTargets)
      .values({ organizationId: ORG, slug: "wkr-2", kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "offline", workerTokenHash: hashWorkerToken(token1) })
      .returning();
    const token2 = createWorkerToken();
    await db.execute(sql`UPDATE execution_targets SET worker_token_hash = ${hashWorkerToken(token2)} WHERE id = ${row!.id}`);
    expect(await resolveWorkerTargetId(db, token1)).toBeNull();
    expect(await resolveWorkerTargetId(db, token2)).toBe(row!.id);
  }, 90_000);

  it("environmentService exposes the executionTargetId FK but NEVER the worker secret", async () => {
    if (setupError) throw new Error(String(setupError));
    const token = createWorkerToken();
    const [target] = await db
      .insert(executionTargets)
      .values({ organizationId: ORG, slug: "wkr-3", kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "active", workerTokenHash: hashWorkerToken(token) })
      .returning();
    await db.execute(sql`INSERT INTO environments (company_id, name, execution_target_id) VALUES (${CO}, 'prod', ${target!.id})`);
    const got = (await environmentService(db).list(CO))[0]! as Record<string, unknown>;
    expect(got.executionTargetId).toBe(target!.id); // FK id present (now inert)...
    expect("workerTokenHash" in got).toBe(false); // ...secret absent
    expect("workerToken" in got).toBe(false);
  }, 90_000);
});
