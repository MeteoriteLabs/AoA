import { describe, expect, it } from "vitest";
import { jobActorTypeForPrincipalKind } from "../services/job-control-audit.js";
import { actorTypeForPrincipalKind } from "../services/worker-admission-denial-audit.js";

// E9-F010 — job-control-audit.ts duplicates the principal-kind -> ActivityActorType mapping so
// job-submission.ts can stay logger-free in its static graph. This pins the duplicate EQUAL to the
// canonical actorTypeForPrincipalKind so the two can never silently drift (records-vs-code SHAPE #6).
describe("job-control-audit actor mapper parity (E9-F010)", () => {
  it("matches the canonical actorTypeForPrincipalKind for every principal kind", () => {
    for (const kind of [
      "agent",
      "user",
      "commander",
      "local_board",
      "mcp",
      "system",
      "some-future-kind",
    ]) {
      expect(jobActorTypeForPrincipalKind(kind)).toBe(actorTypeForPrincipalKind(kind));
    }
  });
});
