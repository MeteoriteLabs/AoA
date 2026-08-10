import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const REQUIRED_ASSETS = [
  new URL("./run-e3-perf-01.mjs", import.meta.url),
  new URL("./e3-perf-01-manifest.schema.json", import.meta.url),
  new URL("./e3-perf-01-evidence.schema.json", import.meta.url),
  new URL("../server/src/__tests__/job-leasing-load.integration.test.ts", import.meta.url),
];
const assetsPresent = REQUIRED_ASSETS.every((asset) => existsSync(asset));
const SHA40 = "1".repeat(40);
const TREE40 = "2".repeat(40);
const BLOB40 = "3".repeat(40);
const SHA256 = "4".repeat(64);

test("E3-PERF-01 requires the reviewed runner, strict schemas, and dedicated load suite", () => {
  assert.deepEqual(
    REQUIRED_ASSETS.filter((asset) => !existsSync(asset)).map((asset) => asset.pathname.split("/").at(-1)),
    [],
    "required E3-PERF-01 implementation assets missing",
  );
});

async function runner() {
  return import("./run-e3-perf-01.mjs");
}

function manifestFixture() {
  return {
    schemaVersion: 1,
    gate: "E3-PERF-01",
    attempt: "a1",
    implementationRevision: SHA40,
    evidenceParentRevision: "5".repeat(40),
    evidenceParentTree: TREE40,
    manifestPath: `docs/replatform/epics/E3-job-control/qa/2026-08-11-e3-perf-01-${SHA40.slice(0, 12)}-a1.json`,
    reviewedEvidence: [{
      path: "docs/replatform/epics/E3-job-control/tickets/JOB-003-result.md",
      status: "M",
      mode: "100644",
      oldBlob: "6".repeat(40),
      newBlob: BLOB40,
      sha256: SHA256,
      reviewEvidenceBlob: "7".repeat(40),
    }],
    owners: {
      integration: { id: "e3-integration-gate-owner", approvedAt: "2026-08-11T01:00:00.000Z" },
      security: { id: "e3-security-gate-owner", approvedAt: "2026-08-11T01:05:00.000Z" },
    },
    runnerImage: {
      uri: `oci://registry.example.invalid/aoa/e6f06@sha256:${"8".repeat(64)}`,
      digest: `sha256:${"8".repeat(64)}`,
      attestationUri: `https://evidence.example.invalid/attestations/sha256/${"9".repeat(64)}`,
      attestationSha256: "9".repeat(64),
      policyUri: `s3://aoa-evidence/policy/sha256/${"a".repeat(64)}`,
      policySha256: "a".repeat(64),
      trustRootUri: `gs://aoa-trust/roots/sha256/${"b".repeat(64)}`,
      trustRootSha256: "b".repeat(64),
      e6f06QaBlob: "c".repeat(40),
      e6f06HandoffBlob: "d".repeat(40),
    },
    environment: {
      cpuModel: "pinned-cpu",
      vcpus: 8,
      ramMiB: 32768,
      storageClass: "pinned-ssd",
      filesystem: "ext4",
      mountFlags: ["nodev", "nosuid"],
      tmpfsMiB: 4096,
      nodeVersion: "22.18.0",
      nodeSha256: "e".repeat(64),
      pnpmVersion: "10.14.0",
      pnpmSha256: "f".repeat(64),
      postgresVersion: "17.5",
      postgresBinarySha256: "1".repeat(64),
      postgresSettings: { shared_buffers: "8GB", work_mem: "64MB" },
      competingWorkloadPolicy: "exclusive",
    },
    dataset: {
      seed: 3003,
      candidateRows: 1_000_000,
      certificateRows: 1_000_000,
      shapes: ["fully_certified", "ten_thousand_by_one_hundred", "stale_context", "cleanup_sparse_tail"],
      warmups: 5,
      claimSamples: 30,
      mutationSamples: 20,
    },
    thresholds: {
      shapesTwoThreeP95Ms: 250,
      shapesTwoThreeMaxMs: 1500,
      saturatedP95Ms: 2000,
      saturatedMaxMs: 5000,
      bulkUpsertP95Ms: 500,
      cleanupP95Ms: 750,
      combinedTableIndexBytesMax: 2 * 1024 * 1024 * 1024,
    },
    structuralRequirements: {
      exactRows: true,
      requiredIndexes: ["jobs_claim_idx", "job_attempts_lease_candidate_idx", "worker_lease_rejections_pkey"],
      noUnboundedSort: true,
      noHotSequentialScan: true,
    },
    sourceInputs: [{ path: "server/src/services/job-leasing.ts", mode: "100644", blob: BLOB40, sha256: SHA256 }],
    dependencyClosure: {
      frozenInstallInventorySha256: "2".repeat(64),
      packageStoreIntegritySha256: "3".repeat(64),
      criticalInputs: [{ path: "pnpm-lock.yaml", mode: "100644", blob: "4".repeat(40), sha256: "5".repeat(64) }],
    },
    referencedEvidence: [{
      uri: `https://evidence.example.invalid/reviews/sha256/${"6".repeat(64)}`,
      sha256: "6".repeat(64),
    }],
    output: {
      origin: "s3://aoa-e3-perf",
      namespace: `s3://aoa-e3-perf/e3-perf-01/${SHA40}/a1`,
      retentionUntil: "2027-02-07T00:00:00.000Z",
    },
  };
}

