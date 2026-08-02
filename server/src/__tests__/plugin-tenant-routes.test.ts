import express from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({
  listInstalledForCompanies: vi.fn(),
  listByStatusForCompanies: vi.fn(),
  getById: vi.fn(),
  getByKey: vi.fn(),
  getByKeyScoped: vi.fn(),
  getConfig: vi.fn(),
}));
const lifecycle = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => registry,
}));

vi.mock("../services/plugin-lifecycle.js", () => ({
  pluginLifecycleManager: () => lifecycle,
}));

import { errorHandler } from "../middleware/index.js";
import { pluginRoutes } from "../routes/plugins.js";

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const PLUGIN_A = "11111111-1111-4111-8111-111111111111";
const PLUGIN_B = "22222222-2222-4222-8222-222222222222";

function plugin(id: string, companyId: string, pluginKey = "acme.shared") {
  return {
    id,
    companyId,
    pluginKey,
    packageName: `@acme/${companyId}`,
    packagePath: `/plugins/${companyId}`,
    version: "1.0.0",
    status: "ready",
    manifestJson: { id: pluginKey, displayName: pluginKey, slots: [] },
    lastError: null,
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
  };
}

function makeActor(companyIds: string[] = [COMPANY_A], operator = false) {
  return {
    type: "board",
    source: "session",
    userId: "user-a",
    isInstanceAdmin: false,
    operator,
    companyIds,
  };
}

function makeApp(
  actor: object = makeActor(),
  options: {
    bridgeDeps?: any;
    jobDeps?: any;
    toolDeps?: any;
    webhookDeps?: any;
    db?: any;
    loader?: any;
    sourceIp?: string;
  } = {}
) {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    })
  );
  app.use((req, _res, next) => {
    if (options.sourceIp) {
      Object.defineProperty(req, "ip", {
        value: options.sourceIp,
        configurable: true,
      });
    }
    (req as any).actor = actor;
    next();
  });
  app.use(
    "/api",
    pluginRoutes(
      options.db ?? ({} as any),
      options.loader ?? ({} as any),
      options.jobDeps,
      options.webhookDeps,
      options.toolDeps,
      options.bridgeDeps
    )
  );
  app.use(errorHandler);
  return supertest(app);
}

beforeEach(() => {
  for (const mock of Object.values(registry)) mock.mockReset();
  for (const mock of Object.values(lifecycle)) mock.mockReset();
  registry.listInstalledForCompanies.mockResolvedValue([]);
  registry.listByStatusForCompanies.mockResolvedValue([]);
  registry.getById.mockResolvedValue(null);
  registry.getByKey.mockResolvedValue(null);
  registry.getByKeyScoped.mockResolvedValue(null);
  registry.getConfig.mockResolvedValue(null);
});

