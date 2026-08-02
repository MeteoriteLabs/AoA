import { describe, expect, it } from "vitest";
import {
  isUndefinedTableError,
  readCompanyCountForSnapshotGate,
  shouldBlockForMissingSnapshot,
} from "../postgres/snapshot-gate.js";

describe("migration snapshot gate company-count query", () => {
  it.each([
    ["direct", Object.assign(new Error("missing"), { code: "42P01" })],
    ["wrapped", { cause: Object.assign(new Error("missing"), { code: "42P01" }) }],
    ["nested", { cause: { cause: { code: "42P01" } } }],
  ])("recognizes %s undefined-table errors", (_label, error) => {
    expect(isUndefinedTableError(error)).toBe(true);
  });

  it.each(["42501", "08006", "57014"])("does not classify SQLSTATE %s as a fresh schema", (code) => {
    expect(isUndefinedTableError({ code })).toBe(false);
  });

  it("handles cyclic causes without hanging or misclassifying", () => {
    const error: { code: string; cause?: unknown } = { code: "08006" };
    error.cause = error;
    expect(isUndefinedTableError(error)).toBe(false);
  });

  it("returns zero only when the companies table is genuinely absent", async () => {
    const missing = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    await expect(readCompanyCountForSnapshotGate(async () => Promise.reject(missing))).resolves.toBe(0);
  });

  it.each(["42501", "08006", "57014"])("rethrows SQLSTATE %s instead of bypassing the gate", async (code) => {
    const error = Object.assign(new Error(`database error ${code}`), { code });
    await expect(readCompanyCountForSnapshotGate(async () => Promise.reject(error))).rejects.toBe(error);
  });

  it("reads populated counts from direct and driver-wrapped row shapes", async () => {
    await expect(readCompanyCountForSnapshotGate(async () => [{ count: 5 }])).resolves.toBe(5);
    await expect(readCompanyCountForSnapshotGate(async () => ({ rows: [{ count: "7" }] }))).resolves.toBe(7);
  });

  it.each([
    undefined,
    [],
    { rows: [] },
    { rows: [{ count: null }] },
    { rows: [{ count: "" }] },
    { rows: [{ count: false }] },
    { rows: [{ count: "not-a-number" }] },
  ])(
    "rejects malformed count result %# instead of treating it as empty",
    async (result) => {
      await expect(readCompanyCountForSnapshotGate(async () => result)).rejects.toThrow(
        "Could not read a valid companies count",
      );
    },
  );
});

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
