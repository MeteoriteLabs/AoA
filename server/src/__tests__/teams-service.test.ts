import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
  inArray: vi.fn((c: any, v: any) => ({ inArray: [c, v] })),
  sql: vi.fn(() => ({ sql: true })),
}));

vi.mock("@armyofagents/db", () => ({
  teams: {
    id: "teams_id",
    companyId: "teams_company_id",
    parentProjectId: "teams_parent_project_id",
    name: "teams_name",
    slug: "teams_slug",
    description: "teams_description",
    manifest: "teams_manifest",
    templateOrigin: "teams_template_origin",
    templateVersion: "teams_template_version",
    status: "teams_status",
    archivedAt: "teams_archived_at",
    createdAt: "teams_created_at",
    updatedAt: "teams_updated_at",
  },
  teamMembers: {
    id: "tm_id",
    teamId: "tm_team_id",
    agentId: "tm_agent_id",
    role: "tm_role",
    createdAt: "tm_created_at",
  },
  agentProjects: {
    agentId: "ap_agent_id",
    projectId: "ap_project_id",
  },
  projects: {
    id: "projects_id",
    companyId: "projects_company_id",
  },
}));

vi.mock("../errors.js", () => ({
  badRequest: (msg: string) => {
    const err = new Error(msg);
    (err as any).status = 400;
    return err;
  },
  notFound: (msg: string) => {
    const err = new Error(msg);
    (err as any).status = 404;
    return err;
  },
}));