describe("tenant-scoped plugin collections", () => {
  it("scopes the installed list to the board actor's companies", async () => {
    registry.listInstalledForCompanies.mockResolvedValue([
      plugin(PLUGIN_A, COMPANY_A),
    ]);

    const response = await makeApp(makeActor([COMPANY_A], true)).get(
      "/api/plugins"
    );

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(registry.listInstalledForCompanies).toHaveBeenCalledWith([
      COMPANY_A,
    ]);
  });

  it("scopes status-filtered lists and short-circuits an actor with no companies", async () => {
    await makeApp(makeActor([], true))
      .get("/api/plugins?status=ready")
      .expect(200, []);

    expect(registry.listByStatusForCompanies).toHaveBeenCalledWith("ready", []);
  });

  it("rejects a non-operator before listing global plugin records", async () => {
    await makeApp().get("/api/plugins").expect(403);
    expect(registry.listInstalledForCompanies).not.toHaveBeenCalled();
  });

  it("preserves all-access list semantics for local_implicit", async () => {
    await makeApp({
      type: "board",
      source: "local_implicit",
      userId: "local",
      isInstanceAdmin: false,
      companyIds: [],
    })
      .get("/api/plugins")
      .expect(200, []);

    expect(registry.listInstalledForCompanies).toHaveBeenCalledWith(undefined);
  });

  it("requires and enforces an explicit company for UI contributions", async () => {
    await makeApp().get("/api/plugins/ui-contributions").expect(400);
    await makeApp()
      .get(`/api/plugins/ui-contributions?companyId=${COMPANY_A}`)
      .expect(200, []);

    expect(registry.listByStatusForCompanies).toHaveBeenCalledWith("ready", [
      COMPANY_A,
    ]);
  });

  it("does not publish UI contributions disabled for the company", async () => {
    registry.listByStatusForCompanies.mockResolvedValue([
      plugin(PLUGIN_A, COMPANY_A),
    ]);
    const chain: Record<string, any> = {
      from() {
        return chain;
      },
      where: vi.fn(async () => [{ pluginId: PLUGIN_A }]),
    };
    const db = { select: vi.fn(() => chain) };

    await makeApp(makeActor(), { db })
      .get(`/api/plugins/ui-contributions?companyId=${COMPANY_A}`)
      .expect(200, []);
  });
});

describe("tenant-scoped plugin install target", () => {
  it("requires companyId for a multi-company actor", async () => {
    const installPlugin = vi.fn();
    await makeApp(makeActor([COMPANY_A, COMPANY_B], true), {
      loader: { installPlugin },
    })
      .post("/api/plugins/install")
      .send({ packageName: "@acme/shared" })
      .expect(400);
    expect(installPlugin).not.toHaveBeenCalled();
  });

  it("passes an explicitly selected accessible company to the loader", async () => {
    const installPlugin = vi.fn(async () => ({
      manifest: { id: "acme.shared", displayName: "Shared", version: "1.0.0" },
    }));
    await makeApp(makeActor([COMPANY_A, COMPANY_B], true), {
      loader: { installPlugin },
    })
      .post("/api/plugins/install")
      .send({ packageName: "@acme/shared", companyId: COMPANY_B })
      .expect(500);
    expect(installPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: "@acme/shared",
        companyId: COMPANY_B,
      })
    );
  });
});

