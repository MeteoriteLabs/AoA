import { describe, expect, it } from "vitest";
import {
  MarketplaceCatalogItemSchema,
  MarketplaceSkillBundleSchema,
  parseMarketplaceCatalog,
  isSchemaVersionSupported,
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

describe("parseMarketplaceCatalog (FU-14 per-item drop-and-warn)", () => {
  function makeEnvelope(items: unknown[]) {
    return {
      schemaVersion: "1.0.0",
      generatedAt: "2026-05-14T00:00:00Z",
      itemCount: items.length,
      items,
    };
  }

  it("keeps known items and drops an unknown-type sibling by id", () => {
    const known = makeCatalogSkill();
    const unknown = { ...makeCatalogSkill(), id: "connector:future/thing", type: "connector" };

    const { catalog, dropped, malformed } = parseMarketplaceCatalog(
      makeEnvelope([known, unknown]),
    );

    expect(malformed).toBe(false);
    expect(catalog).not.toBeNull();
    expect(catalog!.items).toHaveLength(1);
    expect(catalog!.items[0]?.id).toBe(known.id);
    // itemCount is recomputed to the survivor count (honest served count)
    expect(catalog!.itemCount).toBe(1);
    expect(dropped).toEqual(["connector:future/thing"]);
  });

  it("treats a non-object envelope as malformed (keep cache) — null catalog, no drops", () => {
    for (const bad of [null, undefined, 42, "nope", true]) {
      const r = parseMarketplaceCatalog(bad);
      expect(r.malformed).toBe(true);
      expect(r.catalog).toBeNull();
      expect(r.dropped).toEqual([]);
    }
  });

  it("treats a missing/non-array items field as malformed (keep cache)", () => {
    for (const bad of [{ schemaVersion: "1.0.0" }, { items: "not-an-array" }, { items: 5 }]) {
      const r = parseMarketplaceCatalog(bad);
      expect(r.malformed).toBe(true);
      expect(r.catalog).toBeNull();
    }
  });

  it("distinguishes a legitimately empty catalog from a malformed one", () => {
    const r = parseMarketplaceCatalog(makeEnvelope([]));
    expect(r.malformed).toBe(false);
    expect(r.catalog).not.toBeNull();
    expect(r.catalog!.items).toEqual([]);
    expect(r.catalog!.itemCount).toBe(0);
    expect(r.dropped).toEqual([]);
  });

  it("drops a malformed KNOWN-type item instead of accepting it", () => {
    // Valid `type: "skill"` but structurally broken (missing required `name`).
    const { name: _name, ...brokenKnown } = makeCatalogSkill();
    const { catalog, dropped, malformed } = parseMarketplaceCatalog(
      makeEnvelope([makeCatalogSkill(), brokenKnown]),
    );

    expect(malformed).toBe(false);
    expect(catalog!.items).toHaveLength(1);
    // dropped by its id, not silently accepted malformed
    expect(dropped).toEqual([brokenKnown.id]);
  });

  it("records an unidentifiable dropped item as <unidentified>", () => {
    const { catalog, dropped } = parseMarketplaceCatalog(
      makeEnvelope([makeCatalogSkill(), 12345, { type: "skill" /* no string id */ }]),
    );
    expect(catalog!.items).toHaveLength(1);
    expect(dropped).toEqual(["<unidentified>", "<unidentified>"]);
  });

  it("never throws for arbitrary input", () => {
    expect(() => parseMarketplaceCatalog(Symbol("x") as unknown)).not.toThrow();
    expect(() => parseMarketplaceCatalog({ items: [() => {}, NaN] })).not.toThrow();
  });
});

describe("isSchemaVersionSupported (FU-14 same-major loosening)", () => {
  it.each(["1.0.0", "1.1.0", "1.5.2", "1.99.99"])("accepts additive same-major %s", (v) => {
    expect(isSchemaVersionSupported(v)).toBe(true);
  });

  it.each(["2.0.0", "0.9.0", "99.0.0"])("rejects out-of-band major %s", (v) => {
    expect(isSchemaVersionSupported(v)).toBe(false);
  });

  it.each(["1.0", "1", "garbage", "", "v1.0.0", "1.0.0-beta"])(
    "rejects unparseable version %s",
    (v) => {
      expect(isSchemaVersionSupported(v)).toBe(false);
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
