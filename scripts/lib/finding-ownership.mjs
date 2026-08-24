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

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasReason(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {{
 *   findings?: Array<{id: string, status: string, severity?: string, title?: string}>,
 *   declared?: Record<string, {status: string, ticket?: string, reason?: string, ownerStillOpen?: string}>,
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
      // "if you name one, say IN WRITING what part of it is still open." Nobody can write
      // that sentence honestly when the answer is "nothing", which is the case this catches.
      if (completed.has(entry.ticket) && !hasReason(entry.ownerStillOpen)) {
        problems.push({ kind: "owner_ticket_already_complete", finding: finding.id, detail: entry.ticket });
      }
      continue;
    }
    if (entry.status === "accepted" && NOT_ACCEPTABLE.includes(String(finding.severity).toUpperCase())) {
      problems.push({ kind: "severity_not_acceptable", finding: finding.id, detail: finding.severity });
      continue;
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
 * Parse `findings.md` text into finding records.
 *
 * Deliberately tolerant about everything except the two fields the guard reasons over.
 * A heading with no parseable `Status:` yields `status: "unknown"` and is therefore NOT
 * treated as open — the alternative (guessing) would make the guard noisy and get it
 * switched off, which is worse than a narrower guard that is trusted.
 */
export function parseFindings(text) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const block of text.split(/\n(?=## )/)) {
    const heading = /^## ([A-Z0-9]+-F\d+)\s*[—-]\s*(.*)/.exec(block);
    if (!heading) continue;
    const status = /\*\*Status:\*\*\s*`?([A-Za-z0-9_]+)`?/.exec(block);
    const severity = /Severity:\s*\*{0,2}([A-Za-z]+)/.exec(block);
    out.push({
      id: heading[1],
      title: heading[2].trim(),
      status: status ? status[1] : "unknown",
      severity: severity ? severity[1].toUpperCase() : "UNKNOWN",
    });
  }
  return out;
}
