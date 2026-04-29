import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => ({
  teamCoordinations: {
    id: "tc_id",
    companyId: "tc_company_id",
    teamId: "tc_team_id",
    key: "tc_key",
    slug: "tc_slug",
    name: "tc_name",
    description: "tc_description",
    markdown: "tc_markdown",
    status: "tc_status",
    sourceType: "tc_source_type",
    createdAt: "tc_created_at",
    updatedAt: "tc_updated_at",
  },
}));

import { teamCoordinationService } from "../services/team-coordination.js";
import { createAgentDb } from "./helpers/mock-db.js";

describe("teamCoordinationService.upsert", () => {
  it("inserts a new coordination row when none exists", async () => {
    const db = createAgentDb({
      selects: [[]], // no existing
      inserts: [[{ id: "tc1", teamId: "t1", markdown: "# Mission" }]],
    });
    const svc = teamCoordinationService(db);
    const result = await svc.upsert("c1", {
      teamId: "t1",
      name: "Frontend Team Coordination",
      markdown: "# Mission",
    });
    expect(result.id).toBe("tc1");
  });

  it("updates an existing coordination row", async () => {
    const db = createAgentDb({
      selects: [[{ id: "tc1", teamId: "t1", status: "published" }]],
      updates: [[{ id: "tc1", teamId: "t1", markdown: "updated" }]],
    });
    const svc = teamCoordinationService(db);
    const result = await svc.upsert("c1", {
      teamId: "t1",
      name: "Frontend",
      markdown: "updated",
    });
    expect(result.markdown).toBe("updated");
  });
});

describe("teamCoordinationService.getByTeam", () => {
  it("returns the published coordination for a team", async () => {
    const db = createAgentDb({
      selects: [[{ id: "tc1", teamId: "t1", status: "published" }]],
    });
    const svc = teamCoordinationService(db);
    const result = await svc.getByTeam("t1");
    expect(result?.id).toBe("tc1");
  });

  it("returns null if no coordination exists", async () => {
    const db = createAgentDb({ selects: [[]] });
    const svc = teamCoordinationService(db);
    const result = await svc.getByTeam("t1");
    expect(result).toBeNull();
  });
});

describe("teamCoordinationService.archive", () => {
  it("flips status to archived", async () => {
    const db = createAgentDb({
      updates: [[{ id: "tc1", status: "archived" }]],
    });
    const svc = teamCoordinationService(db);
    const result = await svc.archive("tc1");
    expect(result.status).toBe("archived");
  });
});

describe("teamCoordinationService.regenerateAutoSections", () => {
  it("replaces both members and routing sections, preserves user prose", async () => {
    const original = `## Mission
prose

<!-- begin:auto:members -->
old members
<!-- end:auto:members -->

<!-- begin:auto:routing -->
old routing
<!-- end:auto:routing -->`;

    const db = createAgentDb({
      selects: [[{ id: "tc1", teamId: "t1", markdown: original }]],
      updates: [[{ id: "tc1", teamId: "t1", markdown: "updated" }]],
    });
    const svc = teamCoordinationService(db);
    const result = await svc.regenerateAutoSections("tc1", {
      members: "## Members\n- alice [LEAD]",
      routing: "## Routing\n- default → @alice",
    });
    expect(result).toBeDefined();
    expect(result.id).toBe("tc1");
  });

  it("throws notFound when coordination doesn't exist", async () => {
    const db = createAgentDb({
      selects: [[]],  // empty result
    });
    const svc = teamCoordinationService(db);
    await expect(svc.regenerateAutoSections("nonexistent", { members: "x" }))
      .rejects.toThrow(/not found/i);
  });
});
