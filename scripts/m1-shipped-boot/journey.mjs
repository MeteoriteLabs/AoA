#!/usr/bin/env node
// -----------------------------------------------------------------------------
// DEP-015 — the shipped CI boot's journey driver.
//
//   node scripts/m1-shipped-boot/journey.mjs <phase> --out <dir> [--candidate <sha>] [--mode keyless|keyed]
//
// One phase per workflow step (`.github/workflows/m1-shipped-boot.yml`), so a failure names
// its phase and the retained evidence stops exactly there. The same file drives a local
// rehearsal; nothing here is CI-specific except `AOA_M1_SECRET_OWNER` (the uid the secret
// files are chowned to so the non-root containers can read them).
//
// Phases, in order:
//   prepare            generate every job secret + the CONTROL-PLANE KEYPAIR, write the compose
//                      env file and the state file (both 0600, never uploaded)
//   boot-core          postgres + minio + migrate + BOTH control-plane replicas
//   seed               board identity (SQL, owner role — no route mints the first one), the bucket,
//                      then THROUGH THE API: three Organizations, one Company + one org agent each,
//                      the anthropic + e2b Company keys
//   apply-rollout      write the F10 tenant set and recreate BOTH replicas with it
//   assert-tenants     the rendered manifest + each RUNNING replica's env: tenant set exact, crew off
//   provision-targets  per Organization: the `aoa-canary-e2b` target, its ratified profile, an
//                      enrolment code → ticket
//   boot-workers       keyed: adapter-manager, then the three workers; keyless: workers only
//                      (`--no-deps`) — the adapter-manager is never started, so no E2B call
//   await-workers      each worker enrolled on its own Organization's target and seen live
//   reconcile          reconcile-legacy-resources per Organization (as aoa_operator), then the
//                      canary preflight per Organization
//   dispatch           keyed: one assigned task per tenant; the enabled ones must run distributed
//                      and pass `verify-e7-1-distributed-run`; the control must stay legacy with
//                      zero jobs. keyless: the CONTROL tenant only (it never reaches a provider).
//   collect            redacted service logs + `compose ps` into the evidence dir
//   teardown           `compose down -v`, and the keypair + secrets deleted
//
// SECRETS. Every value `prepare` generates, plus E2B_API_KEY / ANTHROPIC_API_KEY, is listed in
// the state file's `redact` array; every log this driver retains passes through `redactSecrets`.
// The evidence dir never receives the env file, the state file, the keypair or a ticket.
// -----------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRolloutPolicy,
  evaluateTenantRollout,
  evaluateMustBeOffFlags,
  envLinesToMap,
  encodeEnrollmentTicket,
  providerConstraintProfileUnsigned,
  registeredTargetProfile,
  parseVerifierVerdict,
  classifyTenantOutcome,
  redactSecrets,
  extractRolloutResolution,
  CANARY_EXECUTION_TARGET_SLUG,
} from "../lib/m1-shipped-boot.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT = "aoa-m1-boot";
const BASE_COMPOSE = "docker-compose.staging.yml";
const OVERLAY = "docker/m1-boot/docker-compose.m1-boot.yml";
const CP_URL = "http://127.0.0.1:3100";
const RESULT_MARKER = "__M1_RESULT__";

/** The three tenants, their worker service and the replica each worker talks to (F10). */
const TENANTS = [
  { key: "a", role: "enabled", name: "M1 Enabled A", worker: "m1-worker-a", envTicket: "AOA_M1_WORKER_A_TICKET_FILE" },
  { key: "b", role: "enabled", name: "M1 Enabled B", worker: "m1-worker-b", envTicket: "AOA_M1_WORKER_B_TICKET_FILE" },
  { key: "c", role: "control", name: "M1 Control C", worker: "m1-worker-c", envTicket: "AOA_M1_WORKER_C_TICKET_FILE" },
];
const CP_REPLICAS = ["control-plane", "control-plane-b"];

// --- plumbing -----------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { phase: argv[2] };
  for (let i = 3; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--out") out.out = argv[++i];
    else if (key === "--candidate") out.candidate = argv[++i];
    else if (key === "--mode") out.mode = argv[++i];
    else if (key === "--e2b-template") out.template = argv[++i];
  }
  return out;
}

function fail(message) {
  console.error(`::error::DEP-015 ${message}`);
  process.exit(1);
}

