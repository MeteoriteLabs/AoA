import { describe, it, expect } from "vitest";
import { buildAoaRunResultFromAdapter } from "../aoa-run-result.js";

describe("buildAoaRunResultFromAdapter — loud transport-failure", () => {
  it("marks the run FAILED when raw stdout shows Transport closed even on exit 0 + null errorMessage (the bug)", () => {
    const r = buildAoaRunResultFromAdapter(
      { exitCode: 0, errorMessage: null, resultJson: { stdout: '{"type":"error","error":"Transport closed"}', stderr: "" } },
      { mcpAttempted: true, markerSupported: true },
    );
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toMatch(/transport failed/i);
  });
  it("does NOT false-positive on a clean run (no marker, exit 0)", () => {
    const r = buildAoaRunResultFromAdapter(
      { exitCode: 0, errorMessage: null, resultJson: { stdout: '{"type":"item.completed"}', stderr: "" } },
      { mcpAttempted: true, markerSupported: true },
    );
    expect(r.status).toBe("succeeded");
  });
  it("does NOT mark gemini failed when there is no marker (unknown is not failed)", () => {
    const r = buildAoaRunResultFromAdapter(
      { exitCode: 0, errorMessage: null, resultJson: { stdout: "all good", stderr: "" } },
      { mcpAttempted: true, markerSupported: false },
    );
    expect(r.status).toBe("succeeded");
  });
  it("still fails normally on a non-zero exit (unchanged behavior)", () => {
    const r = buildAoaRunResultFromAdapter({ exitCode: 1, errorMessage: "boom" });
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toBe("boom");
  });
});
