// DSK-001 Lane C / I22 — DSK-00 negative closure.
//
// Desktop support must be provably INERT while it is disabled. These are NEGATIVE
// assertions: each one says a desktop surface does NOT exist or does NOT work.
//
// Two of I22's clauses failed when this ticket started (F27 here, F28 in
// execution-target-resolver.test.ts). They were live holes, not test gaps — writing a
// test around the behaviour as it stood would have enshrined it — so the fixes landed
// first and these assertions followed.

import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Org-admin authz passes: it is exercised elsewhere, and isolating it here keeps these
// tests about the DESKTOP gate rather than about permissions.
vi.mock("../services/organization-access.js", () => ({
  organizationAccessService: () => ({ canOrg: async () => true }),
}));
vi.mock("../services/execution-targets.js", () => ({
  createWorkerToken: () => "aoa_wtk_test",
  hashWorkerToken: () => "hash-of-token",
  stripWorkerSecret: (row: Record<string, unknown>) => {
    const { workerTokenHash: _omit, ...rest } = row;
    return rest;
  },
  // The list is whatever the fake db holds. D16 REJECTS filtering desktop rows out of
  // GET — that hides an already-enabled row instead of neutralising it, which is worse
  // for incident review. So this returns rows unfiltered ON PURPOSE, and the clause-1
  // assertion below is "creation is blocked, so no desktop row exists to list" — never
  // "the list filters".
  listExecutionTargets: async () => listRows,
  registerWorkerHeartbeat: async () => ({ updated: 1 }),
  rotateExecutionTargetWorkerToken: async () => null,
  revokeExecutionTargetWorkerToken: async () => null,
  resolveWorkerHeartbeatAuthority: async () => null,
}));
vi.mock("@armyofagents/db", () => ({ executionTargets: {} }));

import { executionTargetRoutes } from "../routes/execution-targets.js";
import { errorHandler } from "../middleware/error-handler.js";

const ORG = "77777777-7777-4777-8777-777777777777";
const boardAdmin = { type: "board", source: "session", userId: "operator-9", companyIds: [] };

let listRows: unknown[] = [];
const inserted: Record<string, unknown>[] = [];

/**
 * `workerSession` is the distributed-execution flag, already derived in app.ts as
 * `distributedExecutionEnabled && tenantAppDb && operatorDb && workerSessionSigningKey`.
 * Omitting it here IS the flag-off deployment.
 */
function makeApp({ desktopEnabled }: { desktopEnabled: boolean }) {
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push(v);
          return [{ id: "et-1", organizationId: ORG, ...v }];
        },
      }),
    }),
  } as never;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = boardAdmin;
    next();
  });
  app.use("/api", executionTargetRoutes({
    db,
    workerSession: desktopEnabled
      ? { appDb: db, operatorDb: db, sessionSigningKey: "x".repeat(32) }
      : undefined,
  }));
  app.use(errorHandler);
  return app;
}

const post = (app: express.Express, kind: string) =>
  request(app).post(`/api/organizations/${ORG}/execution-targets`)
    .send({ slug: `et-${kind.replace(/_/g, "-")}`, kind, trustClass: "local_trusted" });

afterEach(() => {
  vi.clearAllMocks();
  listRows = [];
  inserted.length = 0;
});

describe("I22 clause 1 — flag-off, a desktop execution target cannot be created", () => {
  // F27: executionTargetRoutes is mounted at app.ts:535, 97 lines OUTSIDE the
  // distributed-execution flag block, and the create handler inserted `...input`
  // directly. `kind` accepts "desktop" and `status` defaults to "active", so an org
  // admin could register an ACTIVE desktop target on a deployment where desktop does
  // not exist — and it would then route work to a control-plane run (F28).

  it("REFUSES the create and persists nothing", async () => {
    const res = await post(makeApp({ desktopEnabled: false }), "desktop");
    expect(res.status).toBe(403);
    // The teeth: no row reached the database.
    expect(inserted).toEqual([]);
  });

  it("says WHY, so an operator is not left guessing", async () => {
    const res = await post(makeApp({ desktopEnabled: false }), "desktop");
    // Status asserted too: without it this passes on a 201 whose body merely echoes
    // kind:"desktop" — a test that would have gone green against the hole itself.
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/desktop/i);
  });

  it("does NOT refuse other kinds — the gate is desktop-specific, not a blanket ban", async () => {
    // Non-vacuity. A guard that refused everything would pass the assertion above while
    // breaking every deployment.
    const res = await post(makeApp({ desktopEnabled: false }), "local_host");
    expect(res.status).toBe(201);
    expect(inserted).toHaveLength(1);
  });

  it("ALLOWS desktop once distributed execution is enabled", async () => {
    // The other half of non-vacuity: this is a flag, not a permanent prohibition. If
    // this ever fails, the gate has stopped being conditional and DSK-002 is blocked.
    const res = await post(makeApp({ desktopEnabled: true }), "desktop");
    expect(res.status).toBe(201);
  });

  it("GET returns no desktop row, because none can be created", async () => {
    const app = makeApp({ desktopEnabled: false });
    await post(app, "desktop");
    const res = await request(app).get(`/api/organizations/${ORG}/execution-targets`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/"kind":"desktop"/);
  });

  it("GET does NOT filter — an already-enabled row stays visible to incident review", async () => {
    // D16 rejects filtering explicitly. If a desktop row exists (created before the
    // gate, or while the flag was on), hiding it would be strictly worse: an operator
    // reviewing an incident must be able to SEE it. This pins the rejected alternative
    // so nobody "fixes" clause 1 by filtering.
    listRows = [{ id: "old", organizationId: ORG, slug: "legacy", kind: "desktop" }];
    const res = await request(makeApp({ desktopEnabled: false }))
      .get(`/api/organizations/${ORG}/execution-targets`);
    expect(JSON.stringify(res.body)).toMatch(/"kind":"desktop"/);
  });
});
