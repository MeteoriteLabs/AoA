// A REGISTER ID MUST NAME ONE THING.
//
// ★ WHY THIS EXISTS. On 2026-09-03 this repository had THREE live duplicate-id defects at
// once, and every one of them had been sitting in a register that a guard reads:
//
//   - `docs/architecture/decisions.md` carried TWO `## Decision #104` headings, one day
//     apart, both locked, on unrelated subjects (optimistic concurrency for agent updates;
//     keyless-except-embeddings). `CLAUDE.md` cites #104 as load-bearing in FOUR places and
//     the project's own rules forbid relitigating a locked decision — so a reader following
//     a citation lands on a coin flip.
//   - `E1-worker-protocol/findings.md` carried TWO `## E1-F008` headings, both severity
//     HIGH. `check-finding-ownership.mjs` keys by id, so one silently SHADOWED the other:
//     the guard answered "declared" or "open" for whichever the parser reached second, and
//     the other finding did not exist as far as any check was concerned.
//
// None of them was caught by anything, because nothing anywhere asked the question. That is
// this programme's own named worst failure class — a check that nothing runs is not a check —
// and the more precise version of it: the question that nothing asks.
//
// ★ WHY IT IS A SEPARATE GUARD RATHER THAN A LINE IN THE OWNERSHIP CHECKER. The ownership
// checker consumes findings through a Map keyed by id, which is exactly the structure that
// makes a duplicate invisible to it — by the time it can see the corpus, the collision has
// already been silently resolved in favour of one entry. Uniqueness has to be asked of the
// RAW headings, before anything keys on them.
//
// Pure. The caller supplies already-extracted headings; the checker does the reasoning.

/**
 * ★ WHY THERE IS A DECLARATION FILE AND NOT JUST A HARD FAIL.
 *
 * `## Decision #104` is duplicated in the LOCKED decisions register, and renumbering a
 * locked decision is not a mechanical edit: CLAUDE.md cites #104 as load-bearing in four
 * places and the project's own rules forbid relitigating locked decisions. So the fix needs
 * an operator decision, which is not a thing a guard can make.
 *
 * The two bad options are to leave the guard out of CI until someone decides (a check that
 * nothing runs is not a check — the failure this whole unit exists to close) or to hard-fail
 * and leave the policy job red (a red gate nobody can turn green gets deleted, per the
 * `capabilityProven` precedent). The third option is the one the ownership guard already
 * uses: DEFAULT-DENY WITH A WRITTEN DECLARATION. An undeclared duplicate fails. A declared
 * one is reported on every green run so it cannot be forgotten.
 *
 * The declaration is deliberately weaker than the ownership manifest's: it cannot say
 * "fine forever", only "a human has seen this and owes a decision", and `stale_waiver`
 * fires the moment the duplicate is gone, so a waiver cannot outlive the defect it covers.
 */
export const WAIVER_KEY = (kind, id) => `${kind}:${id}`;

/**
 * @param {{sources?: Array<{file: string, kind: string, ids?: Array<{id: string, line: number}>}>,
 *          waived?: Record<string, {reason?: string}>}} input
 * @returns {{ok: boolean, problems: Array<{kind: string, id: string|null, detail?: string}>,
 *            counts: Record<string, number>, waived: string[]}}
 */
