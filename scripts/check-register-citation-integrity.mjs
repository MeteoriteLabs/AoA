#!/usr/bin/env node
/**
 * check-register-citation-integrity.mjs
 *
 * A CITATION THAT POINTS AT THE WRONG LINE IS A RECORD DISAGREEING WITH ITS OWN CODE.
 *
 * The threat-control register `docs/architecture/distributed-execution-threat-controls.json`
 * cites source locations as `path/to/file.ts:LINE` and `:LINE-RANGE`. These citations SILENTLY
 * ROT whenever any PR shifts lines in a cited file — including sibling crossings a PR never
 * intended to touch. On PR #443 that cost TEN Codex review rounds of manual re-anchoring,
 * because a diff-scoped reviewer cannot see whole-register drift. This guard closes the class:
 * it verifies every enforced citation against the working-tree HEAD on every PR, in the
 * always-on `policy` job.
 *
 * WHAT IT ENFORCES, AND WHY THAT SCOPE (all four decisions are MEASURED, not assumed — see
 * the measurement note at the bottom of this header):
 *
 *   ENFORCED = an EXPLICIT, REPO-ANCHORED citation: a `path:LINE` (or `:LINE-RANGE`) whose path
 *   contains a `/` and whose first segment is a real top-level directory of this repo
 *   (server/, packages/, docs/, scripts/, .github/, …). 211 of the register's citations are
 *   of this kind, and on the tree this guard shipped against every one of them resolves.
 *
 *   Per enforced citation, at working-tree HEAD:
 *     (a) EXISTS      — the file exists. A deleted or moved file reds.
 *     (b) IN-RANGE    — the line (or the whole range) is within the file. A file that shrank
 *                       below a cited line reds. This is the PR #443 rot class.
 *     (c) REACHES-CODE— for a SINGLE-LINE citation into a code file (.ts/.tsx/.js/.jsx/.mjs/.cjs)
 *                       the cited line must not be BLANK. A citation that has drifted onto a
 *                       blank line has reached nothing. It does NOT fail on a comment, JSDoc, or
 *                       import line: the register cites those DELIBERATELY (measured: 27 such
 *                       citations today, e.g. DE-01 job-input-staging.ts:25 → a `//` line the
 *                       row itself calls "only prose"), so a "not a comment/import" rule would
 *                       be a false-fail machine — the very defect this programme has paid for.
 *                       The task scoped (c) to a "three-services class"; the blank-only rule is
 *                       false-positive-free across ALL code files (a strict superset), so it is
 *                       applied broadly rather than to an under-defined subset.
 *     (d) SYMBOL-ANCHOR (STRONGER) — if a BACKTICKED token sits ADJACENT to the citation
 *                       (`` `admit()` at path:LINE ``, or `` path:LINE (`insertJobOnce`) ``),
 *                       that token — or a close variant (the call stripped of `()`, or its
 *                       leading identifier) — must appear within ±3 lines of the cited line.
 *                       This catches a line that drifted WITHIN range but off its construct,
 *                       which (b) cannot see. Enforced only where a backtick anchor EXISTS; an
 *                       absent anchor is never invented. The register today writes its adjacent
 *                       constructs in PARENTHESES, not backticks, and those are a mix of code
 *                       and prose (measured: 5 of 13 code-ish parenthetical tokens legitimately
 *                       fall outside ±3 lines — `admit(`, `target_revoked`, `stale_fence` name a
 *                       concept near, not at, the line), so parenthetical anchors are treated as
 *                       prose, not machine-checkable anchors. (d) is therefore ARMED for the
 *                       backtick form and matches zero citations today; its teeth are proven by
 *                       the positive/negative controls in the self-test, and the guard's current
 *                       teeth are (a)+(b)+(c) over 211 real citations.
 *
 *   BEST-EFFORT, NOT ENFORCED (a documented, MEASURED decision — this is the escape hatch the
 *   task granted for infeasible robust attribution):
 *     - BARE `:LINE` refs (attributed to the most recent path named earlier in the same string).
 *       They are narrative-contaminated in this register: sentences discuss OLD, re-measured, and
 *       superseded line numbers ("stale citations re-measured: :1983 -> :3527", "these read
 *       `:5399`, `:5451`"), and intervening bare filenames break "most recent path" attribution.
 *       Even with improved attribution (resolving bare filenames to a unique repo file) 73 bare
 *       refs across ~20 files land out of range, almost all of them legacy/frozen-block numbers.
 *       Enforcing them would demand a ~73-entry grandfather list of pure noise — a worse control
 *       surface than the drift it would catch. They are counted and reported, never failed.
 *     - UNANCHORED / relative-shorthand paths (`routes/projects.ts`, `services/heartbeat.ts`) —
 *       11 citations whose first segment is not a top-level dir. They cannot be resolved from the
 *       repo root unambiguously and were never repo-root citations. Counted, not failed.
 *     - FILENAME-ONLY mentions with no directory. Counted, not failed.
 *
 *   GRANDFATHER — `scripts/register-citation-grandfather.json`. An enforced citation that
 *   legitimately cannot resolve (a frozen historical block pointing at since-moved code) is
 *   listed there with a one-line reason, and is then not an error. The list is SELF-CLEANING:
 *   an entry that no longer corresponds to a live violation (someone fixed the citation, or the
 *   file grew back) REDS as STALE, exactly like the audit-debt `ownerTicketDeferrals` arm — a
 *   grandfather that outlives its reason is silent debt. An ABSENT manifest is a FAIL, never an
 *   empty allow-list. On the tree this guard shipped against the list is EMPTY: the only two
 *   strict-scope violations were real line-drift (DE-14 index.ts:164→:171 onto a blank line, and
 *   DE-28 quarantine-grant.ts:91→:101) and were FIXED rather than grandfathered, because they
 *   could resolve — grandfathering is for citations that cannot.
 *
 * THIS GUARD IS ADDITIVE. It does not touch and does not duplicate
 * check-distributed-execution-foundation.mjs clause 4, which is about crossing-ID tokens (DE-NN)
 * appearing in OPEN findings — a different contract over different text.
 *
 * MEASUREMENT PROVENANCE: every count above was measured against
 * docs/architecture/distributed-execution-threat-controls.json at origin/docs/replatform-program
 * tip 9200a66c4 (DE-27 merged). The self-test's POSITIVE CONTROL re-establishes on every run
 * that the shipped tree is green, so any red is attributable to a change and not to this guard.
 *
 * Usage:
 *   node scripts/check-register-citation-integrity.mjs
 *   node scripts/check-register-citation-integrity.mjs --root <fixture-dir>   # tests only
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const THREAT_CONTROLS_JSON = "docs/architecture/distributed-execution-threat-controls.json";
export const GRANDFATHER_JSON = "scripts/register-citation-grandfather.json";

/** Extensions we recognise as a citable source/asset file. */
const EXT = "(?:ts|tsx|js|jsx|mjs|cjs|sql|ya?ml|md|json|sh|ps1)";
/** A path with at least one `/` and a recognised extension. */
const SLASH_PATH = `(?:[A-Za-z0-9_.\\-]+/)+[A-Za-z0-9_.\\-]+\\.${EXT}`;
/** A bare filename (no `/`) with a recognised extension. */
const BARE_FILENAME = `[A-Za-z0-9_.\\-]+\\.${EXT}`;
/**
 * One combined left-to-right scanner. Order matters: a slash path is tried before a bare
 * filename before a lone `:LINE`, so `a/b.ts:10` is one explicit slash citation, not a bare
 * filename plus a bare line. A `:LINE(-LINE)?` is captured when present.
 */
