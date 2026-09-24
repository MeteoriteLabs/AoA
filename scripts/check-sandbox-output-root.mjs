#!/usr/bin/env node
// -----------------------------------------------------------------------------
// check-sandbox-output-root.mjs — CLI-017-A, SD-4: there is ONE `R`, provably.
//
//   node scripts/check-sandbox-output-root.mjs
//
// `E7-D11` §1 rules the conventional output root `R = /home/user/aoa-output`. The server side
// appends a directive naming it (`SANDBOX_OUTPUT_ROOT`,
// `server/src/services/sandbox-output-root.ts`); the worker side enumerates it
// (`DEFAULT_OUTPUT_ROOT`, `packages/worker-daemon/src/lease/export-request-producer.ts`). If
// those two drift, the agent writes where nothing looks and every run reports zero produced
// output — silently, because both halves are individually valid.
//
// A single shared constant is NOT available (`E7-D07` freezes the only package both depend on),
// so SD-4 is this check. It FAILS CLOSED: an unreadable file or a renamed constant is a failure,
// never a pass. Logic + positive controls in scripts/lib/sandbox-output-root-check.mjs and
// scripts/lib/__tests__/sandbox-output-root-check.test.mjs.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { SANDBOX_OUTPUT_ROOT_SOURCES, evaluateSandboxOutputRoot } from "./lib/sandbox-output-root-check.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readOrNull(relative) {
  try {
    return readFileSync(path.join(REPO_ROOT, relative), "utf8");
  } catch {
    return null;
  }
}

const result = evaluateSandboxOutputRoot({
  serverSource: readOrNull(SANDBOX_OUTPUT_ROOT_SOURCES.server.path),
  workerSource: readOrNull(SANDBOX_OUTPUT_ROOT_SOURCES.worker.path),
});

if (!result.ok) {
  console.error("check-sandbox-output-root: SD-4 violated (E7-D11 §1, CLI-017-A).");
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error("");
  console.error(`  ${SANDBOX_OUTPUT_ROOT_SOURCES.server.symbol} <- ${SANDBOX_OUTPUT_ROOT_SOURCES.server.path}`);
  console.error(`  ${SANDBOX_OUTPUT_ROOT_SOURCES.worker.symbol} <- ${SANDBOX_OUTPUT_ROOT_SOURCES.worker.path}`);
  process.exit(1);
}

console.log(`check-sandbox-output-root: OK — one R, ${JSON.stringify(result.serverValue)}, on both sides.`);
