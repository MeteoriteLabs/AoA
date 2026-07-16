import { describe, expect, it } from "vitest";
import {
  companyInviteExpiresAt,
  inviteDefaultsHaveBoundEmail,
} from "../routes/access-helpers.js";

const CREATED_AT_MS = Date.parse("2026-03-06T00:00:00.000Z");

describe("companyInviteExpiresAt", () => {
  it("sets open-invite expiration to 10 minutes after invite creation time", () => {
    const expiresAt = companyInviteExpiresAt(null, CREATED_AT_MS);
    expect(expiresAt.toISOString()).toBe("2026-03-06T00:10:00.000Z");
  });

  it("keeps the 10-minute TTL for agent invites (no teamInvite payload)", () => {
    const expiresAt = companyInviteExpiresAt(
      { agentMessage: "welcome" },
      CREATED_AT_MS,
    );
    expect(expiresAt.toISOString()).toBe("2026-03-06T00:10:00.000Z");
  });

  it("keeps the 10-minute TTL when teamInvite has no email", () => {
    const expiresAt = companyInviteExpiresAt(
      { teamInvite: { role: "team_member", email: "   " } },
      CREATED_AT_MS,
    );
    expect(expiresAt.toISOString()).toBe("2026-03-06T00:10:00.000Z");
  });

  it("gives email-bound team invites a 7-day expiration", () => {
    const expiresAt = companyInviteExpiresAt(
      { teamInvite: { role: "team_member", email: "ada@example.com" } },
      CREATED_AT_MS,
    );
    expect(expiresAt.toISOString()).toBe("2026-03-13T00:00:00.000Z");
  });
});

describe("inviteDefaultsHaveBoundEmail", () => {
  it("is true only when teamInvite.email is a non-empty string", () => {
    expect(inviteDefaultsHaveBoundEmail(null)).toBe(false);
    expect(inviteDefaultsHaveBoundEmail(undefined)).toBe(false);
    expect(inviteDefaultsHaveBoundEmail("string")).toBe(false);
    expect(inviteDefaultsHaveBoundEmail({})).toBe(false);
    expect(inviteDefaultsHaveBoundEmail({ teamInvite: null })).toBe(false);
    expect(inviteDefaultsHaveBoundEmail({ teamInvite: {} })).toBe(false);
    expect(inviteDefaultsHaveBoundEmail({ teamInvite: { email: "" } })).toBe(false);
    expect(inviteDefaultsHaveBoundEmail({ teamInvite: { email: 42 } })).toBe(false);
    expect(
      inviteDefaultsHaveBoundEmail({ teamInvite: { email: "ada@example.com" } }),
    ).toBe(true);
  });
});
