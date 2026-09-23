// -----------------------------------------------------------------------------
// m1-shipped-boot — the PURE decisions of the DEP-015 shipped CI boot lane.
//
// `.github/workflows/m1-shipped-boot.yml` drives a real boot through
// `scripts/m1-shipped-boot/journey.mjs`. Everything that lane DECIDES — the F10 tenant
// set, whether the crew switch is off, what a ticket looks like, whether a tenant's run
// passed — lives here, as pure functions, so the always-on `policy` gate can prove each
// decision goes red when it should (scripts/lib/__tests__/m1-shipped-boot.test.mjs)
// without Docker, without a key and without a dispatch.
//
// Mirrors, each cited by symbol so drift is findable:
//   parseRolloutBoolean        ← parseBooleanEnv          server/src/config/distributed-execution.ts
//   ROLLOUT JSON shape         ← parseDistributedExecutionRolloutMap
//                                                       server/src/config/distributed-execution-rollout-source.ts
//   encodeEnrollmentTicket     ← encodeEnrollmentTicket  packages/worker-daemon/src/enrollment/ticket.ts
//   CANARY_EXECUTION_TARGET_SLUG ← the same constant     server/src/services/canary-credential-binding.ts
//   verdict-json line          ← main()                  server/src/cli/verify-e7-1-distributed-run.ts
// -----------------------------------------------------------------------------

/** The per-org slug every canary Organization's `dedicated_worker` target must carry (E11-F008). */
export const CANARY_EXECUTION_TARGET_SLUG = "aoa-canary-e2b";

