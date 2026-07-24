/**
 * T2.3 — company creation installs the crew FROM THE MARKETPLACE (P8, P8c).
 *
 * The whole point of Phase 2: legacy-seeded crew rows are stamped `…@legacy`
 * by `backfill-template-origin.ts`, and `crew-updater.ts` skips `@legacy` rows
 * forever — so every company was permanently frozen out of the update pipeline
 * that is already built and running. This suite proves a freshly created
 * company is born *updateable*.
 *
 * Real PostgreSQL, because every assertion here is about rows the create path
 * actually wrote (origins, versions, skillKeys, the team row, the install
 * operation) and about a real transaction rolling back on failure. A mocked DB
 * could only prove that functions were called.
 *
 * ── What is stubbed, and what is deliberately NOT ────────────────────────────
 * `globalThis.fetch` is replaced with a fixture server. Nothing here touches
 * the network, and — importantly — nothing here reads
 * `ui/src/aoa-marketplace-snapshot.json`. That file is GITIGNORED
 * (`.gitignore:60`; it is fetched at build time by `pnpm fetch-catalog`), so a
 * test that depended on it would pass on a dev machine that happens to have
 * run the fetch and prove nothing in CI or a fresh clone, where
 * `bundledSnapshotProvider` catches the failed import and returns `null`. The
 * snapshot is INJECTED as a fixture instead.
 *
 * Skipped on Windows by default (CI's `runneradmin` account can't start
 * embedded-postgres — Issue #114); Linux CI is the authoritative gate. On a
 * Windows dev box set `AOA_RUN_WIN_INTEGRATION=1` to run it for real.
 * Modeled on teams-null-parent-cascade.integration.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import type { MarketplaceCatalogFile } from "@armyofagents/shared";
import {
  MarketplaceCatalogService,
  loadCachedCatalog,
  registerMarketplaceCatalogService,
} from "../services/aoa-marketplace.js";
import { companyService } from "../services/companies.js";
import { provisionCompanyCrew } from "../services/crew-provisioning.js";

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

const PORT = 57900 + Math.floor(Math.random() * 500);

/** A CDN URL that is never reachable — the fixture fetch always rejects it. */
const FIXTURE_CDN_URL = "https://cdn.fixture.invalid/catalog.json";
const FIXTURE_HOST = "https://raw.fixture.invalid";

const TEAM_ID = "team:aoa-curated/default-crew";
const SCOUT_ID = "agent:aoa-curated/aoa-scout";
const REVIEWER_ID = "agent:aoa-curated/aoa-reviewer";
const SKILL_ID = "skill:aoa-curated/fixture-crew-skill";

/** `companies.issue_prefix` is globally unique, so raw inserts need distinct values. */
let seedCounter = 0;
function nextIssuePrefix(): string {
  seedCounter += 1;
  return `CB${seedCounter}`;
}

function rowsOf<T>(result: unknown): T[] {
  const asObj = result as { rows?: T[] };
  return asObj?.rows ?? (result as T[]);
}

// ── Fixture catalog ──────────────────────────────────────────────────────────
// A miniature of the real `team:aoa-curated/default-crew`: a team item whose
// requires[] names two agents and one skill. Deliberately hand-built rather
// than loaded from the gitignored snapshot (see file docstring).

function catalogItemBase(id: string, type: string, name: string) {
  return {
    id,
    type,
    name,
    description: `${name} fixture`,
    version: "1.0.0",
    source: { adapter: "aoa-curated", url: "https://github.com/MeteoriteLabs/aoa-marketplace", locator: `content/${id}` },
    trust: { tier: "verified", source: "aoa-curated" },
    status: "active",
    addedAt: "2026-07-24T00:00:00.000Z",
    category: "workflows",
    tags: ["official"],
  };
}

