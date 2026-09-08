#!/usr/bin/env node
/**
 * Self-test for `scripts/check-threat-control-audit-debt.mjs`.
 *
 * A GUARD THAT CANNOT BE OBSERVED GOING RED IS NOT A GUARD. Every clause below is driven
 * by a mutation of the REAL tree's collected input, and each mutation is asserted to
 * produce the specific error naming that clause — never merely "some error". The first
 * test is the positive control: the shipped tree passes with zero errors, so a mutation
 * going red is attributable to the mutation and not to a broken harness.
 *
 * Two of the tests are NEGATIVE controls (an input that must NOT red), because two of this
 * guard's rules are narrowings that could silently swallow the thing they exist to catch:
 * the range-span strip in `crossingIdsNamedBy`, and the `delivered` exemption in
 * OWNER-EXISTS.
 *
 * Usage: node --test scripts/check-threat-control-audit-debt.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collect,
  crossingIdsNamedBy,
  evaluateAuditDebt,
  AUDIT_DEBT_JSON,
  THREAT_CONTROLS_JSON,
} from "./check-threat-control-audit-debt.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A deep copy of the real tree's collected input, so a mutation cannot leak between tests. */
function baseInput() {
  return structuredClone(collect(REPO_ROOT));
}

function crossing(input, id) {
  const found = input.crossings.find((c) => c.id === id);
  assert.ok(found, `fixture drift: crossing ${id} is gone from ${THREAT_CONTROLS_JSON}`);
  return found;
}

function hasError(errors, needle) {
  return errors.some((e) => e.includes(needle));
}

const report = (errors) => `errors:\n${errors.map((e) => `  - ${e}`).join("\n") || "  (none)"}`;

// --- POSITIVE CONTROL -------------------------------------------------------------------

test("POSITIVE CONTROL: the shipped tree passes with zero errors", () => {
  const { errors, notes } = evaluateAuditDebt(baseInput());
  assert.deepEqual(errors, [], report(errors));
  assert.ok(notes.some((n) => n.includes("still \"unaudited\" (pinned)")), notes.join("\n"));
});

test("POSITIVE CONTROL: the pin is not vacuous — it counts a real, non-zero debt", () => {
  const input = baseInput();
  assert.ok(
    input.debt.ceilings.unauditedCriticalHigh > 0,
    "a pin of 0 would make RATCHET-PIN's over-arm unreachable for the current tree",
  );
});

// --- RATCHET-PIN ------------------------------------------------------------------------

test("M1 RATCHET-PIN over: a NEW unaudited Critical crossing reds", () => {
  const input = baseInput();
  input.crossings.push({
    id: "DE-99",
    severity: "Critical",
    deliveryStatus: "unaudited",
    ownerTickets: ["TEN-002"],
  });
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "Critical/High crossings are \"unaudited\" but the pin"), report(errors));
  assert.ok(hasError(errors, "DE-99"), report(errors));
});

test("M2 RATCHET-PIN over: an audited crossing regressing to unaudited reds", () => {
  const input = baseInput();
  crossing(input, "DE-01").deliveryStatus = "unaudited";
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "The pin may only go DOWN"), report(errors));
});

test("M3 RATCHET-PIN under: auditing a crossing without lowering the pin reds (self-cleaning)", () => {
  const input = baseInput();
  const target = input.crossings.find((c) => c.deliveryStatus === "unaudited");
  assert.ok(target, "fixture drift: no unaudited crossing left to audit");
  target.deliveryStatus = "partial";
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "Lower ceilings.unauditedCriticalHigh to"), report(errors));
});

test("M4 RATCHET-PIN: a malformed pin reds rather than defaulting", () => {
  const input = baseInput();
  input.debt.ceilings.unauditedCriticalHigh = "sixteen";
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "must be a non-negative integer"), report(errors));
});

test("M5 RATCHET-PIN: a deleted pin reds rather than passing vacuously", () => {
  const input = baseInput();
  delete input.debt.ceilings.unauditedCriticalHigh;
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "must be a non-negative integer"), report(errors));
});

// --- AUDITED-FLOOR ----------------------------------------------------------------------

