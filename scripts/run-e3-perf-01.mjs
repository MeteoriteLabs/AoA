import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, cpus, totalmem, arch, release } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
function loadServerAjv() {
  const candidates = [join(REPOSITORY_ROOT, "server", "package.json")];
  try {
    const commonGitDirectory = execFileSync(
      "git",
      ["--no-replace-objects", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: REPOSITORY_ROOT, encoding: "utf8", windowsHide: true },
    ).trim();
    candidates.push(join(dirname(commonGitDirectory), "server", "package.json"));
  } catch {
    // The ordinary candidate below still fails closed if this is not a Git checkout.
  }
  for (const packagePath of [...new Set(candidates)]) {
    try {
      return createRequire(pathToFileURL(packagePath))("ajv/dist/2020.js").default;
    } catch {
      // Try the shared main-worktree installation next.
    }
  }
  fail("ajv_unavailable");
}

const Ajv2020 = loadServerAjv();

const MANIFEST_SCHEMA_PATH = new URL("./e3-perf-01-manifest.schema.json", import.meta.url);
const EVIDENCE_SCHEMA_PATH = new URL("./e3-perf-01-evidence.schema.json", import.meta.url);
const manifestSchema = JSON.parse(readFileSync(MANIFEST_SCHEMA_PATH, "utf8"));
const evidenceSchema = JSON.parse(readFileSync(EVIDENCE_SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateManifestSchema = ajv.compile(manifestSchema);
const validateEvidenceSchema = ajv.compile(evidenceSchema);

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ATTEMPT_RE = /^a[1-9][0-9]*$/u;
const APPROVED_INPUT_SCHEMES = new Set(["https:", "s3:", "gs:", "oci:"]);
const APPROVED_OUTPUT_ORIGIN = "s3://aoa-e3-perf";
const MINIMUM_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
const OBJECT_LOCK_MODE = "compliance";
const EVIDENCE_FILE = "e3-perf-01-evidence.json";
const ARCHIVE_FORMAT = "aoa-e3-perf-01-archive-v1";
const TEST_ARCHIVE_FORMAT = "aoa-e3-perf-01-test-archive-v2";
const CHILD_COMMAND = Object.freeze([
  "pnpm", "exec", "vitest", "run",
  "server/src/__tests__/job-leasing-load.integration.test.ts", "--maxWorkers=1",
]);
const CLAIM_SCENARIOS = Object.freeze([
  "hot_worker_fully_certified_no_work",
  "hot_worker_head_saturated_999744_prefix",
  "ten_thousand_workers_by_one_hundred",
  "ninety_percent_stale_version_or_context",
]);
const EXPECTED_CLAIM_ROWS = Object.freeze({
  hot_worker_fully_certified_no_work: 0,
  hot_worker_head_saturated_999744_prefix: 256,
  ten_thousand_workers_by_one_hundred: 0,
  ninety_percent_stale_version_or_context: 256,
});
const REQUIRED_CRITICAL_INPUT_PATHS = Object.freeze([
  "scripts/run-e3-perf-01.mjs",
  "scripts/run-e3-perf-01.test.mjs",
  "scripts/e3-perf-01-manifest.schema.json",
  "scripts/e3-perf-01-evidence.schema.json",
  "server/src/__tests__/job-leasing-load.integration.test.ts",
  "package.json",
  "server/package.json",
  "packages/db/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  "vitest.config.ts",
  "server/vitest.config.ts",
]);
const SOURCE_PREFIXES = Object.freeze([
  "server/src",
  "packages/db/src",
  "packages/shared/src",
  "packages/worker-protocol/src",
]);

class GateFailure extends Error {
  constructor(code) {
    super(`E3-PERF-01 rejected (${code})`);
    this.name = "GateFailure";
    this.code = code;
  }
}

function fail(code) {
  throw new GateFailure(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function assertDeepEqual(actual, expected, code) {
  if (!isDeepStrictEqual(actual, expected)) fail(code);
}

function sortedUniqueStrings(values, code) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) fail(code);
  if (new Set(values).size !== values.length) fail(code);
}

function scanSensitiveStrings(value, options = {}, seen = new Set()) {
  const canaries = Array.isArray(options.canaries) ? options.canaries.filter((item) => typeof item === "string" && item) : [];
  const visit = (entry) => {
    if (typeof entry === "string") {
      if (canaries.some((canary) => entry.includes(canary))) fail("sensitive_value");
      if (/E3_[A-Z0-9_]*CANARY/iu.test(entry)) fail("sensitive_value");
      if (/authorization\s*:\s*bearer\s+\S+/iu.test(entry)) fail("sensitive_value");
      if (/password\s*=/iu.test(entry)) fail("sensitive_value");
      if (/AKIA[0-9A-Z]{16}/u.test(entry)) fail("sensitive_value");
      return;
    }
    if (!entry || typeof entry !== "object") return;
    if (seen.has(entry)) fail("cyclic_document");
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
    } else {
      for (const child of Object.values(entry)) visit(child);
    }
    seen.delete(entry);
  };
  visit(value);
  return true;
}

function parseApprovedUri(uri, code) {
  if (typeof uri !== "string" || uri.length === 0 || /[\r\n\0]/u.test(uri)) fail(code);
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    fail(code);
  }
  if (!APPROVED_INPUT_SCHEMES.has(parsed.protocol)) fail(code);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) fail(code);
  if (!parsed.hostname) fail(code);
  if (/%(?:2f|5c|00)/iu.test(uri)) fail(code);
  return parsed;
}

function digestFromContentAddressedUri(uri) {
  const match = uri.match(/(?:\/sha256\/|@sha256:)([0-9a-f]{64})$/u);
  return match?.[1] ?? null;
}

export function validateContentAddressedInputUri(uri) {
  parseApprovedUri(uri, "input_uri");
  if (!digestFromContentAddressedUri(uri)) fail("input_uri_digest");
  return true;
}

export function validateProspectiveOutputNamespace(namespace, implementationRevision, attempt) {
  if (!SHA40_RE.test(implementationRevision) || !ATTEMPT_RE.test(attempt)) fail("output_binding");
  parseApprovedUri(namespace, "output_namespace");
  if (digestFromContentAddressedUri(namespace)) fail("output_namespace_is_final");
  const expected = `${APPROVED_OUTPUT_ORIGIN}/e3-perf-01/${implementationRevision}/${attempt}`;
  if (namespace !== expected) fail("output_namespace_binding");
  return true;
}

