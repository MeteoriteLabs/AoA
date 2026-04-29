import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
  inArray: vi.fn((c: any, v: any) => ({ inArray: [c, v] })),
  sql: vi.fn(() => ({ sql: true })),
}));

vi.mock("@armyofagents/db", () => ({
  agents: {
    id: "agents_id",
    companyId: "agents_company_id",
    name: "agents_name",
  },
  companySkills: {
    id: "company_skills_id",
    companyId: "company_skills_company_id",
    key: "company_skills_key",
  },
  teams: {
    id: "teams_id",
    companyId: "teams_company_id",
    name: "teams_name",
    slug: "teams_slug",
  },
}));

import { teamImportService } from "../services/team-import.js";
import { createAgentDb } from "./helpers/mock-db.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_YAML = `
schemaVersion: 1
name: frontend-team
version: 1.0.0
agents:
  - name: alice
    role: lead
    skillKeys: [react]
routing:
  rules: []
skillDeps: ["@aoa/react@1.0.0"]
`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("teamImportService.preview()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed manifest + missing dependencies", async () => {
    // No existing agents, no installed skills.
    const db = createAgentDb({
      selects: [
        [], // agents collision lookup
        [], // companySkills lookup
      ],
    });

    const result = await teamImportService(db as any).preview(
      "co-1",
      VALID_YAML,
    );

    expect(result.manifest.name).toBe("frontend-team");
    expect(result.collisions).toEqual([]);
    expect(result.skillsToInstall).toContain("@aoa/react@1.0.0");
  });

  it("flags collision when an agent name already exists", async () => {
    const db = createAgentDb({
      selects: [
        [{ id: "a1", name: "alice" }], // existing agent collides
        [], // no skills installed
      ],
    });

    const result = await teamImportService(db as any).preview(
      "co-1",
      VALID_YAML,
    );

    expect(result.collisions).toContainEqual({
      kind: "agent",
      name: "alice",
      existingId: "a1",
    });
  });

  it("rejects malformed YAML", async () => {
    const db = createAgentDb({});

    await expect(
      teamImportService(db as any).preview("co-1", ":::not yaml:::"),
    ).rejects.toThrow();
  });

  it("does not list skills that are already installed", async () => {
    const db = createAgentDb({
      selects: [
        [], // no agent collisions
        [{ key: "@aoa/react@1.0.0" }], // skill already installed
      ],
    });

    const result = await teamImportService(db as any).preview(
      "co-1",
      VALID_YAML,
    );

    expect(result.skillsToInstall).toEqual([]);
  });
});
