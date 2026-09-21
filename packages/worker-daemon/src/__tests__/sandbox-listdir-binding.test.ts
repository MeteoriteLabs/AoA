// sandbox-listdir-binding.test.ts — CLI-010 (E7-D09).
//
// Pins the METADATA-ONLY enumeration seam that Unit F link 3 needs, and the FENCE on the
// byte-reading capture helper:
//
//   1. `enumerateSandboxOutputPaths(listDir, root)` turns the provider's `listDir` (bound to
//      a sandbox) into relative workspace paths — with the same fail-closed relativisation and
//      `isSafeWorkspacePath` refusal as `captureSandboxEntries`, and NO `readFile`, NO digest,
//      NO bytes (E7-D06: grants inbound, references outbound, never bytes).
//   2. The `listDir` contract is FILES ONLY, recursively, absolute, under the root
//      (`E2bTransport.listDir`, E7-D09). A `listDir` that leaks a directory, or returns bare
//      names instead of absolute paths, must FAIL LOUDLY here rather than enumerate a
//      directory as a file or silently enumerate nothing.
//   3. `captureSandboxEntries` reads and hashes bytes IN THE DAEMON, so it is fenced to the
//      local lane: its header says so, and neither barrel exports it (nor the enumerator —
//      calling it is CLI-012's).
//
// The transport-side half of the binding (the real E2B `listDir` drops directories and
// recurses, over typed SDK entries) is `sandbox-e2b-provider`'s
// `list-dir-files-only.test.ts`. Neither suite proves what a LIVE sandbox returns — that is
// CLI-012's keyed real-run acceptance.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enumerateSandboxOutputPaths, type SandboxListDir } from "../snapshot/enumerate-sandbox.js";

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

type Kind = "file" | "dir";

/** A contract-conforming `listDir` over a typed tree: files only, recursively, under root. */
function conformingListDir(tree: Record<string, Kind>): SandboxListDir {
  return async (root) => {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    return Object.entries(tree)
      .filter(([p, k]) => k === "file" && p.startsWith(prefix))
      .map(([p]) => p);
  };
}

const TREE: Record<string, Kind> = {
  "/out/b.txt": "file",
  "/out/sub": "dir",
  "/out/sub/deeper": "dir",
  "/out/sub/deeper/c.txt": "file",
  "/out/a.txt": "file",
  "/elsewhere/x.txt": "file",
};

describe("CLI-010 — metadata-only enumeration seam", () => {
  it("enumerates nested output files as relative paths in deterministic UTF-8 order", async () => {
    expect(await enumerateSandboxOutputPaths(conformingListDir(TREE), "/out")).toEqual([
      "a.txt",
      "b.txt",
      "sub/deeper/c.txt",
    ]);
  });

  it("an empty output root enumerates []", async () => {
    expect(await enumerateSandboxOutputPaths(async () => [], "/out")).toEqual([]);
  });

  it("FAILS LOUDLY when listDir leaks a directory alongside its contents", async () => {
    const leaky: SandboxListDir = async () => ["/out/sub", "/out/sub/deeper/c.txt"];
    await expect(enumerateSandboxOutputPaths(leaky, "/out")).rejects.toThrow(/directory/);
  });

  it("FAILS LOUDLY when listDir returns bare entry names instead of absolute paths", async () => {
    const dirent: SandboxListDir = async () => ["a.txt", "sub"];
    await expect(enumerateSandboxOutputPaths(dirent, "/out")).rejects.toThrow(/not under output root/);
  });

  it("FAILS CLOSED on a path outside the root, the root itself, or a duplicate", async () => {
    await expect(enumerateSandboxOutputPaths(async () => ["/elsewhere/x.txt"], "/out")).rejects.toThrow(/not under output root/);
    await expect(enumerateSandboxOutputPaths(async () => ["/out"], "/out")).rejects.toThrow(/not under output root/);
    await expect(enumerateSandboxOutputPaths(async () => ["/out/a", "/out/a"], "/out")).rejects.toThrow(/more than once/);
  });

  it("FAILS CLOSED on an unsafe relativised path (traversal)", async () => {
    await expect(enumerateSandboxOutputPaths(async () => ["/out/../etc/passwd"], "/out")).rejects.toThrow(/unsafe workspace path/);
  });

  it("calls listDir exactly once, for the root, and nothing else", async () => {
    const calls: string[] = [];
    await enumerateSandboxOutputPaths(async (root) => {
      calls.push(root);
      return ["/out/a.txt"];
    }, "/out");
    expect(calls).toEqual(["/out"]);
  });

  it("POSITIVE CONTROL — the enumerator's dependency surface reads no bytes", () => {
    const text = src("../snapshot/enumerate-sandbox.ts");
    const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./errors.js", "@armyofagents/worker-protocol"]);
    for (const forbidden of [/readFile/, /sha256/i, /digest/i, /hashing/, /capture-sandbox/, /Uint8Array/, /node:/]) {
      expect(code, `enumerate-sandbox.ts must not reference ${forbidden}`).not.toMatch(forbidden);
    }
  });
});

describe("CLI-010 — the byte-reading capture helper is FENCED to the local lane", () => {
  it("capture-sandbox.ts states the lane restriction and the contract it would breach", () => {
    const header = src("../snapshot/capture-sandbox.ts").split(/^import /m)[0];
    expect(header).toMatch(/LOCAL[- ]LANE ONLY/);
    expect(header).toMatch(/E7-D06/);
    expect(header).toMatch(/enumerate-sandbox/);
    // The old claim survives ONLY inside its recorded "Superseded text:" quote (history is kept,
    // never rewritten) — nowhere as a live statement.
    const live = header.replace(/Superseded text: "[^"]*"/g, "");
    expect(header).toMatch(/Superseded text: "This is the E2B-sourced analogue/);
    expect(live).not.toMatch(/E2B-sourced analogue/);
  });

  it("neither barrel exports captureSandboxEntries or the enumerator", () => {
    for (const barrel of ["../snapshot/index.ts", "../index.ts"]) {
      const text = src(barrel);
      expect(text, barrel).not.toMatch(/capture-sandbox|captureSandboxEntries/);
      expect(text, barrel).not.toMatch(/enumerate-sandbox|enumerateSandboxOutputPaths/);
    }
  });
});