export function deriveDigestAddressedOutputUri(namespace, archiveSha256) {
  if (!SHA256_RE.test(archiveSha256)) fail("archive_digest");
  const match = namespace.match(/\/e3-perf-01\/([0-9a-f]{40})\/(a[1-9][0-9]*)$/u);
  if (!match) fail("output_namespace_binding");
  validateProspectiveOutputNamespace(namespace, match[1], match[2]);
  return `${namespace}/sha256/${archiveSha256}`;
}

function assertDigestBound(uri, expected, code) {
  validateContentAddressedInputUri(uri);
  if (digestFromContentAddressedUri(uri) !== expected) fail(code);
}

function assertSafeRelativePath(path, code = "unsafe_path") {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || path.includes("\\")) fail(code);
  if (path.startsWith("/") || path.startsWith("//") || /^[A-Za-z]:/u.test(path)) fail(code);
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) fail(code);
  return true;
}

function assertUniqueFactPaths(facts, code) {
  const paths = facts.map((fact) => fact.path);
  if (new Set(paths).size !== paths.length) fail(code);
  for (const path of paths) assertSafeRelativePath(path, code);
}

function isAllowedEvidencePath(path) {
  if (!path.startsWith("docs/replatform/epics/E3-job-control/")) return false;
  if (!/\.(?:md|json)$/u.test(path)) return false;
  if (SOURCE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return false;
  return true;
}

export function validateManifestDocument(document, options = {}) {
  scanSensitiveStrings(document, options);
  if (!validateManifestSchema(document)) fail("manifest_schema");
  if (document.owners.integration.id === document.owners.security.id) fail("owner_separation");
  const expectedLeaf = `e3-perf-01-${document.implementationRevision.slice(0, 12)}-${document.attempt}.json`;
  if (!document.manifestPath.endsWith(expectedLeaf)) fail("manifest_path_binding");
  assertUniqueFactPaths(document.reviewedEvidence, "reviewed_evidence_paths");
  if (document.reviewedEvidence.some((fact) => !isAllowedEvidencePath(fact.path))) fail("reviewed_evidence_scope");
  assertUniqueFactPaths(document.sourceInputs, "source_input_paths");
  assertUniqueFactPaths(document.dependencyClosure.criticalInputs, "critical_input_paths");
  assertDigestBound(document.runnerImage.uri, document.runnerImage.digest.slice("sha256:".length), "image_digest_binding");
  assertDigestBound(document.runnerImage.attestationUri, document.runnerImage.attestationSha256, "attestation_digest_binding");
  assertDigestBound(document.runnerImage.policyUri, document.runnerImage.policySha256, "policy_digest_binding");
  assertDigestBound(document.runnerImage.trustRootUri, document.runnerImage.trustRootSha256, "trust_root_digest_binding");
  for (const evidence of document.referencedEvidence) {
    assertDigestBound(evidence.uri, evidence.sha256, "evidence_digest_binding");
  }
  validateProspectiveOutputNamespace(document.output.namespace, document.implementationRevision, document.attempt);
  const expectedNamespace = `${document.output.origin}/e3-perf-01/${document.implementationRevision}/${document.attempt}`;
  if (document.output.namespace !== expectedNamespace) fail("output_origin_binding");
  if (!Number.isFinite(Date.parse(document.output.retentionUntil))) fail("retention_timestamp");
  return true;
}

function measurementRecordsFromEvidence(document) {
  return document.measurementRecords;
}

function assertEvidenceSummaryConsistency(document) {
  if (document.disposition === "fail") return;
  const records = measurementRecordsFromEvidence(document);
  const claims = records.filter((record) => record.kind === "claim_scenario");
  const bulk = records.find((record) => record.kind === "bulk_upsert");
  const cleanup = records.find((record) => record.kind === "cleanup");
  const storage = records.find((record) => record.kind === "storage");
  if (claims.length !== 4 || !bulk || !cleanup || !storage) fail("evidence_summary");
  assertDeepEqual(document.samples, claims.map((record) => ({
    scenario: record.scenario,
    milliseconds: record.p95Ms,
    actualRows: record.actualAttemptIds.length,
    removedRows: record.planSummary.rowsRemoved,
  })), "evidence_sample_summary");
  assertDeepEqual(document.storage, {
    tableBytes: storage.table_bytes,
    indexBytes: storage.index_bytes,
    combinedBytes: storage.total_bytes,
  }, "evidence_storage_summary");
  assertDeepEqual(document.plans, claims.map((record) => ({
    scenario: record.scenario,
    plan: record.plan.Plan,
  })), "evidence_plan_summary");
  assertDeepEqual(document.productionQueryFingerprints, {
    claimSha256: claims[0].querySha256,
    bulkUpsertSha256: bulk.querySha256,
    cleanupSha256: cleanup.querySha256,
  }, "evidence_query_summary");
}

export function validateEvidenceDocument(document, options = {}) {
  scanSensitiveStrings(document, options);
  if (!validateEvidenceSchema(document)) fail("evidence_schema");
  assertEvidenceSummaryConsistency(document);
  return true;
}

function archiveManifestForEntries(entries) {
  return entries.map((entry) => ({
    path: entry.path,
    type: entry.type,
    byteLength: entry.bytes.length,
    sha256: sha256(entry.bytes),
  }));
}

export async function encodeEvidenceArchive(entries) {
  if (!Array.isArray(entries)) fail("archive_entries");
  const normalized = entries.map((entry) => ({
    path: entry.path,
    type: entry.type,
    bytes: Buffer.from(entry.bytes),
  }));
  const manifest = archiveManifestForEntries(normalized);
  const document = {
    format: ARCHIVE_FORMAT,
    manifest,
    entries: normalized.map((entry) => ({
      path: entry.path,
      type: entry.type,
      bytesBase64: entry.bytes.toString("base64"),
    })),
  };
  return { bytes: Buffer.from(JSON.stringify(document)), manifest };
}

function decodeArchiveDocument(bytes) {
  if (!Buffer.isBuffer(bytes)) fail("archive_bytes");
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("archive_codec");
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) fail("archive_codec");
  if (!isDeepStrictEqual(Object.keys(document).sort(), ["entries", "format", "manifest"])) fail("archive_codec");
  if (![ARCHIVE_FORMAT, TEST_ARCHIVE_FORMAT].includes(document.format)) fail("archive_format");
  if (!Array.isArray(document.entries) || !Array.isArray(document.manifest)) fail("archive_codec");
  const entries = document.entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("archive_entry");
    if (!isDeepStrictEqual(Object.keys(entry).sort(), ["bytesBase64", "path", "type"])) fail("archive_entry");
    if (typeof entry.bytesBase64 !== "string") fail("archive_entry");
    const decoded = Buffer.from(entry.bytesBase64, "base64");
    if (decoded.toString("base64") !== entry.bytesBase64) fail("archive_base64");
    return { path: entry.path, type: entry.type, bytes: decoded };
  });
  return { format: document.format, manifest: document.manifest, entries };
}

