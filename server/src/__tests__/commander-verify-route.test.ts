import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());
vi.mock("@armyofagents/db", () => ({
  companyMemberships: makeTableProxy("company_memberships"),
}));

const mockResolveType = vi.hoisted(() => vi.fn());
const mockFindAdapter = vi.hoisted(() => vi.fn());
const mockTestEnvironment = vi.hoisted(() => vi.fn());

vi.mock("../services/commander-verify.js", async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  // keep the real classifier; stub only the db-touching resolver
  return { ...actual, resolveCommanderAdapterType: mockResolveType };
});
vi.mock("../adapters/registry.js", () => ({ findServerAdapter: mockFindAdapter }));

import { commanderVerifyRoutes } from "../routes/commander-verify.js";

const COMPANY_ID = "c1";

function dbWithMembership(rows: unknown[]) {
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) } as never;
}
function makeApp(db: unknown, actorOverride?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = (actorOverride ?? {
      type: "board",
      source: "session",
      userId: "u1",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: false,
    }) as never;
    next();
  });
  app.use("/api", commanderVerifyRoutes(db as never));
  return app;
}
const probe = (status: "pass" | "warn" | "fail", codes: string[]) => ({
  adapterType: "claude_local",
  status,
  checks: codes.map((code) => ({ code, level: "info", message: code })),
  testedAt: "",
});

describe("POST /companies/:companyId/internal-agent/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveType.mockResolvedValue("claude_local");
    mockFindAdapter.mockReturnValue({ testEnvironment: mockTestEnvironment });
  });

  it("401 for a non-board actor", async () => {
    const res = await request(makeApp(dbWithMembership([{ id: COMPANY_ID }]), { type: "agent" }))
      .post(`/api/companies/${COMPANY_ID}/internal-agent/verify`)
      .send({});
    expect(res.status).toBe(401);
  });

  it("403 when the user is not a member", async () => {
    const res = await request(makeApp(dbWithMembership([]), {
      type: "board",
      source: "session",
      userId: "u1",
      companyIds: [],
      isInstanceAdmin: false,
    }))
      .post(`/api/companies/${COMPANY_ID}/internal-agent/verify`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("allows an instance admin to verify a company without a membership row", async () => {
    mockTestEnvironment.mockResolvedValue(probe("pass", ["claude_hello_probe_passed"]));

    const res = await request(makeApp(dbWithMembership([]), {
      type: "board",
      source: "session",
      userId: "u1",
      isInstanceAdmin: true,
      companyIds: [],
    }))
      .post(`/api/companies/${COMPANY_ID}/internal-agent/verify`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("verified");
  });

  it("200 verified when the probe passes", async () => {
    mockTestEnvironment.mockResolvedValue(probe("pass", ["claude_hello_probe_passed"]));
    const res = await request(makeApp(dbWithMembership([{ id: COMPANY_ID }])))
      .post(`/api/companies/${COMPANY_ID}/internal-agent/verify`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("verified");
  });

  it("422 needs_auth (blocking) when login is required", async () => {
    mockTestEnvironment.mockResolvedValue(probe("fail", ["claude_hello_probe_auth_required"]));
    const res = await request(makeApp(dbWithMembership([{ id: COMPANY_ID }])))
      .post(`/api/companies/${COMPANY_ID}/internal-agent/verify`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.outcome).toBe("needs_auth");
  });

  it("404 when the resolved adapter has no probe", async () => {
    mockFindAdapter.mockReturnValue(null);
    const res = await request(makeApp(dbWithMembership([{ id: COMPANY_ID }])))
      .post(`/api/companies/${COMPANY_ID}/internal-agent/verify`)
      .send({});
    expect(res.status).toBe(404);
  });
});
