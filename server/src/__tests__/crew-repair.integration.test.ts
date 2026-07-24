/**
 * T2.3b — crew provisioning is REPAIRABLE after a degraded bootstrap.
 *
 * T2.3 made a company *born* updateable, but only at one instant: any degrade
 * during company create (CDN blip, cold cache, deadline, crash) stamps the crew
 * `…@legacy`, and `crew-updater.ts:151` skips those rows forever. This suite
 * proves the degraded states are recoverable — and, just as importantly, that
 * the obvious recovery (re-run `provisionCompanyCrew`) is the WRONG one for the
 * state that matters most, which is why repair diagnoses first.
 *
 * Real PostgreSQL: every assertion is about rows (origins, versions, the team
 * row, team_members, the install operation) and about whether the real
 * `checkCrewUpdates` walks this company. A mocked DB could only prove functions
 * were called.
 *
 * `globalThis.fetch` is a fixture server; the gitignored
 * `ui/src/aoa-marketplace-snapshot.json` is never read (it is injected).
 *
 * Skipped on Windows by default (CI's `runneradmin` account can't start
 * embedded-postgres — Issue #114); Linux CI is the authoritative gate. On a
 * Windows dev box set `AOA_RUN_WIN_INTEGRATION=1` to run it for real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";
import {
  MarketplaceCatalogService,
  registerMarketplaceCatalogService,
} from "../services/aoa-marketplace.js";
import { companyService } from "../services/companies.js";
import { provisionCompanyCrew } from "../services/crew-provisioning.js";
import {
  CREW_REPAIR_COOLDOWN_MS,
  diagnoseCrewProvisioning,
  repairCompanyCrew,
  resetCrewRepairCooldowns,
  runCrewRepairPass,
} from "../services/crew-repair.js";
import { checkCrewUpdates } from "../services/marketplace-install/crew-updater.js";
import { ensureInfrastructureAgents } from "../services/internal-agent/aoa-agents/crew-seeding.js";
import { backfillCrewTemplateOrigin } from "../services/internal-agent/aoa-agents/backfill-template-origin.js";
import type { AgentInstructionsServiceLike } from "../services/marketplace-install/agent-create.js";

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
let db: Db;
let setupError: unknown = null;

const PORT = 58500 + Math.floor(Math.random() * 400);

const FIXTURE_CDN_URL = "https://cdn.repairfixture.invalid/catalog.json";
const FIXTURE_HOST = "https://raw.repairfixture.invalid";

const TEAM_ID = "team:aoa-curated/default-crew";
const SCOUT_ID = "agent:aoa-curated/aoa-scout";
const REVIEWER_ID = "agent:aoa-curated/aoa-reviewer";
const SKILL_ID = "skill:aoa-curated/fixture-crew-skill";

let seedCounter = 0;
function nextIssuePrefix(): string {
  seedCounter += 1;
  return `RP${seedCounter}`;
}

function rowsOf<T>(result: unknown): T[] {
  const asObj = result as { rows?: T[] };
  return asObj?.rows ?? (result as T[]);
}

// ── Fixture catalog (mirrors the T2.3 suite's shape) ─────────────────────────

function catalogItemBase(id: string, type: string, name: string, version = "1.0.0") {
  return {
    id,
    type,
    name,
    description: `${name} fixture`,
    version,
    source: {
      adapter: "aoa-curated",
      url: "https://github.com/MeteoriteLabs/aoa-marketplace",
      locator: `content/${id}`,
    },
    trust: { tier: "verified", source: "aoa-curated" },
    status: "active",
    addedAt: "2026-07-24T00:00:00.000Z",
    category: "workflows",
    tags: ["official"],
  };
}

function buildCatalog(version = "1.0.0"): MarketplaceCatalogFile {
  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-07-24T00:00:00.000Z",
    itemCount: 4,
    items: [
      {
        ...catalogItemBase(TEAM_ID, "team", "AoA Default Crew", version),
        resourceUrl: `${FIXTURE_HOST}/teams/default-crew/team.json`,
        requires: [
          { type: "agent", id: SCOUT_ID },
          { type: "agent", id: REVIEWER_ID },
          { type: "skill", id: SKILL_ID },
        ],
      },
      {
        ...catalogItemBase(SCOUT_ID, "agent", "Scout", version),
        resourceUrl: `${FIXTURE_HOST}/agents/aoa-scout/agent.json`,
      },
      {
        ...catalogItemBase(REVIEWER_ID, "agent", "Reviewer", version),
        resourceUrl: `${FIXTURE_HOST}/agents/aoa-reviewer/agent.json`,
      },
      {
        ...catalogItemBase(SKILL_ID, "skill", "Fixture Crew Skill", version),
        content: { inline: "---\nname: fixture-crew-skill\n---\n\nDo the thing.\n" },
      },
    ],
  } as unknown as MarketplaceCatalogFile;
}

const FIXTURE_CATALOG = buildCatalog();

function agentTemplate(id: string, name: string, triggerRole: string) {
  return JSON.stringify({
    schemaVersion: "agent.v1",
    id,
    name,
    description: `${name} fixture agent`,
    instructions: { type: "inline", content: `You are ${name}.` },
    aoa: {
      kind: "aoa",
      adapterType: "claude_local",
      skillKeys: [SKILL_ID],
      install: { defaultStatus: "active", defaultRole: "general" },
      triggers: [{ kind: "mention", config: { role: triggerRole } }],
    },
  });
}

const TEAM_TEMPLATE = JSON.stringify({
  slug: "aoa-default-crew",
  description: "Fixture crew",
  manifest: { installOrder: [SCOUT_ID, REVIEWER_ID] },
  agents: [
    { templateOrigin: SCOUT_ID, name: "Scout" },
    { templateOrigin: REVIEWER_ID, name: "Reviewer" },
  ],
});

const FIXTURE_BODIES: Record<string, string> = {
  [`${FIXTURE_HOST}/teams/default-crew/team.json`]: TEAM_TEMPLATE,
  [`${FIXTURE_HOST}/agents/aoa-scout/agent.json`]: agentTemplate("aoa-scout", "Scout", "scout"),
  [`${FIXTURE_HOST}/agents/aoa-reviewer/agent.json`]: agentTemplate("aoa-reviewer", "Reviewer", "reviewer"),
};

let realFetch: typeof globalThis.fetch;
let cdnReachable = false;
const brokenUrls = new Set<string>();

function installFixtureFetch() {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    if (url === FIXTURE_CDN_URL) {
      if (!cdnReachable) throw new TypeError("fetch failed (simulated: CDN unreachable)");
      return new Response(JSON.stringify(FIXTURE_CATALOG), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (brokenUrls.has(url)) return new Response("upstream unavailable", { status: 503 });
    const body = FIXTURE_BODIES[url];
    if (body === undefined) return new Response(`no fixture for ${url}`, { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
}

/**
 * Instruction materialization is not what this suite is about, and the real
 * service writes bundles to disk. The stub keeps the agent's existing
 * adapterConfig so an assertion about a founder's adapter surviving adoption is
 * about adoption, not about the stub.
 */