function evidenceFixture() {
  return {
    schemaVersion: 1,
    gate: "E3-PERF-01",
    attempt: "a1",
    implementationRevision: SHA40,
    environment: {
      imageDigest: `sha256:${"8".repeat(64)}`,
      kernel: "6.8.0",
      architecture: "x64",
      cpuModel: "pinned-cpu",
      vcpus: 8,
      ramMiB: 32768,
      storageClass: "pinned-ssd",
      filesystem: "ext4",
      mountFlags: ["nodev", "nosuid"],
      nodeVersion: "22.18.0",
      nodeSha256: "e".repeat(64),
      pnpmVersion: "10.14.0",
      pnpmSha256: "f".repeat(64),
      postgresVersion: "17.5",
      postgresBinarySha256: "1".repeat(64),
      postgresSettings: { shared_buffers: "8GB", work_mem: "64MB" },
    },
    dataset: { seed: 3003, candidateRows: 1_000_000, certificateRows: 1_000_000 },
    samples: [{ shape: "ten_thousand_by_one_hundred", milliseconds: 100, actualRows: 256, removedRows: 0 }],
    storage: { tableBytes: 1, indexBytes: 1, combinedBytes: 2 },
    plans: [{ shape: "ten_thousand_by_one_hundred", plan: { "Node Type": "Index Scan", "Actual Rows": 256 } }],
    results: { thresholdsPassed: true, structurePassed: true, canaryScanPassed: true },
  };
}

test("strict schemas close every object and pin revisions, provenance, thresholds, and evidence", { skip: !assetsPresent }, async () => {
  const mod = await runner();
  assert.equal(mod.validateManifestDocument(manifestFixture()), true);
  assert.equal(mod.validateEvidenceDocument(evidenceFixture()), true);

  for (const mutate of [
    (value) => { value.unknown = true; },
    (value) => { delete value.thresholds.bulkUpsertP95Ms; },
    (value) => { value.thresholds.shapesTwoThreeP95Ms = 251; },
    (value) => { value.owners.security.id = value.owners.integration.id; },
    (value) => { value.implementationRevision = "short"; },
    (value) => { value.reviewedEvidence[0].newBlob = "bad"; },
    (value) => { value.reviewedEvidence[0].sha256 = "A".repeat(64); },
    (value) => { value.containingCommit = SHA40; },
    (value) => { value.containingTree = TREE40; },
  ]) {
    const changed = structuredClone(manifestFixture());
    mutate(changed);
    assert.throws(() => mod.validateManifestDocument(changed));
  }
  const unknownEvidence = evidenceFixture();
  unknownEvidence.results.secret = "forbidden";
  assert.throws(() => mod.validateEvidenceDocument(unknownEvidence));
});

test("input URIs are credentialless and digest-bound while output is prospective then content-addressed", { skip: !assetsPresent }, async () => {
  const mod = await runner();
  for (const uri of [
    `https://evidence.example.invalid/item/sha256/${SHA256}`,
    `s3://bucket/item/sha256/${SHA256}`,
    `gs://bucket/item/sha256/${SHA256}`,
    `oci://registry.example.invalid/image@sha256:${SHA256}`,
  ]) assert.equal(mod.validateContentAddressedInputUri(uri), true);
  for (const uri of [
    "http://example.invalid/evidence",
    `https://user:password@example.invalid/sha256/${SHA256}`,
    `https://example.invalid/sha256/${SHA256}?signature=secret`,
    `https://example.invalid/sha256/${SHA256}#fragment`,
    "s3://bucket/latest",
    "oci://registry.example.invalid/image:latest",
    `file:///tmp/sha256/${SHA256}`,
  ]) assert.throws(() => mod.validateContentAddressedInputUri(uri));

  const namespace = `s3://aoa-e3-perf/e3-perf-01/${SHA40}/a1`;
  assert.equal(mod.validateProspectiveOutputNamespace(namespace, SHA40, "a1"), true);
  assert.equal(
    mod.deriveDigestAddressedOutputUri(namespace, SHA256),
    `${namespace}/sha256/${SHA256}`,
  );
  for (const invalid of [
    `${namespace}/sha256/${SHA256}`,
    `s3://aoa-e3-perf/e3-perf-01/${SHA40}/a2`,
    `s3://other/e3-perf-01/${SHA40}/a1`,
    `${namespace}?token=secret`,
  ]) assert.throws(() => mod.validateProspectiveOutputNamespace(invalid, SHA40, "a1"));
});

