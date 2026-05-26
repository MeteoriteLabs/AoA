// F4 (hygiene): runner.ts wrote tmpdir()/aoa-mcp-<agentId>-<runId>.json and
// never removed it -> unbounded os.tmpdir() growth under load. This contract
// test asserts the mcp-config temp file is unlinked after EVERY run (success
// or failure) and that a failing unlink never escapes runAoaAgent's
// hard-error boundary.
//
// Contract test (proxy-table + hoisted-mock harness, per
// aoa-mention-resolution.test.ts / aoa-runner.test.ts). Windows-runnable.
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above top-level consts; mock fns we also assert on must
// be created via vi.hoisted (vitest-sanctioned pattern).
const {
  writeFileMock,
  unlinkMock,
  adapterExecute,
  createEventMock,
  buildMcpMock,
  buildBridgeSpecMock,
} = vi.hoisted(() => ({
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  unlinkMock: vi.fn().mockResolvedValue(undefined),
  adapterExecute: vi.fn().mockResolvedValue(undefined),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  buildMcpMock: vi.fn(() => ({})),
  buildBridgeSpecMock: vi.fn(() => ({
    command: "node",
    args: ["/bridge.js"],
    env: { AOA_SESSION_COMPANY_ID: "c" },
  })),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: writeFileMock,
  unlink: unlinkMock,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    });
  // Exactly the tables runner.ts imports (line 6 of runner.ts).
  return {
    agents: makeTable("agents"),
    internalAgentRuns: makeTable("internal_agent_runs"),
    discussionEntries: makeTable("discussion_entries"),
  };
});

vi.mock("../adapters/registry.js", () => ({
  getServerAdapter: vi.fn(() => ({ execute: adapterExecute })),
}));

vi.mock("../services/internal-agent/cli-mode.js", () => ({
  buildMcpConfig: buildMcpMock,
  buildMcpBridgeSpec: buildBridgeSpecMock,
}));

vi.mock("../services/heartbeat.js", () => ({
  resolveAdapterExecutionContext: vi.fn(() => ({
    executionTarget: {},
    runtimeCommandSpec: {},
  })),
}));

vi.mock("../services/internal-agent/aoa-agents/bridge-path.js", () => ({
  resolveBridgeEntrypoint: vi.fn(() => "/bridge"),
}));

vi.mock("../services/costs.js", () => ({
  costService: vi.fn(() => ({ createEvent: createEventMock })),
}));

vi.mock("../middleware/logger.js", () => {
  function makeLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => makeLogger();
    return l;
  }
  return { logger: makeLogger() };
});

import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";

// Flexible chainable mock that satisfies every db call shape runner.ts needs:
//  - db.select().from(agents).where(eq(...)).then(r => r[0] ?? null)  → agent row
//  - db.insert(internalAgentRuns).values({...}).returning()           → [{id}]
//  - db.update(internalAgentRuns).set({...}).where(eq(...))           → ok
// (entryId is omitted in these tests so the discussionEntries claim path is
// skipped — no .returning() needed for the claim.)
function makeDb() {
  const agentRow = {
    id: "a-1",
    companyId: "co-1",
    name: "Scribe",
    adapterType: "process",
    runtimeConfig: { aoa: { role: "scribe" } },
    adapterConfig: {},
  };
  const selectChain: any = {};
  selectChain.from = () => selectChain;
  selectChain.where = () => selectChain;
  selectChain.then = (resolve: (v: unknown[]) => unknown) =>
    Promise.resolve([agentRow]).then(resolve);

  const updateChain: any = {};
  updateChain.set = () => updateChain;
  updateChain.where = () => updateChain;
  updateChain.returning = () => Promise.resolve([{ id: "run-1" }]);
  updateChain.then = (resolve: (v: unknown[]) => unknown) =>
    Promise.resolve([{ id: "run-1" }]).then(resolve);

  return {
    select: () => selectChain,
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: "run-1" }]) }),
    }),
    update: () => updateChain,
  };
}

describe("F4: runAoaAgent unlinks the mcp-config temp file after every run", () => {
  beforeEach(() => {
    writeFileMock.mockClear().mockResolvedValue(undefined);
    unlinkMock.mockClear().mockResolvedValue(undefined);
    adapterExecute.mockClear().mockResolvedValue(undefined);
    createEventMock.mockClear().mockResolvedValue(undefined);
    buildMcpMock.mockClear().mockReturnValue({});
  });

  it("unlinks the mcp temp file after a successful adapter run", async () => {
    adapterExecute.mockResolvedValue(undefined);
    await runAoaAgent(makeDb() as any, "a-1", { companyId: "co-1", source: "wakeup" });
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(String(unlinkMock.mock.calls[0][0])).toMatch(/aoa-mcp-a-1-.*\.json$/);
  });

  it("unlinks even when the adapter throws", async () => {
    adapterExecute.mockRejectedValueOnce(new Error("boom"));
    await expect(
      runAoaAgent(makeDb() as any, "a-1", { companyId: "co-1", source: "wakeup" }),
    ).resolves.toMatchObject({ status: expect.stringMatching(/succeeded|failed/) }); // T1.0
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it("a failing unlink never throws out of runAoaAgent", async () => {
    adapterExecute.mockResolvedValue(undefined);
    unlinkMock.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(
      runAoaAgent(makeDb() as any, "a-1", { companyId: "co-1", source: "wakeup" }),
    ).resolves.toMatchObject({ status: expect.stringMatching(/succeeded|failed/) }); // T1.0
  });
});
