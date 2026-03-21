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

import {
  buildJoinDefaultsPayloadForAccept,
  canReplayOpenClawInviteAccept,
  mergeJoinDefaultsPayloadForReplay,
} from "../routes/access.js";

describe("canReplayOpenClawInviteAccept", () => {
  it("allows replay only for openclaw agent joins in pending or approved state", () => {
    expect(
      canReplayOpenClawInviteAccept({
        requestType: "agent",
        adapterType: "openclaw",
        existingJoinRequest: {
          requestType: "agent",
          adapterType: "openclaw",
          status: "pending_approval",
        },
      }),
    ).toBe(true);
    expect(
      canReplayOpenClawInviteAccept({
        requestType: "agent",
        adapterType: "openclaw",
        existingJoinRequest: {
          requestType: "agent",
          adapterType: "openclaw",
          status: "approved",
        },
      }),
    ).toBe(true);
    expect(
      canReplayOpenClawInviteAccept({
        requestType: "agent",
        adapterType: "openclaw",
        existingJoinRequest: {
          requestType: "agent",
          adapterType: "openclaw",
          status: "rejected",
        },
      }),
    ).toBe(false);
    expect(
      canReplayOpenClawInviteAccept({
        requestType: "human",
        adapterType: "openclaw",
        existingJoinRequest: {
          requestType: "agent",
          adapterType: "openclaw",
          status: "pending_approval",
        },
      }),
    ).toBe(false);
    expect(
      canReplayOpenClawInviteAccept({
        requestType: "agent",
        adapterType: "process",
        existingJoinRequest: {
          requestType: "agent",
          adapterType: "openclaw",
          status: "pending_approval",
        },
      }),
    ).toBe(false);
  });
});

describe("mergeJoinDefaultsPayloadForReplay", () => {
  it("merges replay payloads and preserves existing fields while allowing auth/header overrides", () => {
    const merged = mergeJoinDefaultsPayloadForReplay(
      {
        url: "https://old.example/v1/responses",
        method: "POST",
        paperclipApiUrl: "http://host.docker.internal:3100",
        headers: {
          "x-openclaw-auth": "old-token",
          "x-custom": "keep-me",
        },
      },
      {
        paperclipApiUrl: "https://paperclip.example.com",
        headers: {
          "x-openclaw-auth": "new-token",
        },
      },
    );

    const normalized = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw",
      defaultsPayload: merged,
      inboundOpenClawAuthHeader: null,
    }) as Record<string, unknown>;

    expect(normalized.url).toBe("https://old.example/v1/responses");
    expect(normalized.paperclipApiUrl).toBe("https://paperclip.example.com");
    expect(normalized.webhookAuthHeader).toBe("Bearer new-token");
    expect(normalized.headers).toMatchObject({
      "x-openclaw-auth": "new-token",
      "x-custom": "keep-me",
    });
  });
});
