#!/usr/bin/env node
/**
 * check-threat-control-audit-debt.mjs — W20.
 *
 * A CHECK THAT NOTHING RUNS IS NOT A CHECK. A REGISTER NOTHING COUNTS IS NOT A REGISTER.
 *
 * `docs/architecture/distributed-execution-threat-controls.json` holds thirty trust-boundary
 * crossings, every one of them Critical or High. Two existing guards touch it and NEITHER
 * could see the debt sitting in it:
 *
 *   - `scripts/check-distributed-execution-foundation.mjs` validates the SHAPE of
 *     `deliveryStatus` (known value, evidence present, findings cited, no `delivered` claim
 *     a live finding contradicts). It imposes NO CAP, NO DEADLINE AND NO COUNT on
 *     `unaudited`. Twenty-eight Critical/High controls sat unaudited with policy green.
 *   - `scripts/check-finding-ownership.mjs` globs only `docs/replatform/epics/<epic>/findings.md`
 *     (`findRegisters`, :29-37). A top-level `docs/replatform/FINDING-*.md` is outside that
 *     glob, so a committed hand audit could never print as unowned. One did: the retention
 *     audit of DE-11 concluded all four of that crossing's controls were absent while the
 *     register row said, in those words, "no delivery audit has been performed for this
 *     crossing". Two committed records of one crossing said opposite things and nothing
 *     anywhere asked.
 *
 * This guard gives noticing a consequence, in five clauses. Every one of them is a
 * COUNTING or CROSS-REFERENCE rule over committed text. NOTHING HERE READS A TEST, RUNS A
 * CONTROL, OR ESTABLISHES THAT ANY `delivered` OR `partial` CLAIM IS TRUE. A green run here
 * means the debt is declared and is not growing. It does NOT mean the controls hold, and a
 * future unit must not cite this guard as evidence that any of them do.
 *
 *   RATCHET-PIN       the number of Critical/High crossings that are `unaudited` must EQUAL
 *                     the pin in distributed-execution-audit-debt.json. Over the pin (a new
 *                     unaudited row, or a regression) reds; UNDER it also reds, so auditing
 *                     a crossing forces the pin down in the same commit. Exact-pin, not
 *                     slack-ceiling: a ceiling with slack silently absorbs a regression.
 *   AUDITED-FLOOR     a crossing recorded as audited may never return to `unaudited`. That
 *                     direction discards a recorded measurement.
 *   DELIVERED-FLOOR   a crossing recorded `delivered` must still be `delivered`. This is the
 *                     "a delivered row regressing" arm, pinned as a SET so the error names
 *                     which row moved.
 *   OWNER-EXISTS      a crossing that is not `delivered` must name at least one ownerTicket
 *                     with a file on disk, or carry a declared deferral with a reason. An
 *                     audit route that terminates nowhere is declared debt, never silence.
 *   FINDING-VISIBLE   (the DE-11 shape) a crossing named by a committed finding document may
 *                     not be `unaudited`; and every top-level `FINDING-*.md` must be named by
 *                     an epic findings register, so the ownership census can reach it.
 *
 * Usage:
 *   node scripts/check-threat-control-audit-debt.mjs
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const THREAT_CONTROLS_JSON = "docs/architecture/distributed-execution-threat-controls.json";
export const AUDIT_DEBT_JSON = "docs/architecture/distributed-execution-audit-debt.json";
export const EPICS_RELATIVE_PATH = "docs/replatform/epics";
export const REPLATFORM_RELATIVE_PATH = "docs/replatform";

/** The severities this guard counts. Medium/Low crossings exist in the schema's vocabulary
 * but none are present today; if one is added it is deliberately NOT ratcheted here. */
export const RATCHETED_SEVERITIES = new Set(["Critical", "High"]);

/** The one status that means "nobody has looked". */
export const UNAUDITED = "unaudited";

/**
 * A crossing id as a literal token in finding prose.
 *
 * ★ RANGE SPANS ARE STRIPPED FIRST, and this is a real correction rather than a
 * convenience. `E0-F008` contains the phrase "the DE-01...DE-30 register ID set" — a name
 * for the WHOLE SET, not a claim about DE-01 or DE-30. Tokenising it naively made the
 * FINDING-VISIBLE clause implicate two crossings on a sentence that says nothing about
 * either, which is a false positive of exactly the kind that gets a guard switched off.
 * The strip is deliberately narrow: only `DE-n <span punctuation> DE-m`, nothing else.
 */
export const CROSSING_ID_RE = /\bDE-\d+\b/g;
const CROSSING_RANGE_RE = /\bDE-\d+\s*(?:\.\.\.|\.\.|…|—|–|-{1,2}|to)\s*DE-\d+\b/g;

/** @returns {string[]} crossing ids named by `text`, range spans excluded. */
export function crossingIdsNamedBy(text) {
  if (typeof text !== "string") return [];
  return [...new Set(text.replace(CROSSING_RANGE_RE, " ").match(CROSSING_ID_RE) ?? [])];
}

