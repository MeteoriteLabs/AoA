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
