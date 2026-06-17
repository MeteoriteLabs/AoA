import { describe, expect, it, vi } from "vitest";
import { artifacts, assets } from "@armyofagents/db";
import { threadScopeVersionService } from "../services/thread-scope-versions.js";

function createSequenceDb(selectQueue: any[][]) {
  let idx = 0;
  const selectChains: any[] = [];

  function makeSelectChain() {
    const chain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: any[]) => any) =>
        Promise.resolve(fn(selectQueue[idx++] ?? [])),
      ),
    };
    selectChains.push(chain);
    return chain;
  }

  function makeInsertChain() {
    return {
      values: vi.fn(() => ({
        returning: vi.fn().mockReturnThis(),
        then: vi.fn((fn: (rows: any[]) => any) =>
          Promise.resolve(fn(selectQueue[idx++] ?? [])),
        ),
      })),
    };
  }

  return {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(() => makeInsertChain()),
    __selectChains: selectChains,
  } as any;
}

function sqlConditionContainsColumn(value: unknown, columnName: string): boolean {
  if (!value || typeof value !== "object") return false;
  if ("name" in value && (value as { name?: unknown }).name === columnName) return true;
  if ("queryChunks" in value && Array.isArray((value as { queryChunks?: unknown }).queryChunks)) {
    return (value as { queryChunks: unknown[] }).queryChunks.some((chunk) =>
      sqlConditionContainsColumn(chunk, columnName),
    );
  }
  return false;
}

