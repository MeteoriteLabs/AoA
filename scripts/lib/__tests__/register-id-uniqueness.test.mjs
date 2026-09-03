// Self-test for the register-id uniqueness guard.
//
// ★ The tests that matter are the three defects that were live in this repo on 2026-09-03,
// all of the same shape and none of them caught by anything:
//   - `## Decision #104` twice in the LOCKED decisions register, one day apart, on unrelated
//     subjects, cited as load-bearing in four places in CLAUDE.md;
//   - `## E1-F008` twice in one findings register, both severity HIGH, where the ownership
//     guard keys by id so one silently SHADOWED the other;
//   - and the false positive this guard produced on its FIRST run, which is pinned here too:
//     a range roll-up heading is not a second definition.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  evaluateIdUniqueness,
  extractHeadingIds,
  FINDING_HEADING,
  DECISION_HEADING,
  EPIC_DECISION_HEADING,
} from "../register-id-uniqueness.mjs";
import { parseFindings } from "../finding-ownership.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const kinds = (r) => r.problems.map((p) => p.kind);

test("★ the real Decision #104 collision FAILS when undeclared", () => {
  const r = evaluateIdUniqueness({
    sources: [
      {
        file: "docs/architecture/decisions.md",
        kind: "decision",
        ids: [{ id: "103", line: 800 }, { id: "104", line: 854 }, { id: "104", line: 913 }],
      },
    ],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["duplicate_id"]);
  assert.equal(r.problems[0].id, "104");
  // BOTH locations are reported: you cannot decide which side keeps the number without
  // being able to read both entries.
  assert.match(r.problems[0].detail, /decisions\.md:854 and .*decisions\.md:913/);
});

test("★ the real E1-F008 collision FAILS — the ownership guard keys by id, so one shadows the other", () => {
  const r = evaluateIdUniqueness({
    sources: [
      {
        file: "docs/replatform/epics/E1-worker-protocol/findings.md",
        kind: "finding",
        ids: [{ id: "E1-F007", line: 112 }, { id: "E1-F008", line: 96 }, { id: "E1-F008", line: 132 }],
      },
    ],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["duplicate_id"]);
  assert.equal(r.problems[0].id, "E1-F008");
});

test("★ a duplicate ACROSS registers is caught too, not just within one", () => {
  const r = evaluateIdUniqueness({
    sources: [
      { file: "a/findings.md", kind: "finding", ids: [{ id: "E9-F001", line: 3 }] },
      { file: "b/findings.md", kind: "finding", ids: [{ id: "E9-F001", line: 7 }] },
    ],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["duplicate_id"]);
  assert.match(r.problems[0].detail, /a\/findings\.md:3 and b\/findings\.md:7/);
});

test("kinds are separate namespaces — a finding and a decision may share a number", () => {
  const r = evaluateIdUniqueness({
    sources: [
      { file: "decisions.md", kind: "decision", ids: [{ id: "104", line: 1 }] },
      { file: "epic/decisions.md", kind: "epic-decision", ids: [{ id: "E2-D01", line: 1 }] },
      { file: "findings.md", kind: "finding", ids: [{ id: "E1-F001", line: 1 }] },
    ],
  });
  assert.equal(r.ok, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// The waiver: default-deny, with a written declaration.

test("★ a DECLARED duplicate passes and is reported, so it cannot be forgotten", () => {
  const sources = [
    { file: "decisions.md", kind: "decision", ids: [{ id: "104", line: 854 }, { id: "104", line: 913 }] },
  ];
  const r = evaluateIdUniqueness({ sources, waived: { "decision:104": { reason: "awaiting an operator decision" } } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.waived, ["decision:104"]);
});

test("★ a waiver with NO reason is an allow-list entry in a declaration's clothes — it FAILS", () => {
  const sources = [
    { file: "decisions.md", kind: "decision", ids: [{ id: "104", line: 854 }, { id: "104", line: 913 }] },
  ];
  for (const bad of [{}, { reason: "" }, { reason: "   " }, null, "yes"]) {
    const r = evaluateIdUniqueness({ sources, waived: { "decision:104": bad } });
    assert.equal(r.ok, false, `expected failure for waiver ${JSON.stringify(bad)}`);
  }
});

test("★ a waiver may not outlive its duplicate — stale_waiver", () => {
  // Otherwise the file rots into a list of collisions that were fixed years ago, and an
  // untrusted list is the state these guards exist to leave.
  const r = evaluateIdUniqueness({
    sources: [{ file: "decisions.md", kind: "decision", ids: [{ id: "104", line: 854 }] }],
    waived: { "decision:104": { reason: "fixed last week, entry never removed" } },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["stale_waiver"]);
});

test("malformed input fails closed rather than reporting OK", () => {
  for (const bad of [null, undefined, 42, "nope", { sources: null }, { sources: [null] }, { sources: [{}] }]) {
    assert.equal(evaluateIdUniqueness(bad).ok, false, `expected failure for ${JSON.stringify(bad)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Heading extraction.

test("★ a RANGE roll-up heading is not a second definition — the guard's own first false positive", () => {
  // `docs/replatform/epics/E3-job-control/findings.md:1252` is
  // `## E3-F028–E3-F033 — RESOLVED (JOB-003 final acceptance 2026-08-12)`: a resolution
  // roll-up over six findings. The first draft of FINDING_HEADING ended in `\b`, matched
  // `E3-F028` out of it, and reported a duplicate that does not exist. A guard that cries
  // wolf gets switched off — a worse outcome than no guard.
  const ids = extractHeadingIds(
    [
      "## E3-F028 - Bounded pools are not bound to one advisory-lock authority domain",
      "body",
      "## E3-F028–E3-F033 — RESOLVED (JOB-003 final acceptance 2026-08-12)",
    ].join("\n"),
    FINDING_HEADING,
  );
  assert.deepEqual(ids, [{ id: "E3-F028", line: 1 }]);
});

test("heading extraction reads the real shapes and ignores body-text CITATIONS", () => {
  assert.deepEqual(
    extractHeadingIds("## Decision #104 — Keyless (2026-06-26)\nSee Decision #45 and #92.\n", DECISION_HEADING),
    [{ id: "104", line: 1 }],
  );
  assert.deepEqual(
    extractHeadingIds("### E2-D01 — locked\ntext about E2-D03\n", EPIC_DECISION_HEADING),
    [{ id: "E2-D01", line: 1 }],
  );
  assert.deepEqual(extractHeadingIds("## E1-F008 - frozen-consumer checker\n", FINDING_HEADING), [
    { id: "E1-F008", line: 1 },
  ]);
  for (const bad of [null, undefined, 42, {}]) assert.deepEqual(extractHeadingIds(bad, FINDING_HEADING), []);
});

test("★★ this guard and the ownership guard must agree on what a finding IS", () => {
  // `findTicketIds` carries an explicit comment about using the same notion of "a ticket
  // exists" as its neighbour "so the two guards cannot disagree". The same applies here,
  // and it is exactly where the range-roll-up false positive came from: `parseFindings`
  // requires `\s*[—-]` after the id — a class holding an EM dash and a hyphen but NOT the
  // EN dash the roll-up heading uses — so it never saw that heading and this guard did.
  // Run over the REAL registers, so drift in either extractor reds this test.
  const epics = path.join(ROOT, "docs/replatform/epics");
  if (!existsSync(epics)) return;
  for (const entry of readdirSync(epics, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(epics, entry.name, "findings.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    assert.deepEqual(
      extractHeadingIds(text, FINDING_HEADING).map((x) => x.id),
      parseFindings(text).map((f) => f.id),
      `${entry.name}: the uniqueness extractor and parseFindings disagree about which headings are findings`,
    );
  }
});
