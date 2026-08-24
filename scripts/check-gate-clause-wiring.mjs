#!/usr/bin/env node
// An epic gate clause may not claim a capability whose production path has no caller.
//
// See `scripts/lib/gate-clause-wiring.mjs` for why. Short version: the 2026-08-25 exit-gate
// audit found 17 gate clauses across E0..E11 whose named production path has ZERO callers —
// inside epics reported `complete`. Every ticket doc was honest; the aggregation was not.
// This gives "epic complete" a mechanical meaning it did not have.
//
// Usage:
//   node scripts/check-gate-clause-wiring.mjs
//   node scripts/check-gate-clause-wiring.mjs --counts   # print measured caller counts

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { evaluateGateClauseWiring } from "./lib/gate-clause-wiring.mjs";

export const MANIFEST_RELATIVE_PATH = "scripts/gate-clause-wiring.json";

/** Source roots that constitute PRODUCTION. Tests are excluded by `isTestPath`. */
const SOURCE_ROOTS = ["server/src", "packages", "cli"];

const TEST_MARKERS = ["__tests__", ".test.", ".spec.", "/tests/", "\\tests\\", "/testing/", "\\testing\\"];

export function isTestPath(rel) {
  const n = rel.replaceAll("\\", "/");
  return TEST_MARKERS.some((m) => n.includes(m.replaceAll("\\", "/")));
}

/** Strip block and line comments so a symbol NAMED IN A COMMENT is never counted as a call.
 * This repo has mistaken a comment for a call site more than once — including a comment
 * whose entire content was "this function has zero callers". */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function* walk(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      yield full;
    }
  }
}

/**
 * Count PRODUCTION references to `symbol`, excluding test paths, comments, the definition
 * itself, `import` statements, and re-export blocks — including MULTI-LINE ones. A barrel
 * that lists the symbol on its own line is exactly how several of the 17 looked "used".
 *
 * ★ WHAT THIS MEASURES, STATED HONESTLY. A count of 0 is DEFINITIVE: nothing outside a test
 * so much as mentions the symbol, so no production path can reach it. A count > 0 is
 * NECESSARY BUT NOT SUFFICIENT for reachability — the referencing code may itself be
 * unreachable. `runBrowserSession` is precisely that case: `runner.ts` genuinely calls it,
 * but nothing invokes `runner.ts`, because no package depends on `browser-runtime` at all.
 * Proving full boot-root reachability needs an import-graph walk this guard deliberately
 * does not attempt — inferring it cheaply is the kind of guess that has been wrong here
 * before. So the guard catches the zero case with certainty and the `reason` field carries
 * the rest.
 */
export function countProductionCallers(root, symbol) {
  let count = 0;
  const definition = new RegExp(
    `(export\\s+)?(async\\s+)?(function|class|const|let|interface|type)\\s+${symbol}\\b`,
  );
  const use = new RegExp(`\\b${symbol}\\b`);
  for (const rootDir of SOURCE_ROOTS) {
    for (const file of walk(path.join(root, rootDir))) {
      const rel = path.relative(root, file);
      if (isTestPath(rel)) continue;
      const text = stripComments(readFileSync(file, "utf8"));
      // Blank out every import statement and every re-export block BEFORE scanning lines.
      // Doing it over the whole file — not line by line — is what makes multi-line work.
      const scannable = text
        .replace(/import\s[\s\S]*?from\s*["'][^"']+["']\s*;?/g, "")
        .replace(/export\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["']\s*;?/g, "");
      for (const line of scannable.split(/\r?\n/)) {
        if (!use.test(line)) continue;
        if (definition.test(line)) continue;
        count += 1;
      }
    }
  }
  return count;
}

const ROOT = process.cwd();
const manifestPath = path.join(ROOT, MANIFEST_RELATIVE_PATH);
const declared = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")).clauses ?? {})
  : {};

const symbols = [...new Set(Object.values(declared).map((e) => e && e.symbol).filter(Boolean))];
const callerCounts = Object.fromEntries(symbols.map((s) => [s, countProductionCallers(ROOT, s)]));

if (process.argv.includes("--counts")) {
  for (const s of symbols.sort()) console.log(`  ${String(callerCounts[s]).padStart(3)}  ${s}`);
  process.exit(0);
}

const result = evaluateGateClauseWiring({ declared, callerCounts });

const EXPLAIN = {
  claimed_wired_but_no_caller: "declared WIRED but nothing in production calls it — the capability cannot run",
  unwired_but_now_has_caller: "declared unwired but it now HAS a caller — promote it to wired",
  malformed_declaration: "entry needs status wired|unwired, a symbol, and (if unwired) a reason",
  symbol_not_measured: "internal: the symbol was not measured",
  malformed_input: "internal: the guard was handed something it could not read",
};

if (!result.ok) {
  console.error("gate-clause-wiring: a gate clause claims a capability its code cannot deliver.\n");
  for (const p of result.problems) {
    console.error(`  - ${p.clause}: ${EXPLAIN[p.kind] ?? p.kind}${p.detail ? ` (${p.detail})` : ""}`);
  }
  console.error(
    "\nA gate clause names a capability; a ticket delivers the mechanism; this checks that a\n" +
      "production path actually reaches it. Declare `unwired` with a reason if it is honestly\n" +
      "dormant — that is allowed and reported. What is not allowed is claiming it works.",
  );
  process.exit(1);
}

console.log(`gate-clause-wiring: OK (${result.wiredCount} wired clause(s), ${result.unwired.length} declared dormant)`);
if (result.unwired.length > 0) {
  // Printed on a GREEN run, deliberately: a dormant capability must stay visible rather
  // than passing silently as complete. This is the line the exit-gate audit had to
  // reconstruct by hand across ~70 clauses.
  console.log(`  DORMANT, on the record: ${result.unwired.join(", ")}`);
}