function writeSecretFile(file, content) {
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Hand a secret file to the containers' non-root uid (CI only; a no-op locally). */
function releaseToContainers(file) {
  const owner = process.env.AOA_M1_SECRET_OWNER;
  if (!owner) return;
  const res = spawnSync("sudo", ["chown", owner, file], { encoding: "utf8" });
  if (res.status !== 0) fail(`could not chown ${path.basename(file)} to ${owner}: ${res.stderr}`);
}

function statePath(out) {
  return path.join(out, "state.json");
}

function loadState(out) {
  if (!out) fail("--out <dir> is required");
  return JSON.parse(readFileSync(statePath(out), "utf8"));
}

function saveState(state) {
  writeSecretFile(statePath(state.out), JSON.stringify(state, null, 2));
}

function evidenceDir(state) {
  const dir = path.join(state.out, "evidence");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeEvidence(state, name, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  writeFileSync(path.join(evidenceDir(state), name), redactSecrets(text, state.redact) + "\n");
}

function composeArgs(state) {
  return ["compose", "-p", PROJECT, "--env-file", state.envFile, "-f", BASE_COMPOSE, "-f", OVERLAY];
}

function compose(state, args, { timeout = 900_000, allowFail = false, input } = {}) {
  const res = spawnSync("docker", [...composeArgs(state), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFail && res.status !== 0) {
    console.error(redactSecrets(`${res.stdout ?? ""}\n${res.stderr ?? ""}`, state.redact).slice(-8000));
    fail(`docker compose ${args.slice(0, 3).join(" ")} … exited ${res.status}`);
  }
  return res;
}

/** Run an ESM snippet inside a compose service (source on STDIN — the D1 harness idiom), so
 * bare specifiers resolve against the image's own deployed tree. Returns the parsed result. */
function dexec(state, service, source, { timeout = 300_000, env = {} } = {}) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const res = compose(state, ["exec", "-T", ...envArgs, service, "node", "--input-type=module"], {
    timeout,
    allowFail: true,
    input: source,
  });
  const stdout = res.stdout ?? "";
  const idx = stdout.indexOf(RESULT_MARKER);
  let result = null;
  if (idx >= 0) {
    const rest = stdout.slice(idx + RESULT_MARKER.length);
    const nl = rest.indexOf("\n");
    try { result = JSON.parse(nl >= 0 ? rest.slice(0, nl) : rest); } catch { result = null; }
  }
  return { status: res.status, stdout, stderr: res.stderr ?? "", result };
}

const REPORT = `const report = (v) => console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify(v));\n`;

/** Owner-role SQL inside the control plane (a superuser; bypasses RLS — seed and read-back only). */
function ownerSql(state, sqlText, params = []) {
  const { result, stdout, stderr } = dexec(state, "control-plane", `
import postgres from "postgres";
${REPORT}
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const rows = await sql.unsafe(${JSON.stringify(sqlText)}, ${JSON.stringify(params)});
  report({ ok: true, rows });
} catch (error) {
  report({ ok: false, error: String(error && error.message ? error.message : error) });
} finally { await sql.end({ timeout: 5 }); }
`);
  if (!result || !result.ok) {
    fail(`owner SQL failed: ${redactSecrets(result?.error ?? `${stdout}\n${stderr}`, state.redact).slice(-2000)}`);
  }
  return result.rows;
}

async function api(state, method, urlPath, body) {
  const res = await fetch(`${CP_URL}/api${urlPath}`, {
    method,
    headers: { authorization: `Bearer ${state.boardToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    fail(`${method} ${urlPath} → ${res.status}: ${redactSecrets(text, state.redact).slice(0, 1500)}`);
  }
  return json;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");

// --- phases ------------------------------------------------------------------------------------

function prepare(args) {
  if (!args.out) fail("--out <dir> is required");
  if (!/^[0-9a-f]{40}$/.test(String(args.candidate ?? ""))) fail("--candidate must be a 40-hex commit sha");
  if (args.mode !== "keyless" && args.mode !== "keyed") fail("--mode must be keyless or keyed");
  if (args.template !== undefined && args.template !== "" && !/^[A-Za-z0-9._-]{1,64}$/.test(args.template)) {
    fail("--e2b-template must be a template id/name ([A-Za-z0-9._-], at most 64 characters)");
  }
  const out = path.resolve(args.out);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  chmodSync(out, 0o700);

  const images = readFileSync(path.join(repoRoot, "docker", "images", "digests.env"), "utf8");
  const tag = (key) => {
    const line = images.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    if (!line) fail(`docker/images/digests.env has no ${key} (run docker/images/build.sh first)`);
    return line.slice(key.length + 1);
  };
  const imageRevision = tag("CONTROL-PLANE_REVISION");
  for (const key of ["CONTROL-PLANE_REVISION", "WORKER_REVISION", "ADAPTER-MANAGER_REVISION"]) {
    if (tag(key) !== args.candidate) fail(`${key}=${tag(key)} is not the candidate ${args.candidate} — images must be built from the candidate`);
  }

  // ★ THE CI-GENERATED CONTROL-PLANE KEYPAIR (F3). Minted here, inside the job, never read from a
  // secret store, never uploaded, deleted by `teardown`. The pair is proven matched below before
  // anything boots, because a mismatched pair boots clean and fails every gated create silently.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const probe = Buffer.from(`dep-015-keypair-probe:${secret(12)}`);
  if (!verify(null, probe, createPublicKey(publicPem), sign(null, probe, createPrivateKey(privatePem)))) {
    fail("the generated control-plane keypair does not verify (sign/verify probe)");
  }
  const keyDir = path.join(out, "keys");
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const signingKeyFile = path.join(keyDir, "control-plane-signing-key.pem");
  const publicKeyFile = path.join(keyDir, "adapter-manager-cp-pubkey.pem");
  writeSecretFile(signingKeyFile, privatePem);
  writeSecretFile(publicKeyFile, publicPem);

  const ticketFiles = {};
  for (const t of TENANTS) {
    ticketFiles[t.envTicket] = path.join(keyDir, `${t.worker}.ticket`);
    writeSecretFile(ticketFiles[t.envTicket], "");
  }

  const gen = {
    AOA_M1_OWNER_DB_PASSWORD: secret(24),
    AOA_M1_APP_DB_PASSWORD: secret(24),
    AOA_M1_OPERATOR_DB_PASSWORD: secret(24),
    AOA_M1_MINIO_PASSWORD: secret(24),
    AOA_M1_WORKER_SESSION_SIGNING_KEY: secret(48),
    AOA_M1_TRUTH_SHARED_SECRET: secret(32),
    AOA_M1_SECRETS_MASTER_KEY: randomBytes(32).toString("base64"),
    AOA_M1_BETTER_AUTH_SECRET: secret(48),
  };
  const boardToken = `aoa_m1_${secret(32)}`;
  const envValues = {
    ...gen,
    AOA_M1_CONTROL_PLANE_IMAGE: tag("CONTROL-PLANE_IMAGE"),
    AOA_M1_WORKER_IMAGE: tag("WORKER_IMAGE"),
    AOA_M1_ADAPTER_MANAGER_IMAGE: tag("ADAPTER-MANAGER_IMAGE"),
    // Empty tenant set until the Organizations exist (`apply-rollout` writes the real one).
    AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT: JSON.stringify({ organizations: {} }),
    AOA_M1_E2B_TEMPLATE: args.template || "aoa-base",
    AOA_M1_CP_SIGNING_KEY_FILE: signingKeyFile,
    AOA_M1_CP_PUBLIC_KEY_FILE: publicKeyFile,
    ...ticketFiles,
  };
  const envFile = path.join(out, "m1-boot.env");
  const state = {
    out,
    envFile,
    candidate: args.candidate,
    imageRevision,
    mode: args.mode,
    envValues,
    boardToken,
    signingKeyFile,
    publicKeyFile,
    ticketFiles,
    tenants: {},
    redact: [
      ...Object.values(gen),
      boardToken,
      privatePem.trim(),
      process.env.E2B_API_KEY ?? "",
      process.env.ANTHROPIC_API_KEY ?? "",
    ].filter((v) => v.length >= 8),
  };
  writeEnvFile(state);
  saveState(state);
  // Nothing is handed to the containers' uid yet: the workflow runs `pnpm verify:cp-am-keypair`
  // over these two files next (the runbook's mandatory pair check — mint with the control plane's
  // code, verify with the adapter-manager's), and `boot-core` releases them after it.
  writeEvidence(state, "candidate.json", {
    candidate: args.candidate,
    mode: args.mode,
    images: {
      controlPlane: { image: tag("CONTROL-PLANE_IMAGE"), digest: tag("CONTROL-PLANE_DIGEST"), revision: tag("CONTROL-PLANE_REVISION") },
      worker: { image: tag("WORKER_IMAGE"), digest: tag("WORKER_DIGEST"), revision: tag("WORKER_REVISION") },
      adapterManager: { image: tag("ADAPTER-MANAGER_IMAGE"), digest: tag("ADAPTER-MANAGER_DIGEST"), revision: tag("ADAPTER-MANAGER_REVISION") },
    },
    keypair: { generatedInJob: true, algorithm: "ed25519", signVerifyProbe: "pass", publicKeySha256: createHash("sha256").update(publicPem).digest("hex") },
  });
  console.log(`prepare: candidate ${args.candidate} (${args.mode}); keypair generated in-job and sign/verify-probed; env + state written 0600`);
}

function writeEnvFile(state) {
  const lines = Object.entries(state.envValues).map(([k, v]) => {
    // Compose dotenv: single quotes keep JSON (the rollout) literal.
    if (/[\s"'$#{}]/.test(String(v))) return `${k}='${String(v).replace(/'/g, "")}'`;
    return `${k}=${v}`;
  });
  // E2B_API_KEY is deliberately NOT written here: compose reads it from the process env, set only
  // on the keyed boot-workers step. The file therefore never holds the provider key.
  writeSecretFile(state.envFile, `${lines.join("\n")}\n`);
}

function renderAndCheck(state, label) {
  const rendered = path.join(state.out, `rendered-${label}.json`);
  const res = compose(state, ["config", "--format", "json"]);
  writeSecretFile(rendered, res.stdout);
  const check = spawnSync("node", ["scripts/check-staging-manifest.mjs", "--rendered", rendered], { cwd: repoRoot, encoding: "utf8" });
  writeEvidence(state, `manifest-check-${label}.txt`, `${check.stdout}${check.stderr}`);
  if (check.status !== 0) fail(`the rendered shipped boot failed the DEP-015 manifest check (${label}):\n${check.stdout}${check.stderr}`);
  const parsed = JSON.parse(res.stdout);
  rmSync(rendered, { force: true });
  return parsed;
}

function bootCore(state) {
  // The tickets stay runner-owned placeholders until `provision-targets` writes them; only the
  // two key files are handed to the containers' uid now.
  for (const file of [state.signingKeyFile, state.publicKeyFile]) releaseToContainers(file);
  renderAndCheck(state, "pre-boot");
  compose(state, ["up", "-d", "--wait", "--wait-timeout", "600", "postgres", "minio", "migrate", ...CP_REPLICAS], { timeout: 1_200_000 });
  console.log("boot-core: postgres, minio, migrate (completed), control-plane + control-plane-b healthy");
}

async function seed(state) {
  // (1) The first board identity. No route mints one without an existing session (this stack is
  // `authenticated`; the OAuth flow is not exercised), so it is seeded as a fixture with the
  // owner role — exactly the rows `actorMiddleware` reads — and every tenant object after it is
  // created through the API as that board user.
  const userId = `m1-shipped-boot-${secret(6)}`;
  const keyHash = createHash("sha256").update(state.boardToken).digest("hex");
  ownerSql(state, `
    WITH u AS (INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
               VALUES ($1, 'M1 shipped boot operator', $2, true, now(), now()) RETURNING id),
         r AS (INSERT INTO instance_user_roles (user_id, role) SELECT id, 'instance_admin' FROM u RETURNING id)
    INSERT INTO board_api_keys (user_id, name, key_hash) SELECT id, 'dep-015-shipped-boot', $3 FROM u`,
  [userId, `${userId}@m1-boot.invalid`, keyHash]);
  state.boardUserId = userId;

  // (2) The artifact bucket (MinIO over TLS; the control plane's own SDK chain + CA).
  const bucket = dexec(state, "control-plane", `
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
${REPORT}
const client = new S3Client({ region: "us-east-1", endpoint: process.env.AOA_STORAGE_S3_ENDPOINT, forcePathStyle: true });
try { await client.send(new CreateBucketCommand({ Bucket: process.env.AOA_STORAGE_S3_BUCKET })); report({ ok: true }); }
catch (error) { report({ ok: /BucketAlready/.test(String(error && error.name)), error: String(error && error.name) }); }
finally { client.destroy(); }
`);
  if (!bucket.result?.ok) fail(`could not create the artifact bucket: ${bucket.result?.error ?? bucket.stderr}`);

  // (3) Three Organizations, each with one Company and one org agent, through the API.
  for (const t of TENANTS) {
    const org = await api(state, "POST", "/organizations", { name: `${t.name} ${secret(3)}` });
    const company = await api(state, "POST", "/companies", { name: `${t.name} Co`, organizationId: org.id });
    const agent = await api(state, "POST", `/companies/${company.id}/agents`, {
      name: `${t.name} Agent`,
      kind: "org",
      adapterType: "claude_local",
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
    });
    // The Company keys. keyless: placeholders — nothing in the keyless mode ever presents them to
    // a provider (the adapter-manager is never started). keyed: the repository secrets.
    const anthropic = state.mode === "keyed" ? process.env.ANTHROPIC_API_KEY : `keyless-placeholder-${secret(8)}`;
    const e2b = state.mode === "keyed" ? process.env.E2B_API_KEY : `keyless-placeholder-${secret(8)}`;
    if (state.mode === "keyed" && (!anthropic || !e2b)) fail("keyed mode needs ANTHROPIC_API_KEY and E2B_API_KEY in the step env");
    if (state.mode === "keyless") state.redact.push(anthropic, e2b);
    await api(state, "POST", `/companies/${company.id}/providers/anthropic/key`, { value: anthropic });
    await api(state, "POST", `/companies/${company.id}/runtime-provider-keys/with-secret`, {
      provider: "e2b",
      displayName: "M1 shipped boot E2B",
      value: e2b,
      isDefault: true,
    });
    state.tenants[t.key] = { role: t.role, organizationId: org.id, companyId: company.id, agentId: agent.id, worker: t.worker };
    console.log(`seed: tenant ${t.key} (${t.role}) org=${org.id} company=${company.id} agent=${agent.id}`);
  }
  saveState(state);
  const orgRows = ownerSql(state, `SELECT c.id AS company_id, c.organization_id FROM companies c WHERE c.id = ANY($1::uuid[])`,
    [Object.values(state.tenants).map((t) => t.companyId)]);
  writeEvidence(state, "tenants.json", {
    tenants: state.tenants,
    companiesToOrganizations: orgRows,
    note: "Organizations, Companies, agents and Company keys created through the API as the board user; the board identity itself is an owner-role SQL fixture.",
  });
}

function tenantIds(state) {
  const enabled = Object.values(state.tenants).filter((t) => t.role === "enabled").map((t) => t.organizationId);
  const control = Object.values(state.tenants).find((t) => t.role === "control")?.organizationId;
  return { enabled, control };
}

function applyRollout(state) {
  const { enabled, control } = tenantIds(state);
  const policy = buildRolloutPolicy(enabled);
  const pre = evaluateTenantRollout(policy, { enabled, control }).violations;
  if (pre.length) fail(`the generated tenant set is wrong:\n${pre.join("\n")}`);
  state.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT = policy;
  writeEnvFile(state);
  saveState(state);
  compose(state, ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "600", ...CP_REPLICAS], { timeout: 900_000 });
  console.log(`apply-rollout: both replicas recreated with the F10 tenant set (enabled ${enabled.join(", ")}; control ${control} absent)`);
}