test("recursive canary and credential rejection never echoes the sensitive value", { skip: !assetsPresent }, async () => {
  const mod = await runner();
  for (const path of [
    ["output", "namespace"],
    ["runnerImage", "attestationUri"],
    ["runnerImage", "policyUri"],
    ["runnerImage", "trustRootUri"],
    ["referencedEvidence", 0, "uri"],
    ["environment", "postgresSettings", "work_mem"],
  ]) {
    const canary = `E3_CANARY_${path.join("_")}_do_not_echo`;
    const changed = structuredClone(manifestFixture());
    let cursor = changed;
    for (const segment of path.slice(0, -1)) cursor = cursor[segment];
    cursor[path.at(-1)] = canary;
    let message = "";
    try { mod.validateManifestDocument(changed, { canaries: [canary] }); } catch (error) { message = String(error); }
    assert.ok(message.length > 0);
    assert.equal(message.includes(canary), false);
  }
});

test("orchestration fails closed before load on provenance, Git, dependency, or image drift", { skip: !assetsPresent }, async () => {
  const mod = await runner();
  const base = mod.createContractTestSeams({
    implementationRevision: SHA40,
    evidenceParentRevision: "5".repeat(40),
    evidenceParentTree: TREE40,
    manifestPath: manifestFixture().manifestPath,
  });
  for (const mutation of [
    ["wrong_parent", (seams) => { seams.git.parents = ["0".repeat(40)]; }],
    ["multiple_parent", (seams) => { seams.git.parents.push("f".repeat(40)); }],
    ["replace_ref", (seams) => { seams.git.replaceRefs = ["refs/replace/x"]; }],
    ["dirty", (seams) => { seams.git.modified = ["server/src/services/job-leasing.ts"]; }],
    ["untracked", (seams) => { seams.git.untracked = ["secret.txt"]; }],
    ["ignored", (seams) => { seams.git.unexpectedIgnored = ["swapped-schema.json"]; }],
    ["source_drift", (seams) => { seams.git.blobs["server/src/services/job-leasing.ts"] = "0".repeat(40); }],
    ["dependency_drift", (seams) => { seams.dependencies.packageStoreIntegritySha256 = "0".repeat(64); }],
    ["forged_attestation", (seams) => { seams.provenance.approved = false; }],
  ]) {
    const seams = structuredClone(base);
    mutation[1](seams);
    await assert.rejects(mod.runE3Perf01ForTest({ manifest: manifestFixture(), outputDirectory: "unused" }, seams));
    assert.equal(seams.child.invocations, 0, mutation[0]);
  }
});

test("closed child evidence, redaction, archive scan, and post-run checks gate a digest-addressed success", { skip: !assetsPresent }, async () => {
  const mod = await runner();
  const canaries = ["ENV_CANARY", "DB_USER_CANARY", "DB_PASSWORD_CANARY", "ARGV_CANARY", "STDOUT_CANARY", "STDERR_CANARY"];
  for (const childOutput of ["not-json", JSON.stringify({ ...evidenceFixture(), unknown: true })]) {
    const seams = mod.createContractTestSeams({ childOutput, canaries });
    await assert.rejects(mod.runE3Perf01ForTest({ manifest: manifestFixture(), outputDirectory: "unused", canaries }, seams));
  }

  const seams = mod.createContractTestSeams({ childOutput: JSON.stringify(evidenceFixture()), canaries });
  const result = await mod.runE3Perf01ForTest({ manifest: manifestFixture(), outputDirectory: "unused", canaries }, seams);
  assert.equal(seams.child.invocations, 1);
  assert.deepEqual(seams.child.command, [
    "pnpm", "exec", "vitest", "run",
    "server/src/__tests__/job-leasing-load.integration.test.ts", "--maxWorkers=1",
  ]);
  assert.equal(result.archiveUri, `${manifestFixture().output.namespace}/sha256/${result.archiveSha256}`);
  assert.match(result.archiveSha256, /^[0-9a-f]{64}$/);
  const serialized = JSON.stringify({ result, console: seams.console.lines, files: seams.files, archive: seams.archive.bytes });
  for (const canary of canaries) assert.equal(serialized.includes(canary), false);
  assert.equal(seams.git.postRunVerified, true);
  assert.deepEqual(seams.archive.manifest.sort(), seams.files.map((file) => file.path).sort());
});

test("runner contract source and both schemas contain no secret-bearing open escape hatch", { skip: !assetsPresent }, () => {
  const manifestSchema = JSON.parse(readFileSync(REQUIRED_ASSETS[1], "utf8"));
  const evidenceSchema = JSON.parse(readFileSync(REQUIRED_ASSETS[2], "utf8"));
  const assertClosed = (schema) => {
    if (schema && typeof schema === "object") {
      if (schema.type === "object") assert.equal(schema.additionalProperties, false);
      for (const value of Object.values(schema)) assertClosed(value);
    }
  };
  assertClosed(manifestSchema);
  assertClosed(evidenceSchema);
  const evidenceText = JSON.stringify(evidenceSchema);
  for (const forbidden of ["environmentVariables", "databaseUrl", "username", "password", "token", "authorization", "rawStdout", "rawStderr", "argv", "hostname", "homePath", "tempPath"]) {
    assert.equal(evidenceText.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});