test("M6 AUDITED-FLOOR: a floor crossing returning to unaudited names itself", () => {
  const input = baseInput();
  crossing(input, "DE-07").deliveryStatus = "unaudited";
  // Raise the pin so RATCHET-PIN is satisfied and only the floor clause can speak.
  input.debt.ceilings.unauditedCriticalHigh += 1;
  const { errors } = evaluateAuditDebt(input);
  assert.ok(
    hasError(errors, "crossing DE-07 is recorded in auditedFloor but has regressed to \"unaudited\""),
    report(errors),
  );
});

test("M7 AUDITED-FLOOR: naming a crossing that does not exist reds", () => {
  const input = baseInput();
  input.debt.auditedFloor.ids.push("DE-99");
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "auditedFloor names DE-99, which is not a crossing"), report(errors));
});

// --- DELIVERED-FLOOR --------------------------------------------------------------------

test("M8 DELIVERED-FLOOR: the one delivered crossing regressing reds and names the row", () => {
  const input = baseInput();
  crossing(input, "DE-02").deliveryStatus = "partial";
  const { errors } = evaluateAuditDebt(input);
  assert.ok(
    hasError(errors, "crossing DE-02 is recorded in deliveredFloor but is now \"partial\""),
    report(errors),
  );
});

test("M9 DELIVERED-FLOOR: naming a crossing that does not exist reds", () => {
  const input = baseInput();
  input.debt.deliveredFloor.ids.push("DE-99");
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "deliveredFloor names DE-99, which is not a crossing"), report(errors));
});

// --- OWNER-EXISTS -----------------------------------------------------------------------

test("M10 OWNER-EXISTS: deleting DE-12's declared deferral reds (the debt cannot become silent)", () => {
  const input = baseInput();
  delete input.debt.ownerTicketDeferrals["DE-12"];
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "crossing DE-12 is \"partial\" and names no ownerTicket with a file on disk"), report(errors));
  assert.ok(hasError(errors, "its audit route terminates nowhere"), report(errors));
});

test("M11 OWNER-EXISTS: a deferral with an empty reason is not a declaration", () => {
  const input = baseInput();
  input.debt.ownerTicketDeferrals["DE-12"] = { reason: "   " };
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "crossing DE-12 is \"partial\" and names no ownerTicket"), report(errors));
});

test("M12 OWNER-EXISTS: a crossing losing its last on-disk owner ticket reds", () => {
  const input = baseInput();
  crossing(input, "DE-06").ownerTickets = ["SVC-002"]; // an id with zero files on disk
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "crossing DE-06 is \"partial\" and names no ownerTicket with a file on disk"), report(errors));
});

test("M13 OWNER-EXISTS: a STALE deferral (its ticket now exists) reds — the entry is self-cleaning", () => {
  const input = baseInput();
  input.ticketIds.push("SVC-002");
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "the ownerTicketDeferrals entry for DE-12 is STALE"), report(errors));
});

test("M14 OWNER-EXISTS: a ghost deferral (no such crossing) reds", () => {
  const input = baseInput();
  input.debt.ownerTicketDeferrals["DE-99"] = { reason: "nothing to see here" };
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "ownerTicketDeferrals names DE-99, which is not a crossing"), report(errors));
});

test("NEGATIVE CONTROL: the `delivered` exemption does not swallow a real orphan", () => {
  // DE-02 is `delivered` and therefore exempt from OWNER-EXISTS. Prove the exemption is
  // keyed on the STATUS and not on the id: the same row, not delivered, must red.
  const input = baseInput();
  const de02 = crossing(input, "DE-02");
  de02.ownerTickets = ["SVC-002"];
  const stillDelivered = evaluateAuditDebt(structuredClone(input));
  assert.ok(!hasError(stillDelivered.errors, "crossing DE-02 is"), report(stillDelivered.errors));
  de02.deliveryStatus = "partial";
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "crossing DE-02 is \"partial\" and names no ownerTicket with a file on disk"), report(errors));
});

// --- FINDING-VISIBLE --------------------------------------------------------------------

