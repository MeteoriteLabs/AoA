// DEP-019 — the per-op port mirror, pinned against the DAEMON'S OWN SOURCE.
//
// `per-op-provider.ts` mirrors `SandboxProvider` structurally rather than importing it, so that
// this package's runtime closure stays worker-protocol + zod + node built-ins — which is what the
// D1 fake-provider image is built on. A structural mirror that nothing checks drifts, and the
// failure mode is expensive and remote from its cause: the adapter-manager would 404 or throw on
// an op the worker legitimately calls, and the m1-spine run would fail as a provider fault.
//
// So the shape is read OUT OF THE DAEMON'S SOURCE and compared. Same pattern, same reason, as
// `node-eval-wrapper-mirror.test.ts` and `docker/d1/__tests__/enrolment-seed.test.mjs`.
//
// What is asserted:
//   1. every method on the daemon's `SandboxProvider` exists on the façade;
//   2. every one of the frozen CORE ops is advertised, and nothing beyond them;
//   3. the four result/label shapes the gate and the supervisor read field-by-field —
//      `ResourceLabels`, `CreateResult`, `ExecuteResult`, `InspectResult` — have exactly the
//      daemon's field names, so a renamed or dropped field fails HERE.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CORE_PROVIDER_OPERATIONS } from "@armyofagents/worker-protocol";

import { PER_OP_CORE_OPERATIONS, createFakeSandboxProviderPort } from "../index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PROVIDER_SOURCE = path.join(repoRoot, "packages", "worker-daemon", "src", "supervisor", "provider.ts");
const source = readFileSync(PROVIDER_SOURCE, "utf8");

/** The body of `export interface <name> { … }`, brace-matched from its opening brace. */
function interfaceBody(name: string): string {
  const start = source.indexOf(`export interface ${name} {`);
  expect(start, `interface ${name} not found in ${PROVIDER_SOURCE}`).toBeGreaterThan(-1);
  let depth = 0;
  const open = source.indexOf("{", start);
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated interface ${name}`);
}

/** `readonly <name>:` field names, comments and nested blocks ignored. */
function readonlyFields(body: string): string[] {
  return [...body.matchAll(/^\s*readonly\s+([A-Za-z_][A-Za-z0-9_]*)\s*[?]?\s*:/gm)].map((m) => m[1]!);
}

/** `<name>(…)` method names declared on the interface (not the `readonly` properties). */
function methodNames(body: string): string[] {
  return [...body.matchAll(/^\s{2}([a-zA-Z_][A-Za-z0-9_]*)\s*\(/gm)].map((m) => m[1]!);
}

describe("per-op port mirror (DEP-019)", () => {
  const port = createFakeSandboxProviderPort() as unknown as Record<string, unknown>;

  it("every method on the daemon's SandboxProvider exists on the façade", () => {
    const methods = methodNames(interfaceBody("SandboxProvider"));
    // Non-vacuity: the daemon's port has the 8 core ops plus the optional ones; a parse that found
    // nothing must not read as "all present".
    expect(methods.length).toBeGreaterThanOrEqual(8);
    expect(methods).toContain("create");
    expect(methods).toContain("execute");
    const missing = methods.filter((m) => typeof port[m] !== "function");
    expect(missing, `façade is missing ${missing.join(", ")}`).toEqual([]);
  });

  it("the advertised set is EXACTLY the frozen core ops", () => {
    expect([...PER_OP_CORE_OPERATIONS].sort()).toEqual([...CORE_PROVIDER_OPERATIONS].sort());
    expect([...(port.advertisedOperations as Set<string>)].sort()).toEqual([...CORE_PROVIDER_OPERATIONS].sort());
  });

  it("every optional mode is declared, and `none`", () => {
    for (const mode of ["checkpointMode", "healthMode", "artifactExportMode", "fileStagingMode", "processSupervisionMode"]) {
      expect(source, `${mode} is not declared on the daemon's port`).toContain(`readonly ${mode}:`);
      expect(port[mode], `${mode} on the façade`).toBe("none");
    }
  });

  it.each([
    ["ResourceLabels", { organizationId: "o", targetId: "t", workerId: "w", jobId: "j", attempt: 1, leaseId: "l", deviceGeneration: 2 }],
    ["CreateResult", { sandboxId: "s", providerOpId: "p", resourceLabels: {} }],
    ["ExecuteResult", { providerOpId: "p", exitCode: 0, signal: null, timedOut: false, stdoutRef: "a", stderrRef: "b" }],
  ])("the %s shape this package mirrors has exactly the daemon's field names", (name, mirrored) => {
    const daemonFields = readonlyFields(interfaceBody(name as string)).sort();
    expect(daemonFields.length).toBeGreaterThan(0);
    expect(Object.keys(mirrored as object).sort()).toEqual(daemonFields);
  });

  it("InspectResult carries every field the daemon declares — the redaction must have something to redact", async () => {
    const daemonFields = readonlyFields(interfaceBody("InspectResult")).sort();
    const created = await port.create!.call(port, {
      resourceLabels: { organizationId: "o", targetId: "t", workerId: "w", jobId: "j", attempt: 1, leaseId: "l", deviceGeneration: 3 },
      command: "claude",
      args: [],
      env: { ANTHROPIC_API_KEY: "sk-test" },
      workloadType: "batch",
    }, { deadlineMs: 1000, idempotencyKey: "k1" });
    const inspected = await port.inspect!.call(port, (created as { sandboxId: string }).sandboxId, {
      deadlineMs: 1000,
      idempotencyKey: "k2",
    });
    expect(Object.keys(inspected as object).sort()).toEqual(daemonFields);
    // Non-vacuous redaction: the sensitive projection really does carry the sandbox's env.
    expect((inspected as { env: Record<string, string> }).env).toEqual({ ANTHROPIC_API_KEY: "sk-test" });
  });
});
