/**
 * CLI-012 — the producer: the ruled output root → `ArtifactExportRequest[]`.
 *
 * Contract: the E7 implementation plan's `### CLI-012`, under ruling **F7**
 * (`docs/replatform/epics/E7-coding-e2b/decisions.md`, `E7-D11`).
 *
 * ★ NO SANDBOX, NO PROVIDER PACKAGE. The producer takes its enumeration as an injected
 * closure — the same shape the supervisor supplies per run — so every arm here drives the
 * SHIPPING producer.
 */

import { describe, expect, it } from "vitest";

import {
  contentTypeForPath,
  createExportRequestProducer,
  DEFAULT_OUTPUT_ROOT,
  MAX_OUTPUT_FILES,
  MAX_OUTPUT_FILE_BYTES,
  MAX_OUTPUT_TOTAL_BYTES,
  type OutputRefusal,
} from "../lease/export-request-producer.js";
import { MAX_ATTEMPT_EXPORT_BYTES } from "../lease/artifact-export.js";
import type { SandboxOutputEntry } from "../supervisor/provider.js";

const R = DEFAULT_OUTPUT_ROOT;

function file(path: string, sizeBytes = 10): SandboxOutputEntry {
  return { path, sizeBytes, symlink: false };
}

function producerOver(entries: readonly SandboxOutputEntry[], refusals: OutputRefusal[] = []) {
  const roots: string[] = [];
  const produce = createExportRequestProducer({
    enumerate: async (root) => {
      roots.push(root);
      return entries;
    },
    kind: "other",
    retention: "run",
    onRefused: (refusal) => refusals.push(refusal),
  });
  return { produce, roots };
}

describe("CLI-012 — the producer enumerates the RULED output root, metadata only", () => {
  it("uses `/home/user/aoa-output` by default (E7-D11 §1, option 2)", async () => {
    const { produce, roots } = producerOver([file(`${R}/answer.md`)]);
    await produce({});
    expect(roots).toEqual(["/home/user/aoa-output"]);
  });

  it("turns one planted file into exactly one request carrying the declared kind and retention", async () => {
    const { produce } = producerOver([file(`${R}/answer.md`, 42)]);
    expect(await produce({})).toEqual([
      { path: `${R}/answer.md`, kind: "other", contentType: "text/markdown", retention: "run" },
    ]);
  });

  it("prefers the PER-RUN enumerate on its input over the construction-time one", async () => {
    // ★ This is the seam the supervisor uses: the producer is built once at the boot root and
    // holds no sandbox, so the run's own view must win.
    const { produce } = producerOver([file(`${R}/from-construction.md`)]);
    const requests = await produce({ enumerate: async () => [file(`${R}/from-run.md`)] });
    expect(requests.map((r) => r.path)).toEqual([`${R}/from-run.md`]);
  });

  it("an EMPTY root yields `[]` — the sequencer's anti-vacuity property starts here", async () => {
    const { produce } = producerOver([]);
    expect(await produce({})).toEqual([]);
  });
});

describe("CLI-012 — A-O2-4: a symlink under the root is REFUSED, never digested", () => {
  it("drops the link and classifies it, keeping every other file", async () => {
    const refusals: OutputRefusal[] = [];
    // ★ The link sorts FIRST, which is the case an all-or-throw pipeline loses everything on.
    const { produce } = producerOver(
      [{ path: `${R}/a-link`, sizeBytes: 100, symlink: true }, file(`${R}/b-real.md`)],
      refusals,
    );
    const requests = await produce({});
    expect(requests.map((r) => r.path)).toEqual([`${R}/b-real.md`]);
    expect(refusals).toEqual([{ reason: "output_symlink_refused" }]);
  });

  it("refuses a link whatever it points at — the marker is the whole signal", async () => {
    // `R/l1 -> /home/user/.aoa-run-prompt.md` is the §4.3 case: the run's own staged INPUT
    // exported as its output. The producer never sees the target and must not need to.
    const { produce } = producerOver([{ path: `${R}/l1`, sizeBytes: 300, symlink: true }]);
    expect(await produce({})).toEqual([]);
  });
});

