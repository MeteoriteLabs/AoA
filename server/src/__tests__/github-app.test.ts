import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock @octokit/auth-app ────────────────────────────────────────────────
const mockCreateInstallationAccessToken = vi.hoisted(() => vi.fn());
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(() => mockCreateInstallationAccessToken),
}));

// ── mock DB ───────────────────────────────────────────────────────────────
const mockDb = vi.hoisted(() => {
  const limit = vi.fn().mockResolvedValue([]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const returningFn = vi.fn().mockResolvedValue([]);
  const values = vi.fn(() => ({ returning: returningFn }));
  const insert = vi.fn(() => ({ values }));

  const deleteFn = vi.fn().mockResolvedValue([]);
  // deleteWhere returns a promise-like so `await db.delete(table).where(cond)` resolves
  const deleteWhere = vi.fn().mockResolvedValue([]);
  // Drizzle uses `db.delete()` — the key MUST be the string "delete" (reserved word)
  const deleteMethod = vi.fn(() => ({ where: deleteWhere }));

  return {
    select, from, where, limit,
    insert, values, returningFn,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    delete: deleteMethod,
    deleteWhere,
  };
});

import {
  getInstallation,
  saveInstallation,
  removeInstallation,
  mintInstallationToken,
  getInstallUrl,
} from "../services/github-app.js";

describe("getInstallUrl", () => {
  it("returns GitHub App installation URL containing the slug and state", () => {
    process.env.GITHUB_APP_SLUG = "my-aoa-app";
    const url = getInstallUrl("company-abc");
    expect(url).toContain("github.com/apps/my-aoa-app/installations/new");
    expect(url).toContain("state=company-abc");
    // Must NOT be the OAuth authorize URL
    expect(url).not.toContain("login/oauth/authorize");
  });
});

describe("saveInstallation", () => {
  it("upserts an installation row", async () => {
    mockDb.returningFn.mockResolvedValue([{
      id: "inst-1",
      companyId: "company-1",
      installationId: "12345",
      accountLogin: "myorg",
      accountType: "Organization",
      githubHost: "github.com",
    }]);

    const result = await saveInstallation(mockDb as any, {
      companyId: "company-1",
      installationId: "12345",
      accountLogin: "myorg",
      accountType: "Organization",
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result.installationId).toBe("12345");
  });
});

describe("getInstallation", () => {
  it("returns null when no installation exists", async () => {
    mockDb.limit.mockResolvedValue([]);
    const result = await getInstallation(mockDb as any, "company-1");
    expect(result).toBeNull();
  });

  it("returns the installation when it exists", async () => {
    mockDb.limit.mockResolvedValue([{ id: "inst-1", installationId: "12345", accountLogin: "myorg", suspendedAt: null }]);
    const result = await getInstallation(mockDb as any, "company-1");
    expect(result?.installationId).toBe("12345");
  });

  it("returns null for suspended installations", async () => {
    mockDb.limit.mockResolvedValue([{ id: "inst-1", installationId: "12345", accountLogin: "myorg", suspendedAt: new Date() }]);
    const result = await getInstallation(mockDb as any, "company-1");
    expect(result).toBeNull();
  });
});

describe("mintInstallationToken", () => {
  it("calls createAppAuth and returns token", async () => {
    mockCreateInstallationAccessToken.mockResolvedValue({ token: "ghs_installation_token" });
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----";

    const token = await mintInstallationToken("12345");
    expect(token).toBe("ghs_installation_token");
    expect(mockCreateInstallationAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ type: "installation" }),
    );
  });
});
