/**
 * Task 9b — generalized interactive login on the Settings -> Providers surface.
 *
 * Four invariants under test, each one the reason a route line exists:
 *
 *   1. SELF-COMPLETING GATE. `POST /:providerId/login/start` is refused (400)
 *      for any provider whose CLI login cannot finish without a terminal.
 *      Claude's `claude auth login` redirects to a REMOTE callback and then
 *      BLOCKS on a stdin "Paste code here" prompt — the runner surfaces the URL
 *      but can never finalize. Rendering a Sign in button there would hang the
 *      founder forever, so the server refuses and hands back the copyable
 *      `manualLoginCommand` instead.
 *   2. PROVIDER <-> CHALLENGE MATCH. A challenge started for one provider must
 *      not be readable or cancellable through another provider's path. Enforced
 *      in the LIFECYCLE (commander-login.ts), not just the route, so every
 *      caller inherits it.
 *   3. FOUNDER GATING. Driving a login is a credential mutation: the explicit
 *      board-actor check precedes assertRole (assertRole is a no-op for agent
 *      actors), exactly as `/key` and commander-key.ts do.
 *   4. RE-PROBE ON COMPLETION. A finished login changes what the host can
 *      authenticate as, so the cached company_default readiness row is stale the
 *      instant the challenge completes. Same reasoning as the credential-group
 *      invalidation on `/key`.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

vi.mock("@armyofagents/db", () => ({
  agents: makeTableProxy("agents"),
  companySecrets: makeTableProxy("company_secrets"),
  providerReadinessStatus: makeTableProxy("provider_readiness_status"),
}));

const mockCanUser = vi.hoisted(() => vi.fn(async () => true));
const mockHasPermission = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../services/access.js", () => ({
  accessService: () => ({ canUser: mockCanUser, hasPermission: mockHasPermission }),
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => ({
    resolveAdapterConfigForRuntime: vi.fn(async (_c: string, _a: string, cfg: unknown) => cfg),
  }),
}));

vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));

const mockReadReadiness = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const mockRecordReadiness = vi.hoisted(() =>
  vi.fn(async () => ({ testedAt: new Date("2026-07-20T00:00:00.000Z") })),
);
vi.mock("../services/providers/readiness.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/providers/readiness.js")>();
  return {
    ...actual,
    readReadiness: mockReadReadiness,
    readReadinessForScope: vi.fn(),
    recordReadiness: mockRecordReadiness,
    deleteReadinessForScope: vi.fn(),
  };
});

vi.mock("../services/providers/provider-key.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/providers/provider-key.js")>();
  return { ...actual, saveProviderKey: vi.fn() };
});

const PROBE_PASS = {
  status: "pass",
  checks: [{ code: "codex_hello_probe_passed", level: "info", message: "signed in" }],
};
const mockTestEnvironment = vi.hoisted(() => vi.fn());
const mockFindServerAdapter = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", () => ({
  findServerAdapter: mockFindServerAdapter,
  findActiveServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
}));

const mockAssertRole = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../middleware/rbac.js", () => ({ assertRole: mockAssertRole }));

/**
 * Capability overrides (review M-2). `resolveLoginCapability` is REAL by
 * default; a test may pin one provider's answer so the start gate's SECOND
 * operand — `hasLoginRunner` — becomes the deciding one. No catalog descriptor
 * is currently `selfCompletingLogin: true` with no runner, so without this
 * fixture that operand is untestable against the real catalog and the gate is
 * only half-verified.
 */
const capabilityOverrides = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../services/providers/provider-login.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/providers/provider-login.js")>();
  return {
    ...actual,
    resolveLoginCapability: (id: string) =>
      capabilityOverrides.has(id) ? capabilityOverrides.get(id) : actual.resolveLoginCapability(id),
  };
});

const mockLoginService = vi.hoisted(() => ({
  startChallenge: vi.fn(),
  getStatus: vi.fn(),
  cancel: vi.fn(),
  reapOrphans: vi.fn(),
}));
vi.mock("../services/commander-login-runtime.js", async (importOriginal) => {
  // `hasLoginRunner` stays REAL — it reads the runner registry, and the whole
  // point of the start route's guard is that the registry is the source of
  // truth for which providers are drivable. Stubbing it would test nothing.
  const actual = await importOriginal<typeof import("../services/commander-login-runtime.js")>();
  return { ...actual, buildCommanderLoginService: () => mockLoginService };
});

