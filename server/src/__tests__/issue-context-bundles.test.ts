import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { createIssueContextBundle } from "../services/issue-context-bundles.js";

type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  inserts?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let insertIdx = 0;
  const insertValues: unknown[] = [];

  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "values", "returning"]) {
      chain[method] = (...args: unknown[]) => {
        if (method === "values") insertValues.push(args[0]);
        return chain;
      };
    }
    chain.then = (resolve: (value: MockRow[]) => unknown) => Promise.resolve(resolve(getResult()));
    return chain;
  }

  const db = {
    select: (..._args: unknown[]) => makeChain(() => config.selects?.[selectIdx++] ?? []),
    insert: (..._args: unknown[]) => makeChain(() => config.inserts?.[insertIdx++] ?? []),
    __insertValues: insertValues,
  };

  return db;
}

function expectHttpError(err: unknown, status: number, message: string) {
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  expect((err as Error).message).toContain(message);
}

describe("issue context bundles", () => {
  it("stores a child task bundle with a brief and selected parent attachment", async () => {
    const db = createSequenceDb({
      selects: [
        [{ id: "parent-issue" }],
        [{ id: "child-issue" }],
        [{ id: "attachment-1" }],
      ],
      inserts: [
        [{ id: "bundle-1", companyId: "company-1", sourceIssueId: "parent-issue", targetIssueId: "child-issue" }],
        [{ id: "item-1", bundleId: "bundle-1", itemType: "attachment", sourceId: "attachment-1" }],
      ],
    });

    const result = await createIssueContextBundle(db as never, {
      companyId: "company-1",
      sourceIssueId: "parent-issue",
      targetIssueId: "child-issue",
      brief: "Use the selected logo reference only.",
      items: [{ type: "attachment", id: "attachment-1", label: "logo.png" }],
      createdByAgentId: "lead-agent",
    });

    expect(result.id).toBe("bundle-1");
    expect(result.items).toHaveLength(1);
    expect(db.__insertValues[0]).toMatchObject({
      companyId: "company-1",
      sourceIssueId: "parent-issue",
      targetIssueId: "child-issue",
      brief: "Use the selected logo reference only.",
      createdByAgentId: "lead-agent",
    });
    expect(db.__insertValues[1]).toEqual([
      expect.objectContaining({
        companyId: "company-1",
        bundleId: "bundle-1",
        itemType: "attachment",
        sourceId: "attachment-1",
        label: "logo.png",
      }),
    ]);
  });

  it("rejects context items from another company", async () => {
    const db = createSequenceDb({
      selects: [
        [{ id: "parent-issue" }],
        [{ id: "child-issue" }],
        [],
      ],
    });

    await expect(
      createIssueContextBundle(db as never, {
        companyId: "company-1",
        sourceIssueId: "parent-issue",
        targetIssueId: "child-issue",
        items: [{ type: "comment", id: "foreign-comment" }],
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expectHttpError(err, 422, "comment does not belong to this company");
      return true;
    });
  });

  it("rejects unsupported context item types", async () => {
    const db = createSequenceDb({
      selects: [
        [{ id: "parent-issue" }],
        [{ id: "child-issue" }],
      ],
    });

    await expect(
      createIssueContextBundle(db as never, {
        companyId: "company-1",
        sourceIssueId: "parent-issue",
        targetIssueId: "child-issue",
        items: [{ type: "secret", id: "secret-1" }],
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expectHttpError(err, 422, "Unsupported context item type");
      return true;
    });
  });

  it("enforces a default max of 10 selected context items", async () => {
    const db = createSequenceDb();

    await expect(
      createIssueContextBundle(db as never, {
        companyId: "company-1",
        sourceIssueId: "parent-issue",
        targetIssueId: "child-issue",
        items: Array.from({ length: 11 }, (_, index) => ({
          type: "text",
          label: `item ${index + 1}`,
          metadata: { body: `item ${index + 1}` },
        })),
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expectHttpError(err, 422, "At most 10 context items");
      return true;
    });
  });

  it("does not copy or move the source asset or artifact into bundle items", async () => {
    const db = createSequenceDb({
      selects: [
        [{ id: "parent-issue" }],
        [{ id: "child-issue" }],
        [{ id: "artifact-1" }],
      ],
      inserts: [
        [{ id: "bundle-1" }],
        [{ id: "item-1", sourceId: "artifact-1" }],
      ],
    });

    await createIssueContextBundle(db as never, {
      companyId: "company-1",
      sourceIssueId: "parent-issue",
      targetIssueId: "child-issue",
      items: [{ type: "artifact", id: "artifact-1", label: "brand.md", metadata: { version: 2 } }],
    });

    expect(db.__insertValues[1]).toEqual([
      expect.objectContaining({
        itemType: "artifact",
        sourceId: "artifact-1",
        label: "brand.md",
        metadata: { version: 2 },
      }),
    ]);
    expect(JSON.stringify(db.__insertValues[1])).not.toContain("content");
    expect(JSON.stringify(db.__insertValues[1])).not.toContain("fileUrl");
  });
});
