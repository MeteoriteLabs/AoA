/**
 * Minimal "worker" consumer of the packed @armyofagents/worker-protocol
 * tarball. Run by scripts/check-worker-protocol-package.mjs from inside a
 * temp directory that has the exact tarball extracted into
 * node_modules/@armyofagents/worker-protocol (no network, no package manager).
 *
 * A future worker package must be able to depend on this leaf package the same
 * way the control plane does: import only the public root export, never reach
 * into `src` or private dist internals.
 */
import assert from "node:assert/strict";

import * as protocol from "@armyofagents/worker-protocol";

assert.deepEqual(
  Object.keys(protocol).sort(),
  ["MIN_PROTOCOL_VERSION", "PROTOCOL_VERSION"],
  "public surface must be exactly the version constants",
);
assert.equal(protocol.PROTOCOL_VERSION, 1, "PROTOCOL_VERSION must be 1");
assert.equal(protocol.MIN_PROTOCOL_VERSION, 1, "MIN_PROTOCOL_VERSION must be 1");

async function importFails(specifier) {
  try {
    await import(specifier);
    return false;
  } catch {
    return true;
  }
}

assert.equal(
  await importFails("@armyofagents/worker-protocol/src/version.js"),
  true,
  "src subpath must not be importable",
);
assert.equal(
  await importFails("@armyofagents/worker-protocol/dist/index.js"),
  true,
  "deep dist subpath must not be importable",
);

console.log("worker-consumer OK");
