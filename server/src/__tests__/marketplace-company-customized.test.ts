import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    marketplacePendingUpdates: tableProxy,
    companySkills: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("eq"),
  and: () => Symbol("and"),
  ne: () => Symbol("ne"),
}));
vi.mock("../services/marketplace-notifications.js", () => ({
  marketplaceNotifications: {
    installRequested: vi.fn(),
  },
}));
vi.mock("../services/marketplace-settings.js", () => ({
  marketplaceSettingsService: vi.fn(() => ({ get: vi.fn(), patch: vi.fn() })),
}));
vi.mock("../services/marketplace-merge.js", () => ({
  computeSectionDiff: vi.fn(() => [{ heading: "## Overview", mine: "old", theirs: "new" }]),
  applyMergeDecisions: vi.fn(() => "# Merged Content"),
}));
vi.mock("../routes/authz.js", () => ({
  assertBoard: vi.fn(),
  assertCompanyAccess: vi.fn(),
}));

import { createMarketplaceCompanyRouter } from "../routes/marketplace-company.js";

function buildApp(dbOverrides: any = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.actor = { type: "board", source: "local_implicit", userId: "u1", companyId: "c1" };
    next();
  });

  const UPDATE_ROW = {
    id: "upd-1",
    companyId: "c1",
    catalogItemId: "skill:aoa-curated/code-review",
    catalogItemName: "Code Review",
    itemType: "skill",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    status: "pending",
  };
  const SKILL_ROW = { id: "skill-1", markdown: "# Old Content" };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([UPDATE_ROW]),
        then: (r: any) => r([UPDATE_ROW]),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => {
          dbOverrides.capturedSets?.push(values);
          return Promise.resolve();
        },
      }),
    }),
    ...dbOverrides.db,
  };

  // Second select for skill row needs different data
  let selectCall = 0;
  const txSetsCapture: any[][] = [];

  const smartDb: any = {
    select: () => {
      selectCall++;
      const n = selectCall;
      return {
        from: () => ({
          where: () => Promise.resolve(n === 1 ? [UPDATE_ROW] : [SKILL_ROW]),
        }),
      };
    },
    update: db.update,
    transaction: async (cb: (tx: any) => Promise<any>) => {
      const txSets: any[] = [];
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: () => {
              txSets.push(values);
              dbOverrides.capturedSets?.push(values);
              return Promise.resolve();
            },
          }),
        }),
      };
      const result = await cb(tx);
      txSetsCapture.push(txSets);
      return result;
    },
    _txSetsCapture: txSetsCapture,
  };

  const router = createMarketplaceCompanyRouter({
    db: smartDb as any,
    catalogService: {
      readCache: async () => ({
        schemaVersion: "1.0.0",
        generatedAt: "2026-04-30T00:00:00Z",
        itemCount: 1,
        items: [{
          id: "skill:aoa-curated/code-review",
          type: "skill" as const,
          name: "Code Review",
          description: "...",
          version: "1.1.0",
          source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
          resourceUrl: "https://example.com/SKILL.md",
          trust: { tier: "verified" as const, source: "aoa-curated" },
          status: "active" as const,
          addedAt: "2026-04-30T00:00:00Z",
          category: "engineering" as const,
          tags: [],
        }],
      }),
    },
  });

  app.use("/api/companies/:companyId/marketplace", router);
  return { app, smartDb };
}

describe("POST /updates/:id/merge — sets customized = true", () => {
  it("includes customized: true in the skill update SET clause", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => "# New upstream content",
    })) as any;

    const capturedSets: any[] = [];
    const { app } = buildApp({ capturedSets });

    const res = await request(app)
      .post("/api/companies/c1/marketplace/updates/upd-1/merge")
      .send({ decisions: { "## Overview": "theirs" } });

    expect(res.status).toBe(200);
    // Fails before the fix — current code omits customized from the SET clause
    expect(capturedSets.some((s) => s.customized === true)).toBe(true);
  });

  it("executes both the skill update and the pending-update status change inside a single transaction", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => "# New upstream content",
    })) as any;

    const capturedSets: any[] = [];
    const { app, smartDb } = buildApp({ capturedSets });

    const res = await request(app)
      .post("/api/companies/c1/marketplace/updates/upd-1/merge")
      .send({ decisions: { "## Overview": "theirs" } });

    expect(res.status).toBe(200);

    // Exactly one transaction should have been opened
    expect(smartDb._txSetsCapture).toHaveLength(1);

    const txSets = smartDb._txSetsCapture[0];
    // Transaction must contain both writes: the skill update and the pending-update status
    expect(txSets.some((s: any) => "markdown" in s)).toBe(true);   // skill update
    expect(txSets.some((s: any) => s.status === "applied")).toBe(true); // pending update
  });
});