describe("tenant-scoped bare plugin reads", () => {
  it("rejects a non-operator before resolving the global config route", async () => {
    registry.getById.mockResolvedValue(plugin(PLUGIN_B, COMPANY_B));

    await makeApp().get(`/api/plugins/${PLUGIN_B}/config`).expect(403);

    expect(registry.getById).not.toHaveBeenCalled();
    expect(registry.getConfig).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign plugin config even when the operator lacks company access", async () => {
    registry.getById.mockResolvedValue(plugin(PLUGIN_B, COMPANY_B));

    await makeApp(makeActor([COMPANY_A], true))
      .get(`/api/plugins/${PLUGIN_B}/config`)
      .expect(404);

    expect(registry.getConfig).not.toHaveBeenCalled();
  });

  it("returns an own-company config", async () => {
    registry.getById.mockResolvedValue(plugin(PLUGIN_A, COMPANY_A));
    registry.getConfig.mockResolvedValue({
      pluginId: PLUGIN_A,
      configJson: { secretRef: "own" },
    });

    const response = await makeApp(makeActor([COMPANY_A], true))
      .get(`/api/plugins/${PLUGIN_A}/config`)
      .expect(200);

    expect(response.body.configJson).toEqual({ secretRef: "own" });
    expect(registry.getConfig).toHaveBeenCalledWith(PLUGIN_A);
  });

  it("rejects a plugin key that is ambiguous across accessible companies", async () => {
    registry.getById.mockResolvedValue(null);
    registry.getByKeyScoped.mockImplementation(
      async (_key: string, companyId: string) =>
        companyId === COMPANY_A
          ? plugin(PLUGIN_A, COMPANY_A)
          : plugin(PLUGIN_B, COMPANY_B)
    );

    await makeApp(makeActor([COMPANY_A, COMPANY_B], true))
      .get("/api/plugins/acme.shared/config")
      .expect(409);

    expect(registry.getConfig).not.toHaveBeenCalled();
    expect(registry.getByKey).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous plugin key for local all-access actors", async () => {
    registry.getById.mockRejectedValue({ code: "22P02" });
    registry.listInstalledForCompanies.mockResolvedValue([
      plugin(PLUGIN_A, COMPANY_A),
      plugin(PLUGIN_B, COMPANY_B),
    ]);
    await makeApp({
      type: "board",
      source: "local_implicit",
      userId: "local",
      isInstanceAdmin: false,
      companyIds: [],
    })
      .get("/api/plugins/acme.shared/config")
      .expect(409);
    expect(registry.getConfig).not.toHaveBeenCalled();
  });

  const siblingReads = [
    `/api/plugins/${PLUGIN_B}`,
    `/api/plugins/${PLUGIN_B}/health`,
    `/api/plugins/${PLUGIN_B}/logs`,
    `/api/plugins/${PLUGIN_B}/config`,
    `/api/plugins/${PLUGIN_B}/jobs`,
    `/api/plugins/${PLUGIN_B}/jobs/job-1/runs`,
    `/api/plugins/${PLUGIN_B}/dashboard`,
    `/api/plugins/${PLUGIN_B}/version-history`,
  ];

  for (const path of siblingReads) {
    it(`does not expose a foreign plugin through ${path}`, async () => {
      registry.getById.mockResolvedValue(plugin(PLUGIN_B, COMPANY_B));
      const jobStore = {
        listJobs: vi.fn(),
        getJobByIdForPlugin: vi.fn(),
        listRunsByJob: vi.fn(),
      };

      await makeApp(makeActor([COMPANY_A], true), {
        jobDeps: { jobStore, scheduler: {} },
      })
        .get(path)
        .expect(404);

      expect(jobStore.listJobs).not.toHaveBeenCalled();
      expect(jobStore.getJobByIdForPlugin).not.toHaveBeenCalled();
      expect(registry.getConfig).not.toHaveBeenCalled();
    });
  }
});

describe("global plugin lifecycle overlay synchronization", () => {
  function overlayDb() {
    const values = vi.fn(async () => undefined);
    return {
      db: {
        select: () => ({
          from: () => ({ where: () => Promise.resolve([]) }),
        }),
        insert: () => ({ values }),
      } as any,
      values,
    };
  }

  it("persists enabled=true before a bare global enable", async () => {
    registry.getById.mockResolvedValue({
      ...plugin(PLUGIN_A, COMPANY_A),
      status: "disabled",
    });
    lifecycle.enable.mockResolvedValue({
      ...plugin(PLUGIN_A, COMPANY_A),
      status: "ready",
    });
    const { db, values } = overlayDb();

    await makeApp(makeActor([COMPANY_A], true), { db }).post(
      `/api/plugins/${PLUGIN_A}/enable`
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: PLUGIN_A,
        companyId: COMPANY_A,
        enabled: true,
      })
    );
    expect(lifecycle.enable).toHaveBeenCalledWith(PLUGIN_A);
  });

  it("persists enabled=false before a bare global disable", async () => {
    registry.getById.mockResolvedValue(plugin(PLUGIN_A, COMPANY_A));
    lifecycle.disable.mockResolvedValue({
      ...plugin(PLUGIN_A, COMPANY_A),
      status: "disabled",
    });
    const { db, values } = overlayDb();

    await makeApp(makeActor([COMPANY_A], true), { db })
      .post(`/api/plugins/${PLUGIN_A}/disable`)
      .send({ reason: "maintenance" });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: PLUGIN_A,
        companyId: COMPANY_A,
        enabled: false,
      })
    );
    expect(lifecycle.disable).toHaveBeenCalledWith(PLUGIN_A, "maintenance");
  });
});

