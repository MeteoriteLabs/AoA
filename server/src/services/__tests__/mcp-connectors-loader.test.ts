/**
 * Unit tests for `loadEnabledConnectorRows` (Task 7).
 *
 * House pattern (see crew-budget.test.ts / thread-events.test.ts): mock
 * `@armyofagents/db` and `drizzle-orm` at module level with the shared
 * Proxy/operator helpers, then drive the loader with a sequence-based mock DB
 * that records which table each `.select()` read from — the Commander test
 * asserts on exactly that, since "did not query the join table" is otherwise
 * unobservable.
 *
 * `../secrets.js` is mocked rather than injected: it keeps the real secrets
 * module graph (providers, config-file access) out of the test, AND it leaves
 * the production call site `secretService(db)` on the tested path, which an
 * injected resolver would bypass.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "../../__tests__/helpers/drizzle-mock.js";

vi.mock("@armyofagents/db", () => ({
  companyMcpConnectors: makeTableProxy("company_mcp_connectors"),
  companyMcpConnectorAgents: makeTableProxy("company_mcp_connector_agents"),
}));

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

// Declared before the factories that close over them. Safe despite vi.mock
// hoisting: the factory body runs at import time, after these initialize.
const resolveByName = vi.fn();
const warn = vi.fn();

vi.mock("../secrets.js", () => ({
  secretService: () => ({ resolveByName }),
}));

vi.mock("../../middleware/logger.js", () => ({
  logger: { warn: (...args: unknown[]) => warn(...args) },
}));

import { loadEnabledConnectorRows, resolveAgentConnectors } from "../mcp-connectors-loader.js";

// ---------------------------------------------------------------------------
// Sequence-based mock DB. Each `.select()` consumes the next preset row set and
// records the table it read from.
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown>;

function tableNameOf(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const meta = (value as Record<string, unknown>)["_"];
    if (meta && typeof meta === "object") {
      const name = (meta as Record<string, unknown>).name;
      if (typeof name === "string") return name;
    }
  }
  return undefined;
}

function createSequenceDb(selects: MockRow[][]) {
  let selectIdx = 0;
  const selectedTables: (string | undefined)[] = [];

  const db = {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = (table: unknown) => {
        selectedTables.push(tableNameOf(table));
        return chain;
      };
      for (const m of ["where", "orderBy", "limit"]) {
        chain[m] = () => chain;
      }
      chain.then = (resolve: (v: MockRow[]) => unknown) =>
        Promise.resolve(resolve(selects[selectIdx++] ?? []));
      return chain;
    },
  };

  // The loader takes `Db`; the mock implements only the surface it touches.
  return { db: db as never, selectedTables };
}

/** A connector row with sane defaults; override per test. */
function connectorRow(overrides: MockRow = {}): MockRow {
  return {
    id: "conn-1",
    companyId: "co-1",
    serverName: "notion",
    transport: "http",
    url: "https://mcp.notion.com/mcp",
    command: null,
    args: [],
    headerTemplate: { Authorization: "Bearer ${TOKEN}" },
    envTemplate: {},
    secretRef: "mcp:notion",
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  resolveByName.mockReset();
  warn.mockReset();
});

