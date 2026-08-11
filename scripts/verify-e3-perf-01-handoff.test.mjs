import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const verifierUrl = new URL("./verify-e3-perf-01-handoff.mjs", import.meta.url);

test("independent Security handoff verifier is an executable sealed command", async () => {
  // Mutation caught: omitting the distinct verifier leaves Integration's local QA/archive
  // self-attesting and lets a valid campaign-runner pin authorize substituted Security bytes.
  assert.equal(existsSync(verifierUrl), true, "independent Security verifier is missing");
  if (!existsSync(verifierUrl)) return;
  const verifier = await import("./verify-e3-perf-01-handoff.mjs");
  assert.equal(typeof verifier.runSecurityHandoffCommand, "function");
  if (typeof verifier.runSecurityHandoffCommand !== "function") return;

  const fixture = securityVerifierFixture();
  assert.deepEqual(Object.keys(fixture.capabilities).sort(), ["artifact", "clock", "process", "store"]);
  const outcome = await captureVerifierOutcome(() => verifier.runSecurityHandoffCommand([
    "--manifest", fixture.paths.manifest,
    "--qa", fixture.paths.qa,
    "--output", fixture.paths.handoff,
  ], fixture.capabilities));
  assert.equal(outcome.error, undefined, "the distinct Security command must execute end to end");
  assert.equal(outcome.value?.disposition, "pass");
  assert.equal(outcome.value?.objectVersion, "version-a1");
  const exactVersionRefetch = {
    objectUri: fixture.state.qa.objectUri,
    versionId: fixture.state.qa.objectVersion,
  };
  assert.deepEqual(fixture.state.storeTrace, [
    { operation: "head", input: exactVersionRefetch },
    { operation: "get", input: exactVersionRefetch },
    { operation: "retention", input: exactVersionRefetch },
  ], "head, get, and retention must all address the exact QA-pinned object version");
  assert.deepEqual(fixture.state.writes.map((entry) => entry.path), [fixture.paths.handoff]);
  const handoff = JSON.parse(fixture.state.writes[0].bytes.toString("utf8"));
  assert.equal(handoff.securityVerifierSha256, fixture.state.verifierSha256);
  assert.equal(handoff.campaignRunnerSha256, fixture.state.campaignRunnerSha256);
  assert.notEqual(handoff.securityVerifierSha256, handoff.campaignRunnerSha256);

  for (const missing of ["process", "artifact", "store", "clock"]) {
    const candidate = { ...fixture.capabilities };
    delete candidate[missing];
    const rejected = await captureVerifierOutcome(() => verifier.runSecurityHandoffCommand([
      "--manifest", fixture.paths.manifest, "--qa", fixture.paths.qa, "--output", fixture.paths.handoff,
    ], candidate));
    assert.equal(rejected.error?.code ?? rejected.value?.failureCode, "security_capabilities", missing);
  }
  const withExtra = { ...fixture.capabilities, campaign: {} };
  const extra = await captureVerifierOutcome(() => verifier.runSecurityHandoffCommand([
    "--manifest", fixture.paths.manifest, "--qa", fixture.paths.qa, "--output", fixture.paths.handoff,
  ], withExtra));
  assert.equal(extra.error?.code ?? extra.value?.failureCode, "security_capabilities");
});

