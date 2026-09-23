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
//   probe-presign      a throwaway run of the adapter-manager SERVICE (its networks, CA env, mounts;
//                      the bin never starts) HEADs the presign store: DNS + connect + TLS, free
//   dispatch           keyed: one assigned task per tenant; the enabled ones must run distributed
//                      and pass `verify-e7-1-distributed-run`; the control must stay legacy with
//                      zero jobs. keyless: the CONTROL tenant only (it never reaches a provider).
//                      Each enabled tenant also carries WRK-018 acceptance 1: EXACTLY ONE accepted
//                      `usage` event for its attempt, equal to the run's stored usage_json.
//                      DEP-017: each enabled tenant's attempt must also carry a clean live
//                      env-absence probe summary (read from its `job_events`), with a red
//                      planted control; keyless observes no probe (no sandbox exists).
//   collect            redacted service logs + `compose ps` into the evidence dir
//   leak-scan          HARD check before upload, on BOTH surfaces: no job secret (raw/base64/
//                      base64url) and no key material, in the evidence bundle OR the job log
//   teardown           `compose down -v`, and the keypair + secrets deleted
//
// SECRETS. Every value `prepare` generates, plus E2B_API_KEY / ANTHROPIC_API_KEY, is listed in
// the state file's `redact` array; every log this driver retains passes through `redactSecrets`.
// The evidence dir never receives the env file, the state file, the keypair or a ticket.
// -----------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  extractSandboxEvidence,
  scanEvidenceForSecrets,
  scanForKeyMaterial,
  maskDirectivesFor,
  stripMaskDirectives,
  KEY_MATERIAL_MARKERS,
  extractRolloutResolution,
  CANARY_EXECUTION_TARGET_SLUG,
  // DEP-017 — the live env-absence probe's read side.
  plantedTenantCanary,
  extractEnvProbeSummary,
  evaluateEnvProbeEvidence,
} from "../lib/m1-shipped-boot.mjs";
import { evaluateUsageCardinality, formatViolations } from "../lib/m1-spine-assertions.mjs";

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
/** The sandbox-evidence poll (see `dispatch`): cleanup after `terminal` is bounded by the
 * destroy op deadline, so three minutes is generous without hiding a real absence. */
const SANDBOX_EVIDENCE_DEADLINE_MS = 180_000;
const SANDBOX_EVIDENCE_POLL_MS = 5_000;

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

/** Record a job secret under a NAME: MASKED in the Actions log, redacted from every retained log,
 * and scanned for (by name) on BOTH surfaces before any evidence is uploaded. Values shorter than
 * 8 characters are not secrets this lane mints, and would match by accident.
 *
 * ★ The mask is what makes the LOG surface safe. Review batch 3A (PR #569) measured that run
 * 35619555883's job log and evidence carried no key material at all — so the gap was in the
 * CONTROL, not in an observed leak: `leakScan` walked only the evidence directory, and nothing
 * emitted `::add-mask::`. The directive itself carries the value — that IS GitHub's mechanism,
 * and the rendered log shows `***` — so it is emitted only inside Actions, and the log scan skips
 * (and counts) those lines. */
