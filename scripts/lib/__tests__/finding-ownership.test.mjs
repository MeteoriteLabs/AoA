// Self-test for the finding-ownership guard.
//
// ★ The tests that matter are the two failure modes this guard exists for:
//   - an OPEN finding with no entry at all (how E4-F007 stayed invisible while sitting in
//     the register at severity HIGH for weeks), and
//   - an entry CLAIMING a ticket that does not exist (a false claim of ownership, which is
//     worse than no claim because it converts an open question into a settled one).

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateFindingOwnership, parseFindings } from "../finding-ownership.mjs";

const OPEN_HIGH = { id: "E4-F007", status: "open", severity: "HIGH", title: "no session renewal" };
const OPEN_LOW = { id: "E6-F005", status: "open", severity: "LOW", title: "nit" };
const RESOLVED = { id: "E1-F001", status: "resolved_in_plan", severity: "HIGH", title: "done" };

const kinds = (r) => r.problems.map((p) => p.kind);

test("★ an OPEN finding with no declaration FAILS — the E4-F007 case", () => {
  const r = evaluateFindingOwnership({ findings: [OPEN_HIGH], declared: {}, ticketIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["undeclared_finding"]);
  assert.equal(r.problems[0].finding, "E4-F007");
  // The severity is carried so the report can lead with what actually blocks the programme.
  assert.equal(r.problems[0].detail, "HIGH");
});

test("★ claiming a ticket that does not exist FAILS — a false claim of ownership", () => {
  const r = evaluateFindingOwnership({
    findings: [OPEN_HIGH],
    declared: { "E4-F007": { status: "owned", ticket: "WRK-042", reason: "server-side renewal" } },
    ticketIds: ["WRK-008", "DAT-008"],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["owner_ticket_missing"]);
  assert.equal(r.problems[0].detail, "WRK-042");
});

test("★ owned by a ticket that has ALREADY SHIPPED fails — owned by nothing", () => {
  // The state E6-F003 (HIGH, "resolve at DEP-000") and E6-F008 ("resolve before CLI-001")
  // are already in. The register reads like ownership until you check whether the owner is
  // still open, and nothing was checking. Post-E4-F013 a shipped owner with NEITHER prose
  // NOR a successor trips BOTH arms in order — "which part is still open" (owner_ticket_
  // already_complete) and "who inherits it" (successor_missing).
  const r = evaluateFindingOwnership({
    findings: [OPEN_HIGH],
    declared: { "E4-F007": { status: "owned", ticket: "DEP-000", reason: "resolve there" } },
    ticketIds: ["DEP-000"],
    completedTicketIds: ["DEP-000"],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["owner_ticket_already_complete", "successor_missing"]);
  assert.equal(r.problems[0].detail, "DEP-000");
});

test("★ naming a part-shipped ticket is allowed ONLY by writing what is still open", () => {
  // The calibration case, and it is real: WRK-008 has result docs for slices 1 and 2a while
  // slice 2b is open. Failing outright would be a false positive on the first real entry,
  // and a guard that cries wolf gets switched off. Saying which part remains is a sentence
  // nobody can write honestly when the answer is "nothing".
  // Post-E4-F013 a shipped owner also needs an on-disk successor; supply a fixed valid one
  // (WRK-012 — on disk, not itself, not shipped) so THIS test isolates the prose arm.
  const declared = (extra) => ({
    "E4-F007": { status: "owned", ticket: "WRK-008", reason: "lands in the live-dispatch wiring", successor: "WRK-012", ...extra },
  });
  const args = { findings: [OPEN_HIGH], ticketIds: ["WRK-008", "WRK-012"], completedTicketIds: ["WRK-008"] };

  assert.equal(evaluateFindingOwnership({ ...args, declared: declared({}) }).ok, false);
  assert.equal(evaluateFindingOwnership({ ...args, declared: declared({ ownerStillOpen: "   " }) }).ok, false);
  assert.equal(
    evaluateFindingOwnership({ ...args, declared: declared({ ownerStillOpen: "slice 2b composes the loop" }) }).ok,
    true,
  );
});

test("owned by a ticket that exists and is still open passes", () => {
  const r = evaluateFindingOwnership({
    findings: [OPEN_HIGH],
    declared: { "E4-F007": { status: "owned", ticket: "WRK-008", reason: "renewal successor" } },
    ticketIds: ["WRK-008", "DEP-000"],
    completedTicketIds: ["DEP-000"],
  });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test("owned + an existing ticket passes", () => {
  const r = evaluateFindingOwnership({
    findings: [OPEN_HIGH],
    declared: { "E4-F007": { status: "owned", ticket: "WRK-008", reason: "renewal successor" } },
    ticketIds: ["WRK-008"],
  });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test("★ unowned is PERMITTED but must say why — that is the honest state, not a hidden one", () => {
  const withReason = evaluateFindingOwnership({
    findings: [OPEN_HIGH],
    declared: { "E4-F007": { status: "unowned", reason: "blocks MIG-005/006/007 ACTIVE; awaiting E3-vs-E4 call" } },
    ticketIds: [],
  });
  assert.equal(withReason.ok, true, JSON.stringify(withReason.problems));
  // And it is REPORTED, so a green run still tells the reader what is unscheduled.
  assert.deepEqual(withReason.unowned, ["E4-F007"]);

  const withoutReason = evaluateFindingOwnership({
    findings: [OPEN_HIGH],
    declared: { "E4-F007": { status: "unowned", reason: "  " } },
    ticketIds: [],
  });
  assert.equal(withoutReason.ok, false);
  assert.deepEqual(kinds(withoutReason), ["malformed_declaration"]);
});

test("★ a HIGH may not be quietly 'accepted' — a LOW may", () => {
  const high = evaluateFindingOwnership({
    findings: [OPEN_HIGH],
    declared: { "E4-F007": { status: "accepted", reason: "not worth it" } },
    ticketIds: [],
  });
  assert.equal(high.ok, false);
  assert.deepEqual(kinds(high), ["severity_not_acceptable"]);

  const low = evaluateFindingOwnership({
    findings: [OPEN_LOW],
    declared: { "E6-F005": { status: "accepted", reason: "nit; the transitive dep list is stable" } },
    ticketIds: [],
  });
  assert.equal(low.ok, true, JSON.stringify(low.problems));
});

test("a declaration for a finding that is no longer open FAILS as stale", () => {
  // A manifest carrying dead entries rots into a list nobody trusts, which is the state
  // this guard is trying to leave.
  const r = evaluateFindingOwnership({
    findings: [RESOLVED],
    declared: { "E1-F001": { status: "owned", ticket: "PRT-001", reason: "fixed" } },
    ticketIds: ["PRT-001"],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["stale_declaration"]);
});

test("non-open findings need no declaration at all", () => {
  const r = evaluateFindingOwnership({ findings: [RESOLVED], declared: {}, ticketIds: [] });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.openCount, 0);
});

test("malformed input fails closed rather than reporting OK", () => {
  for (const bad of [null, undefined, 42, "nope", {}, { findings: [], declared: null }]) {
    assert.equal(evaluateFindingOwnership(bad).ok, false, `expected failure for ${JSON.stringify(bad)}`);
  }
});

test("parseFindings reads id, status and severity from the real register shape", () => {
  const text = [
    "# Findings",
    "",
    "## E4-F007 — JOB-002 provides no sustained worker-session renewal",
    "",
    "**Status:** `open` · escalated to **E3/JOB-002** · Severity: HIGH (blocks long-running workers)",
    "",
    "Body text.",
    "",
    "## E4-F008 — something else",
    "",
    "**Status:** `open` · Severity: LOW",
  ].join("\n");
  const parsed = parseFindings(text);
  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map((f) => [f.id, f.status, f.severity]),
    [["E4-F007", "open", "HIGH"], ["E4-F008", "open", "LOW"]],
  );
});

test("★ a finding with no parseable Status is NOT treated as open", () => {
  // Guessing would make the guard noisy, and a noisy guard gets switched off — which is a
  // worse outcome than a narrower guard that is trusted.
  const parsed = parseFindings("## E9-F001 — no status line here\n\nBody.");
  assert.equal(parsed[0].status, "unknown");
  assert.equal(evaluateFindingOwnership({ findings: parsed, declared: {}, ticketIds: [] }).ok, true);
});

test("parseFindings tolerates junk without throwing", () => {
  for (const bad of [null, undefined, 42, {}, ""]) {
    assert.deepEqual(parseFindings(bad), []);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// E4-F013 — a SHIPPED owner must ALSO name a checkable `successor`.
//
// `ownerStillOpen` (prose: which part of the shipped ticket survives) is kept and
// still required; `successor` is added as the machine-checkable pointer to the
// ticket that inherits the residual. When `owned && completed.has(ticket)`, five
// arms fire in order — owner_ticket_already_complete (no prose), then a mutually
// exclusive successor cascade: successor_missing → successor_is_self →
// successor_not_on_disk → successor_already_complete. Each arm gets a RED test here
// and a DELETE mutation in E4-F013-ownership-successor-result.md.
//
// Fixtures model V5/V6: REL-003 SHIPPED (has a result doc) owns E11-F002; DBR-001
// is its filed successor stub — it exists on disk but has NOT shipped.
const OPEN_MED = { id: "E11-F002", status: "open", severity: "MED", title: "restore has no operator entrypoint" };
const shipped = (extra) => ({
  "E11-F002": { status: "owned", ticket: "REL-003", reason: "restore leg has no operator entrypoint", ...extra },
});

test("★ E4-F013 positive control — shipped owner + prose + on-disk successor PASSES", () => {
  // Asserted BEFORE any refusal case (E1-F008: a refusal test that goes green for an
  // unrelated reason proves nothing). This IS E11-F002 after the migration.
  const r = evaluateFindingOwnership({
    findings: [OPEN_MED],
    declared: shipped({ ownerStillOpen: "restore leg owed; runDatabaseRestore has no CLI caller", successor: "DBR-001" }),
    ticketIds: ["REL-003", "DBR-001"],
    completedTicketIds: ["REL-003"],
  });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test("★ E4-F013 successor_missing — a shipped owner naming NO successor FAILS", () => {
  // E11-F002 BEFORE the migration: prose alone used to pass. The original E4-F013 hole.
  const r = evaluateFindingOwnership({
    findings: [OPEN_MED],
    declared: shipped({ ownerStillOpen: "restore leg owed" }),
    ticketIds: ["REL-003", "DBR-001"],
    completedTicketIds: ["REL-003"],
  });
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes("successor_missing"), JSON.stringify(kinds(r)));
  assert.equal(r.problems.find((p) => p.kind === "successor_missing").detail, "REL-003");
});

test("★ E4-F013 successor_is_self — a shipped owner naming ITSELF reopens the exact hole", () => {
  // Mirrors dependency-graph.mjs's `dep === id` self-check. Without it, an author could
  // write E11-F002's successor as its own shipped owner REL-003 + prose and pass everything.
  const r = evaluateFindingOwnership({
    findings: [OPEN_MED],
    declared: shipped({ ownerStillOpen: "restore leg owed", successor: "REL-003" }),
    ticketIds: ["REL-003", "DBR-001"],
    completedTicketIds: ["REL-003"],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["successor_is_self"]);
  assert.equal(r.problems[0].detail, "REL-003");
});

test("★ E4-F013 successor_not_on_disk — a successor with no file is a false claim of inheritance", () => {
  // The case the required mutation (DELETE the existence check) neutralises: without it
  // this bogus entry passes — the finding's exact hole, one field over.
  const r = evaluateFindingOwnership({
    findings: [OPEN_MED],
    declared: shipped({ ownerStillOpen: "restore leg owed", successor: "DBR-999" }),
    ticketIds: ["REL-003", "DBR-001"],
    completedTicketIds: ["REL-003"],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["successor_not_on_disk"]);
  assert.equal(r.problems[0].detail, "DBR-999");
});

test("★ E4-F013 successor_already_complete — a SHIPPED successor is the same hole one level down", () => {
  // `completed` is already in scope, so this strengthening is free. DEP-000 exists AND has
  // a result doc → naming it as the inheritor inherits nothing.
  const r = evaluateFindingOwnership({
    findings: [OPEN_MED],
    declared: shipped({ ownerStillOpen: "restore leg owed", successor: "DEP-000" }),
    ticketIds: ["REL-003", "DBR-001", "DEP-000"],
    completedTicketIds: ["REL-003", "DEP-000"],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["successor_already_complete"]);
  assert.equal(r.problems[0].detail, "DEP-000");
});

test("★ E4-F013 a NON-shipped owner needs no successor — the three repointed stubs stay green", () => {
  // Scope is `completed.has(ticket)`: WRK-012 / WRK-013 / DEP-011 have no result doc, so the
  // whole block is skipped for them and they neither need nor may carry a successor.
  const r = evaluateFindingOwnership({
    findings: [OPEN_MED],
    declared: { "E11-F002": { status: "owned", ticket: "DBR-001", reason: "successor not shipped yet" } },
    ticketIds: ["REL-003", "DBR-001"],
    completedTicketIds: ["REL-003"],
  });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test("★ E4-F013 calibration preserved — a valid successor does NOT waive the prose requirement", () => {
  // The V2 calibration still bites: a shipped owner with a perfect on-disk successor but no
  // `ownerStillOpen` still fails, because "which part is still open" is left unanswered.
  const r = evaluateFindingOwnership({
    findings: [OPEN_MED],
    declared: shipped({ successor: "DBR-001" }),
    ticketIds: ["REL-003", "DBR-001"],
    completedTicketIds: ["REL-003"],
  });
  assert.equal(r.ok, false);
  assert.ok(kinds(r).includes("owner_ticket_already_complete"), JSON.stringify(kinds(r)));
});