/** Every `findings.md` under the epic tree — the same notion `check-finding-ownership.mjs` uses. */
export function findEpicRegisters(root) {
  const epics = path.join(root, EPICS_RELATIVE_PATH);
  if (!existsSync(epics)) return [];
  return readdirSync(epics, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${EPICS_RELATIVE_PATH}/${e.name}/findings.md`)
    .filter((rel) => existsSync(path.join(root, rel)))
    .sort();
}

/** Top-level `docs/replatform/FINDING-*.md` — the documents no register glob reaches. */
export function findTopLevelFindingDocs(root) {
  const dir = path.join(root, REPLATFORM_RELATIVE_PATH);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^FINDING-.+\.md$/.test(e.name))
    .map((e) => `${REPLATFORM_RELATIVE_PATH}/${e.name}`)
    .sort();
}

/** Ticket ids with at least one file on disk — the same notion `check-ticket-graph-coverage.mjs`
 * and `check-finding-ownership.mjs` use, so the three guards cannot disagree about what a
 * ticket existing means. */
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

/** Read the tree into the pure evaluator's input shape. Throws (fail-closed) on an absent or
 * unparseable register or manifest — an absent manifest must never read as an empty
 * allow-list. */
export function collect(root) {
  const readJson = (rel) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) throw new Error(`${rel} is missing (an absent manifest is a FAIL, not an empty allow-list)`);
    return JSON.parse(readFileSync(abs, "utf8"));
  };

  const findingDocuments = [];
  for (const rel of [...findEpicRegisters(root), ...findTopLevelFindingDocs(root)]) {
    findingDocuments.push({ path: rel, text: readFileSync(path.join(root, rel), "utf8") });
  }

  return {
    crossings: readJson(THREAT_CONTROLS_JSON).crossings ?? [],
    debt: readJson(AUDIT_DEBT_JSON),
    ticketIds: findTicketIds(root),
    findingDocuments,
    epicRegisterPaths: findEpicRegisters(root),
    topLevelFindingDocPaths: findTopLevelFindingDocs(root),
  };
}

/**
 * The whole verdict, as a pure function of already-read text.
 * @returns {{errors: string[], notes: string[]}}
 */
export function evaluateAuditDebt(input) {
  const errors = [];
  const notes = [];
  const crossings = Array.isArray(input.crossings) ? input.crossings : [];
  const debt = input.debt ?? {};
  const byId = new Map(crossings.map((c) => [c?.id, c]));
  const ticketIds = new Set(input.ticketIds ?? []);

  // --- RATCHET-PIN ---------------------------------------------------------------------
  const ratcheted = crossings.filter((c) => RATCHETED_SEVERITIES.has(c?.severity));
  const unauditedIds = ratcheted.filter((c) => c?.deliveryStatus === UNAUDITED).map((c) => c.id).sort();
  const pin = debt?.ceilings?.unauditedCriticalHigh;
  if (!Number.isInteger(pin) || pin < 0) {
    errors.push(
      `${AUDIT_DEBT_JSON}: ceilings.unauditedCriticalHigh must be a non-negative integer (got ${JSON.stringify(pin)})`,
    );
  } else if (unauditedIds.length > pin) {
    errors.push(
      `${THREAT_CONTROLS_JSON}: ${unauditedIds.length} Critical/High crossings are "${UNAUDITED}" but the pin in ${AUDIT_DEBT_JSON} is ${pin}. ` +
        `The pin may only go DOWN. Over-pin crossings: ${unauditedIds.join(", ")}`,
    );
  } else if (unauditedIds.length < pin) {
    errors.push(
      `${THREAT_CONTROLS_JSON}: only ${unauditedIds.length} Critical/High crossings are "${UNAUDITED}" but the pin in ${AUDIT_DEBT_JSON} is still ${pin}. ` +
        `Lower ceilings.unauditedCriticalHigh to ${unauditedIds.length} in THIS commit — a pin with slack silently absorbs the next regression.`,
    );
  } else {
    notes.push(`audit debt: ${unauditedIds.length} of ${ratcheted.length} Critical/High crossings are still "${UNAUDITED}" (pinned).`);
  }

  // --- AUDITED-FLOOR -------------------------------------------------------------------
  for (const id of debt?.auditedFloor?.ids ?? []) {
    const crossing = byId.get(id);
    if (!crossing) {
      errors.push(`${AUDIT_DEBT_JSON}: auditedFloor names ${id}, which is not a crossing in ${THREAT_CONTROLS_JSON}`);
      continue;
    }
    if (crossing.deliveryStatus === UNAUDITED) {
      errors.push(
        `${THREAT_CONTROLS_JSON}: crossing ${id} is recorded in auditedFloor but has regressed to "${UNAUDITED}"; ` +
          "a recorded measurement may not be discarded",
      );
    }
  }

  // --- DELIVERED-FLOOR -----------------------------------------------------------------
  for (const id of debt?.deliveredFloor?.ids ?? []) {
    const crossing = byId.get(id);
    if (!crossing) {
      errors.push(`${AUDIT_DEBT_JSON}: deliveredFloor names ${id}, which is not a crossing in ${THREAT_CONTROLS_JSON}`);
      continue;
    }
    if (crossing.deliveryStatus !== "delivered") {
      errors.push(
        `${THREAT_CONTROLS_JSON}: crossing ${id} is recorded in deliveredFloor but is now "${crossing.deliveryStatus}"; ` +
          "a delivered control may not silently regress",
      );
    }
  }

  // --- OWNER-EXISTS --------------------------------------------------------------------
  const deferrals = debt?.ownerTicketDeferrals ?? {};
  const deferredIds = Object.keys(deferrals).filter((k) => !k.startsWith("$"));
  for (const crossing of crossings) {
    if (!crossing || crossing.deliveryStatus === "delivered") continue;
    const owners = Array.isArray(crossing.ownerTickets) ? crossing.ownerTickets : [];
    const onDisk = owners.filter((t) => ticketIds.has(t));
    if (onDisk.length > 0) continue;
    const deferral = deferrals[crossing.id];
    if (deferral == null || typeof deferral.reason !== "string" || deferral.reason.trim() === "") {
      errors.push(
        `${THREAT_CONTROLS_JSON}: crossing ${crossing.id} is "${crossing.deliveryStatus}" and names no ownerTicket with a file on disk ` +
          `(ownerTickets: ${owners.length > 0 ? owners.join(", ") : "none"}); its audit route terminates nowhere. ` +
          `Give it an owner, or declare the debt in ${AUDIT_DEBT_JSON} ownerTicketDeferrals with a reason.`,
      );
    }
  }
  for (const id of deferredIds) {
    const crossing = byId.get(id);
    if (!crossing) {
      errors.push(`${AUDIT_DEBT_JSON}: ownerTicketDeferrals names ${id}, which is not a crossing in ${THREAT_CONTROLS_JSON} (a ghost deferral)`);
      continue;
    }
    const owners = Array.isArray(crossing.ownerTickets) ? crossing.ownerTickets : [];
    if (owners.some((t) => ticketIds.has(t))) {
      errors.push(
        `${AUDIT_DEBT_JSON}: the ownerTicketDeferrals entry for ${id} is STALE — ` +
          `${owners.filter((t) => ticketIds.has(t)).join(", ")} now has a file on disk. Remove the entry in the landing commit.`,
      );
    }
  }

  // --- FINDING-VISIBLE -----------------------------------------------------------------
  // (a) The DE-11 shape: a crossing a committed finding document is about may not claim
  //     that nobody has looked at it.
  const namedBy = new Map();
  for (const doc of input.findingDocuments ?? []) {
    for (const id of crossingIdsNamedBy(doc.text)) {
      if (!namedBy.has(id)) namedBy.set(id, new Set());
      namedBy.get(id).add(doc.path);
    }
  }
  for (const [id, docs] of [...namedBy.entries()].sort()) {
    const crossing = byId.get(id);
    if (!crossing || crossing.deliveryStatus !== UNAUDITED) continue;
    errors.push(
      `${THREAT_CONTROLS_JSON}: crossing ${id} is "${UNAUDITED}" — i.e. it asserts nobody has looked — while committed finding ` +
        `document(s) ${[...docs].sort().join(", ")} are about that crossing. A register may not claim no delivery audit has ` +
        "been performed over the top of an audit that was performed and written down.",
    );
  }
  // (b) A top-level FINDING-*.md that no epic register names can never print as unowned,
  //     because check-finding-ownership.mjs cannot see it. Make that structurally impossible.
  const epicText = (input.findingDocuments ?? [])
    .filter((d) => d.path.endsWith("/findings.md"))
    .map((d) => d.text)
    .join("\n");
  for (const rel of input.topLevelFindingDocPaths ?? []) {
    const basename = path.posix.basename(rel);
    if (!epicText.includes(basename)) {
      errors.push(
        `${rel}: a top-level FINDING document is named by no epic findings register, so scripts/check-finding-ownership.mjs ` +
          "(which globs only docs/replatform/epics/*/findings.md) can never see it and it can never print as unowned. " +
          "File a finding in the owning epic's register that names this document by filename.",
      );
    }
  }

  return { errors, notes };
}

function main() {
  const root = process.cwd();
  let result;
  try {
    result = evaluateAuditDebt(collect(root));
  } catch (error) {
    console.error(`threat-control audit debt: FAIL\n  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
    return;
  }
  for (const note of result.notes) console.log(`  ${note}`);
  if (result.errors.length > 0) {
    console.error("threat-control audit debt: FAIL");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
    return;
  }
  console.log("threat-control audit debt: PASS");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-threat-control-audit-debt.mjs")) {
  main();
}
