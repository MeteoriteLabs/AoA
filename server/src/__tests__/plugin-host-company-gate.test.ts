import { describe, it, expect, vi, beforeEach } from "vitest";

// B-M5 — per-company plugin enable gate in host services.
//
// `ensurePluginAvailableForCompany` used to be a no-op, so a single
// instance-wide plugin worker could read/write EVERY company's data through
// the host-service data methods (issues/goals/agents/projects/activity…),
// including companies where it is toggled `disabled` in
// `plugin_company_settings`, and companies it does not even belong to.
//
// The gate must:
//   1. honor an EXPLICIT disable — a `plugin_company_settings` row with
//      `enabled = false` for (pluginId, companyId) → THROW.
//   2. NOT fail-closed — no settings row → ALLOW (the schema is
//      default-ENABLED: "no row => plugin is enabled for the company").
//   3. allow an explicit `enabled = true` row.
//   4. reject cross-company access — `plugins.companyId !== companyId`
//      (the `plugins` table is per-company / NOT NULL companyId).

// ---------------------------------------------------------------------------
// drizzle-orm — operators are stubbed to inert markers (we drive results by
// call sequence in the mock db, not by interpreting the where clause).
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  like: vi.fn((a: unknown, b: unknown) => ({ like: [a, b] })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
}));

// ---------------------------------------------------------------------------
// @armyofagents/db — table stubs. The gate reads `plugins` and
// `pluginCompanySettings`; the log buffer references `pluginLogs`.
// ---------------------------------------------------------------------------
vi.mock("@armyofagents/db", () => ({
  plugins: { id: "plugins.id", companyId: "plugins.companyId" },
  pluginCompanySettings: {
    pluginId: "pcs.pluginId",
    companyId: "pcs.companyId",
    enabled: "pcs.enabled",
  },
  pluginLogs: { id: "pluginLogs.id" },
  agentTaskSessions: { id: "ats.id" },
}));

// ---------------------------------------------------------------------------
// Service-factory modules. `buildHostServices` eagerly constructs each of
// these. The gate runs BEFORE the underlying service call, so for the
// "disabled / cross-company" cases the data-service stubs are never reached;
// for the allow cases they return data. We assert on whether `issues.list`
// was invoked to prove the gate ran first.
// ---------------------------------------------------------------------------
const issuesList = vi.fn(async () => [] as unknown[]);

vi.mock("../services/companies.js", () => ({
  companyService: () => ({ list: vi.fn(async () => []), getById: vi.fn(async () => null) }),
}));
vi.mock("../services/agents.js", () => ({
  agentService: () => ({ list: vi.fn(async () => []), getById: vi.fn(async () => null) }),
}));
vi.mock("../services/projects.js", () => ({
  projectService: () => ({ list: vi.fn(async () => []), getById: vi.fn(async () => null) }),
}));
vi.mock("../services/issues.js", () => ({
  issueService: () => ({
    list: issuesList,
    getById: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    listComments: vi.fn(async () => []),
    addComment: vi.fn(async () => ({})),
  }),
}));
vi.mock("../services/goals.js", () => ({
  goalService: () => ({ list: vi.fn(async () => []), getById: vi.fn(async () => null) }),
}));
vi.mock("../services/documents.js", () => ({ documentService: () => ({}) }));
vi.mock("../services/heartbeat.js", () => ({ heartbeatService: () => ({ wakeup: vi.fn() }) }));
vi.mock("../services/activity.js", () => ({ activityService: () => ({}) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({}) }));
vi.mock("../services/assets.js", () => ({ assetService: () => ({}) }));
vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => ({ getConfig: vi.fn(async () => null) }),
}));
vi.mock("../services/plugin-state-store.js", () => ({ pluginStateStore: () => ({}) }));
vi.mock("../services/plugin-secrets-handler.js", () => ({
  createPluginSecretsHandler: () => ({ resolve: vi.fn() }),
}));
vi.mock("../services/live-events.js", () => ({ subscribeCompanyLiveEvents: vi.fn(() => () => {}) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../services/feedback-transmission.js", () => ({
  transmitPluginTelemetry: vi.fn(async () => {}),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { buildHostServices } from "../services/plugin-host-services.js";

const PLUGIN_ID = "plugin-1";
const PLUGIN_KEY = "acme.linear";
const PLUGIN_COMPANY = "co-A";

/**
 * Sequence-based mock db. The gate runs two reads when `plugins` has a
 * companyId:
 *   1. load the plugin row → [{ id, companyId }]  (ownership / existence)
 *   2. load the settings row → [] | [{ enabled }] (explicit disable check)
 * We return these in order. `pluginCompanyRows` may be empty to simulate a
 * missing / cross-company plugin.
 */
function makeDb(opts: {
  pluginCompanyRows: { id: string; companyId: string }[];
  settingsRows: { enabled: boolean }[];
}) {
  const selectResults: unknown[][] = [opts.pluginCompanyRows, opts.settingsRows];
  let selectCall = 0;

  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const idx = selectCall;
          selectCall += 1;
          // `.where()` is awaited directly in some call sites and chained with
          // `.then()` in others — make it a thenable that also resolves.
          return Promise.resolve(selectResults[idx] ?? []);
        },
      }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  } as unknown as Parameters<typeof buildHostServices>[0];

  return { db };
}

