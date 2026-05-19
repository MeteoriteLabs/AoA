import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildRunInputBundle } from "../services/run-input-bundles.js";

type MockRow = Record<string, unknown>;

function createSequenceDb(selects: MockRow[][]) {
  let selectIdx = 0;
  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "innerJoin"]) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (value: MockRow[]) => unknown) => Promise.resolve(resolve(getResult()));
    return chain;
  }
  return {
    select: (..._args: unknown[]) => makeChain(() => selects[selectIdx++] ?? []),
  };
}

describe("run input bundles", () => {
  it("includes selected context only and excludes unselected parent data", async () => {
    const db = createSequenceDb([
      [{ id: "bundle-1", brief: "Use only the logo reference.", sourceIssueId: "parent-1" }],
      [
        { id: "item-1", itemType: "comment", sourceId: "comment-1", label: null },
        { id: "item-2", itemType: "attachment", sourceId: "attachment-1", label: "logo.png" },
      ],
      [{ id: "comment-1", body: "Selected parent comment", issueId: "parent-1" }],
      [
        {
          id: "attachment-1",
          issueId: "parent-1",
          objectKey: "issues/parent/logo.png",
          originalFilename: "logo.png",
          contentType: "image/png",
          byteSize: 4,
        },
      ],
    ]);

    const bundle = await buildRunInputBundle({
      db: db as never,
      companyId: "company-1",
      issueId: "child-1",
      storage: {
        getObject: async () => ({
          stream: Readable.from(Buffer.from("fake")),
        }),
      } as never,
    });

    expect(bundle.inputs.map((input) => input.label)).toEqual([
      "Inherited brief",
      "Selected parent comment",
      "logo.png",
    ]);
    expect(bundle.markdown).toContain("## Run Inputs");
    expect(bundle.markdown).not.toContain("Unselected");
  });

  it("reports skipped inputs with reasons when a selected item cannot be read", async () => {
    const db = createSequenceDb([
      [{ id: "bundle-1", brief: null, sourceIssueId: "parent-1" }],
      [{ id: "item-1", itemType: "attachment", sourceId: "missing-attachment", label: null }],
      [],
    ]);

    const bundle = await buildRunInputBundle({
      db: db as never,
      companyId: "company-1",
      issueId: "child-1",
      storage: {
        getObject: async () => {
          throw new Error("not used");
        },
      } as never,
    });

    expect(bundle.skipped).toEqual([
      { id: "missing-attachment", type: "attachment", reason: "not_found" },
    ]);
    expect(bundle.markdown).toContain("Skipped attachment missing-attachment: not_found");
  });
});