describe("loadEnabledConnectorRows", () => {
  it("returns only the active connectors the agent opted into", async () => {
    const { db } = createSequenceDb([
      [
        connectorRow({ id: "c-active-in", serverName: "notion" }),
        connectorRow({ id: "c-active-out", serverName: "linear" }),
        connectorRow({ id: "c-pending", serverName: "slack", status: "pending_approval" }),
      ],
      // join table: the agent opted into the active one AND the pending one
      [{ connectorId: "c-active-in" }, { connectorId: "c-pending" }],
    ]);
    resolveByName.mockResolvedValue("secret-abc");

    const rows = await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: "agent-1" });

    // "linear" was active but not opted in; "slack" was opted in but not active.
    expect(rows.map((r) => r.serverName)).toEqual(["notion"]);
    expect(rows[0].secretValue).toBe("secret-abc");
  });

  it("gives Commander every active connector without querying the join table", async () => {
    const { db, selectedTables } = createSequenceDb([
      [
        connectorRow({ id: "c1", serverName: "notion" }),
        connectorRow({ id: "c2", serverName: "linear" }),
        connectorRow({ id: "c3", serverName: "slack", status: "disabled" }),
      ],
    ]);
    resolveByName.mockResolvedValue("secret-abc");

    const rows = await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: null });

    expect(rows.map((r) => r.serverName)).toEqual(["notion", "linear"]);
    // Exactly one read, and it was the connectors table — the opt-in join is
    // meaningless for Commander (D3) and must not be issued.
    expect(selectedTables).toEqual(["company_mcp_connectors"]);
  });

  it("skips a connector whose secret THROWS and still returns the healthy one (A19)", async () => {
    // Broken FIRST is the discriminating order: a `try` wrapping the whole loop
    // would abort at connector 0 and return [], so this case fails it — whereas
    // broken-last would swallow the late throw and still pass. This is the test
    // that distinguishes correct per-connector handling from a whole-loop try.
    const { db } = createSequenceDb([
      [
        connectorRow({ id: "c-broken", serverName: "broken", secretRef: "mcp:deleted" }),
        connectorRow({ id: "c-healthy", serverName: "healthy", secretRef: "mcp:notion" }),
      ],
      [{ connectorId: "c-broken" }, { connectorId: "c-healthy" }],
    ]);

    // Exactly what a dangling secretRef produces: resolveByName throws notFound.
    resolveByName.mockImplementation(async (_companyId: string, name: string) => {
      if (name === "mcp:deleted") {
        throw Object.assign(new Error("Secret not found: mcp:deleted"), { status: 404 });
      }
      return "secret-abc";
    });

    const rows = await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: "agent-1" });

    // The whole load did not abort: the healthy connector survives intact.
    expect(rows.map((r) => r.serverName)).toEqual(["healthy"]);
    expect(rows[0].secretValue).toBe("secret-abc");
    // The dropped connector is named in a warning, never swallowed silently.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      connectorId: "c-broken",
      serverName: "broken",
      secretRef: "mcp:deleted",
    });
  });

  it("still returns the healthy connector when the BROKEN one is resolved last", async () => {
    // Order-independence / defense-in-depth: this does NOT catch the whole-loop
    // `try` mutation (that swallows the late throw and passes — the broken-first
    // test above is what discriminates it). Its job is the complementary
    // guarantee: a failure on a LATE connector must not discard results already
    // accumulated from earlier healthy ones.
    const { db } = createSequenceDb([
      [
        connectorRow({ id: "c-healthy", serverName: "healthy", secretRef: "mcp:notion" }),
        connectorRow({ id: "c-broken", serverName: "broken", secretRef: "mcp:deleted" }),
      ],
      [{ connectorId: "c-healthy" }, { connectorId: "c-broken" }],
    ]);
    resolveByName.mockImplementation(async (_companyId: string, name: string) => {
      if (name === "mcp:deleted") throw new Error("Secret not found: mcp:deleted");
      return "secret-abc";
    });

    const rows = await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: "agent-1" });

    expect(rows.map((r) => r.serverName)).toEqual(["healthy"]);
  });

  it("returns secretValue null for a connector with no secretRef, without calling the resolver", async () => {
    const { db } = createSequenceDb([
      [connectorRow({ id: "c1", serverName: "public", secretRef: null })],
      [{ connectorId: "c1" }],
    ]);

    const rows = await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: "agent-1" });

    expect(rows).toHaveLength(1);
    expect(rows[0].secretValue).toBeNull();
    // An unauthenticated server is a valid configuration, not a failure: no
    // secrets lookup, no warning.
    expect(resolveByName).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes a system consumer context naming the connector", async () => {
    const { db } = createSequenceDb([
      [connectorRow({ id: "c1", serverName: "notion", secretRef: "mcp:notion" })],
      [{ connectorId: "c1" }],
    ]);
    resolveByName.mockResolvedValue("secret-abc");

    await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: "agent-1" });

    // consumerType "system" is load-bearing: it exempts the read from the
    // binding requirement in secrets.ts (shouldEnforceSecretBinding).
    expect(resolveByName).toHaveBeenCalledWith("co-1", "mcp:notion", {
      consumerType: "system",
      consumerId: "mcp-connectors",
      actorType: "system",
      configPath: "mcp.connector.notion",
    });
  });

  it("carries every spec-shaping column through to the returned row", async () => {
    const { db } = createSequenceDb([
      [
        connectorRow({
          id: "c1",
          serverName: "pg",
          transport: "stdio",
          url: null,
          command: "npx",
          args: ["-y", "dbhub"],
          headerTemplate: {},
          envTemplate: { DSN: "${TOKEN}" },
          secretRef: null,
        }),
      ],
      [{ connectorId: "c1" }],
    ]);

    const rows = await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: "agent-1" });

    // A dropped column would silently downgrade a connector at spawn time
    // rather than fail loudly, so assert the whole shape.
    expect(rows[0]).toEqual({
      serverName: "pg",
      transport: "stdio",
      url: null,
      command: "npx",
      args: ["-y", "dbhub"],
      headerTemplate: {},
      envTemplate: { DSN: "${TOKEN}" },
      secretValue: null,
    });
  });

  it("returns an empty array when the company has no connectors", async () => {
    // Only one row set: the 0-connector early-return fires before the join
    // table would ever be queried, so a second (join) select never happens.
    const { db } = createSequenceDb([[]]);

    const rows = await loadEnabledConnectorRows(db, { companyId: "co-1", agentId: "agent-1" });

    expect(rows).toEqual([]);
    expect(resolveByName).not.toHaveBeenCalled();
  });
});