function assertTenants(state) {
  const { enabled, control } = tenantIds(state);
  const rendered = renderAndCheck(state, "post-rollout");
  const results = {};
  const violations = [];
  for (const replica of CP_REPLICAS) {
    // (a) the render
    const renderedEnv = rendered.services?.[replica]?.environment ?? {};
    // (b) the RUNNING container — what the process actually read
    const container = compose(state, ["ps", "-q", replica]).stdout.trim();
    const inspect = spawnSync("docker", ["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", container], { encoding: "utf8" });
    const liveEnv = envLinesToMap(inspect.stdout);
    for (const [where, env] of [["rendered", renderedEnv], ["running", liveEnv]]) {
      const tenant = evaluateTenantRollout(env.AOA_DISTRIBUTED_EXECUTION_ROLLOUT, { enabled, control }).violations;
      const off = evaluateMustBeOffFlags(env).violations;
      results[`${replica}:${where}`] = {
        tenantSet: tenant.length === 0 ? "exact" : tenant,
        crewRolloutEnabled: env.AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED ?? null,
        toolSurfaceEnabled: env.AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED ?? null,
        mustBeOff: off.length === 0 ? "off" : off,
      };
      violations.push(...tenant.map((x) => `${replica} (${where}): ${x}`), ...off.map((x) => `${replica} (${where}): ${x}`));
    }
  }
  writeEvidence(state, "tenant-set-and-flags.json", { enabled, control, replicas: results });
  if (violations.length) fail(`tenant-set / must-be-off assertion failed:\n${violations.join("\n")}`);
  console.log(`assert-tenants: both replicas (rendered AND running) hold exactly {${enabled.join(", ")}} canary, control ${control} absent; crew + tool surface OFF`);
}

