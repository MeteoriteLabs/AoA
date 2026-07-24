// A9.1 — proves the Commander-Team seeds are wired into the SOLE
// per-company create path (companyService.create → createCompanyWithUniquePrefix).
//
// Decision #100 ("the Commander Team comes with the app"): every newly-created
// company must eagerly get (1) a default internal_agent_config row and (2) the
// Commander kind='aoa' agent linked into that config.
//
// Phase 1 (Task C1 + Phase D batch 2): the Discussion Extraction ("Scribe")
// agent is no longer seeded at company create. The autonomous extraction drain
// is gated OFF (AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED); extraction now runs as
// tool calls from Memory Keeper + Adjutant. `ensureExtractionAgent` stays in
// the codebase for rollback safety (and is unit-tested in
// aoa-ensure-extraction-agent.test.ts) but is no longer wired into bootstrap,
// so this test no longer asserts it.
//
// The two remaining seeds are mocked here (their own units are covered by
// aoa-ensure-commander.test.ts); this test pins ONLY the wiring contract:
// invoked, with (db, newCompanyId), in order config → commander, after the
// root-folder seed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureConfigMock, ensureCommanderMock, ensureStewardMock, seedCalls, callOrder } =
  vi.hoisted(() => {
    const callOrder: string[] = [];
    // Every ensure-* seeder that actually ran, infra + crew, in order. Used by
    // the P8d marketplace-gate assertions.
    const seedCalls: string[] = [];
    return {
      callOrder,
      seedCalls,
      ensureConfigMock: vi.fn(async () => {
        callOrder.push("config");
        seedCalls.push("config");
      }),
      ensureCommanderMock: vi.fn(async () => {
        callOrder.push("commander");
        seedCalls.push("commander");
        return "cmd-1";
      }),
      ensureStewardMock: vi.fn(async () => {
        seedCalls.push("steward");
        return "stw-1";
      }),
    };
  });

// No-op drizzle operators + Proxy table stubs — the standard AoA-seed test
// harness (mirrors aoa-ensure-commander.test.ts) so importing companies.ts
// doesn't trigger the drizzle-orm ESM cycle.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  count: () => ({ op: "count" }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
  // T3.5 gate uses sql`` template tag — provide a tagged-template stub.
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ op: "sql", strings, vals }),
    {},
  ),
}));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy(
      {},
      { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) },
    );
  return {
    companies: t("companies"),
    agents: t("agents"),
    agentApiKeys: t("agent_api_keys"),
    agentConfigRevisions: t("agent_config_revisions"),
    agentProjects: t("agent_projects"),
    agentRuntimeState: t("agent_runtime_state"),
    agentTaskSessions: t("agent_task_sessions"),
    agentWakeupRequests: t("agent_wakeup_requests"),
    issues: t("issues"),
    issueApprovals: t("issue_approvals"),
    issueAttachments: t("issue_attachments"),
    issueComments: t("issue_comments"),
    issueDocuments: t("issue_documents"),
    issueReadStates: t("issue_read_states"),
    assets: t("assets"),
    projects: t("projects"),
    projectGoals: t("project_goals"),
    projectWorkspaces: t("project_workspaces"),
    executionWorkspaces: t("execution_workspaces"),
    goals: t("goals"),
    heartbeatRuns: t("heartbeat_runs"),
    heartbeatRunEvents: t("heartbeat_run_events"),
    heartbeatRunWatchdogDecisions: t("heartbeat_run_watchdog_decisions"),
    costEvents: t("cost_events"),
    financeEvents: t("finance_events"),
    approvalComments: t("approval_comments"),
    approvals: t("approvals"),
    activityLog: t("activity_log"),
    companySecrets: t("company_secrets"),
    companySkills: t("company_skills"),
    documents: t("documents"),
    documentRevisions: t("document_revisions"),
    feedbackExports: t("feedback_exports"),
    feedbackVotes: t("feedback_votes"),
    joinRequests: t("join_requests"),
    invites: t("invites"),
    notifications: t("notifications"),
    principalPermissionGrants: t("principal_permission_grants"),
    companyMemberships: t("company_memberships"),
    mcpApiKeys: t("mcp_api_keys"),
    mcpClientConnections: t("mcp_client_connections"),
    workspaceOperations: t("workspace_operations"),
    workspaceRuntimeServices: t("workspace_runtime_services"),
  };
});
// memory-folders is invoked by createCompanyWithUniquePrefix (root-folder
// seed) — stub it so the seed is a no-op but still ordered before our seeds.
vi.mock("../services/memory-folders.js", () => ({
  memoryFoldersService: () => ({}),
  seedCompanyRootFolder: vi.fn(async () => {
    callOrder.push("rootFolder");
  }),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-internal-agent-config.js", () => ({
  ensureInternalAgentConfig: ensureConfigMock,
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({
  ensureCommanderAgent: ensureCommanderMock,
}));
// The additional crew seeders introduced in Phase D batch 1 (Command Staff,
// Adjutant, Scout, Engineer) are mocked as no-ops here. This test only pins
// the wiring contract for the Decision #100 minimum (config + commander); the
// crew seeders have their own unit tests and the marketplace gate test
// asserts their order.
vi.mock("../services/internal-agent/aoa-agents/ensure-steward.js", () => ({
  ensureSteward: ensureStewardMock,
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-command-staff.js", () => ({
  ensureCommandStaff: vi.fn(async () => { seedCalls.push("staff"); }),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-adjutant.js", () => ({
  ensureAdjutant: vi.fn(async () => { seedCalls.push("adjutant"); }),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-scout.js", () => ({
  ensureScout: vi.fn(async () => { seedCalls.push("scout"); }),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-engineer.js", () => ({
  ensureEngineer: vi.fn(async () => { seedCalls.push("engineer"); }),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-chronicler.js", () => ({
  ensureChronicler: vi.fn(async () => { seedCalls.push("chronicler"); }),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-librarian.js", () => ({
  ensureLibrarian: vi.fn(async () => { seedCalls.push("librarian"); }),
}));

import { companyService } from "../services/companies.js";

const NEW_COMPANY_ID = "co-new-9";

// Minimal mock DB: the only DB op createCompanyWithUniquePrefix performs on
// the happy path is `db.insert(companies).values(...).returning()` → returns
// the freshly-created company row (with id). All ensure-seeds are mocked,
// so no further DB ops are exercised by this test.
//
// T3.5 addition: createCompanyWithUniquePrefix now calls
// db.select().from(agents).where(...).limit(1) to check whether a marketplace-
// governed crew already exists. Returning [] simulates a fresh legacy company
// so the legacy ensure-*.ts path still runs and the wiring assertions hold.
//
// P8d: `managed` flips the inline marketplace gate — [{ id }] means an
// `agent:…` row with a non-`@legacy` templateOrigin already exists, i.e. the
// marketplace governs this company's crew.
function makeDb(opts: { managed?: boolean } = {}) {
  return {
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: NEW_COMPANY_ID, name: "Acme" }]),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(opts.managed ? [{ id: "mkt-agent-1" }] : []),
        }),
      }),
    }),
  } as any;
}