describe("threadScopeVersionService.createDraftFromThread", () => {
  it("rejects live threads with conflict", async () => {
    const db = createSequenceDb([
      [{ id: "thread-live", companyId: "co1", subtype: "live", entrySeq: 3 }],
    ]);

    await expect(
      threadScopeVersionService(db).createDraftFromThread(
        "co1",
        "thread-live",
        { userId: "u1", isHuman: true },
        { summary: "Draft" },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns no-op when the selected seq range has no entries", async () => {
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 0 }],
      [],
    ]);

    const result = await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft" },
    );

    expect(result).toEqual({
      status: "no_entries",
      sourceStartSeq: 1,
      sourceEndSeq: 0,
    });
  });

  it("creates v1 draft from seq 1 through current entrySeq", async () => {
    const version = {
      id: "scope1",
      threadId: "thread1",
      versionNumber: 1,
      sourceStartSeq: 1,
      sourceEndSeq: 2,
      status: "draft",
    };
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 2 }],
      [],
      [
        { id: "entry-1", discussionId: "thread1", seq: 1, inputType: "write", rawContent: "Scope should cover all messages." },
        { id: "entry-2", discussionId: "thread1", seq: 2, inputType: "write", rawContent: "Create tasks from the accepted scope." },
      ],
      [],
      [],
      [version],
    ]);

    const result = await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft v1" },
    );

    expect(result).toEqual({ status: "created", version });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("persists artifact metadata from scoped entry attachments into scope items", async () => {
    const version = {
      id: "scope1",
      threadId: "thread1",
      versionNumber: 1,
      sourceStartSeq: 1,
      sourceEndSeq: 1,
      status: "draft",
    };
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 1 }],
      [],
      [
        {
          id: "entry-1",
          discussionId: "thread1",
          seq: 1,
          inputType: "write",
          rawContent: "Use the attached artifact as the source.",
        },
      ],
      [],
      [
        {
          discussionEntryId: "entry-1",
          assetId: null,
          artifactId: "artifact-1",
          artifactVersionId: "artifact-version-1",
          artifactTitle: "Checkout mockup",
          assetOriginalFilename: null,
          assetContentType: null,
        },
      ],
      [version],
    ]);

    const result = await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft v1" },
    );

    expect(result).toEqual({ status: "created", version });
    const scopeItemInsert = db.insert.mock.results[1]?.value.values;
    expect(scopeItemInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "artifact_link",
          title: "Checkout mockup",
          artifactId: "artifact-1",
          artifactVersionId: "artifact-version-1",
          payload: expect.objectContaining({ role: "reference" }),
          sourceEntryIds: ["entry-1"],
        }),
      ]),
    );
  });

  it("guards artifact and asset attachment joins by company", async () => {
    const version = {
      id: "scope1",
      threadId: "thread1",
      versionNumber: 1,
      sourceStartSeq: 1,
      sourceEndSeq: 1,
      status: "draft",
    };
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 1 }],
      [],
      [
        {
          id: "entry-1",
          discussionId: "thread1",
          seq: 1,
          inputType: "write",
          rawContent: "Use the attached artifact as the source.",
        },
      ],
      [],
      [],
      [version],
    ]);

    await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft v1" },
    );

    const attachmentSelect = db.__selectChains[4];
    expect(attachmentSelect.leftJoin).toHaveBeenCalledTimes(2);
    for (const [, joinCondition] of attachmentSelect.leftJoin.mock.calls) {
      expect(joinCondition.queryChunks.length).toBeGreaterThan(1);
      expect(sqlConditionContainsColumn(joinCondition, "company_id")).toBe(true);
    }
  });

  it("selects attachment artifact and asset ids from company-guarded joins", async () => {
    const version = {
      id: "scope1",
      threadId: "thread1",
      versionNumber: 1,
      sourceStartSeq: 1,
      sourceEndSeq: 1,
      status: "draft",
    };
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 1 }],
      [],
      [
        {
          id: "entry-1",
          discussionId: "thread1",
          seq: 1,
          inputType: "write",
          rawContent: "Use the attached artifact as the source.",
        },
      ],
      [],
      [
        {
          discussionEntryId: "entry-1",
          rawAttachmentArtifactId: "foreign-artifact",
          rawAttachmentAssetId: "foreign-asset",
          artifactId: null,
          assetId: null,
          artifactVersionId: null,
          artifactTitle: null,
          artifactType: null,
          assetOriginalFilename: null,
          assetContentType: null,
        },
      ],
      [version],
    ]);

    await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft v1" },
    );

    const attachmentSelectShape = db.select.mock.calls[4]?.[0];
    expect(attachmentSelectShape.artifactId).toBe(artifacts.id);
    expect(attachmentSelectShape.assetId).toBe(assets.id);

    const scopeItemInsert = db.insert.mock.results[1]?.value.values;
    const insertedItems = scopeItemInsert.mock.calls[0]?.[0] ?? [];
    expect(insertedItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactId: "foreign-artifact" }),
        expect.objectContaining({ payload: expect.objectContaining({ assetId: "foreign-asset" }) }),
      ]),
    );
  });

  it("preserves extracted artifact payload when creating scope items", async () => {
    const version = {
      id: "scope1",
      threadId: "thread1",
      versionNumber: 1,
      sourceStartSeq: 1,
      sourceEndSeq: 1,
      status: "draft",
    };
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 1 }],
      [],
      [
        {
          id: "entry-1",
          discussionId: "thread1",
          seq: 1,
          inputType: "write",
          rawContent: "Use the generated design artifact.",
        },
      ],
      [
        {
          id: "extracted-artifact-1",
          discussionEntryId: "entry-1",
          type: "artifact",
          title: "Design artifact",
          description: "Generated checkout design",
          suggestedPriority: null,
          suggestedAssigneeId: null,
          suggestedDepartmentId: null,
          suggestedProjectId: null,
          suggestedLayer: null,
          suggestedGoalId: null,
          status: "pending",
          payload: {
            artifactId: "artifact1",
            artifactVersionId: "version1",
          },
        },
      ],
      [],
      [version],
    ]);

    const result = await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft v1" },
    );

    expect(result).toEqual({ status: "created", version });
    const scopeItemInsert = db.insert.mock.results[1]?.value.values;
    expect(scopeItemInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "artifact_link",
          title: "Design artifact",
          artifactId: "artifact1",
          artifactVersionId: "version1",
          payload: expect.objectContaining({ role: "reference" }),
          extractedItemId: "extracted-artifact-1",
          sourceEntryIds: ["entry-1"],
        }),
      ]),
    );
  });

  it("creates v2 draft starting after the latest accepted sourceEndSeq", async () => {
    const latest = {
      id: "scope1",
      threadId: "thread1",
      versionNumber: 1,
      sourceEndSeq: 5,
      status: "accepted",
    };
    const version = {
      id: "scope2",
      threadId: "thread1",
      versionNumber: 2,
      sourceStartSeq: 6,
      sourceEndSeq: 7,
      status: "draft",
    };
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 7 }],
      [latest],
      [
        { id: "entry-6", discussionId: "thread1", seq: 6, inputType: "write", rawContent: "New discussion after v1." },
        { id: "entry-7", discussionId: "thread1", seq: 7, inputType: "write", rawContent: "Create v2 scope from this range." },
      ],
      [],
      [],
      [version],
    ]);

    const result = await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft v2" },
    );

    expect(result).toEqual({ status: "created", version });
  });

  it("returns existing active draft instead of creating a duplicate", async () => {
    const draft = {
      id: "scope1",
      threadId: "thread1",
      versionNumber: 1,
      sourceEndSeq: 2,
      status: "draft",
    };
    const db = createSequenceDb([
      [{ id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 2 }],
      [draft],
    ]);

    const result = await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "thread1",
      { userId: "u1", isHuman: true },
      { summary: "Draft v1" },
    );

    expect(result).toEqual({ status: "existing_draft", version: draft });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