test("independent Security verification refetches the exact immutable version and rejects every pin/readback/retention mutation", async () => {
  assert.equal(existsSync(verifierUrl), true, "independent Security verifier is missing");
  if (!existsSync(verifierUrl)) return;
  const verifier = await import("./verify-e3-perf-01-handoff.mjs");
  assert.equal(typeof verifier.runSecurityHandoffCommand, "function");
  if (typeof verifier.runSecurityHandoffCommand !== "function") return;

  const cases = [
    ["verifier_path", "security_verifier_path", (fixture) => {
      fixture.state.bootstrap.verifierPath = fixture.paths.campaignRunner;
      fixture.rewriteBootstrap();
    }],
    ["verifier_bytes", "security_verifier_digest", (fixture) => {
      fixture.state.files.set(fixture.paths.verifier, Buffer.from("substituted-security-verifier"));
    }],
    ["archive_hash", "security_archive_digest", (fixture) => {
      fixture.state.qa.archiveSha256 = "0".repeat(64);
      fixture.rewriteQa();
    }],
    ["archive_mutation", "security_archive_readback", (fixture) => { fixture.state.mutateArchive = true; }],
    ["archive_schema", "security_archive_schema", (fixture) => { fixture.state.archiveSchemaValid = false; }],
    ["archive_canary", "security_archive_canary", (fixture) => { fixture.state.archiveCanary = true; }],
    ["version_mismatch", "security_object_version", (fixture) => { fixture.state.headVersion = "version-attacker"; }],
    ["checksum_mismatch", "security_object_checksum", (fixture) => { fixture.state.headChecksum = "0".repeat(64); }],
    ["retention_absent", "security_object_retention", (fixture) => { fixture.state.retention = null; }],
    ["retention_governance", "security_object_retention", (fixture) => {
      fixture.state.retention = { mode: "GOVERNANCE", retainUntil: "2027-02-08T00:00:00.000Z" };
    }],
    ["retention_short", "security_object_retention", (fixture) => {
      fixture.state.retention = { mode: "COMPLIANCE", retainUntil: "2026-08-12T00:00:00.000Z" };
    }],
    ["backend_loss", "security_store_readback", (fixture) => { fixture.state.backendLost = true; }],
    ["handoff_collision", "security_handoff_exclusive", (fixture) => {
      fixture.state.existingWrites.add(fixture.paths.handoff);
    }],
  ];
  for (const [name, expectedCode, mutate] of cases) {
    const fixture = securityVerifierFixture();
    mutate(fixture);
    const outcome = await captureVerifierOutcome(() => verifier.runSecurityHandoffCommand([
      "--manifest", fixture.paths.manifest,
      "--qa", fixture.paths.qa,
      "--output", fixture.paths.handoff,
    ], fixture.capabilities));
    assert.equal(outcome.error?.code ?? outcome.value?.failureCode, expectedCode, name);
    assert.equal(fixture.state.writes.some((entry) => entry.path === fixture.paths.handoff), false, name);
  }
});