/** The F10 minimum: at least two ENABLED Organizations and exactly one CONTROL that is not. */
export const MIN_ENABLED_ORGANIZATIONS = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TICKET_CODE_RE = /^aoa_enr_[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{32,128}$/;

// --- the tenant set (F10) ------------------------------------------------------

/**
 * The rollout policy the job injects on EVERY control-plane replica: each enabled
 * Organization in `canary` for the `batch` workload from the `task_run` sink — the ONLY
 * state `run-execution-owner` accepts (`active`/`shadow` return `rollout_not_canary`, SK-2).
 * The control Organization is ABSENT, which the parser reads as `off`.
 */
export function buildRolloutPolicy(enabledOrganizationIds) {
  const organizations = {};
  for (const id of enabledOrganizationIds) {
    organizations[id] = { mode: "canary", workloads: ["batch"], sources: ["task_run"] };
  }
  return JSON.stringify({ organizations });
}

/**
 * Assert that a rollout VALUE (the string a control-plane replica actually holds) seeds exactly
 * the declared tenant set. Returns violations; empty = the set is right. Used twice by the lane:
 * against the rendered compose (every replica) and against each RUNNING replica's environment.
 */
export function evaluateTenantRollout(rolloutValue, { enabled, control }) {
  const v = [];
  const enabledSet = new Set(enabled ?? []);
  if (enabledSet.size < MIN_ENABLED_ORGANIZATIONS) {
    v.push(`F10 needs at least ${MIN_ENABLED_ORGANIZATIONS} enabled Organizations; the declared set has ${enabledSet.size}`);
  }
  if (!control) v.push("F10 needs a control Organization; none was declared");
  if (control && enabledSet.has(control)) v.push(`the control Organization ${control} is also declared enabled`);
  for (const id of [...enabledSet, ...(control ? [control] : [])]) {
    if (!UUID_RE.test(String(id))) v.push(`Organization id ${JSON.stringify(id)} is not a UUID`);
  }

  let parsed;
  try {
    parsed = JSON.parse(String(rolloutValue ?? ""));
  } catch {
    v.push("the rollout value is not valid JSON (the control plane would fail CLOSED to legacy for every Organization)");
    return { violations: v };
  }
  const orgs = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.organizations : undefined;
  if (!orgs || typeof orgs !== "object" || Array.isArray(orgs)) {
    v.push("the rollout value has no `organizations` object (every Organization would be off)");
    return { violations: v };
  }
  for (const id of enabledSet) {
    const entry = orgs[id];
    if (!entry) {
      v.push(`enabled Organization ${id} is absent from the rollout (it would run legacy)`);
      continue;
    }
    if (entry.mode !== "canary") v.push(`enabled Organization ${id} is in mode ${JSON.stringify(entry.mode)}, not "canary" (SK-2)`);
    const workloads = Array.isArray(entry.workloads) ? entry.workloads : [];
    if (!workloads.includes("batch") && !workloads.includes("*")) v.push(`enabled Organization ${id} does not enable the "batch" workload`);
    if (entry.sources !== undefined) {
      const sources = Array.isArray(entry.sources) ? entry.sources : [];
      if (!sources.includes("task_run") && !sources.includes("*")) v.push(`enabled Organization ${id} does not enable the "task_run" source`);
    }
  }
  if (control && Object.prototype.hasOwnProperty.call(orgs, control)) {
    v.push(`the control Organization ${control} is PRESENT in the rollout (mode ${JSON.stringify(orgs[control]?.mode)}); it must be absent = off`);
  }
  for (const id of Object.keys(orgs)) {
    if (!enabledSet.has(id) && id !== control) v.push(`the rollout names an undeclared Organization ${id}`);
  }
  return { violations: v };
}

// --- the deployment-wide switches that must be OFF ---------------------------------

/**
 * `parseBooleanEnv` semantics exactly: unset/blank = the default (off); 1/true/yes/on = on;
 * 0/false/no/off = off; anything else THROWS, as the control plane does at boot.
 */
export function parseRolloutBoolean(name, raw) {
  const value = raw === undefined || raw === null ? "" : String(raw).trim().toLowerCase();
  if (!value) return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name}=${JSON.stringify(raw)} is not a boolean flag`);
}

/** S0-8 + the M1a freeze checklist: the crew switch and the tool surface are OFF. */
export const MUST_BE_OFF_FLAGS = [
  "AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED",
  "AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED",
];

/** Violations for one control-plane replica's environment (a plain `{KEY: value}` map). */
export function evaluateMustBeOffFlags(env) {
  const v = [];
  for (const name of MUST_BE_OFF_FLAGS) {
    try {
      if (parseRolloutBoolean(name, env?.[name])) v.push(`${name} is ON (${JSON.stringify(env[name])}); it must be unset or false`);
    } catch (error) {
      v.push(`${name} is unparseable (${JSON.stringify(env?.[name])}); the control plane would refuse to boot`);
    }
  }
  return { violations: v };
}

/** `KEY=value` lines (as `docker inspect … .Config.Env` prints them) → a map. */
export function envLinesToMap(lines) {
  const out = {};
  for (const line of String(lines ?? "").split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

// --- enrolment -----------------------------------------------------------------------

/** The `aoa_tkt_` ticket the worker daemon decodes: base64url(JSON {v,targetId,code}), fixed
 * key order. Validates first — a malformed ticket should fail HERE, not after a 10-minute code
 * has been minted and the worker has crash-looped on it. */
export function encodeEnrollmentTicket({ targetId, code }) {
  if (!UUID_RE.test(String(targetId))) throw new Error("enrolment ticket: targetId is not a UUID");
  if (!TICKET_CODE_RE.test(String(code))) throw new Error("enrolment ticket: code is not an aoa_enr_ code");
  const body = Buffer.from(JSON.stringify({ v: 1, targetId, code }), "utf8").toString("base64url");
  if (body.length > 512) throw new Error("enrolment ticket: body exceeds 512 characters");
  return `aoa_tkt_${body}`;
}

// --- the ratified target profile (runbook §7(b)) -------------------------------------

/** The provider-constraint profile WITHOUT its digest (the digest is computed in the
 * control-plane container with `canonicalProviderConstraintProfileDigestInputV1`, the same
 * canonicalizer the server re-derives with). All eight core operations are mandatory. */
export function providerConstraintProfileUnsigned() {
  return {
    profileId: "m1-shipped-boot-e2b",
    version: 1,
    maxContinuousRuntimeSeconds: 3600,
    maxIdleSeconds: 300,
    resourceCeiling: { cpuMillis: 2000, memoryMiB: 4096, pids: 512, diskMiB: 8192 },
    maxConcurrentOperations: 8,
    supportedOperations: ["create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup"],
    localityTags: ["transfer_allowed"],
    checkpointMode: "none",
    healthMode: "none",
  };
}

export function registeredTargetProfile({ targetId, organizationId, provider, deviceGeneration, policyHash }) {
  return {
    protocolVersion: 1,
    targetId,
    targetClass: "organization_dedicated",
    scope: "organization",
    organizationId,
    ownerPrincipalId: null,
    trustCeiling: "organization_isolated",
    credentialCeiling: "none",
    dataLocalityCeiling: "transfer_allowed",
    providerConstraints: { profileId: provider.profileId, version: provider.version, digest: provider.digest },
    capabilityCeiling: ["workload.batch", "sandbox.process_isolated"],
    deviceGeneration,
    revokedAt: null,
    policyHash,
  };
}

// --- the verdict -----------------------------------------------------------------------

/** The machine line `verify-e7-1-distributed-run` prints: `verdict-json: {…}`. */
export function parseVerifierVerdict(stdout) {
  const line = String(stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("verdict-json: "));
  if (!line) return null;
  try {
    return JSON.parse(line.slice("verdict-json: ".length));
  } catch {
    return null;
  }
}

/**
 * The per-tenant outcome. An ENABLED tenant passes only on a distributed run the verifier
 * corroborated (exit 0, `ok: true`); `capabilityProven=false` is acceptable for M1a and is
 * recorded, not judged. The CONTROL tenant passes only when its run stayed legacy — no owner,
 * no distributed ids — AND its Organization has zero jobs: refused, not merely slow.
 */
export function classifyTenantOutcome({ role, run, jobsForOrganization, verifierExit, verdict, rolloutResolution }) {
  const reasons = [];
  if (!run) {
    reasons.push("no heartbeat run was found for the tenant's task");
    return { pass: false, reasons };
  }
  if (role === "enabled") {
    if (run.execution_owner !== "distributed") reasons.push(`execution_owner is ${JSON.stringify(run.execution_owner)}, not "distributed"`);
    if (!run.distributed_job_id || !run.distributed_attempt_id) reasons.push("the run carries no distributed job/attempt id");
    if (verifierExit !== 0) reasons.push(`the verifier exited ${verifierExit} (0 = mechanism corroborated)`);
    if (!verdict || verdict.ok !== true) reasons.push("the verifier's verdict-json is missing or not ok");
    if (rolloutResolution && rolloutResolution.rolloutState !== "canary") {
      reasons.push(`the control plane logged rolloutState ${JSON.stringify(rolloutResolution.rolloutState)} for an enabled tenant's run`);
    }
  } else if (role === "control") {
    if (run.execution_owner !== null && run.execution_owner !== undefined) reasons.push(`the control run has execution_owner ${JSON.stringify(run.execution_owner)}`);
    if (run.distributed_job_id || run.distributed_attempt_id) reasons.push("the control run carries a distributed job/attempt id");
    if (Number(jobsForOrganization) !== 0) reasons.push(`the control Organization has ${jobsForOrganization} distributed job(s); it must have none`);
    // Refused for the RIGHT reason: the control plane itself resolved the rollout `off` for this
    // run. A legacy run for any other reason (a dead worker, a stale preflight) is not a control.
    if (rolloutResolution?.rolloutState !== "off") {
      reasons.push(`the control plane did not log rolloutState "off" for the control run (got ${JSON.stringify(rolloutResolution?.rolloutState ?? null)})`);
    }
  } else {
    reasons.push(`unknown tenant role ${JSON.stringify(role)}`);
  }
  return { pass: reasons.length === 0, reasons };
}

