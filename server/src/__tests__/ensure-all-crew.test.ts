// server/src/__tests__/ensure-all-crew.test.ts
//
// P8d split: `ensureInfrastructureAgents` (Commander + Steward — always seeded)
// vs `ensureCrewAgents` (the marketplace-owned roster — gated by the caller on
// isCrewMarketplaceManaged). `ensureAllCrewAgents` is the ungated union kept for
// the T2.3 legacy-fallback path.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({ ensureCommanderAgent: vi.fn(async () => { calls.push("commander"); return "c"; }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-command-staff.js", () => ({ ensureCommandStaff: vi.fn(async () => { calls.push("staff"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-adjutant.js", () => ({ ensureAdjutant: vi.fn(async () => { calls.push("adjutant"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-scout.js", () => ({ ensureScout: vi.fn(async () => { calls.push("scout"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-engineer.js", () => ({ ensureEngineer: vi.fn(async () => { calls.push("engineer"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-chronicler.js", () => ({ ensureChronicler: vi.fn(async () => { calls.push("chronicler"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-steward.js", () => ({ ensureSteward: vi.fn(async () => { calls.push("steward"); return "s"; }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-librarian.js", () => ({ ensureLibrarian: vi.fn(async () => { calls.push("librarian"); }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

import {
  ensureAllCrewAgents,
  ensureCrewAgents,
  ensureInfrastructureAgents,
} from "../services/internal-agent/aoa-agents/ensure-all-crew.js";

const INFRA = ["commander", "steward"];
const CREW = ["adjutant", "chronicler", "engineer", "librarian", "scout", "staff"];

describe("crew seeding split (P8d)", () => {
  beforeEach(() => { calls.length = 0; });

  it("ensureInfrastructureAgents runs ONLY Commander + Steward", async () => {
    await ensureInfrastructureAgents({} as any, "co-1");
    expect(calls.slice().sort()).toEqual(INFRA);
  });

  it("ensureCrewAgents runs ONLY the marketplace-owned roster (no Commander, no Steward)", async () => {
    await ensureCrewAgents({} as any, "co-1");
    expect(calls.slice().sort()).toEqual(CREW);
  });

  it("ensureAllCrewAgents runs all eight, infrastructure first", async () => {
    await ensureAllCrewAgents({} as any, "co-1");
    expect(calls.slice().sort()).toEqual([...CREW, ...INFRA].sort());
    // Commander must land before any crew seeder: it is the row
    // internal_agent_config.agentId points at.
    expect(calls[0]).toBe("commander");
    expect(calls.indexOf("steward")).toBeLessThan(calls.indexOf("staff"));
  });

  it("one failing crew ensure does not abort the rest of the crew", async () => {
    const mod = await import("../services/internal-agent/aoa-agents/ensure-scout.js");
    (mod.ensureScout as any).mockRejectedValueOnce(new Error("boom"));
    await ensureCrewAgents({} as any, "co-1");
    expect(calls.slice().sort()).toEqual(CREW.filter((c) => c !== "scout"));
    expect(calls.length).toBe(5);
  });

  it("a failing INFRASTRUCTURE ensure does not prevent the crew seeders", async () => {
    const mod = await import("../services/internal-agent/aoa-agents/ensure-commander.js");
    (mod.ensureCommanderAgent as any).mockRejectedValueOnce(new Error("boom"));
    await ensureAllCrewAgents({} as any, "co-1");
    expect(calls).toContain("steward");
    expect(calls.slice().sort()).toEqual([...CREW, "steward"].sort());
    expect(calls.length).toBe(7);
  });

  it("a failing CREW ensure does not prevent the infrastructure seeders", async () => {
    const staff = await import("../services/internal-agent/aoa-agents/ensure-command-staff.js");
    (staff.ensureCommandStaff as any).mockRejectedValueOnce(new Error("boom"));
    await ensureAllCrewAgents({} as any, "co-1");
    expect(calls).toContain("commander");
    expect(calls).toContain("steward");
    expect(calls.length).toBe(7);
  });
});
