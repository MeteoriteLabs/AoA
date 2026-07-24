import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route imports only mocked service factories + loadConfig at runtime; it
// touches neither drizzle-orm nor @armyofagents/db directly (Db is a type-only
// import), so no table/operator stubs are needed here.

let deploymentMode = "authenticated";
vi.mock("../config.js", () => ({
  loadConfig: () => ({ deploymentMode }),
}));

const mockConnectorSvc = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listAgentIds: vi.fn(),
  agentIdsInCompany: vi.fn(),
  replaceAgents: vi.fn(),
}));

const mockSecretSvc = vi.hoisted(() => ({
  getByName: vi.fn(),
}));

const mockApprovalSvc = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  mcpConnectorService: () => mockConnectorSvc,
  secretService: () => mockSecretSvc,
  approvalService: () => mockApprovalSvc,
  logActivity: mockLogActivity,
}));

const mockGetEffectiveRole = vi.hoisted(() => vi.fn());
vi.mock("../services/permissions.js", () => ({
  permissionService: () => ({
    getEffectiveRole: mockGetEffectiveRole,
    isFounder: vi.fn(),
  }),
}));

import { mcpConnectorRoutes, assertTransportAllowed } from "../routes/mcp-connectors.js";
import { errorHandler } from "../middleware/index.js";

const COMPANY = "company-A";
const CONNECTOR_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_A = "22222222-2222-4222-8222-222222222222";
const AGENT_B = "33333333-3333-4333-8333-333333333333";
const FOUNDER_UUID = "44444444-4444-4444-8444-444444444444";

const founderActor = {
  type: "board" as const,
  source: "session" as const,
  userId: FOUNDER_UUID,
  companyIds: [COMPANY],
  isInstanceAdmin: false,
};

function actorWithRole(role: string) {
  mockGetEffectiveRole.mockResolvedValue(role);
  return founderActor;
}

function makeApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", mcpConnectorRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const goodHttp = {
  serverName: "notion",
  displayName: "Notion",
  transport: "http",
  url: "https://mcp.notion.example/v1",
};

const goodStdio = {
  serverName: "local-fs",
  displayName: "Local FS",
  transport: "stdio",
  command: "npx",
  args: ["-y", "fs-mcp"],
};

function postConnector(app: express.Express, body: unknown) {
  return request(app).post(`/api/companies/${COMPANY}/mcp-connectors`).send(body as object);
}

describe("mcp-connectors routes — validation (load-bearing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentMode = "authenticated";
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getByName.mockResolvedValue(null);
    mockConnectorSvc.create.mockImplementation(async (_c: string, input: any) => ({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      ...input,
    }));
    mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });
  });

  it.each([
    ["uppercase", "Notion"],
    ["underscore", "note_ion"],
    ["space", "note ion"],
    ["__proto__", "__proto__"],
    ["empty", ""],
  ])("rejects serverName with %s -> 400", async (_label, serverName) => {
    const res = await postConnector(makeApp(founderActor), { ...goodHttp, serverName });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects http without url -> 400", async () => {
    const { url: _url, ...noUrl } = goodHttp;
    const res = await postConnector(makeApp(founderActor), noUrl);
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects http with command -> 400", async () => {
    const res = await postConnector(makeApp(founderActor), { ...goodHttp, command: "npx" });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects stdio without command -> 400", async () => {
    const { command: _cmd, ...noCmd } = goodStdio;
    const res = await postConnector(makeApp(founderActor), noCmd);
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects stdio with url -> 400", async () => {
    const res = await postConnector(makeApp(founderActor), {
      ...goodStdio,
      url: "https://x.example",
    });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects args as a string -> 400", async () => {
    const res = await postConnector(makeApp(founderActor), { ...goodStdio, args: "not-an-array" });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects headerTemplate with a non-string value -> 400", async () => {
    const res = await postConnector(makeApp(founderActor), {
      ...goodHttp,
      headerTemplate: { Authorization: 123 },
    });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects envTemplate with a non-string value -> 400", async () => {
    const res = await postConnector(makeApp(founderActor), {
      ...goodStdio,
      envTemplate: { TOKEN: 123 },
    });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown top-level field -> 400 (strict)", async () => {
    const res = await postConnector(makeApp(founderActor), { ...goodHttp, evil: true });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("accepts a good http connector -> 201", async () => {
    const res = await postConnector(makeApp(founderActor), goodHttp);
    expect(res.status).toBe(201);
    expect(mockConnectorSvc.create).toHaveBeenCalledTimes(1);
  });

  it("accepts a good stdio connector in local_trusted -> 201", async () => {
    // D7: stdio is host-executing, so it is admissible only when the host is the
    // founder's own machine. This is the exact case authenticated mode forbids.
    deploymentMode = "local_trusted";
    const res = await postConnector(makeApp(founderActor), goodStdio);
    expect(res.status).toBe(201);
    expect(mockConnectorSvc.create).toHaveBeenCalledTimes(1);
  });
});