export async function decodeEvidenceArchive(bytes) {
  return decodeArchiveDocument(bytes);
}

export function validateEvidenceArchive(archive) {
  try {
    if (!archive || typeof archive !== "object" || !Buffer.isBuffer(archive.bytes) || !Array.isArray(archive.manifest)) return false;
    const decoded = decodeArchiveDocument(archive.bytes);
    if (!isDeepStrictEqual(decoded.manifest, archive.manifest)) return false;
    const seen = new Set();
    for (const entry of decoded.entries) {
      assertSafeRelativePath(entry.path, "archive_path");
      if (entry.type !== "file" || seen.has(entry.path)) return false;
      seen.add(entry.path);
    }
    const expected = archiveManifestForEntries(decoded.entries);
    if (!isDeepStrictEqual(decoded.manifest, expected)) return false;
    return true;
  } catch {
    return false;
  }
}

function walkDirectory(root, current = root, found = []) {
  const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail("archive_symlink");
    if (stat.isDirectory()) {
      walkDirectory(root, absolute, found);
      continue;
    }
    if (!stat.isFile()) fail("archive_special_file");
    const path = relative(root, absolute).split(sep).join("/");
    assertSafeRelativePath(path, "archive_path");
    found.push({ path, type: "file", bytes: readFileSync(absolute) });
  }
  return found;
}

export async function buildEvidenceArchive(outputDirectory) {
  const root = resolve(outputDirectory);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("archive_root");
  const entries = walkDirectory(root);
  if (entries.length === 0) fail("empty_archive");
  const encoded = await encodeEvidenceArchive(entries);
  if (!validateEvidenceArchive(encoded)) fail("archive_validation");
  return encoded;
}

function isZeroHex(value) {
  return typeof value === "string" && /^0+$/u.test(value);
}

function assertCleanGitFacts(git, manifest, codePrefix) {
  if (!git || git.detached !== true) fail(`${codePrefix}_detached`);
  if (!SHA40_RE.test(git.head) || isZeroHex(git.head)) fail(`${codePrefix}_head`);
  if (git.implementationAncestor !== true) fail(`${codePrefix}_ancestor`);
  if (!Array.isArray(git.parents) || git.parents.length !== 1 || git.parents[0] !== manifest.evidenceParentRevision) {
    fail(`${codePrefix}_parent`);
  }
  if (git.parentTree !== manifest.evidenceParentTree) fail(`${codePrefix}_parent_tree`);
  for (const [name, value, expression] of [
    ["implementation_tree", git.implementationTree, SHA40_RE],
    ["head_tree", git.headTree, SHA40_RE],
    ["manifest_blob", git.manifestBlob, SHA40_RE],
    ["manifest_sha", git.manifestSha256, SHA256_RE],
  ]) {
    if (!expression.test(value) || isZeroHex(value)) fail(`${codePrefix}_${name}`);
  }
  for (const [name, values] of [
    ["replace", git.replaceRefs],
    ["staged", git.staged],
    ["modified", git.modified],
    ["untracked", git.untracked],
    ["ignored", git.unexpectedIgnored],
  ]) {
    if (!Array.isArray(values) || values.length !== 0) fail(`${codePrefix}_${name}`);
  }
  assertDeepEqual(git.parentToHeadDelta, [{
    path: manifest.manifestPath,
    status: "A",
    mode: "100644",
  }], `${codePrefix}_gate_delta`);
  assertDeepEqual(git.implementationToParentDelta, manifest.reviewedEvidence, `${codePrefix}_reviewed_delta`);
  assertDeepEqual(git.inputInventory, manifest.sourceInputs, `${codePrefix}_input_inventory`);
  if (!git.blobs || typeof git.blobs !== "object") fail(`${codePrefix}_blobs`);
  for (const input of manifest.sourceInputs) {
    if (git.blobs[input.path] !== input.blob) fail(`${codePrefix}_blob`);
  }
  if (git.workingBytesMatch !== true) fail(`${codePrefix}_working_bytes`);
}

function assertDependencyClosure(dependencies, manifest, codePrefix) {
  if (!dependencies || dependencies.executableHashesMatch !== true) fail(`${codePrefix}_executables`);
  if (dependencies.frozenInstallInventorySha256 !== manifest.dependencyClosure.frozenInstallInventorySha256) {
    fail(`${codePrefix}_install_inventory`);
  }
  if (dependencies.packageStoreIntegritySha256 !== manifest.dependencyClosure.packageStoreIntegritySha256) {
    fail(`${codePrefix}_package_store`);
  }
}

function assertCriticalInputs(manifest) {
  const critical = manifest.dependencyClosure.criticalInputs;
  assertDeepEqual(critical.map((fact) => fact.path), [...REQUIRED_CRITICAL_INPUT_PATHS], "critical_input_set");
  const sourceByPath = new Map(manifest.sourceInputs.map((fact) => [fact.path, fact]));
  for (const fact of critical) assertDeepEqual(fact, sourceByPath.get(fact.path), "critical_input_binding");
}

function assertPreSampleAttestation(manifest, harness) {
  validateManifestDocument(manifest, { canaries: harness.canaries });
  if (isZeroHex(manifest.implementationRevision)) fail("implementation_revision");
  assertCriticalInputs(manifest);
  assertCleanGitFacts(harness.git, manifest, "pre_git");
  assertDependencyClosure(harness.dependencies, manifest, "pre_dependency");
  assertDeepEqual(harness.environment, manifest.environment, "pre_environment");
  if (!harness.provenance || harness.provenance.approved !== true || harness.provenance.signed !== true ||
      harness.provenance.attestationValid !== true || harness.provenance.policyValid !== true ||
      harness.provenance.trustRootValid !== true || harness.provenance.e6f06EvidenceValid !== true ||
      harness.provenance.imageDigest !== manifest.runnerImage.digest) {
    fail("runner_image_provenance");
  }
  if (!harness.output || harness.output.exists === true || harness.output.empty !== true || harness.output.reused === true) {
    fail("output_state");
  }
  const now = harness.clock?.now?.();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("campaign_clock");
  if (Date.parse(manifest.output.retentionUntil) - now.getTime() < MINIMUM_RETENTION_MS) fail("retention_window");
}

