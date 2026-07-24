import { beforeEach, describe, expect, it, vi } from "vitest";

// This suite deliberately imports the create service DIRECTLY — no express, no
// drizzle, no DB. Every dependency is injected, which is the whole point of the
// extraction: the governance (409 / secretRef existence / status derivation /
// approval / activity log) is now testable without standing up a route.
import { createConnector } from "../services/mcp-connector-create.js";

const COMPANY = "company-A";
const CONNECTOR_ID = "11111111-1111-4111-8111-111111111111";
const FOUNDER_UUID = "44444444-4444-4444-8444-444444444444";

const founderActor = {
  actorType: "user" as const,
  actorId: FOUNDER_UUID,
  agentId: null,
};

const svc = {
  getByName: vi.fn(),
  create: vi.fn(),
};
const secretsSvc = { getByName: vi.fn() };
const approvalsSvc = { create: vi.fn() };
const logActivity = vi.fn();

const deps = { svc, secretsSvc, approvalsSvc, logActivity };

const httpInput = {
  companyId: COMPANY,
  serverName: "notion",
  displayName: "Notion",
  transport: "http",
  url: "https://mcp.notion.example/v1",
  requiresSecret: false,
  source: "byo" as const,
  deploymentMode: "authenticated",
  actor: founderActor,
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.getByName.mockResolvedValue(null);
  svc.create.mockImplementation(async (_c: string, input: any) => ({
    id: CONNECTOR_ID,
    companyId: COMPANY,
    ...input,
  }));
  approvalsSvc.create.mockResolvedValue({ id: "approval-1" });
  logActivity.mockResolvedValue(undefined);
});

describe("createConnector — uniqueness", () => {
  it("409s on a duplicate (companyId, serverName) and never writes", async () => {
    svc.getByName.mockResolvedValue({ id: "existing", serverName: "notion" });
    await expect(createConnector(deps as any, httpInput)).rejects.toMatchObject({
      status: 409,
    });
    expect(svc.create).not.toHaveBeenCalled();
    expect(approvalsSvc.create).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("createConnector — secretRef existence", () => {
  it("400s when secretRef names a secret that does not exist, and never writes", async () => {
    secretsSvc.getByName.mockResolvedValue(null);
    await expect(
      createConnector(deps as any, { ...httpInput, secretRef: "mcp:notion" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(svc.create).not.toHaveBeenCalled();
    expect(approvalsSvc.create).not.toHaveBeenCalled();
  });

  it("proceeds when the secretRef resolves", async () => {
    secretsSvc.getByName.mockResolvedValue({ id: "secret-1", name: "mcp:notion" });
    const out = await createConnector(deps as any, { ...httpInput, secretRef: "mcp:notion" });
    expect(secretsSvc.getByName).toHaveBeenCalledWith(COMPANY, "mcp:notion");
    expect(out.connector.id).toBe(CONNECTOR_ID);
  });

  it("does not look up a secret when no secretRef is supplied", async () => {
    await createConnector(deps as any, httpInput);
    expect(secretsSvc.getByName).not.toHaveBeenCalled();
  });
});

describe("createConnector — deployment mode, status, approval", () => {
  it("authenticated: pending_approval + an approval is raised and its id returned", async () => {
    const out = await createConnector(deps as any, httpInput);
    expect(svc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ status: "pending_approval" }),
    );
    expect(approvalsSvc.create).toHaveBeenCalledTimes(1);
    expect(approvalsSvc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({
        type: "install_mcp_connector",
        status: "pending",
        requestedByUserId: FOUNDER_UUID,
        payload: expect.objectContaining({ connectorId: CONNECTOR_ID, serverName: "notion" }),
      }),
    );
    expect(out.approvalId).toBe("approval-1");
  });

  it("local_trusted: active, no approval", async () => {
    const out = await createConnector(deps as any, {
      ...httpInput,
      deploymentMode: "local_trusted",
    });
    expect(svc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ status: "active" }),
    );
    expect(approvalsSvc.create).not.toHaveBeenCalled();
    expect(out.approvalId).toBeNull();
  });

  it("catalog + requiresSecret with no secret in local_trusted -> needs_credentials, NO approval", async () => {
    const out = await createConnector(deps as any, {
      ...httpInput,
      source: "catalog" as const,
      requiresSecret: true,
      deploymentMode: "local_trusted",
    });
    expect(svc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ status: "needs_credentials", requiresSecret: true }),
    );
    expect(approvalsSvc.create).not.toHaveBeenCalled();
    expect(out.approvalId).toBeNull();
  });

  it("never marks a requiresSecret connector active without a bound secret, in any mode", async () => {
    for (const deploymentMode of ["local_trusted", "authenticated", "cloud_auth"]) {
      vi.clearAllMocks();
      svc.getByName.mockResolvedValue(null);
      svc.create.mockImplementation(async (_c: string, input: any) => ({ id: CONNECTOR_ID, ...input }));
      approvalsSvc.create.mockResolvedValue({ id: "approval-1" });
      await createConnector(deps as any, { ...httpInput, requiresSecret: true, deploymentMode });
      expect(svc.create).not.toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ status: "active" }),
      );
    }
  });
});

describe("createConnector — caller-forced provenance", () => {
  it("persists the source the caller forced (byo)", async () => {
    await createConnector(deps as any, httpInput);
    expect(svc.create).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ source: "byo" }));
  });

  it("persists the source the caller forced (catalog)", async () => {
    await createConnector(deps as any, { ...httpInput, source: "catalog" as const });
    expect(svc.create).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ source: "catalog" }));
  });

  it("records createdByUserId only when the actor id is a UUID", async () => {
    await createConnector(deps as any, httpInput);
    expect(svc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ createdByUserId: FOUNDER_UUID }),
    );

    vi.clearAllMocks();
    svc.getByName.mockResolvedValue(null);
    svc.create.mockResolvedValue({ id: CONNECTOR_ID, serverName: "notion" });
    approvalsSvc.create.mockResolvedValue({ id: "approval-1" });
    await createConnector(deps as any, {
      ...httpInput,
      actor: { actorType: "user" as const, actorId: "board", agentId: null },
    });
    expect(svc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ createdByUserId: null }),
    );
  });

  it("an agent actor is not recorded as the approval requester", async () => {
    await createConnector(deps as any, {
      ...httpInput,
      actor: { actorType: "agent" as const, actorId: "agent-7", agentId: "agent-7" },
    });
    expect(approvalsSvc.create).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ requestedByUserId: null }),
    );
  });
});

describe("createConnector — activity log", () => {
  it("logs mcp_connector.created with the resolved status", async () => {
    await createConnector(deps as any, httpInput);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        action: "mcp_connector.created",
        entityType: "mcp_connector",
        entityId: CONNECTOR_ID,
        details: expect.objectContaining({
          serverName: "notion",
          transport: "http",
          status: "pending_approval",
        }),
      }),
    );
  });
});

describe("createConnector — the D7 transport gate is NOT here", () => {
  // Load-bearing: D7 needs the trust tier, which only the CALLER knows, and it
  // must run before any write. Callers assert it themselves. If someone ever
  // moves the gate in here, this test fails and they must reconsider.
  it("does not itself reject a stdio connector in authenticated mode", async () => {
    const out = await createConnector(deps as any, {
      ...httpInput,
      transport: "stdio",
      url: undefined,
      command: "npx",
      args: ["-y", "fs-mcp"],
    });
    expect(out.connector.id).toBe(CONNECTOR_ID);
    expect(svc.create).toHaveBeenCalledTimes(1);
  });
});
