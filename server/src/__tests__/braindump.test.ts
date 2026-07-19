/**
 * braindump.test.ts — WS6 braindump ingestion service.
 *
 * Mock strategy (mirrors crew-task-service.test.ts's createSequenceDb
 * pattern): drizzle-orm + @armyofagents/db mocked with Proxy stubs;
 * db.select/.insert/.update calls consume a single ordered queue matching
 * the exact call order the service under test makes. runAoaAgent is mocked
 * so no real adapter/CLI plumbing runs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _tag: "eq", a, b })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  gte: vi.fn((a: unknown, b: unknown) => ({ _tag: "gte", a, b })),
  desc: vi.fn((a: unknown) => ({ _tag: "desc", a })),
  // QA-BUG-3: deriveEffectiveStatus now uses inArray (was a raw `sql\`= ANY(...)\``
  // that generated invalid `= ANY(($1,$2,...))` and 500'd on real Postgres).
  inArray: vi.fn((a: unknown, b: unknown) => ({ _tag: "inArray", a, b })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _tag: "sql", strings, values })),
}));

vi.mock("@armyofagents/db", () => {
  const t = (n: string) => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return {
    agents: t("agents"),
    aoaAgentTriggers: t("aoaAgentTriggers"),
    braindumpCaptures: t("braindumpCaptures"),
    memoryItems: t("memoryItems"),
    projects: t("projects"),
  };
});

const runAoaAgentMock = vi.fn();
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({
  runAoaAgent: (...args: unknown[]) => runAoaAgentMock(...args),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}));

import { braindumpService } from "../services/braindump.js";

const CO_ID = "co-1";
const DEPT_ID = "dept-1";
const CAPTURE_ID = "capture-1";
const LIBRARIAN_ID = "librarian-1";

/** Ordered-queue DB mock. Each db.select()/.insert()/.update() call consumes
 *  the next entry. Update chains resolve via `.where()` directly (no
 *  `.returning()` call in the service's terminal-status writes) as well as
 *  via `.returning()` (the atomic claim). Both paths pull from the same
 *  queue slot. */
function createSequenceDb(queue: unknown[][]) {
  let idx = 0;
  const next = () => queue[idx++] ?? [];

  function selectChain() {
    const result = next();
    const chain: any = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(result)),
    };
    return chain;
  }

  function updateChain() {
    const result = next();
    const whereObj: any = {
      returning: vi.fn().mockResolvedValue(result),
      then: (fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(result)),
    };
    return {
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(whereObj) }),
    };
  }

  function insertChain() {
    const result = next();
    return {
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(result),
        }),
      }),
    };
  }

  return {
    select: vi.fn(() => selectChain()),
    update: vi.fn(() => updateChain()),
    insert: vi.fn(() => insertChain()),
  } as any;
}

const DEPT_ROW = { id: DEPT_ID, type: "department", name: "Engineering" };

