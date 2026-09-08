// -----------------------------------------------------------------------------
// Evidence-ledger immutability guard (node:test).
//
//   node --test scripts/check-evidence-immutability.test.mjs
//
// WHY THESE CASES, AND WHY THEY USE REAL COMMITS.
//
// `checkEvidenceImmutability` has had a passing unit test since FND-005 and has never
// once been handed a real base and candidate tree. Synthetic fixtures proved the
// function; they did not prove the ledger. So the RED case here is not a fixture: it is
// the breach this repository actually committed and merged CI-green —
//   6fc46988a created docs/replatform/epics/E5-workspaces-secrets/qa/
//     2026-08-24-d0-e5-exit-gate-audit-a1.md
//   4379a2c53 rewrote it in place (+24/-4)
// — replayed through the shipping CLI path. If the deny ever stops denying, this test is
// the thing that notices.
//
// Every deny case is paired with a control that must stay GREEN, because "always deny"
// passes a suite made only of red cases.
//
// The last test is the wiring assertion: it goes RED if the caller is deleted from
// pr.yml. That is E0-F014's stated resolution condition for item 3 — "each lever gets a
// production caller and a test that goes red when the caller is removed" — and without
// it this guard could be quietly dropped from CI while its self-test stayed green.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  EVIDENCE_RECORD_RE,
  REPO_ROOT,
  materializeEvidenceTree,
  parseArgs,
  runEvidenceImmutability,
} from "./check-evidence-immutability.mjs";

// The historically breached record and the two commits that bracket the breach.
const BREACHED_RECORD =
  "docs/replatform/epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md";
const RECORD_CREATED = "6fc46988a"; // created BREACHED_RECORD
const RECORD_REWRITTEN = "4379a2c53"; // rewrote it in place, bypassing `Supersedes`
const BEFORE_RECORD = "6fc46988a^"; // BREACHED_RECORD does not exist yet
// Predates docs/replatform/epics entirely: the deny returns zero errors here, which is
// exactly the vacuous green the runner must refuse.
const NO_EVIDENCE_TREE = "0034929882";

test("RED — the real historical breach is caught: an existing record rewritten in place", async () => {
  const result = await runEvidenceImmutability({
    base: RECORD_CREATED,
    candidate: RECORD_REWRITTEN,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /was modified after commit/);
  assert.ok(
    result.errors[0].includes(BREACHED_RECORD),
    `expected the E5 exit-gate record to be named, got: ${result.errors[0]}`,
  );
});

test("POSITIVE CONTROL — an unmodified ledger passes (this is not an always-deny)", async () => {
  const result = await runEvidenceImmutability({
    base: RECORD_CREATED,
    candidate: RECORD_CREATED,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.baseCount > 0, "the control must compare a non-empty ledger");
});

test("POSITIVE CONTROL — adding a new record is permitted (a higher attempt is legal)", async () => {
  const result = await runEvidenceImmutability({
    base: BEFORE_RECORD,
    candidate: RECORD_CREATED,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(
    result.candidateCount,
    result.baseCount + 1,
    "this pair must actually add exactly one record, or it proves nothing",
  );
});

test("RED — deleting or renaming an existing record is caught", async () => {
  const result = await runEvidenceImmutability({
    base: RECORD_CREATED,
    candidate: BEFORE_RECORD,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /was deleted or renamed after commit/);
  assert.ok(result.errors[0].includes(BREACHED_RECORD));
});

test("a base revision with zero evidence records is REFUSED, not silently passed", async () => {
  // Measured before this guard was written: the underlying deny returns ZERO ERRORS for
  // an empty base, indistinguishable from a clean run. A mistyped ref or a shallow clone
  // would disarm the guard without a word.
  const result = await runEvidenceImmutability({
    base: NO_EVIDENCE_TREE,
    candidate: "HEAD",
  });
  assert.equal(result.baseCount, 0);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /ZERO evidence records/);
});

test("an unresolvable revision is REFUSED with a readable reason, not a stack trace", async () => {
  // The realistic causes are a shallow clone and an unexpanded CI expression reaching the
  // shell; both must say so rather than surfacing an execFileSync dump.
  const result = await runEvidenceImmutability({ base: "definitely-not-a-rev" });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /cannot read the base revision/);
  assert.match(result.errors[0], /shallow fetch/);
});

test("a missing base revision is REFUSED — a guard with no base compares nothing", async () => {
  for (const base of ["", "   ", undefined]) {
    const result = await runEvidenceImmutability({ base, candidate: "HEAD" });
    assert.equal(result.ok, false, `base ${JSON.stringify(base)} must be refused`);
    assert.match(result.errors[0], /no base revision supplied/);
  }
});

test("parseArgs takes the base from a flag, an =form, or the environment", () => {
  assert.deepEqual(parseArgs(["--base", "abc", "--candidate", "def"], {}), {
    base: "abc",
    candidate: "def",
  });
  assert.deepEqual(parseArgs(["--base=abc"], {}), { base: "abc", candidate: "" });
  assert.deepEqual(parseArgs([], { EVIDENCE_IMMUTABILITY_BASE: "abc" }), {
    base: "abc",
    candidate: "",
  });
  // An explicit flag beats the environment.
  assert.equal(parseArgs(["--base=flag"], { EVIDENCE_IMMUTABILITY_BASE: "env" }).base, "flag");
});

test("the record pattern matches qa/ and handoffs/ markdown and nothing else", () => {
  assert.ok(EVIDENCE_RECORD_RE.test(BREACHED_RECORD));
  assert.ok(EVIDENCE_RECORD_RE.test("docs/replatform/epics/E1-worker-protocol/handoffs/x.md"));
  assert.ok(!EVIDENCE_RECORD_RE.test("docs/replatform/epics/E1-worker-protocol/qa/README.md"));
  assert.ok(!EVIDENCE_RECORD_RE.test("docs/replatform/epics/E1-worker-protocol/tickets/x.md"));
  assert.ok(!EVIDENCE_RECORD_RE.test("docs/replatform/artifact-policy.md"));
});

test("the materialised base tree is not empty at the current tip", () => {
  // Non-vacuousness: if the epic layout ever moves, every comparison above would compare
  // two empty trees and pass. This pins that the collector still finds real records.
  const tree = materializeEvidenceTree(REPO_ROOT, "HEAD");
  assert.ok(tree.count >= 20, `expected the evidence ledger at HEAD, found ${tree.count} records`);
});

test("WIRING — pr.yml's policy job actually invokes this guard", () => {
  // Goes RED if the caller is removed. E0-F014's resolution condition for item 3.
  const workflow = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "pr.yml"), "utf8");
  assert.ok(
    workflow.includes("scripts/check-evidence-immutability.mjs"),
    "pr.yml must invoke scripts/check-evidence-immutability.mjs — a guard nothing runs is not a guard",
  );
  assert.ok(
    workflow.includes("node --test scripts/check-evidence-immutability.test.mjs"),
    "pr.yml must also run this self-test, or the deny can rot unnoticed",
  );
  assert.ok(
    workflow.includes("github.event.pull_request.base.sha"),
    "the guard must be handed a real merge-base SHA, not left to default",
  );
});