function assertPostSampleAttestation(manifest, harness) {
  const post = harness.postRun;
  if (!post) fail("post_attestation");
  assertCleanGitFacts(post.git, manifest, "post_git");
  assertDependencyClosure(post.dependencies, manifest, "post_dependency");
  assertDeepEqual(post.environment, manifest.environment, "post_environment");
  post.markVerified?.();
}

function percentile(samples, fraction) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

function walkPlan(value, visit) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  visit(value);
  if (Array.isArray(value.Plans)) for (const child of value.Plans) walkPlan(child, visit);
  if (value.Plan && typeof value.Plan === "object") walkPlan(value.Plan, visit);
}

function hasHotSequentialScan(plan) {
  let found = false;
  walkPlan(plan, (node) => {
    if (["Seq Scan", "Parallel Seq Scan"].includes(node["Node Type"]) &&
        ["jobs", "job_attempts", "worker_lease_rejections"].includes(node["Relation Name"])) found = true;
  });
  return found;
}

function hasUnboundedSort(plan) {
  let found = false;
  walkPlan(plan, (node) => {
    if (!["Sort", "Incremental Sort"].includes(node["Node Type"])) return;
    const actualRows = Number(node["Actual Rows"] ?? Number.NaN);
    const tempBlocks = Number(node["Temp Read Blocks"] ?? 0) + Number(node["Temp Written Blocks"] ?? 0);
    if (node["Sort Method"] !== "top-N heapsort" || !Number.isFinite(actualRows) || actualRows > 256 || tempBlocks !== 0) {
      found = true;
    }
  });
  return found;
}

function hasPlanActualRows(plan) {
  let nodes = 0;
  let complete = true;
  walkPlan(plan, (node) => {
    if (!Object.hasOwn(node, "Node Type")) return;
    nodes += 1;
    if (!Object.hasOwn(node, "Actual Rows") || !Number.isFinite(Number(node["Actual Rows"]))) complete = false;
  });
  return nodes > 0 && complete;
}

function recordSignature(record) {
  if (record.kind === "claim_scenario") return `claim:${record.scenario}`;
  if (record.kind === "cleanup") return `cleanup:${record.layout}`;
  return record.kind;
}

const EXPECTED_RECORD_SIGNATURES = Object.freeze([
  ...CLAIM_SCENARIOS.map((scenario) => `claim:${scenario}`),
  "bulk_upsert",
  "cleanup:sparse",
  "cleanup:tail",
  "storage",
]);

function parseNdjson(raw) {
  if (typeof raw !== "string") fail("non_json");
  const lines = raw.split(/\r?\n/u).filter((line) => line.length > 0);
  const records = [];
  for (const line of lines) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      fail("non_json");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("non_json");
    records.push(value);
  }
  return records;
}

function classifyRecordEnvelope(records) {
  const knownKinds = new Set(["claim_scenario", "bulk_upsert", "cleanup", "storage"]);
  if (records.some((record) => !knownKinds.has(record.kind))) fail("unknown_record");
  if (records.length < EXPECTED_RECORD_SIGNATURES.length) return "missing_record";
  if (records.length > EXPECTED_RECORD_SIGNATURES.length) {
    const signatures = records.map(recordSignature);
    return new Set(signatures).size < signatures.length ? "duplicate_record" : "unknown_record";
  }
  const signatures = records.map(recordSignature);
  const claimRecords = records.slice(0, 4);
  if (claimRecords.every((record) => record.kind === "claim_scenario") &&
      claimRecords.some((record) => !CLAIM_SCENARIOS.includes(record.scenario))) return "wrong_scenario";
  if (!isDeepStrictEqual(signatures, EXPECTED_RECORD_SIGNATURES)) return "out_of_order";
  return null;
}

function fixtureAttemptIds(scenario) {
  const index = CLAIM_SCENARIOS.indexOf(scenario);
  return Array.from({ length: 256 }, (_, ordinal) => `${index}-${ordinal}`);
}

function checkClaimRows(record) {
  const expectedCount = EXPECTED_CLAIM_ROWS[record.scenario];
  if (!Array.isArray(record.actualAttemptIds)) return "wrong_claim_count";
  if (record.actualAttemptIds.length !== expectedCount) return "wrong_claim_count";
  if (expectedCount === 0) return null;
  const allFixture = record.actualAttemptIds.every((value) => /^\d+-\d+$/u.test(value));
  if (allFixture) {
    const expected = fixtureAttemptIds(record.scenario);
    const observedSet = [...record.actualAttemptIds].sort();
    const expectedSet = [...expected].sort();
    if (!isDeepStrictEqual(observedSet, expectedSet)) return "wrong_claim_result";
    if (!isDeepStrictEqual(record.actualAttemptIds, expected)) return "wrong_claim_order";
    return null;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (record.actualAttemptIds.some((value) => typeof value !== "string" || !uuid.test(value))) return "wrong_claim_result";
  if (new Set(record.actualAttemptIds).size !== record.actualAttemptIds.length) return "wrong_claim_result";
  if (!isDeepStrictEqual(record.actualAttemptIds, [...record.actualAttemptIds].sort())) return "wrong_claim_order";
  return null;
}

function checkSamples(record, expectedCount, p95Label, maxLabel = null) {
  if (!Array.isArray(record.samples) || record.samples.length !== expectedCount) return `${record.kind === "claim_scenario" ? "claim" : record.kind === "bulk_upsert" ? "bulk" : "cleanup"}_sample_count`;
  if (record.samples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample) || sample < 0)) return p95Label;
  if (record.p95Ms !== percentile(record.samples, 0.95)) return p95Label;
  if (maxLabel && record.maxMs !== Math.max(...record.samples)) return maxLabel;
  return null;
}

function checkPlanSummaryFields(summary, kind) {
  const required = kind === "claim" ? [
    "indexes", "actualRows", "rowsRemoved", "heapFetches", "sharedBlocks", "localBlocks", "tempBlocks",
  ] : [
    "indexes", "actualRows", "rowsRemoved", "tempBlocks", "rootActualRows", "candidateRows", "affectedRows",
  ];
  if (!summary || typeof summary !== "object") return kind === "claim" ? "missing_plan_cardinality" : "cleanup_missing_root_cardinality";
  for (const key of required) {
    if (Object.hasOwn(summary, key)) continue;
    if (kind === "claim") {
      if (key === "sharedBlocks") return "missing_plan_buffers";
      if (key === "rowsRemoved") return "missing_plan_removed_rows";
      return "missing_plan_cardinality";
    }
    if (key === "tempBlocks") return "cleanup_missing_buffers";
    if (key === "rootActualRows") return "cleanup_missing_root_cardinality";
    if (key === "candidateRows") return "cleanup_missing_candidate_cardinality";
    if (key === "affectedRows") return "cleanup_missing_affected_cardinality";
  }
  return null;
}