const FIXTURE_CATALOG: MarketplaceCatalogFile = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-07-24T00:00:00.000Z",
  itemCount: 4,
  items: [
    {
      ...catalogItemBase(TEAM_ID, "team", "AoA Default Crew"),
      resourceUrl: `${FIXTURE_HOST}/teams/default-crew/team.json`,
      requires: [
        { type: "agent", id: SCOUT_ID },
        { type: "agent", id: REVIEWER_ID },
        { type: "skill", id: SKILL_ID },
      ],
    },
    {
      ...catalogItemBase(SCOUT_ID, "agent", "Scout"),
      resourceUrl: `${FIXTURE_HOST}/agents/aoa-scout/agent.json`,
    },
    {
      ...catalogItemBase(REVIEWER_ID, "agent", "Reviewer"),
      resourceUrl: `${FIXTURE_HOST}/agents/aoa-reviewer/agent.json`,
    },
    {
      ...catalogItemBase(SKILL_ID, "skill", "Fixture Crew Skill"),
      content: { inline: "---\nname: fixture-crew-skill\n---\n\nDo the thing.\n" },
    },
  ],
} as unknown as MarketplaceCatalogFile;

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
      // agent.v1 only allows active|paused|terminated here.
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
/** URLs the fixture server should 503 on — used to force a mid-install failure. */
const brokenUrls = new Set<string>();
/** URLs that never resolve — used to prove the aggregate deadline aborts them. */
const stalledUrls = new Set<string>();
/** Whether the fixture CDN answers. Default unreachable; one test flips it. */
let cdnReachable = false;
/** Every URL the fixture server was asked for, in order. Deterministic — no wall clock. */
const fetchLog: string[] = [];

function installFixtureFetch() {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    fetchLog.push(url);
    if (url === FIXTURE_CDN_URL) {
      if (!cdnReachable) throw new TypeError("fetch failed (simulated: CDN unreachable)");
      return new Response(JSON.stringify(FIXTURE_CATALOG), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (brokenUrls.has(url)) {
      return new Response("upstream unavailable", { status: 503 });
    }
    if (stalledUrls.has(url)) {
      // Never resolves on its own. Rejects only when the caller's signal fires,
      // which is precisely the behaviour under test.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("The operation was aborted.")),
        );
      });
    }
    const body = FIXTURE_BODIES[url];
    if (body === undefined) {
      return new Response(`no fixture for ${url}`, { status: 404 });
    }
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
}

async function clearCatalogCache() {
  await db.execute(sql`DELETE FROM marketplace_catalog_cache`);
}

/** Every kind='aoa' agent for a company, with the fields T2.3 is about. */
async function crewRows(companyId: string) {
  return rowsOf<{
    name: string;
    template_origin: string | null;
    template_version: string | null;
    skill_keys: string[];
  }>(
    await db.execute(sql`
      SELECT name, template_origin, template_version, skill_keys
      FROM agents
      WHERE company_id = ${companyId} AND kind = 'aoa'
      ORDER BY name
    `),
  );
}

async function catalogCacheSource(): Promise<string | null> {
  const rows = rowsOf<{ source: string }>(
    await db.execute(sql`SELECT source FROM marketplace_catalog_cache WHERE id = 1`),
  );
  return rows[0]?.source ?? null;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-crew-bootstrap-integ-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: PORT,
      persistent: false,
      // Force UTF-8 so migration SQL containing non-Latin1 characters applies.
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
    console.error("[crew-marketplace-bootstrap] embedded-postgres setup failed:", err);
  }
}, 180_000);

