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
 * ★ WHY AN EMPTY BASE IS A FAILURE. Measured before writing this: handing the underlying
 * deny a base revision that predates the evidence tree returns ZERO ERRORS — a silent pass
 * that looks identical to a clean run. A mistyped ref, a shallow clone, or a moved
 * directory would therefore disarm this guard without a word. An empty base is refused.
 *
 * Usage:
 *   node scripts/check-evidence-immutability.mjs --base <rev> [--candidate <rev>]
 *   EVIDENCE_IMMUTABILITY_BASE=<rev> node scripts/check-evidence-immutability.mjs
 *
 * Exit 0 = no prior evidence record was modified, deleted or renamed by the candidate.
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
 * @param {{repoRoot?: string, base: string, candidate?: string}} input
 * @returns {Promise<{ok: boolean, errors: string[], baseCount: number, candidateCount: number}>}
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
      };
    }
    const { errors } = await checkEvidenceImmutability(baseTree.root, candTree.root);
    return {
      ok: errors.length === 0,
      errors,
      baseCount: baseTree.count,
      candidateCount: candTree.count,
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
      `(${candidate || "HEAD"}, ${result.candidateCount} records).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