function trackSecret(state, name, value) {
  if (typeof value !== "string" || value.length < 8) return;
  state.secrets ??= {};
  const alreadyRegistered = state.secrets[name] === value;
  state.secrets[name] = value;
  if (!state.redact.includes(value)) state.redact.push(value);
  if (!alreadyRegistered && process.env.GITHUB_ACTIONS === "true") {
    // A multi-line secret is masked ONLY per line: a workflow command ends at the first
    // newline, so one directive carrying a whole PEM would print its body and footer
    // (Codex P1, PR #574). `maskDirectivesFor` owns that rule and is unit-tested.
    for (const directive of maskDirectivesFor(value)) console.log(directive);
  }
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
    redact: [],
    // NAME -> value of every job secret, for the pre-upload leak scan (which reports names only).
    secrets: {},
  };
  for (const [name, value] of Object.entries(gen)) trackSecret(state, name, value);
  trackSecret(state, "BOARD_API_TOKEN", boardToken);
  trackSecret(state, "CONTROL_PLANE_SIGNING_KEY_PEM", privatePem.trim());
  // The PEM body without its armour lines too: a log that printed the key would rarely keep them.
  trackSecret(state, "CONTROL_PLANE_SIGNING_KEY_BODY", privatePem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
  // The PUBLIC half too, whole and body-only (review batch 3A, PR #569). It is not a credential,
  // but it is the pair's other half: a log or bundle carrying it says which key this job minted,
  // and acceptance 2 is a claim about the KEYPAIR, not about the private half alone.
  trackSecret(state, "CONTROL_PLANE_PUBLIC_KEY_PEM", publicPem.trim());
  trackSecret(state, "CONTROL_PLANE_PUBLIC_KEY_BODY", publicPem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
  trackSecret(state, "E2B_API_KEY", process.env.E2B_API_KEY ?? "");
  trackSecret(state, "ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY ?? "");
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
  // ★ ONE REPLICA AT A TIME. Each control-plane replica runs `maybeProvisionDistributedExecutionRoles`
  // (`ALTER ROLE … LOGIN PASSWORD`) at boot; two booting together race on the same pg_authid
  // tuples and the loser dies with `PostgresError: tuple concurrently updated` (XX000) —
  // measured on this lane's local rehearsal, 2026-09-21. The lane serialises the boots; the race
  // itself is a product defect recorded in DEP-015-result.md for the planning session to file.
  // Replica A pulls in its dependency closure (postgres, minio, and migrate run to completion —
  // `--wait` treats a one-shot named DIRECTLY as a failure once it exits, so it is reached only
  // as a dependency); replica B then boots alone.
  compose(state, ["up", "-d", "--wait", "--wait-timeout", "600", CP_REPLICAS[0]], { timeout: 1_200_000 });
  for (const replica of CP_REPLICAS.slice(1)) {
    compose(state, ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "600", replica], { timeout: 900_000 });
  }
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
    // `POST /companies/:cid/agents` creates the agent `idle` unconditionally (server/src/routes/
    // agents.ts, the direct-create route); only `/agent-hires` honours
    // `requireBoardApprovalForNewAgents` and parks a hire as `pending_approval`. Asserted, not
    // assumed: a pending agent cannot be assigned, and the journey would die at dispatch.
    if (agent.status !== "idle") fail(`tenant ${t.key}: the created agent is ${JSON.stringify(agent.status)}, not "idle"`);
    // The Company keys. keyless: placeholders — nothing in the keyless mode ever presents them to
    // a provider (the adapter-manager is never started). keyed: the repository secrets.
    const anthropic = state.mode === "keyed" ? process.env.ANTHROPIC_API_KEY : `keyless-placeholder-${secret(8)}`;
    const e2b = state.mode === "keyed" ? process.env.E2B_API_KEY : `keyless-placeholder-${secret(8)}`;
    if (state.mode === "keyed" && (!anthropic || !e2b)) fail("keyed mode needs ANTHROPIC_API_KEY and E2B_API_KEY in the step env");
    trackSecret(state, `TENANT_${t.key.toUpperCase()}_ANTHROPIC_KEY`, anthropic);
    trackSecret(state, `TENANT_${t.key.toUpperCase()}_E2B_KEY`, e2b);
    await api(state, "POST", `/companies/${company.id}/providers/anthropic/key`, { value: anthropic });
    // DEP-017 (F10) — a PLANTED cross-tenant canary: a marked credential saved as this tenant's own
    // OpenAI key, a real secret in THIS tenant's store. Every OTHER tenant's sandbox must not see
    // it; the in-sandbox probe reports a marked value from a foreign Organization as
    // `cross_tenant_credential`. (claude_local never redeems an OpenAI key, so it is not expected
    // in this tenant's own sandbox either; if it ever were, it is its OWN credential and allowed.)
    const plantedCanary = plantedTenantCanary(org.id, "model_provider", secret(24));
    trackSecret(state, `TENANT_${t.key.toUpperCase()}_DEP017_PLANTED_CANARY`, plantedCanary);
    await api(state, "POST", `/companies/${company.id}/providers/openai/key`, { value: plantedCanary });
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
  // One replica at a time — see `bootCore` (the boot-time ALTER ROLE race).
  for (const replica of CP_REPLICAS) {
    compose(state, ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "600", replica], { timeout: 900_000 });
  }
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
    trackSecret(state, `TENANT_${t.key.toUpperCase()}_ENROLLMENT_CODE`, issued.code);
    trackSecret(state, `TENANT_${t.key.toUpperCase()}_ENROLLMENT_TICKET`, ticket);
    trackSecret(state, `TENANT_${t.key.toUpperCase()}_TARGET_WORKER_TOKEN`, target.workerToken ?? "");
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

/**
 * DEP-015 follow-up: probe the presign store FROM THE ADAPTER-MANAGER'S SEAT, before any journey.
 *
 * The adapter-manager redeems staged-file grants itself (`fetchGrantBytes`). Keyed run 35601445269
 * failed at `stage_files` because it could not reach the presign host. Nothing before the journey
 * looked, and the keyless mode never starts the adapter-manager, so it could not see this either.
 *
 * This is a throwaway `docker compose run` of the adapter-manager SERVICE with the entrypoint
 * replaced by a one-line `node` HEAD. It therefore has exactly the service's networks, env
 * (`NODE_EXTRA_CA_CERTS`) and mounts. The adapter-manager bin never starts, so no provider is
 * constructed and no E2B call is possible: the probe is free, and runs in BOTH modes. ANY HTTP
 * response passes, because the point is DNS + connect + TLS trust. A thrown fetch fails with its
 * error code. The presign endpoint is config, not a grant, so naming it in the log leaks nothing.
 */
function probePresign(state) {
  const renderedCp = JSON.parse(compose(state, ["config", "--format", "json"]).stdout).services?.[CP_REPLICAS[0]];
  const endpoint = renderedCp?.environment?.AOA_STORAGE_S3_PRESIGN_ENDPOINT;
  if (!endpoint) fail("probe-presign: the control plane declares no AOA_STORAGE_S3_PRESIGN_ENDPOINT");
  const script = [
    "const u=process.argv[1];",
    "fetch(u,{method:'HEAD'}).then(r=>{console.log('PRESIGN_PROBE_OK status='+r.status);process.exit(0)})",
    ".catch(e=>{let c=e,codes=[];for(let i=0;i<6&&c;i++){if(c.code)codes.push(c.code);c=c.cause}",
    "console.log('PRESIGN_PROBE_FAIL name='+(e&&e.name)+' codes='+codes.join(','));process.exit(1)})",
  ].join("");
  const res = compose(state, [
    "run", "--rm", "--no-deps", "--entrypoint", "node", "adapter-manager",
    "-e", script, new URL("/minio/health/live", endpoint).toString(),
  ], { allowFail: true, timeout: 180_000 });
  const out = `${res.stdout}${res.stderr}`.split(/\r?\n/).filter((l) => /PRESIGN_PROBE_/.test(l)).join("\n");
  writeEvidence(state, "presign-probe.txt", `endpoint=${endpoint}\nexit=${res.status}\n${out}`);
  if (res.status !== 0 || !/PRESIGN_PROBE_OK/.test(out)) {
    fail(`probe-presign: the adapter-manager's seat cannot reach or trust the presign store ${endpoint} — ${out || "no probe output"}`);
  }
  console.log(`probe-presign: the adapter-manager's seat reaches and trusts ${endpoint} (${out.trim()})`);
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
    // WRK-018 acceptance 1, on the KEYED lane: the accepted `usage` events of THIS attempt, from
    // the durable ledger, scoped to this attempt (never the job: a retry attempt has its own).
    usageEvents: run?.distributed_attempt_id
      ? q(`SELECT event_id AS "eventId", organization_id AS "organizationId", company_id AS "companyId",
             event->'payload' AS payload
           FROM job_events WHERE attempt_id = $1 AND event_type = 'usage' ORDER BY sequence`,
        [run.distributed_attempt_id])
      : [],
    cost: {
      costEventsForRun: Number(q(`SELECT count(*)::int AS n FROM cost_events WHERE heartbeat_run_id = $1`, [runId])[0].n),
      usageJson: run?.usage_json ?? null,
      note: "JOB-016 prices accepted usage at ingest; the cost row is keyed to the usage EVENT, not to the heartbeat run, so this count can be 0 while a charge exists. The D1 spine profile (DEP-016) is what asserts cost cardinality; here it is recorded, not judged.",
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
    let usageViolations = null;
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
      // The worker logs pino JSON (`"sandboxId":"…"`); the original `/sandboxId=/` filter could
      // never match it (keyed run 35613849443). An id counts only with the real E2B shape and,
      // when the line names a lease, only for a lease of THIS run's attempt.
      //
      // ★ POLLED, not one-shot (Codex, PR #563). The worker emits `terminal` BEFORE it destroys
      // the sandbox (`packages/worker-daemon/src/supervisor/supervisor.ts`: `events.terminal`,
      // then `finishRun`). The only line carrying both `leaseId` and `sandboxId` is logged
      // AFTER `destroy` returns. A run the control plane already sees as terminal can therefore
      // still be mid-cleanup, and a single snapshot would lose that race. So the log is re-read
      // until the attempt-bound record appears, or a bounded deadline passes.
      const leaseIds = run.distributed_attempt_id
        ? ownerSql(state, `SELECT id FROM leases WHERE attempt_id = $1`, [run.distributed_attempt_id]).map((r) => r.id)
        : [];
      const deadline = Date.now() + SANDBOX_EVIDENCE_DEADLINE_MS;
      let evidence = { count: 0, sandboxIds: [], rejected: { shape: 0, foreignLease: 0 } };
      let polls = 0;
      for (;;) {
        polls += 1;
        const logs = compose(state, ["logs", "--no-color", t.worker], { allowFail: true });
        evidence = extractSandboxEvidence(`${logs.stdout}`, { leaseIds });
        if (evidence.count > 0 || Date.now() >= deadline) break;
        await sleep(SANDBOX_EVIDENCE_POLL_MS);
      }
      providerEvidence = {
        sandboxLogLines: evidence.count,
        sandboxIds: evidence.sandboxIds,
        leaseIds,
        rejected: evidence.rejected,
        polls,
      };
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
    // WRK-018 acceptance 1 on the keyed lane — EXACTLY ONE accepted `usage` event for this
    // attempt, belonging to this tenant, and the run's stored `usage_json` equal to its numbers.
    // The cardinality half of acceptance 1 closes here; the "equal to the result line" half does
    // NOT — usage_json is projected from this same event, so the two sides are not independent
    // (Codex P1, PR #567). DEP-015-result.md §13 names what an independent capture would need.
    // The verdict is DEP-016's own `evaluateUsageCardinality` (scripts/lib/m1-spine-assertions.mjs);
    // the spine proves the same acceptance against the reference provider, this lane against a
    // real one, and a second implementation would let the two drift.
    if (t.role === "enabled" && run) {
      usageViolations = evaluateUsageCardinality({
        tenant: { key: key, organizationId: t.organizationId, companyId: t.companyId },
        observation: { usageEvents: signals.usageEvents, storedUsage: run.usage_json ?? null },
      });
    }
    const outcome = classifyTenantOutcome({
      role: t.role,
      run,
      jobsForOrganization: signals.jobsForOrganization,
      verifierExit,
      verdict,
      rolloutResolution,
    });
    if (usageViolations && usageViolations.length > 0) {
      outcome.pass = false;
      outcome.reasons.push(`usage cardinality (WRK-018 acceptance 1): ${formatViolations(usageViolations)}`);
    }
    if (t.role === "enabled" && run && (!providerEvidence || providerEvidence.sandboxLogLines === 0)) {
      outcome.pass = false;
      outcome.reasons.push("no worker log line names a provider sandbox for this tenant (runbook §11: the verifier cannot tell a real provider from a fake)");
    }
    // DEP-017 — the live env-absence probe, read back from THIS attempt's own `job_events` (the
    // worker emitted it through the run's canary scrub, before the terminal). Every enabled tenant
    // whose run went distributed must carry a clean summary with a red planted control; a missing
    // summary FAILS (a probe that did not run is not a pass). Names and classes only.
    let envProbe = null;
    if (t.role === "enabled" && run?.distributed_attempt_id) {
      // ★ `job_events.event` holds the WHOLE wire envelope, so the message is at
      // `event->'payload'->>'message'`: `toAcceptInputs` (server/src/services/job-events.ts) passes
      // `payload: event` — the entire `WorkerEventV1` — into the repository, which stores it as
      // `event: event.payload`. Corroborated end to end by `e6f-10-telemetry`, which uploads through
      // the real /worker-control/events path and asserts a payload field read exactly this way
      // (`event->'payload'->>'sandboxId'`, tests/d1/lib/e6f-harness.mjs). The COALESCE is belt and
      // braces for a future ingestion that stored the payload alone: a lane that silently read NULL
      // would report "the probe did not run" on a PAID run, which is the worst way to learn this.
      const messages = ownerSql(state, `
        SELECT COALESCE(event->'payload'->>'message', event->>'message') AS message FROM job_events
         WHERE attempt_id = $1 AND event_type = 'log' ORDER BY sequence`, [run.distributed_attempt_id]).map((r) => r.message);
      envProbe = evaluateEnvProbeEvidence(extractEnvProbeSummary(messages));
      writeEvidence(state, `env-probe-${key}.json`, { tenant: key, organizationId: t.organizationId, attemptId: run.distributed_attempt_id, ...envProbe });
      if (!envProbe.pass) {
        outcome.pass = false;
        outcome.reasons.push(...envProbe.reasons.map((r) => `DEP-017 env probe: ${r}`));
      }
    }
    outcomes[key] = {
      role: t.role,
      organizationId: t.organizationId,
      issueId: issue.id,
      run,
      verifierExit,
      verdict,
      capabilityProven: verdict?.capabilityProven ?? null,
      usage: { events: signals.usageEvents.length, storedUsage: run?.usage_json ?? null, violations: usageViolations ?? [] },
      rolloutResolution,
      providerEvidence,
      signals,
      envProbe,
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
      ? "keyless: only the CONTROL tenant was dispatched (it never reaches a provider). The enabled tenants' journey — and the DEP-017 in-sandbox env probe — is the KEYED acceptance."
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

/**
 * The pre-upload HARD leak scan (ruled in under F2 after the distinct review). Redaction transforms
 * the bundle; this verifies the result. Every job secret, by NAME, is searched for in every
 * evidence file in raw, base64 and base64url form. A match fails the run and deletes the bundle,
 * so the upload step (gated on this step's success) has nothing to publish. The output names the
 * file and the secret NAME, never the value.
 */
/** The JOB-LOG surface: what every phase printed, teed there by the workflow. */
function jobLogPath(state) {
  return path.join(state.out, "job-log.txt");
}

function leakScan(state) {
  const dir = path.join(state.out, "evidence");
  const files = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push({ name: path.relative(dir, full).split(path.sep).join("/"), text: readFileSync(full, "latin1") });
    }
  };
  walk(dir);
  // ★ TWO SURFACES (review batch 3A, PR #569). The evidence bundle is uploaded; the ACTIONS LOG is
  // published with the run and outlives it, and had no scanner at all. The bundle scan is unchanged;
  // the job log is scanned for the same named secrets AND for key material BY SHAPE, which also
  // catches a key whose bytes this scanner was never told (a re-run's, an operator's).
  // ★ The captured log contains this driver's OWN `::add-mask::` directives, which carry the
  // values by construction and which GitHub renders as `***`. They are stripped before either
  // scan — otherwise every run would fail its own leak scan (Codex P1, PR #574) — and the
  // number stripped is reported, so the exception is bounded and visible.
  const rawLog = existsSync(jobLogPath(state)) ? readFileSync(jobLogPath(state), "latin1") : null;
  const stripped = rawLog === null ? { text: "", removed: 0 } : stripMaskDirectives(rawLog);
  const logSurface = rawLog === null ? [] : [{ name: "job-log.txt", text: stripped.text }];
  const secrets = state.secrets ?? {};
  const logScan = scanForKeyMaterial(logSurface);
  const findings = [
    ...scanEvidenceForSecrets(files, secrets).map((f) => ({ ...f, surface: "evidence" })),
    ...scanEvidenceForSecrets(logSurface, secrets).map((f) => ({ ...f, surface: "job log" })),
  ];
  const keyMaterial = [
    ...scanForKeyMaterial(files).findings.map((f) => ({ ...f, surface: "evidence" })),
    ...logScan.findings.map((f) => ({ ...f, surface: "job log" })),
  ];
  if (findings.length > 0 || keyMaterial.length > 0) {
    for (const f of findings) console.error(`::error::DEP-015 leak scan: ${f.surface} file '${f.file}' contains job secret '${f.secret}' (${f.form} form)`);
    for (const f of keyMaterial) console.error(`::error::DEP-015 leak scan: ${f.surface} file '${f.file}' line ${f.line} carries key material (${f.marker})`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(jobLogPath(state), { force: true });
    fail(
      `leak scan: ${findings.length} secret occurrence(s) + ${keyMaterial.length} key-material occurrence(s) across the evidence and the job log; ` +
        `both were deleted and nothing will be uploaded`,
    );
  }
  console.log(
    `leak-scan: ${files.length} evidence file(s) + ${logSurface.length} job-log file(s) scanned for ` +
      `${Object.keys(secrets).length} named job secret(s) (raw/base64/base64url) and ${KEY_MATERIAL_MARKERS.length} key-material shapes: clean ` +
      `(${stripped.removed} ::add-mask:: directive line(s) stripped — GitHub renders those as ***)`,
  );
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
  "probe-presign": (args) => probePresign(loadState(args.out)),
  dispatch: (args) => dispatch(loadState(args.out)),
  collect: (args) => collect(loadState(args.out)),
  "leak-scan": (args) => leakScan(loadState(args.out)),
  teardown: (args) => teardown(loadState(args.out)),
};

const args = parseArgs(process.argv);
const phase = PHASES[args.phase];
if (!phase) fail(`unknown phase ${JSON.stringify(args.phase)}; one of ${Object.keys(PHASES).join(", ")}`);
await phase(args);
