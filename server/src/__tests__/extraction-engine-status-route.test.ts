/**
 * Tests for GET /companies/:companyId/extraction/engine-status
 *
 * Verifies:
 *   1. Shape and `engine` value for each combination:
 *      - CLI available                   → engine: "cli"
 *      - CLI not available + key present → engine: "api"
 *      - Neither                         → engine: "none"
 *   2. RBAC gate: founder and team_lead allowed; lower roles (team_member) are
 *      rejected with 403; unauthenticated actor is rejected with 401.
 *
 * Mocking strategy follows the existing route tests (runtime-provider-keys-routes,
 * agents-lifecycle-routes): vi.hoisted mocks for all module-level deps; express
 * + supertest for the HTTP layer; no real DB needed.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

// ── Hoist all mock functions before any imports ──────────────────────────────

const mocks = vi.hoisted(() => ({
  assertCompanyAccess: vi.fn(),
  assertRole: vi.fn<() => Promise<void>>(),
  resolveCompanyCliTool: vi.fn<() => Promise<string>>(),
  probeExtractionCli: vi.fn<() => Promise<{ available: boolean; tool: string; error?: string }>>(),
  resolveAvailableProvider: vi.fn<() => Promise<unknown>>(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: mocks.assertCompanyAccess,
}));

vi.mock("../middleware/rbac.js", () => ({
  assertRole: mocks.assertRole,
}));

vi.mock("../services/extraction-engine.js", () => ({
  resolveCompanyCliTool: mocks.resolveCompanyCliTool,
  probeExtractionCli: mocks.probeExtractionCli,
}));

vi.mock("../services/internal-agent/providers/index.js", () => ({
  resolveAvailableProvider: mocks.resolveAvailableProvider,
}));

// ── Import subject after mocks ────────────────────────────────────────────────

import { extractionRoutes } from "../routes/extraction.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Build a minimal express app with the given actor injected. */
function makeApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: Record<string, unknown> }).actor = actor;
    next();
  });
  app.use("/api", extractionRoutes({} as never));
  app.use(errorHandler);
  return app;
}

/** A founder actor with access to COMPANY_ID. */
const founderActor = {
  type: "board",
  source: "session",
  userId: "user-founder",
  companyIds: [COMPANY_ID],
  isInstanceAdmin: false,
};

const STATUS_URL = `/api/companies/${COMPANY_ID}/extraction/engine-status`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /companies/:companyId/extraction/engine-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authz always passes (tests can override).
    mocks.assertCompanyAccess.mockReturnValue(undefined);
    mocks.assertRole.mockResolvedValue(undefined);
  });

  // ── engine value ───────────────────────────────────────────────────────────

  it("returns engine='cli' when CLI is available", async () => {
    mocks.resolveCompanyCliTool.mockResolvedValue("claude_cli");
    mocks.probeExtractionCli.mockResolvedValue({ available: true, tool: "claude_cli" });
    mocks.resolveAvailableProvider.mockResolvedValue({
      provider: "anthropic",
      apiKey: "sk-test",
      model: "claude-sonnet-4-6",
    });

    const res = await request(makeApp(founderActor)).get(STATUS_URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      engine: "cli",
      cli: { available: true, tool: "claude_cli" },
      apiKey: true,
    });
  });

  it("returns engine='api' when CLI not available but a key is configured", async () => {
    mocks.resolveCompanyCliTool.mockResolvedValue("claude_cli");
    mocks.probeExtractionCli.mockResolvedValue({ available: false, tool: "claude_cli" });
    mocks.resolveAvailableProvider.mockResolvedValue({
      provider: "openai",
      apiKey: "sk-openai-test",
      model: "gpt-4o",
    });

    const res = await request(makeApp(founderActor)).get(STATUS_URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      engine: "api",
      cli: { available: false, tool: "claude_cli" },
      apiKey: true,
    });
  });

  it("returns engine='none' when neither CLI nor key is available", async () => {
    mocks.resolveCompanyCliTool.mockResolvedValue("claude_cli");
    mocks.probeExtractionCli.mockResolvedValue({ available: false, tool: "claude_cli" });
    mocks.resolveAvailableProvider.mockRejectedValue(new Error("No API key configured"));

    const res = await request(makeApp(founderActor)).get(STATUS_URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      engine: "none",
      cli: { available: false, tool: "claude_cli" },
      apiKey: false,
    });
  });

  it("apiKey=false when provider resolver throws", async () => {
    mocks.resolveCompanyCliTool.mockResolvedValue("codex");
    mocks.probeExtractionCli.mockResolvedValue({ available: false, tool: "codex" });
    mocks.resolveAvailableProvider.mockRejectedValue(
      new Error("No API key configured for provider"),
    );

    const res = await request(makeApp(founderActor)).get(STATUS_URL);

    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBe(false);
    expect(res.body.engine).toBe("none");
  });

  it("forwards the configured tool name in the cli field", async () => {
    mocks.resolveCompanyCliTool.mockResolvedValue("codex");
    mocks.probeExtractionCli.mockResolvedValue({ available: true, tool: "codex" });
    mocks.resolveAvailableProvider.mockRejectedValue(new Error("no key"));

    const res = await request(makeApp(founderActor)).get(STATUS_URL);

    expect(res.status).toBe(200);
    expect(res.body.cli.tool).toBe("codex");
    // CLI takes priority even though apiKey=false
    expect(res.body.engine).toBe("cli");
  });

  // ── authz calls ────────────────────────────────────────────────────────────

  it("calls assertCompanyAccess with the correct companyId", async () => {
    mocks.resolveCompanyCliTool.mockResolvedValue("claude_cli");
    mocks.probeExtractionCli.mockResolvedValue({ available: true, tool: "claude_cli" });
    mocks.resolveAvailableProvider.mockRejectedValue(new Error("no key"));

    await request(makeApp(founderActor)).get(STATUS_URL);

    expect(mocks.assertCompanyAccess).toHaveBeenCalledWith(expect.anything(), COMPANY_ID);
  });

  it("calls assertRole with founder and team_lead", async () => {
    mocks.resolveCompanyCliTool.mockResolvedValue("claude_cli");
    mocks.probeExtractionCli.mockResolvedValue({ available: false, tool: "claude_cli" });
    mocks.resolveAvailableProvider.mockRejectedValue(new Error("no key"));

    await request(makeApp(founderActor)).get(STATUS_URL);

    expect(mocks.assertRole).toHaveBeenCalledWith(
      expect.anything(), // db
      expect.anything(), // req
      COMPANY_ID,
      "founder",
      "team_lead",
    );
  });

  // ── RBAC rejections ────────────────────────────────────────────────────────

  it("returns 403 when assertRole throws forbidden", async () => {
    const { forbidden } = await import("../errors.js");
    mocks.assertRole.mockRejectedValue(forbidden("Requires one of: founder, team_lead"));

    const res = await request(makeApp(founderActor)).get(STATUS_URL);

    expect(res.status).toBe(403);
    // No downstream calls after the authz gate.
    expect(mocks.resolveCompanyCliTool).not.toHaveBeenCalled();
  });

  it("returns 401 when assertCompanyAccess throws unauthorized", async () => {
    const { unauthorized } = await import("../errors.js");
    mocks.assertCompanyAccess.mockImplementation(() => {
      throw unauthorized();
    });

    const res = await request(makeApp(founderActor)).get(STATUS_URL);

    expect(res.status).toBe(401);
    expect(mocks.resolveCompanyCliTool).not.toHaveBeenCalled();
  });
});