// --- provider-sandbox evidence (runbook §11) ------------------------------------------------

/**
 * The shape of a REAL E2B sandbox id, measured at source (2026-09-21):
 * - The e2b SDK (`e2b@2.30.5`) passes the server's `sandboxID` through opaquely
 *   (`sandboxId: res.data.sandboxID`). It then embeds it in a DNS label, `${port}-${sandboxId}.${domain}`
 *   (`ConnectionConfig.getHost`), so a real id is a lowercase DNS-safe token.
 * - Keyed run 35613849443 observed `ir2yj6bc4zh81x258k47b` and `i1pbzfz6n7y4wb3q5k616`:
 *   21 characters, `[a-z0-9]`.
 * - Neither the adapter-manager nor the E2B provider reshapes the id.
 *
 * Every test double emits a HYPHENATED id, and this shape rejects all of them:
 * - the D1 fake provider: `${providerId}-res-${n}` (`packages/sandbox-fake-provider/src/fake-driver.ts`);
 * - the keyless mock transport: `sbx-000001` (`packages/sandbox-e2b-provider/src/mock-transport.ts`).
 *
 * So a fake provider can never satisfy the §11 check.
 */
export const E2B_SANDBOX_ID_SHAPE = /^[a-z0-9]{16,32}$/;

/**
 * One worker log line → `{ sandboxId, leaseId }`, or null when the line names no sandbox.
 *
 * The worker logs through pino, so a real line is JSON: `{"leaseId":"…","sandboxId":"…",…}`. It
 * may carry the `docker compose logs` prefix (`svc-1  | `) and a `--timestamps` stamp. A
 * `sandboxId=<id>` text form (with an optional `leaseId=<id>`) is accepted too, in case a logger
 * emits one. The original driver matched ONLY that text form, which a JSON log never contains;
 * that is why keyed run 35613849443 failed the lane with both tenants' verifier at exit 0.
 */
