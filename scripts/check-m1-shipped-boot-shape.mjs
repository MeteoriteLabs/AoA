#!/usr/bin/env node
// -----------------------------------------------------------------------------
// DEP-015 — the shipped CI boot lane's WORKFLOW-SHAPE guard (pure node; no Docker, no key).
//
//   node scripts/check-m1-shipped-boot-shape.mjs
//
// Reads .github/workflows/m1-shipped-boot.yml and fails closed unless it is still the lane
// founder ruling F3 defines, as clarified by E6-D001: it RUNS only on workflow_dispatch (the one
// push allowed only REGISTERS it: the program branch, paths = this file, every job gated
// `if: github.event_name == 'workflow_dispatch'`; no pull_request / schedule / …), a
// REQUIRED named candidate, images built from source at that candidate and admitted, the
// control-plane keypair generated in the job, keyed secrets exposed only in keyed mode,
// evidence retained on pass and fail, and a teardown that always runs. The invariants are
// `evaluateShippedBootWorkflowShape` (scripts/lib/m1-shipped-boot-shape.mjs); their reds are
// scripts/check-m1-shipped-boot-shape.test.mjs.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateShippedBootWorkflowShape, SHIPPED_BOOT_WORKFLOW } from "./lib/m1-shipped-boot-shape.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let text;
try {
  text = readFileSync(path.join(repoRoot, SHIPPED_BOOT_WORKFLOW), "utf8");
} catch (err) {
  console.error(`FAIL: could not read ${SHIPPED_BOOT_WORKFLOW}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const { violations } = evaluateShippedBootWorkflowShape(text);
if (violations.length > 0) {
  console.error(`FAIL: ${SHIPPED_BOOT_WORKFLOW} violates ${violations.length} DEP-015 shape invariant(s):`);
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(`OK: ${SHIPPED_BOOT_WORKFLOW} is the F3 shipped CI boot: runs only on dispatch (push = registration only, E6-D001), candidate-bound,`);
console.log("    built from source + admitted, in-job keypair, keyed secrets gated to keyed mode,");
console.log("    evidence retained on pass and fail, teardown always.");
