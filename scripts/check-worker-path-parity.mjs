#!/usr/bin/env node
// WRK-008 slice 2 — the daemon's vendored route paths must equal the server's routes.
//
// ★ WHY A SCRIPT AND NOT A TEST. `packages/worker-daemon` may import only
// `@armyofagents/worker-protocol`, `pino` and Node builtins (E4-D01), and `server` does
// not depend on worker-daemon — so NEITHER side can import the other's constant. A test
// living in either package would have to read the other's source as text and would skip
// silently wherever that file is absent. A repo-level guard has the whole tree by
// definition, and this repo already forces every `check-*.mjs` to be declared in
// `guard-inventory.json`, so it cannot quietly stop running.
//
// ★ WHY IT MATTERS MORE THAN A 404. The device proof is signed OVER the request path.
// If these drift, the symptom is not "route not found" — it is a signature that can never
// verify, on a request that reached the right handler. That failure reads as an auth bug
// and sends the reader to the crypto, not to a renamed route.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

/** Each pair: a constant in the daemon's client, and the Express route that serves it.
 * `mount` is the prefix the server router is mounted under — the daemon signs the FULL
 * path, so the prefix is part of the contract, not decoration. */
const PAIRS = [
  {
    name: "self-model read (WRK-008 slice 2)",
    daemonFile: "packages/worker-daemon/src/transport/client.ts",
    daemonConst: "SELF_MODEL_READ_PATH",
    serverFile: "server/src/routes/execution-targets.ts",
    mount: "/api",
    serverRoute: "/execution-targets/self/placement-profile",
  },
];

function readConstant(file, name) {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const m = text.match(new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`));
  return m ? m[1] : null;
}

function serverDeclaresRoute(file, route) {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  // The route string must appear as a router registration argument, not merely anywhere
  // in the file — a mention inside a comment is exactly the false positive this
  // programme has hit before (a comment naming a symbol read as a use of it).
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  return withoutComments.includes(`"${route}"`);
}

const failures = [];
for (const pair of PAIRS) {
  const declared = readConstant(pair.daemonFile, pair.daemonConst);
  if (declared === null) {
    failures.push(`${pair.name}: ${pair.daemonConst} not found in ${pair.daemonFile}`);
    continue;
  }
  const expected = `${pair.mount}${pair.serverRoute}`;
  if (declared !== expected) {
    failures.push(
      `${pair.name}: the daemon signs ${JSON.stringify(declared)} but the server serves ` +
        `${JSON.stringify(expected)} — the device proof would never verify`,
    );
  }
  if (!serverDeclaresRoute(pair.serverFile, pair.serverRoute)) {
    failures.push(
      `${pair.name}: ${pair.serverFile} no longer registers ${JSON.stringify(pair.serverRoute)} ` +
        "(searched with comments stripped, so a mention in a comment does not count)",
    );
  }
}

if (failures.length > 0) {
  console.error("worker route-path parity FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`worker route-path parity OK (${PAIRS.length} pair${PAIRS.length === 1 ? "" : "s"})`);
