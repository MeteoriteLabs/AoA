/**
 * @fileoverview Tasks 11 + 12 — the OAuth connector broker's two HTTP routes:
 * `POST …/:id/oauth/start` (discovery + DCR + PKCE + signed state) and
 * `GET /mcp-connectors/oauth/callback` (state verify + atomic single-use claim +
 * code exchange + secret store + connector bind).
 *
 * The routes call `db.insert/select/update` directly on the DB injected into
 * `mcpConnectorRoutes(db, opts)`, so a module-level `vi.mock("@armyofagents/db")`
 * would NOT intercept them — this file builds a capable fake `db` instead.
 */

import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";

let deploymentMode = "authenticated";
vi.mock("../config.js", () => ({ loadConfig: () => ({ deploymentMode, port: 3100, authPublicBaseUrl: "https://app.test" }) }));

const mockConnectorSvc = vi.hoisted(() => ({ getById: vi.fn(), getByName: vi.fn(), create: vi.fn(), updateIfStatus: vi.fn() }));
const mockSecretSvc = vi.hoisted(() => ({ getByName: vi.fn(), create: vi.fn(), rotate: vi.fn(), resolveByName: vi.fn() }));
const mockLogActivity = vi.hoisted(() => vi.fn());
vi.mock("../services/index.js", () => ({
  mcpConnectorService: () => mockConnectorSvc, secretService: () => mockSecretSvc,
  logActivity: mockLogActivity, approvalService: () => ({ create: vi.fn() }),
}));
const mockGetEffectiveRole = vi.hoisted(() => vi.fn());
vi.mock("../services/permissions.js", () => ({ permissionService: () => ({ getEffectiveRole: mockGetEffectiveRole, isFounder: vi.fn() }) }));
const mockOauth = vi.hoisted(() => ({
  discoverOAuthServer: vi.fn(), registerOAuthClient: vi.fn(), generatePkce: vi.fn(),
  signOAuthState: vi.fn(), buildAuthorizeUrl: vi.fn(), exchangeAuthorizationCode: vi.fn(), verifyOAuthState: vi.fn(),
}));
vi.mock("../services/mcp-connector-oauth.js", () => mockOauth);

import { mcpConnectorRoutes } from "../routes/mcp-connectors.js";
import { errorHandler } from "../middleware/index.js";

const COMPANY = "company-A";
const FOUNDER_UUID = "44444444-4444-4444-8444-444444444444";
const founderActor = { type: "board" as const, source: "session" as const, userId: FOUNDER_UUID, companyIds: [COMPANY], isInstanceAdmin: false };
const CATALOG = [{ id: "notion-hosted", serverName: "notion", displayName: "Notion (hosted)", transport: "http",
  url: "https://mcp.notion.com/mcp", requiresOAuth: true, oauth: { scopes: ["default"] }, trust: { tier: "verified" } }];

// Capture DB writes/reads; the routes call these on the injected db.
const mockFlowInsert = vi.fn();
const mockFlowSelect = vi.fn().mockResolvedValue([]);          // select().from().where().limit()
const mockFlowClaim = vi.fn().mockResolvedValue([{ id: "flow1" }]); // update().set().where().returning()
function fakeDb() {
  // `where()` is awaited for fire-and-forget status flips AND chained to `.returning()` for the
  // atomic claim, so make it BOTH a thenable and expose `.returning()`.
  const whereResult: any = { returning: () => mockFlowClaim(), then: (r: any) => Promise.resolve().then(r), catch: () => Promise.resolve() };
  return {
    transaction: (fn: any) => fn({}),
    insert: () => ({ values: (v: any) => { mockFlowInsert(v); return Promise.resolve(); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => mockFlowSelect() }) }) }),
    update: () => ({ set: () => ({ where: () => whereResult }) }),
  } as never;
}
function makeApp(actor: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).actor = actor; next(); });
  app.use("/api", mcpConnectorRoutes(fakeDb(), { catalog: { load: async () => ({ entries: CATALOG, stale: false }) } }));
  app.use(errorHandler);
  return app;
}
beforeEach(() => { vi.clearAllMocks(); mockGetEffectiveRole.mockResolvedValue("founder"); mockFlowSelect.mockResolvedValue([]); mockFlowClaim.mockResolvedValue([{ id: "flow1" }]); });

