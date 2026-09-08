#!/usr/bin/env node
/**
 * check-evidence-immutability.mjs
 *
 * A CHECK THAT NOTHING RUNS IS NOT A CHECK.
 *
 * ★ WHY THIS EXISTS. `docs/replatform/artifact-policy.md:54,67` makes every QA and handoff
 * record "write-once from its first commit" — a rerun or correction creates a NEW attempt
 * carrying `Supersedes`, and never edits a prior one. The deny that enforces this,
 * `checkEvidenceImmutability` in `check-distributed-execution-foundation.mjs`, has been on
 * disk and fully unit-tested since FND-005 and, until this file, HAD ZERO PRODUCTION
 * CALLERS. Nothing on any lane ever handed it a real base and candidate tree.
 *
 * The consequence was measured, not asserted. The ledger's rule has already been broken in
 * this repository's own history with CI green:
 *   `docs/replatform/epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md`
 *   was created by 6fc46988a and REWRITTEN IN PLACE by 4379a2c53 (+24/-4), inserting a
 *   "★ CORRECTION" paragraph while the record's own `Supersedes` field still read
 *   "— (E5 has no prior QA record; this is the first)".
 * That exact pair is replayed as the RED case in this guard's self-test, so the deny is
 * proven against real history rather than only against synthetic fixtures. Filed as
 * E0-F014 item 3; this file is its caller.
 *
 * ★ WHY REV-TO-REV, NOT REV-TO-WORKTREE. The ledger is the commit history, not the working
 * copy, and reading BOTH sides out of git blobs makes the comparison byte-exact on a
 * Windows checkout with `core.autocrlf=true` (where a worktree read would compare CRLF
 * against LF and fail on every record).
 *
 * ★ WHY BASE-TO-TIP IS NOT ENOUGH — AND WHY THE PR'S OWN COMMITS ARE WALKED. The policy
 * says a QA/handoff record is immutable "from its first commit", not "from the moment it
 * lands on the target branch". A single base-to-tip comparison can only see records that
 * ALREADY EXISTED at the base, so it enforces the rule exactly where a PR author cannot
 * break it, and not where they can: a PR that ADDS a record in one commit and then
 * REWRITES or DELETES it in a later commit of the same PR is absent from `baseTree`
 * entirely and the comparison returns CLEAN. That hole was reproduced in a throwaway
 * repository and returned `{ok: true}`. So this guard now also walks `base..candidate`,
 * pins each record's content AT THE COMMIT THAT INTRODUCED IT, and denies any later commit
 * in the same pull request that changes or removes it.
 *
 * ★ WHY THIS DOES NOT BLOCK A LEGITIMATE CORRECTION. Under `artifact-policy.md:54,58,67` a
 * rerun, correction or changed decision is expressed by ADDING A NEW attempt file whose
 * `Supersedes` field points BACKWARD at the prior path (`qa-result-template.md:9`,
 * `handoff-template.md:9`). The superseded record is never touched and gets no backlink, so
 * a supersede is a pure addition — and additions are never denied here. Append-only ticket
 * results live under `tickets/`, which `EVIDENCE_RECORD_RE` deliberately excludes, so
 * review-attempt appends are untouched too.
 *
 * ★ SCOPE, STATED RATHER THAN ASSUMED. This runs on `pull_request` events only (see
 * pr.yml), because `base.sha` is the only revision the guard can trust; `github.event.before`
 * on a push is all-zeros for a branch's first push. main is protected, so every evidence
 * record arrives through a pull request and is seen here. Within a PR, a record's
 * introducing commit is the first commit in `base..candidate` that contains it.
 *
 * ★ WHY AN EMPTY BASE IS A FAILURE. Measured before writing this: handing the underlying
 * deny a base revision that predates the evidence tree returns ZERO ERRORS — a silent pass
 * that looks identical to a clean run. A mistyped ref, a shallow clone, or a moved
 * directory would therefore disarm this guard without a word. An empty base is refused.
 *
 * Usage:
 *   node scripts/check-evidence-immutability.mjs --base <rev> [--candidate <rev>]
 *   EVIDENCE_IMMUTABILITY_BASE=<rev> node scripts/check-evidence-immutability.mjs
 *
 * Exit 0 = no evidence record — one already on the base, or one introduced by the
 * candidate's own commits — was modified, deleted or renamed after its first commit.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { checkEvidenceImmutability } from "./check-distributed-execution-foundation.mjs";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * The immutable-record set, kept deliberately identical to `collectEvidenceRecords`
 * inside the foundation checker: `qa/` and `handoffs/` markdown under an epic, README
 * excluded. Materialising a wider set than the deny reads would be theatre.
 */
export const EVIDENCE_RECORD_RE =
  /^docs\/replatform\/epics\/[^/]+\/(?:qa|handoffs)\/(?!README\.md$)[^/]+\.md$/;

