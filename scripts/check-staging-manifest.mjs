#!/usr/bin/env node
// -----------------------------------------------------------------------------
// DEP-006 static staging-manifest validator (LOCAL authority; no Docker required).
//
//   node scripts/check-staging-manifest.mjs
//
// Parses the committed docker-compose.staging.yml with the dependency-free
// yaml-lite parser, reads the documented env-key set from
// docs/deploy/environment-variables.md, and asserts the full DEP-006 config
// contract (design §2, invariants 1–8) via scripts/lib/staging-manifest-invariants.mjs.
// Exits non-zero (printing the violation list) if ANY invariant is broken — most
// importantly if the provider-control credential (E2B_API_KEY) leaks off the
// adapter-management surface, or the shared admission limiter can fall back to
// process memory.
//
// The live `docker compose config` render validation is Linux/CI-only
// (tests/d1/e6f-12-staging-render.test.mjs); this static check is the always-on
// (pr.yml `policy`) local + CI-static gate.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./lib/yaml-lite.mjs";
import {
  evaluateStagingManifestInvariants,
  evaluateShippedBootOverlayInvariants,
  collectDocumentedEnvKeys,
  SHIPPED_BOOT_OVERLAY_PATH,
} from "./lib/staging-manifest-invariants.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composePath = path.join(repoRoot, "docker-compose.staging.yml");
const envDocPath = path.join(repoRoot, "docs", "deploy", "environment-variables.md");

/**
 * `--rendered <file.json>` — the lane's LIVE re-check (DEP-015). The file is the engine's own
 * merge, `docker compose -f docker-compose.staging.yml -f <overlay> config --format json`, so
 * this evaluates exactly what will boot, not the yaml-lite model of it. Two assertions, and
 * the second is the positive control: the SAME render must red through the unscoped staging
 * path, or the scoped admission is not what is making it green.
 */
function checkRendered(renderedPath) {
  let rendered;
  try {
    rendered = JSON.parse(readFileSync(renderedPath, "utf8"));
  } catch (err) {
    console.error(`FAIL: could not read the rendered manifest ${renderedPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const scoped = evaluateShippedBootOverlayInvariants(rendered, null, {
    overlayPath: SHIPPED_BOOT_OVERLAY_PATH,
    rendered: true,
  });
  if (scoped.violations.length > 0) {
    console.error(`FAIL: the rendered shipped boot violates ${scoped.violations.length} DEP-015 invariant(s):`);
    for (const violation of scoped.violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
  const unscoped = evaluateStagingManifestInvariants(rendered).violations.filter((x) => /DISPATCH-DEFAULT/.test(x));
  if (unscoped.length === 0) {
    console.error("FAIL: positive control — the rendered shipped boot passed the UNSCOPED default-off check; the admission is not what is scoping it");
    process.exit(1);
  }
  console.log(`OK: rendered shipped boot satisfies DEP-015 (scoped), and the unscoped default-off check reds it (${unscoped.length} violation(s)) — the admission is scoped`);
}

function main() {
  const renderedFlag = process.argv.indexOf("--rendered");
  if (renderedFlag !== -1) {
    checkRendered(process.argv[renderedFlag + 1]);
    return;
  }
  let compose;
  try {
    compose = parseYaml(readFileSync(composePath, "utf8"));
  } catch (err) {
    console.error(`FAIL: could not parse ${composePath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  let documentedEnvKeys;
  try {
    documentedEnvKeys = collectDocumentedEnvKeys(readFileSync(envDocPath, "utf8"));
  } catch (err) {
    console.error(`FAIL: could not read ${envDocPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const { violations } = evaluateStagingManifestInvariants(compose, { documentedEnvKeys });

  if (violations.length > 0) {
    console.error(`FAIL: docker-compose.staging.yml violates ${violations.length} DEP-006 config-contract invariant(s):`);
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }

  console.log("OK: docker-compose.staging.yml satisfies the DEP-006 staging config contract");
  console.log("    (8 services: migrate one-shot + 2 control-plane + 4 workers + 1 adapter-manager,");
  console.log("     split into two failure domains (domain-a/domain-b: 1 CP + 2 workers each),");
  console.log("     external DB/object-store/realtime/admission as x-external pointers,");
  console.log("     migration-first depends_on gate, N/N-1 rollout policy, bounded worker drain,");
  console.log("     bounded autoscaling, shared DEP-009 admission with no process-local fallback).");
  console.log("");
  console.log("    Provider-control boundary: E2B_API_KEY is injected (rotatable) ONLY into the");
  console.log("    adapter-management surface on provider-ctl-net, and is ABSENT from every");
  console.log("    control-plane / worker / migrate surface. Rotation/revocation/old-key-denial");
  console.log("    rehearsal is contracted against DEP-008 + deferred to CLI-001/D2 (crosswalk CM-010/CM-012).");

  // DEP-015 — the shipped CI boot overlay, evaluated over staging ⊕ overlay. This is the ONE
  // manifest whose workers may carry the dispatch switches, and only with the admitted values;
  // the staging evaluation above has no way to be handed that admission.
  let overlay;
  try {
    overlay = parseYaml(readFileSync(path.join(repoRoot, SHIPPED_BOOT_OVERLAY_PATH), "utf8"));
  } catch (err) {
    console.error(`FAIL: could not parse ${SHIPPED_BOOT_OVERLAY_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const overlayResult = evaluateShippedBootOverlayInvariants(compose, overlay, { overlayPath: SHIPPED_BOOT_OVERLAY_PATH });
  if (overlayResult.violations.length > 0) {
    console.error(`FAIL: ${SHIPPED_BOOT_OVERLAY_PATH} violates ${overlayResult.violations.length} DEP-015 shipped-boot invariant(s):`);
    for (const violation of overlayResult.violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
  console.log("");
  console.log(`OK: ${SHIPPED_BOOT_OVERLAY_PATH} satisfies the DEP-015 shipped-boot contract`);
  console.log("    (dispatch admitted ONLY on its three declared workers with the exact admitted values;");
  console.log("     E2B_API_KEY only on the adapter-manager; the F10 rollout injected on EVERY");
  console.log("     control-plane replica; the deployment-wide crew switch pinned \"false\").");
}

main();
