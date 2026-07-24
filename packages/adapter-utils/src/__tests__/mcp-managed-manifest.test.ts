// Plan 2b Task 6 (E) — the sidecar ownership manifest that lets the JSON MCP
// writers (opencode, gemini) sweep entries a PREVIOUS run wrote.
//
// The property under test is the B5 staleness fix: a connector the founder
// deletes must stop being offered to the agent, WITHOUT the sweep ever being
// able to remove a server the user added by hand.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AOA_MCP_MANIFEST_FILENAME,
  readAoaManagedServerNames,
  sweepAoaManagedEntries,
  writeAoaManagedServerNames,
} from "../mcp-managed-manifest.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-mcp-manifest-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("mcp managed manifest (round trip)", () => {
  it("writes then reads back the managed names", async () => {
    await writeAoaManagedServerNames(tmpDir, ["aoa", "notion"]);
    expect(await readAoaManagedServerNames(tmpDir)).toEqual(["aoa", "notion"]);
  });

  it("is byte-identical for the same set in any order (idempotence)", async () => {
    await writeAoaManagedServerNames(tmpDir, ["notion", "aoa", "notion"]);
    const first = await fs.readFile(path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME), "utf8");
    await writeAoaManagedServerNames(tmpDir, ["aoa", "notion"]);
    const second = await fs.readFile(path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME), "utf8");
    expect(second).toBe(first);
  });

  it("returns [] (sweep nothing) when the manifest is missing", async () => {
    expect(await readAoaManagedServerNames(tmpDir)).toEqual([]);
  });

  it("returns [] when the manifest is malformed JSON rather than guessing", async () => {
    // Guessing could only ever delete a user's data; a stale entry is
    // recoverable on the next healthy run.
    await fs.writeFile(path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME), "{not json", "utf8");
    expect(await readAoaManagedServerNames(tmpDir)).toEqual([]);
  });

  it("returns [] when managedServerNames is the wrong shape", async () => {
    await fs.writeFile(
      path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME),
      JSON.stringify({ managedServerNames: "notion" }),
      "utf8",
    );
    expect(await readAoaManagedServerNames(tmpDir)).toEqual([]);
  });

  it("drops non-string entries defensively", async () => {
    await fs.writeFile(
      path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME),
      JSON.stringify({ managedServerNames: ["notion", 7, null, "slack"] }),
      "utf8",
    );
    expect(await readAoaManagedServerNames(tmpDir)).toEqual(["notion", "slack"]);
  });

  it("leaves no temp files behind", async () => {
    await writeAoaManagedServerNames(tmpDir, ["aoa"]);
    const entries = await fs.readdir(tmpDir);
    expect(entries).toEqual([AOA_MCP_MANIFEST_FILENAME]);
  });
});

describe("sweepAoaManagedEntries", () => {
  it("removes previously-managed names and keeps everything else", () => {
    const survivors = sweepAoaManagedEntries(
      { aoa: 1, notion: 2, myOwnServer: 3 },
      ["aoa", "notion"],
    );
    expect(Object.keys(survivors)).toEqual(["myOwnServer"]);
  });

  it("NEVER removes a name AoA has not recorded (user's own entry)", () => {
    const survivors = sweepAoaManagedEntries({ myOwnServer: 3 }, ["aoa", "notion"]);
    expect(survivors.myOwnServer).toBe(3);
  });

  it("returns a null-prototype map so a later __proto__ assign is safe", () => {
    const survivors = sweepAoaManagedEntries({ keep: 1 }, []);
    expect(Object.getPrototypeOf(survivors)).toBeNull();

    // The real hazard: writers copy more names into this map afterwards. On a
    // normal object literal this assignment hits Object.prototype's __proto__
    // SETTER — no own key is created and the prototype is replaced instead.
    (survivors as Record<string, unknown>)["__proto__"] = { hacked: true };
    expect(Object.prototype.hasOwnProperty.call(survivors, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).hacked).toBeUndefined();
  });

  it("sweeps a __proto__ key that arrived as an own property from JSON.parse", () => {
    const parsed = JSON.parse('{"__proto__": {"evil": true}, "keep": 1}') as Record<
      string,
      unknown
    >;
    const survivors = sweepAoaManagedEntries(parsed, ["__proto__"]);
    expect(Object.prototype.hasOwnProperty.call(survivors, "__proto__")).toBe(false);
    expect(survivors.keep).toBe(1);
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });
});
