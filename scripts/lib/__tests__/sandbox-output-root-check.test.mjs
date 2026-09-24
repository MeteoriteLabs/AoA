// scripts/lib/__tests__/sandbox-output-root-check.test.mjs
//
// CLI-017-A — the POSITIVE CONTROL for SD-4's equality check (acceptance row 3).
//
// The row reads: "`R` cannot drift. The server-side and worker-side constants are equal, checked
// in `policy` | **change one constant → the check reds** (and it is declared in
// `guard-inventory.json`, so it demonstrably runs)."
//
// So this file proves BOTH directions, and the last two cases prove the thing that actually
// bites: the check reds on ABSENCE, not only on disagreement. A guard that passes when its
// subject has been renamed away is the `check-that-nothing-runs` class.
//
//   node --test scripts/lib/__tests__/sandbox-output-root-check.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RULED_OUTPUT_ROOT,
  SANDBOX_OUTPUT_ROOT_SOURCES,
  evaluateSandboxOutputRoot,
  readExportedStringConstant,
} from "../sandbox-output-root-check.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (relative) => readFileSync(path.join(REPO_ROOT, relative), "utf8");

const AGREEING = () => ({
  serverSource: `export const SANDBOX_OUTPUT_ROOT = "${RULED_OUTPUT_ROOT}";`,
  workerSource: `export const DEFAULT_OUTPUT_ROOT = "${RULED_OUTPUT_ROOT}";`,
});

test("agreeing constants at the ruled value → ok", () => {
  const result = evaluateSandboxOutputRoot(AGREEING());
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.equal(result.serverValue, RULED_OUTPUT_ROOT);
  assert.equal(result.workerValue, RULED_OUTPUT_ROOT);
});

test("MUTANT — the SERVER constant drifts → reds, naming the mismatch", () => {
  const input = AGREEING();
  input.serverSource = `export const SANDBOX_OUTPUT_ROOT = "/home/user/output";`;
  const result = evaluateSandboxOutputRoot(input);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.startsWith("mismatch:")), result.problems.join("; "));
});

test("MUTANT — the WORKER constant drifts → reds, naming the mismatch", () => {
  const input = AGREEING();
  input.workerSource = `export const DEFAULT_OUTPUT_ROOT = "/home/user/out";`;
  const result = evaluateSandboxOutputRoot(input);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.startsWith("mismatch:")), result.problems.join("; "));
});

test("MUTANT — BOTH constants moved together to an unruled value → still reds", () => {
  // Agreement alone is not the property. `E7-D11` §1 rules a VALUE, and `CLI-012`'s shipped
  // fixtures, the probe record and the committed decision all name it. A coordinated edit is
  // exactly the change that would otherwise sail through an equality-only check.
  const result = evaluateSandboxOutputRoot({
    serverSource: `export const SANDBOX_OUTPUT_ROOT = "/home/user/elsewhere";`,
    workerSource: `export const DEFAULT_OUTPUT_ROOT = "/home/user/elsewhere";`,
  });
  assert.equal(result.ok, false);
  assert.equal(result.problems.filter((p) => p.startsWith("unruled:")).length, 2);
  assert.equal(result.problems.some((p) => p.startsWith("mismatch:")), false);
});

test("FAIL-CLOSED — a RENAMED server constant reads as absent, not as clean", () => {
  const input = AGREEING();
  input.serverSource = `export const OUTPUT_ROOT_RENAMED = "${RULED_OUTPUT_ROOT}";`;
  const result = evaluateSandboxOutputRoot(input);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.startsWith("absent:")), result.problems.join("; "));
});

test("FAIL-CLOSED — an UNREADABLE file reds rather than skipping", () => {
  const result = evaluateSandboxOutputRoot({ serverSource: null, workerSource: null });
  assert.equal(result.ok, false);
  assert.equal(result.problems.filter((p) => p.startsWith("unreadable:")).length, 2);
});

test("the extractor does NOT match a template literal or a computed expression", () => {
  assert.equal(readExportedStringConstant("export const X = `/a/b`;", "X"), null);
  assert.equal(readExportedStringConstant("export const X = ROOT + '/b';", "X"), null);
  assert.equal(readExportedStringConstant('export const X = "/a/b";', "X"), "/a/b");
  assert.equal(readExportedStringConstant('export const X: string = "/a/b";', "X"), "/a/b");
});

test("NON-VACUITY — the REAL tree is what the guard reads, and it agrees today", () => {
  // Without this the six synthetic cases above could all pass against a repo where neither
  // constant exists. This asserts the guard's real subjects are present and correct.
  const serverSource = read(SANDBOX_OUTPUT_ROOT_SOURCES.server.path);
  const workerSource = read(SANDBOX_OUTPUT_ROOT_SOURCES.worker.path);
  const result = evaluateSandboxOutputRoot({ serverSource, workerSource });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.equal(result.serverValue, RULED_OUTPUT_ROOT);
  assert.equal(result.workerValue, RULED_OUTPUT_ROOT);
});
