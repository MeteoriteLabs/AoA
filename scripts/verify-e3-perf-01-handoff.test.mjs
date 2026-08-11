import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const verifierUrl = new URL("./verify-e3-perf-01-handoff.mjs", import.meta.url);

test("independent Security handoff verifier is an executable sealed command", async () => {
  // Mutation caught: omitting the distinct verifier leaves Integration's local QA/archive
  // self-attesting and lets a valid campaign-runner pin authorize substituted Security bytes.
  assert.equal(existsSync(verifierUrl), true, "independent Security verifier is missing");
  if (!existsSync(verifierUrl)) return;
  const verifier = await import("./verify-e3-perf-01-handoff.mjs");
  assert.equal(typeof verifier.runSecurityHandoffCommand, "function");
});

test("the real verifier rejects fake selectors before loading attacker code", () => {
  assert.equal(existsSync(verifierUrl), true, "independent Security verifier is missing");
  if (!existsSync(verifierUrl)) return;
  const verifierPath = fileURLToPath(verifierUrl);
  const source = readFileSync(verifierPath, "utf8");
  assert.match(source, /e3-perf-01-security-bootstrap\.json/);
  assert.match(source, /GetObjectRetention|COMPLIANCE|compliance/);
  assert.match(source, /security-handoff\.json/);
  assert.doesNotMatch(source, /(?:--fake|test[-_]?mode|fake[-_]?module|capabilit(?:y|ies)[-_]?path)/iu);
  assert.doesNotMatch(source, /from\s+["']\.\/run-e3-perf-01\.mjs["']/u);

  const result = spawnSync(process.execPath, [verifierPath, "--fake", "./attacker.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /attacker\.mjs|ERR_MODULE_NOT_FOUND/iu);
});
