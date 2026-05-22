import { describe, expect, it, vi } from "vitest";
import { seedAoaNativeSkills, AOA_NATIVE_SKILLS } from "../services/internal-agent/aoa-skills-seeder.js";

describe("seedAoaNativeSkills", () => {
  it("exports exactly 4 native skill definitions", () => {
    expect(AOA_NATIVE_SKILLS).toHaveLength(4);
  });

  it("each skill has required fields: key, name, description, markdown", () => {
    for (const skill of AOA_NATIVE_SKILLS) {
      expect(skill.key).toMatch(/^skill:aoa\//);
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.markdown).toBeTruthy();
    }
  });

  it("includes brainstorm, identity-setup, sprint-planning, team-design", () => {
    const keys = AOA_NATIVE_SKILLS.map((s) => s.key);
    expect(keys).toContain("skill:aoa/brainstorm");
    expect(keys).toContain("skill:aoa/identity-setup");
    expect(keys).toContain("skill:aoa/sprint-planning");
    expect(keys).toContain("skill:aoa/team-design");
  });

  it("calls db insert for each skill", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: () => Promise.resolve(),
      }),
    });
    const mockDb = { insert: insertSpy } as any;

    await seedAoaNativeSkills(mockDb, "company-123");

    expect(insertSpy).toHaveBeenCalledTimes(4);
  });
});
