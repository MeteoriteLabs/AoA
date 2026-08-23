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
    // build.sh:52 emits `${name^^}_IMAGE`. Bash `^^` uppercases but does NOT
    // translate the hyphen, so the control-plane keys arrive as
    // `CONTROL-PLANE_IMAGE`. The original `[A-Z_]+` class did not match a
    // hyphen, so those three lines were silently DROPPED and every
    // control-plane assertion below ran against `undefined:latest`.
    //
    // Fixed in the CONSUMER, deliberately: `d1-merge-train.yml` greps
    // `^CONTROL-PLANE_IMAGE=` to point compose at the freshly built tags, so
    // "fixing" build.sh to emit an underscore would silently break the D1
    // bring-up — a worse failure than the one being repaired.
    const m = line.match(/^([A-Z0-9_-]+)=(.*)$/);
    if (m) env[m[1].replace(/-/g, "_")] = m[2];
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
  // WRK-009 — NO TEST DOUBLE may ship in the worker image.
  //
  // `createFakeSandboxProvider` fabricates success: a default script returns
  // exit 0, the supervisor maps that to terminal{status:"succeeded"}, and the
  // server completes a tenant attempt for work that never ran. It shipped at
  // /worker-app/dist/supervisor/fake-provider.js because it lived in the
  // daemon's own production source tree rather than in src/__tests__/support/
  // where every other double in the package already lives.
  //
  // It is the ONLY SandboxProvider the daemon can import under E4-D01, and a
  // fabricated success is byte-identical to a real one on every other gate — so
  // this assertion is the only thing standing between "someone composes the
  // loop" and a completed task that never executed.
  assert.equal(
    runIn(image, "find /worker-app -name 'fake-provider*' -o -name '*fake-provider*' 2>/dev/null | head -1 | grep -q . && echo FOUND || echo NONE"),
    "NONE",
    "no fake/test-double provider in the worker image",
  );
  // OUR OWN emitted output must contain no test tree. Deliberately scoped to
  // `dist` and NOT to all of /worker-app: third-party packages legitimately ship
  // their own test directories inside node_modules (zod publishes
  // `lib/__tests__/Mocker.js`), which we neither control nor execute. The first
  // draft of this assertion swept node_modules and failed on zod — a guard that
  // fails for a reason it was not written for gets deleted by the next person,
  // and takes the real assertion with it.
  //
  // The fake-provider check above stays UNSCOPED on purpose: that one is about a
  // fabricating provider reaching the image by ANY route, including
  // `packages/sandbox-fake-provider` arriving as a dependency into node_modules.
  assert.equal(
    runIn(image, "find /worker-app/dist -path '*__tests__*' -o -path '*__testing__*' 2>/dev/null | head -1 | grep -q . && echo FOUND || echo NONE"),
    "NONE",
    "no test tree in the worker image's own emitted output",
  );
  assert.notEqual(runIn(image, "id -u"), "0", "must run non-root");
});

test("worker: carries the OCI revision label from digests.env", { skip: SKIP }, () => {
  const image = env.WORKER_IMAGE;
  const rev = inspect(image, "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}");
  assert.equal(rev, env.WORKER_REVISION);
});
