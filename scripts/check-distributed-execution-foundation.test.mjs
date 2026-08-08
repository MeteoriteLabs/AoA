#!/usr/bin/env node
/**
 * Mutation corpus for check-distributed-execution-foundation.mjs.
 *
 * Run with: node --test scripts/check-distributed-execution-foundation.test.mjs
 *
 * Each case builds a minimal temporary document tree by copying the real
 * foundation documents into an isolated `--root`, applies exactly one mutation,
 * and asserts the checker fails with the exact path/cause. The valid baseline
 * (real repo, and an unmutated fixture copy) must pass with zero errors.
 *
 * This corpus is the shared, extensible base for FND-001..008: every later FND
 * ticket extends the checker and appends new mutation cases here rather than
 * relying on string-fragment presence.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCheck } from "./check-distributed-execution-foundation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REL = {
  json: "docs/architecture/distributed-execution-lifecycles.json",
  md: "docs/architecture/distributed-execution-lifecycles.md",
  decisions: "docs/architecture/decisions.md",
};

function makeFixture(t, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fnd001-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archDir = path.join(root, "docs", "architecture");
  fs.mkdirSync(archDir, { recursive: true });
  const files = {
    root,
    jsonPath: path.join(root, REL.json),
    mdPath: path.join(root, REL.md),
    decisionsPath: path.join(root, REL.decisions),
  };
  fs.copyFileSync(path.join(repoRoot, REL.json), files.jsonPath);
  fs.copyFileSync(path.join(repoRoot, REL.md), files.mdPath);
  fs.copyFileSync(path.join(repoRoot, REL.decisions), files.decisionsPath);
  if (mutate) mutate(files);
  return root;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}
function hasError(errors, substr) {
  return errors.some((e) => e.includes(substr));
}
function report(errors) {
  return `\nActual errors:\n${errors.map((e) => `  - ${e}`).join("\n") || "  (none)"}`;
}

test("valid: the real repository passes with zero errors", async () => {
  const { errors } = await runCheck(repoRoot);
  assert.deepEqual(errors, [], report(errors));
});

test("valid: an unmutated fixture copy passes with zero errors", async (t) => {
  const root = makeFixture(t);
  const { errors } = await runCheck(root);
  assert.deepEqual(errors, [], report(errors));
});

test("missing file: lifecycles.json removed", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => fs.rmSync(jsonPath));
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.json}: missing`), report(errors));
});

test("missing file: lifecycles.md removed", async (t) => {
  const root = makeFixture(t, ({ mdPath }) => fs.rmSync(mdPath));
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.md}: missing`), report(errors));
});

test("missing file: decisions.md removed", async (t) => {
  const root = makeFixture(t, ({ decisionsPath }) => fs.rmSync(decisionsPath));
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.decisions}: missing`), report(errors));
});

test("malformed JSON: unparseable authority", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => fs.writeFileSync(jsonPath, "{ not valid json", "utf8"));
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.json}: invalid JSON`), report(errors));
});

test("filesystem error: json path is a directory (unreadable, not missing)", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    fs.rmSync(jsonPath);
    fs.mkdirSync(jsonPath);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.json}: unreadable`), report(errors));
  assert.ok(!hasError(errors, `${REL.json}: missing`), report(errors));
});

test("missing required field: lifecycle 'job' loses 'allowed'", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    delete j.lifecycles.job.allowed;
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `lifecycle "job" is missing required field "allowed"`), report(errors));
});

test("semantic mismatch: edge references an unknown state", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.lifecycles.job.allowed.push({ from: "queued", to: "bogus" });
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `references unknown state "bogus"`), report(errors));
});

test("delete an allowed edge (JSON side): parity fails", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.lifecycles.job.allowed = j.lifecycles.job.allowed.filter(
      (e) => !(e.from === "queued" && e.to === "running"),
    );
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `job edge queued->running is present in Markdown but not JSON`), report(errors));
});

test("add a terminal outgoing edge: terminal immutability fails", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.lifecycles.job.allowed.push({ from: "succeeded", to: "running" });
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `job terminal state "succeeded" has an outgoing edge to "running"`), report(errors));
});

test("remove a guard: guarded reason no longer permitted", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    delete j.lifecycles.job.guards.dead_letter;
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `but "dead_letter" is not a guarded target`), report(errors));
});

test("drift a Markdown table row: parity fails", async (t) => {
  const root = makeFixture(t, ({ mdPath }) => {
    const md = fs.readFileSync(mdPath, "utf8");
    const drifted = md.replace(
      "| `queued` | `running`, `cancel_requested`, `cancelled` |",
      "| `queued` | `running`, `cancelled` |",
    );
    assert.notEqual(drifted, md, "mutation did not change the Markdown");
    fs.writeFileSync(mdPath, drifted, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `job edge queued->cancel_requested is present in JSON but not Markdown`), report(errors));
});

test("forbidden-edge drift: removing a JSON forbidden edge fails Markdown parity", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.forbiddenCrossLifecycleEdges = j.forbiddenCrossLifecycleEdges.filter(
      (e) => !(e.from === "attempt:running" && e.to === "serviceInstance:healthy"),
    );
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `forbidden edge attempt:running->serviceInstance:healthy is present in Markdown but not JSON`),
    report(errors),
  );
});

test("missing Decision #121 heading in decisions.md", async (t) => {
  const root = makeFixture(t, ({ decisionsPath }) => {
    const src = fs.readFileSync(decisionsPath, "utf8");
    const stripped = src.replace(
      "## Decision #121 — Cloud control plane uses a fenced outbound worker protocol with distinct batch, browser-session, and service lifecycles (2026-08-08)",
      "## Decision #121 — (heading removed by mutation test)",
    );
    assert.notEqual(stripped, src, "mutation did not change decisions.md");
    fs.writeFileSync(decisionsPath, stripped, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.decisions}: missing`), report(errors));
});

test("missing required Markdown heading: '## Worked journeys' removed", async (t) => {
  const root = makeFixture(t, ({ mdPath }) => {
    const md = fs.readFileSync(mdPath, "utf8");
    const stripped = md.replace("\n## Worked journeys\n", "\n## Worked adventures\n");
    assert.notEqual(stripped, md, "mutation did not change the Markdown heading");
    fs.writeFileSync(mdPath, stripped, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `missing heading "## Worked journeys"`), report(errors));
});