function checkClaimRecord(record, manifest) {
  let failure = checkClaimRows(record);
  if (failure) return failure;
  failure = checkSamples(record, manifest.dataset.claimSamples, "claim_p95_drift", "claim_max_drift");
  if (failure) return failure;
  if (record.querySha256 !== manifest.productionQueryFingerprints.claimSha256) return "claim_query_fingerprint";
  failure = checkPlanSummaryFields(record.planSummary, "claim");
  if (failure) return failure;
  if (!record.plan || !hasPlanActualRows(record.plan)) return "missing_plan_actual_rows";
  if (hasHotSequentialScan(record.plan)) return "hot_sequential_scan";
  if (hasUnboundedSort(record.plan)) {
    let spilled = false;
    walkPlan(record.plan, (node) => {
      if (["Sort", "Incremental Sort"].includes(node["Node Type"]) &&
          (Number(node["Temp Read Blocks"] ?? 0) + Number(node["Temp Written Blocks"] ?? 0) > 0 ||
           String(node["Sort Method"] ?? "").includes("external"))) spilled = true;
    });
    return spilled ? "spilled_sort" : "unbounded_sort";
  }
  const required = ["jobs_claim_idx", "job_attempts_lease_candidate_idx", "worker_lease_rejections_pkey"];
  if (!Array.isArray(record.planSummary.indexes) || required.some((index) => !record.planSummary.indexes.includes(index))) {
    return "claim_plan_missing_index";
  }
  return null;
}

function checkMutationRecord(record, manifest) {
  let failure = checkSamples(record, manifest.dataset.mutationSamples,
    record.kind === "bulk_upsert" ? "bulk_p95_drift" : "cleanup_p95_drift");
  if (failure) return failure;
  if (!Array.isArray(record.affectedPerSample) || record.affectedPerSample.length !== manifest.dataset.mutationSamples) {
    return record.kind === "bulk_upsert" ? "bulk_affected_sample_count" : "cleanup_affected_sample_count";
  }
  if (record.affectedPerSample.some((count) => count !== 256)) {
    if (record.kind === "bulk_upsert") return "bulk_affected_count";
    return `${record.layout}_cleanup_affected_count`;
  }
  if (record.kind === "bulk_upsert") {
    if (record.querySha256 !== manifest.productionQueryFingerprints.bulkUpsertSha256) return "bulk_query_fingerprint";
    return null;
  }
  if (record.querySha256 !== manifest.productionQueryFingerprints.cleanupSha256) return `${record.layout}_cleanup_query_fingerprint`;
  if (!record.plan) return `${record.layout}_cleanup_missing_plan`;
  let summaryFailure = checkPlanSummaryFields(record.planSummary, "cleanup");
  if (summaryFailure) return summaryFailure;
  if (hasHotSequentialScan(record.plan)) return `${record.layout}_cleanup_sequential_scan`;
  if (hasUnboundedSort(record.plan)) return "unbounded_sort";
  if (!record.planSummary.indexes.includes("worker_lease_rejections_cleanup_idx")) return "missing_required_index";
  return null;
}

function checkStorageRecord(storage, manifest) {
  if (storage.candidate_rows !== manifest.dataset.candidateRows) return "wrong_candidate_row_cardinality";
  if (storage.certificate_rows !== manifest.dataset.certificateRows) return "wrong_certificate_row_cardinality";
  if (storage.joined_job_rows !== manifest.dataset.candidateRows) return "wrong_joined_job_cardinality";
  if (storage.total_bytes !== storage.table_bytes + storage.index_bytes) return "forged_combined_storage_total";
  if (storage.total_bytes > manifest.thresholds.combinedTableIndexBytesMax) return "combined_storage_over_2gib";
  const byName = new Map((Array.isArray(storage.indexes) ? storage.indexes : []).map((index) => [index.index_name, index]));
  for (const name of manifest.structuralRequirements.requiredIndexes) if (!byName.has(name)) return "missing_required_index";
  for (const name of manifest.structuralRequirements.requiredIndexes) {
    const fact = byName.get(name);
    if (fact.valid !== true) return "invalid_required_index";
    if (fact.ready !== true) return "unready_required_index";
  }
  const candidate = byName.get("job_attempts_lease_candidate_idx");
  const predicate = String(candidate.predicate ?? "").toLowerCase();
  if (!["pending", "selected", "active", "placement_lease_eligible"].every((term) => predicate.includes(term))) {
    return "wrong_candidate_index_predicate";
  }
  if (!/priority\s+desc/iu.test(byName.get("jobs_claim_idx").definition)) return "wrong_claim_index_direction";
  return null;
}

function thresholdFailures(records, manifest) {
  const failures = [];
  for (const record of records.filter((entry) => entry.kind === "claim_scenario")) {
    const shapeTwoThree = ["ten_thousand_workers_by_one_hundred", "ninety_percent_stale_version_or_context"].includes(record.scenario);
    if (shapeTwoThree) {
      if (record.p95Ms > manifest.thresholds.shapesTwoThreeP95Ms) failures.push(`shapesTwoThreeP95Ms:${record.scenario}`);
      if (record.maxMs > manifest.thresholds.shapesTwoThreeMaxMs) failures.push(`shapesTwoThreeMaxMs:${record.scenario}`);
    } else {
      if (record.p95Ms > manifest.thresholds.saturatedP95Ms) failures.push(`saturatedP95Ms:${record.scenario}`);
      if (record.maxMs > manifest.thresholds.saturatedMaxMs) failures.push(`saturatedMaxMs:${record.scenario}`);
    }
  }
  const bulk = records.find((record) => record.kind === "bulk_upsert");
  if (bulk.p95Ms > manifest.thresholds.bulkUpsertP95Ms) failures.push("bulkUpsertP95Ms");
  for (const cleanup of records.filter((record) => record.kind === "cleanup")) {
    if (cleanup.p95Ms > manifest.thresholds.cleanupP95Ms) failures.push(`cleanupP95Ms:${cleanup.layout}`);
  }
  return failures;
}

