// Every OPEN finding must name who owns it — or say, on the record, that nobody does.
//
// ★ WHY THIS EXISTS. This programme has now had four blockers reach the top of the
// critical path unscheduled: deferral #1 (a worker receives no provider credential),
// E4-D12 (the worker does not dispatch at all), the missing composition root, and E4-F007
// (a worker cannot stay authorised past 15 minutes). THREE OF THE FOUR WERE ALREADY
// WRITTEN DOWN — E4-F007 sat in `findings.md` at severity HIGH with `Status: open`, and
// DSK-001's risk register recommended filing its successor "now, before DSK-003 is
// planned". DSK-003 shipped. It never was.
//
// So the failure is not that nobody noticed. It is that NOTICING HAD NO CONSEQUENCE.
// `check-ticket-graph-coverage.mjs` already fails when a ticket FILE has no node in the
// plan; nothing failed when an open finding had no ticket at all — the same hole, one
// register over. A finding with no ticket is indistinguishable from a finding nobody had.
//
// ★ WHY IT IS DECLARATION-BASED. The tempting version infers ownership by scanning ticket
// prose for the finding id. That inference was tried in this repo for a neighbouring guard
// and was WRONG FIVE TIMES IN BOTH DIRECTIONS — a mention in a comment read as ownership,
// and real ownership expressed in different words read as absence. So the hard direction
// (does anyone own this?) is answered by a human writing it down, and the machine verifies
// only the cheap direction: that the entry exists, is well-formed, and — when it claims a
// ticket — that the ticket actually exists on disk.
//
// That last check is the one that matters most. A FALSE CLAIM OF OWNERSHIP is worse than
// no claim, because it converts an open question into a settled one for every later reader.
//
// Pure. The caller supplies the parsed findings, the manifest, and the ticket ids.

/**
 * owned    — a ticket owns this finding. `ticket` must name a ticket whose file exists.
 * unowned  — nobody owns it yet, and that is acknowledged rather than hidden. `reason`
 *            must say what is blocked and what the decision is waiting on.
 * accepted — it will not be fixed (typically a nit). `reason` must say why that is fine.
 */
export const FINDING_OWNERSHIP_STATUSES = Object.freeze(["owned", "unowned", "accepted"]);

/** A ticket that already has a result doc has SHIPPED. Declaring a still-open finding as
 * owned by completed work is the same false-claim failure as naming a ticket that does not
 * exist, and it is the exact shape five findings in this repo are already in: E6-F003
 * (HIGH) says "resolve at DEP-000" and DEP-000 shipped; E6-F008 says "resolve before
 * CLI-001/D2" and CLI-001 shipped. They were carried past their own resolution point and
 * nothing noticed, because nothing was looking. */

/** Severities that may NOT be `accepted`. Waving away a HIGH is exactly the move this
 * guard exists to make impossible to do quietly — it must be `owned`, or `unowned` with a
 * reason someone can read and argue with. */
const NOT_ACCEPTABLE = Object.freeze(["HIGH", "CRITICAL"]);

/** The status value a finding gets when no `Status:` field could be read from its block.
 * It is a HARD FAILURE, not a shrug — see `unparseable_status` below. */
