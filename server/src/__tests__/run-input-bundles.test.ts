import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach } from "vitest";
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

const tempDirsToCleanup = new Set<string>();

afterEach(async () => {
  const dirs = Array.from(tempDirsToCleanup);
  tempDirsToCleanup.clear();
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

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

  it("materializes same-named selected attachments without overwriting one another", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-run-inputs-"));
    tempDirsToCleanup.add(cwd);
    const db = createSequenceDb([
      [{ id: "bundle-1", brief: null, sourceIssueId: "parent-1" }],
      [
        { id: "bundle-item-1", itemType: "attachment", sourceId: "attachment-1", label: null },
        { id: "bundle-item-2", itemType: "attachment", sourceId: "attachment-2", label: null },
      ],
      [
        {
          id: "attachment-1",
          issueId: "parent-1",
          objectKey: "issues/parent/a/spec.md",
          originalFilename: "spec.md",
          contentType: "text/markdown",
          byteSize: 5,
        },
      ],
      [
        {
          id: "attachment-2",
          issueId: "parent-1",
          objectKey: "issues/parent/b/spec.md",
          originalFilename: "spec.md",
          contentType: "text/markdown",
          byteSize: 6,
        },
      ],
    ]);

    const bundle = await buildRunInputBundle({
      db: db as never,
      companyId: "company-1",
      issueId: "child-1",
      cwd,
      storage: {
        getObject: async (_companyId: string, objectKey: string) => ({
          stream: Readable.from(Buffer.from(objectKey.includes("/a/") ? "first" : "second")),
        }),
      } as never,
    });

    const localPaths = bundle.inputs
      .filter((entry) => entry.type === "attachment")
      .map((entry) => entry.localPath);
    expect(localPaths).toHaveLength(2);
    expect(localPaths[0]).not.toBe(localPaths[1]);
    expect(await fs.readFile(path.join(cwd, localPaths[0]!), "utf8")).toBe("first");
    expect(await fs.readFile(path.join(cwd, localPaths[1]!), "utf8")).toBe("second");
  });

  it("materializes discussion-origin artifact context for created task runs", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-run-inputs-"));
    tempDirsToCleanup.add(cwd);
    const db = createSequenceDb([
      [{ id: "bundle-1", brief: "Discussion scope handoff", sourceIssueId: "task-1" }],
      [{ id: "bundle-item-1", itemType: "artifact", sourceId: "artifact-1", label: "scope-handoff.md" }],
      [{ id: "artifact-1", title: "Scope Handoff", type: "markdown", currentVersionId: "artifact-version-1" }],
      [{ content: "Acceptance criteria from discussion", fileUrl: null }],
    ]);

    const bundle = await buildRunInputBundle({
      db: db as never,
      companyId: "company-1",
      issueId: "task-1",
      cwd,
    });

    const artifactInput = bundle.inputs.find((entry) => entry.type === "artifact");
    expect(artifactInput).toMatchObject({
      id: "artifact-1",
      label: "scope-handoff.md",
    });
    expect(artifactInput?.localPath).toMatch(/^\.aoa\/inputs\/bundle-item-1\/Scope Handoff\.md$/);
    expect(await fs.readFile(path.join(cwd, artifactInput!.localPath!), "utf8")).toBe(
      "Acceptance criteria from discussion",
    );
    expect(bundle.markdown).toContain("## Run Inputs");
    expect(bundle.markdown).toContain("scope-handoff.md");
    expect(bundle.markdown).toContain(artifactInput!.localPath);
  });
});