describe("CLI-012 — the SD-6 admission bounds, from listing metadata, before any read", () => {
  it("refuses a file over the 25 MiB per-file cap and keeps the rest", async () => {
    const refusals: OutputRefusal[] = [];
    const { produce } = producerOver(
      [file(`${R}/huge.bin`, MAX_OUTPUT_FILE_BYTES + 1), file(`${R}/small.md`, 1)],
      refusals,
    );
    expect((await produce({})).map((r) => r.path)).toEqual([`${R}/small.md`]);
    expect(refusals).toEqual([{ reason: "output_too_large" }]);
  });

  it("admits a file EXACTLY at the cap — the bound is not off by one", async () => {
    const { produce } = producerOver([file(`${R}/exact.bin`, MAX_OUTPUT_FILE_BYTES)]);
    expect(await produce({})).toHaveLength(1);
  });

  it("refuses past the per-attempt byte total", async () => {
    const refusals: OutputRefusal[] = [];
    // ★ Each file is INSIDE the per-file cap, so only the ATTEMPT total can refuse here —
    // otherwise this arm would pass for the wrong reason (`output_too_large`).
    const chunk = MAX_OUTPUT_TOTAL_BYTES / 5;
    expect(chunk).toBeLessThanOrEqual(MAX_OUTPUT_FILE_BYTES);
    const entries = Array.from({ length: 5 }, (_, i) => file(`${R}/f${i}`, chunk));
    const { produce } = producerOver([...entries, file(`${R}/over`, 1)], refusals);
    expect((await produce({})).map((r) => r.path)).toEqual(entries.map((e) => e.path));
    expect(refusals).toEqual([{ reason: "output_limit_exceeded" }]);
  });

  it("refuses past the 64-file count", async () => {
    const entries = Array.from({ length: MAX_OUTPUT_FILES + 3 }, (_, i) =>
      file(`${R}/f${String(i).padStart(3, "0")}`, 1),
    );
    const refusals: OutputRefusal[] = [];
    const { produce } = producerOver(entries, refusals);
    expect(await produce({})).toHaveLength(MAX_OUTPUT_FILES);
    expect(refusals).toEqual([
      { reason: "output_limit_exceeded" },
      { reason: "output_limit_exceeded" },
      { reason: "output_limit_exceeded" },
    ]);
  });

  it("refuses past depth 8 and keeps a depth-8 sibling", async () => {
    const deep = `${R}/${Array.from({ length: 9 }, (_, i) => `d${i}`).join("/")}`;
    const ok = `${R}/${Array.from({ length: 8 }, (_, i) => `e${i}`).join("/")}`;
    const refusals: OutputRefusal[] = [];
    const { produce } = producerOver([file(deep), file(ok)], refusals);
    expect((await produce({})).map((r) => r.path)).toEqual([ok]);
    expect(refusals).toEqual([{ reason: "output_limit_exceeded" }]);
  });
});

describe("CLI-012 — a path outside the root is refused at capture and never reaches the sequencer", () => {
  it("refuses a sibling directory, a traversal, and the root itself", async () => {
    const refusals: OutputRefusal[] = [];
    const { produce } = producerOver(
      [
        file("/home/user/.aoa-run-prompt.md"),
        file(`${R}/../escape.md`),
        file(`${R}/sub/../../escape2.md`),
        file(R),
        file(`${R}/kept.md`),
      ],
      refusals,
    );
    expect((await produce({})).map((r) => r.path)).toEqual([`${R}/kept.md`]);
    expect(refusals).toEqual([
      { reason: "output_path_escaped" },
      { reason: "output_path_escaped" },
      { reason: "output_path_escaped" },
      { reason: "output_path_escaped" },
    ]);
  });
});

