import { describe, expect, it } from "vitest";
import {
  MarketplaceCatalogItemSchema,
  MarketplaceSkillBundleSchema,
} from "../marketplace.js";

describe("MarketplaceCatalogItemSchema", () => {
  it("preserves provider logo metadata", () => {
    const parsed = MarketplaceCatalogItemSchema.parse(makeCatalogSkill());

    expect(parsed.provider).toEqual({
      id: "openai",
      name: "OpenAI",
      homepageUrl: "https://openai.com",
      logoUrl: "https://github.com/openai.png",
      fallbackInitials: "AI",
    });
  });

  it("preserves skill bundle metadata", () => {
    const parsed = MarketplaceCatalogItemSchema.parse(makeCatalogSkill());

    expect(parsed.skill?.bundle).toEqual({
      type: "github-directory",
      repo: "openai/skills",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
      path: "openai-docs",
      treeUrl: "https://github.com/openai/skills/tree/abcdef1234567890abcdef1234567890abcdef12/openai-docs",
    });
  });
});

describe("MarketplaceSkillBundleSchema", () => {
  it.each([
    "openai/skills",
    "https://github.com/openai/skills",
    "https://github.com/openai/skills.git",
  ])("accepts GitHub repo source %s", (repo) => {
    expect(() => MarketplaceSkillBundleSchema.parse(makeBundle({ repo }))).not.toThrow();
  });

  it.each([
    "./local-repo",
    "../local-repo",
    "/tmp/local-repo",
    "C:/tmp/local-repo",
    "https://example.com/openai/skills",
    "http://github.com/openai/skills",
    "git@github.com:openai/skills.git",
    "ssh://git@github.com/openai/skills.git",
    "openai/../skills",
    "../openai/skills",
    "openai/skills/../evil",
    "openai",
  ])("rejects unsafe GitHub repo source %s", (repo) => {
    const result = MarketplaceSkillBundleSchema.safeParse(makeBundle({ repo }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/github/i);
    }
  });

  it("accepts a full commit SHA", () => {
    expect(() =>
      MarketplaceSkillBundleSchema.parse(
        makeBundle({ commitSha: "0123456789abcdef0123456789abcdef01234567" }),
      ),
    ).not.toThrow();
  });

  it.each(["HEAD", "main", "v1.0.0", "abcdef1234567890", "g123456789abcdef0123456789abcdef01234567"])(
    "rejects mutable or non-full commit ref %s",
    (commitSha) => {
      const result = MarketplaceSkillBundleSchema.safeParse(makeBundle({ commitSha }));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/commit sha/i);
      }
    },
  );
});

function makeBundle(overrides: Record<string, unknown> = {}) {
  return {
    type: "github-directory",
    repo: "openai/skills",
    commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    path: "openai-docs",
    treeUrl: "https://github.com/openai/skills/tree/abcdef1234567890abcdef1234567890abcdef12/openai-docs",
    ...overrides,
  };
}

function makeCatalogSkill() {
  return {
    id: "skill:github-skills/openai/skills/openai-docs",
    type: "skill",
    name: "OpenAI Docs",
    description: "Use current OpenAI docs.",
    version: "1.0.0",
    source: {
      adapter: "github-skills",
      url: "https://github.com/openai/skills/tree/abcdef1234567890abcdef1234567890abcdef12/openai-docs",
      locator: "openai-docs",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    },
    provider: {
      id: "openai",
      name: "OpenAI",
      homepageUrl: "https://openai.com",
      logoUrl: "https://github.com/openai.png",
      fallbackInitials: "AI",
    },
    skill: {
      bundle: {
        type: "github-directory",
        repo: "openai/skills",
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        path: "openai-docs",
        treeUrl: "https://github.com/openai/skills/tree/abcdef1234567890abcdef1234567890abcdef12/openai-docs",
      },
      frontmatter: { name: "openai-docs", raw: {} },
    },
    resourceUrl: "https://raw.githubusercontent.com/openai/skills/abcdef1234567890abcdef1234567890abcdef12/openai-docs/SKILL.md",
    trust: { tier: "verified", source: "trusted-sources.json" },
    status: "active",
    addedAt: "2026-05-14T00:00:00Z",
    category: "engineering",
    tags: ["official"],
  };
}
