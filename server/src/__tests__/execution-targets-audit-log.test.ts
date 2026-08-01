// Round-3 finding ②: registering a security-sensitive execution target must
// leave an audit trail. activity_log is company-scoped (company_id NOT NULL), so
// this org-scoped mutation is recorded via a structured pino log line instead
// (the same class as the operator break-glass org-wide audit fix). This test
// mounts the real route with a fake db and asserts the audit line is emitted on
// a successful registration, without changing the 201 response shape.
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Spy on the pino logger the route emits the audit line through. `vi.hoisted`
// so the spy exists before the hoisted vi.mock factory references it.
const { infoSpy } = vi.hoisted(() => ({ infoSpy: vi.fn() }));
vi.mock("../middleware/logger.js", () => ({
  logger: { info: infoSpy, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Authz passes: the org-admin check is exercised elsewhere; here we isolate the
// audit behaviour.
vi.mock("../services/organization-access.js", () => ({
  organizationAccessService: () => ({ canOrg: async () => true }),
}));
// Deterministic token/serialization helpers so the route runs end to end.
vi.mock("../services/execution-targets.js", () => ({
  createWorkerToken: () => "aoa_wtk_test",
  hashWorkerToken: () => "hash-of-token",
  stripWorkerSecret: (row: Record<string, unknown>) => {
    const { workerTokenHash: _omit, ...rest } = row;
    return rest;
  },
  listExecutionTargets: async () => [],
  registerWorkerHeartbeat: async () => ({ updated: 1 }),
  resolveWorkerTargetId: async () => null,
}));
vi.mock("@armyofagents/db", () => ({ executionTargets: {} }));
vi.mock("@armyofagents/shared", () => ({
  createExecutionTargetSchema: { safeParse: (body: unknown) => ({ success: true, data: body }) },
}));

import { executionTargetRoutes } from "../routes/execution-targets.js";
import { errorHandler } from "../middleware/error-handler.js";

const ORG = "org-777";
const INSERTED = {
  id: "et-abc-123",
  organizationId: ORG,
  slug: "et-1",
  kind: "local",
  trustClass: "trusted",
  workerTokenHash: "hash-of-token",
};

function makeApp(actor: unknown) {
  // Fake db: insert(...).values(...).returning() → the persisted row.
  const db = {
    insert: () => ({ values: () => ({ returning: async () => [INSERTED] }) }),
  } as never;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", executionTargetRoutes({ db }));
  app.use(errorHandler);
  return app;
}

const boardAdmin = { type: "board", source: "session", userId: "operator-9", companyIds: [] };

afterEach(() => vi.clearAllMocks());

describe("execution-target registration — audit trail (finding ②)", () => {
  it("emits a structured audit log line on successful registration", async () => {
    const res = await request(makeApp(boardAdmin))
      .post(`/api/organizations/${ORG}/execution-targets`)
      .send({ slug: "et-1", kind: "local", trustClass: "trusted" });

    // Response shape is unchanged: 201 + row (minus secret) + one-time token.
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(INSERTED.id);
    expect(res.body.workerToken).toBe("aoa_wtk_test");
    expect(res.body.workerTokenHash).toBeUndefined();

    // The audit line was emitted with the security-relevant fields.
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "execution_target.register",
        organizationId: ORG,
        executionTargetId: INSERTED.id,
        operatorUserId: "operator-9",
        scope: "org_scoped",
      }),
      "execution target registered",
    );
  });
});
