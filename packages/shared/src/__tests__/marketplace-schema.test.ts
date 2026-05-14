import { describe, expect, it } from "vitest";
import { MarketplaceCatalogItemSchema } from "../marketplace.js";

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
      commitSha: "abcdef1234567890",
      path: "openai-docs",
      treeUrl: "https://github.com/openai/skills/tree/abcdef1234567890/openai-docs",
    });
  });
});

function makeCatalogSkill() {
  return {
    id: "skill:github-skills/openai/skills/openai-docs",
    type: "skill",
    name: "OpenAI Docs",
    description: "Use current OpenAI docs.",
    version: "1.0.0",
    source: {
      adapter: "github-skills",
      url: "https://github.com/openai/skills/tree/abcdef1234567890/openai-docs",
      locator: "openai-docs",
      commitSha: "abcdef1234567890",
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
        commitSha: "abcdef1234567890",
        path: "openai-docs",
        treeUrl: "https://github.com/openai/skills/tree/abcdef1234567890/openai-docs",
      },
      frontmatter: { name: "openai-docs", raw: {} },
    },
    resourceUrl: "https://raw.githubusercontent.com/openai/skills/abcdef1234567890/openai-docs/SKILL.md",
    trust: { tier: "verified", source: "trusted-sources.json" },
    status: "active",
    addedAt: "2026-05-14T00:00:00Z",
    category: "engineering",
    tags: ["official"],
  };
}