export const UNPARSEABLE_STATUS = "unknown";
/** Likewise for severity: an unclassifiable finding may not be quietly `accepted`. */
export const UNPARSEABLE_SEVERITY = "UNKNOWN";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasReason(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {{
 *   findings?: Array<{id: string, status: string, severity?: string, title?: string}>,
 *   declared?: Record<string, {status: string, ticket?: string, reason?: string, ownerStillOpen?: string, successor?: string}>,
 *   ticketIds?: string[],
 *   completedTicketIds?: string[],   // tickets with a result doc — i.e. shipped
 * }} input
 * @returns {{ok: boolean, problems: Array<{kind: string, finding: string|null, detail?: string}>,
 *            openCount: number, unowned: string[]}}
 */
export function evaluateFindingOwnership(input) {
  const problems = [];
  if (!isPlainObject(input)) {
    return { ok: false, problems: [{ kind: "malformed_input", finding: null }], openCount: 0, unowned: [] };
  }
  const { findings, declared, ticketIds } = input;
  if (!Array.isArray(findings) || !isPlainObject(declared)) {
    return { ok: false, problems: [{ kind: "malformed_input", finding: null }], openCount: 0, unowned: [] };
  }
  const tickets = new Set(Array.isArray(ticketIds) ? ticketIds : []);
  const completed = new Set(Array.isArray(input.completedTicketIds) ? input.completedTicketIds : []);

  // ★★★ FAIL CLOSED ON AN UNREADABLE STATUS. This arm is the fix for the guard's own
  // worst failure class, found INSIDE the guard that exists to catch it.
  //
  // Until 2026-09-03 a finding whose `Status:` could not be parsed was silently treated as
  // NOT OPEN, and the E0, E1 and E2 registers write their status in shapes the parser did
  // not read — or, for 25 of their 34 findings, do not write one at all. So all three
  // registers were INVISIBLE. Measured by positive control: a synthetic HIGH, gate-blocking,
  // undeclared finding appended to `E0-foundation/findings.md` in E0's OWN documented house
  // style (`- **Severity:** / - **Blocks gate:** / - **Disposition:**`) left
  // `node scripts/check-finding-ownership.mjs` reporting `OK (17 open ...)` and exiting 0.
  // The same finding with a `**Status:**` line correctly failed `undeclared_finding`.
  //
  // The old behaviour was a deliberate choice with a stated rationale — "guessing would make
  // the guard noisy, and a noisy guard gets switched off". That rationale is sound about
  // GUESSING and wrong about SILENCE: the third option, refusing to proceed until a human
  // writes the field, is neither noisy nor a guess. It is also the only version that cannot
  // rot, because a register that drifts back to the old style now fails on the next PR
  // rather than going quiet again.
  //
  // A FALSE CLAIM OF ENFORCEMENT IS WORSE THAN A MISSING CHECK: for 108 findings across 9
  // registers this guard reported a confident `OK` while reading the status of only 73.
  for (const finding of [...findings].filter((f) => isPlainObject(f) && f.status === UNPARSEABLE_STATUS)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    problems.push({ kind: "unparseable_status", finding: finding.id, detail: finding.register });
  }

  const open = findings.filter((f) => isPlainObject(f) && f.status === "open");
  const openIds = new Set(open.map((f) => f.id));
  const unowned = [];

  for (const finding of [...open].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const entry = declared[finding.id];
    // Default-deny. A new open finding is born UNDECLARED, and undeclared fails — which is
    // the whole mechanism: the blocker announces itself the first time CI runs after it is
    // filed, rather than the day someone happens to re-read the register.
    if (!isPlainObject(entry)) {
      problems.push({ kind: "undeclared_finding", finding: finding.id, detail: finding.severity });
      continue;
    }
    if (!FINDING_OWNERSHIP_STATUSES.includes(entry.status) || !hasReason(entry.reason)) {
      problems.push({ kind: "malformed_declaration", finding: finding.id, detail: String(entry.status) });
      continue;
    }
    if (entry.status === "owned") {
      if (typeof entry.ticket !== "string" || entry.ticket.length === 0) {
        problems.push({ kind: "malformed_declaration", finding: finding.id, detail: "ticket missing" });
        continue;
      }
      // The check that stops a false claim of ownership becoming a settled fact.
      if (!tickets.has(entry.ticket)) {
        problems.push({ kind: "owner_ticket_missing", finding: finding.id, detail: entry.ticket });
        continue;
      }
      // An open finding owned by SHIPPED work is owned by nothing. This is the state five
      // findings here are already in, and the reason it went unnoticed is that the natural
      // reading of the register ("resolve at DEP-000") looks like ownership right up until
      // you check whether DEP-000 is still open.
      //
      // CALIBRATION, learned while authoring the first manifest: "has a result doc" is NOT
      // the same as "finished". WRK-008 has result docs for slices 1 and 2a while slice 2b
      // is still open, so failing outright would have produced a false positive on the very
      // first real entry — and a guard that cries wolf gets switched off, which is a worse
      // outcome than no guard. So the rule is not "you may not name a shipped ticket"; it is
      // "if you name one, say IN WRITING what part of it is still open (ownerStillOpen) AND
      // name the ticket that inherits the residual (successor)." (E4-F013.)
      //
      // ownerStillOpen is PROSE — nobody can write it honestly when the answer is "nothing".
      // successor is a CHECKABLE POINTER, held to the SAME existence bar owner_ticket_missing
      // uses: it must exist on disk, must not be the shipped owner itself (that re-opens the
      // exact hole one field over — mirrors dependency-graph.mjs's `dep === id` self-check),
      // and must not have shipped either (a shipped successor is the same hole one level down).
      // The check is EXISTENCE-ONLY: it forces a real ticket node+dep skeleton (the graph
      // guards do the rest), but it cannot verify the named ticket is the CORRECT inheritor —
      // that stays author/review responsibility.
      if (completed.has(entry.ticket)) {
        if (!hasReason(entry.ownerStillOpen)) {
          problems.push({ kind: "owner_ticket_already_complete", finding: finding.id, detail: entry.ticket });
        }
        if (!hasReason(entry.successor)) {
          problems.push({ kind: "successor_missing", finding: finding.id, detail: entry.ticket });
        } else if (entry.successor === entry.ticket) {
          problems.push({ kind: "successor_is_self", finding: finding.id, detail: entry.successor });
        } else if (!tickets.has(entry.successor)) {
          problems.push({ kind: "successor_not_on_disk", finding: finding.id, detail: entry.successor });
        } else if (completed.has(entry.successor)) {
          problems.push({ kind: "successor_already_complete", finding: finding.id, detail: entry.successor });
        }
      }
      continue;
    }
    if (entry.status === "accepted") {
      const severity = String(finding.severity).toUpperCase();
      // The same blindness, one field over. `**Severity:** HIGH` — the shape EVERY register
      // uses — did not parse either (the old expression demanded the value abut the closing
      // `**`), so 82 of 108 findings carried severity UNKNOWN and `severity_not_acceptable`
      // could not fire for any of them. With the regex fixed, an unreadable severity must
      // still refuse `accepted`: you may not wave away what you have not classified.
      if (severity === UNPARSEABLE_SEVERITY) {
        problems.push({ kind: "severity_unreadable_not_acceptable", finding: finding.id, detail: finding.severity });
        continue;
      }
      if (NOT_ACCEPTABLE.includes(severity)) {
        problems.push({ kind: "severity_not_acceptable", finding: finding.id, detail: finding.severity });
        continue;
      }
    }
    if (entry.status === "unowned") unowned.push(finding.id);
  }

  // A manifest that keeps entries for findings that are no longer open rots into a list
  // nobody trusts, and an untrusted list is the state this guard is trying to leave.
  for (const id of Object.keys(declared).sort()) {
    if (!openIds.has(id)) {
      problems.push({ kind: "stale_declaration", finding: id });
    }
  }

  return { ok: problems.length === 0, problems, openCount: open.length, unowned };
}

/**
 * The `Status:` shapes that occur in this repo's registers, in match order.
 *
 * All three are the SAME explicit field in different punctuation, so reading them is not
 * inference — it is not the ticket-prose scanning the header rejects. What is deliberately
 * NOT here is any attempt to divine open-ness from `- **Disposition:**` prose ("Open —
 * non-blocking hardening", "Resolved (items 1–3) … Item 4 remains open/optional"). That is
 * the guessing this guard's header records as having been WRONG FIVE TIMES IN BOTH
 * DIRECTIONS for a neighbouring guard. A block with no status field is a hard failure
 * instead — see `unparseable_status`.
 */
const STATUS_PATTERNS = Object.freeze([
  // `**Status:** open` · `**Status:** \`open\`` · `**Status:** **RESOLVED 2026-08-09**`
  // The bold-value form is E2-F001/002/008 and E7-F004/005/006 and E10-F002.
  /\*\*Status:\*\*\s*[`*]{0,2}\s*([A-Za-z0-9_]+)/,
  // `- **Status: RESOLVED (resolving revision \`e62921b17\`).**` — colon INSIDE the bold.
  // E1-F004/F005/F007. The old expression required the colon inside and the value outside,
  // so it read neither this nor the bold-value form above.
  /\*\*Status:\s*([A-Za-z0-9_]+)/,
]);

/** `**Severity:** HIGH` · `Severity: HIGH` · `- **Severity:** P1 STOP`.
 * The old expression (`/Severity:\s*\*{0,2}([A-Za-z]+)/`) could not read the bolded form at
 * all: after `Severity:` it consumed the closing `**` and then required a letter where a
 * SPACE stood. 82 of 108 findings — every one in E3 and E7 — parsed as UNKNOWN. */
const SEVERITY_PATTERN = /\*{0,2}Severity:\*{0,2}\s*[`*]{0,2}\s*([A-Za-z][A-Za-z0-9]*)/;

/**
 * Parse `findings.md` text into finding records.
 *
 * Deliberately tolerant about everything except the two fields the guard reasons over.
 * A heading with no readable `Status:` yields `status: "unknown"`, which the evaluator
 * treats as a HARD FAILURE (`unparseable_status`) rather than as "not open" — the silent
 * version is what made three whole registers invisible.
 */
export function parseFindings(text) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const block of text.split(/\n(?=## )/)) {
    const heading = /^## ([A-Z0-9]+-F\d+)\s*[—-]\s*(.*)/.exec(block);
    if (!heading) continue;
    let status;
    for (const pattern of STATUS_PATTERNS) {
      const match = pattern.exec(block);
      if (match) {
        status = match[1];
        break;
      }
    }
    const severity = SEVERITY_PATTERN.exec(block);
    out.push({
      id: heading[1],
      title: heading[2].trim(),
      // Lower-cased so `**Status:** OPEN` is open. The evaluator compares against the
      // literal "open"; without folding, a register that shouts its status is invisible
      // for exactly the same reason the three registers above were.
      status: status ? status.toLowerCase() : UNPARSEABLE_STATUS,
      severity: severity ? severity[1].toUpperCase() : UNPARSEABLE_SEVERITY,
    });
  }
  return out;
}