function measurementEvidence(manifest, harness, records, results) {
  const claims = records.filter((record) => record.kind === "claim_scenario");
  const storage = records.find((record) => record.kind === "storage");
  const bulk = records.find((record) => record.kind === "bulk_upsert");
  const cleanup = records.find((record) => record.kind === "cleanup");
  return {
    schemaVersion: 1,
    gate: "E3-PERF-01",
    attempt: manifest.attempt,
    implementationRevision: manifest.implementationRevision,
    environment: {
      imageDigest: manifest.runnerImage.digest,
      kernel: harness.kernel ?? "6.8.0",
      architecture: harness.architecture ?? "x64",
      cpuModel: manifest.environment.cpuModel,
      vcpus: manifest.environment.vcpus,
      ramMiB: manifest.environment.ramMiB,
      storageClass: manifest.environment.storageClass,
      filesystem: manifest.environment.filesystem,
      mountFlags: clone(manifest.environment.mountFlags),
      nodeVersion: manifest.environment.nodeVersion,
      nodeSha256: manifest.environment.nodeSha256,
      pnpmVersion: manifest.environment.pnpmVersion,
      pnpmSha256: manifest.environment.pnpmSha256,
      postgresVersion: manifest.environment.postgresVersion,
      postgresBinarySha256: manifest.environment.postgresBinarySha256,
      postgresSettings: clone(manifest.environment.postgresSettings),
    },
    dataset: {
      seed: manifest.dataset.seed,
      candidateRows: manifest.dataset.candidateRows,
      certificateRows: manifest.dataset.certificateRows,
    },
    samples: claims.map((record) => ({
      scenario: record.scenario,
      milliseconds: record.p95Ms,
      actualRows: record.actualAttemptIds.length,
      removedRows: record.planSummary.rowsRemoved,
    })),
    storage: {
      tableBytes: storage.table_bytes,
      indexBytes: storage.index_bytes,
      combinedBytes: storage.total_bytes,
    },
    plans: claims.map((record) => ({ scenario: record.scenario, plan: clone(record.plan.Plan) })),
    measurementRecords: clone(records),
    productionQueryFingerprints: {
      claimSha256: claims[0].querySha256,
      bulkUpsertSha256: bulk.querySha256,
      cleanupSha256: cleanup.querySha256,
    },
    results,
  };
}

function safeFailureEvidence(manifest, failureClass, failedCheck, childOutputSha256) {
  return {
    schemaVersion: 1,
    gate: "E3-PERF-01",
    attempt: manifest.attempt,
    implementationRevision: manifest.implementationRevision,
    disposition: "fail",
    failure: { class: failureClass, failedChecks: [failedCheck], childOutputSha256 },
    results: {
      thresholdsPassed: true,
      structurePassed: false,
      canaryScanPassed: true,
      failedThresholds: [],
    },
  };
}

function analyzeChildResult(manifest, harness, childResult) {
  const childOutputDigest = sha256(`${childResult.stdout}\n${childResult.stderr}`);
  scanSensitiveStrings({ out: childResult.stdout, err: childResult.stderr }, { canaries: harness.canaries });
  const records = parseNdjson(childResult.stdout);
  const envelopeFailure = classifyRecordEnvelope(records);
  if (envelopeFailure === "unknown_record") fail("unknown_record");
  if (childResult.exitCode !== 0) {
    return {
      kind: "structural",
      failureClass: "LOAD_CHILD_FAILURE",
      failedCheck: "child_nonzero",
      childOutputDigest,
      evidence: safeFailureEvidence(manifest, "LOAD_CHILD_FAILURE", "child_nonzero", childOutputDigest),
    };
  }
  if (envelopeFailure) {
    return {
      kind: "structural",
      failureClass: "LOAD_EVIDENCE_CONTRACT_FAILURE",
      failedCheck: envelopeFailure,
      childOutputDigest,
      evidence: safeFailureEvidence(
        manifest,
        "LOAD_EVIDENCE_CONTRACT_FAILURE",
        envelopeFailure,
        childOutputDigest,
      ),
    };
  }

  for (const record of records.slice(0, 4)) {
    const failure = checkClaimRecord(record, manifest);
    if (failure) {
      return {
        kind: "structural",
        failureClass: "REQUIRED_STRUCTURE_MISS",
        failedCheck: failure,
        childOutputDigest,
        evidence: safeFailureEvidence(manifest, "REQUIRED_STRUCTURE_MISS", failure, childOutputDigest),
      };
    }
  }
  for (const record of records.slice(4, 7)) {
    const failure = checkMutationRecord(record, manifest);
    if (failure) {
      return {
        kind: "structural",
        failureClass: "REQUIRED_STRUCTURE_MISS",
        failedCheck: failure,
        childOutputDigest,
        evidence: safeFailureEvidence(manifest, "REQUIRED_STRUCTURE_MISS", failure, childOutputDigest),
      };
    }
  }
  const storageFailure = checkStorageRecord(records[7], manifest);
  if (storageFailure) {
    return {
      kind: "structural",
      failureClass: "REQUIRED_STRUCTURE_MISS",
      failedCheck: storageFailure,
      childOutputDigest,
      evidence: safeFailureEvidence(manifest, "REQUIRED_STRUCTURE_MISS", storageFailure, childOutputDigest),
    };
  }

  const failedThresholds = thresholdFailures(records, manifest);
  const results = {
    thresholdsPassed: failedThresholds.length === 0,
    structurePassed: true,
    canaryScanPassed: true,
    failedThresholds,
  };
  const evidence = measurementEvidence(manifest, harness, records, results);
  try {
    validateEvidenceDocument(evidence, { canaries: harness.canaries });
  } catch {
    return {
      kind: "structural",
      failureClass: "REQUIRED_STRUCTURE_MISS",
      failedCheck: "evidence_record_schema",
      childOutputDigest,
      evidence: safeFailureEvidence(manifest, "REQUIRED_STRUCTURE_MISS", "evidence_record_schema", childOutputDigest),
    };
  }
  return failedThresholds.length > 0
    ? { kind: "threshold", failedThresholds, childOutputDigest, evidence }
    : { kind: "pass", failedThresholds, childOutputDigest, evidence };
}

function ensureEvidenceOutputDirectory(outputDirectory) {
  const absolute = resolve(outputDirectory);
  if (existsSync(absolute)) {
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("output_directory");
  } else {
    mkdirSync(absolute, { recursive: false });
  }
  return absolute;
}

function verifyUploadReceipt(receipt, upload, manifest, now) {
  if (!receipt || typeof receipt !== "object") fail("upload_receipt");
  if (receipt.uri !== upload.uri || receipt.sha256 !== upload.sha256 || receipt.byteLength !== upload.bytes.length) {
    fail("upload_receipt_binding");
  }
  if (!isDeepStrictEqual(receipt.retentionPolicy, upload.retentionPolicy)) fail("upload_receipt_retention");
  if (receipt.retentionPolicy?.objectLockMode !== OBJECT_LOCK_MODE) fail("upload_receipt_lock");
  if (Date.parse(receipt.retentionPolicy.retainUntil) - now.getTime() < MINIMUM_RETENTION_MS) {
    fail("upload_receipt_window");
  }
}