const SCAN = new RegExp(
  `(${SLASH_PATH})(?::(\\d+(?:-\\d+)?))?` + // slash path (+ optional line)
    `|(${BARE_FILENAME})(?::(\\d+(?:-\\d+)?))?` + // bare filename (+ optional line)
    `|:(\\d+(?:-\\d+)?)`, // bare line
  "gi",
);

/** Code-file extensions for the reaches-real-code (c) check. */
const CODE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;

/** How far a symbol anchor may sit from the cited line, in either direction. */
const ANCHOR_RADIUS = 3;

/** A backtick anchor immediately AFTER `path:LINE` (optionally wrapped in `(`). */
const ANCHOR_AFTER_RE = /^\s*\(?\s*`([^`\n]{1,80})`/;
/** A backtick anchor immediately BEFORE the path (e.g. `` `admit()` at path:LINE ``). */
const ANCHOR_BEFORE_RE = /`([^`\n]{1,80})`\s*(?:\(|at |in |,\s*)?$/;

/**
 * Parse every source citation out of one string.
 *
 * Returns records `{ path, line, kind, anchorToken }` where `kind` is:
 *   - "explicit-slash"    a `path/with/slash.ts:LINE`
 *   - "explicit-filename" a bare `filename.ts:LINE` (no directory)
 *   - "bare"              a lone `:LINE`, attributed to the most recent path named earlier
 * A path mentioned WITHOUT a line still updates the "most recent path" used to attribute a
 * following bare `:LINE` — that is the attribution rule the task specified. Slash paths and
 * bare filenames both count as "a path named earlier".
 *
 * `anchorToken` is the backticked construct token sitting adjacent to an explicit citation, or
 * null. It is extracted here (where the surrounding text is in hand) so the evaluator stays a
 * pure function of already-parsed records.
 */
export function parseCitations(text) {
  if (typeof text !== "string") return [];
  const out = [];
  let lastPath = null;
  SCAN.lastIndex = 0;
  let m;
  while ((m = SCAN.exec(text)) !== null) {
    const [whole, slashPath, slashLine, fileName, fileLine, bareLine] = m;
    const start = m.index;
    const end = m.index + whole.length;
    if (slashPath) {
      lastPath = slashPath;
      if (slashLine) {
        out.push({ path: slashPath, line: slashLine, kind: "explicit-slash", anchorToken: anchorFor(text, start, end) });
      }
    } else if (fileName) {
      lastPath = fileName;
      if (fileLine) {
        out.push({ path: fileName, line: fileLine, kind: "explicit-filename", anchorToken: anchorFor(text, start, end) });
      }
    } else if (bareLine && lastPath) {
      out.push({ path: lastPath, line: bareLine, kind: "bare", anchorToken: null });
    }
  }
  return out;
}

/** Extract a backtick anchor adjacent to a citation spanning [start, end) in `text`. */
function anchorFor(text, start, end) {
  const after = ANCHOR_AFTER_RE.exec(text.slice(end, end + 90));
  if (after) return after[1].trim();
  const before = ANCHOR_BEFORE_RE.exec(text.slice(Math.max(0, start - 40), start));
  if (before) return before[1].trim();
  return null;
}

/** Close variants of an anchor token that "the token appears" may match against. */
export function anchorVariants(token) {
  const raw = String(token || "").trim();
  const out = new Set();
  if (raw.length >= 2) out.add(raw);
  const noParen = raw.replace(/\(.*$/, "").trim(); // `admit(x)` -> `admit`
  if (noParen.length >= 2) out.add(noParen);
  const ident = (raw.match(/[A-Za-z_$][\w$]*/) || [])[0]; // leading identifier
  if (ident && ident.length >= 2) out.add(ident);
  return [...out];
}

/** Does any variant of `token` appear within ±ANCHOR_RADIUS lines of [lo, hi]? */
function anchorNearby(lines, lo, hi, token) {
  const from = Math.max(0, lo - 1 - ANCHOR_RADIUS);
  const to = Math.min(lines.length, hi + ANCHOR_RADIUS);
  const hay = lines.slice(from, to).join("\n");
  return anchorVariants(token).some((v) => hay.includes(v));
}

/** Is `p` repo-root-anchored — path with a `/` whose first segment is a top-level dir? */
export function isAnchored(p, topLevelDirs) {
  if (!p.includes("/")) return false;
  return topLevelDirs.has(p.split("/")[0]);
}

/** [lo, hi] line bounds from a "N" or "N-M" spec. */
function lineBounds(spec) {
  const [a, b] = spec.split("-").map((n) => Number(n));
  return [a, b != null && !Number.isNaN(b) ? b : a];
}

/** The stable signature of a citation (and of a grandfather entry): crossing|path|line. */
export function citationSignature(crossingId, p, line) {
  return `${crossingId}|${p}|${line}`;
}

/**
 * Read the tree into the pure evaluator's input shape. Fail-closed (throws) on an absent or
 * unparseable register or grandfather manifest — an absent manifest must NEVER read as an
 * empty allow-list.
 */
export function collect(root) {
  const readJson = (rel) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) {
      throw new Error(`${rel} is missing (an absent manifest is a FAIL, not an empty allow-list)`);
    }
    return JSON.parse(readFileSync(abs, "utf8"));
  };

  const register = readJson(THREAT_CONTROLS_JSON);
  const grandfather = readJson(GRANDFATHER_JSON);
  const topLevelDirs = topLevelDirsOf(root);

  // Parse every string field of every crossing.
  const citations = [];
  for (const crossing of register.crossings ?? []) {
    if (!crossing || crossing.id == null) continue;
    for (const [field, value] of Object.entries(crossing)) {
      const strings = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
      for (const s of strings) {
        for (const c of parseCitations(s)) {
          const anchored = c.kind === "explicit-slash" && isAnchored(c.path, topLevelDirs);
          const inScope = anchored; // explicit + repo-anchored
          citations.push({ crossingId: crossing.id, field, ...c, anchored, inScope });
        }
      }
    }
  }

  // Read the files that in-scope citations point at (only those — pure, bounded file reads).
  const files = {};
  for (const c of citations) {
    if (!c.inScope || files[c.path]) continue;
    const abs = path.join(root, c.path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      files[c.path] = { exists: false, lines: [] };
    } else {
      files[c.path] = { exists: true, lines: readFileSync(abs, "utf8").split(/\r?\n/) };
    }
  }

  return { citations, files, grandfather };
}

/** The set of top-level directory names of the repo (used to decide anchoring). */
export function topLevelDirsOf(root) {
  const set = new Set();
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) set.add(e.name);
  }
  return set;
}