describe("tenant-scoped plugin runtime calls", () => {
  const bridgePaths = [
    {
      path: `/api/plugins/${PLUGIN_B}/bridge/data`,
      body: { key: "read", companyId: COMPANY_A },
    },
    {
      path: `/api/plugins/${PLUGIN_B}/bridge/action`,
      body: { key: "write", companyId: COMPANY_A },
    },
    {
      path: `/api/plugins/${PLUGIN_B}/data/read`,
      body: { companyId: COMPANY_A },
    },
    {
      path: `/api/plugins/${PLUGIN_B}/actions/write`,
      body: { companyId: COMPANY_A },
    },
  ];

  for (const testCase of bridgePaths) {
    it(`rejects a foreign worker before dispatch for ${testCase.path}`, async () => {
      registry.getById.mockResolvedValue(plugin(PLUGIN_B, COMPANY_B));
      const call = vi.fn();
      const bridgeDeps = { workerManager: { call, getWorker: vi.fn() } };

      await makeApp(makeActor(), { bridgeDeps })
        .post(testCase.path)
        .send(testCase.body)
        .expect(404);

      expect(call).not.toHaveBeenCalled();
    });
  }

  it("rejects a foreign SSE plugin before subscribing", async () => {
    registry.getById.mockResolvedValue(plugin(PLUGIN_B, COMPANY_B));
    const subscribe = vi.fn();
    const bridgeDeps = {
      workerManager: { call: vi.fn(), getWorker: vi.fn() },
      streamBus: { subscribe },
    };

    await makeApp(makeActor(), { bridgeDeps })
      .get(
        `/api/plugins/${PLUGIN_B}/bridge/stream/events?companyId=${COMPANY_A}`
      )
      .expect(404);

    expect(subscribe).not.toHaveBeenCalled();
  });

  it("requires company scope when listing operator-visible plugin tools", async () => {
    const listToolsForAgent = vi.fn();
    const toolDispatcher = { listToolsForAgent };
    await makeApp(makeActor([COMPANY_A], true), {
      toolDeps: { toolDispatcher },
    })
      .get("/api/plugins/tools")
      .expect(400);
    expect(listToolsForAgent).not.toHaveBeenCalled();
  });

  it("lists only tools for an accessible requested company", async () => {
    const listToolsForAgent = vi.fn(() => []);
    const toolDispatcher = { listToolsForAgent };
    await makeApp(makeActor([COMPANY_A], true), {
      toolDeps: { toolDispatcher },
    })
      .get(`/api/plugins/tools?companyId=${COMPANY_A}&pluginId=acme.shared`)
      .expect(200, []);
    expect(listToolsForAgent).toHaveBeenCalledWith({
      companyId: COMPANY_A,
      pluginId: "acme.shared",
    });
  });

  it("rejects a tool whose registered plugin belongs to another company", async () => {
    registry.getById.mockResolvedValue(plugin(PLUGIN_B, COMPANY_B));
    const executeTool = vi.fn();
    const toolDispatcher = {
      getTool: vi.fn(() => ({ pluginDbId: PLUGIN_B })),
      executeTool,
      listToolsForAgent: vi.fn(),
    };

    await makeApp(makeActor(), { toolDeps: { toolDispatcher } })
      .post("/api/plugins/tools/execute")
      .send({
        tool: "acme.shared:run",
        parameters: {},
        runContext: {
          agentId: "agent-a",
          runId: "run-a",
          companyId: COMPANY_A,
          projectId: "project-a",
        },
      })
      .expect(404);

    expect(executeTool).not.toHaveBeenCalled();
  });

  it("rejects a bare legacy webhook key before registry or worker access", async () => {
    const call = vi.fn();
    await makeApp(makeActor(), {
      webhookDeps: { workerManager: { call } },
    })
      .post("/api/plugins/acme.shared/webhooks/push")
      .send({})
      .expect(404);
    expect(registry.listInstalledForCompanies).not.toHaveBeenCalled();
    expect(registry.getById).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps rejecting a bare key regardless of how many tenants use it", async () => {
    registry.listInstalledForCompanies.mockResolvedValue([
      plugin(PLUGIN_A, COMPANY_A),
      plugin(PLUGIN_B, COMPANY_B),
    ]);
    const call = vi.fn();
    await makeApp(makeActor(), { webhookDeps: { workerManager: { call } } })
      .post("/api/plugins/acme.shared/webhooks/push")
      .send({})
      .expect(404);
    expect(registry.listInstalledForCompanies).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("dispatches a declared webhook when addressed by installation UUID", async () => {
    registry.getById.mockResolvedValue({
      ...plugin(PLUGIN_A, COMPANY_A),
      manifestJson: {
        id: "acme.shared",
        displayName: "Shared",
        capabilities: ["webhooks.receive"],
        webhooks: [{ endpointKey: "push", displayName: "Push" }],
      },
    });
    const call = vi.fn(async () => undefined);
    const where = vi.fn(async () => undefined);
    const values = vi.fn(() => ({
      returning: vi.fn(async () => [{ id: "delivery-1" }]),
    }));
    const db = {
      select: vi.fn(() => ({
        from: () => ({ where: vi.fn(async () => []) }),
      })),
      insert: vi.fn(() => ({
        values,
      })),
      update: vi.fn(() => ({
        set: () => ({ where }),
      })),
    };

    await makeApp(makeActor(), {
      db,
      webhookDeps: { workerManager: { call } },
      sourceIp: "198.51.100.240",
    })
      .post(`/api/plugins/${PLUGIN_A}/webhooks/push`)
      .set("X-Hook-Secret", "secret-a")
      .send({ hello: "world" })
      .expect(200, { deliveryId: "delivery-1", status: "success" });

    expect(registry.getById).toHaveBeenCalledWith(PLUGIN_A);
    expect(call).toHaveBeenCalledWith(
      PLUGIN_A,
      "handleWebhook",
      expect.objectContaining({
        endpointKey: "push",
        rawBody: '{"hello":"world"}',
        parsedBody: { hello: "world" },
        headers: expect.objectContaining({ "x-hook-secret": "secret-a" }),
      })
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: PLUGIN_A,
        webhookKey: "push",
        payload: { hello: "world" },
        headers: expect.objectContaining({ "x-hook-secret": "secret-a" }),
      })
    );
    expect(where).toHaveBeenCalledOnce();
  });

  it("rate-limits public webhooks before UUID lookup, DB writes, or worker RPC", async () => {
    const call = vi.fn();
    const db = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const appA = makeApp(makeActor(), {
      db,
      webhookDeps: { workerManager: { call } },
      sourceIp: "198.51.100.241",
    });

    for (let index = 0; index < 300; index += 1) {
      await appA
        .post("/api/plugins/not-a-uuid/webhooks/push")
        .send({ index })
        .expect(404);
    }

    const limited = await appA
      .post("/api/plugins/not-a-uuid/webhooks/push")
      .send({ index: 300 })
      .expect(429);
    expect(limited.body).toMatchObject({ error: "rate_limited" });
    expect(limited.body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(limited.headers).toHaveProperty("ratelimit-policy");
    expect(limited.headers).toHaveProperty("ratelimit");
    expect(limited.headers).not.toHaveProperty("x-ratelimit-limit");
    expect(registry.getById).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();

    // The limiter is keyed by source IP, so another caller has a fresh bucket.
    await makeApp(makeActor(), {
      db,
      webhookDeps: { workerManager: { call } },
      sourceIp: "198.51.100.242",
    })
      .post("/api/plugins/not-a-uuid/webhooks/push")
      .send({})
      .expect(404);
  });
});
