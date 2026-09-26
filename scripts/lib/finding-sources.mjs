// -----------------------------------------------------------------------------
// DEP-026 — the TWO finding sources a redaction exemption is checked against, read from disk once
// and passed into `evaluateRedactionExemptionBlockers` (`campaign-fault-matrix.mjs`), which is pure.
//
// They are two sources because they answer two DIFFERENT questions, and conflating them is the
// mistake Codex P2 on PR #609 caught:
//
//   - `declaredFindingIds` — EXISTENCE. Every `## <ID>` heading in every epic's `findings.md`. A
//     heading SURVIVES closure (it gains `**Status:** resolved`), so this set answers "is this a
//     real finding id at all?" and CANNOT answer "is it still open?".
//   - `openFindingIds`     — OPENNESS. The keys of `scripts/finding-ownership.json`. Closing a
//     finding DELETES its key in the same commit that flips the prose (`E.2` rule 5), so this set
//     shrinks as findings close. That is exactly the property an exemption must depend on: when the
//     blocker closes, the exemption must FAIL rather than outlive its reason.
//
// Measured on the tree that introduced this: 232 headings against 104 register keys, 40 headings
// explicitly `resolved`; `E9-F003` and `E9-F007` are closed, absent from the register, and still
// have headings. So the two sets are genuinely different and the smaller one is the load-bearing one.
// -----------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const FINDING_OWNERSHIP_PATH = "scripts/finding-ownership.json";
export const EPICS_DIR = "docs/replatform/epics";

/** `## E6-F033 — …` at the start of a line, in any epic's findings.md. */
const HEADING_RE = /^##\s+([A-Z][A-Z0-9]*-F\d+)/gm;

/**
 * @param {string} repoRoot
 * @returns {{openFindingIds: Set<string>, declaredFindingIds: Set<string>}}
 */
export function readFindingSources(repoRoot) {
  const openFindingIds = new Set();
  const ownership = path.join(repoRoot, FINDING_OWNERSHIP_PATH);
  if (existsSync(ownership)) {
    const parsed = JSON.parse(readFileSync(ownership, "utf8"));
    for (const id of Object.keys(parsed?.findings ?? {})) openFindingIds.add(id);
  }

  const declaredFindingIds = new Set();
  const epics = path.join(repoRoot, EPICS_DIR);
  if (existsSync(epics)) {
    for (const entry of readdirSync(epics, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(epics, entry.name, "findings.md");
      if (!existsSync(file)) continue;
      for (const m of readFileSync(file, "utf8").matchAll(HEADING_RE)) declaredFindingIds.add(m[1]);
    }
  }
  // NOT thrown on here: an empty set is a legitimate state for a checkout with no findings, and the
  // consumer is the one that knows whether it NEEDS them. `evaluateRedactionExemptionBlockers`
  // refuses an unusable pair only when the matrix actually declares an exemption, which keeps the
  // refusal on the caller that depends on it rather than on every caller of this loader.
  return { openFindingIds, declaredFindingIds };
}
