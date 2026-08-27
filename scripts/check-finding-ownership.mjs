#!/usr/bin/env node
// Every OPEN finding must name who owns it — or say, on the record, that nobody does.
//
// See `scripts/lib/finding-ownership.mjs` for why this exists. Short version: four
// blockers have reached the top of this programme's critical path unscheduled, three of
// them were ALREADY WRITTEN DOWN in a findings register at severity HIGH, and nothing
// anywhere failed because of it. Noticing had no consequence. This gives it one.
//
// Usage:
//   node scripts/check-finding-ownership.mjs
//   node scripts/check-finding-ownership.mjs --write   # propose entries for new findings

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { evaluateFindingOwnership, parseFindings } from "./lib/finding-ownership.mjs";

export const MANIFEST_RELATIVE_PATH = "scripts/finding-ownership.json";
const EPICS_RELATIVE_PATH = "docs/replatform/epics";

/** Every `findings.md` under the epic tree. */
export function findRegisters(root) {
  const epics = path.join(root, EPICS_RELATIVE_PATH);
  if (!existsSync(epics)) return [];
  return readdirSync(epics, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(EPICS_RELATIVE_PATH, e.name, "findings.md"))
    .filter((rel) => existsSync(path.join(root, rel)))
    .sort();
}

/** Ticket ids that have at least one file on disk — the same notion of "a ticket exists"
 * that `check-ticket-graph-coverage.mjs` uses, so the two guards cannot disagree. */
export function findTicketIds(root) {
  const epics = path.join(root, EPICS_RELATIVE_PATH);
  if (!existsSync(epics)) return [];
  const ids = new Set();
  for (const epic of readdirSync(epics, { withFileTypes: true })) {
    if (!epic.isDirectory()) continue;
    const dir = path.join(epics, epic.name, "tickets");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const m = /^([A-Z]+-\d+)/.exec(file);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

/** Ticket ids with a `-result.md` on disk — the repo's own signal that a ticket shipped.
 * An open finding "owned" by one of these is owned by nothing. */
export function findCompletedTicketIds(root) {
  const epics = path.join(root, EPICS_RELATIVE_PATH);
  if (!existsSync(epics)) return [];
  const ids = new Set();
  for (const epic of readdirSync(epics, { withFileTypes: true })) {
    if (!epic.isDirectory()) continue;
    const dir = path.join(epics, epic.name, "tickets");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const m = /^([A-Z]+-\d+).*-result\.md$/.exec(file);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

export function collectFindings(root) {
  const out = [];
  for (const rel of findRegisters(root)) {
    for (const finding of parseFindings(readFileSync(path.join(root, rel), "utf8"))) {
      out.push({ ...finding, register: rel });
    }
  }
  return out;
}

function loadManifest(root) {
  const file = path.join(root, MANIFEST_RELATIVE_PATH);
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return parsed && typeof parsed === "object" && parsed.findings ? parsed.findings : {};
}

const ROOT = process.cwd();
const findings = collectFindings(ROOT);
const declared = loadManifest(ROOT);
const ticketIds = findTicketIds(ROOT);
const completedTicketIds = findCompletedTicketIds(ROOT);
const result = evaluateFindingOwnership({ findings, declared, ticketIds, completedTicketIds });

if (process.argv.includes("--write")) {
  // Propose entries so the human edits a reason rather than inventing a schema. The
  // proposed status is `unowned` on purpose: `owned` is a claim, and this script is not
  // entitled to make one on someone's behalf.
  const next = { ...declared };
  for (const f of findings.filter((x) => x.status === "open")) {
    if (!next[f.id]) {
      next[f.id] = { status: "unowned", reason: `TODO: ${f.severity} — say what this blocks and what the decision waits on` };
    }
  }
  for (const id of Object.keys(next)) {
    if (!findings.some((f) => f.id === id && f.status === "open")) delete next[id];
  }
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  writeFileSync(path.join(ROOT, MANIFEST_RELATIVE_PATH), `${JSON.stringify({ findings: sorted }, null, 2)}\n`, "utf8");
  console.log(`finding-ownership: wrote ${MANIFEST_RELATIVE_PATH} (${Object.keys(sorted).length} open finding(s))`);
  process.exit(0);
}

const EXPLAIN = {
  undeclared_finding: "open, but no entry in the manifest — say who owns it, or that nobody does",
  malformed_declaration: "entry is not one of owned/unowned/accepted with a reason",
  owner_ticket_missing: "claims a ticket that has no file on disk — a false claim of ownership",
  owner_ticket_already_complete: "owned by a ticket that has already SHIPPED — owned by nothing",
  successor_missing: "owned by a ticket that has SHIPPED but names no `successor` — say which ticket inherits the residual",
  successor_is_self: "the named `successor` is the shipped owner itself — it inherits nothing; name a real successor",
  successor_not_on_disk: "the named `successor` has no file on disk — a false claim of inheritance",
  successor_already_complete: "the named `successor` has ALSO already SHIPPED — the same hole one level down",
  severity_not_acceptable: "a HIGH/CRITICAL may not be 'accepted'; own it or record it as unowned",
  stale_declaration: "declared, but no longer an open finding — remove the entry",
  malformed_input: "internal: the guard was handed something it could not read",
};

if (!result.ok) {
  console.error("finding-ownership: an open finding is not accounted for.\n");
  for (const p of result.problems) {
    const detail = p.detail ? ` (${p.detail})` : "";
    console.error(`  - ${p.finding ?? "(input)"}${detail}: ${EXPLAIN[p.kind] ?? p.kind}`);
  }
  console.error(
    "\nStatuses: owned (names an existing ticket) | unowned (nobody does — say what it blocks)\n" +
      "          | accepted (will not be fixed; not permitted for HIGH/CRITICAL).\n" +
      "Run `node scripts/check-finding-ownership.mjs --write` to propose entries, then write\n" +
      "real reasons. A finding with no ticket is indistinguishable from a finding nobody had.",
  );
  process.exit(1);
}

console.log(`finding-ownership: OK (${result.openCount} open finding(s) across ${findRegisters(ROOT).length} register(s))`);
if (result.unowned.length > 0) {
  // Reported on a GREEN run, deliberately. The point is not to force every finding to have
  // a ticket — it is to make the unscheduled ones impossible to lose sight of.
  console.log(`  UNOWNED, on the record: ${result.unowned.join(", ")}`);
}
