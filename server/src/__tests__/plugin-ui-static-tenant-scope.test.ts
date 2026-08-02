import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import supertest from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const registry = vi.hoisted(() => ({
  getById: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => registry,
}));

import { errorHandler } from "../middleware/error-handler.js";
import { pluginUiStaticRoutes } from "../routes/plugin-ui-static.js";
import { setDeploymentMode } from "../config/deployment-mode.js";

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
let packageDir: string;

function actor(companyIds: string[]) {
  return {
    type: "board",
    source: "session",
    userId: "user-a",
    companyIds,
    organizationIds: [],
    isInstanceAdmin: false,
  };
}

function settingsDb(rows: Array<{ enabled: boolean }> = []) {
  return {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(rows) }),
    }),
  } as any;
}

function appFor(requestActor: object) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).actor = requestActor;
    next();
  });
  app.use(
    "/_plugins",
    pluginUiStaticRoutes(settingsDb(), { localPluginDir: packageDir })
  );
  app.use(errorHandler);
  return supertest(app);
}

function readyPlugin(companyId: string) {
  return {
    id: PLUGIN_ID,
    companyId,
    pluginKey: "acme.shared",
    packageName: "@acme/shared",
    packagePath: packageDir,
    status: "ready",
    manifestJson: { entrypoints: { ui: "./dist/ui" } },
  };
}

beforeAll(() => {
  packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "aoa-plugin-ui-"));
  fs.mkdirSync(path.join(packageDir, "dist", "ui"), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "dist", "ui", "index.js"),
    "export const ok = true;\n"
  );
});

afterAll(() => {
  fs.rmSync(packageDir, { recursive: true, force: true });
});

beforeEach(() => {
  setDeploymentMode("local_trusted");
  registry.getById.mockReset();
  registry.getConfig.mockReset();
  registry.getConfig.mockResolvedValue(null);
});

describe("tenant-scoped plugin UI assets", () => {
  it("returns the canonical 503 envelope in cloud before registry access", async () => {
    setDeploymentMode("cloud_auth");
    const response = await appFor(actor([COMPANY_A]))
      .get(`/_plugins/${PLUGIN_ID}/ui/index.js`)
      .expect(503);

    expect(response.body).toEqual({
      error:
        "Plugin execution is blocked on AoA Cloud until isolated workers are available",
      code: "PLUGIN_WORKER_BLOCKED_IN_CLOUD",
      docs: "/docs/guides/cloud-plugin-execution",
    });
    expect(registry.getById).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests before registry access", async () => {
    await appFor({ type: "none" })
      .get(`/_plugins/${PLUGIN_ID}/ui/index.js`)
      .expect(401);
    expect(registry.getById).not.toHaveBeenCalled();
  });

  it("rejects non-UUID plugin keys before registry access", async () => {
    await appFor(actor([COMPANY_A]))
      .get("/_plugins/acme.shared/ui/index.js")
      .expect(404);
    expect(registry.getById).not.toHaveBeenCalled();
  });

  it("rejects a foreign plugin before config or filesystem serving", async () => {
    registry.getById.mockResolvedValue(readyPlugin(COMPANY_B));
    await appFor(actor([COMPANY_A]))
      .get(`/_plugins/${PLUGIN_ID}/ui/index.js`)
      .expect(403);
    expect(registry.getConfig).not.toHaveBeenCalled();
  });

  it("serves an own-company asset privately without wildcard CORS", async () => {
    registry.getById.mockResolvedValue(readyPlugin(COMPANY_A));
    const response = await appFor(actor([COMPANY_A]))
      .get(`/_plugins/${PLUGIN_ID}/ui/index.js`)
      .expect(200);
    expect(response.text).toContain("export const ok");
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not serve assets for an explicitly disabled company plugin", async () => {
    registry.getById.mockResolvedValue(readyPlugin(COMPANY_A));
    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = actor([COMPANY_A]);
      next();
    });
    app.use(
      "/_plugins",
      pluginUiStaticRoutes(settingsDb([{ enabled: false }]), {
        localPluginDir: packageDir,
      })
    );
    app.use(errorHandler);
    await supertest(app).get(`/_plugins/${PLUGIN_ID}/ui/index.js`).expect(404);
    expect(registry.getConfig).not.toHaveBeenCalled();
  });

  it("does not fall back to a legacy shared package when the persisted path is missing", async () => {
    const legacyRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aoa-plugin-ui-legacy-")
    );
    try {
      const legacyUiDir = path.join(
        legacyRoot,
        "node_modules",
        "@acme",
        "shared",
        "dist",
        "ui"
      );
      fs.mkdirSync(legacyUiDir, { recursive: true });
      fs.writeFileSync(path.join(legacyUiDir, "index.js"), "legacy\n");
      registry.getById.mockResolvedValue({
        ...readyPlugin(COMPANY_A),
        packagePath: path.join(legacyRoot, "companies", COMPANY_A, "missing"),
      });

      const app = express();
      app.use((req, _res, next) => {
        (req as any).actor = actor([COMPANY_A]);
        next();
      });
      app.use(
        "/_plugins",
        pluginUiStaticRoutes(settingsDb(), { localPluginDir: legacyRoot })
      );
      app.use(errorHandler);

      await supertest(app)
        .get(`/_plugins/${PLUGIN_ID}/ui/index.js`)
        .expect(404);
    } finally {
      fs.rmSync(legacyRoot, { recursive: true, force: true });
    }
  });

  it("preserves local implicit access", async () => {
    registry.getById.mockResolvedValue(readyPlugin(COMPANY_B));
    await appFor({
      type: "board",
      source: "local_implicit",
      userId: "local",
      companyIds: [],
    })
      .get(`/_plugins/${PLUGIN_ID}/ui/index.js`)
      .expect(200);
  });
});
