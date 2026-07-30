import { describe, expect, it } from "vitest";
import { shouldBlockForMissingSnapshot } from "../postgres/snapshot-gate.js";

describe("shouldBlockForMissingSnapshot", () => {
  const base = {
    deploymentMode: "cloud_auth" as const,
    pendingMigrationTags: ["0188_organizations"],
    companyCount: 5,
    recordedSnapshots: [] as string[],
  };

  it("blocks cloud_auth + populated + 0188 pending + no snapshot", () => {
    expect(shouldBlockForMissingSnapshot(base)).toBe(true);
  });
  it("allows once the 0188 snapshot marker is recorded", () => {
    expect(shouldBlockForMissingSnapshot({ ...base, recordedSnapshots: ["0188"] })).toBe(false);
  });
  it("allows on empty companies table (nothing to lose)", () => {
    expect(shouldBlockForMissingSnapshot({ ...base, companyCount: 0 })).toBe(false);
  });
  it("no-ops for self-hosted deployment modes", () => {
    expect(shouldBlockForMissingSnapshot({ ...base, deploymentMode: "local_trusted" })).toBe(false);
    expect(shouldBlockForMissingSnapshot({ ...base, deploymentMode: "authenticated" })).toBe(false);
  });
  it("allows when 0188 is not pending (already applied)", () => {
    expect(shouldBlockForMissingSnapshot({ ...base, pendingMigrationTags: [] })).toBe(false);
  });
});
