/**
 * T2.3d — `aoa.triggers[].enabled` from the published catalog.
 *
 * Two separate defects, and a test that only proved the first would have
 * shipped the second:
 *
 * 1. **Schema.** `AgentRuntimeSchema`'s trigger object was `.strict()` with only
 *    `kind` + `config`, so every published crew `agent.json` failed pre-flight
 *    with `unrecognized_keys: ["enabled"]` — which aborted `installTeam`, which
 *    degraded every live company create to the `@legacy` seeders.
 * 2. **Semantics.** The normalizer dropped the field and both insert sites
 *    hardcoded `enabled: true`, so a bare schema relaxation would have installed
 *    a trigger the catalog marked DISABLED as ENABLED.
 *
 * The fixtures under `__fixtures__/published-catalog/` are **verbatim copies of
 * real published bodies** (`raw.githubusercontent.com/MeteoriteLabs/aoa-marketplace`
 * @ `ad575a0ae45d9bfd3c754ab4ee3af85e7f02dc68`, fetched 2026-07-24), not
 * hand-written. Hand-written trigger fixtures are exactly why this shipped: every
 * one in the repo omitted `enabled`, and the bundled catalog *index* carries no
 * trigger data at all (triggers live in the separately-fetched `agent.json`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return { agents: tableProxy, aoaAgentTriggers: tableProxy, marketplacePendingUpdates: tableProxy };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../services/marketplace-notifications.js", () => ({
  marketplaceNotifications: { updateAvailable: vi.fn().mockResolvedValue(undefined) },
}));

/** The body `applyCrewAgentUpdate`'s fetch returns. Set per test. */
const updateBody = vi.hoisted(() => ({ value: "" }));
vi.mock("../services/marketplace-install/fetch-resource.js", () => ({
  fetchCatalogResource: vi.fn(async () => updateBody.value),
  fetchCatalogResourceUrl: vi.fn(async () => "# instructions"),
}));

import type { CatalogItem } from "@armyofagents/shared";
import {
  normalizeMarketplaceAgentTemplate,
  parseMarketplaceAgentTemplate,
} from "../services/marketplace-install/agent-runtime.js";
import { createMarketplaceAgent } from "../services/marketplace-install/agent-create.js";
import { applyCrewAgentUpdate } from "../services/marketplace-install/crew-updater.js";

function publishedBody(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./__fixtures__/published-catalog/${name}.agent.json`, import.meta.url)),
    "utf8",
  );
}

const ADJUTANT_BODY = publishedBody("aoa-adjutant");
const ENGINEER_BODY = publishedBody("aoa-engineer");

function catalogItem(slug: string, name: string): CatalogItem {
  const sha = "ad575a0ae45d9bfd3c754ab4ee3af85e7f02dc68";
  return {
    id: `agent:aoa-curated/${slug}`,
    type: "agent",
    name,
    description: `${name} crew agent`,
    version: "1.0.0",
    source: {
      adapter: "aoa-curated",
      url: "https://github.com/MeteoriteLabs/aoa-marketplace",
      locator: `content/agents/${slug}`,
      commitSha: sha,
    },
    resourceUrl: `https://raw.githubusercontent.com/MeteoriteLabs/aoa-marketplace/${sha}/content/agents/${slug}/agent.json`,
    trust: { tier: "verified", source: "aoa-curated" },
    status: "active",
    addedAt: "2026-07-23T04:06:32.162Z",
    category: "workflows",
    tags: ["official"],
    requires: [],
  } as CatalogItem;
}

const ADJUTANT_ITEM = catalogItem("aoa-adjutant", "Adjutant");
const ENGINEER_ITEM = catalogItem("aoa-engineer", "Engineer");

function normalize(body: string, item: CatalogItem) {
  return normalizeMarketplaceAgentTemplate({
    parsed: parseMarketplaceAgentTemplate(body, item),
    catalogItem: item,
    availableAdapterTypes: [],
  });
}

/** The published body with every trigger flipped to `enabled: false`. */
function withDisabledTriggers(body: string): string {
  const json = JSON.parse(body) as { aoa: { triggers: Array<Record<string, unknown>> } };
  json.aoa.triggers = json.aoa.triggers.map((t) => ({ ...t, enabled: false }));
  return JSON.stringify(json);
}

// ─── Step 1: the schema must accept what the catalog actually publishes ──────

describe("published crew agent.json bodies (verbatim from the live catalog)", () => {
  it("parses the published Adjutant body — its trigger carries `enabled`", () => {
    expect(() => parseMarketplaceAgentTemplate(ADJUTANT_BODY, ADJUTANT_ITEM)).not.toThrow();
  });

  it("parses the published Engineer body — two triggers, both carrying `enabled`", () => {
    expect(() => parseMarketplaceAgentTemplate(ENGINEER_BODY, ENGINEER_ITEM)).not.toThrow();
  });

  it("the fixtures really are the production shape (guards against a fixture rewrite)", () => {
    for (const body of [ADJUTANT_BODY, ENGINEER_BODY]) {
      const triggers = (JSON.parse(body) as { aoa: { triggers: unknown[] } }).aoa.triggers;
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of triggers) {
        expect(trigger).toHaveProperty("enabled");
      }
    }
  });
});