export function parseSandboxLogLine(line) {
  const text = String(line ?? "");
  const brace = text.indexOf("{");
  if (brace !== -1) {
    try {
      const record = JSON.parse(text.slice(brace));
      if (record && typeof record === "object" && typeof record.sandboxId === "string") {
        return { sandboxId: record.sandboxId, leaseId: typeof record.leaseId === "string" ? record.leaseId : null };
      }
    } catch {
      // not a JSON record; fall through to the text form
    }
  }
  const sandbox = /\bsandboxId=([^\s,;"']+)/.exec(text);
  if (!sandbox) return null;
  const lease = /\bleaseId=([^\s,;"']+)/.exec(text);
  return { sandboxId: sandbox[1], leaseId: lease ? lease[1] : null };
}

/**
 * Provider-sandbox evidence for ONE tenant, from that tenant's own worker log.
 *
 * An id counts only when BOTH hold:
 * - it has the real E2B shape; and
 * - if the line carries a `leaseId`, that lease is one of `leaseIds`: the leases of THIS tenant's
 *   run attempt, read from `leases.attempt_id`.
 *
 * The worker's `supervisor: run complete` line carries the lease id (measured on run
 * 35613849443), so the scoping is by lease, not only by which worker logged it. A line that
 * carries no lease id is scoped by the worker alone: one worker per tenant, enrolled on that
 * tenant's own target.
 *
 * Returns `{ count, sandboxIds, rejected: { shape, foreignLease } }`.
 */
export function extractSandboxEvidence(logText, { leaseIds = [] } = {}) {
  const allowed = new Set(leaseIds);
  const sandboxIds = new Set();
  const rejected = { shape: 0, foreignLease: 0 };
  for (const line of String(logText ?? "").split(/\r?\n/)) {
    const parsed = parseSandboxLogLine(line);
    if (!parsed) continue;
    if (!E2B_SANDBOX_ID_SHAPE.test(parsed.sandboxId)) {
      rejected.shape += 1;
      continue;
    }
    if (parsed.leaseId !== null && !allowed.has(parsed.leaseId)) {
      rejected.foreignLease += 1;
      continue;
    }
    sandboxIds.add(parsed.sandboxId);
  }
  return { count: sandboxIds.size, sandboxIds: [...sandboxIds], rejected };
}

// --- the pre-upload leak scan ---------------------------------------------------------------

/**
 * The HARD check that runs before the evidence bundle is uploaded (ruled in under F2 after the
 * distinct review of DEP-015). Redaction is a transformation; this is a verification of its
 * result. Every job secret is searched for, in every evidence file, in three forms:
 *   - raw;
 *   - standard base64;
 *   - base64url.
 * A secret split across a log line's wrap is out of reach; so is one transformed in some other
 * way. The scan is for the ways a secret actually leaks: printed, or encoded once.
 *
 * `files` is `[{ name, text }]`; `secrets` is `{ NAME: value }`. Returns
 * `[{ file, secret, form }]`, naming the SECRET BY ITS NAME and never by its value. A finding
 * therefore cannot re-leak through the check's own output.
 */
export function scanEvidenceForSecrets(files, secrets) {
  const findings = [];
  for (const [secretName, value] of Object.entries(secrets ?? {})) {
    if (typeof value !== "string" || value.length < 8) continue;
    const bytes = Buffer.from(value, "utf8");
    const forms = [
      ["raw", value],
      ["base64", bytes.toString("base64")],
      ["base64url", bytes.toString("base64url")],
    ];
    for (const file of files ?? []) {
      for (const [form, needle] of forms) {
        // A base64 form ends in padding the surrounding text may not repeat; match its unpadded stem.
        const stem = form === "raw" ? needle : needle.replace(/=+$/, "");
        if (stem.length >= 8 && String(file.text).includes(stem)) {
          findings.push({ file: file.name, secret: secretName, form });
          break;
        }
      }
    }
  }
  return findings;
}

// --- key material, on any surface ------------------------------------------------------------

/**
 * Markers for the CONTROL-PLANE KEYPAIR in every encoding it can appear in. These are SHAPES, not
 * values: they catch a key this job did not generate (a re-run's, an operator's) and a key whose
 * exact bytes the scanner was never told, which `scanEvidenceForSecrets` by construction cannot.
 *
 * The DER prefixes are the fixed ed25519 algorithm headers, and they are what review batch 3A
 * (PR #569) measured both surfaces of run `35619555883` against:
 *   - SPKI (public):  `MCowBQYDK2VwAyEA`
 *   - PKCS#8 (private): `MC4CAQAwBQYDK2VwBCIEI`
 */
export const KEY_MATERIAL_MARKERS = Object.freeze([
  { marker: "pem_private", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { marker: "pem_public", pattern: /-----BEGIN [A-Z0-9 ]*PUBLIC KEY-----/ },
  { marker: "ed25519_spki_der", pattern: /MCowBQYDK2VwAyEA/ },
  { marker: "ed25519_pkcs8_der", pattern: /MC4CAQAwBQYDK2VwBCIEI/ },
]);

/** The one line class a scan of the JOB LOG must skip: the masking directive itself carries the
 * value, and GitHub renders it as `***`. Skipped lines are COUNTED and reported, so the exception
 * can never hide an unbounded number of raw values. */
export const MASK_DIRECTIVE_PREFIX = "::add-mask::";

/**
 * Key material in any of `files` (`[{ name, text }]`). Returns `[{ file, marker, line }]` — the
 * marker NAME and the 1-based line number, never the matched text. `skipMaskDirectives` (default
 * true) skips `::add-mask::` lines and returns how many were skipped.
 */
export function scanForKeyMaterial(files, { skipMaskDirectives = true } = {}) {
  const findings = [];
  let maskDirectiveLines = 0;
  for (const file of files ?? []) {
    const lines = String(file.text ?? "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith(MASK_DIRECTIVE_PREFIX)) {
        maskDirectiveLines += 1;
        if (skipMaskDirectives) continue;
      }
      for (const { marker, pattern } of KEY_MATERIAL_MARKERS) {
        if (pattern.test(line)) findings.push({ file: file.name, marker, line: i + 1 });
      }
    }
  }
  return { findings, maskDirectiveLines };
}

// --- redaction ---------------------------------------------------------------------------

/** Replace every occurrence of every secret value (length >= 8) with a fixed marker. Applied to
 * every log the lane retains; the secrets are the job-generated ones plus the two keyed ones. */
export function redactSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets ?? []) {
    if (typeof secret !== "string" || secret.length < 8) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

// --- the control plane's own account of the rollout decision -------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * The `[CLI-006] rollout resolved` record for ONE run, from a control plane's log. The heartbeat
 * logs it for every run that reaches the seam (`rolloutState`, `rolloutOrganizationId`), so it is
 * the control plane's own statement of WHY a run did or did not go distributed — for the control
 * tenant, `off` is the refusal the lane is testing, and anything else is a refusal for some other
 * reason. Reads both the pretty (multi-line, ANSI) and the JSON (one-line) logger formats.
 * Returns `{ rolloutState, rolloutOrganizationId }` or null.
 */
export function extractRolloutResolution(logText, runId) {
  // `docker compose logs` prefixes every line with `<container> | ` unless `--no-log-prefix`.
  const lines = String(logText ?? "")
    .replace(ANSI_RE, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\w.-]+\s+\|\s?/, ""));
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("[CLI-006] rollout resolved")) continue;
    if (line.trim().startsWith("{")) {
      try {
        const rec = JSON.parse(line.trim());
        if (rec.runId === runId) return { rolloutState: rec.rolloutState ?? null, rolloutOrganizationId: rec.rolloutOrganizationId ?? null };
      } catch { /* not JSON */ }
      continue;
    }
    const fields = {};
    for (let j = i + 1; j < lines.length && /^\s+\w+:/.test(lines[j]); j += 1) {
      const m = /^\s+(\w+):\s*"?([^"]*)"?\s*$/.exec(lines[j]);
      if (m) fields[m[1]] = m[2];
    }
    if (fields.runId === runId) return { rolloutState: fields.rolloutState ?? null, rolloutOrganizationId: fields.rolloutOrganizationId ?? null };
  }
  return null;
}