test("the real verifier rejects fake selectors before loading attacker code", () => {
  assert.equal(existsSync(verifierUrl), true, "independent Security verifier is missing");
  if (!existsSync(verifierUrl)) return;
  const verifierPath = fileURLToPath(verifierUrl);
  const source = readFileSync(verifierPath, "utf8");
  assert.match(source, /e3-perf-01-security-bootstrap\.json/);
  assert.match(source, /GetObjectRetention|COMPLIANCE|compliance/);
  assert.match(source, /security-handoff\.json/);
  assert.doesNotMatch(source, /(?:--fake|test[-_]?mode|fake[-_]?module|capabilit(?:y|ies)[-_]?path)/iu);
  assert.doesNotMatch(source, /from\s+["']\.\/run-e3-perf-01\.mjs["']/u);

  const result = spawnSync(process.execPath, [verifierPath, "--fake", "./attacker.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /attacker\.mjs|ERR_MODULE_NOT_FOUND/iu);
});

async function captureVerifierOutcome(run) {
  try {
    return { value: await run(), error: undefined };
  } catch (error) {
    return { value: undefined, error };
  }
}

function securityVerifierFixture() {
  const paths = Object.freeze({
    manifest: "C:/security/checkout/perf-manifest.json",
    qa: "C:/security/output/a1/qa.json",
    handoff: "C:/security/output/a1/security-handoff.json",
    verifier: "C:/security/checkout/scripts/verify-e3-perf-01-handoff.mjs",
    campaignRunner: "C:/security/checkout/scripts/run-e3-perf-01.mjs",
    bootstrap: "C:/security/e3-perf-01-security-bootstrap.json",
  });
  const verifierBytes = Buffer.from("pinned-security-verifier");
  const campaignRunnerBytes = Buffer.from("pinned-integration-runner");
  const archiveBytes = Buffer.from(JSON.stringify({
    format: "aoa-e3-perf-01-archive-v1",
    entries: [{ path: "e3-perf-01-evidence.json", disposition: "pass" }],
  }));
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const state = {
    files: new Map([
      [paths.verifier, verifierBytes],
      [paths.campaignRunner, campaignRunnerBytes],
      [paths.manifest, Buffer.from(JSON.stringify({ schemaVersion: 1, gate: "E3-PERF-01" }))],
    ]),
    verifierSha256: sha256(verifierBytes),
    campaignRunnerSha256: sha256(campaignRunnerBytes),
    archiveBytes,
    archiveSha256: sha256(archiveBytes),
    archiveSchemaValid: true,
    archiveCanary: false,
    mutateArchive: false,
    headVersion: "version-a1",
    headChecksum: sha256(archiveBytes),
    backendLost: false,
    retention: { mode: "COMPLIANCE", retainUntil: "2027-02-08T00:00:00.000Z" },
    storeTrace: [],
    writes: [],
    existingWrites: new Set(),
    processRuns: [],
    bootstrap: {
      schemaVersion: 1,
      verifierPath: paths.verifier,
      verifierSha256: sha256(verifierBytes),
      campaignRunnerPath: paths.campaignRunner,
      campaignRunnerSha256: sha256(campaignRunnerBytes),
    },
    qa: {
      schemaVersion: 1,
      disposition: "pass",
      objectUri: "s3://aoa-e3-perf/e3-perf-01/a1/archive",
      objectVersion: "version-a1",
      checksumSha256: sha256(archiveBytes),
      archiveSha256: sha256(archiveBytes),
      retentionUntil: "2027-02-08T00:00:00.000Z",
      objectLockMode: "COMPLIANCE",
    },
  };
  const rewriteBootstrap = () => state.files.set(paths.bootstrap, Buffer.from(JSON.stringify(state.bootstrap)));
  const rewriteQa = () => state.files.set(paths.qa, Buffer.from(JSON.stringify(state.qa)));
  rewriteBootstrap();
  rewriteQa();

  const capabilities = Object.freeze({
    process: Object.freeze({
      parentEnvironment: () => ({}),
      async run(input) {
        state.processRuns.push({ executable: input.executable, argv: [...input.argv], shell: input.shell });
        return { code: 0, stdout: "", stderr: "" };
      },
    }),
    artifact: Object.freeze({
      async realpath(path) { return path; },
      async readFile(path) {
        const bytes = state.files.get(path);
        if (!bytes) throw Object.assign(new Error("missing artifact"), { code: "ENOENT" });
        return Buffer.from(bytes);
      },
      async writeExclusive(path, bytes) {
        if (state.existingWrites.has(path)) return false;
        state.existingWrites.add(path);
        state.writes.push({ path, bytes: Buffer.from(bytes) });
        return true;
      },
      validateArchive(bytes) {
        return state.archiveSchemaValid && !state.archiveCanary && Buffer.isBuffer(bytes);
      },
    }),
    store: Object.freeze({
      async headObject(input) {
        state.storeTrace.push({ operation: "head", input: structuredClone(input) });
        if (state.backendLost) throw Object.assign(new Error("backend unavailable"), { code: "BACKEND_LOST" });
        return {
          versionId: state.headVersion,
          checksumSha256: state.headChecksum,
          byteLength: state.archiveBytes.length,
        };
      },
      async getObject(input) {
        state.storeTrace.push({ operation: "get", input: structuredClone(input) });
        if (state.backendLost) throw Object.assign(new Error("backend unavailable"), { code: "BACKEND_LOST" });
        if (state.archiveCanary) return Buffer.from("E3_SECRET_CANARY");
        return state.mutateArchive ? Buffer.from("mutated-archive") : Buffer.from(state.archiveBytes);
      },
      async getObjectRetention(input) {
        state.storeTrace.push({ operation: "retention", input: structuredClone(input) });
        return state.retention && { ...state.retention };
      },
    }),
    clock: Object.freeze({ now: () => new Date("2026-08-11T01:05:00.000Z") }),
  });
  return {
    paths,
    state,
    capabilities,
    rewriteBootstrap,
    rewriteQa,
  };
}