const instructionsService: AgentInstructionsServiceLike = {
  materializeManagedBundle: async (agent) => ({
    adapterConfig: (agent.adapterConfig as Record<string, unknown>) ?? {},
  }),
};

async function clearCatalogCache() {
  await db.execute(sql`DELETE FROM marketplace_catalog_cache`);
}

function makeService(snapshot: MarketplaceCatalogFile | null = FIXTURE_CATALOG) {
  return new MarketplaceCatalogService({
    db,
    cdnUrl: FIXTURE_CDN_URL,
    bundledSnapshotProvider: async () => snapshot,
  });
}

/** Register a working catalog (via the bundled-snapshot fallback — no network). */
async function withCatalog(): Promise<void> {
  await clearCatalogCache();
  const service = makeService();
  await service.sync();
  registerMarketplaceCatalogService(service);
}

interface CrewRow {
  id: string;
  name: string;
  template_origin: string | null;
  template_version: string | null;
  skill_keys: string[];
  title: string | null;
}

async function crewRows(companyId: string): Promise<CrewRow[]> {
  return rowsOf<CrewRow>(
    await db.execute(sql`
      SELECT id, name, template_origin, template_version, skill_keys, title
      FROM agents WHERE company_id = ${companyId} AND kind = 'aoa' ORDER BY name
    `),
  );
}