describe("A9.1 — Commander-Team seeds wired into createCompanyWithUniquePrefix", () => {
  beforeEach(() => {
    ensureConfigMock.mockClear();
    ensureCommanderMock.mockClear();
    ensureStewardMock.mockClear();
    callOrder.length = 0;
    seedCalls.length = 0;
  });

  it("calls config + commander seeds with (db, newCompanyId)", async () => {
    const db = makeDb();
    const svc = companyService(db);

    const company = await svc.create({ name: "Acme" } as any);
    expect(company.id).toBe(NEW_COMPANY_ID);

    expect(ensureConfigMock).toHaveBeenCalledWith(db, NEW_COMPANY_ID);
    expect(ensureCommanderMock).toHaveBeenCalledWith(db, NEW_COMPANY_ID);
  });

  it("seeds in order: root-folder → config → commander", async () => {
    const db = makeDb();
    await companyService(db).create({ name: "Acme" } as any);

    // ensureCommander's internal_agent_config UPDATE no-ops unless the config
    // row exists first, so config MUST precede commander. (Phase 1 / Phase D
    // batch 2: the Discussion Extraction seed was removed from this chain;
    // see file-level docstring.)
    expect(callOrder).toEqual(["rootFolder", "config", "commander"]);
  });

  // ── P8d — the marketplace gate covers the CREW half only ────────────────
  it("marketplace-managed company: config + infrastructure still seed, crew does NOT", async () => {
    const db = makeDb({ managed: true });
    await companyService(db).create({ name: "Acme" } as any);

    // The casualty this task fixes: internal_agent_config used to live inside
    // the gated block, so a marketplace-managed company got NO config row —
    // no autonomy dial, no provider/model config.
    expect(ensureConfigMock).toHaveBeenCalledWith(db, NEW_COMPANY_ID);
    expect(ensureCommanderMock).toHaveBeenCalledWith(db, NEW_COMPANY_ID);
    expect(ensureStewardMock).toHaveBeenCalledWith(db, NEW_COMPANY_ID);

    // Discriminator: Scout IS published in the catalog, so the marketplace owns
    // it and the legacy seeder must stay off.
    expect(seedCalls).not.toContain("scout");
    expect(seedCalls).toEqual(["config", "commander", "steward"]);
  });

  it("NOT marketplace-managed: the full legacy roster still seeds (regression)", async () => {
    const db = makeDb();
    await companyService(db).create({ name: "Acme" } as any);

    expect(seedCalls.slice().sort()).toEqual(
      ["adjutant", "chronicler", "commander", "config", "engineer", "librarian", "scout", "staff", "steward"],
    );
  });
});