afterEach(() => {
  registerMarketplaceCatalogService(null);
  brokenUrls.clear();
  stalledUrls.clear();
  cdnReachable = false;
  fetchLog.length = 0;
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

function makeService(opts: { snapshot?: MarketplaceCatalogFile | null; snapshotDelayMs?: number } = {}) {
  return new MarketplaceCatalogService({
    db,
    cdnUrl: FIXTURE_CDN_URL,
    bundledSnapshotProvider: async () => {
      if (opts.snapshotDelayMs) await new Promise((r) => setTimeout(r, opts.snapshotDelayMs));
      return opts.snapshot ?? null;
    },
  });
}

describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
)("company create installs the crew from the marketplace (real PostgreSQL)", () => {
  // ── The task itself ────────────────────────────────────────────────────────
  // Before T2.3 the crew came only from the legacy ensure-* seeders, which
  // write NO templateOrigin and NO templateVersion (seed-crew-agent.ts) — the
  // boot backfill later stamps them `…@legacy`. So every assertion below fails
  // against the pre-T2.3 create path: template_origin was NULL, there was no
  // teams row, and no install operation existed.
  it("a newly created company gets a marketplace-managed crew, not @legacy", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();

    // R9: this is the one test where the CDN genuinely ANSWERS — every other
    // path here is CDN-unreachable, so without it the happy path was untested.
    cdnReachable = true;
    const service = makeService({ snapshot: null });
    await service.sync();
    registerMarketplaceCatalogService(service);
    expect(await catalogCacheSource()).toBe("cdn");

    const company = await companyService(db).create({ name: "Marketplace Crew Co" } as never);
    const crew = await crewRows(company.id);

    const marketplaceCrew = crew.filter((row) => row.template_origin?.startsWith("agent:aoa-curated/"));
    expect(marketplaceCrew.map((r) => r.name).sort()).toEqual(["Reviewer", "Scout"]);

    for (const row of marketplaceCrew) {
      // The single root cause Phase 2 fixes: `@legacy` origins are skipped by
      // crew-updater.ts forever.
      expect(row.template_origin).not.toMatch(/@legacy$/);
      expect(row.template_version).toBe("1.0.0");
      expect(row.skill_keys).toEqual([SKILL_ID]);
    }

    // The legacy seeders must NOT also have run — a duplicate legacy Scout
    // alongside the marketplace Scout is the failure mode of "install AND seed".
    expect(crew.some((r) => r.name === "Adjutant")).toBe(false);
    expect(crew.filter((r) => r.name === "Scout")).toHaveLength(1);

    // The company-wide team row (D21 — no parent department at create time).
    const teams = rowsOf<{ parent_project_id: string | null; template_origin: string | null }>(
      await db.execute(sql`
        SELECT parent_project_id, template_origin FROM teams WHERE company_id = ${company.id}
      `),
    );
    expect(teams).toHaveLength(1);
    expect(teams[0].parent_project_id).toBeNull();
    expect(teams[0].template_origin).toBe(TEAM_ID);

    // Went through the orchestrator, so T2.7/T2.8 have an operation to build on.
    const ops = rowsOf<{ status: string; idempotency_key: string; target_department_id: string | null }>(
      await db.execute(sql`
        SELECT status, idempotency_key, target_department_id
        FROM marketplace_install_operations WHERE company_id = ${company.id}
      `),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe("success");
    expect(ops[0].idempotency_key).toBe(`bootstrap-crew:${company.id}`);
    expect(ops[0].target_department_id).toBeNull();

    // Infrastructure agents are NOT marketplace-owned and must still be seeded
    // (P8d) — the T2.2 contract, re-proven end to end now that the crew half
    // takes a different path.
    expect(crew.some((r) => r.name === "Commander")).toBe(true);
    expect(crew.some((r) => r.name === "Steward")).toBe(true);
  }, 120_000);

  // ── Hazard 3: offline bootstrap, snapshot INJECTED not read from disk ──────
  it("offline (CDN unreachable): the bundled snapshot supplies the same roster", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();

    const service = makeService({ snapshot: FIXTURE_CATALOG });
    await service.sync();
    registerMarketplaceCatalogService(service);

    // Proves the catalog really came from the snapshot fallback, not a CDN hit.
    expect(await catalogCacheSource()).toBe("bundled");

    const company = await companyService(db).create({ name: "Offline Crew Co" } as never);
    const crew = await crewRows(company.id);

    expect(
      crew.filter((r) => r.template_origin?.startsWith("agent:aoa-curated/")).map((r) => r.name).sort(),
    ).toEqual(["Reviewer", "Scout"]);
  }, 120_000);

  // ── Hazard 4: the cold-cache race ─────────────────────────────────────────
  // The bundled snapshot only reaches the cache INSIDE syncCatalog's catch,
  // and the boot sync is fire-and-forget (`void this.sync()`), so a company
  // created in the first seconds after boot could find loadCachedCatalog still
  // null and be provisioned `@legacy` — non-deterministically, and invisibly
  // afterwards. Company create must not depend on winning that race.
  it("cold cache + a sync still in flight still produces the marketplace roster", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();

    // Snapshot resolution is deliberately slow so the sync is provably still
    // running when create() is called.
    const service = makeService({ snapshot: FIXTURE_CATALOG, snapshotDelayMs: 300 });
    registerMarketplaceCatalogService(service);
    service.startSyncLoop(); // fire-and-forget, exactly like boot
    try {
      // The discriminator: at this instant a cache-only reader sees NOTHING.
      // A create path that merely read the cache would degrade to @legacy here.
      expect(await loadCachedCatalog(db)).toBeNull();

      const company = await companyService(db).create({ name: "Cold Cache Co" } as never);
      const crew = await crewRows(company.id);

      expect(
        crew.filter((r) => r.template_origin?.startsWith("agent:aoa-curated/")).map((r) => r.name).sort(),
      ).toEqual(["Reviewer", "Scout"]);
      expect(await catalogCacheSource()).toBe("bundled");
    } finally {
      service.stopSyncLoop();
    }
  }, 120_000);

  // ── The degrade path ──────────────────────────────────────────────────────
  it("install failure never blocks create — the company still gets a legacy crew", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();

    const service = makeService({ snapshot: FIXTURE_CATALOG });
    await service.sync();
    registerMarketplaceCatalogService(service);
    // Break the team template fetch mid-install: catalog resolves, dispatch
    // starts, phase 1 fails.
    brokenUrls.add(`${FIXTURE_HOST}/teams/default-crew/team.json`);

    const company = await companyService(db).create({ name: "Degraded Crew Co" } as never);
    expect(company.id).toBeTruthy();

    const crew = await crewRows(company.id);
    // Legacy roster present…
    expect(crew.some((r) => r.name === "Scout")).toBe(true);
    expect(crew.some((r) => r.name === "Adjutant")).toBe(true);
    // …and it is legacy: the seeders write no templateOrigin at all.
    expect(crew.find((r) => r.name === "Scout")!.template_origin).toBeNull();
    // No marketplace rows exist: the break is at team-installer phase 1c (the
    // team.json fetch), before ANY write — so this asserts "failed before it
    // started", NOT phase-3 transactional rollback. Post-commit failure is a
    // different animal and is covered by its own test below.
    expect(crew.some((r) => r.template_origin?.startsWith("agent:aoa-curated/"))).toBe(false);
    // …and the legacy roster genuinely lacks Reviewer — the gap the degrade log
    // has to name, because nothing in the data reveals it.
    expect(crew.some((r) => r.name === "Reviewer")).toBe(false);

    const ops = rowsOf<{ status: string; error_message: string | null }>(
      await db.execute(sql`
        SELECT status, error_message FROM marketplace_install_operations WHERE company_id = ${company.id}
      `),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe("failure");
    expect(ops[0].error_message).toMatch(/503/);
  }, 120_000);

  // ── R1: a SUCCESSFUL install whose success FAILS TO RECORD ────────────────
  // `dispatchInstall` commits the team-body transaction, writes `success`, then
  // publishes `marketplace.install.completed`. `publishLiveEvent` is a bare
  // synchronous `EventEmitter.emit` with no guard, so a throwing subscriber
  // propagates INTO dispatchInstall's catch, which overwrites the terminal
  // patch with `failure`. The bootstrap then reports `failed` over a crew that
  // is committed on disk.
  //
  // Seeding on top of it is silent and permanent: `seedCrewAgent` hits
  // ON CONFLICT DO NOTHING on the name-overlapping roles, takes the `!inserted`
  // branch, and overwrites the MARKETPLACE rows' runtimeConfig.aoa.toolAllowlist
  // (and adapter, and instruction bundle) while leaving templateOrigin and
  // templateVersion intact — so `crew-updater` sees managed rows at the current
  // catalog version and never repairs them, and no duplicate row is minted to
  // reveal it.
  //
  // This test breaks AFTER the phase-3 commit, which the degrade test above
  // (phase 1c) cannot reach.
  it("a post-commit failure must NOT let the legacy seeders clobber the installed crew", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();

    const service = makeService({ snapshot: FIXTURE_CATALOG });
    await service.sync();
    registerMarketplaceCatalogService(service);

    // A bare company row — no crew — so provisionCompanyCrew runs on a clean
    // slate exactly as it does inside create().
    const companyId = randomUUID();
    await db.execute(sql`
      INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'Post Commit Co', ${nextIssuePrefix()})
    `);

    const outcome = await provisionCompanyCrew(db, companyId, {
      publishLiveEvent: (event) => {
        if (event.type === "marketplace.install.completed") {
          throw new Error("live-event subscriber threw after the install committed");
        }
      },
    });

    // The install DID commit.
    const crew = await crewRows(companyId);
    const marketplaceCrew = crew.filter((r) => r.template_origin?.startsWith("agent:aoa-curated/"));
    expect(marketplaceCrew.map((r) => r.name).sort()).toEqual(["Reviewer", "Scout"]);

    // …and the legacy seeders did NOT run over it. The DAMAGE is asserted first
    // and the outcome mode last, deliberately: a mode string is a proxy, the
    // clobbered row is the bug.
    //
    // (a) the clobber itself — seedCrewAgent's !inserted branch writes the
    //     legacy tool allowlist onto the marketplace row it collided with.
    const scoutRuntime = rowsOf<{ allowlist: string | null }>(
      await db.execute(sql`
        SELECT runtime_config -> 'aoa' ->> 'toolAllowlist' AS allowlist
        FROM agents WHERE company_id = ${companyId} AND name = 'Scout'
      `),
    );
    expect(scoutRuntime).toHaveLength(1);
    expect(scoutRuntime[0].allowlist).toBeNull();
    // (b) the non-colliding legacy roles were never inserted alongside.
    expect(crew.some((r) => r.name === "Adjutant")).toBe(false);
    expect(crew.some((r) => r.name === "Librarian")).toBe(false);
    // (c) the marketplace rows keep the origin/version that make them
    //     updateable — the property the clobber leaves intact and therefore
    //     the reason the damage is unrepairable.
    for (const row of marketplaceCrew) {
      expect(row.template_version).toBe("1.0.0");
    }
    expect(outcome.mode).toBe("marketplace-clobber-averted");
  }, 120_000);

  // ── R2: the install is bounded ────────────────────────────────────────────
  // 27 sequential fetches at FETCH_TIMEOUT_MS each is ~13.5 minutes inside an
  // interactive POST. The aggregate deadline aborts in-flight requests rather
  // than merely abandoning their results — which matters, because an install
  // that landed after we degraded would be exactly the R1 clobber again.
  it("an install that outruns its deadline is aborted, not left running", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();

    const service = makeService({ snapshot: FIXTURE_CATALOG });
    await service.sync();
    registerMarketplaceCatalogService(service);
    stalledUrls.add(`${FIXTURE_HOST}/teams/default-crew/team.json`);

    const companyId = randomUUID();
    await db.execute(sql`
      INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'Deadline Co', ${nextIssuePrefix()})
    `);

    const startedAt = Date.now();
    const outcome = await provisionCompanyCrew(db, companyId, { installDeadlineMs: 250 });
    const elapsed = Date.now() - startedAt;

    expect(outcome.mode).toBe("legacy");
    // Bounded by the deadline, NOT by the 30s per-request FETCH_TIMEOUT_MS.
    // The margin is deliberately huge (250ms budget vs a 30s request) so this
    // is not a wall-clock coin flip on a loaded runner.
    expect(elapsed).toBeLessThan(15_000);

    // The company still got a crew, and nothing marketplace-shaped committed.
    const crew = await crewRows(companyId);
    expect(crew.some((r) => r.name === "Adjutant")).toBe(true);
    expect(crew.some((r) => r.template_origin?.startsWith("agent:aoa-curated/"))).toBe(false);
  }, 120_000);

  // ── Idempotency ───────────────────────────────────────────────────────────
  // `bootstrap-crew:<companyId>` makes startInstallOperation return the
  // EXISTING operation, so a retried or concurrent create cannot double-install.
  // Without it the team installer would run again and resolveAgentNameConflict
  // would mint "Scout 2" / "Reviewer 2".
  it("a repeated bootstrap for the same company cannot double-install the crew", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();

    const service = makeService({ snapshot: FIXTURE_CATALOG });
    await service.sync();
    registerMarketplaceCatalogService(service);

    const company = await companyService(db).create({ name: "Idempotent Crew Co" } as never);
    const before = await crewRows(company.id);

    // Call the provisioner directly — company create's own pre-gate would
    // short-circuit, and the guarantee under test is the idempotency KEY.
    const outcome = await provisionCompanyCrew(db, company.id, {});
    expect(outcome.mode).toBe("marketplace-already-dispatched");

    const after = await crewRows(company.id);
    expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name));
    expect(after.some((r) => /\b2$/.test(r.name))).toBe(false);

    const ops = rowsOf<{ n: string }>(
      await db.execute(sql`
        SELECT count(*)::text AS n FROM marketplace_install_operations WHERE company_id = ${company.id}
      `),
    );
    expect(ops[0].n).toBe("1");

    const teams = rowsOf<{ n: string }>(
      await db.execute(sql`SELECT count(*)::text AS n FROM teams WHERE company_id = ${company.id}`),
    );
    expect(teams[0].n).toBe("1");
  }, 120_000);

  // ── The seam that keeps every OTHER test off the network ──────────────────
  // With no service registered and a cold cache, create must degrade
  // immediately rather than reaching for the CDN.
  it("no registered catalog service + cold cache → immediate legacy degrade", async () => {
    if (setupError) throw new Error(String(setupError));
    await clearCatalogCache();
    registerMarketplaceCatalogService(null);

    const company = await companyService(db).create({ name: "No Service Co" } as never);

    const crew = await crewRows(company.id);
    expect(crew.some((r) => r.name === "Adjutant")).toBe(true);
    expect(crew.every((r) => r.template_origin === null)).toBe(true);
    // No operation row: it never even tried.
    const ops = rowsOf<{ n: string }>(
      await db.execute(sql`
        SELECT count(*)::text AS n FROM marketplace_install_operations WHERE company_id = ${company.id}
      `),
    );
    expect(ops[0].n).toBe("0");
    // No catalog wait was incurred — asserted by "the CDN was never contacted"
    // rather than by a wall clock, which on a loaded runner is a coin flip.
    expect(fetchLog).toEqual([]);
  }, 120_000);
});