// --- DEP-017 — the live env-absence probe's evidence ----------------------------------------
//
// The probe runs INSIDE each distributed sandbox as a worker supervisor step
// (`packages/worker-daemon/src/supervisor/env-probe.ts`, armed by `AOA_WORKER_ENV_PROBE=1` on the
// shipped-boot workers) and emits its summary as ONE `system` log event on the attempt, through the
// run's canary scrub. The journey reads that event back from `job_events` and judges it here.
// These two constants MIRROR the daemon's (a script cannot import the worker package); the unit
// test pins the mirror against the daemon's source text.

/** The log-event message prefix the worker emits (`ENV_PROBE_LOG_PREFIX`). */
export const ENV_PROBE_LOG_PREFIX = "dep017.env_probe ";
/** The public marker every planted canary carries (`ENV_PROBE_CANARY_MARKER`). */
export const ENV_PROBE_CANARY_MARKER = "aoa-dep017-canary.";

/**
 * EVERY class the probe must report as checked — the whole §9-derived taxonomy, the two
 * name/value heuristics, and the two worker-derived classes. Mirrors the daemon's
 * `envProbeCheckedClasses()` plus `ENV_PROBE_UNREDEEMED`; the unit test pins the mirror against the
 * daemon's source, so a class added or dropped there without updating this list reds.
 *
 * ★ Why the FULL set and not "non-empty" (Codex P2, PR #565): a drifted or partially replaced probe
 * could report a short list, still detect the classes the planted control exercises, and pass — a
 * gate that observed a fraction of what it claims to observe.
 */