// ─── Step 2: the discriminator — `enabled: false` must be HONOURED ───────────

describe("normalizeMarketplaceAgentTemplate — triggers[].enabled", () => {
  it("carries `enabled: true` through from the published body", () => {
    expect(normalize(ENGINEER_BODY, ENGINEER_ITEM).triggers).toEqual([
      { kind: "mention", enabled: true, config: { role: "engineer" } },
      { kind: "phase-advance", enabled: true, config: { role: "engineer" } },
    ]);
  });

  it("carries `enabled: false` through — a disabled catalog trigger stays disabled", () => {
    const normalized = normalize(withDisabledTriggers(ENGINEER_BODY), ENGINEER_ITEM);
    expect(normalized.triggers.map((t) => t.enabled)).toEqual([false, false]);
  });

  it("defaults to `enabled: true` when the field is absent (pre-`enabled` templates)", () => {
    const body = JSON.stringify({
      schemaVersion: "agent.v1",
      id: "legacy-shaped",
      name: "Legacy Shaped",
      description: "no enabled field",
      instructions: { type: "inline", content: "hi" },
      aoa: { kind: "aoa", triggers: [{ kind: "mention", config: { role: "scout" } }] },
    });
    expect(normalize(body, ADJUTANT_ITEM).triggers).toEqual([
      { kind: "mention", enabled: true, config: { role: "scout" } },
    ]);
  });
});

// ─── Step 4a: insert site #1 — createMarketplaceAgent ────────────────────────

function makeInsertCapturingDb() {
  const triggerRows: Array<Record<string, unknown>> = [];
  let sawAgentInsert = false;
  const db = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        if (!sawAgentInsert) {
          sawAgentInsert = true;
          return { returning: () => Promise.resolve([{ ...row, id: "agent-uuid-1" }]) };
        }
        triggerRows.push(row);
        return Promise.resolve(undefined);
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  };
  return { db, triggerRows };
}

describe("createMarketplaceAgent — trigger rows", () => {
  it("writes enabled=false for a catalog trigger the catalog disabled", async () => {
    const { db, triggerRows } = makeInsertCapturingDb();
    await createMarketplaceAgent({
      catalogItem: ENGINEER_ITEM,
      companyId: "co-1",
      db: db as never,
      desiredName: "Engineer",
      template: normalize(withDisabledTriggers(ENGINEER_BODY), ENGINEER_ITEM),
    });

    expect(triggerRows).toHaveLength(2);
    expect(triggerRows.map((r) => r.enabled)).toEqual([false, false]);
  });

  it("writes enabled=true for the published (enabled) triggers", async () => {
    const { db, triggerRows } = makeInsertCapturingDb();
    await createMarketplaceAgent({
      catalogItem: ENGINEER_ITEM,
      companyId: "co-1",
      db: db as never,
      desiredName: "Engineer",
      template: normalize(ENGINEER_BODY, ENGINEER_ITEM),
    });

    expect(triggerRows.map((r) => r.enabled)).toEqual([true, true]);
  });
});

// ─── Step 4b: insert site #2 — crew-updater's re-insert ──────────────────────
//
// Adoption/update must not silently re-enable a trigger the catalog disabled.

describe("applyCrewAgentUpdate — trigger re-insert", () => {
  beforeEach(() => {
    updateBody.value = "";
  });

  async function runUpdate(body: string): Promise<Array<Record<string, unknown>>> {
    updateBody.value = body;
    const triggerRows: Array<Record<string, unknown>> = [];
    const tx = {
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          triggerRows.push(row);
          return Promise.resolve(undefined);
        },
      }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    };

    await applyCrewAgentUpdate({
      db: { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never,
      agentRow: {
        id: "agent-1",
        companyId: "co-1",
        name: "Engineer",
        adapterType: "claude_local",
        adapterConfig: {},
        runtimeConfig: {},
        skillKeys: [],
        templateVersion: "0.0.1",
      },
      catalogItem: ENGINEER_ITEM,
      instructionsService: {
        materializeManagedBundle: vi.fn().mockResolvedValue({ adapterConfig: {} }),
      } as never,
    });
    return triggerRows;
  }

  it("does NOT silently re-enable a trigger the catalog disabled", async () => {
    const rows = await runUpdate(withDisabledTriggers(ENGINEER_BODY));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.enabled)).toEqual([false, false]);
  });

  it("re-inserts the published triggers as enabled", async () => {
    const rows = await runUpdate(ENGINEER_BODY);
    expect(rows.map((r) => r.enabled)).toEqual([true, true]);
  });
});