async function teamRowCount(companyId: string): Promise<number> {
  const rows = rowsOf<{ n: string }>(
    await db.execute(sql`
      SELECT count(*)::text AS n FROM teams
      WHERE company_id = ${companyId} AND template_origin = ${TEAM_ID}
    `),
  );
  return Number(rows[0].n);
}

async function operationRow(companyId: string) {
  return rowsOf<{ status: string; error_message: string | null; result_entity_id: string | null }>(
    await db.execute(sql`
      SELECT status, error_message, result_entity_id
      FROM marketplace_install_operations WHERE company_id = ${companyId}
    `),
  );
}

async function pendingUpdateItemIds(companyId: string): Promise<string[]> {
  return rowsOf<{ catalog_item_id: string }>(
    await db.execute(sql`
      SELECT catalog_item_id FROM marketplace_pending_updates WHERE company_id = ${companyId}
    `),
  ).map((r) => r.catalog_item_id);
}

const NOTIFY_SETTINGS = {
  agentUpdatePolicy: "notify",
  updateWindow: "anytime",
} as unknown as Parameters<typeof checkCrewUpdates>[0]["settings"];

/**
 * Does the real update pipeline WALK this company? The load-bearing question —
 * "repaired" means nothing if `crew-updater` still skips the rows.
 */
async function updatePipelineSeesCompany(companyId: string): Promise<boolean> {
  await db.execute(sql`DELETE FROM marketplace_pending_updates WHERE company_id = ${companyId}`);
  await checkCrewUpdates({
    db,
    companyId,
    catalogItems: buildCatalog("2.0.0").items as CatalogItem[],
    settings: NOTIFY_SETTINGS,
    instructionsService,
  });
  return (await pendingUpdateItemIds(companyId)).includes(SCOUT_ID);
}

/** A company whose crew came from the legacy seeders, stamped `…@legacy`. */
async function createLegacyCompany(name: string): Promise<string> {
  await clearCatalogCache();
  registerMarketplaceCatalogService(null);
  const company = await companyService(db).create({ name } as never);
  // Boot backfill: this is what turns NULL origins into `…@legacy` in the wild.
  await backfillCrewTemplateOrigin(db);
  return company.id;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-crew-repair-integ-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: PORT,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);
    installFixtureFetch();
  } catch (err) {
    setupError = err;
    // eslint-disable-next-line no-console
    console.error("[crew-repair] embedded-postgres setup failed:", err);
  }
}, 180_000);

afterEach(() => {
  registerMarketplaceCatalogService(null);
  resetCrewRepairCooldowns();
  brokenUrls.clear();
  cdnReachable = false;
});

