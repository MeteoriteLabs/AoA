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
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// -----------------------------------------------------------------------------
// WITHIN-PR INTRODUCTIONS.
//
// A base-to-tip comparison can only see records that already existed on the target branch
// — the case a PR author cannot easily hit. The case they CAN hit is adding a record and
// then rewriting or deleting it in a later commit of the same PR: that path is absent from
// the base tree, so the single comparison returned CLEAN. Measured against the pre-fix
// script in a throwaway repo, both sequences below returned `{ok: true}`.
//
// `artifact-policy.md:54,58,67` makes a record immutable FROM ITS FIRST COMMIT, so these
// use a real throwaway git repository rather than fixtures: the rule is about commits.
// Case (c) is the control that stops "any touched record reds" from passing as a fix, and
// it also lands a LEGITIMATE supersede — a NEW attempt file whose `Supersedes` points back
// at the untouched prior path — which must stay green.
// -----------------------------------------------------------------------------

const QA_DIR = "docs/replatform/epics/E9-throwaway/qa";
const SEED_RECORD = `${QA_DIR}/2026-09-01-d0-seed-000000000000-a1.md`;
const PR_RECORD = `${QA_DIR}/2026-09-02-d0-unit-111111111111-a1.md`;
const SUPERSEDING_RECORD = `${QA_DIR}/2026-09-03-d0-unit-222222222222-a2.md`;

function inRepo(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function writeRecord(root, rel, body) {
  const abs = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function commitAll(root, message) {
  inRepo(root, ["add", "-A"]);
  inRepo(root, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", message]);
  return inRepo(root, ["rev-parse", "HEAD"]);
}

/**
 * A fresh repo whose base commit already holds one evidence record — an empty base is
 * refused by the runner, so seeding it is what makes these cases exercise the new rule and
 * not the empty-base guard.
 */
function throwawayRepo(t) {
  const root = mkdtempSync(path.join(tmpdir(), "evidence-immutability-case-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  inRepo(root, ["init", "-q", "-b", "main"]);
  inRepo(root, ["config", "user.email", "guard@example.invalid"]);
  inRepo(root, ["config", "user.name", "guard"]);
  writeRecord(root, SEED_RECORD, "# seed record\n\n| Supersedes | none |\n");
  return { root, base: commitAll(root, "base: seed evidence ledger") };
}

test("RED — a record ADDED by this PR and REWRITTEN by a later commit of the same PR", async (t) => {
  const { root, base } = throwawayRepo(t);
  writeRecord(root, PR_RECORD, "# unit record\n\n| Supersedes | none |\n| Result | pass |\n");
  const introducing = commitAll(root, "pr: add QA record");
  writeRecord(root, PR_RECORD, "# unit record\n\n| Supersedes | none |\n\nCORRECTION\n");
  const tip = commitAll(root, "pr: quietly correct the QA record in place");

  const result = await runEvidenceImmutability({ repoRoot: root, base, candidate: tip });
  assert.equal(result.ok, false, "a within-PR rewrite must not pass — this was the hole");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /modified again by/);
  assert.ok(result.errors[0].includes(PR_RECORD));
  assert.ok(
    result.errors[0].includes(introducing) && result.errors[0].includes(tip),
    `the error must name the introducing and the offending commit, got: ${result.errors[0]}`,
  );
  assert.equal(result.commitCount, 2, "both PR commits must actually have been walked");
});

test("RED — a record ADDED by this PR and DELETED by a later commit of the same PR", async (t) => {
  const { root, base } = throwawayRepo(t);
  writeRecord(root, PR_RECORD, "# unit record\n\n| Supersedes | none |\n| Result | fail |\n");
  const introducing = commitAll(root, "pr: add QA record");
  rmSync(path.join(root, ...PR_RECORD.split("/")));
  const tip = commitAll(root, "pr: drop the inconvenient QA record");

  const result = await runEvidenceImmutability({ repoRoot: root, base, candidate: tip });
  assert.equal(result.ok, false, "a within-PR deletion must not pass — this was the hole");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /deleted or renamed later in the same pull request/);
  assert.ok(result.errors[0].includes(PR_RECORD));
  assert.ok(result.errors[0].includes(introducing));
});

test("POSITIVE CONTROL — adding a record, and superseding it with a NEW attempt, stays GREEN", async (t) => {
  // If this ever goes red the fix has become "any record this PR touches is a breach",
  // which would forbid the one correction path artifact-policy.md actually prescribes.
  const { root, base } = throwawayRepo(t);
  writeRecord(root, PR_RECORD, "# unit record\n\n| Supersedes | none |\n| Result | fail |\n");
  commitAll(root, "pr: add QA record");
  writeRecord(
    root,
    SUPERSEDING_RECORD,
    `# unit record a2\n\n| Supersedes | \`${PR_RECORD}\` |\n| Result | pass |\n`,
  );
  const tip = commitAll(root, "pr: supersede a1 with a2, prior record untouched");

  const result = await runEvidenceImmutability({ repoRoot: root, base, candidate: tip });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.commitCount, 2, "the control must actually have commits to walk");
  assert.equal(
    result.candidateCount,
    result.baseCount + 2,
    "the control must really add two records, or it proves nothing",
  );
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
  // NOT `workflow.includes("github.event.pull_request.base.sha")`: that substring already
  // appears in pr.yml's pre-existing "Block manual lockfile edits" step, so the assertion
  // was VACUOUSLY TRUE and stayed green even with this guard's env binding deleted. Pin the
  // binding itself — the whole `EVIDENCE_IMMUTABILITY_BASE: ${{ ... }}` line.
  assert.match(
    workflow,
    /^\s*EVIDENCE_IMMUTABILITY_BASE:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}\s*$/m,
    "pr.yml must bind EVIDENCE_IMMUTABILITY_BASE to the PR base SHA — without the binding " +
      "the guard refuses to run and the step fails, but nothing here would have noticed",
  );
});