async function provisionTargets(state) {
  const policyHash = createHash("sha256").update(`dep-015-policy:${state.candidate}`).digest("hex");
  for (const t of TENANTS) {
    const tenant = state.tenants[t.key];
    // The provider digest with the server's OWN canonicalizer (no drift): computed in the image.
    const unsigned = providerConstraintProfileUnsigned();
    const digest = dexec(state, "control-plane", `
import { createHash } from "node:crypto";
import { canonicalProviderConstraintProfileDigestInputV1 } from "@armyofagents/worker-protocol";
${REPORT}
report({ digest: createHash("sha256").update(Buffer.from(canonicalProviderConstraintProfileDigestInputV1(${JSON.stringify(unsigned)}))).digest("hex") });
`).result?.digest;
    if (!/^[0-9a-f]{64}$/.test(String(digest))) fail(`could not compute the provider-constraint digest for tenant ${t.key}`);
    const provider = { ...unsigned, digest };
    // `capabilities.providerConstraints` is what the ENROLMENT RESPONSE is built from
    // (`providerConstraints(target.capabilities)`, server/src/services/worker-enrollment.ts); a
    // target created without it ratifies fine and then 503s every enrolment
    // (`worker_enrollment_internal_unavailable`) — measured on this driver's first rehearsal.
    const target = await api(state, "POST", `/organizations/${tenant.organizationId}/execution-targets`, {
      slug: CANARY_EXECUTION_TARGET_SLUG,
      kind: "dedicated_worker",
      trustClass: "dedicated_tenant",
      status: "active",
      capabilities: { providerConstraints: { profileId: provider.profileId, version: provider.version, digest: provider.digest } },
    });
    const deviceGeneration = Number(target.deviceGeneration ?? target.device_generation ?? 1);
    const registeredProfile = registeredTargetProfile({
      targetId: target.id,
      organizationId: tenant.organizationId,
      provider,
      deviceGeneration,
      policyHash,
    });
    const ratified = await api(state, "PUT", `/organizations/${tenant.organizationId}/execution-targets/${target.id}/placement-profile`, {
      registeredProfile,
      providerConstraintProfile: provider,
    });
    const issued = await api(state, "POST", `/organizations/${tenant.organizationId}/execution-targets/${target.id}/enrollment-codes`, { scope: "organization" });
    const ticket = encodeEnrollmentTicket({ targetId: target.id, code: issued.code });
    state.redact.push(issued.code, ticket, target.workerToken ?? "");
    const ticketFile = state.ticketFiles[t.envTicket];
    writeSecretFile(ticketFile, ticket);
    releaseToContainers(ticketFile);
    tenant.targetId = target.id;
    tenant.registeredProfileHash = ratified?.registeredProfileHash ?? null;
    tenant.enrollmentExpiresAt = issued.expiresAt;
    console.log(`provision-targets: tenant ${t.key} target ${target.id} ratified (${tenant.registeredProfileHash}); enrolment ticket written`);
  }
  saveState(state);
  writeEvidence(state, "targets.json", Object.fromEntries(Object.entries(state.tenants).map(([k, t]) => [k, {
    organizationId: t.organizationId, targetId: t.targetId, slug: CANARY_EXECUTION_TARGET_SLUG, registeredProfileHash: t.registeredProfileHash,
  }])));
}

