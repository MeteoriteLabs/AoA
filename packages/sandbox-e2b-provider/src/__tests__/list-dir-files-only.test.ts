import { describe, expect, it } from "vitest";

import { MockE2bTransport } from "../mock-transport.js";
import { METADATA_KEYS } from "../directives.js";
import { RealE2bTransport } from "../real-transport.js";
import {
  E2B_LIST_DIR_MAX_DEPTH,
  E2B_LIST_DIR_MAX_ENTRIES,
  E2bListDirBoundExceededError,
  E2bListDirMalformedEntryError,
} from "../transport.js";

// -----------------------------------------------------------------------------
// CLI-010 (E7-D09) — the `E2bTransport.listDir` contract: FILES ONLY, recursively, as
// absolute paths strictly under the given root, BOUNDED (entry count + depth), and a
// bound breach fails LOUDLY with a named error — never a silently shortened list.
//
// Before CLI-010 the real binding called `sandbox.files.list(path)` with no options (the
// installed `e2b@2.30.5` `Filesystem.list` defaults `depth` to 1) and kept only
// `e.path ?? e.name`, DISCARDING each entry's `type` — so it returned the root's immediate
// children, files and directories mixed, and never saw a nested file. Only the mock
// matched the documented "files under a prefix" contract.
//
// These arms drive the SHIPPING `RealE2bTransport.listDir` through the injected-SDK seam
// with a fake `files.list` that honours `depth` over a typed in-memory tree. That proves
// this file's LOGIC against the SDK's documented shape; it proves NOTHING about what a live
// E2B sandbox's envd returns — that is CLI-012's keyed real-run acceptance, not this suite.
// -----------------------------------------------------------------------------

type Kind = "file" | "dir";

/** A typed in-memory tree: absolute path → kind. */
function tree(entries: Record<string, Kind>): Map<string, Kind> {
  return new Map(Object.entries(entries));
}

/** A fake SDK whose `files.list(path, {depth})` mirrors e2b's `Filesystem.list`: every
 * entry (file AND dir) within `depth` levels under `path`, each `{name, type, path}`. */
function fakeSdk(fs: Map<string, Kind>, calls: Array<{ path: string; depth: unknown }> = []) {
  return {
    connect: async () => ({
      files: {
        list: async (path: string, opts?: { depth?: number }) => {
          calls.push({ path, depth: opts?.depth });
          const depth = opts?.depth ?? 1;
          const prefix = path.endsWith("/") ? path : `${path}/`;
          return [...fs.entries()]
            .filter(([p]) => p.startsWith(prefix) && p.slice(prefix.length).split("/").length <= depth)
            .map(([p, type]) => ({ name: p.slice(p.lastIndexOf("/") + 1), type, path: p }));
        },
      },
    }),
  };
}

function realWith(sdk: unknown): RealE2bTransport {
  return new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk });
}

const NESTED = tree({
  "/out": "dir",
  "/out/a.txt": "file",
  "/out/sub": "dir",
  "/out/sub/b.txt": "file",
  "/out/sub/deeper": "dir",
  "/out/sub/deeper/c.txt": "file",
  "/out/empty": "dir",
  "/elsewhere/x.txt": "file",
});