function makeBus() {
  const scoped = { emit: vi.fn(), subscribe: vi.fn(), clear: vi.fn() };
  return { forPlugin: vi.fn(() => scoped) } as unknown as Parameters<typeof buildHostServices>[3];
}

describe("plugin host services — per-company enable gate (B-M5)", () => {
  beforeEach(() => {
    issuesList.mockClear();
  });

  it("THROWS when a settings row explicitly disables the plugin (enabled=false)", async () => {
    const { db } = makeDb({
      pluginCompanyRows: [{ id: PLUGIN_ID, companyId: PLUGIN_COMPANY }],
      settingsRows: [{ enabled: false }],
    });
    const host = buildHostServices(db, PLUGIN_ID, PLUGIN_KEY, makeBus());

    await expect(host.issues.list({ companyId: PLUGIN_COMPANY } as any)).rejects.toThrow(
      /disabled/i,
    );
    // Gate ran first → underlying data service never invoked.
    expect(issuesList).not.toHaveBeenCalled();
    host.dispose();
  });

  it("ALLOWS when there is NO settings row (default-enabled — proves no fail-closed)", async () => {
    const { db } = makeDb({
      pluginCompanyRows: [{ id: PLUGIN_ID, companyId: PLUGIN_COMPANY }],
      settingsRows: [],
    });
    const host = buildHostServices(db, PLUGIN_ID, PLUGIN_KEY, makeBus());

    await expect(host.issues.list({ companyId: PLUGIN_COMPANY } as any)).resolves.toEqual([]);
    expect(issuesList).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it("ALLOWS when a settings row exists with enabled=true", async () => {
    const { db } = makeDb({
      pluginCompanyRows: [{ id: PLUGIN_ID, companyId: PLUGIN_COMPANY }],
      settingsRows: [{ enabled: true }],
    });
    const host = buildHostServices(db, PLUGIN_ID, PLUGIN_KEY, makeBus());

    await expect(host.issues.list({ companyId: PLUGIN_COMPANY } as any)).resolves.toEqual([]);
    expect(issuesList).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it("REJECTS cross-company access (plugins.companyId !== requested companyId)", async () => {
    // Plugin belongs to co-A; worker requests data for co-B.
    const { db } = makeDb({
      // Ownership read filters by (id, companyId=co-B) → no row for this plugin.
      pluginCompanyRows: [],
      settingsRows: [],
    });
    const host = buildHostServices(db, PLUGIN_ID, PLUGIN_KEY, makeBus());

    await expect(host.issues.list({ companyId: "co-B" } as any)).rejects.toThrow(
      /not (found|available)|disabled/i,
    );
    expect(issuesList).not.toHaveBeenCalled();
    host.dispose();
  });
});
