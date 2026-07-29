// Contract test (repo-standard proxy-table / sequence-db harness) for the A34
// fix: mcpConnectorService.list() must augment each connector row with
// `enabledAgentIds` — the per-agent opt-in set (D4). Without it the Settings
// Agents panel starts empty and a save (full-set-replace PUT) silently wipes
// already-enabled agents. Windows-runnable: no drizzle internals, no DB.
import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  desc: vi.fn((c: unknown) => ({ desc: c })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  inArray: vi.fn((c: unknown, v: unknown) => ({ inArray: [c, v] })),
  isNull: vi.fn((c: unknown) => ({ isNull: c })),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    });
  return {
    agents: makeTable("agents"),
    companyMcpConnectorAgents: makeTable("company_mcp_connector_agents"),
    companyMcpConnectors: makeTable("company_mcp_connectors"),
    companySecrets: makeTable("company_secrets"),
    internalAgentConfig: makeTable("internal_agent_config"),
  };
});

import { mcpConnectorService } from "../services/mcp-connectors-crud.js";

/** A thenable query chain that resolves to `rows` after any method calls. */
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return chain;
}

/** `select()` returns the next preconfigured result set in order. */
function makeSeqDb(...resultSets: unknown[][]) {
  let i = 0;
  return { select: () => makeChain(resultSets[i++] ?? []) } as any;
}

const COMPANY = "company-A";
const C1 = "conn-1";
const C2 = "conn-2";
const A1 = "agent-1";
const A2 = "agent-2";

describe("mcpConnectorService.list() — enabledAgentIds (A34)", () => {
  it("populates enabledAgentIds per connector (2 enabled -> both ids; none -> [])", async () => {
    const db = makeSeqDb(
      // 1st select: the connector rows
      [
        { id: C1, companyId: COMPANY, serverName: "notion" },
        { id: C2, companyId: COMPANY, serverName: "linear" },
      ],
      // 2nd select: the junction rows (C1 has two agents, C2 has none)
      [
        { connectorId: C1, agentId: A1 },
        { connectorId: C1, agentId: A2 },
      ],
    );

    const rows = await mcpConnectorService(db).list(COMPANY);

    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r: any) => [r.id, r]));
    expect(new Set(byId.get(C1).enabledAgentIds)).toEqual(new Set([A1, A2]));
    expect(byId.get(C2).enabledAgentIds).toEqual([]);
  });

  it("returns [] (and issues no junction query) when the company has no connectors", async () => {
    const select = vi.fn(() => makeChain([]));
    const db = { select } as any;

    const rows = await mcpConnectorService(db).list(COMPANY);

    expect(rows).toEqual([]);
    // Only the connector query ran — no follow-up junction query on an empty set.
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("includes Commander's implicit Codex runtime in delivery warnings", async () => {
    const db = makeSeqDb(
      [
        {
          id: C1,
          companyId: COMPANY,
          serverName: "filesystem",
          status: "active",
          transport: "stdio",
          source: "catalog",
          trustTier: "verified",
          url: null,
          command: "npx",
          args: ["filesystem-mcp@1.0.0"],
          headerTemplate: {},
          envTemplate: {},
          secretRef: null,
        },
      ],
      [], // no explicit agent assignments
      [{ agentId: "commander-1", cliTool: "codex" }],
      [], // active company-secret names
    );

    const [connector] = await mcpConnectorService(db).list(COMPANY);

    expect(connector.deliverability).toEqual({
      deliverable: false,
      reason: null,
      blockedAgents: [
        {
          agentId: "commander-1",
          agentName: "Commander",
          reason: "filesystem_isolation_required",
        },
      ],
    });
  });

  it("keeps Commander in delivery warnings while its linked agent is absent", async () => {
    const db = makeSeqDb(
      [
        {
          id: C1,
          companyId: COMPANY,
          serverName: "filesystem",
          status: "active",
          transport: "stdio",
          source: "catalog",
          trustTier: "verified",
          url: null,
          command: "npx",
          args: ["filesystem-mcp@1.0.0"],
          headerTemplate: {},
          envTemplate: {},
          secretRef: null,
        },
      ],
      [],
      [{ agentId: null, cliTool: "codex" }],
      [],
    );

    const [connector] = await mcpConnectorService(db).list(COMPANY);

    expect(connector.deliverability?.blockedAgents).toEqual([
      {
        agentId: `commander:${COMPANY}`,
        agentName: "Commander",
        reason: "filesystem_isolation_required",
      },
    ]);
  });
});
