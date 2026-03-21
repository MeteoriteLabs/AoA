import { describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/db", () => {
  const makeTable = () =>
    new Proxy({}, { get: (_target, prop) => (prop === "$inferSelect" || prop === "$inferInsert" ? {} : Symbol(String(prop))) });
  return { agentApiKeys: makeTable(), authUsers: makeTable(), invites: makeTable(), joinRequests: makeTable() };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  desc: (..._args: unknown[]) => "desc",
  eq: (..._args: unknown[]) => "eq",
  isNull: (..._args: unknown[]) => "isNull",
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({}),
  agentService: () => ({}),
  deduplicateAgentName: vi.fn(),
  logActivity: vi.fn(),
  notifyHireApproved: vi.fn(),
}));

import { companyInviteExpiresAt } from "../routes/access.js";

describe("companyInviteExpiresAt", () => {
  it("sets invite expiration to 10 minutes after invite creation time", () => {
    const createdAtMs = Date.parse("2026-03-06T00:00:00.000Z");
    const expiresAt = companyInviteExpiresAt(createdAtMs);
    expect(expiresAt.toISOString()).toBe("2026-03-06T00:10:00.000Z");
  });
});