test("M15 FINDING-VISIBLE: the DE-11 shape — an unaudited crossing a committed finding is about", () => {
  const input = baseInput();
  crossing(input, "DE-11").deliveryStatus = "unaudited";
  input.debt.ceilings.unauditedCriticalHigh += 1;
  input.debt.auditedFloor.ids = input.debt.auditedFloor.ids.filter((id) => id !== "DE-11");
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "crossing DE-11 is \"unaudited\""), report(errors));
  assert.ok(hasError(errors, "docs/replatform/FINDING-retention-authority-and-DE-11.md"), report(errors));
  assert.ok(hasError(errors, "over the top of an audit that was performed and written down"), report(errors));
});

test("M16 FINDING-VISIBLE: an epic register naming an unaudited crossing reds too (not only top-level docs)", () => {
  const input = baseInput();
  const stillUnaudited = input.crossings.find((c) => c.deliveryStatus === "unaudited");
  assert.ok(stillUnaudited, "fixture drift: no unaudited crossing left");
  input.findingDocuments.push({
    path: "docs/replatform/epics/E0-foundation/findings.md",
    text: `## E0-F999 — a measured absence on ${stillUnaudited.id}`,
  });
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, `crossing ${stillUnaudited.id} is "unaudited"`), report(errors));
});

test("NEGATIVE CONTROL: a RANGE SPAN names a set, not its endpoints, and must not red", () => {
  // `E0-F008` really does contain "the DE-01...DE-30 register ID set". Without the strip,
  // one sentence implicated two crossings it says nothing about — a false positive of
  // exactly the kind that gets a guard switched off.
  const input = baseInput();
  const stillUnaudited = input.crossings.find((c) => c.deliveryStatus === "unaudited");
  input.findingDocuments.push({
    path: "docs/replatform/epics/E0-foundation/findings.md",
    text: "the DE-01...DE-30 register ID set, and the DE-01 - DE-30 span, and DE-01 to DE-30",
  });
  const { errors } = evaluateAuditDebt(input);
  assert.ok(!hasError(errors, `crossing ${stillUnaudited.id} is "unaudited"`), report(errors));
  assert.deepEqual(errors, [], report(errors));
});

test("crossingIdsNamedBy: ranges stripped, genuine mentions kept", () => {
  assert.deepEqual(crossingIdsNamedBy("the DE-01...DE-30 register ID set"), []);
  assert.deepEqual(crossingIdsNamedBy("DE-01 — DE-30"), []);
  assert.deepEqual(crossingIdsNamedBy("DE-11 is not delivered"), ["DE-11"]);
  assert.deepEqual(crossingIdsNamedBy("affects DE-05, DE-07 and DE-10"), ["DE-05", "DE-07", "DE-10"]);
  // A range does NOT license silence about a crossing named separately in the same text.
  assert.deepEqual(crossingIdsNamedBy("the DE-01...DE-30 set, but DE-12 specifically"), ["DE-12"]);
});

test("M17 FINDING-VISIBLE: an orphan top-level FINDING document reds", () => {
  const input = baseInput();
  input.topLevelFindingDocPaths.push("docs/replatform/FINDING-nobody-registered-me.md");
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "docs/replatform/FINDING-nobody-registered-me.md"), report(errors));
  assert.ok(hasError(errors, "can never see it and it can never print as unowned"), report(errors));
});

test("M18 FINDING-VISIBLE: removing E8-F011's reference re-orphans the retention document", () => {
  const input = baseInput();
  for (const doc of input.findingDocuments) {
    if (doc.path.endsWith("/findings.md")) {
      doc.text = doc.text.split("FINDING-retention-authority-and-DE-11.md").join("REDACTED");
    }
  }
  const { errors } = evaluateAuditDebt(input);
  assert.ok(hasError(errors, "docs/replatform/FINDING-retention-authority-and-DE-11.md"), report(errors));
});

// --- FAIL-CLOSED ------------------------------------------------------------------------

test("M19 collect(): an absent audit-debt manifest FAILS rather than reading as an empty allow-list", () => {
  assert.throws(
    () => collect(path.join(REPO_ROOT, "scripts")),
    (e) => e instanceof Error && (e.message.includes(AUDIT_DEBT_JSON) || e.message.includes(THREAT_CONTROLS_JSON)),
  );
});