export const ENV_PROBE_EXPECTED_CLASSES = Object.freeze([
  "datastore_credential",
  "secrets_master_key",
  "auth_signing_secret",
  "source_control_token",
  "subscription_login",
  "provider_control_key",
  "object_store_credential",
  "worker_enrollment",
  "oauth_client_secret",
  "connector_token",
  "embeddings_key",
  "legacy_agent_key",
  "host_control_plane_env",
  "model_provider_key_not_allowed",
  "unclassified_credential_shaped",
  "cross_tenant_credential",
  "provider_credential_value_mismatch",
  "unredeemed_provider_credential",
]);

/**
 * A planted per-tenant credential canary: `<marker><organizationId>.<class>.<random>`. The journey
 * saves one as each tenant's own model-provider key (a REAL secret in that tenant's store), so
 * every OTHER tenant's sandbox must not see it — the probe's `cross_tenant_credential` class
 * fires on a marked value whose Organization is not the run's own.
 */
export function plantedTenantCanary(organizationId, providerClass, randomTail) {
  if (!/^[0-9a-f-]{36}$/i.test(String(organizationId))) throw new Error("plantedTenantCanary: organizationId must be a uuid");
  if (!/^[a-z_]+$/.test(String(providerClass))) throw new Error("plantedTenantCanary: class must be a token");
  if (!/^[A-Za-z0-9_-]{16,}$/.test(String(randomTail))) throw new Error("plantedTenantCanary: the random tail must be >= 16 url-safe characters");
  return `${ENV_PROBE_CANARY_MARKER}${organizationId}.${providerClass}.${randomTail}`;
}