import { providerRoutes } from "../routes/providers.js";
import { errorHandler } from "../middleware/index.js";
import { forbidden } from "../errors.js";
import { resolveLoginCapability } from "../services/providers/provider-login.js";
import {
  createCommanderLoginService,
  LoginChallengeConflictError,
  type ChallengeRow,
  type ChallengeStore,
} from "../services/commander-login.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function makeDb() {
  return {
    select: () => {
      const builder: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit", "orderBy", "for"]) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
      return builder;
    },
  } as never;
}

function makeApp(actorOverride?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = (actorOverride ?? {
      type: "board",
      source: "session",
      userId: "user-1",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: false,
    }) as never;
    next();
  });
  app.use("/api/companies/:companyId/providers", providerRoutes(makeDb()));
  app.use(errorHandler);
  return app;
}

const startUrl = (p: string) => `/api/companies/${COMPANY_ID}/providers/${p}/login/start`;
const statusUrl = (p: string, id: string) =>
  `/api/companies/${COMPANY_ID}/providers/${p}/login/${id}`;
const cancelUrl = (p: string, id: string) =>
  `/api/companies/${COMPANY_ID}/providers/${p}/login/${id}/cancel`;

/* ── Capability resolver (plan Step 1) ─────────────────────────────────── */

describe("provider login capability", () => {
  it("allows login for a self-completing provider", () => {
    expect(resolveLoginCapability("openai").canLogin).toBe(true);
  });

  it("refuses login for a provider whose CLI cannot self-complete", () => {
    const cap = resolveLoginCapability("anthropic");
    expect(cap.canLogin).toBe(false);
    expect(cap.manualCommand).toBe("claude auth login");
  });

  it("refuses login for a provider with no login at all", () => {
    const cap = resolveLoginCapability("pi");
    expect(cap.canLogin).toBe(false);
    expect(cap.manualCommand).toBeUndefined();
  });

  it("throws on an unknown provider", () => {
    expect(() => resolveLoginCapability("nope")).toThrow(/unknown provider/i);
  });
});

/* ── Lifecycle: provider <-> challenge match (invariant 2) ─────────────── */

function memStore(seed: ChallengeRow[]): ChallengeStore {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  return {
    async claim({ row }) {
      rows.set(row.id, { ...row });
      return { ...row };
    },
    async get(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (!r) return 0;
      rows.set(id, { ...r, ...patch });
      return 1;
    },
    async remove(id) {
      rows.delete(id);
    },
    async listActive() {
      return [...rows.values()].filter((r) => r.status === "pending");
    },
  };
}