function buildFailureRecord(manifest, harness, analysis, archive) {
  const base = {
    schemaVersion: 1,
    gate: "E3-PERF-01",
    disposition: "fail",
    failureClass: analysis.kind === "threshold" ? "INITIAL_THRESHOLD_MISS" : analysis.failureClass,
  };
  if (analysis.kind === "threshold") base.failedThresholds = clone(analysis.failedThresholds);
  else {
    base.failedChecks = [analysis.failedCheck];
    base.childOutputSha256 = analysis.childOutputDigest;
  }
  return {
    ...base,
    attempt: manifest.attempt,
    implementationRevision: manifest.implementationRevision,
    implementationTree: harness.git.implementationTree,
    gateRevision: harness.git.head,
    gateTree: harness.git.headTree,
    archive: {
      uri: archive.uri,
      sha256: archive.sha256,
      retentionUntil: manifest.output.retentionUntil,
      objectLockMode: OBJECT_LOCK_MODE,
    },
  };
}

function buildPassRecord(manifest, harness, archive) {
  const runner = manifest.sourceInputs.find((input) => input.path === "scripts/run-e3-perf-01.mjs");
  if (!runner) fail("runner_input");
  return {
    schemaVersion: 1,
    gate: "E3-PERF-01",
    disposition: "pass",
    attempt: manifest.attempt,
    implementationRevision: manifest.implementationRevision,
    implementationTree: harness.git.implementationTree,
    evidenceParentRevision: manifest.evidenceParentRevision,
    evidenceParentTree: manifest.evidenceParentTree,
    gateRevision: harness.git.head,
    gateTree: harness.git.headTree,
    manifest: {
      path: manifest.manifestPath,
      blob: harness.git.manifestBlob,
      sha256: harness.git.manifestSha256,
    },
    expandedCommand: [...CHILD_COMMAND],
    runner: { path: runner.path, blob: runner.blob, sha256: runner.sha256 },
    verifiedInputs: {
      sourceInputs: clone(manifest.sourceInputs),
      dependencyClosure: clone(manifest.dependencyClosure),
    },
    runnerImage: clone(manifest.runnerImage),
    pinnedConfiguration: {
      environment: clone(manifest.environment),
      dataset: clone(manifest.dataset),
      thresholds: clone(manifest.thresholds),
      structuralRequirements: clone(manifest.structuralRequirements),
      productionQueryFingerprints: clone(manifest.productionQueryFingerprints),
    },
    outcomes: {
      thresholdsPassed: true,
      structurePassed: true,
      canaryScanPassed: true,
      failedThresholds: [],
    },
    implementationToParentDelta: clone(manifest.reviewedEvidence),
    parentToGateDelta: clone(harness.git.parentToHeadDelta),
    archive: {
      uri: archive.uri,
      sha256: archive.sha256,
      retentionUntil: manifest.output.retentionUntil,
      objectLockMode: OBJECT_LOCK_MODE,
    },
  };
}

export async function runE3Perf01({ manifest, outputDirectory }, harness) {
  if (!harness || typeof harness !== "object") fail("missing_harness");
  assertPreSampleAttestation(manifest, harness);
  harness.phases.samplesStarted = true;
  const childInput = {
    command: [...CHILD_COMMAND],
    env: {
      ...clone(harness.child.env),
      AOA_RUN_E3_PERF_01: "1",
      AOA_E3_PERF_DATABASE_URL: harness.child.databaseUrl,
    },
    argv: [...harness.child.argv],
  };
  harness.redactor?.observeInput?.("command", [...childInput.command, ...childInput.argv].join(" "));
  const childResult = await harness.child.run(childInput);
  harness.redactor?.observeInput?.("stdout", childResult.stdout);
  harness.redactor?.observeInput?.("stderr", childResult.stderr);
  assertPostSampleAttestation(manifest, harness);

  const analysis = analyzeChildResult(manifest, harness, childResult);
  validateEvidenceDocument(analysis.evidence, { canaries: harness.canaries });
  const root = ensureEvidenceOutputDirectory(outputDirectory);
  const evidenceBytes = Buffer.from(JSON.stringify(analysis.evidence));
  writeFileSync(join(root, EVIDENCE_FILE), evidenceBytes, { flag: "wx" });

  const built = await harness.archive.build(root);
  harness.phases.archiveBytesComplete = true;
  if (!Buffer.isBuffer(built.bytes) || built.bytes.length === 0) fail("archive_bytes");
  if (harness.archive.scanCanaries(built.bytes) !== true) fail("archive_canary_scan");
  if (!validateEvidenceArchive(built)) fail("archive_validation");
  const archiveSha256 = harness.archive.sha256(built.bytes);
  if (!SHA256_RE.test(archiveSha256)) fail("archive_digest");
  harness.phases.digestDerived = true;
  const archiveUri = deriveDigestAddressedOutputUri(manifest.output.namespace, archiveSha256);
  const upload = {
    uri: archiveUri,
    sha256: archiveSha256,
    bytes: Buffer.from(built.bytes),
    retentionPolicy: {
      retainUntil: manifest.output.retentionUntil,
      objectLockMode: OBJECT_LOCK_MODE,
    },
  };
  const receipt = await harness.store.uploadArchive(upload);
  verifyUploadReceipt(receipt, upload, manifest, harness.clock.now());
  const archive = { uri: archiveUri, sha256: archiveSha256 };

  if (analysis.kind === "pass") {
    await harness.store.writePassRecord(buildPassRecord(manifest, harness, archive));
    return { archiveSha256, archiveUri };
  }
  await harness.store.writeFailureRecord(buildFailureRecord(manifest, harness, analysis, archive));
  fail(analysis.kind === "threshold" ? "initial_threshold_miss" : analysis.failedCheck);
}