it("founder start returns an authorizeUrl and inserts a flow row", async () => {
  mockConnectorSvc.getById.mockResolvedValue({ id: "conn1", companyId: COMPANY, serverName: "notion",
    transport: "http", url: "https://mcp.notion.com/mcp", requiresSecret: true, secretRef: null, status: "needs_credentials" });
  mockOauth.discoverOAuthServer.mockResolvedValue({ authorizationEndpoint: "https://as/authorize",
    tokenEndpoint: "https://as/token", registrationEndpoint: "https://as/register", scopesSupported: ["default"], codeChallengeMethods: ["S256"] });
  mockOauth.registerOAuthClient.mockResolvedValue({ clientId: "cid" });
  mockOauth.generatePkce.mockReturnValue({ verifier: "ver", challenge: "chal" });
  mockOauth.signOAuthState.mockReturnValue("STATE");
  mockOauth.buildAuthorizeUrl.mockReturnValue("https://as/authorize?x=1");

  const res = await request(makeApp(founderActor)).post(`/api/companies/${COMPANY}/mcp-connectors/conn1/oauth/start`).send({});
  expect(res.status).toBe(200);
  expect(res.body.authorizeUrl).toBe("https://as/authorize?x=1");
  expect(mockFlowInsert).toHaveBeenCalledWith(expect.objectContaining({ connectorId: "conn1", state: "STATE", clientId: "cid", startedByUserId: FOUNDER_UUID }));
});

it("rejects oauth/start on a non-OAuth connector (Fix 11)", async () => {
  mockConnectorSvc.getById.mockResolvedValue({ id: "conn2", companyId: COMPANY, serverName: "linear",
    transport: "http", url: "https://x/mcp", requiresSecret: true, secretRef: "mcp:linear", status: "active" });
  const res = await request(makeApp(founderActor)).post(`/api/companies/${COMPANY}/mcp-connectors/conn2/oauth/start`).send({});
  expect(res.status).toBe(400);
  expect(mockFlowInsert).not.toHaveBeenCalled();
});

it.each(["team_lead", "team_member"])("%s is forbidden", async (role) => {
  mockGetEffectiveRole.mockResolvedValue(role);
  mockConnectorSvc.getById.mockResolvedValue({ id: "conn1", companyId: COMPANY, serverName: "notion", transport: "http", url: "https://mcp.notion.com/mcp" });
  const res = await request(makeApp(founderActor)).post(`/api/companies/${COMPANY}/mcp-connectors/conn1/oauth/start`).send({});
  expect(res.status).toBe(403);
});

it("callback exchanges the code, stores the secret, binds the connector, redirects", async () => {
  mockOauth.verifyOAuthState.mockReturnValue({ connectorId: "conn1", companyId: "company-A", nonce: "n", exp: Date.now() + 60_000 });
  mockFlowSelect.mockResolvedValue([{ id: "flow1", connectorId: "conn1", companyId: "company-A", status: "pending",
    pkceVerifier: "ver", clientId: "cid", redirectUri: "https://app/cb", tokenEndpoint: "https://as/token",
    resource: "https://mcp.notion.com/mcp", scopes: ["default"], expiresAt: new Date(Date.now() + 60_000) }]);
  mockConnectorSvc.getById.mockResolvedValue({ id: "conn1", companyId: "company-A", serverName: "notion", status: "needs_credentials" });
  mockOauth.exchangeAuthorizationCode.mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  mockSecretSvc.getByName.mockResolvedValue(null);
  mockSecretSvc.create.mockResolvedValue({ id: "sec1", name: "mcp:notion" });
  mockConnectorSvc.updateIfStatus.mockResolvedValue({ id: "conn1", status: "active" });

  const res = await request(makeApp(null)) // no actor — browser redirect
    .get(`/api/mcp-connectors/oauth/callback?code=CODE&state=STATE`);
  expect(res.status).toBe(302);
  expect(mockSecretSvc.create).toHaveBeenCalledWith("company-A",
    expect.objectContaining({ name: "mcp:notion", provider: "local_encrypted", managedMode: "aoa_managed" }), expect.anything());
  expect(mockConnectorSvc.updateIfStatus).toHaveBeenCalledWith("conn1", "needs_credentials",
    expect.objectContaining({ secretRef: "mcp:notion", status: "active" }));
});

it("callback rejects an invalid state", async () => {
  mockOauth.verifyOAuthState.mockReturnValue(null);
  const res = await request(makeApp(null)).get(`/api/mcp-connectors/oauth/callback?code=c&state=bad`);
  expect(res.status).toBe(400);
});

it("callback is single-use: a lost atomic claim -> 400, no exchange (Fix 6)", async () => {
  mockOauth.verifyOAuthState.mockReturnValue({ connectorId: "conn1", companyId: "company-A", nonce: "n", exp: Date.now() + 60_000 });
  mockFlowSelect.mockResolvedValue([{ id: "flow1", connectorId: "conn1", companyId: "company-A", status: "pending", expiresAt: new Date(Date.now() + 60_000) }]);
  mockFlowClaim.mockResolvedValue([]); // another concurrent callback already claimed it
  const res = await request(makeApp(null)).get(`/api/mcp-connectors/oauth/callback?code=CODE&state=STATE`);
  expect(res.status).toBe(400);
  expect(mockOauth.exchangeAuthorizationCode).not.toHaveBeenCalled();
});
