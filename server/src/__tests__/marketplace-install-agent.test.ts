import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return { agents: tableProxy };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
}));

import { installAgent } from "../services/marketplace-install/agent-installer.js";
import type { CatalogItem } from "@armyofagents/shared";

const AGENT_TEMPLATE: CatalogItem = {
  id: "agent:aoa-curated/engineer",
  type: "agent",
  name: "Engineer",
  description: "Senior engineer agent",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://...", locator: "content/agents/engineer", commitSha: "abc123" },
  resourceUrl: "https://raw.githubusercontent.com/.../abc123/content/agents/engineer/agent.json",
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
  requires: [
    { type: "skill", id: "skill:aoa-curated/code-review" },
  ],
};

const AGENT_JSON_BODY = JSON.stringify({
  role: "engineer",
  title: "Senior Engineer",
  icon: "wrench",
  adapterType: "claude_local",
  adapterConfig: { model: "claude-sonnet-4" },
  runtimeConfig: { contextMode: "standard" },
  permissions: { canCommit: true },
  skillKeys: ["skill:aoa-curated/code-review"],
});

describe("installAgent", () => {
  let insertedRow: any = null;
  const mockDb = {
    insert: () => ({
      values: (row: any) => {
        insertedRow = row;
        return {
          returning: () => Promise.resolve([{ ...row, id: "agent-uuid-1" }]),
        };
      },
    }),
  };

  beforeEach(() => { insertedRow = null; });

  it("fetches agent.json, copies fields into agents row, sets templateOrigin/Version", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => AGENT_JSON_BODY,
    })) as any;

    const result = await installAgent({
      catalogItem: AGENT_TEMPLATE,
      companyId: "c1",
      db: mockDb as any,
      desiredName: "Engineer",
    });

    expect(insertedRow.companyId).toBe("c1");
    expect(insertedRow.name).toBe("Engineer");
    expect(insertedRow.role).toBe("engineer");
    expect(insertedRow.adapterType).toBe("claude_local");
    expect(insertedRow.skillKeys).toEqual(["skill:aoa-curated/code-review"]);
    expect(insertedRow.templateOrigin).toBe("agent:aoa-curated/engineer");
    expect(insertedRow.templateVersion).toBe("1.0.0");
    expect(result.agentId).toBe("agent-uuid-1");
  });

  it("throws if resourceUrl missing", async () => {
    const broken: CatalogItem = { ...AGENT_TEMPLATE, resourceUrl: undefined };
    await expect(
      installAgent({ catalogItem: broken, companyId: "c1", db: mockDb as any, desiredName: "X" }),
    ).rejects.toThrow(/has no resourceUrl/);
  });

  it("throws if agent.json is invalid JSON", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => "not json" })) as any;
    await expect(
      installAgent({ catalogItem: AGENT_TEMPLATE, companyId: "c1", db: mockDb as any, desiredName: "X" }),
    ).rejects.toThrow(/parse|json/i);
  });

  it("throws when HTTP fetch returns non-ok", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as any;
    await expect(
      installAgent({ catalogItem: AGENT_TEMPLATE, companyId: "c1", db: mockDb as any, desiredName: "X" }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("uses schema defaults when agent.json fields are missing", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ title: "Minimal Agent" }),  // only title set
    })) as any;

    await installAgent({
      catalogItem: AGENT_TEMPLATE,
      companyId: "c1",
      db: mockDb as any,
      desiredName: "Minimal",
    });

    expect(insertedRow.role).toBe("general");
    expect(insertedRow.adapterType).toBe("process");
    expect(insertedRow.skillKeys).toEqual([]);
    expect(insertedRow.adapterConfig).toEqual({});
    expect(insertedRow.runtimeConfig).toEqual({});
    expect(insertedRow.permissions).toEqual({});
    expect(insertedRow.budgetMonthlyCents).toBe(0);
  });

  it("sets metadata with catalog provenance", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => AGENT_JSON_BODY,
    })) as any;

    await installAgent({
      catalogItem: AGENT_TEMPLATE,
      companyId: "c1",
      db: mockDb as any,
      desiredName: "Engineer",
    });

    expect(insertedRow.metadata).toEqual(expect.objectContaining({
      catalogCategory: "engineering",
      catalogTags: [],
      catalogTrustTier: "verified",
    }));
    expect(insertedRow.metadata.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
