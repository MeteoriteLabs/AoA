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

import {
  runCheck,
  canonicalizeJson,
  computeEventDigest,
  parseJsonStrict,
} from "./check-distributed-execution-foundation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GJ_DIR = "tests/fixtures/distributed-execution";

const REL = {
  json: "docs/architecture/distributed-execution-lifecycles.json",
  md: "docs/architecture/distributed-execution-lifecycles.md",
  decisions: "docs/architecture/decisions.md",
  authority: "docs/architecture/distributed-execution-authority.md",
  threatModel: "docs/architecture/distributed-execution-threat-model.md",
  threatControls: "docs/architecture/distributed-execution-threat-controls.json",
  programDesign: "docs/replatform/program-design.md",
  fixturesDir: GJ_DIR,
  schema: `${GJ_DIR}/schema-v1.json`,
};

function makeFixture(t, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fnd00x-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archDir = path.join(root, "docs", "architecture");
  fs.mkdirSync(archDir, { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "replatform"), { recursive: true });
  const files = {
    root,
    jsonPath: path.join(root, REL.json),
    mdPath: path.join(root, REL.md),
    decisionsPath: path.join(root, REL.decisions),
    authorityPath: path.join(root, REL.authority),
    threatModelPath: path.join(root, REL.threatModel),
    threatControlsPath: path.join(root, REL.threatControls),
    programDesignPath: path.join(root, REL.programDesign),
    fixturesDir: path.join(root, REL.fixturesDir),
    schemaPath: path.join(root, REL.schema),
    fixturePath: (name) => path.join(root, REL.fixturesDir, name),
  };
  fs.copyFileSync(path.join(repoRoot, REL.json), files.jsonPath);
  fs.copyFileSync(path.join(repoRoot, REL.md), files.mdPath);
  fs.copyFileSync(path.join(repoRoot, REL.decisions), files.decisionsPath);
  fs.copyFileSync(path.join(repoRoot, REL.authority), files.authorityPath);
  fs.copyFileSync(path.join(repoRoot, REL.threatModel), files.threatModelPath);
  fs.copyFileSync(path.join(repoRoot, REL.threatControls), files.threatControlsPath);
  fs.copyFileSync(path.join(repoRoot, REL.programDesign), files.programDesignPath);
  // FND-004: copy the whole fixture corpus (schema-v1.json + 9 fixtures + README).
  fs.cpSync(path.join(repoRoot, REL.fixturesDir), files.fixturesDir, { recursive: true });
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

// --- FND-002: authority contract mutation corpus ----------------------------

/** Replace the first occurrence of `find` in a text fixture file, asserting it changed. */
function patchText(p, find, replace) {
  const src = fs.readFileSync(p, "utf8");
  const out = src.replace(find, replace);
  assert.notEqual(out, src, `mutation did not change ${path.basename(p)} (find not present)`);
  fs.writeFileSync(p, out, "utf8");
}

test("missing file: distributed-execution-authority.md removed", async (t) => {
  const root = makeFixture(t, ({ authorityPath }) => fs.rmSync(authorityPath));
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.authority}: missing`), report(errors));
});

test("authority: Decision #121 loses the authority-doc back-reference", async (t) => {
  const root = makeFixture(t, ({ decisionsPath }) => {
    patchText(
      decisionsPath,
      "[`distributed-execution-authority.md`](distributed-execution-authority.md)",
      "[`the authority record`](removed-by-mutation.md)",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `${REL.decisions}: missing reference to "distributed-execution-authority.md"`),
    report(errors),
  );
});

test("authority mutation: a missing authority-matrix row fails", async (t) => {
  const root = makeFixture(t, ({ authorityPath }) => {
    patchText(
      authorityPath,
      "| Source history | Customer-declared Git remote/repository | Stage declared base; return patch or commit metadata |\n",
      "",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `authority matrix is missing the required row for state "Source history"`),
    report(errors),
  );
});

test("authority mutation: a worker-database peer-replica claim fails", async (t) => {
  const root = makeFixture(t, ({ authorityPath }) => {
    // Keep the negated invariant (so the requireFile fragment still passes) and
    // add an affirmative peer-replica claim — only the structured negation scan
    // catches this, proving it is not mere substring presence.
    patchText(
      authorityPath,
      "No AoA database is a peer replica. Desktop and cloud workers",
      "No AoA database is a peer replica. The worker SQLite database is a peer replica of the control plane. Desktop and cloud workers",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "peer-replica invariant"), report(errors));
  assert.ok(hasError(errors, "asserted without negation"), report(errors));
});

test("authority mutation: a dual-writer cutover enum fails", async (t) => {
  const root = makeFixture(t, ({ authorityPath }) => {
    patchText(authorityPath, "ExecutionOwner = legacy | distributed", "ExecutionOwner = legacy & distributed");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `ExecutionOwner must be exactly "legacy | distributed"`), report(errors));
});

test("authority mutation: an ordinary stale commit to authoritative state fails", async (t) => {
  const root = makeFixture(t, ({ authorityPath }) => {
    patchText(
      authorityPath,
      "Expired or replaced attempts cannot update authoritative state.",
      "Expired or replaced attempts may update authoritative state.",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "must not update authoritative state"), report(errors));
});

test("authority mutation: auto-promoted quarantine output fails", async (t) => {
  const root = makeFixture(t, ({ authorityPath }) => {
    patchText(
      authorityPath,
      "It is never auto-applied or selected as the service recovery checkpoint.",
      "It is auto-applied or selected as the service recovery checkpoint.",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "must never be auto-applied"), report(errors));
});

// --- E0-F002 item 3: pin the previously unpinned checker branches ------------

test("unreachable state: a state with no incoming edge is flagged", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.lifecycles.job.states.push("island");
    j.lifecycles.job.allowed.push({ from: "island", to: "succeeded" });
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `state "island" is unreachable`), report(errors));
});

test("non-terminal dead-end: a reachable state with no outgoing edge is flagged", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.lifecycles.job.states.push("stuck");
    j.lifecycles.job.allowed.push({ from: "queued", to: "stuck" });
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `non-terminal state "stuck" has no outgoing edge`), report(errors));
});

test("forbidden self-lifecycle edge: same-lifecycle from/to is not cross-lifecycle", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.forbiddenCrossLifecycleEdges.push({ from: "job:queued", to: "job:succeeded", reason: "test" });
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `forbidden edge job:queued->job:succeeded is not cross-lifecycle`), report(errors));
});

test("forbidden edge references an unknown lifecycle", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    j.forbiddenCrossLifecycleEdges.push({ from: "attempt:running", to: "bogus:whatever", reason: "test" });
    writeJson(jsonPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `forbidden edge "bogus:whatever" references unknown lifecycle`), report(errors));
});

test("reason-only guard drift: Markdown guard reason differs from JSON", async (t) => {
  const root = makeFixture(t, ({ mdPath }) => {
    patchText(
      mdPath,
      "`dead_letter` (`policy_exhausted`) |",
      "`dead_letter` (`drifted_reason`) |",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `job edge running->dead_letter reason mismatch`), report(errors));
});

// --- E0-F002 item 2: malformed lifecycle referenced by a forbidden edge -------

test("forbidden edge into a malformed lifecycle pushes a clean error (no TypeError)", async (t) => {
  const root = makeFixture(t, ({ jsonPath }) => {
    const j = readJson(jsonPath);
    // `serviceInstance` is referenced by forbidden edges; drop its state set so
    // the forbidden-edge check would `.includes` on undefined without the guard.
    delete j.lifecycles.serviceInstance.states;
    writeJson(jsonPath, j);
  });
  // runCheck must return a structured error rather than throwing.
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `forbidden edge "serviceInstance:healthy" references lifecycle "serviceInstance" with a missing or malformed state set`),
    report(errors),
  );
});

// --- FND-003: threat model + control ownership mutation corpus ----------------

// E0-F004: `threat`/`control`/`verification` are now required too, so their
// field-deletion mutations are exercised by the loop below (all 30 crossings
// carry them, so the valid corpus stays green).
const THREAT_REQUIRED_FIELDS = [
  "id",
  "threat",
  "trustedSide",
  "lessTrustedSide",
  "authentication",
  "authorization",
  "confidentiality",
  "integrity",
  "revocation",
  "audit",
  "failureMode",
  "severity",
  "control",
  "verification",
  "ownerTickets",
  "verificationLane",
];

test("missing file: distributed-execution-threat-model.md removed", async (t) => {
  const root = makeFixture(t, ({ threatModelPath }) => fs.rmSync(threatModelPath));
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.threatModel}: missing`), report(errors));
});