export function evaluateIdUniqueness(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, problems: [{ kind: "malformed_input", id: null }], counts: {}, waived: [] };
  }
  const { sources, waived } = input;
  const declared = typeof waived === "object" && waived !== null && !Array.isArray(waived) ? waived : {};
  if (!Array.isArray(sources)) {
    return { ok: false, problems: [{ kind: "malformed_input", id: null }], counts: {}, waived: [] };
  }

  // id -> every place it is DEFINED. Grouped per kind, because a finding id and a decision
  // id share no namespace and colliding across them would be a false positive.
  /** @type {Map<string, Map<string, Array<{file: string, line: number}>>>} */
  const byKind = new Map();
  const counts = {};

  for (const source of sources) {
    if (typeof source !== "object" || source === null) {
      return { ok: false, problems: [{ kind: "malformed_input", id: null }], counts: {}, waived: [] };
    }
    const { file, kind, ids } = source;
    if (typeof file !== "string" || typeof kind !== "string" || !Array.isArray(ids)) {
      return { ok: false, problems: [{ kind: "malformed_input", id: null }], counts: {}, waived: [] };
    }
    if (!byKind.has(kind)) byKind.set(kind, new Map());
    const seen = byKind.get(kind);
    for (const entry of ids) {
      if (typeof entry !== "object" || entry === null || typeof entry.id !== "string") {
        return { ok: false, problems: [{ kind: "malformed_input", id: null }], counts: {}, waived: [] };
      }
      if (!seen.has(entry.id)) seen.set(entry.id, []);
      seen.get(entry.id).push({ file, line: entry.line });
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }

  const problems = [];
  const waivedSeen = [];
  const duplicateKeys = new Set();
  for (const kind of [...byKind.keys()].sort()) {
    for (const id of [...byKind.get(kind).keys()].sort()) {
      const places = byKind.get(kind).get(id);
      if (places.length < 2) continue;
      const key = WAIVER_KEY(kind, id);
      duplicateKeys.add(key);
      const waiver = declared[key];
      // A waiver must carry a REASON. An empty one is an allow-list entry wearing a
      // declaration's clothes, and this repo has already learned that a false claim of
      // enforcement is worse than a missing check.
      if (typeof waiver === "object" && waiver !== null && typeof waiver.reason === "string" && waiver.reason.trim()) {
        waivedSeen.push(key);
        continue;
      }
      if (waiver !== undefined) {
        problems.push({ kind: "malformed_waiver", id, detail: `${key}: a waiver must carry a non-empty reason` });
        continue;
      }
      // Report EVERY location, not just the count. A duplicate id is only actionable once
      // you can read both entries and decide which one keeps the number — and that decision
      // is a human's, because for a LOCKED decision it is not obviously safe to renumber
      // either side (see CLAUDE.md's four citations of #104).
      problems.push({
        kind: "duplicate_id",
        id,
        detail: `${kind}: ${places.map((p) => `${p.file}:${p.line}`).join(" and ")}`,
      });
    }
  }

  // A waiver that outlives its duplicate is a lie the next reader inherits — the same rot
  // `stale_declaration` exists to stop in the ownership manifest.
  for (const key of Object.keys(declared).sort()) {
    if (!duplicateKeys.has(key)) {
      problems.push({ kind: "stale_waiver", id: key, detail: "declared, but no longer a duplicate — remove the entry" });
    }
  }

  return { ok: problems.length === 0, problems, counts, waived: waivedSeen.sort() };
}

// ★ EVERY PATTERN ENDS IN `(?=\s|$)`, AND THAT IS LOAD-BEARING — not tidiness.
//
// The first draft ended them in `\b` and the guard's FIRST real run reported a duplicate
// `E3-F028` that is not one: `E3-job-control/findings.md:1252` is
// `## E3-F028–E3-F033 — RESOLVED (JOB-003 final acceptance 2026-08-12)`, a resolution
// ROLL-UP over a RANGE of six findings, not a second definition of E3-F028. `\b` matched
// the first id because the following en dash is a non-word character.
//
// Two reasons that had to be fixed rather than lived with. A guard that cries wolf gets
// switched off, which is a worse outcome than no guard — this repo's own calibration
// lesson, recorded in the ownership guard. And `parseFindings` (the ownership guard's
// extractor) requires `\s*[—-]` after the id, where the class holds an EM dash and a
// hyphen but not an EN dash — so it never saw the roll-up. Two guards disagreeing about
// what counts as a finding is its own defect; `findTicketIds` carries an explicit comment
// about keeping exactly that from happening. A cross-guard agreement test pins it.
//
// The lookahead also cannot be defeated by backtracking the way a trailing `\b` or a
// `[^ ]` guard can: `\d+` giving back a digit still leaves a non-whitespace character.

/** `## E1-F008 — title` in any epic findings register. */
export const FINDING_HEADING = /^#{2,4}\s+([A-Z][A-Z0-9]*-F\d+)(?=\s|$)/;
/** `## Decision #104 — title (date)` in the product-wide locked-decisions register. */
export const DECISION_HEADING = /^#{2,4}\s+Decision\s+#(\d+)(?=\s|$)/;
/** `### E2-D01 — title` in an epic-scoped decisions register. */
export const EPIC_DECISION_HEADING = /^#{2,4}\s+([A-Z][A-Z0-9]*-D\d+)(?=\s|$)/;

/**
 * Extract the ids DEFINED by headings in one document.
 *
 * Headings only, deliberately. A body-text mention of `Decision #104` is a CITATION, not a
 * definition, and counting citations would make every well-cross-referenced document a
 * failure — the noisy-guard failure mode that gets guards switched off.
 */
export function extractHeadingIds(text, pattern) {
  if (typeof text !== "string") return [];
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = pattern.exec(lines[i]);
    if (match) out.push({ id: match[1], line: i + 1 });
  }
  return out;
}