/**
 * The whole verdict, as a pure function of already-read text.
 *
 * @param {{citations: object[], files: Record<string,{exists:boolean,lines:string[]}>, grandfather: object}} input
 * @returns {{errors: string[], notes: string[]}}
 */
export function evaluateCitationIntegrity(input) {
  const errors = [];
  const notes = [];
  const citations = Array.isArray(input.citations) ? input.citations : [];
  const files = input.files ?? {};
  const grandfather = input.grandfather ?? {};

  // --- validate the grandfather manifest shape -----------------------------------------
  const entries = Array.isArray(grandfather.entries) ? grandfather.entries : null;
  if (entries == null) {
    errors.push(
      `${GRANDFATHER_JSON}: must be a JSON object with an "entries" array. An absent or malformed ` +
        "allow-list is a FAIL, not an empty allow-list — deleting it would retire the guard's grandfather arm silently.",
    );
    return { errors, notes };
  }
  const grandfatherSigs = new Map(); // sig -> reason
  for (const [i, e] of entries.entries()) {
    if (e == null || typeof e !== "object" || Array.isArray(e)) {
      errors.push(`${GRANDFATHER_JSON}: entry #${i} is not an object`);
      continue;
    }
    const { crossing, path: p, line, reason } = e;
    if (typeof crossing !== "string" || typeof p !== "string" || typeof line !== "string") {
      errors.push(`${GRANDFATHER_JSON}: entry #${i} must carry string "crossing", "path", and "line" (got ${JSON.stringify(e)})`);
      continue;
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      errors.push(`${GRANDFATHER_JSON}: entry for ${crossing} ${p}:${line} needs a non-empty "reason" — a grandfather without a reason is silent debt`);
      continue;
    }
    grandfatherSigs.set(citationSignature(crossing, p, line), reason);
  }

  // --- compute raw violations (ignoring the grandfather list) --------------------------
  // Keyed by signature so N occurrences of the same citation collapse to one verdict.
  const rawViolations = new Map(); // sig -> message
  let enforced = 0;
  const bestEffort = { bare: 0, unanchored: 0, filenameOnly: 0 };

  for (const c of citations) {
    if (!c.inScope) {
      if (c.kind === "bare") bestEffort.bare += 1;
      else if (c.kind === "explicit-slash") bestEffort.unanchored += 1;
      else if (c.kind === "explicit-filename") bestEffort.filenameOnly += 1;
      continue;
    }
    enforced += 1;
    const sig = citationSignature(c.crossingId, c.path, c.line);
    if (rawViolations.has(sig)) continue; // already judged this exact citation
    const cite = `${c.crossingId} (${c.field}) ${c.path}:${c.line}`;
    const f = files[c.path];

    if (!f || !f.exists) {
      rawViolations.set(sig, `${cite}: cited file does not exist at HEAD (moved, renamed, or deleted).`);
      continue;
    }
    const [lo, hi] = lineBounds(c.line);
    if (!Number.isInteger(lo) || lo < 1 || !Number.isInteger(hi) || hi < lo || hi > f.lines.length) {
      rawViolations.set(
        sig,
        `${cite}: line ${c.line} is outside the file, which has ${f.lines.length} lines (the file shifted or shrank under a citation that did not move).`,
      );
      continue;
    }
    // (c) reaches-real-code: a single-line code citation must not land on a blank line.
    if (CODE_EXT_RE.test(c.path) && lo === hi && (f.lines[lo - 1] ?? "").trim() === "") {
      rawViolations.set(sig, `${cite}: cites a BLANK line — the citation has drifted onto whitespace and reaches no code.`);
      continue;
    }
    // (d) symbol anchor: an adjacent backticked token must appear within ±3 lines.
    if (c.anchorToken && !anchorNearby(f.lines, lo, hi, c.anchorToken)) {
      rawViolations.set(
        sig,
        `${cite}: the adjacent anchor \`${c.anchorToken}\` does not appear within ±${ANCHOR_RADIUS} lines of line ${c.line} ` +
          "— the line drifted off the construct the citation names.",
      );
      continue;
    }
  }

  // --- apply grandfather, then flag stale grandfather entries --------------------------
  for (const [sig, message] of [...rawViolations].sort()) {
    if (grandfatherSigs.has(sig)) continue; // legitimately grandfathered
    errors.push(message);
  }
  for (const [sig, reason] of [...grandfatherSigs].sort()) {
    if (!rawViolations.has(sig)) {
      const [crossing, p, line] = sig.split("|");
      errors.push(
        `${GRANDFATHER_JSON}: the entry for ${crossing} ${p}:${line} is STALE — that citation no longer violates any check ` +
          `(reason on file: ${JSON.stringify(reason)}). Remove the entry in the commit that fixed the citation; a grandfather that outlives its reason is silent debt.`,
      );
    }
  }

  notes.push(
    `citation integrity: ${enforced} enforced (explicit, repo-anchored) citations checked; ` +
      `best-effort (unenforced): ${bestEffort.bare} bare :LINE, ${bestEffort.unanchored} unanchored, ${bestEffort.filenameOnly} filename-only. ` +
      `${grandfatherSigs.size} grandfathered.`,
  );
  return { errors, notes };
}

function main() {
  const rootFlag = process.argv.indexOf("--root");
  const root = rootFlag !== -1 ? process.argv[rootFlag + 1] : process.cwd();
  let result;
  try {
    result = evaluateCitationIntegrity(collect(root));
  } catch (error) {
    console.error(`register citation integrity: FAIL\n  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
    return;
  }
  for (const note of result.notes) console.log(`  ${note}`);
  if (result.errors.length > 0) {
    console.error("register citation integrity: FAIL");
    for (const e of result.errors) console.error(`  - ${e}`);
    console.error(
      `\nFix the citation in ${THREAT_CONTROLS_JSON}, or — for a citation that legitimately cannot resolve ` +
        `(a frozen historical block pointing at since-moved code) — add it to ${GRANDFATHER_JSON} with a one-line reason.`,
    );
    process.exit(1);
    return;
  }
  console.log("register citation integrity: PASS");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-register-citation-integrity.mjs")) {
  main();
}
