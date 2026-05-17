// Contract test for ensurePlatformAgent (proven harness: vi.hoisted +
// explicit @armyofagents/db named exports, per agents-list-excludes-platform).
// Windows-runnable. Asserts idempotency + the non-dispatchable heartbeat seed
// + the inactive (unlimited-until-configured) budget policy.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { eqMock, andMock } = vi.hoisted(() => ({
  eqMock: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  andMock: vi.fn((...args: unknown[]) => ({ and: args })),
}));

vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));

vi.mock("@armyofagents/db", () => {
  const t = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_x, p) => (typeof p === "string" ? Symbol(`${name}.${p}`) : undefined),
    });
  return { agents: t("agents"), budgetPolicies: t("budget_policies") };
});

import { ensurePlatformAgent, PLATFORM_AGENT_NAME } from "../services/internal-agent/subagents/platform-agent.js";

function selectChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = () => c;
  c.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return c;
}

describe("ensurePlatformAgent", () => {
  beforeEach(() => {
    eqMock.mockClear();
    andMock.mockClear();
  });

  it("returns the existing platform agent id without inserting a duplicate", async () => {
    const insert = vi.fn();
    const db: any = {
      select: () => selectChain([{ id: "pa-existing" }]),
      insert,
    };
    const id = await ensurePlatformAgent(db, "company-1");
    expect(id).toBe("pa-existing");
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates a non-dispatchable platform agent + inactive budget policy when absent", async () => {
    const agentValues: any[] = [];
    const policyValues: any[] = [];
    let insertCall = 0;
    const db: any = {
      select: () => selectChain([]), // none exists
      insert: () => {
        const which = insertCall++;
        return {
          values: (v: any) => {
            (which === 0 ? agentValues : policyValues).push(v);
            return {
              returning: () => Promise.resolve(which === 0 ? [{ id: "pa-new" }] : [{}]),
            };
          },
        };
      },
    };

    const id = await ensurePlatformAgent(db, "company-1");
    expect(id).toBe("pa-new");

    // Agent: kind='platform', heartbeat disabled (structurally non-dispatchable)
    const a = agentValues[0];
    expect(a.kind).toBe("platform");
    expect(a.name).toBe(PLATFORM_AGENT_NAME);
    expect(a.runtimeConfig.heartbeat).toEqual({ enabled: false, intervalSec: 0 });

    // Budget policy: agent-scoped, inactive (unlimited-until-configured)
    const p = policyValues[0];
    expect(p.scopeType).toBe("agent");
    expect(p.scopeId).toBe("pa-new");
    expect(p.isActive).toBe(false);
    expect(p.amountCents).toBe(0);
  });
});
