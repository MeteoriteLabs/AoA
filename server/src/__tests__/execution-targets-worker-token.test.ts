import { describe, expect, it, vi } from "vitest";

// Value-carrying drizzle mock so the fake DB can honour the hash predicate.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
}));
vi.mock("@armyofagents/db", () => {
  const table = new Proxy({}, { get: (_t, p) => (typeof p === "string" ? p : undefined) });
  return { executionTargets: table };
});

import {
  createWorkerToken,
  hashWorkerToken,
  resolveWorkerTargetId,
  stripWorkerSecret,
} from "../services/execution-targets.js";

// select({id}).from().where({op:"eq",col:"workerTokenHash",val}) → matching ids.
function makeFakeDb(rows: Array<{ id: string; workerTokenHash: string | null }>) {
  return {
    select: () => ({
      from: () => ({
        where: (clause: any) =>
          Promise.resolve(
            rows
              .filter((r) => clause.op === "eq" && (r as any)[clause.col] === clause.val)
              .map((r) => ({ id: r.id })),
          ),
      }),
    }),
  } as any;
}

describe("worker-token helpers (Finding #3 — the row id is no longer the credential)", () => {
  it("createWorkerToken is prefixed + high-entropy; hashWorkerToken is deterministic and not the token", () => {
    const a = createWorkerToken();
    const b = createWorkerToken();
    expect(a).toMatch(/^aoa_wtk_[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
    expect(hashWorkerToken(a)).toBe(hashWorkerToken(a));
    expect(hashWorkerToken(a)).not.toBe(a);
  });

  it("resolveWorkerTargetId returns the id for the matching token hash", async () => {
    const token = createWorkerToken();
    const db = makeFakeDb([{ id: "t-1", workerTokenHash: hashWorkerToken(token) }]);
    expect(await resolveWorkerTargetId(db, token)).toBe("t-1");
  });

  it("the raw target-id UUID no longer authorizes (its hash matches no row)", async () => {
    const token = createWorkerToken();
    const db = makeFakeDb([{ id: "t-1", workerTokenHash: hashWorkerToken(token) }]);
    expect(await resolveWorkerTargetId(db, "t-1")).toBeNull();
  });

  it("empty / unknown tokens resolve to null (fail closed)", async () => {
    const db = makeFakeDb([{ id: "t-1", workerTokenHash: hashWorkerToken("real") }]);
    expect(await resolveWorkerTargetId(db, "")).toBeNull();
    expect(await resolveWorkerTargetId(db, "   ")).toBeNull();
    expect(await resolveWorkerTargetId(db, "not-a-real-token")).toBeNull();
  });

  it("stripWorkerSecret removes only the hash, keeping the FK id", () => {
    const safe = stripWorkerSecret({ id: "t-1", organizationId: "org-A", workerTokenHash: "deadbeef" });
    expect(safe).toEqual({ id: "t-1", organizationId: "org-A" });
    expect("workerTokenHash" in safe).toBe(false);
  });
});