function bootWorkers(state) {
  const workers = TENANTS.map((t) => t.worker);
  if (state.mode === "keyed") {
    if (!process.env.E2B_API_KEY) fail("keyed mode: E2B_API_KEY is empty in the boot-workers step — the adapter-manager would refuse to boot");
    compose(state, ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "300", "adapter-manager"], { timeout: 600_000 });
    compose(state, ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "300", ...workers], { timeout: 600_000 });
    console.log("boot-workers (keyed): adapter-manager healthy; three workers healthy");
  } else {
    // ★ KEYLESS STOPS SHORT OF THE PROVIDER: the adapter-manager is never started, so no E2B API
    // call is possible. The workers boot `--no-deps` (their compose dependency on it is skipped),
    // enrol and poll; nothing dispatches to an enabled tenant in this mode.
    compose(state, ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "300", ...workers], { timeout: 600_000 });
    const am = compose(state, ["ps", "-q", "adapter-manager"]).stdout.trim();
    if (am) fail("keyless mode: the adapter-manager is running — the keyless mode must never start it");
    console.log("boot-workers (keyless): three workers healthy; adapter-manager NOT started (no E2B call possible)");
  }
}

async function awaitWorkers(state) {
  const deadline = Date.now() + 5 * 60_000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = ownerSql(state, `
      SELECT w.id, w.organization_id, w.execution_target_id, w.status, w.scope, w.device_generation,
             w.last_seen_at IS NOT NULL AND w.last_seen_at > now() - interval '5 minutes' AS live
        FROM workers w WHERE w.execution_target_id = ANY($1::uuid[])`,
    [Object.values(state.tenants).map((t) => t.targetId)]);
    const ok = Object.values(state.tenants).every((t) =>
      rows.filter((r) => r.execution_target_id === t.targetId && r.organization_id === t.organizationId && r.live).length === 1);
    if (ok) break;
    await sleep(10_000);
  }
  const perTenant = Object.fromEntries(Object.entries(state.tenants).map(([k, t]) => [k,
    rows.filter((r) => r.execution_target_id === t.targetId)]));
  writeEvidence(state, "workers.json", perTenant);
  for (const [k, list] of Object.entries(perTenant)) {
    if (list.length !== 1 || !list[0].live || list[0].organization_id !== state.tenants[k].organizationId) {
      fail(`tenant ${k}: expected exactly one live worker enrolled on its own Organization's target; got ${JSON.stringify(list)}`);
    }
  }
  console.log("await-workers: each tenant has exactly one worker, enrolled on its OWN Organization's target, heartbeating");
}

