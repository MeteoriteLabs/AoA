import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  heartbeatRuns,
  organizations,
  type Db,
} from "@armyofagents/db";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import {
  claimQueuedRunsWithOrgCapacity,
  dispatchQueuedAgentsForOrg,
} from "../services/org-concurrency.js";

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
  initdbFlags?: string[];
}) => EmbeddedPostgresInstance;

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";

describe.skipIf(process.platform !== "linux")("atomic org concurrency claims", () => {
  let db: Db;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-org-claim-"));
    const port = await allocateEmbeddedPgPort();
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${port}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);
  }, 180_000);

  afterAll(async () => {
    try { if (pg) await pg.stop(); } catch { /* ignore */ }
    try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }, 60_000);

  it("does not oversubscribe cap=1 when two agents claim concurrently", async () => {
    const orgId = randomUUID();
    const companyA = randomUUID();
    const companyB = randomUUID();
    const agentA = randomUUID();
    const agentB = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Claim Org", slug: `claim-${orgId}`, concurrencyCap: 1 });
    await db.insert(companies).values([
      { id: companyA, organizationId: orgId, name: "Claim A", issuePrefix: "CLA" },
      { id: companyB, organizationId: orgId, name: "Claim B", issuePrefix: "CLB" },
    ]);
    await db.insert(agents).values([
      { id: agentA, companyId: companyA, name: "Agent A" },
      { id: agentB, companyId: companyB, name: "Agent B" },
    ]);
    const insertedRuns = await db.insert(heartbeatRuns).values([
      { companyId: companyA, agentId: agentA, status: "queued" },
      { companyId: companyB, agentId: agentB, status: "queued" },
    ]).returning();

    const [claimsA, claimsB] = await Promise.all([
      claimQueuedRunsWithOrgCapacity(db, { organizationId: orgId, agentId: agentA, perAgentCap: 1 }),
      claimQueuedRunsWithOrgCapacity(db, { organizationId: orgId, agentId: agentB, perAgentCap: 1 }),
    ]);
    expect(claimsA.length + claimsB.length).toBe(1);

    const afterRace = await db
      .select()
      .from(heartbeatRuns)
      .where(inArray(heartbeatRuns.id, insertedRuns.map((run) => run.id)));
    expect(afterRace.filter((run) => run.status === "running")).toHaveLength(1);
    expect(afterRace.filter((run) => run.status === "queued")).toHaveLength(1);

    const running = afterRace.find((run) => run.status === "running")!;
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, running.id));
    // The completing agent queues again after the cross-agent loser. The
    // production dispatcher receives only the Organization, not the loser id,
    // and must give the older queued work the newly available slot.
    await db.insert(heartbeatRuns).values({
      companyId: running.companyId,
      agentId: running.agentId,
      status: "queued",
      createdAt: new Date(Date.now() + 1_000),
    });
    const nextClaims = await dispatchQueuedAgentsForOrg(db, orgId, (candidateAgentId) =>
      claimQueuedRunsWithOrgCapacity(db, {
        organizationId: orgId,
        agentId: candidateAgentId,
        perAgentCap: 1,
      }));
    expect(nextClaims).toHaveLength(1);
    expect(nextClaims[0]!.agentId).not.toBe(running.agentId);
  });

  it("continues past an older agent at its per-agent cap", async () => {
    const orgId = randomUUID();
    const companyId = randomUUID();
    const cappedAgentId = randomUUID();
    const eligibleAgentId = randomUUID();
    await db.insert(organizations).values({
      id: orgId,
      name: "Head-of-line Org",
      slug: `hol-${orgId}`,
      concurrencyCap: 2,
    });
    await db.insert(companies).values({
      id: companyId,
      organizationId: orgId,
      name: "Head-of-line Company",
      issuePrefix: "HOL",
    });
    await db.insert(agents).values([
      { id: cappedAgentId, companyId, name: "Capped Agent" },
      { id: eligibleAgentId, companyId, name: "Eligible Agent" },
    ]);
    const now = Date.now();
    await db.insert(heartbeatRuns).values([
      { companyId, agentId: cappedAgentId, status: "running", createdAt: new Date(now - 3_000) },
      { companyId, agentId: cappedAgentId, status: "queued", createdAt: new Date(now - 2_000) },
      { companyId, agentId: eligibleAgentId, status: "queued", createdAt: new Date(now - 1_000) },
    ]);

    const claims = await dispatchQueuedAgentsForOrg(db, orgId, (candidateAgentId) =>
      claimQueuedRunsWithOrgCapacity(db, {
        organizationId: orgId,
        agentId: candidateAgentId,
        perAgentCap: 1,
      }));

    expect(claims).toHaveLength(1);
    expect(claims[0]!.agentId).toBe(eligibleAgentId);
  });
});