/** The LAST probe summary among an attempt's log-event messages, or null (no probe ran). */
export function extractEnvProbeSummary(messages) {
  let found = null;
  for (const message of messages ?? []) {
    const text = String(message ?? "");
    if (!text.startsWith(ENV_PROBE_LOG_PREFIX)) continue;
    try {
      found = JSON.parse(text.slice(ENV_PROBE_LOG_PREFIX.length));
    } catch {
      found = { unreadable: true };
    }
  }
  return found;
}

/**
 * Judge one enabled tenant's probe evidence. PASS only when ALL hold:
 *  - a summary exists (a probe that did not run fails — a check that runs nothing is not a check);
 *  - verdict `absent` with an EMPTY `present` list;
 *  - the report names the classes it checked, including `cross_tenant_credential` (F10);
 *  - the in-sandbox planted control turned red (the probe could see).
 * The metadata observation is RECORDED (the DE-08 residual) and never judged: DE-08 leaves H-06
 * unmet, and nothing here claims egress enforcement.
 */
export function evaluateEnvProbeEvidence(summary) {
  const reasons = [];
  if (summary === null || summary === undefined) {
    return {
      pass: false,
      reasons: ["no DEP-017 env-probe summary on this attempt (the probe did not run; AOA_WORKER_ENV_PROBE unset, or an older worker)"],
      observed: null,
    };
  }
  if (summary.unreadable) return { pass: false, reasons: ["the DEP-017 env-probe summary is unreadable"], observed: null };
  const clean = summary.clean ?? null;
  const checked = Array.isArray(clean?.checked) ? clean.checked : [];
  const present = Array.isArray(clean?.present) ? clean.present : null;
  if (summary.verdict !== "absent") reasons.push(`env-probe verdict is ${JSON.stringify(summary.verdict)}${summary.reason ? ` (${summary.reason})` : ""}, not "absent"`);
  if (present === null) reasons.push("env-probe report has no present list");
  else if (present.length > 0) reasons.push(`credential classes PRESENT in the sandbox: ${present.join(", ")} (names: ${(clean.presentNames ?? []).join(", ")})`);
  // SET EQUALITY, both directions (Codex P2, second round): a MISSING class is a gate observing
  // less than it claims, and an UNEXPECTED one is a taxonomy drift the record would not show.
  const missing = ENV_PROBE_EXPECTED_CLASSES.filter((c) => !checked.includes(c));
  const unexpected = checked.filter((c) => !ENV_PROBE_EXPECTED_CLASSES.includes(c));
  if (checked.length === 0) reasons.push("env-probe report names no checked classes");
  else if (missing.length > 0) reasons.push(`env-probe did not check ${missing.length} expected class(es): ${missing.join(", ")}`);
  if (unexpected.length > 0) {
    reasons.push(`env-probe reported ${unexpected.length} unexpected checked class(es): ${unexpected.join(", ")} (the lane mirror and the worker list have drifted)`);
  }
  if (summary.plantedControl?.red !== true) reasons.push("the planted-canary control did not turn red (the probe could not see)");
  const metadata = clean?.metadata ?? null;
  return {
    pass: reasons.length === 0,
    reasons,
    observed: {
      verdict: summary.verdict ?? null,
      checked,
      present: present ?? [],
      presentNames: clean?.presentNames ?? [],
      allowedPresent: clean?.allowedPresent ?? [],
      allowedMismatch: clean?.allowedMismatch ?? [],
      redeemedNames: clean?.redeemedNames ?? [],
      plantedControl: summary.plantedControl ?? null,
      de08MetadataResidual: metadata
        ? {
            attempted: metadata.attempted === true,
            target: metadata.target ?? null,
            reachable: typeof metadata.reachable === "boolean" ? metadata.reachable : null,
            httpStatus: Number.isInteger(metadata.httpStatus) ? metadata.httpStatus : null,
            errorCode: metadata.errorCode ?? null,
            note: "OBSERVED, not enforced: DE-08 is an accepted residual that leaves H-06 unmet; this is a record, not a claim.",
          }
        : null,
    },
  };
}