function reconcile(state) {
  const results = {};
  for (const [k, t] of Object.entries(state.tenants)) {
    const rec = compose(state, ["exec", "-T", "control-plane", "sh", "-c",
      `DATABASE_URL="$AOA_OPERATOR_DATABASE_URL" node dist/cli/reconcile-legacy-resources.js --organization ${t.organizationId}`], { allowFail: true });
    const pre = dexec(state, "control-plane", `
import { createDb } from "@armyofagents/db";
import { createCanaryPreflight } from "/cp-app/dist/services/canary-preflight.js";
import { createDrizzleCanaryPreflightStore } from "/cp-app/dist/services/canary-preflight-store.js";
${REPORT}
const db = createDb(process.env.AOA_OPERATOR_DATABASE_URL);
try { report(await createCanaryPreflight({ store: createDrizzleCanaryPreflightStore(db) }).check({ organizationId: ${JSON.stringify(t.organizationId)} })); }
catch (error) { report({ ok: false, reason: "driver_error", detail: String(error && error.message ? error.message : error) }); }
finally { process.exit(0); }
`);
    results[k] = {
      role: t.role,
      reconcileExit: rec.status,
      reconcileOutput: redactSecrets(`${rec.stdout}${rec.stderr}`, state.redact).slice(-3000),
      preflight: pre.result,
    };
  }
  writeEvidence(state, "reconcile-and-preflight.json", results);
  const bad = Object.entries(results).filter(([, r]) => r.reconcileExit !== 0 || r.preflight?.ok !== true);
  if (bad.length) fail(`reconcile/preflight failed for tenant(s) ${bad.map(([k]) => k).join(", ")} — see reconcile-and-preflight.json`);
  console.log("reconcile: every Organization reconciled; the canary preflight passes for ALL THREE (the control differs ONLY by the rollout)");
}

