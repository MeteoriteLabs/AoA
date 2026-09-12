#!/usr/bin/env node
/**
 * Self-test for `scripts/check-register-citation-integrity.mjs`.
 *
 * A GUARD WITH NO POSITIVE CONTROL IS ITSELF THE FAILURE CLASS IT FIGHTS. The first test is the
 * positive control: the shipped tree passes with zero errors, so a red below is attributable to
 * the mutation and not to a broken harness. Every check (a/b/c/d), the grandfather arm, and the
 * fail-closed posture is then driven to RED by a specific mutation, and each red is asserted to
 * carry the message naming that check — never merely "some error". NEGATIVE controls prove the
 * scope narrowings (bare refs, unanchored paths, comment/import lines) do NOT swallow, and do NOT
 * over-fire.
 *
 * Usage: node --test scripts/check-register-citation-integrity.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collect,
  evaluateCitationIntegrity,
  parseCitations,
  anchorVariants,
  isAnchored,
  GRANDFATHER_JSON,
} from "./check-register-citation-integrity.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = (errors) => `errors:\n${errors.map((e) => `  - ${e}`).join("\n") || "  (none)"}`;
const hasError = (errors, needle) => errors.some((e) => e.includes(needle));

/** A default in-scope, explicit, repo-anchored citation. */
function cit(overrides = {}) {
  return {
    crossingId: "DE-01",
    field: "deliveryEvidence",
    path: "server/src/foo.ts",
    line: "2",
    kind: "explicit-slash",
    anchored: true,
    inScope: true,
    anchorToken: null,
    ...overrides,
  };
}

/** A minimal pure input: some citations, a files map, and an (optional) grandfather list. */
function makeInput({ citations = [], files = {}, entries = [] } = {}) {
  return { citations, files, grandfather: { version: 1, entries } };
}

// --- POSITIVE CONTROL -------------------------------------------------------------------

test("POSITIVE CONTROL: the shipped tree passes with zero errors", () => {
  const { errors, notes } = evaluateCitationIntegrity(collect(REPO_ROOT));
  assert.deepEqual(errors, [], report(errors));
  assert.ok(notes.some((n) => n.includes("enforced")), notes.join("\n"));
});

test("POSITIVE CONTROL: the enforced set is non-trivial (the guard actually checks something)", () => {
  const { notes } = evaluateCitationIntegrity(collect(REPO_ROOT));
  const m = /(\d+) enforced/.exec(notes.join("\n"));
  assert.ok(m && Number(m[1]) > 100, `expected >100 enforced citations, got note: ${notes.join("\n")}`);
});

// --- (a) EXISTS -------------------------------------------------------------------------

test("(a) EXISTS: a cited file that does not exist at HEAD reds", () => {
  const input = makeInput({
    citations: [cit({ path: "server/src/gone.ts", line: "5" })],
    files: { "server/src/gone.ts": { exists: false, lines: [] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "cited file does not exist at HEAD"), report(errors));
  assert.ok(hasError(errors, "server/src/gone.ts:5"), report(errors));
});

test("(a) EXISTS on the REAL tree: deleting a real cited file reds", () => {
  const input = collect(REPO_ROOT);
  const target = input.citations.find((c) => c.inScope);
  assert.ok(target, "fixture drift: no in-scope citation found");
  input.files[target.path] = { exists: false, lines: [] };
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "cited file does not exist at HEAD"), report(errors));
});

// --- (b) IN-RANGE -----------------------------------------------------------------------

