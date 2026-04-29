/**
 * Unit tests for buildTeamCoordinationSkillEntries (Slice 6, Task 6.1).
 *
 * The helper builds skill-shaped entries from team coordinations the assigned
 * agent belongs to. Returned entries are appended to context.skills so the
 * adapter materializes each as a markdown file in skillsDir alongside the
 * agent's normal skills — no adapter changes required.
 *
 * Tests verify only the pure-helper contract (DB shape -> RuntimeSkillEntry[]).
 * Defensive try/catch behavior is the CALLER's concern (heartbeat.ts:2574-2603)
 * and is verified separately by integration smoke; the helper itself SHOULD
 * propagate DB errors so the call site can warn-log.
 */

import { vi } from "vitest";

// ── Mocks required because heartbeat.ts has top-level DB + drizzle imports ──

vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "$inferSelect" || prop === "$inferInsert" ? {} : Symbol(String(prop)),
      },
    );
  return {
    agents: makeTable(),
    agentRuntimeState: makeTable(),
    agentTaskSessions: makeTable(),
    agentWakeupRequests: makeTable(),
    heartbeatRunEvents: makeTable(),
    heartbeatRuns: makeTable(),
    costEvents: makeTable(),
    issues: makeTable(),
    projectWorkspaces: makeTable(),
    memoryItems: makeTable(),
    companies: makeTable(),
    taskDependencies: makeTable(),
    issueAttachments: makeTable(),
    issueComments: makeTable(),
    assets: makeTable(),
    projects: makeTable(),
    companySkills: makeTable(),
    teamMembers: makeTable(),
    teamCoordinations: makeTable(),
    teams: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  asc: (..._args: unknown[]) => "asc",
  desc: (..._args: unknown[]) => "desc",
  eq: (..._args: unknown[]) => "eq",
  gt: (..._args: unknown[]) => "gt",
  inArray: (..._args: unknown[]) => "inArray",
  or: (..._args: unknown[]) => "or",
  sql: new Proxy(
    Object.assign(() => ({ as: () => "sql" }), { raw: () => ({ as: () => "sql" }) }),
    {
      get: (_t: unknown, prop: string | symbol) =>
        prop === "apply" ? () => ({ as: () => "sql" }) : () => ({ as: () => "sql" }),
      apply: () => ({ as: () => "sql" }),
    },
  ),
}));

vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));
vi.mock("../services/run-log-store.js", () => ({ getRunLogStore: vi.fn() }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
vi.mock("../adapters/index.js", () => ({
  getServerAdapter: vi.fn(),
  runningProcesses: new Map(),
}));
vi.mock("../agent-auth-jwt.js", () => ({ createLocalAgentJwt: vi.fn() }));
vi.mock("../adapters/utils.js", () => ({
  parseObject: vi.fn((v: unknown) => (v != null && typeof v === "object" ? v : {})),
  asBoolean: vi.fn(),
  asNumber: vi.fn(),
  appendWithCap: vi.fn(),
  MAX_EXCERPT_BYTES: 1024,
}));
vi.mock("../adapters/api-common.js", () => ({ setSecretResolver: vi.fn() }));
vi.mock("../services/secrets.js", () => ({ secretService: vi.fn(() => ({})) }));
vi.mock("../services/output-detection.js", () => ({
  outputDetectionService: vi.fn(() => ({})),
}));
vi.mock("../services/run-summary.js", () => ({ formatRunSummary: vi.fn() }));
vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, expect, it } from "vitest";
import { buildTeamCoordinationSkillEntries } from "../services/heartbeat.js";
import { createAgentDb } from "./helpers/mock-db.js";

// ────────────────────────────────────────────────────────────────────────────

describe("buildTeamCoordinationSkillEntries (Slice 6)", () => {
  it("returns 1 entry when enableTeams=true and agent on a team with published coord", async () => {
    const db = createAgentDb({
      selects: [
        [{ enableTeams: true }],                                                        // companies query
        [{ teamId: "t1" }],                                                             // memberships query
        [{ teamId: "t1", markdown: "# Team mission", trustLevel: "markdown_only" }],    // coords query
        [{ id: "t1", name: "Frontend Team" }],                                          // teams names query
      ],
    });

    const result = await buildTeamCoordinationSkillEntries(db as any, "c1", "a1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      key: "team-coord-t1",
      name: "Frontend Team Coordination",
      markdown: "# Team mission",
      trustLevel: "markdown_only",
    });
  });

  it("returns [] when enableTeams=false (feature flag gate)", async () => {
    const db = createAgentDb({
      selects: [
        [{ enableTeams: false }],  // companies query — flag off
        // No further queries should fire.
      ],
    });

    const result = await buildTeamCoordinationSkillEntries(db as any, "c1", "a1");

    expect(result).toEqual([]);
  });

  it("returns [] when enableTeams=true but agent has no team memberships", async () => {
    const db = createAgentDb({
      selects: [
        [{ enableTeams: true }],  // companies query
        [],                        // memberships query — none
      ],
    });

    const result = await buildTeamCoordinationSkillEntries(db as any, "c1", "a1");

    expect(result).toEqual([]);
  });

  it("returns 2 entries when agent is on 2 teams with 1 published coord each", async () => {
    const db = createAgentDb({
      selects: [
        [{ enableTeams: true }],                                  // companies query
        [{ teamId: "t1" }, { teamId: "t2" }],                     // memberships query
        [
          { teamId: "t1", markdown: "# T1 mission", trustLevel: "markdown_only" },
          { teamId: "t2", markdown: "# T2 mission", trustLevel: "markdown_only" },
        ],                                                         // coords query
        [
          { id: "t1", name: "Frontend Team" },
          { id: "t2", name: "Backend Team" },
        ],                                                         // teams names query
      ],
    });

    const result = await buildTeamCoordinationSkillEntries(db as any, "c1", "a1");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.key).sort()).toEqual([
      "team-coord-t1",
      "team-coord-t2",
    ]);
    const t1 = result.find((r) => r.key === "team-coord-t1");
    const t2 = result.find((r) => r.key === "team-coord-t2");
    expect(t1?.name).toBe("Frontend Team Coordination");
    expect(t2?.name).toBe("Backend Team Coordination");
    expect(t1?.markdown).toBe("# T1 mission");
    expect(t2?.markdown).toBe("# T2 mission");
    expect(t1?.trustLevel).toBe("markdown_only");
    expect(t2?.trustLevel).toBe("markdown_only");
  });

  it("excludes drafts (status='published' filter at DB layer): 2 memberships, only 1 published coord", async () => {
    // The DB query has a status='published' filter, so the coords query result
    // will only include the published rows. This test asserts the helper's
    // output reflects exactly what the DB returned — no in-memory filtering
    // shenanigans that could accidentally include drafts.
    const db = createAgentDb({
      selects: [
        [{ enableTeams: true }],                                                          // companies query
        [{ teamId: "t1" }, { teamId: "t2" }],                                             // memberships query
        [{ teamId: "t1", markdown: "# T1 published", trustLevel: "markdown_only" }],      // coords query — only t1 published; t2 is draft, filtered out at SQL layer
        [
          { id: "t1", name: "Frontend Team" },
          { id: "t2", name: "Backend Team" },
        ],                                                                                // teams names query
      ],
    });

    const result = await buildTeamCoordinationSkillEntries(db as any, "c1", "a1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      key: "team-coord-t1",
      name: "Frontend Team Coordination",
      markdown: "# T1 published",
      trustLevel: "markdown_only",
    });
  });

  it("preserves trustLevel from the DB column (pass-through, not hardcoded)", async () => {
    // Asserts the helper reads trustLevel from team_coordinations.trustLevel
    // rather than synthesizing a constant. If a future founder bumps a team
    // coord to "scripts_executables" (executable trust), that elevated trust
    // must flow through to the materialized skill entry.
    const db = createAgentDb({
      selects: [
        [{ enableTeams: true }],                                                                  // companies query
        [{ teamId: "t1" }],                                                                       // memberships query
        [{ teamId: "t1", markdown: "# Trusted scripts", trustLevel: "scripts_executables" }],     // coords query — elevated trust
        [{ id: "t1", name: "Ops Team" }],                                                         // teams names query
      ],
    });

    const result = await buildTeamCoordinationSkillEntries(db as any, "c1", "a1");

    expect(result).toHaveLength(1);
    expect(result[0]?.trustLevel).toBe("scripts_executables");
  });
});