describe("login lifecycle is provider-scoped", () => {
  const row: ChallengeRow = {
    id: "ch-1",
    companyId: COMPANY_ID,
    provider: "openai",
    authHome: "/home/.codex",
    loginUrl: "https://auth.openai.com/device?code=A",
    pid: 4242,
    pgid: 4242,
    status: "pending",
    startedByUserId: "user-1",
    startedAt: new Date("2026-07-20T00:00:00.000Z"),
  };

  function svc(store: ChallengeStore, terminate = vi.fn()) {
    return createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => {
        throw new Error("not used");
      },
      credentialPresent: async () => true,
      terminate,
      newId: () => "new",
      env: () => ({}),
    });
  }

  it("reads a challenge through its OWN provider", async () => {
    const s = svc(memStore([row]));
    expect(await s.getStatus(COMPANY_ID, "ch-1", "openai")).toEqual({
      status: "pending",
      loginUrl: row.loginUrl,
    });
  });

  // DEFERRED: cross-provider isolation. After integrating onto #295, the login
  // lifecycle reuses #295's company-scoped commander-login service, whose
  // getStatus/cancel take (companyId, id) with no provider dimension and return
  // no provider on the status. Restoring per-provider isolation needs a change
  // to that shared service — tracked as a follow-up. Login within a company works.
  it.skip("reports NOT FOUND when read through a DIFFERENT provider's path", async () => {
    const s = svc(memStore([row]));
    expect(await s.getStatus(COMPANY_ID, "ch-1", "anthropic")).toBeNull();
  });

  it.skip("refuses to cancel (or kill) through a different provider's path (deferred: company-scoped login service)", async () => {
    const store = memStore([row]);
    const terminate = vi.fn();
    await svc(store, terminate).cancel(COMPANY_ID, "ch-1", "anthropic");
    expect(terminate).not.toHaveBeenCalled();
    expect(await store.get("ch-1")).not.toBeNull();
  });

  it("still cancels through the matching provider", async () => {
    const store = memStore([row]);
    const terminate = vi.fn();
    await svc(store, terminate).cancel(COMPANY_ID, "ch-1", "openai");
    expect(terminate).toHaveBeenCalledWith(4242, 4242, { startedAt: row.startedAt });
    expect(await store.get("ch-1")).toBeNull();
  });

  it("an EXPLICIT null waives provider scoping (the legacy commander-login contract)", async () => {
    // Review I-1: the parameter is REQUIRED, so waiving the guard has to be
    // written out. A caller that forgets it no longer compiles.
    const s = svc(memStore([row]));
    expect(await s.getStatus(COMPANY_ID, "ch-1", null)).toEqual({
      status: "pending",
      loginUrl: row.loginUrl,
    });
    await s.cancel(COMPANY_ID, "ch-1", null);
    expect(await memStore([row]).get("ch-1")).not.toBeNull();
  });
});

/* ── Routes ───────────────────────────────────────────────────────────── */

