import { describe, expect, expectTypeOf, it } from "vitest";
import {
  HUMAN_SOCIAL_LINK_TYPES,
  updateCompanyUserProfileSchema,
  type UpdateCompanyUserProfile,
} from "../validators/team.js";
import type {
  CompanyUserProfile,
  HumanSocialLink,
  MemberDependencies,
  TeamMemberSummary,
} from "../types/team.js";

const uuid = "550e8400-e29b-41d4-a716-446655440000";

describe("team profile shared contracts", () => {
  it("accepts and normalizes a valid company profile update payload", () => {
    const parsed = updateCompanyUserProfileSchema.parse({
      displayName: "  Ada Lovelace  ",
      title: "  Founder  ",
      bio: "  Builds analytical engines.  ",
      location: "  London  ",
      timezone: "  Europe/London  ",
      avatarAssetId: uuid,
      socialLinks: [
        { type: "github", label: "  Code  ", url: " https://github.com/ada " },
        { type: "website", label: null, url: "https://example.com" },
      ],
    });

    expect(parsed).toEqual({
      displayName: "Ada Lovelace",
      title: "Founder",
      bio: "Builds analytical engines.",
      location: "London",
      timezone: "Europe/London",
      avatarAssetId: uuid,
      socialLinks: [
        { type: "github", label: "Code", url: "https://github.com/ada" },
        { type: "website", label: null, url: "https://example.com" },
      ],
    });
  });

  it("accepts nullable fields and does not accept external avatar URLs", () => {
    const parsed = updateCompanyUserProfileSchema.parse({
      displayName: null,
      title: null,
      bio: null,
      location: null,
      timezone: null,
      avatarAssetId: null,
      socialLinks: [],
    });

    expect(parsed.avatarAssetId).toBeNull();
    expect(
      updateCompanyUserProfileSchema.safeParse({ avatarUrl: "https://example.com/avatar.png" }).success,
    ).toBe(false);
  });

  it("rejects empty or overlong text fields", () => {
    expect(updateCompanyUserProfileSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(updateCompanyUserProfileSchema.safeParse({ displayName: "a".repeat(121) }).success).toBe(false);
    expect(updateCompanyUserProfileSchema.safeParse({ timezone: "a".repeat(81) }).success).toBe(false);
    expect(updateCompanyUserProfileSchema.safeParse({ bio: "a".repeat(2001) }).success).toBe(false);
  });

  it("rejects unsupported social link types and invalid URLs", () => {
    expect(HUMAN_SOCIAL_LINK_TYPES).toContain("linkedin");
    expect(HUMAN_SOCIAL_LINK_TYPES).toContain("other");
    expect(
      updateCompanyUserProfileSchema.safeParse({
        socialLinks: [{ type: "mastodon", label: "Mastodon", url: "https://example.com/@ada" }],
      }).success,
    ).toBe(false);
    expect(
      updateCompanyUserProfileSchema.safeParse({
        socialLinks: [{ type: "github", label: "GitHub", url: "not-a-url" }],
      }).success,
    ).toBe(false);
  });

  it("exposes profile fields on team members and dependencies include agent ids per tree", () => {
    expectTypeOf<HumanSocialLink["type"]>().toEqualTypeOf<
      | "linkedin"
      | "github"
      | "x"
      | "instagram"
      | "facebook"
      | "substack"
      | "website"
      | "portfolio"
      | "youtube"
      | "medium"
      | "other"
    >();
    expectTypeOf<CompanyUserProfile>().toMatchTypeOf<{
      companyId: string;
      userId: string;
      socialLinks: HumanSocialLink[];
      avatarAssetId: string | null;
    }>();
    expectTypeOf<TeamMemberSummary>().toMatchTypeOf<{
      title: string | null;
      bio: string | null;
      location: string | null;
      timezone: string | null;
      socialLinks: HumanSocialLink[];
      avatarAssetId: string | null;
      avatarUrl: string | null;
    }>();
    expectTypeOf<MemberDependencies["agentTrees"][number]>().toMatchTypeOf<{
      rootAgentId: string;
      agentIds: string[];
    }>();
    expectTypeOf<UpdateCompanyUserProfile>().toMatchTypeOf<{
      socialLinks?: HumanSocialLink[];
      avatarAssetId?: string | null;
    }>();
  });
});