describe("CLI-010 — RealE2bTransport.listDir is files-only, recursive, bounded", () => {
  it("returns ONLY files, recursively (≥2 levels), as absolute paths under the root", async () => {
    const listed = await realWith(fakeSdk(NESTED)).listDir("sbx-1", "/out");
    expect(listed).toEqual(["/out/a.txt", "/out/sub/b.txt", "/out/sub/deeper/c.txt"]);
  });

  it("BINDING: no returned path is a directory in the sandbox tree", async () => {
    const listed = await realWith(fakeSdk(NESTED)).listDir("sbx-1", "/out");
    const directories = listed.filter((p) => NESTED.get(p) !== "file");
    expect(directories).toEqual([]);
    // Anti-vacuity: the tree really does contain directories under the root.
    expect([...NESTED].filter(([p, k]) => k === "dir" && p.startsWith("/out/")).length).toBeGreaterThan(0);
  });

  it("asks the SDK for depth MAX+1 so a breach of the depth bound is observable", async () => {
    const calls: Array<{ path: string; depth: unknown }> = [];
    await realWith(fakeSdk(NESTED, calls)).listDir("sbx-1", "/out");
    expect(calls).toEqual([{ path: "/out", depth: E2B_LIST_DIR_MAX_DEPTH + 1 }]);
  });

  it("an empty root yields [] (and the root itself is never listed)", async () => {
    expect(await realWith(fakeSdk(NESTED)).listDir("sbx-1", "/out/empty")).toEqual([]);
  });

  it("DEPTH BOUND: a file deeper than the bound throws the named error, never truncates", async () => {
    const segments = Array.from({ length: E2B_LIST_DIR_MAX_DEPTH }, (_, i) => `d${i}`);
    const fs = tree({ "/out/shallow.txt": "file" });
    for (let i = 1; i <= segments.length; i++) fs.set(`/out/${segments.slice(0, i).join("/")}`, "dir");
    fs.set(`/out/${segments.join("/")}/too-deep.txt`, "file");
    const err = await realWith(fakeSdk(fs)).listDir("sbx-1", "/out").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(E2bListDirBoundExceededError);
    expect((err as E2bListDirBoundExceededError).bound).toBe("depth");
  });

  it("DEPTH BOUND: a file exactly AT the bound is still listed", async () => {
    const segments = Array.from({ length: E2B_LIST_DIR_MAX_DEPTH - 1 }, (_, i) => `d${i}`);
    const fs = tree({});
    for (let i = 1; i <= segments.length; i++) fs.set(`/out/${segments.slice(0, i).join("/")}`, "dir");
    const deepest = `/out/${segments.join("/")}/at-bound.txt`;
    fs.set(deepest, "file");
    expect(await realWith(fakeSdk(fs)).listDir("sbx-1", "/out")).toEqual([deepest]);
  });

  it("ENTRY BOUND: more entries than the bound throws the named error, never truncates", async () => {
    const fs = tree({});
    for (let i = 0; i <= E2B_LIST_DIR_MAX_ENTRIES; i++) fs.set(`/out/f${i}`, "file");
    const err = await realWith(fakeSdk(fs)).listDir("sbx-1", "/out").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(E2bListDirBoundExceededError);
    expect((err as E2bListDirBoundExceededError).bound).toBe("entries");
  });

  it("an entry with no usable type FAILS LOUDLY (it cannot be classified file vs dir)", async () => {
    const sdk = {
      connect: async () => ({ files: { list: async () => [{ name: "a", path: "/out/a" }] } }),
    };
    await expect(realWith(sdk).listDir("sbx-1", "/out")).rejects.toBeInstanceOf(E2bListDirMalformedEntryError);
  });

  it("an entry outside the root, or a bare name instead of an absolute path, FAILS LOUDLY", async () => {
    const outside = { connect: async () => ({ files: { list: async () => [{ name: "x", type: "file", path: "/elsewhere/x" }] } }) };
    const bare = { connect: async () => ({ files: { list: async () => [{ name: "x", type: "file" }] } }) };
    await expect(realWith(outside).listDir("sbx-1", "/out")).rejects.toBeInstanceOf(E2bListDirMalformedEntryError);
    await expect(realWith(bare).listDir("sbx-1", "/out")).rejects.toBeInstanceOf(E2bListDirMalformedEntryError);
  });
});

describe("CLI-010 — MockE2bTransport.listDir honours the same contract", () => {
  async function mockWith(files: readonly string[]): Promise<{ transport: MockE2bTransport; sandboxId: string }> {
    const transport = new MockE2bTransport();
    const { sandboxId } = await transport.create({
      templateId: "base",
      timeoutMs: 60_000,
      metadata: { [METADATA_KEYS.env]: "{}" },
      envVars: {},
    });
    await transport.writeFiles(sandboxId, files.map((path) => ({ path, bytes: new Uint8Array([1]) })));
    return { transport, sandboxId };
  }

  it("files only, recursively, strictly under the root", async () => {
    const { transport, sandboxId } = await mockWith(["/out/a.txt", "/out/sub/deeper/c.txt", "/out", "/elsewhere/x"]);
    expect(await transport.listDir(sandboxId, "/out")).toEqual(["/out/a.txt", "/out/sub/deeper/c.txt"]);
  });

  it("DEPTH BOUND: the mock throws the same named error", async () => {
    const deep = `/out/${Array.from({ length: E2B_LIST_DIR_MAX_DEPTH }, (_, i) => `d${i}`).join("/")}/f.txt`;
    const { transport, sandboxId } = await mockWith([deep]);
    await expect(transport.listDir(sandboxId, "/out")).rejects.toBeInstanceOf(E2bListDirBoundExceededError);
  });
});