test("(b) IN-RANGE: a line past the end of the file reds", () => {
  const input = makeInput({
    citations: [cit({ line: "99" })],
    files: { "server/src/foo.ts": { exists: true, lines: ["a", "b", "c"] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "is outside the file, which has 3 lines"), report(errors));
});

test("(b) IN-RANGE: a range whose upper bound overshoots reds", () => {
  const input = makeInput({
    citations: [cit({ line: "2-9" })],
    files: { "server/src/foo.ts": { exists: true, lines: ["a", "b", "c"] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "line 2-9 is outside the file"), report(errors));
});

test("(b) IN-RANGE on the REAL tree: bumping a real citation past EOF reds (the PR #443 rot class)", () => {
  const input = collect(REPO_ROOT);
  const target = input.citations.find((c) => c.inScope && input.files[c.path]?.exists);
  assert.ok(target, "fixture drift: no resolvable in-scope citation");
  const beyond = String(input.files[target.path].lines.length + 25);
  target.line = beyond;
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "is outside the file"), report(errors));
});

// --- (c) REACHES-REAL-CODE --------------------------------------------------------------

test("(c) REACHES-CODE: a single-line code citation onto a BLANK line reds", () => {
  const input = makeInput({
    citations: [cit({ line: "2" })],
    files: { "server/src/foo.ts": { exists: true, lines: ["const x = 1;", "   ", "const y = 2;"] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "cites a BLANK line"), report(errors));
});

test("NEGATIVE CONTROL (c): a citation onto a COMMENT line passes — the register cites comments on purpose", () => {
  const input = makeInput({
    citations: [cit({ line: "2" })],
    files: { "server/src/foo.ts": { exists: true, lines: ["code();", "// a deliberately-cited comment", "more();"] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.deepEqual(errors, [], report(errors));
});

test("NEGATIVE CONTROL (c): a citation onto an IMPORT line passes", () => {
  const input = makeInput({
    citations: [cit({ line: "1" })],
    files: { "server/src/foo.ts": { exists: true, lines: ['import { x } from "./x";', "", "x();"] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.deepEqual(errors, [], report(errors));
});

test("NEGATIVE CONTROL (c): a blank line in a NON-code file (.md/.sql) does not red — (c) is code-only", () => {
  const input = makeInput({
    citations: [cit({ path: "docs/x.md", line: "2" })],
    files: { "docs/x.md": { exists: true, lines: ["# heading", "", "body"] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.deepEqual(errors, [], report(errors));
});

test("NEGATIVE CONTROL (c): a blank line inside a RANGE citation does not red — (c) is single-line only", () => {
  const input = makeInput({
    citations: [cit({ line: "1-3" })],
    files: { "server/src/foo.ts": { exists: true, lines: ["a();", "", "b();"] } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.deepEqual(errors, [], report(errors));
});

// --- (d) SYMBOL ANCHOR ------------------------------------------------------------------

test("(d) ANCHOR: an adjacent backtick token absent from ±3 lines reds", () => {
  const lines = ["l1", "l2", "l3", "l4", "l5", "l6", "l7 admit()", "l8", "l9", "l10"]; // admit at line 7
  const input = makeInput({
    citations: [cit({ line: "2", anchorToken: "admit()" })], // cited line 2, admit is 5 away
    files: { "server/src/foo.ts": { exists: true, lines } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "the adjacent anchor `admit()` does not appear within ±3 lines"), report(errors));
});

test("POSITIVE CONTROL (d): the same anchor within ±3 lines passes (variant match strips `()`)", () => {
  const lines = ["l1", "return admit(payload);", "l3"]; // admit on line 2
  const input = makeInput({
    citations: [cit({ line: "1", anchorToken: "admit()" })], // cited line 1, admit on line 2 → within ±3
    files: { "server/src/foo.ts": { exists: true, lines } },
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.deepEqual(errors, [], report(errors));
});

test("(d) ANCHOR: the wrong-line mutation the task requires — move the cited line off its construct", () => {
  // A correct citation, then the line is moved far from the construct; only the anchor arm can red.
  const lines = Array.from({ length: 40 }, (_, i) => (i === 9 ? "  insertJobOnce(row);" : `line ${i + 1}`));
  const good = makeInput({
    citations: [cit({ line: "10", anchorToken: "insertJobOnce" })],
    files: { "server/src/foo.ts": { exists: true, lines } },
  });
  assert.deepEqual(evaluateCitationIntegrity(good).errors, [], "the correct citation must be green first");
  const moved = makeInput({
    citations: [cit({ line: "30", anchorToken: "insertJobOnce" })], // construct is at 10, cite says 30
    files: { "server/src/foo.ts": { exists: true, lines } },
  });
  const { errors } = evaluateCitationIntegrity(moved);
  assert.ok(hasError(errors, "the adjacent anchor `insertJobOnce` does not appear within ±3 lines"), report(errors));
});

// --- BEST-EFFORT SCOPE (negative controls) ----------------------------------------------

test("NEGATIVE CONTROL: an out-of-range BARE :LINE ref does NOT red (bare refs are best-effort)", () => {
  const input = makeInput({
    citations: [cit({ kind: "bare", inScope: false, anchored: false, line: "9999" })],
    files: {},
  });
  const { errors, notes } = evaluateCitationIntegrity(input);
  assert.deepEqual(errors, [], report(errors));
  assert.ok(notes.some((n) => n.includes("1 bare :LINE")), notes.join("\n"));
});

test("NEGATIVE CONTROL: an unanchored/relative path does NOT red (out of scope)", () => {
  const input = makeInput({
    citations: [cit({ path: "routes/projects.ts", anchored: false, inScope: false, line: "5" })],
    files: {},
  });
  const { errors, notes } = evaluateCitationIntegrity(input);
  assert.deepEqual(errors, [], report(errors));
  assert.ok(notes.some((n) => n.includes("1 unanchored")), notes.join("\n"));
});

// --- GRANDFATHER ------------------------------------------------------------------------

test("GRANDFATHER: a grandfathered violation passes; removing the entry re-reds", () => {
  const citations = [cit({ crossingId: "DE-05", path: "server/src/legacy.ts", line: "500" })];
  const files = { "server/src/legacy.ts": { exists: true, lines: ["only one line"] } }; // 500 is out of range
  const withGf = evaluateCitationIntegrity(makeInput({
    citations,
    files,
    entries: [{ crossing: "DE-05", path: "server/src/legacy.ts", line: "500", reason: "frozen historical block; code since moved" }],
  }));
  assert.deepEqual(withGf.errors, [], report(withGf.errors));
  const withoutGf = evaluateCitationIntegrity(makeInput({ citations, files }));
  assert.ok(hasError(withoutGf.errors, "is outside the file"), report(withoutGf.errors));
});

test("GRANDFATHER: a STALE entry (its citation no longer violates) reds — self-cleaning", () => {
  const input = makeInput({
    citations: [cit({ crossingId: "DE-05", path: "server/src/foo.ts", line: "1" })],
    files: { "server/src/foo.ts": { exists: true, lines: ["real();"] } }, // line 1 is valid — NOT a violation
    entries: [{ crossing: "DE-05", path: "server/src/foo.ts", line: "1", reason: "stale — was drift, now fixed" }],
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "is STALE"), report(errors));
});

test("GRANDFATHER: an entry with an empty reason reds", () => {
  const input = makeInput({
    citations: [cit({ path: "server/src/legacy.ts", line: "500" })],
    files: { "server/src/legacy.ts": { exists: true, lines: ["x"] } },
    entries: [{ crossing: "DE-01", path: "server/src/legacy.ts", line: "500", reason: "   " }],
  });
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, "needs a non-empty"), report(errors));
});

test("GRANDFATHER: a malformed entries array (missing) reds fail-closed", () => {
  const input = { citations: [], files: {}, grandfather: { version: 1 } };
  const { errors } = evaluateCitationIntegrity(input);
  assert.ok(hasError(errors, 'must be a JSON object with an "entries" array'), report(errors));
});

// --- FAIL-CLOSED ------------------------------------------------------------------------

test("collect(): an absent manifest FAILS rather than reading as an empty allow-list", () => {
  assert.throws(
    () => collect(path.join(REPO_ROOT, "scripts")),
    (e) => e instanceof Error && (e.message.includes(GRANDFATHER_JSON) || e.message.includes("threat-controls.json")),
  );
});

// --- PARSER -----------------------------------------------------------------------------

test("parseCitations: explicit slash + range, and bare :LINE attribution to the most recent path", () => {
  const cits = parseCitations("see server/src/a.ts:10 and packages/db/b.ts:20-25, then :30 in the same file");
  assert.deepEqual(cits.map((c) => `${c.path}:${c.line}:${c.kind}`), [
    "server/src/a.ts:10:explicit-slash",
    "packages/db/b.ts:20-25:explicit-slash",
    "packages/db/b.ts:30:bare",
  ]);
});

test("parseCitations: a bare filename with a line is explicit-filename (no directory)", () => {
  const cits = parseCitations("worker-session-auth.ts:103 handles it");
  assert.equal(cits.length, 1);
  assert.equal(cits[0].kind, "explicit-filename");
  assert.equal(cits[0].path, "worker-session-auth.ts");
});

test("parseCitations: a backtick anchor after the citation is captured", () => {
  const cits = parseCitations("the gate at server/src/a.ts:10 (`admit()`) denies");
  assert.equal(cits[0].anchorToken, "admit()");
});

test("parseCitations: a backtick anchor before the path is captured", () => {
  const cits = parseCitations("`insertJobOnce` at packages/db/b.ts:20 inserts once");
  assert.equal(cits[0].anchorToken, "insertJobOnce");
});

test("anchorVariants: strips call parens and yields the leading identifier", () => {
  assert.deepEqual(anchorVariants("admit()"), ["admit()", "admit"]);
  assert.ok(anchorVariants("count > config.max").includes("count > config.max"));
});

test("isAnchored: only a slash-path whose first segment is a top-level dir", () => {
  const top = new Set(["server", "packages"]);
  assert.equal(isAnchored("server/src/a.ts", top), true);
  assert.equal(isAnchored("routes/a.ts", top), false); // relative shorthand
  assert.equal(isAnchored("a.ts", top), false); // filename-only
});
