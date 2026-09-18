// capture-sandbox.test.ts — CLI-008 Unit F link 1.
//
// `captureSandboxEntries` is the E2B-sourced content capture: the provider's listDir/readFile
// seam → a deterministic WorkspaceEntry[]. These arms pin the shape (relative path + content
// hash + size), the deterministic UTF-8 order, and the two FAIL-CLOSED refusals (a path not
// under root, and an unsafe relativised path) that keep a capture from misrepresenting the
// sandbox.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { captureSandboxEntries, type SandboxCaptureDeps } from "../snapshot/capture-sandbox.js";

const sha256: SandboxCaptureDeps["sha256"] = (b) => createHash("sha256").update(b).digest("hex");
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** An in-memory sandbox: absolute path → bytes; listDir enumerates files under a prefix. */
function sandbox(files: Record<string, string>): SandboxCaptureDeps {
  const map = new Map(Object.entries(files).map(([p, v]) => [p, enc(v)] as const));
  return {
    listDir: async (root) => {
      const prefix = root.endsWith("/") ? root : `${root}/`;
      return [...map.keys()].filter((p) => p.startsWith(prefix));
    },
    readFile: async (p) => {
      const b = map.get(p);
      if (!b) throw new Error(`no such file: ${p}`);
      return b;
    },
    sha256,
  };
}

describe("captureSandboxEntries — CLI-008 Unit F link 1", () => {
  it("captures a single output file as a relative file entry with content hash + size", async () => {
    const entries = await captureSandboxEntries(sandbox({ "/home/user/out/result.md": "hello" }), "/home/user/out");
    expect(entries).toEqual([
      { path: "result.md", kind: "file", provenance: "untracked", sizeBytes: 5, sha256: sha256(enc("hello")), executable: false },
    ]);
  });

  it("captures nested files in deterministic UTF-8 path order", async () => {
    const entries = await captureSandboxEntries(
      sandbox({ "/root/b.txt": "b", "/root/a/z.txt": "z", "/root/a.txt": "a" }),
      "/root",
    );
    expect(entries.map((e) => e.path)).toEqual(["a.txt", "a/z.txt", "b.txt"]);
  });

  it("returns [] for an empty output directory", async () => {
    expect(await captureSandboxEntries(sandbox({}), "/root")).toEqual([]);
  });

  it("FAILS CLOSED on a listed path that is not under root", async () => {
    const deps: SandboxCaptureDeps = { ...sandbox({}), listDir: async () => ["/elsewhere/evil.txt"] };
    await expect(captureSandboxEntries(deps, "/root")).rejects.toThrow(/not under output root/);
  });

  it("FAILS CLOSED on an unsafe relativised path (traversal)", async () => {
    const deps: SandboxCaptureDeps = {
      ...sandbox({}),
      listDir: async () => ["/root/../etc/passwd"],
      readFile: async () => enc("x"),
    };
    await expect(captureSandboxEntries(deps, "/root")).rejects.toThrow();
  });

  it("is deterministic — identical sandboxes produce identical entries", async () => {
    const files = { "/r/x": "1", "/r/y": "2" };
    expect(await captureSandboxEntries(sandbox(files), "/r")).toEqual(await captureSandboxEntries(sandbox(files), "/r"));
  });
});
