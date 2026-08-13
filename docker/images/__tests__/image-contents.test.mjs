#!/usr/bin/env node
/**
 * image-contents.test.mjs — least-privilege assertions on the BUILT DEP-001
 * images. LINUX/CI-ONLY: requires a Docker daemon and the images produced by
 * docker/images/build.sh (this host has no Docker and CI is billing-blocked, so
 * these SKIP locally and run for real in CI's image lane, per plan §3 / the
 * DEP-001 gate row).
 *
 * Run (in CI, after build.sh + sign.sh):
 *   AOA_DEP001_IMAGE_TEST=1 node --test docker/images/__tests__/image-contents.test.mjs
 *
 * Asserts, against each running image:
 *   - control-plane: NO docker binary, NO worker daemon, NO agent CLIs; runs
 *     non-root; carries the OCI revision label matching digests.env.
 *   - worker: NO server/db/ui; runs non-root; ships the worker-daemon binary;
 *     carries the OCI revision label.
 */

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const DIGESTS = path.join(ROOT, "docker/images/digests.env");

function dockerAvailable() {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const ACTIVE = process.env.AOA_DEP001_IMAGE_TEST === "1" && existsSync(DIGESTS) && dockerAvailable();
const SKIP = ACTIVE
  ? false
  : "requires Docker + built images (build.sh) — Linux/CI-only (deferred; this host has no Docker)";

let env = {};
before(() => {
  if (!ACTIVE) return;
  for (const line of readFileSync(DIGESTS, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
});

function runIn(image, script) {
  return execFileSync("docker", ["run", "--rm", "--entrypoint", "sh", image, "-c", script], {
    encoding: "utf8",
  }).trim();
}
function inspect(image, fmt) {
  return execFileSync("docker", ["inspect", "--format", fmt, image], { encoding: "utf8" }).trim();
}

test("control-plane: no docker binary, no worker daemon, no agent CLIs, non-root", { skip: SKIP }, () => {
  const image = env.CONTROL_PLANE_IMAGE;
  assert.equal(runIn(image, "command -v docker || echo NONE"), "NONE", "no docker binary");
  assert.equal(runIn(image, "test -e /app/packages/worker-daemon && echo YES || echo NONE"), "NONE", "no worker daemon");
  assert.equal(runIn(image, "ls /app/node_modules/@anthropic-ai/claude-code 2>/dev/null && echo YES || echo NONE"), "NONE", "no claude CLI");
  assert.notEqual(runIn(image, "id -u"), "0", "must run non-root");
});

test("control-plane: carries the OCI revision label from digests.env", { skip: SKIP }, () => {
  const image = env.CONTROL_PLANE_IMAGE;
  const rev = inspect(image, "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}");
  assert.equal(rev, env.CONTROL_PLANE_REVISION);
});

test("worker: no server/db/ui, ships the daemon binary, non-root", { skip: SKIP }, () => {
  const image = env.WORKER_IMAGE;
  assert.equal(runIn(image, "test -e /worker-app/node_modules/@armyofagents/server && echo YES || echo NONE"), "NONE", "no server");
  assert.equal(runIn(image, "test -e /worker-app/node_modules/@armyofagents/db && echo YES || echo NONE"), "NONE", "no db");
  assert.equal(runIn(image, "test -e /worker-app/node_modules/@armyofagents/ui && echo YES || echo NONE"), "NONE", "no ui");
  assert.equal(runIn(image, "test -f /worker-app/dist/bin/worker-daemon.js && echo YES || echo NONE"), "YES", "daemon present");
  assert.notEqual(runIn(image, "id -u"), "0", "must run non-root");
});

test("worker: carries the OCI revision label from digests.env", { skip: SKIP }, () => {
  const image = env.WORKER_IMAGE;
  const rev = inspect(image, "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}");
  assert.equal(rev, env.WORKER_REVISION);
});
