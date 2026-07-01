// server/src/__tests__/ensure-all-crew.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({ ensureCommanderAgent: vi.fn(async () => { calls.push("commander"); return "c"; }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-command-staff.js", () => ({ ensureCommandStaff: vi.fn(async () => { calls.push("staff"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-adjutant.js", () => ({ ensureAdjutant: vi.fn(async () => { calls.push("adjutant"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-scout.js", () => ({ ensureScout: vi.fn(async () => { calls.push("scout"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-engineer.js", () => ({ ensureEngineer: vi.fn(async () => { calls.push("engineer"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-chronicler.js", () => ({ ensureChronicler: vi.fn(async () => { calls.push("chronicler"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-steward.js", () => ({ ensureSteward: vi.fn(async () => { calls.push("steward"); }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

import { ensureAllCrewAgents } from "../services/internal-agent/aoa-agents/ensure-all-crew.js";

describe("ensureAllCrewAgents", () => {
  beforeEach(() => { calls.length = 0; });

  it("runs all seven crew ensures", async () => {
    await ensureAllCrewAgents({} as any, "co-1");
    expect(calls.sort()).toEqual(["adjutant", "chronicler", "commander", "engineer", "scout", "staff", "steward"]);
  });

  it("one failing ensure does not abort the rest", async () => {
    const mod = await import("../services/internal-agent/aoa-agents/ensure-scout.js");
    (mod.ensureScout as any).mockRejectedValueOnce(new Error("boom"));
    await ensureAllCrewAgents({} as any, "co-1");
    // scout threw, but the other six still ran
    expect(calls).toContain("commander");
    expect(calls).toContain("engineer");
    expect(calls.length).toBe(6);
  });
});
