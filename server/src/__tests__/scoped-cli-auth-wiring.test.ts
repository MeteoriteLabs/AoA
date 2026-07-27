import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scoped CLI authentication wiring", () => {
  it("does not discard the governed credential environment when applying mentioned skills", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../services/heartbeat.ts"),
      "utf8",
    );

    expect(source).toContain(
      "runScopedConfig = applyRunScopedMentionedSkillKeys(runScopedConfig, mentionedSkillKeys);",
    );
    expect(source).not.toContain(
      "runScopedConfig = applyRunScopedMentionedSkillKeys(resolvedConfigWithEnvironmentAcquisition, mentionedSkillKeys);",
    );
  });
});