describe("CLI-012 — observability is PATH-FREE", () => {
  it("a refusal carries only a closed snake_case reason, never the tenant-authored path", async () => {
    const refusals: OutputRefusal[] = [];
    const secretish = `${R}/ANTHROPIC-sk-ant-canary.txt`;
    const { produce } = producerOver([{ path: secretish, sizeBytes: 1, symlink: true }], refusals);
    await produce({});
    const serialized = JSON.stringify(refusals);
    expect(serialized).not.toContain(secretish);
    expect(serialized).not.toContain("canary");
    for (const refusal of refusals) {
      expect(Object.keys(refusal)).toEqual(["reason"]);
      expect(refusal.reason).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });

  it("an observer that THROWS never turns a produced list into a failed window", async () => {
    const produce = createExportRequestProducer({
      enumerate: async () => [{ path: `${R}/l`, sizeBytes: 1, symlink: true }, file(`${R}/ok.md`)],
      kind: "other",
      retention: "run",
      onRefused: () => {
        throw new Error("observer exploded");
      },
    });
    expect((await produce({})).map((r) => r.path)).toEqual([`${R}/ok.md`]);
  });
});

describe("CLI-012 — the content type is derived, and its fallback is honest", () => {
  it("maps known extensions and falls back to application/octet-stream", () => {
    expect(contentTypeForPath("/r/a.md")).toBe("text/markdown");
    expect(contentTypeForPath("/r/a.JSON")).toBe("application/json");
    expect(contentTypeForPath("/r/a.invented")).toBe("application/octet-stream");
    expect(contentTypeForPath("/r/noext")).toBe("application/octet-stream");
    expect(contentTypeForPath("/r/.hidden")).toBe("application/octet-stream");
    expect(contentTypeForPath("/r/trailing.")).toBe("application/octet-stream");
  });
});

describe("CLI-012 — E7-D08: the declared kind is the caller's and is never substituted", () => {
  it("carries whatever kind the composition declared", async () => {
    const produce = createExportRequestProducer({
      enumerate: async () => [file(`${R}/a.md`)],
      kind: "workspace_patch",
      retention: "audit",
    });
    expect(await produce({})).toEqual([
      { path: `${R}/a.md`, kind: "workspace_patch", contentType: "text/markdown", retention: "audit" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// CLI-012 — THE CROSSING TEST: a test that FAILS IF THE DATA-PLANE CROSSING RETURNS.
//
// ★ WHY A SOURCE-LEVEL ASSERTION, and why no existing guard covers it. The rule is a
// DOCSTRING rule — the sequencer's `GRANTS OUT, NEVER BYTES` contract and E4-D01 — and
// `check-worker-daemon-boundary` enforces a DEPENDENCY boundary, so it passes a violation
// happily: `captureSandboxEntries` lives in this very package, and composing it here would
// add no forbidden dependency at all while routing every tenant file's bytes through the
// dependency-pinned daemon. The one thing that would actually red is an assertion about this
// module's own surface, which is what this is.
// ---------------------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("CLI-012 — the producer's dependency surface has NO byte-returning read", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lease/export-request-producer.ts", import.meta.url)),
    "utf8",
  );
  // Comments name the forbidden helper deliberately (that is the whole point of the docstring),
  // so the assertion is about CODE, not prose.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  it("★★★ never imports or calls captureSandboxEntries, readFile, or any byte-returning helper", () => {
    // NON-VACUITY FIRST: the stripped source is really still the module (if the strip ate
    // everything, every assertion below would pass on an empty string).
    expect(code).toContain("createExportRequestProducer");
    expect(code).toContain("enumerate(outputRoot)");

    for (const forbidden of [
      "captureSandboxEntries",
      "capture-sandbox",
      "readFile",
      "digestArtifact",
      "exportArtifact",
      "createHash",
      "sha256",
      "Uint8Array",
      "Buffer",
    ]) {
      expect(code, `producer code must not reach for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("★ its only runtime import is relative — E4-D01's boundary, asserted rather than assumed", () => {
    const imports = [...source.matchAll(/^import .*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    // Type-only imports of the port and the request shape; nothing runtime, nothing external.
    expect(imports.every((spec) => spec.startsWith("./") || spec.startsWith("../"))).toBe(true);
    expect(source).not.toMatch(/^import\s+(?!type)/m);
  });

  it("★ the ENTRY shape it consumes carries no content field", () => {
    // The port's own declaration is the contract; a content field appearing there is how the
    // crossing would come back, one layer below this module.
    const port = readFileSync(
      fileURLToPath(new URL("../supervisor/provider.ts", import.meta.url)),
      "utf8",
    );
    const block = port.slice(port.indexOf("export interface SandboxOutputEntry"));
    const body = block.slice(0, block.indexOf("}") + 1);
    expect(body).toContain("readonly path: string;");
    expect(body).toContain("readonly sizeBytes: number;");
    expect(body).toContain("readonly symlink: boolean;");
    for (const forbidden of ["bytes", "content", "body", "data", "Uint8Array"]) {
      expect(body, `SandboxOutputEntry must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  // ★★★ THE DRIFT PIN THAT REPLACES AN IMPORT (Codex P1, PR #576). The attempt ceiling is
  // enforced TWICE on purpose — cheaply here from the listing snapshot, and for real in the
  // sequencer on the DIGESTED size — and the two numbers must be ONE number. Sharing it by
  // importing the sequencer's constant would put a VALUE import into the producer's dependency
  // surface, which the arm above deliberately refuses, so it is pinned here instead: this reds
  // the moment either side is edited alone.
  it("★ the producer and the sequencer agree on the attempt ceiling — pinned, not imported", () => {
    expect(MAX_OUTPUT_TOTAL_BYTES).toBe(MAX_ATTEMPT_EXPORT_BYTES);
    // Non-vacuity: both are real, positive byte counts, not two undefineds comparing equal.
    expect(MAX_OUTPUT_TOTAL_BYTES).toBe(100 * 1024 * 1024);
  });
});