describe("assertTransportAllowed — D7 stdio gate (unit truth table)", () => {
  it("stdio BYO in authenticated -> throws", () => {
    expect(() => assertTransportAllowed("stdio", "authenticated", "byo")).toThrow();
  });

  it("stdio BYO in local_trusted -> ok", () => {
    expect(() => assertTransportAllowed("stdio", "local_trusted", "byo")).not.toThrow();
  });

  it("http BYO in authenticated -> ok", () => {
    expect(() => assertTransportAllowed("http", "authenticated", "byo")).not.toThrow();
  });

  it("stdio + catalog in authenticated -> ok (verified-catalog exemption)", () => {
    // C4: the exemption is now tier-aware, so the tier must be stated. Before C4
    // this case passed with the tier omitted — that omission WAS the defect.
    expect(() => assertTransportAllowed("stdio", "authenticated", "catalog", "verified")).not.toThrow();
  });
});

describe("assertTransportAllowed — tier awareness (C4)", () => {
  it("allows a VERIFIED catalog stdio connector in authenticated mode", () => {
    expect(() => assertTransportAllowed("stdio", "authenticated", "catalog", "verified")).not.toThrow();
  });

  it("REJECTS an unverified catalog stdio connector in authenticated mode", () => {
    expect(() => assertTransportAllowed("stdio", "authenticated", "catalog", "community")).toThrow(/verified/i);
  });

  it("REJECTS a catalog stdio connector with no tier supplied (fail-closed)", () => {
    expect(() => assertTransportAllowed("stdio", "authenticated", "catalog", undefined)).toThrow();
  });

  it("still allows any stdio in local_trusted", () => {
    expect(() => assertTransportAllowed("stdio", "local_trusted", "catalog", "community")).not.toThrow();
  });

  it("still allows http regardless of tier", () => {
    expect(() => assertTransportAllowed("http", "authenticated", "catalog", "community")).not.toThrow();
  });

  it("rejects byo stdio in authenticated mode (unchanged)", () => {
    expect(() => assertTransportAllowed("stdio", "authenticated", "byo", undefined)).toThrow();
  });
});

describe("mcp-connectors routes — D7 transport policy (HTTP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getByName.mockResolvedValue(null);
    mockConnectorSvc.create.mockImplementation(async (_c: string, input: any) => ({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      ...input,
    }));
    mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });
  });

  it("stdio BYO in authenticated -> 400, no write", async () => {
    deploymentMode = "authenticated";
    const res = await postConnector(makeApp(founderActor), goodStdio);
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("stdio BYO in local_trusted -> 201", async () => {
    deploymentMode = "local_trusted";
    const res = await postConnector(makeApp(founderActor), goodStdio);
    expect(res.status).toBe(201);
  });

  it("http BYO in authenticated -> 201", async () => {
    deploymentMode = "authenticated";
    const res = await postConnector(makeApp(founderActor), goodHttp);
    expect(res.status).toBe(201);
  });
});

describe("mcp-connectors routes — C3 client source is not trusted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getByName.mockResolvedValue(null);
    mockConnectorSvc.create.mockImplementation(async (_c: string, input: any) => ({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      ...input,
    }));
    mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });
  });

  it("a spoofed source:catalog on an http create is stored as byo", async () => {
    deploymentMode = "authenticated";
    const res = await postConnector(makeApp(founderActor), { ...goodHttp, source: "catalog" });
    expect(res.status).toBe(201);
    expect(mockConnectorSvc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ source: "byo" }),
    );
  });

  it("a spoofed source:catalog cannot smuggle a stdio connector past D7", async () => {
    deploymentMode = "authenticated";
    const res = await postConnector(makeApp(founderActor), { ...goodStdio, source: "catalog" });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });
});

