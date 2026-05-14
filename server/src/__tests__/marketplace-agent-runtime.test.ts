import { describe, expect, it } from "vitest";
import type { CatalogItem } from "@armyofagents/shared";
import {
  deriveSiblingResourceUrl,
  normalizeMarketplaceAgentTemplate,
  parseMarketplaceAgentTemplate,
} from "../services/marketplace-install/agent-runtime.js";

const AGENT_ITEM: CatalogItem = {
  id: "agent:aoa-curated/senior-engineer",
  type: "agent",
  name: "Senior Engineer",
  description: "Senior engineering agent",
  version: "1.0.0",
  source: {
    adapter: "aoa-curated",
    url: "https://github.com/MeteoriteLabs/aoa-marketplace",
    locator: "content/agents/senior-engineer",
    commitSha: "abc123",
  },
  resourceUrl:
    "https://raw.githubusercontent.com/MeteoriteLabs/aoa-marketplace/abc123/content/agents/senior-engineer/agent.json",
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-05-14T00:00:00Z",
  category: "engineering",
  tags: ["official"],
  requires: [
    { type: "skill", id: "skill:github-skills/obra/superpowers/writing-plans" },
  ],
};

describe("marketplace agent runtime parser", () => {
  it("parses agent.v1 bundle instructions and AoA hints", () => {
    const parsed = parseMarketplaceAgentTemplate(
      JSON.stringify({
        schemaVersion: "agent.v1",
        id: "senior-engineer",
        name: "Senior Engineer",
        description: "Senior engineering agent",
        instructions: {
          type: "bundle",
          entry: "AGENTS.md",
          files: ["AGENTS.md", "SOUL.md", "TOOLS.md", "HEARTBEAT.md"],
        },
        dependencies: {
          skills: {
            writingPlans: "skill:github-skills/obra/superpowers/writing-plans",
          },
        },
        aoa: {
          adapterCompatibility: {
            recommended: "codex_local",
            supported: ["codex_local", "claude_local"],
            requiresInstructionsBundle: true,
            requiresSkillInjection: true,
          },
          install: {
            defaultRole: "lead",
            defaultStatus: "paused",
            defaultIcon: "code",
          },
          runtimeConfig: { heartbeat: { enabled: true, intervalSec: 0 } },
          permissions: { canCreateAgents: false },
          skillKeys: ["skill:github-skills/obra/superpowers/writing-plans"],
          setup: {
            notes: ["No external setup."],
          },
        },
      }),
      AGENT_ITEM,
    );

    expect(parsed.kind).toBe("agent.v1");
    if (parsed.kind === "agent.v1") {
      expect(parsed.runtime.instructions.type).toBe("bundle");
      expect(parsed.runtime.aoa?.install?.defaultRole).toBe("lead");
    }
  });

  it("normalizes unknown role and icon safely", () => {
    const parsed = parseMarketplaceAgentTemplate(
      JSON.stringify({
        schemaVersion: "agent.v1",
        id: "bad-hints",
        name: "Bad Hints",
        description: "Has invalid AoA hints",
        instructions: { type: "inline", content: "Hello." },
        aoa: {
          install: {
            defaultRole: "engineering",
            defaultStatus: "active",
            defaultIcon: "github",
          },
        },
      }),
      AGENT_ITEM,
    );

    const normalized = normalizeMarketplaceAgentTemplate({
      parsed,
      catalogItem: AGENT_ITEM,
      availableAdapterTypes: ["codex_local", "claude_local"],
    });

    expect(normalized.role).toBe("general");
    expect(normalized.icon).toBe("git-branch");
    expect(normalized.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unknown.*role/i),
        expect.stringMatching(/unsupported.*icon/i),
      ]),
    );
  });

  it("forces paused when required setup is incomplete", () => {
    const parsed = parseMarketplaceAgentTemplate(
      JSON.stringify({
        schemaVersion: "agent.v1",
        id: "github-issue-triager",
        name: "GitHub Issue Triager",
        description: "Triages GitHub issues",
        instructions: { type: "inline", content: "Triage issues." },
        aoa: {
          install: { defaultRole: "general", defaultStatus: "active", defaultIcon: "git-branch" },
          setup: {
            secrets: [
              {
                key: "GITHUB_TOKEN",
                label: "GitHub token",
                required: true,
                reason: "Required for GitHub API access.",
                usedBy: "plugin:aoa-curated/aoa-plugin-github-issues",
              },
            ],
            pluginConfig: [
              {
                plugin: "plugin:aoa-curated/aoa-plugin-github-issues",
                required: true,
                reason: "Repository must be configured.",
              },
            ],
          },
        },
      }),
      AGENT_ITEM,
    );

    const normalized = normalizeMarketplaceAgentTemplate({
      parsed,
      catalogItem: AGENT_ITEM,
      availableAdapterTypes: ["codex_local"],
    });

    expect(normalized.status).toBe("paused");
    expect(normalized.setupRequired).toBe(true);
    expect(normalized.metadata.marketplaceSetupRequired).toBe(true);
  });

  it("derives sibling bundle URLs from agent.json resourceUrl", () => {
    expect(deriveSiblingResourceUrl(AGENT_ITEM, "AGENTS.md")).toBe(
      "https://raw.githubusercontent.com/MeteoriteLabs/aoa-marketplace/abc123/content/agents/senior-engineer/AGENTS.md",
    );
  });

  it("rejects unsafe sibling bundle paths", () => {
    expect(() => deriveSiblingResourceUrl(AGENT_ITEM, "../AGENTS.md")).toThrow(/unsafe/i);
    expect(() => deriveSiblingResourceUrl(AGENT_ITEM, "/AGENTS.md")).toThrow(/unsafe/i);
    expect(() => deriveSiblingResourceUrl(AGENT_ITEM, "docs//AGENTS.md")).toThrow(/unsafe/i);
  });
});
