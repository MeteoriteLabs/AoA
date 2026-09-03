// task-run-instructions-bundle.test.ts — CLI-008 Unit D.
//
// The resolver's ONLY job is to keep three outcomes apart: no bundle, a bundle in hand, and a
// bundle that is configured but could not be read. Every test here is about that boundary,
// because collapsing the third into the first is the failure the whole unit is written to
// avoid: a canary agent running in a sandbox without its identity, producing plausible work,
// terminalizing cleanly, and satisfying every clause the acceptance verifier asserts.

import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  INSTRUCTIONS_FILE_PATH_KEY,
  resolveTaskRunInstructionsBundle,
} from "../services/task-run-instructions-bundle.js";

const ABS = path.resolve("/srv/aoa/agents/cfo/AGENTS.md");
const BUNDLE = "# AGENTS\n\nYou are the CFO agent.";

describe("no bundle configured", () => {
  it.each([
    ["a null config", null],
    ["an undefined config", undefined],
    ["an empty config", {}],
    ["an empty string", { [INSTRUCTIONS_FILE_PATH_KEY]: "" }],
    ["a whitespace-only string", { [INSTRUCTIONS_FILE_PATH_KEY]: "   " }],
    ["a non-string", { [INSTRUCTIONS_FILE_PATH_KEY]: 42 }],
  ])("reports configured:false for %s, and never touches the filesystem", async (_label, adapterConfig) => {
    const readFile = vi.fn(async () => BUNDLE);
    const result = await resolveTaskRunInstructionsBundle({
      adapterConfig: adapterConfig as Record<string, unknown> | null | undefined,
      readFile,
    });
    expect(result).toEqual({ ok: true, configured: false });
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("a readable bundle", () => {
  it("returns the bytes and the host path it read them from", async () => {
    const readFile = vi.fn(async () => BUNDLE);
    const result = await resolveTaskRunInstructionsBundle({
      adapterConfig: { [INSTRUCTIONS_FILE_PATH_KEY]: ABS },
      readFile,
    });
    expect(result).toEqual({ ok: true, configured: true, hostPath: ABS, content: BUNDLE });
    expect(readFile).toHaveBeenCalledWith(ABS);
  });

  it("resolves a RELATIVE path against adapterConfig.cwd, exactly as the adapters do", async () => {
    const cwd = path.resolve("/srv/aoa/agents/cfo");
    const readFile = vi.fn(async () => BUNDLE);
    await resolveTaskRunInstructionsBundle({
      adapterConfig: { [INSTRUCTIONS_FILE_PATH_KEY]: "AGENTS.md", cwd },
      readFile,
    });
    expect(readFile).toHaveBeenCalledWith(path.resolve(cwd, "AGENTS.md"));
  });

  // ★ THE POINT IS PARITY, NOT CLEVERNESS. A resolver that expanded `~` or fell back to a
  // managed root would stage bytes the LEGACY adapter has never read for this agent — and the
  // whole claim of this unit is that the distributed path delivers the same context the legacy
  // path does. `~/x.md` is not absolute and has no cwd here, so it refuses rather than
  // inventing a home directory.
  it("does NOT expand ~ — the legacy adapters do not, so neither does this", async () => {
    const result = await resolveTaskRunInstructionsBundle({
      adapterConfig: { [INSTRUCTIONS_FILE_PATH_KEY]: "~/aoa/AGENTS.md" },
      readFile: async () => BUNDLE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unresolvable_path");
  });
});

describe("★★★ a configured bundle that cannot be produced is a REFUSAL, never an absence", () => {
  it("reports unreadable when the read throws", async () => {
    const result = await resolveTaskRunInstructionsBundle({
      adapterConfig: { [INSTRUCTIONS_FILE_PATH_KEY]: ABS },
      readFile: async () => {
        throw new Error("ENOENT: no such file or directory");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unreadable");
    // Attributable: the operator learns WHICH file and WHY.
    expect(result.detail).toContain(ABS);
    expect(result.detail).toContain("ENOENT");
  });

  it.each([
    ["a relative path with no cwd", { [INSTRUCTIONS_FILE_PATH_KEY]: "AGENTS.md" }],
    ["a relative path with a relative cwd", { [INSTRUCTIONS_FILE_PATH_KEY]: "AGENTS.md", cwd: "agents/cfo" }],
    ["a relative path with a blank cwd", { [INSTRUCTIONS_FILE_PATH_KEY]: "AGENTS.md", cwd: "  " }],
  ])("reports unresolvable_path for %s", async (_label, adapterConfig) => {
    const readFile = vi.fn(async () => BUNDLE);
    const result = await resolveTaskRunInstructionsBundle({ adapterConfig, readFile });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unresolvable_path");
    expect(readFile).not.toHaveBeenCalled();
  });

  // ★ THE DISCRIMINATION ITSELF, asserted as a property rather than per-case. If a future
  // "simplification" folded a refusal into `{ok:true, configured:false}` — the shape a
  // `string | null` return would force — this is the test that goes red.
  it("a refusal is never mistakable for 'this agent has no bundle'", async () => {
    const absent = await resolveTaskRunInstructionsBundle({ adapterConfig: {}, readFile: async () => BUNDLE });
    const refused = await resolveTaskRunInstructionsBundle({
      adapterConfig: { [INSTRUCTIONS_FILE_PATH_KEY]: ABS },
      readFile: async () => {
        throw new Error("EACCES");
      },
    });
    expect(absent.ok).toBe(true);
    expect(refused.ok).toBe(false);
    expect(absent).not.toEqual(refused);
  });

  it("never throws, whatever the reader does", async () => {
    for (const thrown of [new Error("boom"), "a string", null, undefined]) {
      await expect(
        resolveTaskRunInstructionsBundle({
          adapterConfig: { [INSTRUCTIONS_FILE_PATH_KEY]: ABS },
          readFile: async () => {
            throw thrown;
          },
        }),
      ).resolves.toMatchObject({ ok: false });
    }
  });
});