describe("mcp-connectors routes — secretRef existence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentMode = "authenticated";
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getByName.mockResolvedValue(null);
    mockConnectorSvc.create.mockResolvedValue({ id: CONNECTOR_ID, serverName: "notion" });
    mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });
  });

  it("rejects a connector whose secretRef points at a missing secret -> 400", async () => {
    mockSecretSvc.getByName.mockResolvedValue(null);
    const res = await postConnector(makeApp(founderActor), { ...goodHttp, secretRef: "mcp:notion" });
    expect([400, 422]).toContain(res.status);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("accepts a connector whose secretRef exists -> 201", async () => {
    mockSecretSvc.getByName.mockResolvedValue({ id: "secret-1", name: "mcp:notion" });
    const res = await postConnector(makeApp(founderActor), { ...goodHttp, secretRef: "mcp:notion" });
    expect(res.status).toBe(201);
    expect(mockSecretSvc.getByName).toHaveBeenCalledWith(COMPANY, "mcp:notion");
  });
});

describe("mcp-connectors routes — deployment mode + approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getByName.mockResolvedValue(null);
    mockConnectorSvc.create.mockImplementation(async (_c: string, input: any) => ({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      ...input,
    }));
    mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });
  });

  it("local_trusted -> connector active, no approval raised", async () => {
    deploymentMode = "local_trusted";
    const res = await postConnector(makeApp(founderActor), goodHttp);
    expect(res.status).toBe(201);
    expect(mockConnectorSvc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ status: "active" }),
    );
    expect(mockApprovalSvc.create).not.toHaveBeenCalled();
  });

  it("authenticated -> connector pending_approval + approval raised", async () => {
    deploymentMode = "authenticated";
    const res = await postConnector(makeApp(founderActor), goodHttp);
    expect(res.status).toBe(201);
    expect(mockConnectorSvc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ status: "pending_approval" }),
    );
    expect(mockApprovalSvc.create).toHaveBeenCalledTimes(1);
    expect(mockApprovalSvc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({
        type: "install_mcp_connector",
        status: "pending",
        payload: expect.objectContaining({ connectorId: CONNECTOR_ID }),
      }),
    );
  });
});

describe("mcp-connectors routes — RBAC (founder-only writes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentMode = "authenticated";
    mockConnectorSvc.getByName.mockResolvedValue(null);
    mockConnectorSvc.create.mockResolvedValue({ id: CONNECTOR_ID, serverName: "notion" });
    mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });
  });

  it("team_member POST -> 403", async () => {
    const res = await postConnector(makeApp(actorWithRole("team_member")), goodHttp);
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("team_lead POST -> 403", async () => {
    const res = await postConnector(makeApp(actorWithRole("team_lead")), goodHttp);
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("founder POST -> 201", async () => {
    const res = await postConnector(makeApp(actorWithRole("founder")), goodHttp);
    expect(res.status).toBe(201);
    expect(mockConnectorSvc.create).toHaveBeenCalledTimes(1);
  });

  it("team_member DELETE -> 403", async () => {
    mockConnectorSvc.getById.mockResolvedValue({ id: CONNECTOR_ID, companyId: COMPANY });
    const res = await request(makeApp(actorWithRole("team_member"))).delete(
      `/api/companies/${COMPANY}/mcp-connectors/${CONNECTOR_ID}`,
    );
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.remove).not.toHaveBeenCalled();
  });

  it("list is allowed for any board member", async () => {
    mockGetEffectiveRole.mockResolvedValue("team_member");
    mockConnectorSvc.list.mockResolvedValue([{ id: CONNECTOR_ID }]);
    const res = await request(makeApp(founderActor)).get(`/api/companies/${COMPANY}/mcp-connectors`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("mcp-connectors routes — agent assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentMode = "authenticated";
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getById.mockResolvedValue({ id: CONNECTOR_ID, companyId: COMPANY });
    mockConnectorSvc.replaceAgents.mockResolvedValue(undefined);
  });

  it("replaces the enabled-agent set with company-owned agents -> 200", async () => {
    mockConnectorSvc.agentIdsInCompany.mockResolvedValue([AGENT_A, AGENT_B]);
    const res = await request(makeApp(founderActor))
      .put(`/api/companies/${COMPANY}/mcp-connectors/${CONNECTOR_ID}/agents`)
      .send({ agentIds: [AGENT_A, AGENT_B] });
    expect(res.status).toBe(200);
    expect(mockConnectorSvc.replaceAgents).toHaveBeenCalledWith(COMPANY, CONNECTOR_ID, [
      AGENT_A,
      AGENT_B,
    ]);
  });

  it("rejects an agent from another company -> 403, no write", async () => {
    // AGENT_B is foreign: agentIdsInCompany returns only AGENT_A.
    mockConnectorSvc.agentIdsInCompany.mockResolvedValue([AGENT_A]);
    const res = await request(makeApp(founderActor))
      .put(`/api/companies/${COMPANY}/mcp-connectors/${CONNECTOR_ID}/agents`)
      .send({ agentIds: [AGENT_A, AGENT_B] });
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.replaceAgents).not.toHaveBeenCalled();
  });

  it("team_member agent-assignment -> 403", async () => {
    mockGetEffectiveRole.mockResolvedValue("team_member");
    const res = await request(makeApp(founderActor))
      .put(`/api/companies/${COMPANY}/mcp-connectors/${CONNECTOR_ID}/agents`)
      .send({ agentIds: [AGENT_A] });
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.replaceAgents).not.toHaveBeenCalled();
  });
});

function patch(app: express.Express, body: unknown) {
  return request(app)
    .patch(`/api/companies/${COMPANY}/mcp-connectors/${CONNECTOR_ID}`)
    .send(body as object);
}

describe("mcp-connectors routes — patch narrowness + strict fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentMode = "authenticated";
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getById.mockResolvedValue({ id: CONNECTOR_ID, companyId: COMPANY });
    mockConnectorSvc.update.mockResolvedValue({ id: CONNECTOR_ID, status: "disabled" });
  });

  it("allows disabling via status -> 200", async () => {
    const res = await patch(makeApp(founderActor), { status: "disabled" });
    expect(res.status).toBe(200);
    expect(mockConnectorSvc.update).toHaveBeenCalledWith(CONNECTOR_ID, { status: "disabled" });
  });

  it("rejects editing transport-relevant fields -> 400 (strict)", async () => {
    const res = await patch(makeApp(founderActor), { url: "https://evil.example" });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.update).not.toHaveBeenCalled();
  });
});

