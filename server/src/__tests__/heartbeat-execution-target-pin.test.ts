// Round-7 finding: the heartbeat run-scope wrapped resolveExecutionTargetForRun
// in `.catch(() => null)`, swallowing the throw even when the run carried an
// EXPLICIT execution-target pin (environmentRuntime.executionTargetId != null).
// A swallowed pin error silently fell back to the local host — Decision #117 §4
// requires an explicit pin to fail closed. This pure-helper test pins the
// contract: throw when pinned, null (local fallback) when unpinned.
import { describe, expect, it } from "vitest";
import { handleExecutionTargetRoutingError } from "../services/heartbeat-execution-target.js";

describe("handleExecutionTargetRoutingError — explicit pin fails closed (Decision #117 §4)", () => {
  it("re-throws when an explicit execution-target pin is unavailable", () => {
    const err = new Error("pinned execution target unavailable");
    expect(() => handleExecutionTargetRoutingError(err, { hasExplicitPin: true })).toThrow(err);
  });

  it("returns null (local fallback) for an unpinned route-by-credential run", () => {
    const err = new Error("transient routing error");
    expect(handleExecutionTargetRoutingError(err, { hasExplicitPin: false })).toBeNull();
  });
});
