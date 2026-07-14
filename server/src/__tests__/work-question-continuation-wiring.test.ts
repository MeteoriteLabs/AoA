import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("work-question continuation scheduler wiring", () => {
  const source = readFileSync(resolve(__dirname, "../index.ts"), "utf8");

  it("prevents overlapping continuation ticks within one server process", () => {
    expect(source).toContain("workQuestionContinuationTickInFlight");
    expect(source).toMatch(/if \(!workQuestionContinuationTickInFlight\)/);
    expect(source).toContain("workQuestionContinuationTickInFlight = true");
    expect(source).toContain("workQuestionContinuationTickInFlight = false");
    expect(source).toContain("workQuestionContinuations\n        .processDue(now)");
  });
});
