// -----------------------------------------------------------------------------
// DEP-022 — the positive control for the E6F harness's STACK BINDING.
//
// `tests/d1/lib/e6f-harness.mjs` used to hardcode `-f docker-compose.d1.yml` into every
// `docker compose` call and `test-runner` into every HTTP client's dexec. DEP-022 made both a
// parameter so the shipped-boot lane (`docker-compose.staging.yml` + the m1-boot overlay, project
// `aoa-m1-boot`, no `test-runner` service) can reuse the nine cross-tenant drivers the D1 lane
// already proves.
//
// ★ A DEFAULT-IDENTICAL REFACTOR IS EXACTLY THE KIND THAT ROTS SILENTLY. If `composeBaseArgs()`
// ever stopped honouring the override, the shipped-boot lane would address the D1 stack — which
// is not running there — and every driver would fail for a reason that says nothing about
// tenancy. If it stopped producing the DEFAULT, the D1 merge train would break instead. So both
// directions are asserted, in pure node, on the `policy` lane.
//
// The harness is imported in a CHILD process per case because the two constants are read from
// `process.env` at module load; a single process could only ever observe one binding, and a test
// that can only observe one of the two states it is checking is not a check.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const harness = path.join(repoRoot, "tests", "d1", "lib", "e6f-harness.mjs");

/** Load the harness in a child process under `env` and report its binding. */
function binding(env) {
  const source = [
    `const m = await import(${JSON.stringify(new URL(`file://${harness.split(path.sep).join("/")}`).href)});`,
    `console.log(JSON.stringify({ argv: m.composeBaseArgs(), http: m.HTTP_SERVICE, composeFile: m.COMPOSE_FILE }));`,
  ].join("\n");
  const res = spawnSync(process.execPath, ["--input-type=module"], {
    input: source,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  assert.equal(res.status, 0, `child exited ${res.status}: ${res.stderr}`);
  const line = res.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line);
}

const CLEAR = {
  AOA_E6F_COMPOSE_FILES: "",
  AOA_E6F_COMPOSE_PROJECT: "",
  AOA_E6F_COMPOSE_ENV_FILE: "",
  AOA_E6F_HTTP_SERVICE: "",
};

test("DEFAULT: with no override the binding is byte-for-byte the D1 lane's own argv", () => {
  const b = binding(CLEAR);
  assert.deepEqual(b.argv, ["compose", "-f", b.composeFile]);
  assert.ok(b.composeFile.endsWith("docker-compose.d1.yml"), `default compose file: ${b.composeFile}`);
  assert.equal(b.http, "test-runner");
});

test("OVERRIDE: the shipped-boot lane's project, two files and HTTP service all take effect", () => {
  const files = ["docker-compose.staging.yml", "docker/m1-boot/docker-compose.m1-boot.yml"];
  const b = binding({
    AOA_E6F_COMPOSE_FILES: files.join(path.delimiter),
    AOA_E6F_COMPOSE_PROJECT: "aoa-m1-boot",
    AOA_E6F_COMPOSE_ENV_FILE: "/tmp/m1/.env",
    AOA_E6F_HTTP_SERVICE: "control-plane",
  });
  assert.deepEqual(b.argv, [
    "compose", "-p", "aoa-m1-boot", "--env-file", "/tmp/m1/.env",
    "-f", "docker-compose.staging.yml",
    "-f", "docker/m1-boot/docker-compose.m1-boot.yml",
  ]);
  assert.equal(b.http, "control-plane");
  // The override must REPLACE the D1 file, never be appended beside it: addressing both stacks
  // at once would render services that are not running and fail for an unrelated reason.
  assert.ok(!b.argv.includes(b.composeFile), "the D1 compose file must not survive an override");
});

test("PARTIAL override: a project with no file list still addresses the default file", () => {
  const b = binding({ ...CLEAR, AOA_E6F_COMPOSE_PROJECT: "solo" });
  assert.deepEqual(b.argv, ["compose", "-p", "solo", "-f", b.composeFile]);
});

test("an env file with no project or file override still reaches the default file", () => {
  const b = binding({ ...CLEAR, AOA_E6F_COMPOSE_ENV_FILE: "/tmp/x.env" });
  assert.deepEqual(b.argv, ["compose", "--env-file", "/tmp/x.env", "-f", b.composeFile]);
});

test("BLANK and whitespace-only values are treated as absent, not as an empty file argument", () => {
  const b = binding({ AOA_E6F_COMPOSE_FILES: "  ", AOA_E6F_COMPOSE_PROJECT: " ", AOA_E6F_COMPOSE_ENV_FILE: " ", AOA_E6F_HTTP_SERVICE: "  " });
  assert.deepEqual(b.argv, ["compose", "-f", b.composeFile]);
  assert.equal(b.http, "test-runner");
});

test("the harness has NO remaining hardcoded compose-file argv", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(harness, "utf8");
  // The only surviving mention of the constant must be its declaration and the default inside
  // `composeBaseArgs()`; a `["compose", "-f", COMPOSE_FILE` argv anywhere else is a site the
  // refactor missed, and it would silently keep addressing the D1 stack.
  assert.equal(source.includes('"compose", "-f", COMPOSE_FILE'), false,
    "a compose call still hardcodes COMPOSE_FILE instead of spreading composeBaseArgs()");
  assert.equal(source.includes('dexecModule("test-runner"'), false,
    "an HTTP client still hardcodes the test-runner service instead of HTTP_SERVICE");
});