describe("braindumpService.submit", () => {
  beforeEach(() => {
    runAoaAgentMock.mockReset();
  });

  it("happy path: new capture, dispatch succeeds -> status=proposed with correlated items", async () => {
    runAoaAgentMock.mockResolvedValue({ status: "succeeded", runId: "run-1" });

    const db = createSequenceDb([
      [DEPT_ROW],                                            // 1. select projects (validate dept)
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, idempotencyKey: "k1", status: "pending" }], // 2. insert braindumpCaptures
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID, content: "We ship on Fridays." }], // 3. update -> running (claim)
      [{ id: LIBRARIAN_ID }],                                 // 4. select agents join triggers (resolveLibrarianAgentId)
      [DEPT_ROW],                                             // 5. select projects (dept name for prompt)
      [{ id: "mem-1" }, { id: "mem-2" }],                      // 6. select memoryItems (correlate)
      [],                                                     // 7. update -> proposed
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: ["mem-1", "mem-2"], departmentId: DEPT_ID }], // 8. select latest
      [{ status: "pending" }, { status: "pending" }],          // 9. select memoryItems (deriveEffectiveStatus)
    ]);

    const svc = braindumpService(db);
    const result = await svc.submit(CO_ID, {
      departmentId: DEPT_ID,
      content: "We ship on Fridays.",
      idempotencyKey: "k1",
    });

    expect(result.status).toBe("proposed");
    expect(result.effectiveStatus).toBe("proposed");
    expect(result.proposedMemoryItemIds).toEqual(["mem-1", "mem-2"]);

    expect(runAoaAgentMock).toHaveBeenCalledTimes(1);
    const [, agentId, payload] = runAoaAgentMock.mock.calls[0]!;
    expect(agentId).toBe(LIBRARIAN_ID);
    expect(payload).toMatchObject({
      companyId: CO_ID,
      source: "braindump.ingest",
      role: "librarian",
      departmentId: DEPT_ID,
      departmentName: "Engineering",
      braindumpContent: "We ship on Fridays.",
    });
  });

  it("effectiveStatus becomes 'approved' once every proposed item is approved", async () => {
    const db = createSequenceDb([
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: ["mem-1"], departmentId: DEPT_ID }],
      [{ status: "approved" }],
    ]);
    const svc = braindumpService(db);
    const result = await svc.getById(CO_ID, CAPTURE_ID);
    expect(result?.effectiveStatus).toBe("approved");
  });

  it("rejects a departmentId that does not belong to the company", async () => {
    const db = createSequenceDb([
      [], // select projects -> not found
    ]);
    const svc = braindumpService(db);
    await expect(
      svc.submit(CO_ID, { departmentId: "nope", content: "x", idempotencyKey: "k1" }),
    ).rejects.toThrow(/departmentId not found/i);
    expect(runAoaAgentMock).not.toHaveBeenCalled();
  });

  it("idempotent resubmit: existing non-pending row is returned without re-dispatch", async () => {
    const db = createSequenceDb([
      [DEPT_ROW],                                    // 1. select projects
      [],                                             // 2. insert -> conflict (already exists)
      [{ id: CAPTURE_ID, status: "proposed", departmentId: DEPT_ID, idempotencyKey: "k1" }], // 3. select existing (conflict fallback)
      [],                                             // 4. update WHERE status IN (pending,failed) -> no rows (already proposed, not claimable)
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: [], departmentId: DEPT_ID }], // 5. select latest
    ]);
    const svc = braindumpService(db);
    const result = await svc.submit(CO_ID, { departmentId: DEPT_ID, content: "x", idempotencyKey: "k1" });

    expect(result.status).toBe("proposed");
    expect(runAoaAgentMock).not.toHaveBeenCalled();
  });

  it("Librarian not provisioned -> status=failed with actionable reason, no run attempted", async () => {
    const db = createSequenceDb([
      [DEPT_ROW],                                     // 1. select projects
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }], // 2. insert
      [{ id: CAPTURE_ID, status: "running" }],         // 3. update -> running (claim)
      [],                                              // 4. select agents (no librarian found)
      [],                                              // 5. update -> failed
      [{ id: CAPTURE_ID, status: "failed", failureReason: "The Librarian agent is not provisioned for this company yet.", proposedMemoryItemIds: [], departmentId: DEPT_ID }], // 6. select latest
    ]);
    const svc = braindumpService(db);
    const result = await svc.submit(CO_ID, { departmentId: DEPT_ID, content: "x", idempotencyKey: "k1" });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/not provisioned/i);
    expect(runAoaAgentMock).not.toHaveBeenCalled();
  });

  it("runAoaAgent reports failure -> status=failed with its errorMessage", async () => {
    runAoaAgentMock.mockResolvedValue({ status: "failed", errorMessage: "adapter exited 1", runId: "run-2" });
    const db = createSequenceDb([
      [DEPT_ROW],
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }],
      [{ id: CAPTURE_ID, status: "running" }],
      [{ id: LIBRARIAN_ID }],
      [DEPT_ROW],
      [], // update -> failed
      [{ id: CAPTURE_ID, status: "failed", failureReason: "adapter exited 1", proposedMemoryItemIds: [], departmentId: DEPT_ID }],
    ]);
    const svc = braindumpService(db);
    const result = await svc.submit(CO_ID, { departmentId: DEPT_ID, content: "x", idempotencyKey: "k1" });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("adapter exited 1");
  });

  it("runAoaAgent throws -> status=failed with the caught error message (never a silent hang)", async () => {
    runAoaAgentMock.mockRejectedValue(new Error("subprocess spawn ENOENT"));
    const db = createSequenceDb([
      [DEPT_ROW],
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }],
      [{ id: CAPTURE_ID, status: "running" }],
      [{ id: LIBRARIAN_ID }],
      [DEPT_ROW],
      [], // update -> failed (catch branch)
      [{ id: CAPTURE_ID, status: "failed", failureReason: "subprocess spawn ENOENT", proposedMemoryItemIds: [], departmentId: DEPT_ID }],
    ]);
    const svc = braindumpService(db);
    const result = await svc.submit(CO_ID, { departmentId: DEPT_ID, content: "x", idempotencyKey: "k1" });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("subprocess spawn ENOENT");
  });
});

describe("braindumpService.retry", () => {
  beforeEach(() => {
    runAoaAgentMock.mockReset();
  });

  it("throws notFound for an unknown capture id", async () => {
    const db = createSequenceDb([[]]);
    const svc = braindumpService(db);
    await expect(svc.retry(CO_ID, "nope")).rejects.toThrow(/not found/i);
  });

  it("re-dispatches a failed capture (atomic claim WHERE status IN pending,failed)", async () => {
    runAoaAgentMock.mockResolvedValue({ status: "succeeded", runId: "run-3" });
    const db = createSequenceDb([
      [{ id: CAPTURE_ID, status: "failed", departmentId: DEPT_ID }], // 1. select existing (found)
      [{ id: CAPTURE_ID, status: "running" }],                       // 2. update -> running (claim)
      [{ id: LIBRARIAN_ID }],                                        // 3. select agents
      [DEPT_ROW],                                                    // 4. select projects
      [],                                                            // 5. select memoryItems (correlate) -> none
      [],                                                            // 6. update -> proposed
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: [], departmentId: DEPT_ID }], // 7. select latest
    ]);
    const svc = braindumpService(db);
    const result = await svc.retry(CO_ID, CAPTURE_ID);

    expect(result.status).toBe("proposed");
    expect(runAoaAgentMock).toHaveBeenCalledTimes(1);
  });
});