describe("resolveAgentConnectors", () => {
  it("resolves an http connector with a resolvable secret into a placeholder spec + real env, no warn", async () => {
    const { db } = createSequenceDb([
      [connectorRow({ id: "c1", serverName: "notion", secretRef: "mcp:notion" })],
      [{ connectorId: "c1" }],
    ]);
    resolveByName.mockResolvedValue("secret-abc");
    const seamWarn = vi.fn();

    const result = await resolveAgentConnectors(db, {
      companyId: "co-1",
      agentId: "agent-1",
      runId: "run-1",
      logger: { warn: seamWarn },
    });

    expect(result.extraMcpServers.notion).toEqual({
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    });
    expect(result.connectorEnv.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
    expect(seamWarn).not.toHaveBeenCalled();
  });

  it("logs skipped connectors once through the passed-in logger and returns no spec for them", async () => {
    const { db } = createSequenceDb([
      [
        connectorRow({
          id: "c-bad",
          serverName: "broken-http",
          transport: "http",
          url: null,
          secretRef: null,
        }),
      ],
      [{ connectorId: "c-bad" }],
    ]);
    const seamWarn = vi.fn();

    const result = await resolveAgentConnectors(db, {
      companyId: "co-1",
      agentId: "agent-1",
      logger: { warn: seamWarn },
    });

    expect(result.extraMcpServers).toEqual({});
    expect(seamWarn).toHaveBeenCalledTimes(1);
    expect(seamWarn.mock.calls[0][0]).toMatchObject({
      companyId: "co-1",
      agentId: "agent-1",
      skipped: [{ serverName: "broken-http", reason: "missing_url" }],
    });
  });

  it("resolves every active connector without the join query when agentId is null (Commander)", async () => {
    const { db, selectedTables } = createSequenceDb([
      [
        connectorRow({ id: "c1", serverName: "notion", secretRef: "mcp:notion" }),
        connectorRow({ id: "c2", serverName: "linear", secretRef: "mcp:linear" }),
      ],
    ]);
    resolveByName.mockResolvedValue("secret-abc");
    const seamWarn = vi.fn();

    const result = await resolveAgentConnectors(db, {
      companyId: "co-1",
      agentId: null,
      logger: { warn: seamWarn },
    });

    expect(Object.keys(result.extraMcpServers).sort()).toEqual(["linear", "notion"]);
    expect(selectedTables).toEqual(["company_mcp_connectors"]);
    expect(seamWarn).not.toHaveBeenCalled();
  });
});
