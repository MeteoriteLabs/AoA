#!/usr/bin/env node
/**
 * check-release-admission.mjs
 *
 * REL-004 Lane A — the promotion gate: refuse a release candidate unless its manifest is
 * complete and correctly signed AND every one of its five artifacts passes its own
 * admission verifier.
 *
 * THIS CLI IS THE POINT OF THE TICKET. Before it, `evaluateAdmission` (DEP-001),
 * `evaluateInstallerAdmission` (DSK-003) and `evaluateUpdateAdmission` (DSK-004) had no
 * caller outside their own unit suites — three fail-closed verifiers that nothing
 * consulted, so "an unapproved digest cannot run" could not refuse anything.
 *
 * Reads a release directory and delegates every decision to the pure
 * `scripts/lib/release-manifest.mjs`. Read/parse failures are reported SEPARATELY from
 * policy refusals, because they send an operator to different places.
 *
 * Usage:
 *   node scripts/check-release-admission.mjs --release-dir <dir>
 *
 * The directory holds:
 *   manifest.json          the candidate + its five artifact classes
 *   manifest.sig           detached base64 signature over the canonical manifest payload
 *   trust-root.pem         the release public key (a TEST root today; REL-004's operator
 *                          step swaps in the release root and changes no logic here)
 *   signatures.json        { <artifactClass>: <base64 detached signature> }
 *   image-allowlist.json   what was promoted, for the three image classes
 *   installer-allowlist.json
 *   revoked-versions.json  the desktop update deny-list — ABSENT IS A REFUSAL, never an
 *                          empty list (DSK-004 D6: "unknown" must not read as "permitted")
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { RELEASE_ARTIFACT_CLASSES, evaluateReleaseAdmission } from "./lib/release-manifest.mjs";

const FILES = Object.freeze({
  manifest: "manifest.json",
  signature: "manifest.sig",
  trustRoot: "trust-root.pem",
  signatures: "signatures.json",
  imageAllowlist: "image-allowlist.json",
  installerAllowlist: "installer-allowlist.json",
  revokedVersions: "revoked-versions.json",
});

function readText(dir, name) {
  return readFileSync(path.join(dir, name), "utf8");
}

/**
 * Load the release directory.
 *
 * EVERY FILE IS REQUIRED. A missing input is a read error, not a default — the deny-list
 * in particular must never be inferred as empty, because "I could not load the policy"
 * read as "nothing is denied" is how a withdrawn build gets promoted during an outage.
 */
export function loadRelease(dir) {
  const errors = [];
  const out = {};
  for (const [key, name] of Object.entries(FILES)) {
    try {
      const text = readText(dir, name);
      out[key] = key === "signature" || key === "trustRoot" ? text.trim() : JSON.parse(text);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  return errors.length > 0 ? { errors } : { release: out };
}

function main(argv) {
  const flag = argv.indexOf("--release-dir");
  if (flag === -1 || typeof argv[flag + 1] !== "string") {
    console.error("usage: node scripts/check-release-admission.mjs --release-dir <dir>");
    return 2;
  }
  const dir = path.resolve(argv[flag + 1]);

  const loaded = loadRelease(dir);
  if (loaded.errors) {
    console.error(`release-admission: cannot read the release at ${dir}\n`);
    for (const error of loaded.errors) console.error(`  - ${error}`);
    return 1;
  }

  const verdict = evaluateReleaseAdmission(loaded.release);
  if (verdict.admitted) {
    console.log(
      `release-admission: ADMITTED candidate ${loaded.release.manifest.candidate} ` +
        `(${RELEASE_ARTIFACT_CLASSES.length} artifact classes)`,
    );
    for (const artifact of verdict.artifacts) {
      console.log(`  ok  ${artifact.artifactClass} (${artifact.kind})`);
    }
    return 0;
  }

  console.error(`release-admission: REFUSED — ${verdict.reason}`);
  if (verdict.artifactClass) console.error(`  artifact class: ${verdict.artifactClass}`);
  for (const artifact of verdict.artifacts ?? []) {
    if (!artifact.admitted) {
      console.error(`  refused  ${artifact.artifactClass} (${artifact.kind}): ${artifact.reason}`);
    }
  }
  return 1;
}

if (process.argv[1]?.endsWith("check-release-admission.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