test("missing file: distributed-execution-threat-controls.json removed", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => fs.rmSync(threatControlsPath));
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${REL.threatControls}: missing`), report(errors));
});

test("threat model: Decision #121 loses the threat-model back-reference", async (t) => {
  const root = makeFixture(t, ({ decisionsPath }) => {
    patchText(
      decisionsPath,
      "[`distributed-execution-threat-model.md`](distributed-execution-threat-model.md)",
      "[`the threat model`](removed-by-mutation.md)",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `${REL.decisions}: missing reference to "distributed-execution-threat-model.md"`),
    report(errors),
  );
});

// Remove each required field in turn: every one must be independently enforced.
for (const field of THREAT_REQUIRED_FIELDS) {
  test(`threat crossing: removing required field "${field}" fails`, async (t) => {
    const root = makeFixture(t, ({ threatControlsPath }) => {
      const j = readJson(threatControlsPath);
      delete j.crossings[0][field];
      writeJson(threatControlsPath, j);
    });
    const { errors } = await runCheck(root);
    assert.ok(hasError(errors, `is missing required field "${field}"`), report(errors));
  });
}

test("threat crossing: a non-empty required field emptied fails", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => {
    const j = readJson(threatControlsPath);
    j.crossings[0].authentication = "   ";
    writeJson(threatControlsPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `field "authentication" must be a non-empty string`), report(errors));
});

test("threat crossing: a duplicate crossing id fails", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => {
    const j = readJson(threatControlsPath);
    j.crossings[1].id = j.crossings[0].id; // both become "DE-01"
    writeJson(threatControlsPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `duplicate crossing id "DE-01"`), report(errors));
});

test("threat crossing: an invented owner ticket (not in program-design) fails", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => {
    const j = readJson(threatControlsPath);
    j.crossings[0].ownerTickets = ["ZZZ-999"];
    writeJson(threatControlsPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `references unknown owner ticket "ZZZ-999" (not defined in ${REL.programDesign})`),
    report(errors),
  );
});

test("threat crossing: an empty ownerTickets array fails", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => {
    const j = readJson(threatControlsPath);
    j.crossings[0].ownerTickets = [];
    writeJson(threatControlsPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `must have a non-empty "ownerTickets" array`), report(errors));
});

test("threat crossing: an unknown severity value fails", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => {
    const j = readJson(threatControlsPath);
    j.crossings[0].severity = "Catastrophic";
    writeJson(threatControlsPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `has unknown severity "Catastrophic"`), report(errors));
});

test("threat crossing: an unknown verificationLane value fails", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => {
    const j = readJson(threatControlsPath);
    j.crossings[0].verificationLane = "D9";
    writeJson(threatControlsPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `has unknown verificationLane "D9"`), report(errors));
});

test("threat crossing: removing a Critical/High release test fails", async (t) => {
  const root = makeFixture(t, ({ threatControlsPath }) => {
    const j = readJson(threatControlsPath);
    // DE-14 is Critical with owner FND-005 only; its release test is the
    // releaseTest field. Removing it leaves no REL-* owner and no releaseTest.
    const de14 = j.crossings.find((c) => c.id === "DE-14");
    assert.ok(de14, "fixture must contain DE-14");
    delete de14.releaseTest;
    writeJson(threatControlsPath, j);
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `crossing DE-14 is Critical but has no release test`),
    report(errors),
  );
});

test("threat parity: a JSON crossing id omitted from the Markdown register fails", async (t) => {
  const root = makeFixture(t, ({ threatModelPath }) => {
    const md = fs.readFileSync(threatModelPath, "utf8");
    // Drop the entire DE-30 register row from the Markdown render.
    const stripped = md.replace(/\n\| DE-30 \|[^\n]*\|/, "");
    assert.notEqual(stripped, md, "mutation did not remove the DE-30 register row");
    fs.writeFileSync(threatModelPath, stripped, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `crossing id "DE-30" is present in JSON but not the Markdown register`),
    report(errors),
  );
});

test("threat parity: a drifted Markdown severity fails per-ID parity", async (t) => {
  const root = makeFixture(t, ({ threatModelPath }) => {
    patchText(
      threatModelPath,
      "| DE-01 | Cross-tenant database access | Critical |",
      "| DE-01 | Cross-tenant database access | High |",
    );
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `register severity for "DE-01" is "High" but JSON is "Critical"`),
    report(errors),
  );
});

test("threat parity: an extra Markdown register id absent from JSON fails", async (t) => {
  const root = makeFixture(t, ({ threatModelPath }) => {
    const md = fs.readFileSync(threatModelPath, "utf8");
    const injected = md.replace(
      "| DE-30 | Malicious capability claim |",
      "| DE-99 | Fabricated crossing | Critical | none | none | REL-001 |\n| DE-30 | Malicious capability claim |",
    );
    assert.notEqual(injected, md, "mutation did not inject a DE-99 register row");
    fs.writeFileSync(threatModelPath, injected, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(
    hasError(errors, `register id "DE-99" is present in the Markdown register but not JSON`),
    report(errors),
  );
});

// --- FND-004: golden-journey + failure fixture mutation corpus ----------------

function fixtureFile(root, name) {
  return path.join(root, GJ_DIR, name);
}
function readFixture(root, name) {
  return JSON.parse(fs.readFileSync(fixtureFile(root, name), "utf8"));
}
function writeFixture(root, name, obj) {
  fs.writeFileSync(fixtureFile(root, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function schemaFile(root) {
  return path.join(root, GJ_DIR, "schema-v1.json");
}
function readSchema(root) {
  return JSON.parse(fs.readFileSync(schemaFile(root), "utf8"));
}
function writeSchema(root, obj) {
  fs.writeFileSync(schemaFile(root), JSON.stringify(obj, null, 2) + "\n", "utf8");
}
// A different-but-valid 26-char ULID body (Crockford base32, no I/L/O/U).
const ULID26 = "0123456789ABCDEFGHJKMNPQRS";

test("valid: the fixture corpus passes with zero errors (real repo)", async () => {
  const { errors } = await runCheck(repoRoot);
  assert.deepEqual(errors, [], report(errors));
});

// (1) The eventDigest binds every one of the 14 immutable event fields: changing
// any single field without recomputing the digest is detected.
const EVENT_FIELD_MUTATIONS = {
  protocolVersion: 2,
  eventId: ULID26,
  eventType: "changed_type",
  organizationId: `org_${ULID26}`,
  companyId: `company_${ULID26}`,
  workerId: `worker_${ULID26}`,
  jobId: `job_${ULID26}`,
  attempt: 7,
  leaseId: `lease_${ULID26}`,
  fenceToken: 555,
  seq: 99,
  occurredAt: "2027-01-01T00:00:00.000Z",
  payload: { detail: "changed-payload" },
  eventDigest: "0".repeat(64),
};
for (const [field, newVal] of Object.entries(EVENT_FIELD_MUTATIONS)) {
  test(`fixture event: mutating "${field}" without re-digesting is rejected`, async (t) => {
    const root = makeFixture(t, ({ root: r }) => {
      const fx = readFixture(r, "batch-success.json");
      fx.expectedEvents[0][field] = newVal;
      writeFixture(r, "batch-success.json", fx);
    });
    const { errors } = await runCheck(root);
    assert.ok(hasError(errors, "batch-success.json: event[0] eventDigest mismatch"), report(errors));
  });
}

test("fixture event: reusing another event's digest fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[1].eventDigest = fx.expectedEvents[0].eventDigest;
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: event[1] eventDigest mismatch"), report(errors));
});

test("fixture event: a bad eventId format fails the schema pattern", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[0].eventId = "not-a-valid-ulid";
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "/expectedEvents/0/eventId does not match pattern"), report(errors));
});

test("fixture event: a duplicate eventId across events fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[1].eventId = fx.expectedEvents[0].eventId;
    // Re-digest event[1] so ONLY the duplicate-id rule (not the digest) fires.
    delete fx.expectedEvents[1].eventDigest;
    fx.expectedEvents[1].eventDigest = computeEventDigest(fx.expectedEvents[1]);
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: duplicate eventId"), report(errors));
});

test("fixture event: a foreign leaseId not in identity.attempts fails referential consistency", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[0].leaseId = `lease_${ULID26}`;
    delete fx.expectedEvents[0].eventDigest;
    fx.expectedEvents[0].eventDigest = computeEventDigest(fx.expectedEvents[0]);
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "does not match any declared identity attempt"), report(errors));
});

test("fixture event: a cross-tenant organizationId fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[0].organizationId = `org_${ULID26}`;
    delete fx.expectedEvents[0].eventDigest;
    fx.expectedEvents[0].eventDigest = computeEventDigest(fx.expectedEvents[0]);
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "event[0] organizationId"), report(errors));
  assert.ok(hasError(errors, "does not match organization.id"), report(errors));
});

test("fixture event: an unsafe integer fenceToken is not canonicalizable", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[0].fenceToken = 9007199254740992; // 2^53, not a safe integer
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: event[0] is not canonicalizable"), report(errors));
});

test("fixture event: a float attempt is not canonicalizable", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[0].attempt = 1.5;
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: event[0] is not canonicalizable"), report(errors));
});

test("fixture event: a lone surrogate in a payload string is not canonicalizable", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expectedEvents[1].payload = { detail: "\uD800" };
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: event[1] is not canonicalizable"), report(errors));
});

test("fixture: duplicate semantic keys inside an event are rejected at parse", async (t) => {
  const root = makeFixture(t, ({ fixturePath }) => {
    const p = fixturePath("batch-success.json");
    const src = fs.readFileSync(p, "utf8");
    const out = src.replace('"seq": 1,', '"seq": 1,\n      "seq": 1,');
    assert.notEqual(out, src, "mutation did not inject a duplicate key");
    fs.writeFileSync(p, out, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "duplicate object key"), report(errors));
});

test("fixture: an extra top-level property fails the closed schema", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.unexpectedField = true;
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "/unexpectedField is not an allowed property"), report(errors));
});

test("fixture: schemaVersion other than 1 fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.schemaVersion = 2;
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: schemaVersion must be 1"), report(errors));
});

test("fixture: id not matching the filename fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.id = "batch-different";
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: id must match filename"), report(errors));
});

test("fixture: an invalid workloadType fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.workloadType = "gpu";
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: invalid workloadType"), report(errors));
});

test("fixture: empty steps fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.steps = [];
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: steps must be non-empty"), report(errors));
});

test("fixture: a terminalState outside the allowed set fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expected.terminalState = "annihilated";
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "is not an allowed terminal state"), report(errors));
});

test("fixture: empty auditActions fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expected.auditActions = [];
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: expected.auditActions must be non-empty"), report(errors));
});

test("fixture: empty forbiddenEffects fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.expected.forbiddenEffects = [];
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "batch-success.json: expected.forbiddenEffects must be non-empty"), report(errors));
});

test("fixture: a company that belongs to a different organization fails cross-tenant consistency", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.company.organizationId = `org_${ULID26}`;
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "does not match organization.id"), report(errors));
});

test("fixture: observed cost above the cap fails the usage bound", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.cost.observedTotalCents = fx.cost.maxTotalCents + 1;
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "cost.observedTotalCents exceeds maxTotalCents"), report(errors));
});

test("fixture: startedAt after finishedAt fails the timing bound", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    fx.timing.startedAt = "2027-01-01T00:00:00.000Z";
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "timing.startedAt is after finishedAt"), report(errors));
});

test("fixture: a task_run source missing runId fails the discriminant", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "batch-success.json");
    delete fx.source.runId;
    writeFixture(r, "batch-success.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "/source/runId is required"), report(errors));
});

test("fixture: a non-task_run source carrying runId fails the discriminant", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "browser-approval-download.json");
    fx.source.runId = `run_${ULID26}`;
    writeFixture(r, "browser-approval-download.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "/source must not match the forbidden subschema"), report(errors));
});

test("fixture: a duplicate leaseId across identity attempts fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "service-restart-checkpoint.json");
    fx.identity.attempts[1].leaseId = fx.identity.attempts[0].leaseId;
    writeFixture(r, "service-restart-checkpoint.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "identity.attempts has a duplicate leaseId"), report(errors));
});

test("fixture: a non-monotonic fenceToken across attempts fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "service-restart-checkpoint.json");
    fx.identity.attempts[1].fenceToken = 50; // < attempt 1's 100
    writeFixture(r, "service-restart-checkpoint.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "identity.attempts fenceToken must strictly increase"), report(errors));
});

test("fixture: a registered canary token leaking outside its declaration fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const fx = readFixture(r, "plaintext-secret-in-argv-rejected.json");
    // Place the secret where it does not affect any event digest, so ONLY the
    // canary-leakage rule fires.
    fx.requester.displayName = `Runner Agent ${fx.canaries[0].token}`;
    writeFixture(r, "plaintext-secret-in-argv-rejected.json", fx);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "appears 2 time(s)"), report(errors));
});

test("fixture: a missing fixture file is named", async (t) => {
  const root = makeFixture(t, ({ fixturePath }) => {
    fs.rmSync(fixturePath("batch-success.json"));
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, `${GJ_DIR}/batch-success.json: missing`), report(errors));
});

// --- Schema meta-validator mutations -----------------------------------------

test("schema: an unknown/custom keyword fails E0", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const src = fs.readFileSync(schemaFile(r), "utf8");
    const out = src.replace('"type": "object",', '"type": "object",\n  "bogusKeyword": true,');
    assert.notEqual(out, src, "mutation did not inject a custom keyword");
    fs.writeFileSync(schemaFile(r), out, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, 'unknown/custom schema keyword "bogusKeyword"'), report(errors));
});

test("schema: a non-closed object (missing additionalProperties:false) fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const src = fs.readFileSync(schemaFile(r), "utf8");
    // Remove the FIRST additionalProperties:false (the root object schema).
    const out = src.replace('  "additionalProperties": false,\n', "");
    assert.notEqual(out, src, "mutation did not remove additionalProperties:false");
    fs.writeFileSync(schemaFile(r), out, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, "object schema at # must set additionalProperties:false"), report(errors));
});

test("schema: a malformed $comment form fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const src = fs.readFileSync(schemaFile(r), "utf8");
    const out = src.replace('"aoa:utf8-max-bytes=480"', '"aoa:utf8-max-bytes=zero"');
    assert.notEqual(out, src, "mutation did not corrupt a $comment");
    fs.writeFileSync(schemaFile(r), out, "utf8");
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, 'aoa:utf8-max-bytes=<positive integer>'), report(errors));
});

test("schema: a missing required $def fails", async (t) => {
  const root = makeFixture(t, ({ root: r }) => {
    const schema = readSchema(r);
    delete schema.$defs.Event;
    writeSchema(r, schema);
  });
  const { errors } = await runCheck(root);
  assert.ok(hasError(errors, 'missing required $def "Event"'), report(errors));
});

// --- Canonicalizer / digest unit contract (imported directly) ----------------

test("canonicalizer: identical objects in different key order produce identical bytes", () => {
  const a = { b: 1, a: 2, nested: { y: [3, 2, 1], x: true } };
  const b = { nested: { x: true, y: [3, 2, 1] }, a: 2, b: 1 };
  assert.equal(canonicalizeJson(a), canonicalizeJson(b));
  assert.equal(canonicalizeJson(a), '{"a":2,"b":1,"nested":{"x":true,"y":[3,2,1]}}');
});

test("canonicalizer: keys sort by UTF-16 code units (uppercase before lowercase)", () => {
  assert.equal(canonicalizeJson({ b: 1, A: 2, a: 3 }), '{"A":2,"a":3,"b":1}');
});

test("canonicalizer: control characters escape per RFC 8785", () => {
  assert.equal(canonicalizeJson("a\tb\nc"), '"a\\tb\\nc"');
});

test("canonicalizer: rejects floats", () => {
  assert.throws(() => canonicalizeJson(1.5), /float is not allowed/);
});

test("canonicalizer: rejects unsafe integers", () => {
  assert.throws(() => canonicalizeJson(9007199254740992), /unsafe integer/);
});

test("canonicalizer: rejects lone surrogates", () => {
  assert.throws(() => canonicalizeJson("\uD800"), /lone (high|low) surrogate/);
});

test("canonicalizer: rejects unsupported values", () => {
  assert.throws(() => canonicalizeJson(undefined), /unsupported value/);
  assert.throws(() => canonicalizeJson(10n), /unsupported value/);
});

test("canonicalizer: -0 normalizes to 0", () => {
  assert.equal(canonicalizeJson(-0), "0");
  assert.equal(canonicalizeJson(0), "0");
});

test("digest: eventDigest is excluded from the digest input", () => {
  const ev = {
    protocolVersion: 1, eventId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", eventType: "x",
    organizationId: "org", companyId: "co", workerId: null, jobId: "j",
    attempt: 1, leaseId: null, fenceToken: null, seq: 1, occurredAt: "t",
    payload: {}, eventDigest: "",
  };
  const d = computeEventDigest(ev);
  assert.equal(computeEventDigest({ ...ev, eventDigest: "different" }), d);
  assert.notEqual(computeEventDigest({ ...ev, seq: 2 }), d);
});

test("parseJsonStrict: rejects duplicate object keys", () => {
  assert.throws(() => parseJsonStrict('{"a":1,"a":2}'), /duplicate object key/);
  assert.deepEqual(parseJsonStrict('{"a":1,"b":2}'), { a: 1, b: 2 });
});
