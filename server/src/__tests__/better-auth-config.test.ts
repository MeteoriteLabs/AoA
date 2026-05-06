import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import type { Db } from "@armyofagents/db";

// Avoid the drizzle-orm ESM cycle that better-auth's drizzle adapter pulls in
// transitively. We don't need a real drizzle adapter here — the gate runs
// before betterAuth() is invoked, and when it does run we just need a stub.
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn((cfg: unknown) => ({ __cfg: cfg })),
}));

vi.mock("better-auth/node", () => ({
  toNodeHandler: vi.fn(() => () => undefined),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) => new Proxy(
    {} as Record<string, unknown>,
    {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    },
  );
  return {
    authUsers: makeTable("auth_users"),
    authSessions: makeTable("auth_sessions"),
    authAccounts: makeTable("auth_accounts"),
    authVerifications: makeTable("auth_verifications"),
  };
});

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: mockLogger,
  httpLogger: vi.fn(),
}));

const { createBetterAuthInstance } = await import("../auth/better-auth.js");

const SECRET_ENV = "BETTER_AUTH_SECRET";
const FALLBACK_ENV = "AOA_AGENT_JWT_SECRET";

const originalEnv = {
  secret: process.env[SECRET_ENV],
  fallback: process.env[FALLBACK_ENV],
};

function restoreEnv() {
  if (originalEnv.secret === undefined) delete process.env[SECRET_ENV];
  else process.env[SECRET_ENV] = originalEnv.secret;
  if (originalEnv.fallback === undefined) delete process.env[FALLBACK_ENV];
  else process.env[FALLBACK_ENV] = originalEnv.fallback;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  // Minimal stub — only the fields createBetterAuthInstance touches matter.
  return {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    host: "127.0.0.1",
    port: 3100,
    allowedHostnames: [],
    authBaseUrlMode: "auto",
    authPublicBaseUrl: undefined,
    databaseMode: "embedded-postgres",
    databaseUrl: undefined,
    embeddedPostgresDataDir: "/tmp/aoa",
    embeddedPostgresPort: 54329,
    databaseBackupEnabled: false,
    databaseBackupIntervalMinutes: 60,
    databaseBackupRetentionDays: 30,
    databaseBackupDir: "/tmp/aoa/backup",
    serveUi: false,
    uiDevMiddleware: false,
    secretsProvider: "local_encrypted",
    secretsStrictMode: false,
    secretsMasterKeyFilePath: "/tmp/aoa/master.key",
    storageProvider: "local_disk",
    storageLocalDiskBaseDir: "/tmp/aoa/storage",
    storageS3Bucket: "",
    storageS3Region: "",
    storageS3Endpoint: undefined,
    storageS3Prefix: "",
    storageS3ForcePathStyle: false,
    heartbeatSchedulerEnabled: false,
    heartbeatSchedulerIntervalMs: 30000,
    companyDeletionEnabled: false,
    ...overrides,
  };
}

const fakeDb = {} as unknown as Db;

describe("createBetterAuthInstance — fail-closed secret gate", () => {
  beforeEach(() => {
    delete process.env[SECRET_ENV];
    delete process.env[FALLBACK_ENV];
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("local_trusted mode without env returns instance and logs WARN", () => {
    const config = makeConfig({ deploymentMode: "local_trusted" });

    const instance = createBetterAuthInstance(fakeDb, config, []);

    expect(instance).toBeDefined();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const [warnArg] = mockLogger.warn.mock.calls[0]!;
    const warnText =
      typeof warnArg === "string"
        ? warnArg
        : JSON.stringify(warnArg);
    expect(warnText).toMatch(/BETTER_AUTH_SECRET/);
    expect(warnText.toLowerCase()).toMatch(/dev|fallback/);
  });

  it("authenticated mode without env throws with clear message", () => {
    const config = makeConfig({ deploymentMode: "authenticated" });

    expect(() => createBetterAuthInstance(fakeDb, config, [])).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("non-local-trusted modes (cloud_auth) without env throw", () => {
    // cloud_auth isn't in the canonical DeploymentMode union today, but the
    // gate must default-deny — any future mode that isn't local_trusted
    // must fail closed.
    const config = makeConfig({
      // Intentional cast: we're verifying default-deny behaviour.
      deploymentMode: "cloud_auth" as unknown as Config["deploymentMode"],
    });

    expect(() => createBetterAuthInstance(fakeDb, config, [])).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("local_trusted with BETTER_AUTH_SECRET set returns instance and does NOT warn", () => {
    process.env[SECRET_ENV] = "real-secret-32-chars-of-entropy-here";
    const config = makeConfig({ deploymentMode: "local_trusted" });

    const instance = createBetterAuthInstance(fakeDb, config, []);

    expect(instance).toBeDefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("authenticated with BETTER_AUTH_SECRET set returns instance and does NOT warn", () => {
    process.env[SECRET_ENV] = "real-secret-32-chars-of-entropy-here";
    const config = makeConfig({ deploymentMode: "authenticated" });

    const instance = createBetterAuthInstance(fakeDb, config, []);

    expect(instance).toBeDefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("authenticated with AOA_AGENT_JWT_SECRET fallback set returns instance", () => {
    process.env[FALLBACK_ENV] = "fallback-secret-32-chars-of-entropy";
    const config = makeConfig({ deploymentMode: "authenticated" });

    const instance = createBetterAuthInstance(fakeDb, config, []);

    expect(instance).toBeDefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only BETTER_AUTH_SECRET in authenticated mode", () => {
    process.env[SECRET_ENV] = "   ";
    const config = makeConfig({ deploymentMode: "authenticated" });

    expect(() => createBetterAuthInstance(fakeDb, config, [])).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
});