async function dispatchTenant(state, key) {
  const t = state.tenants[key];
  const issue = await api(state, "POST", `/companies/${t.companyId}/issues`, {
    title: `DEP-015 shipped boot journey (${key}, ${t.role})`,
    description: "Reply with the single word: done.",
    status: "todo",
    assigneeAgentId: t.agentId,
  });
  t.issueId = issue.id;
  const deadline = Date.now() + 20 * 60_000;
  let run = null;
  while (Date.now() < deadline) {
    const rows = ownerSql(state, `
      SELECT id, status, execution_owner, distributed_job_id, distributed_attempt_id, error, error_code,
             exit_code, finished_at, usage_json
        FROM heartbeat_runs WHERE context_snapshot->>'issueId' = $1 ORDER BY created_at ASC`, [issue.id]);
    run = rows[0] ?? null;
    if (run && ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status) && run.finished_at) break;
    await sleep(10_000);
  }
  return { issue, run };
}

function tenantSignals(state, key, run) {
  const t = state.tenants[key];
  const q = (sqlText, params) => ownerSql(state, sqlText, params);
  const runId = run?.id ?? "00000000-0000-4000-8000-000000000000";
  return {
    jobsForOrganization: Number(q(`SELECT count(*)::int AS n FROM jobs WHERE organization_id = $1`, [t.organizationId])[0].n),
    selection: q(`SELECT event_type, payload FROM heartbeat_run_events WHERE run_id = $1 AND event_type LIKE 'distributed_execution_%' ORDER BY created_at`, [runId]),
    audit: {
      jobSubmitted: q(`SELECT action, entity_id, details FROM activity_log WHERE action = 'job.submitted' AND company_id = $1`, [t.companyId]),
      securityDenials: q(`SELECT action, details FROM activity_log WHERE action LIKE 'security.denied.%' AND company_id = $1`, [t.companyId]),
    },
    cost: {
      costEventsForRun: Number(q(`SELECT count(*)::int AS n FROM cost_events WHERE heartbeat_run_id = $1`, [runId])[0].n),
      usageJson: run?.usage_json ?? null,
      note: "A distributed run writes no cost_events today (jobBudgetCostBridge has no production caller; E3-F037/JOB-016). Recorded, not judged.",
    },
    failureClassification: {
      runStatus: run?.status ?? null,
      runError: run?.error ?? null,
      terminalErrorCode: run?.usage_json?.terminalErrorCode ?? null,
      terminalEvents: run?.distributed_attempt_id
        ? q(`SELECT event->'payload'->>'status' AS status, event->'payload'->>'errorCode' AS error_code, event->'payload'->>'exitCode' AS exit_code
               FROM job_events WHERE attempt_id = $1 AND event_type = 'terminal'`, [run.distributed_attempt_id])
        : [],
      attempt: run?.distributed_attempt_id
        ? q(`SELECT status, placement_disposition, placement_reason_code FROM job_attempts WHERE id = $1`, [run.distributed_attempt_id])
        : [],
    },
  };
}

