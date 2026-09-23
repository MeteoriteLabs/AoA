// DEP-019 — the probe-wrapper mirror, pinned against the DAEMON'S OWN SOURCE.
//
// `node-eval.ts` recognises the `DEP-017` probe by the SHAPE of `ENV_PROBE_SH_WRAPPER`
// (`packages/worker-daemon/src/supervisor/env-probe.ts`). It matches rather than imports, because
// this package imports no worker-daemon code (its runtime deps are worker-protocol + zod + Node
// built-ins, and the fake-provider image's closure is built on that).
//
// A mirror that nothing checks is a mirror that drifts. If the daemon ever rewrites the wrapper,
// the failure without this test is silent and expensive: the reference provider stops recognising
// the probe, answers it on the scripted path, and every worker-driven m1-spine run reds as
// `env_probe_not_run` — a symptom several layers from its cause. With this test, the drift fails
// HERE, naming both files.
//
// Same pattern, same reason as `docker/d1/__tests__/enrolment-seed.test.mjs`, which pins the
// control-plane seed's ticket-codec mirror against the daemon's codec.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NODE_EVAL_WRAPPER_PATTERN, classifyShellInvocation } from "../index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ENV_PROBE_SOURCE = path.join(repoRoot, "packages", "worker-daemon", "src", "supervisor", "env-probe.ts");

/** Read the daemon's committed wrapper by evaluating the two template pieces it is built from.
 * Deliberately NOT a regex over the whole file: the point is to reconstruct the exact STRING the
 * daemon ships, so a change to either half is caught. */
function readDaemonWrapper(): string {
  const source = readFileSync(ENV_PROBE_SOURCE, "utf8");
  const marker = /export const ENV_PROBE_NO_NODE_MARKER\s*=\s*"([^"]+)"/.exec(source);
  const exit = /export const ENV_PROBE_NO_NODE_EXIT_CODE\s*=\s*(\d+)/.exec(source);
  const wrapper = /export const ENV_PROBE_SH_WRAPPER\s*=\s*\n?\s*`([^`]*)`\s*\+\s*\n?\s*`([^`]*)`/.exec(source);
  expect(marker, `ENV_PROBE_NO_NODE_MARKER not found in ${ENV_PROBE_SOURCE}`).not.toBeNull();
  expect(exit, `ENV_PROBE_NO_NODE_EXIT_CODE not found in ${ENV_PROBE_SOURCE}`).not.toBeNull();
  expect(wrapper, `ENV_PROBE_SH_WRAPPER not found in ${ENV_PROBE_SOURCE}`).not.toBeNull();
  return `${wrapper![1]}${wrapper![2]}`
    .replace("${ENV_PROBE_NO_NODE_MARKER}", marker![1]!)
    .replace("${ENV_PROBE_NO_NODE_EXIT_CODE}", exit![1]!);
}

describe("DEP-017 probe wrapper mirror (DEP-019)", () => {
  it("the daemon's committed ENV_PROBE_SH_WRAPPER is recognised by this package's matcher", () => {
    const wrapper = readDaemonWrapper();
    // Non-vacuity: the reconstruction must have resolved both interpolations.
    expect(wrapper).not.toContain("${");
    expect(wrapper).toContain("exec node -e");
    expect(NODE_EVAL_WRAPPER_PATTERN.test(wrapper)).toBe(true);
  });

  it("a probe invocation built from the daemon's wrapper classifies as a node_eval", () => {
    const invocation = classifyShellInvocation("sh", ["-c", readDaemonWrapper(), "console.log(1);", "org"], {});
    expect(invocation.kind).toBe("node_eval");
  });

  it("the matcher is not vacuous: a wrapper with the node branch removed is NOT recognised", () => {
    const broken = readDaemonWrapper().replace('exec node -e "$0" "$@"', "exec true");
    expect(NODE_EVAL_WRAPPER_PATTERN.test(broken)).toBe(false);
  });
});