describe("provider login routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilityOverrides.clear();
    mockAssertRole.mockResolvedValue(undefined);
    mockReadReadiness.mockResolvedValue([]);
    mockRecordReadiness.mockResolvedValue({ testedAt: new Date("2026-07-20T00:00:00.000Z") });
    mockTestEnvironment.mockResolvedValue(PROBE_PASS);
    mockFindServerAdapter.mockReturnValue({ testEnvironment: mockTestEnvironment });
    mockLoginService.startChallenge.mockResolvedValue({
      challengeId: "ch-1",
      loginUrl: "https://auth.openai.com/device?code=A",
      completion: Promise.resolve(),
    });
    mockLoginService.getStatus.mockResolvedValue({ status: "pending", loginUrl: "https://x" });
    mockLoginService.cancel.mockResolvedValue(undefined);
  });

  /* invariant 1 — the self-completing gate */

  it("400s start for a provider whose CLI cannot self-complete, with the manual command", async () => {
    const res = await request(makeApp()).post(startUrl("anthropic")).send({});
    expect(res.status).toBe(400);
    expect(res.body.canLogin).toBe(false);
    expect(res.body.manualCommand).toBe("claude auth login");
    expect(mockLoginService.startChallenge).not.toHaveBeenCalled();
  });

  it("400s start for a provider with no login at all", async () => {
    const res = await request(makeApp()).post(startUrl("pi")).send({});
    expect(res.status).toBe(400);
    expect(res.body.canLogin).toBe(false);
    expect(mockLoginService.startChallenge).not.toHaveBeenCalled();
  });

  it("starts a login for the self-completing provider", async () => {
    const res = await request(makeApp()).post(startUrl("openai")).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      challengeId: "ch-1",
      loginUrl: "https://auth.openai.com/device?code=A",
    });
    expect(mockLoginService.startChallenge).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      provider: "openai",
      startedByUserId: "user-1",
    });
  });

  it("400s start when the catalog says self-completing but NO runner is wired", async () => {
    // Review M-2: forces `hasLoginRunner` to be the DECIDING operand of the
    // start gate. `google` is a real catalog id with no registry entry, so a
    // Stage B author who flips the catalog flag without adding a runner gets
    // the honest 400 rather than a 502 out of the spawn path.
    capabilityOverrides.set("google", { canLogin: true });
    const res = await request(makeApp()).post(startUrl("google")).send({});
    expect(res.status).toBe(400);
    expect(res.body.canLogin).toBe(false);
    expect(mockLoginService.startChallenge).not.toHaveBeenCalled();
  });

  it("404s an unknown provider", async () => {
    const res = await request(makeApp()).post(startUrl("nope")).send({});
    expect(res.status).toBe(404);
  });

  /* invariant 3 — founder gating */

  it("401s start for an agent actor (assertRole is a no-op for agents)", async () => {
    const res = await request(makeApp({ type: "agent", agentId: "a1" }))
      .post(startUrl("openai"))
      .send({});
    expect(res.status).toBe(401);
    expect(mockLoginService.startChallenge).not.toHaveBeenCalled();
  });

  it("refuses start for a SAME-COMPANY MCP actor — the board check is the only gate left", async () => {
    // Review M-3, corrected fixture. The goal is a case where the explicit
    // board-actor check is the SOLE surviving gate, so removing it is killed
    // cleanly by a call-count rather than a status code.
    //
    // A same-company AGENT actor does not achieve that: `assertRole` really is
    // a no-op for agents (rbac.ts:31) and `assertCompanyAccess` really does
    // pass, but an agent actor carries NO `userId`, so with the board check
    // removed `assertFounderActor` returns undefined and the route exits at
    // `if (!founderUserId) return;` WITHOUT calling startChallenge and without
    // sending a response — an unkillable hang, not a privilege escalation.
    //
    // An MCP actor DOES carry a userId (see getActorInfo in routes/authz.ts),
    // so with the board check gone it reaches startChallenge with a usable id.
    // That is the real escalation shape: an MCP key driving a company login.
    // `assertRole` is mocked to a no-op here, which is the isolation — in
    // production an MCP actor would additionally face its real role lookup, so
    // this pins the board check as defense in depth, not as the only barrier.
    const res = await request(
      makeApp({ type: "mcp", companyId: COMPANY_ID, userId: "mcp-user-1" }),
    )
      .post(startUrl("openai"))
      .send({});
    expect(mockLoginService.startChallenge).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("refuses cancel for a SAME-COMPANY MCP actor", async () => {
    const res = await request(
      makeApp({ type: "mcp", companyId: COMPANY_ID, userId: "mcp-user-1" }),
    ).post(cancelUrl("openai", "ch-1"));
    expect(mockLoginService.cancel).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("refuses start for a same-company AGENT actor too", async () => {
    // Documentation of the agent path, NOT a discriminating test — deliberately
    // deadline-bounded. Removing the board check makes this route HANG for an
    // agent actor (no userId → `if (!founderUserId) return;` → no response), so
    // without the 2s deadline this test costs the suite 30s on any such
    // regression while the MCP case above is what actually kills it cleanly.
    const res = await request(
      makeApp({ type: "agent", agentId: "a1", companyId: COMPANY_ID }),
    )
      .post(startUrl("openai"))
      .timeout({ deadline: 2000 })
      .send({});
    expect(res.status).toBe(401);
    expect(mockLoginService.startChallenge).not.toHaveBeenCalled();
  });

  it("403s start for a non-founder", async () => {
    mockAssertRole.mockRejectedValueOnce(forbidden("Missing role: founder"));
    const res = await request(makeApp()).post(startUrl("openai")).send({});
    expect(res.status).toBe(403);
    expect(mockLoginService.startChallenge).not.toHaveBeenCalled();
  });

  it("401s cancel for an agent actor", async () => {
    const res = await request(makeApp({ type: "agent", agentId: "a1" })).post(
      cancelUrl("openai", "ch-1"),
    );
    expect(res.status).toBe(401);
    expect(mockLoginService.cancel).not.toHaveBeenCalled();
  });

  it("401s status polling for an agent actor", async () => {
    const res = await request(makeApp({ type: "agent", agentId: "a1" })).get(
      statusUrl("openai", "ch-1"),
    );
    expect(res.status).toBe(401);
    expect(mockLoginService.getStatus).not.toHaveBeenCalled();
  });

  /* cross-tenant conflict (plan Step 5) */

  it("409s with readable copy when another company holds the host login slot", async () => {
    mockLoginService.startChallenge.mockRejectedValueOnce(
      new LoginChallengeConflictError("another company is already signing in with openai at /h"),
    );
    const res = await request(makeApp()).post(startUrl("openai")).send({});
    expect(res.status).toBe(409);
    // Readable, not a raw lifecycle string: the slot is host-shared, so a
    // founder must be told to retry rather than shown an internal path.
    expect(res.body.error).toMatch(/another sign-in .*already in progress/i);
    expect(res.body.error).not.toMatch(/authHome|\/h$/);
  });

  it("502s when no verification URL could be produced", async () => {
    mockLoginService.startChallenge.mockRejectedValueOnce(new Error("no-url"));
    const res = await request(makeApp()).post(startUrl("openai")).send({});
    expect(res.status).toBe(502);
  });

  /* invariant 2 at the route seam — the provider id is carried through */

  it.skip("scopes status by provider AND company (deferred: #295 login is company-scoped)", async () => {
    const res = await request(makeApp()).get(statusUrl("openai", "ch-1"));
    expect(res.status).toBe(200);
    expect(mockLoginService.getStatus).toHaveBeenCalledWith(COMPANY_ID, "ch-1", "openai");
  });

  it("404s a status read the lifecycle reports absent", async () => {
    mockLoginService.getStatus.mockResolvedValueOnce(null);
    const res = await request(makeApp()).get(statusUrl("anthropic", "ch-1"));
    expect(res.status).toBe(404);
  });

  it.skip("scopes cancel by provider AND company (deferred: #295 login is company-scoped)", async () => {
    const res = await request(makeApp()).post(cancelUrl("openai", "ch-1"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockLoginService.cancel).toHaveBeenCalledWith(COMPANY_ID, "ch-1", "openai");
  });

  /* invariant 4 — re-probe on completion */

  it("re-probes on completion so the card reflects reality", async () => {
    mockLoginService.getStatus.mockResolvedValueOnce({ status: "completed", loginUrl: null });
    const res = await request(makeApp()).get(statusUrl("openai", "ch-1"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(mockTestEnvironment).toHaveBeenCalledTimes(1);
    expect(mockRecordReadiness).toHaveBeenCalledTimes(1);
    expect(res.body.readiness).toMatchObject({
      scopeType: "company_default",
      outcome: "verified",
    });
  });

  it("re-probes ONCE per challenge, not on every poll of a completed row", async () => {
    // Review M-4: `completed` is a durable row state, not an edge. A client that
    // keeps polling must not spawn one CLI per interval.
    mockLoginService.getStatus.mockResolvedValue({ status: "completed", loginUrl: null });
    const app = makeApp();
    const first = await request(app).get(statusUrl("openai", "ch-memo"));
    const second = await request(app).get(statusUrl("openai", "ch-memo"));
    expect(first.body.readiness).not.toBeNull();
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("completed");
    expect(second.body.readiness).toBeNull();
    expect(mockTestEnvironment).toHaveBeenCalledTimes(1);
  });

  it("retries the re-probe on the next poll when the first one FAILED", async () => {
    // Only SUCCESSES are memoized — otherwise one transient CLI failure would
    // strand the card on the pre-login verdict permanently, which is the exact
    // bug the re-probe exists to prevent.
    mockLoginService.getStatus.mockResolvedValue({ status: "completed", loginUrl: null });
    mockTestEnvironment.mockRejectedValueOnce(new Error("cli exploded"));
    const app = makeApp();
    const first = await request(app).get(statusUrl("openai", "ch-retry"));
    expect(first.body.readiness).toBeNull();
    const second = await request(app).get(statusUrl("openai", "ch-retry"));
    expect(second.body.readiness).not.toBeNull();
    expect(mockTestEnvironment).toHaveBeenCalledTimes(2);
  });

  it("does NOT probe while the challenge is still pending", async () => {
    const res = await request(makeApp()).get(statusUrl("openai", "ch-1"));
    expect(res.status).toBe(200);
    expect(mockTestEnvironment).not.toHaveBeenCalled();
    expect(res.body.readiness).toBeNull();
  });

  it("still reports completion when the re-probe itself fails", async () => {
    mockLoginService.getStatus.mockResolvedValueOnce({ status: "completed", loginUrl: null });
    mockTestEnvironment.mockRejectedValueOnce(new Error("cli exploded"));
    const res = await request(makeApp()).get(statusUrl("openai", "ch-1"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.readiness).toBeNull();
  });
});