async function dispatch(state) {
  const keys = state.mode === "keyed" ? TENANTS.map((t) => t.key) : TENANTS.filter((t) => t.role === "control").map((t) => t.key);
  const outcomes = {};
  for (const key of keys) {
    const t = state.tenants[key];
    const { issue, run } = await dispatchTenant(state, key);
    const signals = tenantSignals(state, key, run);
    let verifierExit = null;
    let verdict = null;
    let verifierOutput = null;
    let providerEvidence = null;
    if (t.role === "enabled" && run) {
      const v = compose(state, ["exec", "-T", "control-plane", "node", "dist/cli/verify-e7-1-distributed-run.js", run.id,
        "--org", t.organizationId, "--company", t.companyId], { allowFail: true });
      verifierExit = v.status;
      verifierOutput = redactSecrets(`${v.stdout}${v.stderr}`, state.redact);
      verdict = parseVerifierVerdict(v.stdout);
      // The verifier reads no provider identity (runbook §11): a fake provider's lease + events
      // would pass it. The worker's own log line naming a real sandbox is required as well.
      const logs = compose(state, ["logs", "--no-color", t.worker], { allowFail: true });
      const sandboxLines = `${logs.stdout}`.split(/\r?\n/).filter((l) => /sandboxId=/.test(l));
      providerEvidence = { sandboxLogLines: sandboxLines.length, sample: redactSecrets(sandboxLines.slice(-3).join("\n"), state.redact) };
    }
    // The control plane's own account of the rollout decision for THIS run (either replica may
    // have executed it; the wake lands on whichever served the assignment).
    let rolloutResolution = null;
    if (run) {
      for (const replica of CP_REPLICAS) {
        const logs = compose(state, ["logs", "--no-color", "--no-log-prefix", replica], { allowFail: true });
        rolloutResolution = extractRolloutResolution(`${logs.stdout}`, run.id);
        if (rolloutResolution) break;
      }
    }
    const outcome = classifyTenantOutcome({
      role: t.role,
      run,
      jobsForOrganization: signals.jobsForOrganization,
      verifierExit,
      verdict,
      rolloutResolution,
    });
    if (t.role === "enabled" && run && (!providerEvidence || providerEvidence.sandboxLogLines === 0)) {
      outcome.pass = false;
      outcome.reasons.push("no worker log line names a provider sandbox for this tenant (runbook §11: the verifier cannot tell a real provider from a fake)");
    }
    outcomes[key] = {
      role: t.role,
      organizationId: t.organizationId,
      issueId: issue.id,
      run,
      verifierExit,
      verdict,
      capabilityProven: verdict?.capabilityProven ?? null,
      rolloutResolution,
      providerEvidence,
      signals,
      outcome,
    };
    if (verifierOutput) writeEvidence(state, `verifier-${key}.txt`, verifierOutput);
  }
  const passed = Object.values(outcomes).every((o) => o.outcome.pass);
  const summary = {
    candidate: state.candidate,
    mode: state.mode,
    dispatched: keys,
    keylessNote: state.mode === "keyless"
      ? "keyless: only the CONTROL tenant was dispatched (it never reaches a provider). The enabled tenants' journey is the KEYED acceptance."
      : undefined,
    passed,
    outcomes,
  };
  writeEvidence(state, "journey.json", summary);
  saveState(state);
  for (const [k, o] of Object.entries(outcomes)) {
    console.log(`dispatch: tenant ${k} (${o.role}) run=${o.run?.id ?? "none"} owner=${o.run?.execution_owner ?? "null"} verifierExit=${o.verifierExit} capabilityProven=${o.capabilityProven} → ${o.outcome.pass ? "PASS" : `FAIL: ${o.outcome.reasons.join("; ")}`}`);
  }
  if (!passed) fail("the journey did not pass for every dispatched tenant — see journey.json");
}

function collect(state) {
  const ps = compose(state, ["ps", "-a"], { allowFail: true });
  writeEvidence(state, "compose-ps.txt", `${ps.stdout}${ps.stderr}`);
  for (const service of ["migrate", ...CP_REPLICAS, "adapter-manager", ...TENANTS.map((t) => t.worker)]) {
    const logs = compose(state, ["logs", "--no-color", "--timestamps", service], { allowFail: true });
    // Drop compose's own "variable is not set" noise (the base manifest's AOA_STAGING_* pointers,
    // which this overlay replaces) so the retained log is the service's log.
    const stderr = `${logs.stderr}`.split(/\r?\n/).filter((l) => !/level=warning msg="The \\"\w+\\" variable is not set/.test(l)).join("\n");
    writeEvidence(state, `logs-${service}.txt`, `${logs.stdout}${stderr}`.slice(-2_000_000));
  }
  console.log(`collect: evidence at ${evidenceDir(state)}`);
}

function teardown(state) {
  compose(state, ["down", "-v", "--remove-orphans"], { allowFail: true, timeout: 600_000 });
  for (const dir of [path.join(state.out, "keys")]) {
    if (process.env.AOA_M1_SECRET_OWNER) spawnSync("sudo", ["rm", "-rf", dir]);
    else rmSync(dir, { recursive: true, force: true });
  }
  rmSync(state.envFile, { force: true });
  rmSync(statePath(state.out), { force: true });
  console.log(`teardown: stack removed with its volumes; keypair, tickets, env and state deleted (${existsSync(path.join(state.out, "keys")) ? "keys dir STILL PRESENT" : "keys dir gone"})`);
}

// --- main ---------------------------------------------------------------------------------------

const PHASES = {
  prepare: (args) => prepare(args),
  "boot-core": (args) => bootCore(loadState(args.out)),
  seed: (args) => seed(loadState(args.out)),
  "apply-rollout": (args) => applyRollout(loadState(args.out)),
  "assert-tenants": (args) => assertTenants(loadState(args.out)),
  "provision-targets": (args) => provisionTargets(loadState(args.out)),
  "boot-workers": (args) => bootWorkers(loadState(args.out)),
  "await-workers": (args) => awaitWorkers(loadState(args.out)),
  reconcile: (args) => reconcile(loadState(args.out)),
  dispatch: (args) => dispatch(loadState(args.out)),
  collect: (args) => collect(loadState(args.out)),
  teardown: (args) => teardown(loadState(args.out)),
};

const args = parseArgs(process.argv);
const phase = PHASES[args.phase];
if (!phase) fail(`unknown phase ${JSON.stringify(args.phase)}; one of ${Object.keys(PHASES).join(", ")}`);
await phase(args);