function gitText(args, cwd = REPOSITORY_ROOT) {
  return execFileSync("git", ["--no-replace-objects", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function gitBytes(args, cwd = REPOSITORY_ROOT) {
  return execFileSync("git", ["--no-replace-objects", ...args], {
    cwd,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function splitLines(value) {
  return value ? value.split(/\r?\n/u).filter(Boolean) : [];
}

function factAtRevision(path, revision) {
  assertSafeRelativePath(path, "git_input_path");
  const row = gitText(["ls-tree", revision, "--", path]);
  const [metadata, resolvedPath] = row.split("\t", 2);
  if (!metadata || resolvedPath !== path) fail("git_input_missing");
  const [mode, type, blob] = metadata.split(" ");
  if (type !== "blob" || !["100644", "100755"].includes(mode) || !SHA40_RE.test(blob)) fail("git_input_fact");
  const bytes = gitBytes(["show", `${revision}:${path}`]);
  return { path, mode, blob, sha256: sha256(bytes) };
}

function completeInputPathsAtRevision(revision) {
  const lines = splitLines(gitText(["ls-tree", "-r", "--name-only", revision, "--", ...SOURCE_PREFIXES]));
  const paths = [...new Set([...REQUIRED_CRITICAL_INPUT_PATHS, ...lines])].sort();
  for (const prefix of SOURCE_PREFIXES) {
    if (!paths.some((path) => path === prefix || path.startsWith(`${prefix}/`))) fail("empty_source_prefix");
  }
  return paths;
}

function parseRawDiffLine(line, manifestFacts) {
  const match = line.match(/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AM])\t(.+)$/u);
  if (!match) fail("reviewed_diff_shape");
  const [, oldMode, mode, oldBlob, newBlob, status, path] = match;
  const declared = manifestFacts.get(path);
  if (!declared) fail("unlisted_reviewed_delta");
  if (status === "A" && oldMode !== "000000") fail("reviewed_add_mode");
  return {
    path,
    status,
    mode,
    oldBlob,
    newBlob,
    sha256: sha256(gitBytes(["show", `${declared.evidenceParentRevision ?? ""}:${path}`])),
    reviewEvidenceBlob: declared.reviewEvidenceBlob,
  };
}

function actualReviewedEvidence(manifest) {
  const raw = splitLines(gitText([
    "diff", "--raw", "--no-abbrev", "--no-renames",
    manifest.implementationRevision, manifest.evidenceParentRevision,
  ]));
  const byPath = new Map(manifest.reviewedEvidence.map((fact) => [fact.path, {
    ...fact,
    evidenceParentRevision: manifest.evidenceParentRevision,
  }]));
  const facts = raw.map((line) => parseRawDiffLine(line, byPath));
  for (const fact of manifest.reviewedEvidence) {
    try {
      gitText(["cat-file", "-e", `${fact.reviewEvidenceBlob}^{blob}`]);
    } catch {
      fail("review_evidence_blob");
    }
  }
  return facts;
}

function validatePrecommitManifest(manifest, manifestArgument, evidenceParentArgument) {
  validateManifestDocument(manifest);
  if (evidenceParentArgument !== manifest.evidenceParentRevision) fail("evidence_parent_argument");
  const head = gitText(["rev-parse", "HEAD"]);
  if (head !== manifest.evidenceParentRevision) fail("evidence_parent_head");
  if (gitText(["rev-parse", "HEAD^{tree}"]) !== manifest.evidenceParentTree) fail("evidence_parent_tree");
  try {
    execFileSync("git", ["--no-replace-objects", "merge-base", "--is-ancestor",
      manifest.implementationRevision, manifest.evidenceParentRevision], {
      cwd: REPOSITORY_ROOT,
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    fail("implementation_ancestor");
  }
  if (splitLines(gitText(["for-each-ref", "--format=%(refname)", "refs/replace"])).length > 0) fail("replace_refs");
  if (splitLines(gitText(["diff", "--cached", "--name-only"])).length > 0) fail("staged_state");
  if (splitLines(gitText(["diff", "--name-only"])).length > 0) fail("modified_state");
  const untracked = splitLines(gitText(["ls-files", "--others", "--exclude-standard"])).sort();
  if (!isDeepStrictEqual(untracked, [manifest.manifestPath])) fail("untracked_state");
  const normalizedArgument = relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, manifestArgument)).split(sep).join("/");
  if (normalizedArgument !== manifest.manifestPath) fail("manifest_argument_path");
  const inputPaths = completeInputPathsAtRevision(manifest.implementationRevision);
  assertDeepEqual(manifest.sourceInputs.map((fact) => fact.path), inputPaths, "source_input_closure");
  const actualInputs = inputPaths.map((path) => factAtRevision(path, manifest.implementationRevision));
  assertDeepEqual(actualInputs, manifest.sourceInputs, "source_input_facts");
  assertCriticalInputs(manifest);
  assertDeepEqual(actualReviewedEvidence(manifest), manifest.reviewedEvidence, "reviewed_evidence_facts");
  for (const input of manifest.sourceInputs) {
    const workingPath = join(REPOSITORY_ROOT, ...input.path.split("/"));
    const stat = lstatSync(workingPath);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("working_input_type");
    const current = readFileSync(workingPath);
    if (sha256(current) !== input.sha256) fail("working_input_bytes");
    const mode = process.platform === "win32" ? input.mode : ((stat.mode & 0o111) ? "100755" : "100644");
    if (mode !== input.mode) fail("working_input_mode");
  }
  return true;
}

function parseManifestFile(path) {
  let document;
  try {
    document = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, path), "utf8"));
  } catch {
    fail("manifest_file");
  }
  return document;
}

function parseCliArguments(argv) {
  if (argv.length === 4 && argv[0] === "--validate-manifest" && argv[2] === "--evidence-parent") {
    return { mode: "validate-manifest", manifestPath: argv[1], evidenceParent: argv[3] };
  }
  if (argv.length === 4 && argv[0] === "--manifest" && argv[2] === "--output") {
    return { mode: "campaign", manifestPath: argv[1], outputPath: argv[3] };
  }
  fail("cli_arguments");
}

async function runCli(argv) {
  let parsed;
  try {
    parsed = parseCliArguments(argv);
    const manifest = parseManifestFile(parsed.manifestPath);
    if (parsed.mode === "validate-manifest") {
      validatePrecommitManifest(manifest, parsed.manifestPath, parsed.evidenceParent);
      return {
        kind: "e3_perf_01_cli_result",
        mode: "validate-manifest",
        phase: "manifest-preflight",
        disposition: "pass",
      };
    }
    validateManifestDocument(manifest);
    // The exported orchestration API is the campaign engine. The CLI requires the
    // approved outer launcher to supply its verified adapters; absent that binding,
    // a direct host invocation fails before the load child can start.
    fail("campaign_launcher_attestation");
  } catch {
    return {
      kind: "e3_perf_01_cli_failure",
      mode: parsed?.mode ?? (argv[0] === "--validate-manifest" ? "validate-manifest" : "campaign"),
      phase: parsed?.mode === "validate-manifest" || argv[0] === "--validate-manifest"
        ? "manifest-preflight"
        : "campaign-preflight",
      disposition: "fail",
    };
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(SCRIPT_PATH);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const record = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(record)}\n`);
  if (record.disposition !== "pass") process.exitCode = 1;
}
