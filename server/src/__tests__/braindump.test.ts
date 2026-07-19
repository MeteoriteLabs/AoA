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
  isNull: vi.fn((a: unknown) => ({ _tag: "isNull", a })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _tag: "sql", strings, values })),
}));

vi.mock("@armyofagents/db", () => {
  const t = (n: string) => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return {
    agents: t("agents"),
    aoaAgentTriggers: t("aoaAgentTriggers"),
    braindumpCaptures: t("braindumpCaptures"),
    memoryAssets: t("memoryAssets"),
    memoryFolders: t("memoryFolders"),
    memoryItems: t("memoryItems"),
    projects: t("projects"),
  };
});

// Phase 5c: dispatch now reads attached files out of storage and extracts
// their text. Both are stubbed — the default `extractTextFromBuffer` mock is
// per-test, and `getStorageService` never touches a real backend here.
const getObjectMock = vi.fn();
vi.mock("../storage/index.js", () => ({
  getStorageService: () => ({ getObject: (...args: unknown[]) => getObjectMock(...args) }),
}));

const extractTextFromBufferMock = vi.fn();
vi.mock("../services/file-import.js", () => ({
  SUPPORTED_MIME_TYPES: ["application/pdf", "text/plain", "text/markdown"],
  extractTextFromBuffer: (...args: unknown[]) => extractTextFromBufferMock(...args),
}));

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
      [{ path: "engineering/Decisions" }],                    // 6. select memoryFolders (allowed folders)
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

  it("company-wide capture: no department lookups, dispatches with a null departmentId", async () => {
    runAoaAgentMock.mockResolvedValue({ status: "succeeded", runId: "run-9" });

    // NOTE the shorter queue than the department path: BOTH `select projects`
    // calls (validate + prompt dept name) are skipped for company scope.
    const db = createSequenceDb([
      [{ id: CAPTURE_ID, departmentId: null, scope: "company", idempotencyKey: "k1", status: "pending" }], // 1. insert
      [{ id: CAPTURE_ID, status: "running", departmentId: null, content: "We value candor." }],            // 2. claim
      [{ id: LIBRARIAN_ID }],                                                                              // 3. resolveLibrarianAgentId
      [{ path: "Company/Decisions" }],                                                                     // 4. select memoryFolders (company scope)
      [{ id: "mem-9" }],                                                                                   // 4. correlate (IS NULL dept)
      [],                                                                                                  // 5. update -> proposed
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: ["mem-9"], departmentId: null }],       // 6. select latest
      [{ status: "pending" }],                                                                             // 7. deriveEffectiveStatus
    ]);

    const svc = braindumpService(db);
    const result = await svc.submit(CO_ID, {
      scope: "company",
      departmentId: null,
      content: "We value candor.",
      idempotencyKey: "k1",
    });

    expect(result.status).toBe("proposed");
    expect(result.proposedMemoryItemIds).toEqual(["mem-9"]);
    // 5 selects (librarian, folders, correlate, latest, derive) — no projects lookups.
    expect(db.select).toHaveBeenCalledTimes(5);
    const [, , payload] = runAoaAgentMock.mock.calls[0]!;
    expect(payload).toMatchObject({ companyId: CO_ID, source: "braindump.ingest", role: "librarian" });
    expect((payload as { departmentId: string | null }).departmentId).toBeNull();
    // Company scope seeds IDENTITY-layer memory; department scope seeds domain.
    expect((payload as { memoryLayer: string }).memoryLayer).toBe("identity");
    expect((payload as { allowedFolders: string[] }).allowedFolders).toEqual(["Company/Decisions"]);
  });

  // ---------------------------------------------------------------------
  // Phase 5c — what the Librarian actually receives.
  // ---------------------------------------------------------------------

  it("sends layer=domain plus the department's folder list for a department capture", async () => {
    runAoaAgentMock.mockResolvedValue({ status: "succeeded", runId: "run-5c" });
    const db = createSequenceDb([
      [DEPT_ROW],                                                    // 1. validate dept
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }], // 2. insert
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID, content: "x", assetIds: [] }], // 3. claim
      [{ id: LIBRARIAN_ID }],                                        // 4. librarian
      [DEPT_ROW],                                                    // 5. dept name
      [{ path: "engineering/Architecture" }, { path: "engineering/Decisions" }], // 6. folders
      [],                                                            // 7. correlate
      [],                                                            // 8. update -> proposed
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: [], departmentId: DEPT_ID }], // 9. latest
    ]);
    await braindumpService(db).submit(CO_ID, {
      departmentId: DEPT_ID,
      content: "x",
      idempotencyKey: "k1",
    });

    const [, , payload] = runAoaAgentMock.mock.calls[0]! as [unknown, unknown, Record<string, unknown>];
    expect(payload.memoryLayer).toBe("domain");
    expect(payload.allowedFolders).toEqual(["engineering/Architecture", "engineering/Decisions"]);
    expect(payload.attachedFiles).toEqual([]);
  });

  it("extracts text from a readable attached file and names an unreadable one", async () => {
    runAoaAgentMock.mockResolvedValue({ status: "succeeded", runId: "run-file" });
    getObjectMock.mockResolvedValue({ stream: [Buffer.from("notes")], contentLength: 5 });
    extractTextFromBufferMock.mockResolvedValue({ text: "  Runway is 14 months.  ", warnings: [] });

    const db = createSequenceDb([
      [DEPT_ROW],
      [{ id: "a-1" }, { id: "a-2" }],                                // asset ownership check (submit)
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }],
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID, content: "", assetIds: ["a-1", "a-2"] }],
      [{ id: LIBRARIAN_ID }],
      [DEPT_ROW],
      [{ path: "engineering/Files" }],                                // folders
      [                                                              // memoryAssets
        { fileName: "notes.md", mimeType: "text/markdown", storageKey: "k/1" },
        { fileName: "logo.png", mimeType: "image/png", storageKey: "k/2" },
      ],
      [],
      [],
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: [], departmentId: DEPT_ID }],
    ]);
    await braindumpService(db).submit(CO_ID, {
      departmentId: DEPT_ID,
      content: "",
      assetIds: ["a-1", "a-2"],
      idempotencyKey: "k1",
    });

    const [, , payload] = runAoaAgentMock.mock.calls[0]! as [unknown, unknown, Record<string, unknown>];
    expect(payload.attachedFiles).toEqual([
      { fileName: "notes.md", text: "Runway is 14 months." }, // trimmed
      { fileName: "logo.png" },                               // image: named only, never read
    ]);
    // The image must not have been fetched from storage at all.
    expect(getObjectMock).toHaveBeenCalledTimes(1);
    expect(getObjectMock).toHaveBeenCalledWith(CO_ID, "k/1");
  });

  it("a file that fails to extract degrades to name-only instead of failing the capture", async () => {
    runAoaAgentMock.mockResolvedValue({ status: "succeeded", runId: "run-badfile" });
    getObjectMock.mockRejectedValue(new Error("storage offline"));

    const db = createSequenceDb([
      [DEPT_ROW],
      [{ id: "a-1" }],                                               // asset ownership check (submit)
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }],
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID, content: "x", assetIds: ["a-1"] }],
      [{ id: LIBRARIAN_ID }],
      [DEPT_ROW],
      [{ path: "engineering/Files" }],
      [{ fileName: "spec.pdf", mimeType: "application/pdf", storageKey: "k/9" }],
      [],
      [],
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: [], departmentId: DEPT_ID }],
    ]);
    const result = await braindumpService(db).submit(CO_ID, {
      departmentId: DEPT_ID,
      content: "x",
      assetIds: ["a-1"],
      idempotencyKey: "k1",
    });

    // Storage was down, but the braindump still reached the Librarian.
    expect(result.status).toBe("proposed");
    const [, , payload] = runAoaAgentMock.mock.calls[0]! as [unknown, unknown, Record<string, unknown>];
    expect(payload.attachedFiles).toEqual([{ fileName: "spec.pdf" }]);
  });

  it("rejects assetIds that do not belong to this company (no cross-company file smuggling)", async () => {
    const db = createSequenceDb([
      [DEPT_ROW], // 1. select projects (validate dept)
      [],         // 2. select memoryAssets -> none owned by this company
    ]);
    const svc = braindumpService(db);

    await expect(
      svc.submit(CO_ID, {
        scope: "department",
        departmentId: DEPT_ID,
        content: "",
        assetIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        idempotencyKey: "k1",
      }),
    ).rejects.toThrow(/do not belong to this company/i);

    expect(runAoaAgentMock).not.toHaveBeenCalled();
  });

  it("dedupes duplicate assetIds before the ownership check", async () => {
    const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    // The same id twice must collapse to ONE requested id — otherwise
    // requested(2) !== owned(1) and submit would wrongly throw.
    const db = createSequenceDb([
      [DEPT_ROW],        // 1. select projects
      [{ id: ASSET }],   // 2. select memoryAssets -> exactly one owned row
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }], // 3. insert
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID }], // 4. claim
      [],                // 5. no librarian -> short-circuit to failed
      [],                // 6. update -> failed
      [{ id: CAPTURE_ID, status: "failed", proposedMemoryItemIds: [], departmentId: DEPT_ID }], // 7. latest
    ]);
    const svc = braindumpService(db);

    const result = await svc.submit(CO_ID, {
      scope: "department",
      departmentId: DEPT_ID,
      content: "",
      assetIds: [ASSET, ASSET],
      idempotencyKey: "k1",
    });

    // Got past the ownership check (didn't throw) — dedup worked.
    expect(result.status).toBe("failed");
  });

  it("Librarian not provisioned -> status=failed with actionable reason, no run attempted", async () => {
    const db = createSequenceDb([
      [DEPT_ROW],                                     // 1. select projects
      [{ id: CAPTURE_ID, departmentId: DEPT_ID, status: "pending" }], // 2. insert
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID }],         // 3. update -> running (claim)
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
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID }],
      [{ id: LIBRARIAN_ID }],
      [DEPT_ROW],
      [{ path: "engineering/Decisions" }],
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
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID }],
      [{ id: LIBRARIAN_ID }],
      [DEPT_ROW],
      [{ path: "engineering/Decisions" }],
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
      [{ id: CAPTURE_ID, status: "running", departmentId: DEPT_ID }],                       // 2. update -> running (claim)
      [{ id: LIBRARIAN_ID }],                                        // 3. select agents
      [DEPT_ROW],                                                    // 4. select projects
      [{ path: "engineering/Decisions" }],                           // 5. select memoryFolders
      [],                                                            // 6. select memoryItems (correlate) -> none
      [],                                                            // 6. update -> proposed
      [{ id: CAPTURE_ID, status: "proposed", proposedMemoryItemIds: [], departmentId: DEPT_ID }], // 7. select latest
    ]);
    const svc = braindumpService(db);
    const result = await svc.retry(CO_ID, CAPTURE_ID);

    expect(result.status).toBe("proposed");
    expect(runAoaAgentMock).toHaveBeenCalledTimes(1);
  });
});