/** Pathspec that bounds the per-commit `ls-tree` walk. Purely a narrowing of the regex. */
export const EVIDENCE_ROOT = "docs/replatform/epics";

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
    // Capture git's stderr instead of letting it reach the terminal, so an unresolvable
    // revision is reported once, by this guard, in this guard's words.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Write one revision's evidence records into a fresh temp tree, preserving the repo-
 * relative layout the deny walks. Blobs are copied as bytes: no transcoding, no line-
 * ending rewrite, so a difference reported is a real difference.
 *
 * @returns {{root: string, count: number}}
 */
export function materializeEvidenceTree(repoRoot, rev) {
  const root = mkdtempSync(path.join(tmpdir(), "evidence-immutability-"));
  const names = git(repoRoot, ["ls-tree", "-r", "--name-only", "-z", rev])
    .toString("utf8")
    .split("\0")
    .filter((n) => n.length > 0);
  let count = 0;
  for (const rel of names) {
    if (!EVIDENCE_RECORD_RE.test(rel)) continue;
    const abs = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, git(repoRoot, ["cat-file", "blob", `${rev}:${rel}`]));
    count += 1;
  }
  return { root, count };
}

/**
 * One revision's evidence records as `path -> blob OID`. Object ids are compared instead
 * of bytes here because git already guarantees oid identity IS content identity, and one
 * `ls-tree` per commit is cheap enough to walk every commit in a pull request.
 *
 * @returns {Map<string, string>}
 */
export function listEvidenceOids(repoRoot, rev) {
  const out = git(repoRoot, ["ls-tree", "-r", "-z", rev, "--", EVIDENCE_ROOT]).toString("utf8");
  const oids = new Map();
  for (const entry of out.split("\0")) {
    if (entry.length === 0) continue;
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const rel = entry.slice(tab + 1);
    if (!EVIDENCE_RECORD_RE.test(rel)) continue;
    // "<mode> SP <type> SP <oid>" — `-z` leaves the path unquoted, so a tab split is safe.
    oids.set(rel, entry.slice(0, tab).split(" ")[2]);
  }
  return oids;
}

/**
 * The candidate's own commits, oldest first: everything reachable from the candidate and
 * not from the base. Empty when the candidate IS the base or an ancestor of it, in which
 * case there are no within-PR introductions to police and the base-to-tip deny is the
 * whole check.
 *
 * @returns {string[]}
 */
