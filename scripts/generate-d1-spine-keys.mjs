#!/usr/bin/env node
// DEP-019 — generate the per-run secrets `docker/d1/m1-spine.override.yml` requires.
//
//   node scripts/generate-d1-spine-keys.mjs
//
// ★ WHY THIS IS A SCRIPT AND NOT AN INLINE STEP. The override is a TOPOLOGY, and more than one job
// brings it up: `m1-spine` (DEP-019) and `m1-fault-matrix` (DEP-018), which sets
// `SPINE_OVERRIDE_PATH: docker/d1/m1-spine.override.yml` and reuses it wholesale. When DEP-019 made
// the secrets master key a REQUIRED `${…:?}` variable, that second job's `docker compose up`
// started failing the render — measured, on probe run 35853547516, step "Bring up the ONE-worker
// topology". Two inline copies of this would have drifted the same way the next time the topology
// gained a requirement, so there is one copy and both jobs call it.
//
// It produces exactly two things and prints NEITHER:
//   * `docker/d1/runtime-keys/control-plane-{signing,public}-key.pem` — the ed25519 pair whose
//     PUBLIC half gates the reference provider's wire and whose PRIVATE half mints the run
//     capability. They are bound as INDIVIDUAL FILES (never the directory), so each service holds
//     only its own half; `evaluateSpineOverrideText` reds on a directory mount.
//   * `AOA_D1_SPINE_SECRETS_MASTER_KEY` — the key the profile's one Company secret is written and
//     read under. It is `::add-mask::`ed BEFORE it reaches `GITHUB_ENV`, because a value that
//     reaches a log is a value that reaches the evidence bundle.
//
// `docker/d1/runtime-keys/` is git-ignored. Nothing here is ever committed.

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KEY_DIR = path.join(repoRoot, "docker", "d1", "runtime-keys");
export const SIGNING_KEY_FILE = "control-plane-signing-key.pem";
export const PUBLIC_KEY_FILE = "control-plane-public-key.pem";
export const MASTER_KEY_ENV = "AOA_D1_SPINE_SECRETS_MASTER_KEY";

/** Write the pair. Returns the two paths; the bytes are never returned or logged. */
export function writeControlPlaneKeypair(dir = KEY_DIR) {
  mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingPath = path.join(dir, SIGNING_KEY_FILE);
  const publicPath = path.join(dir, PUBLIC_KEY_FILE);
  // 0o644: the container runs as a NON-ROOT user (uid 1000) and must be able to read the mounted
  // file. These are per-run throwaways that never leave the runner.
  writeFileSync(signingPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o644 });
  writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
  return { signingPath, publicPath };
}

function main() {
  const { signingPath, publicPath } = writeControlPlaneKeypair();
  const master = randomBytes(32).toString("base64");
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    // ★ THE MASK FIRST, THEN THE ENV FILE — never the other way round, and ONLY under Actions.
    // `::add-mask::` is a workflow command the RUNNER consumes; outside Actions nothing consumes it
    // and the line is just the key on someone's terminal, which is the redaction defect this script
    // exists to avoid. So the key reaches nothing but the env file.
    console.log(`::add-mask::${master}`);
    appendFileSync(githubEnv, `${MASTER_KEY_ENV}=${master}\n`);
  } else {
    console.error(
      `GITHUB_ENV is not set, so ${MASTER_KEY_ENV} was NOT emitted and is NOT printed. ` +
        "For a local bring-up, export your own.",
    );
  }
  console.log(
    `generated: 1 ed25519 keypair (${path.basename(signingPath)} + ${path.basename(publicPath)}; ` +
      `public half gates the provider wire) + 1 secrets master key`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href;
if (invokedDirectly || process.argv[1]?.endsWith("generate-d1-spine-keys.mjs")) main();
