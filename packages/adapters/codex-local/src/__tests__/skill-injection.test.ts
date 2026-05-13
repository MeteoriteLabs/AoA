import { describe, expect, it, vi } from "vitest";
import { linkOrCopyCodexSkill } from "../server/execute.js";

describe("codex skill injection", () => {
  it("copies a skill directory when symlink creation is denied", async () => {
    const logs: string[] = [];
    const linkSkill = vi.fn().mockRejectedValue(new Error("EPERM: operation not permitted"));
    const copySkill = vi.fn().mockResolvedValue(undefined);

    await linkOrCopyCodexSkill({
      source: "C:/repo/skills/aoa",
      target: "C:/Users/TK/.codex/skills/aoa",
      entryName: "aoa",
      skillsHome: "C:/Users/TK/.codex/skills",
      onLog: async (_stream, message) => {
        logs.push(message);
      },
      linkSkill,
      copySkill,
    });

    expect(linkSkill).toHaveBeenCalledWith(
      "C:/repo/skills/aoa",
      "C:/Users/TK/.codex/skills/aoa",
      expect.anything(),
    );
    expect(copySkill).toHaveBeenCalledWith(
      "C:/repo/skills/aoa",
      "C:/Users/TK/.codex/skills/aoa",
      { recursive: true },
    );
    expect(logs.join("\n")).toContain("Copied Codex skill \"aoa\"");
  });
});