afterAll(async () => {
  registerMarketplaceCatalogService(null);
  if (realFetch) globalThis.fetch = realFetch;
  try {
    if (pg) await pg.stop();
  } catch {
    /* ignore */
  }
  try {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}, 60_000);

describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
)("crew provisioning repair (real PostgreSQL)", () => {
  // ── Step 1 — the task itself ───────────────────────────────────────────────
  it("adopts a `@legacy` crew so crew-updater stops skipping the company", async () => {
    if (setupError) throw new Error(String(setupError));
    const companyId = await createLegacyCompany("Legacy Crew Co");

    const before = await crewRows(companyId);
    const scoutBefore = before.find((r) => r.name === "Scout")!;
    expect(scoutBefore.template_origin).toBe("aoa-curated/standard-crew/scout@legacy");
    // THE discriminator, in its "before" half: the real update pipeline does not
    // walk this company at all. A route returning 200 would not prove this.
    expect(await updatePipelineSeesCompany(companyId)).toBe(false);

    // A founder customization that adoption must not touch.
    await db.execute(sql`UPDATE agents SET title = 'Chief Scout' WHERE id = ${scoutBefore.id}`);

    await withCatalog();
    const result = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });

    // The DAMAGE is asserted before the mode, deliberately: `action` is a proxy,
    // the row is the thing. A naive repair (re-running provisionCompanyCrew)
    // fails on the next four assertions, not on a mode string.
    const after = await crewRows(companyId);
    const scoutAfter = after.find((r) => r.name === "Scout")!;
    // The origin CHANGED — `@legacy` → a real catalog id — in place.
    expect(scoutAfter.template_origin).toBe(SCOUT_ID);
    expect(scoutAfter.template_version).toBe("1.0.0");
    expect(scoutAfter.skill_keys).toEqual([SKILL_ID]);
    // In place: same row. Tasks, runs and assignments keep pointing at it.
    expect(scoutAfter.id).toBe(scoutBefore.id);
    // …and the founder's edit survived.
    expect(scoutAfter.title).toBe("Chief Scout");

    // No duplicate roster — the failure mode of a naive re-install.
    expect(after.filter((r) => r.name === "Scout")).toHaveLength(1);
    expect(after.some((r) => /-2$/.test(r.name))).toBe(false);

    // Roles the roster does not name are left alone, still legacy.
    expect(after.find((r) => r.name === "Adjutant")!.template_origin).toMatch(/@legacy$/);

    // The team row + membership an install would have written — this is what
    // `reconcileTeamMembers` needs in order to add Reviewer later.
    expect(await teamRowCount(companyId)).toBe(1);
    const members = rowsOf<{ agent_id: string; role: string }>(
      await db.execute(sql`
        SELECT tm.agent_id, tm.role FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        WHERE t.company_id = ${companyId} AND t.template_origin = ${TEAM_ID}
      `),
    );
    expect(members.map((m) => m.agent_id)).toEqual([scoutBefore.id]);
    expect(members[0].role).toBe("lead");

    // The audit row is terminal — so a later provisioning pass cannot claim it.
    const ops = await operationRow(companyId);
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe("success");

    // THE discriminator, "after" half: the pipeline now walks this company.
    expect(await updatePipelineSeesCompany(companyId)).toBe(true);

    // Only now the mode, and what it adopted.
    expect(result.action).toBe("adopted");
    if (result.action !== "adopted") throw new Error("unreachable");
    expect(result.adoptedItemIds).toEqual([SCOUT_ID]);
    expect(result.failedItemIds).toEqual([]);
  }, 180_000);

  // ── The ablation, kept permanently ────────────────────────────────────────
  // This is the naive repair the brief warns about, run against the exact state
  // Step 1 covers. It is here so nobody re-wires repair straight to
  // `provisionCompanyCrew`: diagnosing first is the ONLY thing preventing this.
  it("ABLATION: repairing a legacy company via provisionCompanyCrew mints a duplicate roster", async () => {
    if (setupError) throw new Error(String(setupError));
    const companyId = await createLegacyCompany("Naive Repair Co");
    await withCatalog();

    const outcome = await provisionCompanyCrew(db, companyId, {});
    expect(outcome.mode).toBe("marketplace");

    const after = await crewRows(companyId);
    // Two Scouts: the legacy one, and a renamed marketplace one.
    expect(after.filter((r) => r.name.startsWith("Scout"))).toHaveLength(2);
    expect(after.some((r) => r.name === "Scout-2")).toBe(true);
    // …and the ORIGINAL Scout — the row every task points at — is still
    // `@legacy`, i.e. still excluded from crew updates. The duplicate did not
    // repair anything; it only made the company harder to reason about.
    expect(after.find((r) => r.name === "Scout")!.template_origin).toMatch(/@legacy$/);
  }, 180_000);

  // ── Step 2 — re-run safety ────────────────────────────────────────────────
  it("repair is a no-op on an already-marketplace-managed company", async () => {
    if (setupError) throw new Error(String(setupError));
    await withCatalog();
    const company = await companyService(db).create({ name: "Managed Crew Co" } as never);
    await db.execute(
      sql`UPDATE agents SET title = 'Lead Scout' WHERE company_id = ${company.id} AND name = 'Scout'`,
    );
    const before = await crewRows(company.id);

    for (let pass = 0; pass < 2; pass++) {
      const result = await repairCompanyCrew(db, company.id, {
        catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
        instructionsService,
      });
      expect(result.action).toBe("none");
    }

    const after = await crewRows(company.id);
    expect(after).toEqual(before);
    expect(after.some((r) => /-2$/.test(r.name))).toBe(false);
    expect(await teamRowCount(company.id)).toBe(1);
    expect(await operationRow(company.id)).toHaveLength(1);
  }, 180_000);

  it("repair is a no-op when re-run on a company it just adopted", async () => {
    if (setupError) throw new Error(String(setupError));
    const companyId = await createLegacyCompany("Twice Repaired Co");
    await withCatalog();

    const first = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    expect(first.action).toBe("adopted");
    const afterFirst = await crewRows(companyId);

    const second = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    // Adoption made the company healthy; a second pass must write NOTHING.
    expect(second).toEqual({ action: "none", verdict: "healthy" });
    expect(await crewRows(companyId)).toEqual(afterFirst);
    expect(await teamRowCount(companyId)).toBe(1);

    // The OTHER entry point matters just as much, and is where the harm shows:
    // adoption must leave the bootstrap operation row terminal, or the ordinary
    // provisioning path claims it (`failure`/absent are both claimable) and
    // re-installs the roster this company already has.
    const outcome = await provisionCompanyCrew(db, companyId, {});
    expect((await crewRows(companyId)).some((r) => /-2$/.test(r.name))).toBe(false);
    expect(await teamRowCount(companyId)).toBe(1);
    expect(outcome.mode).toBe("marketplace-already-dispatched");
    expect(await operationRow(companyId)).toHaveLength(1);
  }, 180_000);

  // ── Step 4b case 1 — the `unknown` witness leaves a crewless company ───────
  it("re-provisions a company that has infrastructure agents but no crew at all", async () => {
    if (setupError) throw new Error(String(setupError));
    await withCatalog();

    const companyId = randomUUID();
    await db.execute(sql`
      INSERT INTO companies (id, name, issue_prefix)
      VALUES (${companyId}, 'Crewless Co', ${nextIssuePrefix()})
    `);
    // Exactly what `unknown-skipped-seeding` leaves behind: Commander + Steward
    // seeded, the crew half deliberately skipped.
    await ensureInfrastructureAgents(db, companyId);

    const diagnosis = await diagnoseCrewProvisioning(db, companyId);
    expect(diagnosis.verdict).toBe("crewless");

    const result = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    expect(result.action).toBe("reprovisioned");

    const crew = await crewRows(companyId);
    expect(
      crew.filter((r) => r.template_origin?.startsWith("agent:aoa-curated/")).map((r) => r.name).sort(),
    ).toEqual(["Reviewer", "Scout"]);
    // Infrastructure was not duplicated by the re-provision.
    expect(crew.filter((r) => r.name === "Commander")).toHaveLength(1);
    expect(crew.filter((r) => r.name === "Steward")).toHaveLength(1);
    expect(await teamRowCount(companyId)).toBe(1);
  }, 180_000);

  // ── Step 4b case 2 — the operation row the T2.3 repair could not fix ───────
  it("corrects an install operation that still reports failure over a committed crew", async () => {
    if (setupError) throw new Error(String(setupError));
    await withCatalog();
    const company = await companyService(db).create({ name: "Lying Op Co" } as never);

    // The T2.3 averted-clobber repair write uses the same connection that just
    // failed; when the DB is what broke, the row stays `failure`.
    await db.execute(sql`
      UPDATE marketplace_install_operations
      SET status = 'failure', error_message = 'live-event subscriber threw', completed_at = NULL
      WHERE company_id = ${company.id}
    `);

    const diagnosis = await diagnoseCrewProvisioning(db, company.id);
    expect(diagnosis.verdict).toBe("operation-row-stale");

    const before = await crewRows(company.id);
    const result = await repairCompanyCrew(db, company.id, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    expect(result.action).toBe("operation-repaired");

    const ops = await operationRow(company.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe("success");
    expect(ops[0].error_message).toBeNull();
    // Nothing was re-installed.
    expect(await crewRows(company.id)).toEqual(before);
    expect(await teamRowCount(company.id)).toBe(1);
  }, 180_000);

  // Discriminator for the above: "not success" is NOT the same as "stale". A
  // live install owns its `running` row, and repair must not declare someone
  // else's in-flight work finished.
  it("does not touch a FRESH `running` operation row", async () => {
    if (setupError) throw new Error(String(setupError));
    await withCatalog();
    const company = await companyService(db).create({ name: "Live Op Co" } as never);
    await db.execute(sql`
      UPDATE marketplace_install_operations
      SET status = 'running', started_at = now(), completed_at = NULL
      WHERE company_id = ${company.id}
    `);

    expect((await diagnoseCrewProvisioning(db, company.id)).verdict).toBe("healthy");
    const result = await repairCompanyCrew(db, company.id, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    expect(result).toEqual({ action: "none", verdict: "healthy" });
    expect((await operationRow(company.id))[0].status).toBe("running");
  }, 180_000);

  // …but a `running` row whose owner died IS stale, and IS claimable, so repair
  // must seal it or the next provisioning pass re-installs over the crew.
  it("seals a stale `running` operation row over an installed crew", async () => {
    if (setupError) throw new Error(String(setupError));
    await withCatalog();
    const company = await companyService(db).create({ name: "Dead Owner Op Co" } as never);
    await db.execute(sql`
      UPDATE marketplace_install_operations
      SET status = 'running', started_at = now() - interval '30 minutes', completed_at = NULL
      WHERE company_id = ${company.id}
    `);

    expect((await diagnoseCrewProvisioning(db, company.id)).verdict).toBe("operation-row-stale");
    const result = await repairCompanyCrew(db, company.id, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    expect(result.action).toBe("operation-repaired");
    expect((await operationRow(company.id))[0].status).toBe("success");
  }, 180_000);

  // The harm that case makes real, if repair does NOT seal the row.
  it("ABLATION: an unsealed `failure` row lets the next provisioning pass duplicate the roster", async () => {
    if (setupError) throw new Error(String(setupError));
    await withCatalog();
    const company = await companyService(db).create({ name: "Unsealed Op Co" } as never);
    await db.execute(sql`
      UPDATE marketplace_install_operations
      SET status = 'failure', error_message = 'bookkeeping failed', completed_at = NULL
      WHERE company_id = ${company.id}
    `);

    // No repair. `claimOperationForDispatch` treats `failure` as claimable — by
    // design, so a genuinely failed bootstrap can be retried — so the crew is
    // installed a SECOND time over the committed one.
    const outcome = await provisionCompanyCrew(db, company.id, {});
    expect(outcome.mode).toBe("marketplace");

    const crew = await crewRows(company.id);
    expect(crew.some((r) => r.name === "Scout-2")).toBe(true);
    // Two team rows sharing one templateOrigin — this is what breaks the
    // single-row lookups in resolver.ts and team-reconcile.ts.
    expect(await teamRowCount(company.id)).toBe(2);
  }, 180_000);

  // ── Fail closed ───────────────────────────────────────────────────────────
  it("refuses to install alongside crew rows it cannot account for", async () => {
    if (setupError) throw new Error(String(setupError));
    const companyId = await createLegacyCompany("Renamed Crew Co");
    // The founder renamed everything — nothing matches the roster by name.
    await db.execute(sql`
      UPDATE agents SET name = 'Recon ' || name
      WHERE company_id = ${companyId} AND kind = 'aoa' AND name NOT IN ('Commander', 'Steward')
    `);
    await withCatalog();

    const before = await crewRows(companyId);
    const result = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });

    expect(result.action).toBe("skipped");
    // Nothing installed, nothing renamed, no team row: a visible unrepaired
    // company beats a company with two parallel crews.
    expect(await crewRows(companyId)).toEqual(before);
    expect(await teamRowCount(companyId)).toBe(0);
    expect(await operationRow(companyId)).toHaveLength(0);
  }, 180_000);

  it("skips repair when the catalog has no crew team item", async () => {
    if (setupError) throw new Error(String(setupError));
    const companyId = await createLegacyCompany("No Team Item Co");
    await withCatalog();

    const result = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items.filter((i) => i.id !== TEAM_ID) as CatalogItem[],
      instructionsService,
    });
    expect(result.action).toBe("skipped");
    expect(await teamRowCount(companyId)).toBe(0);
  }, 180_000);

  it("leaves a legacy row untouched and retryable when its agent template is unreachable", async () => {
    if (setupError) throw new Error(String(setupError));
    const companyId = await createLegacyCompany("Flaky Adopt Co");
    await withCatalog();
    brokenUrls.add(`${FIXTURE_HOST}/agents/aoa-scout/agent.json`);

    const first = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    // Adoption is fetch-before-write, so a 503 leaves the row exactly as it was.
    expect(first.action).toBe("skipped");
    expect((await crewRows(companyId)).find((r) => r.name === "Scout")!.template_origin).toMatch(
      /@legacy$/,
    );
    expect(await teamRowCount(companyId)).toBe(0);

    // …and it is still repairable once the CDN comes back.
    brokenUrls.clear();
    const second = await repairCompanyCrew(db, companyId, {
      catalogItems: FIXTURE_CATALOG.items as CatalogItem[],
      instructionsService,
    });
    expect(second.action).toBe("adopted");
    expect((await crewRows(companyId)).find((r) => r.name === "Scout")!.template_origin).toBe(SCOUT_ID);
  }, 180_000);

  // ── The boot pass ─────────────────────────────────────────────────────────
  it("the boot pass repairs degraded companies, capped per pass, healthy ones untouched", async () => {
    if (setupError) throw new Error(String(setupError));
    const degradedA = await createLegacyCompany("Pass Co A");
    const degradedB = await createLegacyCompany("Pass Co B");
    await withCatalog();
    const healthy = await companyService(db).create({ name: "Pass Co Healthy" } as never);
    const healthyBefore = await crewRows(healthy.id);

    const catalogItems = FIXTURE_CATALOG.items as CatalogItem[];
    const companyIds = [degradedA, degradedB, healthy.id];
    const t0 = Date.now();

    const pass1 = await runCrewRepairPass({
      db, companyIds, catalogItems, instructionsService, maxPerPass: 1, now: t0,
    });
    // Every company is diagnosed; the cap limits only what is REPAIRED.
    expect(pass1.inspected).toBe(3);
    expect(pass1.repaired).toBe(1);
    expect(pass1.skipped).toBe(1); // the second degraded company, over budget

    const verdictsAfterPass1 = await Promise.all(
      [degradedA, degradedB].map(async (id) => (await diagnoseCrewProvisioning(db, id)).verdict),
    );
    // The cap held: exactly one of the two was taken this pass.
    expect(verdictsAfterPass1.filter((v) => v === "healthy")).toHaveLength(1);
    expect(verdictsAfterPass1.filter((v) => v === "unmanaged")).toHaveLength(1);

    const pass2 = await runCrewRepairPass({
      db, companyIds, catalogItems, instructionsService, maxPerPass: 1,
      now: t0 + CREW_REPAIR_COOLDOWN_MS + 1,
    });
    expect(pass2.repaired).toBe(1);
    for (const id of [degradedA, degradedB]) {
      expect((await diagnoseCrewProvisioning(db, id)).verdict).toBe("healthy");
      // "healthy" is also reachable by installing a SECOND crew beside the
      // legacy one, so the verdict alone is not a discriminator — these are.
      const rows = await crewRows(id);
      expect(rows.some((r) => /-2$/.test(r.name))).toBe(false);
      expect(rows.find((r) => r.name === "Scout")!.template_origin).toBe(SCOUT_ID);
      expect(await teamRowCount(id)).toBe(1);
    }
    // A healthy company is diagnosed and then left completely alone.
    expect(await crewRows(healthy.id)).toEqual(healthyBefore);
  }, 240_000);

  it("the cooldown, not luck, is what stops a degraded company being retried every pass", async () => {
    if (setupError) throw new Error(String(setupError));
    const companyId = await createLegacyCompany("Cooldown Co");
    await withCatalog();
    const catalogItems = FIXTURE_CATALOG.items as CatalogItem[];
    const t0 = Date.now();

    // Attempt 1 fails (agent template 503s) and leaves the company degraded.
    brokenUrls.add(`${FIXTURE_HOST}/agents/aoa-scout/agent.json`);
    const pass1 = await runCrewRepairPass({ db, companyIds: [companyId], catalogItems, instructionsService, now: t0 });
    expect(pass1.skipped).toBe(1);
    expect((await diagnoseCrewProvisioning(db, companyId)).verdict).toBe("unmanaged");

    // The CDN is healthy again — the ONLY thing standing between pass 2 and a
    // successful repair is the clock.
    brokenUrls.clear();
    const pass2 = await runCrewRepairPass({
      db, companyIds: [companyId], catalogItems, instructionsService,
      now: t0 + CREW_REPAIR_COOLDOWN_MS - 1,
    });
    expect(pass2.skipped).toBe(1);
    expect((await diagnoseCrewProvisioning(db, companyId)).verdict).toBe("unmanaged");

    const pass3 = await runCrewRepairPass({
      db, companyIds: [companyId], catalogItems, instructionsService,
      now: t0 + CREW_REPAIR_COOLDOWN_MS + 1,
    });
    expect(pass3.repaired).toBe(1);
    expect((await diagnoseCrewProvisioning(db, companyId)).verdict).toBe("healthy");
  }, 240_000);
});
