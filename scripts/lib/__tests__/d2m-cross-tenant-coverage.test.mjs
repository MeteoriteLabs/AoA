// -----------------------------------------------------------------------------
// DEP-022 — THE SECOND SOURCE for "every case I flipped to `required` has a driver".
//
// E.2.1, in one sentence: *a guard whose input is the file you just wrote can only ever answer
// "is what I wrote well-formed?", never "is what I wrote complete?"*
// `check-campaign-fault-matrix.mjs` validates the declaration against itself, so it is perfectly
// happy with a case flipped to `required` that no driver fires. That mistake is not free: it reds
// the KEYED campaign, and a keyed run costs money to discover it. The E5 exit-gate audit failed on
// the opposite half of the same coin — nine declared cases with no driver at all.
//
// So the declaration is checked against a SECOND source: the driver's own source text. The check
// is TWO-SIDED and prints both lists, because a one-sided one fails in both directions —
// a `required` case with no driver reds the keyed run, and a driver for a case still marked
// `pending` reds the bundle with `pending_case_reported`.
//
// Three cases are excluded by NAME, not by a count: the two per-tenant journeys and the control
// tenant's refusal are decided by the journey's own observations (`faultMatrix` in
// `scripts/m1-shipped-boot/journey.mjs`, DEP-015/DEP-020), not by the cross-tenant phase.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { D2M_PROFILE, JOURNEY_OWNED_CASES } from "../d2m-cross-tenant.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const matrix = JSON.parse(readFileSync(path.join(repoRoot, "tests", "d1", "fault-matrix.json"), "utf8"));
const driver = readFileSync(path.join(repoRoot, "scripts", "m1-shipped-boot", "cross-tenant.mjs"), "utf8");
const journey = readFileSync(path.join(repoRoot, "scripts", "m1-shipped-boot", "journey.mjs"), "utf8");

// ONE list, shared with `scripts/check-cross-tenant-suppression.mjs` — a second copy is a copy
// that drifts, and these two checks are the halves of one property: a case that fires when
// injected and provably does NOT fire when suppression is on.
const PROFILE = D2M_PROFILE;
const JOURNEY_OWNED = JOURNEY_OWNED_CASES;

const profile = matrix.profiles.find((p) => p.profile === PROFILE);
assert.ok(profile, `${PROFILE} is not declared`);

/** A case id the driver files a row for. `record("<id>"` is the only way a row is minted. */
const drivenIds = new Set(
  [...driver.matchAll(/record\(\s*(?:"([^"]+)"|`([^`$]*)\$\{table\}`)/g)]
    .map((m) => m[1] ?? m[2])
    .filter(Boolean),
);
// The legacy four are recorded through a template over the table name; expand them the same way
// the driver's own loop does, from ITS list rather than from memory.
const legacyLoop = driver.match(/for \(const table of \[([^\]]+)\]\)/);
if (legacyLoop) {
  for (const raw of legacyLoop[1].split(",")) {
    const name = raw.trim().replace(/^"|"$/g, "");
    if (name) drivenIds.add(`d2m.tenant.legacy.${name}`);
  }
  drivenIds.delete("d2m.tenant.legacy.");
}

test("EVERY `required` case in the profile has a driver — the declaration checked against a second source", () => {
  const required = profile.cases.filter((c) => c.evidence === "required").map((c) => c.case);
  const journeyOwned = required.filter((id) => JOURNEY_OWNED.includes(id));
  const needDriver = required.filter((id) => !JOURNEY_OWNED.includes(id));
  const missing = needDriver.filter((id) => !drivenIds.has(id));
  assert.deepEqual(missing, [],
    `these cases are declared \`required\` but no driver files a row for them; a keyed run would red with ` +
    `\`case_not_run\` AFTER it had already spent:\n  ${missing.join("\n  ")}`);
  // Non-vacuity: if the exclusion list ever swallowed the whole set, `missing` would be empty for
  // the wrong reason.
  assert.equal(journeyOwned.length, JOURNEY_OWNED.length,
    `the journey-owned exclusions must all still be declared \`required\`: ${JSON.stringify(journeyOwned)}`);
  assert.ok(needDriver.length >= 14, `expected at least 14 driver-owned required cases, saw ${needDriver.length}`);
});

test("THE DUAL: no driver files a row for a case still declared `pending`", () => {
  const pending = new Set(profile.cases.filter((c) => c.evidence === "pending").map((c) => c.case));
  const stale = [...drivenIds].filter((id) => pending.has(id));
  assert.deepEqual(stale, [],
    `these cases have a driver but are still declared \`pending\`; the bundle would be REFUSED with ` +
    `\`pending_case_reported\`:\n  ${stale.join("\n  ")}`);
});

test("every id the driver files is DECLARED in the profile at all", () => {
  const declared = new Set(profile.cases.map((c) => c.case));
  const undeclared = [...drivenIds].filter((id) => !declared.has(id));
  assert.deepEqual(undeclared, [], `the driver files rows for undeclared cases: ${undeclared.join(", ")}`);
});

test("the three journey-owned cases really are decided by the journey, not by the cross-tenant phase", () => {
  for (const id of JOURNEY_OWNED) {
    assert.ok(journey.includes(id), `journey.mjs must decide ${id}`);
    assert.ok(!drivenIds.has(id), `${id} must NOT also be filed by the cross-tenant driver (duplicate_row)`);
  }
});

test("NON-VACUITY: the extraction actually found ids", () => {
  assert.ok(drivenIds.size >= 14, `only ${drivenIds.size} case id(s) extracted from the driver — the extraction is broken, not the driver`);
});

test("\u2605 `injectionFired` is an OBSERVATION, never the suppression flag (the tautology guard)", () => {
  // Codex P1, PR #600 round 5. Every row used to compute `injectionFired: injected && <fact>`,
  // where `injected` is exactly `!suppressInjection` -- so a regression that ran the hostile arm
  // WITH suppression on would still record `false` everywhere, and
  // `scripts/check-cross-tenant-suppression.mjs` (the control added to catch precisely that) would
  // accept every case. *A control whose input is the flag it is checking is not a control.*
  //
  // Pinned in SOURCE, because it is a property of how the row is COMPUTED, and no runtime fixture
  // can distinguish "false because suppressed" from "false because derived from the flag".
  const rows = [...driver.matchAll(/injectionFired:\s*([^,\n]*)/g)].map((m) => m[1].trim());
  assert.ok(rows.length >= 14, `expected at least 14 injectionFired computations, saw ${rows.length}`);
  const tautological = rows.filter((r) => /\binjected\b|\bsuppressInjection\b/.test(r));
  assert.deepEqual(tautological, [], `an injectionFired derived from the suppression flag makes the suppression control tautological: ${JSON.stringify(tautological)}`);
});

test("the suppression SKIP sentinel is distinguishable from a real response", () => {
  // The observations above are only meaningful if a skipped call cannot look like a performed one:
  // `status: 0` is not a real HTTP status and `total: null` is not a row count.
  assert.ok(driver.includes('const SKIPPED = Object.freeze({ status: 0, body: null, suppressed: true })'),
    "the skip sentinel must carry a non-HTTP status, or a skipped call is indistinguishable from a performed one");
  assert.ok(driver.includes('const httpFired = (r) => typeof r?.status === "number" && r.status !== 0;'),
    "the fired predicate must read the response status, not the flag");
});