describe("mcp-connectors routes — C2 PATCH cannot activate in authenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveRole.mockResolvedValue("founder");
    mockConnectorSvc.getById.mockResolvedValue({ id: CONNECTOR_ID, companyId: COMPANY });
    mockConnectorSvc.update.mockImplementation(async (_id: string, patchArg: any) => ({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      ...patchArg,
    }));
  });

  it("authenticated: pending->active via PATCH -> 400, no write", async () => {
    deploymentMode = "authenticated";
    const res = await patch(makeApp(founderActor), { status: "active" });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.update).not.toHaveBeenCalled();
  });

  it("authenticated: pending->pending_approval via PATCH -> 400, no write", async () => {
    deploymentMode = "authenticated";
    const res = await patch(makeApp(founderActor), { status: "pending_approval" });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.update).not.toHaveBeenCalled();
  });

  it("authenticated: two-hop pending->disabled->active is blocked at the second PATCH", async () => {
    deploymentMode = "authenticated";
    const first = await patch(makeApp(founderActor), { status: "disabled" });
    expect(first.status).toBe(200); // deactivation is always allowed
    const second = await patch(makeApp(founderActor), { status: "active" });
    expect(second.status).toBe(400); // re-activation via PATCH is refused
  });

  it("local_trusted: PATCH -> active is allowed (no governance gate) -> 200", async () => {
    deploymentMode = "local_trusted";
    const res = await patch(makeApp(founderActor), { status: "active" });
    expect(res.status).toBe(200);
    expect(mockConnectorSvc.update).toHaveBeenCalledWith(CONNECTOR_ID, { status: "active" });
  });
});

describe("mcp-connectors routes — M2 PATCH is founder-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentMode = "authenticated";
    mockConnectorSvc.getById.mockResolvedValue({ id: CONNECTOR_ID, companyId: COMPANY });
    mockConnectorSvc.update.mockResolvedValue({ id: CONNECTOR_ID, status: "disabled" });
  });

  it("team_lead PATCH -> 403, no write", async () => {
    mockGetEffectiveRole.mockResolvedValue("team_lead");
    const res = await patch(makeApp(founderActor), { status: "disabled" });
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.update).not.toHaveBeenCalled();
  });

  it("team_member PATCH -> 403, no write", async () => {
    mockGetEffectiveRole.mockResolvedValue("team_member");
    const res = await patch(makeApp(founderActor), { status: "disabled" });
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.update).not.toHaveBeenCalled();
  });
});