import { teamsService } from "../services/teams.js";
import { createAgentDb } from "./helpers/mock-db.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("teamsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list()", () => {
    it("returns rows for company", async () => {
      const teamsRows = [
        { id: "t1", companyId: "co-1", name: "Frontend", slug: "frontend" },
        { id: "t2", companyId: "co-1", name: "Backend", slug: "backend" },
      ];
      const db = createAgentDb({ selects: [teamsRows] });

      const result = await teamsService(db as any).list("co-1");

      expect(result).toEqual(teamsRows);
    });

    it("filters by projectId", async () => {
      const teamsRows = [
        {
          id: "t1",
          companyId: "co-1",
          parentProjectId: "p1",
          name: "Frontend",
          slug: "frontend",
        },
      ];
      const db = createAgentDb({ selects: [teamsRows] });

      const result = await teamsService(db as any).list("co-1", "p1");

      expect(result).toEqual(teamsRows);
    });
  });

  describe("getById()", () => {
    it("returns the team", async () => {
      const team = { id: "t1", companyId: "co-1", name: "Frontend" };
      const db = createAgentDb({ selects: [[team]] });

      const result = await teamsService(db as any).getById("t1");

      expect(result).toEqual(team);
    });

    it("throws notFound when team missing", async () => {
      const db = createAgentDb({ selects: [[]] });

      await expect(teamsService(db as any).getById("missing")).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe("getBySlug()", () => {
    it("returns the team", async () => {
      const team = {
        id: "t1",
        companyId: "co-1",
        name: "Frontend",
        slug: "frontend",
      };
      const db = createAgentDb({ selects: [[team]] });

      const result = await teamsService(db as any).getBySlug("co-1", "frontend");

      expect(result).toEqual(team);
    });

    it("throws notFound when slug missing", async () => {
      const db = createAgentDb({ selects: [[]] });

      await expect(
        teamsService(db as any).getBySlug("co-1", "missing"),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("create()", () => {
    it("inserts team with derived slug from name", async () => {
      const inserted = {
        id: "t1",
        companyId: "co-1",
        parentProjectId: "p1",
        name: "Frontend Team",
        slug: "frontend-team",
        description: "Owns the UI",
        manifest: {},
      };
      const db = createAgentDb({
        selects: [
          [{ id: "p1" }], // P1: parent-project company check
          [], // existing slug query: empty (no collisions)
        ],
        inserts: [[inserted]],
      });

      const result = await teamsService(db as any).create("co-1", {
        name: "Frontend Team",
        parentProjectId: "p1",
        description: "Owns the UI",
      });

      expect(result).toEqual(inserted);
      expect(result.slug).toBe("frontend-team");
    });

    it("appends -2 when slug collides", async () => {
      const inserted = {
        id: "t2",
        companyId: "co-1",
        parentProjectId: "p1",
        name: "Frontend Team",
        slug: "frontend-team-2",
        manifest: {},
      };
      const db = createAgentDb({
        selects: [
          [{ id: "p1" }], // P1: parent-project company check
          [{ slug: "frontend-team" }], // existing slug: matches base
        ],
        inserts: [[inserted]],
      });

      const result = await teamsService(db as any).create("co-1", {
        name: "Frontend Team",
        parentProjectId: "p1",
      });

      expect(result.slug).toBe("frontend-team-2");
    });

    it("retries slug generation on PG 23505 collision", async () => {
      // Simulates a TOCTOU race: between our SELECT-existing-slugs probe and
      // the INSERT, a concurrent transaction wins the unique-slug lock. The
      // first INSERT throws 23505; the retry re-fetches (now sees the
      // colliding row) and picks a different suffix.
      //
      // The first SELECT in this sequence is the P1 parent-project company
      // check (always returns one row); subsequent SELECTs are the slug
      // probes inside the retry loop.
      //
      // P1-4: the team insert now runs inside `db.transaction(...)`, so the
      // mock provides a `transaction` field that delegates to the same proxy.
      let attempt = 0;
      let selectCalls = 0;
      const dbProxy: any = {
        select: () => ({
          from: () => ({
            where: () => {
              const callIdx = selectCalls++;
              if (callIdx === 0) {
                // P1: parent project lookup — always present.
                return Promise.resolve([{ id: "p1" }]);
              }
              const slugProbeIdx = callIdx - 1;
              const result =
                slugProbeIdx === 0
                  ? [] // first slug probe: no existing slugs yet
                  : [{ slug: "qa-team" }]; // second slug probe: collider visible
              return Promise.resolve(result);
            },
          }),
        }),
        insert: () => ({
          values: (vals: { slug: string }) => ({
            returning: () => {
              if (attempt === 0) {
                attempt++;
                const err = Object.assign(new Error("duplicate key"), {
                  code: "23505",
                });
                throw err;
              }
              return Promise.resolve([
                { id: "t1", slug: vals.slug, name: "QA Team" },
              ]);
            },
          }),
        }),
      };
      dbProxy.transaction = async (cb: (tx: any) => Promise<any>) => cb(dbProxy);

      const team = await teamsService(dbProxy).create("c1", {
        name: "QA Team",
        parentProjectId: "p1",
      });
      expect(team.slug).not.toBe("qa-team"); // collision → suffix added
      expect(attempt).toBe(1); // verified we retried exactly once
    });

    it("rejects when parentProjectId belongs to another company (P1)", async () => {
      // P1: cross-tenant guard. Caller specifies a project UUID that exists
      // in some company but NOT in `companyId`. The project-check returns
      // empty, so create() must throw badRequest before any insert runs.
      const db = createAgentDb({
        selects: [
          [], // P1: parent-project company check returns empty
        ],
      });

      await expect(
        teamsService(db as any).create("c1", {
          name: "Sneaky Team",
          parentProjectId: "from-other-company",
        }),
      ).rejects.toThrow(/parent project.*not found in company/);
    });

    it("inserts team + member rows atomically when members provided (P1-4)", async () => {
      // Sequence:
      //   1. select projects (P1 cross-tenant guard) → 1 row
      //   2. select agentProjects (dept-membership check for both members) → both present
      //   3. select existing slugs (slug collision check) → []
      //   4. tx.insert(teams).returning → [team]
      //   5. tx.insert(teamMembers) → [member1, member2] (single batched insert)
      const insertedTeam = {
        id: "team-1",
        companyId: "co-1",
        parentProjectId: "p1",
        name: "Frontend Team",
        slug: "frontend-team",
        manifest: {},
      };
      const db = createAgentDb({
        selects: [
          [{ id: "p1" }], // 1: P1 project check
          [{ agentId: "a1" }, { agentId: "a2" }], // 2: both agents in dept
          [], // 3: no slug collision
        ],
        inserts: [
          [insertedTeam], // 4: team insert
          [
            { id: "tm1", teamId: "team-1", agentId: "a1", role: "lead" },
            { id: "tm2", teamId: "team-1", agentId: "a2", role: "member" },
          ], // 5: team_members batched insert
        ],
      });

      const result = await teamsService(db as any).create("co-1", {
        name: "Frontend Team",
        parentProjectId: "p1",
        members: [
          { agentId: "a1", role: "lead" },
          { agentId: "a2", role: "member" },
        ],
      });

      expect(result).toEqual(insertedTeam);
    });

    it("rejects when a member is not in the parent department (P1-4)", async () => {
      // Sequence:
      //   1. select projects (P1) → 1 row
      //   2. select agentProjects (dept check) → only a1 present, a2 missing
      const db = createAgentDb({
        selects: [
          [{ id: "p1" }], // 1: P1 project check
          [{ agentId: "a1" }], // 2: only a1 is in dept (a2 missing)
        ],
      });

      await expect(
        teamsService(db as any).create("co-1", {
          name: "Frontend Team",
          parentProjectId: "p1",
          members: [
            { agentId: "a1", role: "lead" },
            { agentId: "a2", role: "member" },
          ],
        }),
      ).rejects.toThrow(/agents not in parent department.*a2/);
    });

    it("rejects when more than one lead is provided (P1-4)", async () => {
      // Sequence:
      //   1. select projects (P1) → 1 row
      //   2. select agentProjects → both present
      //   (slug probe + insert never run; lead-count check throws first)
      const db = createAgentDb({
        selects: [
          [{ id: "p1" }], // 1: P1 project check
          [{ agentId: "a1" }, { agentId: "a2" }], // 2: both in dept
        ],
      });

      await expect(
        teamsService(db as any).create("co-1", {
          name: "Frontend Team",
          parentProjectId: "p1",
          members: [
            { agentId: "a1", role: "lead" },
            { agentId: "a2", role: "lead" },
          ],
        }),
      ).rejects.toThrow(/at most one lead per team, got 2/);
    });
  });

  describe("update()", () => {
    it("returns updated team", async () => {
      const updated = {
        id: "t1",
        companyId: "co-1",
        name: "New Name",
        description: "Updated desc",
      };
      const db = createAgentDb({ updates: [[updated]] });

      const result = await teamsService(db as any).update("t1", {
        name: "New Name",
        description: "Updated desc",
      });

      expect(result).toEqual(updated);
    });

    it("throws notFound when team missing", async () => {
      const db = createAgentDb({ updates: [[]] });

      await expect(
        teamsService(db as any).update("missing", { name: "X" }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("archive()", () => {
    it("sets status archived and returns row", async () => {
      const archived = {
        id: "t1",
        companyId: "co-1",
        status: "archived",
        archivedAt: new Date(),
      };
      const db = createAgentDb({ updates: [[archived]] });

      const result = await teamsService(db as any).archive("t1");

      expect(result.status).toBe("archived");
    });

    it("throws notFound when team missing", async () => {
      const db = createAgentDb({ updates: [[]] });

      await expect(teamsService(db as any).archive("missing")).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe("listMembers()", () => {
    it("returns members for team", async () => {
      const members = [
        { id: "tm1", teamId: "t1", agentId: "a1", role: "lead" },
        { id: "tm2", teamId: "t1", agentId: "a2", role: "member" },
      ];
      const db = createAgentDb({ selects: [members] });

      const result = await teamsService(db as any).listMembers("t1");

      expect(result).toEqual(members);
    });
  });

  describe("addMember()", () => {
    it("rejects when agent is not in parent department", async () => {
      const db = createAgentDb({
        selects: [
          [{ id: "t1", parentProjectId: "p1" }], // team lookup
          [], // dept membership lookup: empty
        ],
      });

      await expect(
        teamsService(db as any).addMember("t1", "a1", "member"),
      ).rejects.toThrow(/parent department/i);
    });

    it("rejects when adding a second lead", async () => {
      const db = createAgentDb({
        selects: [
          [{ id: "t1", parentProjectId: "p1" }], // team lookup
          [{ agentId: "a1", projectId: "p1" }], // dept membership: present
          [{ id: "tm-existing", role: "lead", agentId: "a-other" }], // existing lead present
        ],
      });

      await expect(
        teamsService(db as any).addMember("t1", "a1", "lead"),
      ).rejects.toThrow(/already has a lead/i);
    });

    it("succeeds with valid lead", async () => {
      const inserted = {
        id: "tm-new",
        teamId: "t1",
        agentId: "a1",
        role: "lead",
      };
      const db = createAgentDb({
        selects: [
          [{ id: "t1", parentProjectId: "p1" }], // team lookup
          [{ agentId: "a1", projectId: "p1" }], // dept membership: present
          [], // no existing lead
        ],
        inserts: [[inserted]],
      });

      const result = await teamsService(db as any).addMember("t1", "a1", "lead");

      expect(result).toEqual(inserted);
    });

    it("succeeds with valid member", async () => {
      const inserted = {
        id: "tm-new",
        teamId: "t1",
        agentId: "a1",
        role: "member",
      };
      const db = createAgentDb({
        selects: [
          [{ id: "t1", parentProjectId: "p1" }], // team lookup
          [{ agentId: "a1", projectId: "p1" }], // dept membership: present
        ],
        inserts: [[inserted]],
      });

      const result = await teamsService(db as any).addMember(
        "t1",
        "a1",
        "member",
      );

      expect(result).toEqual(inserted);
    });

    it("throws notFound when team missing", async () => {
      const db = createAgentDb({
        selects: [[]], // team lookup: empty
      });

      await expect(
        teamsService(db as any).addMember("missing", "a1", "member"),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("removeMember()", () => {
    it("rejects when removing the last lead", async () => {
      const db = createAgentDb({
        selects: [
          [{ id: "tm1", teamId: "t1", agentId: "a1", role: "lead" }], // membership
          [{ id: "tm1", teamId: "t1", agentId: "a1", role: "lead" }], // single lead
        ],
      });

      await expect(
        teamsService(db as any).removeMember("t1", "a1"),
      ).rejects.toThrow(/only lead/i);
    });

    it("removes a regular member", async () => {
      const db = createAgentDb({
        selects: [
          [{ id: "tm2", teamId: "t1", agentId: "a2", role: "member" }], // membership
        ],
      });

      const result = await teamsService(db as any).removeMember("t1", "a2");

      expect(result).toEqual({ ok: true });
    });

    it("removes a non-last lead", async () => {
      const db = createAgentDb({
        selects: [
          [{ id: "tm1", teamId: "t1", agentId: "a1", role: "lead" }], // membership
          [
            { id: "tm1", teamId: "t1", agentId: "a1", role: "lead" },
            { id: "tm3", teamId: "t1", agentId: "a3", role: "lead" },
          ], // multiple leads
        ],
      });

      const result = await teamsService(db as any).removeMember("t1", "a1");

      expect(result).toEqual({ ok: true });
    });

    it("throws notFound when membership missing", async () => {
      const db = createAgentDb({
        selects: [[]], // membership: empty
      });

      await expect(
        teamsService(db as any).removeMember("t1", "a-missing"),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("updateMemberRole()", () => {
    it("promotes to lead and demotes existing lead transactionally", async () => {
      const updated = {
        id: "tm2",
        teamId: "t1",
        agentId: "a2",
        role: "lead",
      };
      const existingLead = [
        { id: "tm1", teamId: "t1", agentId: "a1", role: "lead" },
      ];
      const db = createAgentDb({
        selects: [existingLead], // existing lead lookup inside tx
        updates: [
          [{ id: "tm1", role: "member" }], // demote existing lead
          [updated], // promote target
        ],
      });

      const result = await teamsService(db as any).updateMemberRole(
        "t1",
        "a2",
        "lead",
      );

      expect(result).toEqual(updated);
    });

    it("demotes a lead to member without touching other leads", async () => {
      const updated = {
        id: "tm1",
        teamId: "t1",
        agentId: "a1",
        role: "member",
      };
      const db = createAgentDb({
        updates: [[updated]],
      });

      const result = await teamsService(db as any).updateMemberRole(
        "t1",
        "a1",
        "member",
      );

      expect(result).toEqual(updated);
    });

    it("throws notFound when membership missing", async () => {
      const db = createAgentDb({
        updates: [[]], // update returns no rows
      });

      await expect(
        teamsService(db as any).updateMemberRole("t1", "a-missing", "member"),
      ).rejects.toThrow(/not found/i);
    });
  });
});