export function listCandidateCommits(repoRoot, base, candidate) {
  return git(repoRoot, ["rev-list", "--reverse", "--topo-order", `${base}..${candidate}`])
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * THE WITHIN-PR PASS. A record is immutable from the commit that introduces it, so:
 *
 *   - every record present at the base is pinned to its base content;
 *   - every record first seen in one of the candidate's commits is pinned to the content
 *     that introducing commit gave it;
 *   - any LATER commit in the same pull request that carries a different blob for a pinned
 *     record is a modification, and a record introduced within the PR that is gone at the
 *     tip was deleted or renamed after its first commit.
 *
 * Records that already existed at the base and are missing or different AT THE TIP belong
 * to the base-to-tip deny (`checkEvidenceImmutability`), whose wording and one-error-per-
 * record accounting are unchanged; they are excluded here so one breach is never counted
 * twice. Additions are never denied — that is how a legitimate `Supersedes` attempt lands.
 *
 * @returns {string[]}
 */
export function checkIntroducedRecordImmutability({ repoRoot, base, candidate, commits }) {
  const baseOids = listEvidenceOids(repoRoot, base);
  const candOids = listEvidenceOids(repoRoot, candidate);
  const snapshots = commits.map((sha) => ({ sha, oids: listEvidenceOids(repoRoot, sha) }));

  /** @type {Map<string, {oid: string, since: string | null, index: number}>} */
  const pinned = new Map();
  for (const [rel, oid] of baseOids) pinned.set(rel, { oid, since: null, index: -1 });
  snapshots.forEach((snap, index) => {
    for (const [rel, oid] of snap.oids) {
      if (pinned.has(rel)) continue;
      pinned.set(rel, { oid, since: snap.sha, index });
    }
  });

  const ownedByBaseDeny = new Set();
  for (const [rel, oid] of baseOids) {
    if (!candOids.has(rel) || candOids.get(rel) !== oid) ownedByBaseDeny.add(rel);
  }

  const introducedBy = (intro) =>
    intro.since === null ? `already present at the base ${base}` : `introduced by ${intro.since}`;

  /** @type {Map<string, string>} — one error per record; the first breach wins. */
  const errors = new Map();
  snapshots.forEach((snap, index) => {
    for (const [rel, intro] of pinned) {
      if (index <= intro.index || ownedByBaseDeny.has(rel) || errors.has(rel)) continue;
      const oid = snap.oids.get(rel);
      if (oid === undefined || oid === intro.oid) continue;
      errors.set(
        rel,
        `evidence immutability: record ${rel} was ${introducedBy(intro)} and modified again ` +
          `by ${snap.sha} in the same pull request — a QA/handoff record is write-once from ` +
          "its FIRST commit, not from the moment it reaches the target branch",
      );
    }
  });
  for (const [rel, intro] of pinned) {
    if (intro.since === null || ownedByBaseDeny.has(rel) || errors.has(rel)) continue;
    if (candOids.has(rel)) continue;
    errors.set(
      rel,
      `evidence immutability: record ${rel} was ${introducedBy(intro)} and then deleted or ` +
        "renamed later in the same pull request — a record is write-once from its FIRST " +
        "commit; a correction is a NEW attempt file carrying `Supersedes`",
    );
  }
  return [...errors.values()];
}

/**
 * @param {{repoRoot?: string, base: string, candidate?: string}} input
 * @returns {Promise<{ok: boolean, errors: string[], baseCount: number, candidateCount: number, commitCount: number}>}
 */
export async function runEvidenceImmutability(input) {
  const repoRoot = input.repoRoot ?? REPO_ROOT;
  const base = typeof input.base === "string" ? input.base.trim() : "";
  const candidate =
    typeof input.candidate === "string" && input.candidate.trim().length > 0
      ? input.candidate.trim()
      : "HEAD";
  if (base.length === 0) {
    return {
      ok: false,
      errors: [
        "evidence immutability: no base revision supplied — pass --base <rev> or set " +
          "EVIDENCE_IMMUTABILITY_BASE. Refusing to run: a guard with no base compares " +
          "nothing and passes.",
      ],
      baseCount: 0,
      candidateCount: 0,
      commitCount: 0,
    };
  }

  let baseTree;
  let candTree;
  try {
    for (const [label, rev] of [
      ["base", base],
      ["candidate", candidate],
    ]) {
      try {
        const tree = materializeEvidenceTree(repoRoot, rev);
        if (label === "base") baseTree = tree;
        else candTree = tree;
      } catch (cause) {
        // A stack trace here would bury the one thing the reader needs. The common causes
        // are a shallow clone and an unexpanded CI expression reaching the shell.
        return {
          ok: false,
          errors: [
            `evidence immutability: cannot read the ${label} revision ${JSON.stringify(rev)} — ` +
              `${String(cause?.stderr ?? cause?.message ?? cause).trim()}. ` +
              "Check the revision exists in this clone (a shallow fetch will not have it).",
          ],
          baseCount: baseTree?.count ?? 0,
          candidateCount: 0,
          commitCount: 0,
        };
      }
    }
    if (baseTree.count === 0) {
      return {
        ok: false,
        errors: [
          `evidence immutability: base revision ${base} holds ZERO evidence records. ` +
            "That is not a clean run, it is a disarmed one — the deny returns no errors " +
            "for an empty base. Check the revision, the clone depth, and that " +
            "docs/replatform/epics/*/{qa,handoffs}/ still exists.",
        ],
        baseCount: 0,
        candidateCount: candTree.count,
        commitCount: 0,
      };
    }
    const { errors } = await checkEvidenceImmutability(baseTree.root, candTree.root);
    const commits = listCandidateCommits(repoRoot, base, candidate);
    const introErrors = checkIntroducedRecordImmutability({ repoRoot, base, candidate, commits });
    const allErrors = [...errors, ...introErrors];
    return {
      ok: allErrors.length === 0,
      errors: allErrors,
      baseCount: baseTree.count,
      candidateCount: candTree.count,
      commitCount: commits.length,
    };
  } finally {
    for (const tree of [baseTree, candTree]) {
      if (tree?.root) rmSync(tree.root, { recursive: true, force: true });
    }
  }
}

export function parseArgs(argv, env = {}) {
  let base = typeof env.EVIDENCE_IMMUTABILITY_BASE === "string" ? env.EVIDENCE_IMMUTABILITY_BASE : "";
  let candidate =
    typeof env.EVIDENCE_IMMUTABILITY_CANDIDATE === "string"
      ? env.EVIDENCE_IMMUTABILITY_CANDIDATE
      : "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") base = argv[i + 1] ?? "";
    else if (arg.startsWith("--base=")) base = arg.slice("--base=".length);
    else if (arg === "--candidate") candidate = argv[i + 1] ?? "";
    else if (arg.startsWith("--candidate=")) candidate = arg.slice("--candidate=".length);
  }
  return { base, candidate };
}

async function main() {
  const { base, candidate } = parseArgs(process.argv.slice(2), process.env);
  const result = await runEvidenceImmutability({ base, candidate });
  if (!result.ok) {
    console.error("Evidence-ledger immutability FAILED:");
    for (const err of result.errors) console.error(`  - ${err}`);
    console.error(
      "\nQA and handoff records are write-once (docs/replatform/artifact-policy.md:54,67).\n" +
        "A correction is a NEW attempt file carrying `Supersedes`, never an edit to a prior one.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Evidence-ledger immutability OK: ${result.baseCount} base records ` +
      `(${base}) all present and byte-identical in the candidate ` +
      `(${candidate || "HEAD"}, ${result.candidateCount} records); ` +
      `${result.commitCount} candidate commit(s) walked, and no record introduced by one of ` +
      "them was rewritten or removed by a later one.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
