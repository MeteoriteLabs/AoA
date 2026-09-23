/**
 * DEP-017 — the live env-absence probe on the distributed stage-in path (criterion 5, ruling F9).
 *
 * WHAT IT MEASURES. After the control plane's input is staged into a REAL distributed sandbox and
 * the run's credentials are redeemed (`synthesiseRunSecrets`), this module runs a small probe
 * INSIDE that sandbox, through the run's own effect authority, with EXACTLY the env the tenant
 * command is given (`spec.env`). The probe reads its own process environment and reports which
 * credential CLASSES are present — names and classes only, never a value. The allow-list unit
 * tests (`buildSandboxEnvAllowlist`, the interlock test) check what is BUILT; this checks what a
 * sandbox OBSERVES: the template's baked env, the provider's own env, and the redeemed env, all at
 * once, on the lane that actually ran.
 *
 * WHY IT LIVES IN THE WORKER (the recorded choice — DEP-017-result.md §2). The only channel that
 * executes anything inside a distributed sandbox is the supervisor's `effect.execute`, and the
 * only runs whose envelopes carry credential handles are the control plane's task runs. A harness-
 * submitted job (`POST …/jobs`) carries no secret handles, so it would not exercise the stage-in
 * path at all; a separate keyed step that creates its own E2B sandbox would measure a sandbox the
 * product never built. So the probe runs as a supervisor step, composed ONLY when the worker is
 * started with `AOA_WORKER_ENV_PROBE=1` — which only the DEP-015 shipped-boot overlay sets. Off,
 * the supervisor is byte-identical.
 *
 * THE POSITIVE CONTROL RUNS EVERY TIME. A probe that cannot see is indistinguishable from a clean
 * environment, so each probe is followed by a PLANTED run in the same sandbox: the same env plus
 * two canaries — an infrastructure credential (`DATABASE_URL`) and ANOTHER TENANT's model-provider
 * key (an allowed NAME carrying a foreign Organization's canary, which only the value marker can
 * catch). If the planted run does not turn red for both, the probe is BLIND and the attempt fails.
 * The planted values are random per run and are pushed into the run's canary array BEFORE the
 * planted execute, so any echo of them is scrubbed (acceptance 3).
 *
 * FAIL CLOSED. Any present class, a probe that did not run, an unreadable report, or a blind
 * control fails the attempt with a named `errorCode`; the summary is emitted as a `system` log
 * event (through the run's canary scrub) BEFORE the terminal, so the evidence survives a failure.
 *
 * NOT AN EGRESS CLAIM. The probe also OBSERVES whether the metadata endpoint `169.254.169.254`
 * answers (the DE-08 residual, E8-F003). It records reachability and an HTTP status only — never a
 * body — and it never judges it: DE-08 leaves H-06 unmet and this probe does not change that.
 *
 * Runtime imports: relative modules only (the E4-D01 boundary).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createRunOutputCapture } from "./run-output.js";
import type { ExecuteInput, ExecuteResult } from "./provider.js";

/** The report line prefix the in-sandbox probe prints, and the log-event message prefix. */
export const ENV_PROBE_REPORT_PREFIX = "DEP017_ENV_PROBE ";
export const ENV_PROBE_LOG_PREFIX = "dep017.env_probe ";
export const ENV_PROBE_VERSION = "dep017-env-absence/v1";

/** The public, NON-secret marker every planted canary carries: `<marker><orgId>.<class>.<random>`.
 * The probe reports that a marked value is present (and whether its Organization is foreign),
 * never the value, never the random tail, never the Organization id. */
export const ENV_PROBE_CANARY_MARKER = "aoa-dep017-canary.";

/** The DE-08 residual the probe observes (never enforces). */
export const ENV_PROBE_METADATA_URL = "http://169.254.169.254/";

/** One credential class of the §9 taxonomy (docs/aoa/plans/2026-08-05-cloud-execution-isolation-e2b-spec.md)
 * plus the distributed path's own infrastructure secrets. Exact `names` first, then `patterns`
 * (anchored regex sources over the NAME). The first matching class wins, in table order. */
export interface EnvProbeCredentialClass {
  readonly class: string;
  readonly names: readonly string[];
  readonly patterns: readonly string[];
}

export const ENV_PROBE_CREDENTIAL_CLASSES: readonly EnvProbeCredentialClass[] = Object.freeze([
  {
    class: "datastore_credential",
    names: ["DATABASE_URL", "DIRECT_DATABASE_URL", "AOA_APP_DATABASE_URL", "AOA_OPERATOR_DATABASE_URL", "REDIS_URL", "PGPASSWORD", "POSTGRES_PASSWORD", "AOA_APP_DB_PASSWORD", "AOA_OPERATOR_DB_PASSWORD"],
    patterns: ["DATABASE_URL$", "_DSN$", "REDIS_URL$", "^PGPASS", "DB_PASSWORD$", "POSTGRES_PASSWORD$"],
  },
  { class: "secrets_master_key", names: ["AOA_SECRETS_MASTER_KEY", "PAPERCLIP_SECRETS_MASTER_KEY"], patterns: ["SECRETS_MASTER_KEY"] },
  {
    class: "auth_signing_secret",
    names: ["BETTER_AUTH_SECRET", "AOA_AGENT_JWT_SECRET", "PAPERCLIP_AGENT_JWT_SECRET", "AOA_WORKER_SESSION_SIGNING_KEY", "AOA_ADAPTER_MANAGER_TRUTH_SHARED_SECRET"],
    patterns: ["JWT_SECRET$", "SIGNING_KEY", "AUTH_SECRET$", "SHARED_SECRET$"],
  },
  { class: "source_control_token", names: ["GITHUB_PAT", "GITHUB_TOKEN", "GH_TOKEN", "GITLAB_TOKEN"], patterns: ["^GITHUB_(PAT|TOKEN)$", "_PAT$"] },
  { class: "subscription_login", names: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"], patterns: ["OAUTH_TOKEN$", "OAUTH_REFRESH"] },
  { class: "provider_control_key", names: ["E2B_API_KEY", "E2B_ACCESS_TOKEN"], patterns: ["^E2B_.*(KEY|TOKEN)$"] },
  {
    class: "object_store_credential",
    names: ["AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SESSION_TOKEN", "MINIO_ROOT_PASSWORD"],
    patterns: ["^AWS_(SECRET|SESSION|ACCESS)", "^MINIO_ROOT_"],
  },
  { class: "worker_enrollment", names: ["AOA_WORKER_ENROLLMENT_CODE"], patterns: ["ENROLLMENT_CODE"] },
  { class: "oauth_client_secret", names: ["GOOGLE_CLIENT_SECRET"], patterns: ["CLIENT_SECRET$"] },
  { class: "connector_token", names: [], patterns: ["^AOA_MCP_.*_TOKEN$"] },
  { class: "embeddings_key", names: [], patterns: ["EMBEDDING.*KEY"] },
  { class: "legacy_agent_key", names: ["PAPERCLIP_API_KEY"], patterns: ["^PAPERCLIP_"] },
  { class: "host_control_plane_env", names: [], patterns: ["^AOA_"] },
  { class: "model_provider_key_not_allowed", names: [], patterns: ["_API_KEY$"] },
]);

/** Classes the probe derives from a VALUE, not a name. A marked value whose Organization is the
 * run's OWN is not a value finding: under the §9 taxonomy a tenant's own runtime credential MAY
 * enter its sandbox, and a marked value under a forbidden NAME is caught by that name's class. */
export const ENV_PROBE_VALUE_CLASSES = Object.freeze({
  /** A marked value whose Organization is not the run's own — another tenant's credential,
   * whatever NAME it rides under (an allowed name included: only the value can tell). */
  crossTenant: "cross_tenant_credential",
} as const);

/** A credential-shaped NAME outside every named class (and outside the allow-list). */
export const ENV_PROBE_UNCLASSIFIED = "unclassified_credential_shaped";
export const ENV_PROBE_UNCLASSIFIED_PATTERN = "(^|_)(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|SESSION_?KEY)(_|$)";

/** Derived by the WORKER (not the probe): an allowed provider-auth NAME present in the sandbox that
 * this run did not redeem — so it came from the template, the provider or a host, not the tenant. */
export const ENV_PROBE_UNREDEEMED = "unredeemed_provider_credential";

/**
 * An allowed provider-auth NAME whose observed VALUE is not the one THIS WORKER REDEEMED for this
 * run: a provider default, a template-baked key, or anything that substituted the value between
 * redemption and the sandbox.
 *
 * ★ WHAT IT CANNOT SEE, stated so the record cannot be misread (Codex P1, second round): the
 * expectation is anchored on the redeemed value itself, so a control-plane MIS-RESOLUTION — a
 * redemption that returned another company’s credential — defines its own expectation and passes
 * this check. What catches that today is the per-tenant canary MARKER (a tenant-distinct value,
 * caught under ANY name); closing it in general needs an expectation minted OUTSIDE the worker (a
 * company-scoped value fingerprint on the resolve reply — a server and wire change) or a genuinely
 * tenant-distinct credential per tenant in the lane. Recorded in DEP-017-result.md section 8.
 */
export const ENV_PROBE_VALUE_MISMATCH = "provider_credential_value_mismatch";

/** Every class name the probe checks, in report order. */
export function envProbeCheckedClasses(): string[] {
  return [
    ...ENV_PROBE_CREDENTIAL_CLASSES.map((c) => c.class),
    ENV_PROBE_UNCLASSIFIED,
    ENV_PROBE_VALUE_CLASSES.crossTenant,
    ENV_PROBE_VALUE_MISMATCH,
  ];
}

/**
 * The in-sandbox probe, as the exact bytes `node -e` runs. argv:
 * `<ownOrganizationId> <allowedCsv> <metadataUrl or ""> <salt> <expectedDigestsJson>`.
 *
 * ★ THE VALUE-IDENTITY CHECK (Codex P1, PR #565). A NAME being expected is not the same as the
 * VALUE being the one this run redeemed: a resolver mix-up, a provider-precedence bug or a
 * host/foreign key baked into the template would sit under exactly the right name. So the worker
 * hands the probe a PER-RUN random salt and `sha256(salt + expectedValue)` for each name it
 * redeemed, and the probe reports, by NAME only, which allowed names hold a value that is NOT the
 * expected one. Nothing derived is printed: the report carries names and a class, never a digest
 * and never a value, and the salted digest itself is only ever handed INTO the sandbox that
 * already holds the plaintext, so it discloses nothing the sandbox did not have. It prints ONE line, `DEP017_ENV_PROBE {json}`, and exits 0; the verdict is
 * the worker's. It touches a value only to test it for the canary marker. No single quotes, so the
 * shell-quoted argv the E2B transport builds (`shellJoin`) carries it verbatim.
 */
export const ENV_PROBE_SCRIPT = [
  `const CLASSES=${JSON.stringify(ENV_PROBE_CREDENTIAL_CLASSES)};`,
  `const MARK=${JSON.stringify(ENV_PROBE_CANARY_MARKER)};`,
  `const UNCLASSIFIED=new RegExp(${JSON.stringify(ENV_PROBE_UNCLASSIFIED_PATTERN)},"i");`,
  `const CHECKED=${JSON.stringify(envProbeCheckedClasses())};`,
  "const argv=process.argv.slice(1);",
  "const own=String(argv[0]||\"\");",
  "const allowed=new Set(String(argv[1]||\"\").split(\",\").filter(Boolean));",
  "const metaUrl=String(argv[2]||\"\");",
  "const salt=String(argv[3]||\"\");",
  "let expected={};try{expected=JSON.parse(String(argv[4]||\"{}\"));}catch{expected={};}",
  "const crypto=require(\"node:crypto\");",
  "const digest=(v)=>crypto.createHash(\"sha256\").update(salt+v).digest(\"hex\");",
  "const present=new Set(),names=new Set(),allowedPresent=new Set(),allowedMismatch=new Set();",
  "let envCount=0,unnamed=0,unreported=0;",
  "const compiled=CLASSES.map((c)=>({cls:c.class,names:new Set(c.names),res:c.patterns.map((p)=>new RegExp(p))}));",
  // ★ THE ONLY NAMES THAT MAY BE SERIALIZED (Codex P2, 7th round). An env NAME is
  // sandbox-controlled data: `SECRET_sk_live_ABC123` is a legal POSIX name, matches the
  // credential-shape heuristic, and — unlike a redeemed VALUE — is not in the run canaries, so
  // nothing downstream would scrub it. The report therefore carries a name ONLY when the
  // canonical form is one this table already knows, and it carries THAT canonical token rather
  // than the sandbox's spelling. Everything else is a class plus a count.
  "const KNOWN=new Set([].concat(...CLASSES.map((c)=>c.names),[...allowed]));",
  // CASE- AND SEPARATOR-INSENSITIVE matching (Codex P2, 5th + 6th rounds): env names are
  // case-sensitive to the OS, so a lowercase `github_token` is a DIFFERENT variable from the
  // allow-listed one and must still be classified. The class table is written in the canonical
  // upper-snake form, so the key is normalised to it: every non-alphanumeric run folds to ONE `_`,
  // leading/trailing separators are dropped, and the result is upper-cased. That covers the whole
  // separator class at once (`DATABASE--URL`, `github.token`, `_AWS_SECRET_ACCESS_KEY_`), not the
  // one spelling that prompted it. The REPORT still carries the name exactly as the sandbox held it.
  "const canonical=(n)=>n.replace(/[^A-Za-z0-9_]/g,\"_\").replace(/_+/g,\"_\").replace(/^_|_$/g,\"\").toUpperCase();",
  "for(const [name,value] of Object.entries(process.env)){",
  " envCount++;",
  " const posix=/^[A-Za-z_][A-Za-z0-9_]*$/.test(name);",
  " if(!posix)unnamed++;",
  " const v=String(value==null?\"\":value);",
  " const key=canonical(name);",
  // ONE name policy for EVERY arm (Codex P2, 8th round): the cross-tenant arm fires on a VALUE and
  // so can land on any name the sandbox chose. It reports through the same known-token gate as the
  // taxonomy arm below - a known canonical token, or a count.
  " const report=()=>{if(KNOWN.has(key))names.add(key);else unreported++;};",
  " const at=v.indexOf(MARK);",
  " if(at>=0){const org=v.slice(at+MARK.length).split(\".\")[0];",
  "  if(org!==own){present.add(\"cross_tenant_credential\");report();}}",
  " if(posix&&allowed.has(name)){allowedPresent.add(name);",
  "  if(Object.prototype.hasOwnProperty.call(expected,name)&&expected[name]!==digest(v))allowedMismatch.add(name);",
  "  continue;}",
  " const hit=compiled.find((c)=>c.names.has(key)||c.res.some((r)=>r.test(key)));",
  " const cls=hit?hit.cls:(UNCLASSIFIED.test(key)?\"unclassified_credential_shaped\":null);",
  " if(cls===null)continue;",
  " present.add(cls);",
  " report();",
  "}",
  "const out=(metadata)=>{console.log(" + JSON.stringify(ENV_PROBE_REPORT_PREFIX) + "+JSON.stringify({probe:" +
    JSON.stringify(ENV_PROBE_VERSION) +
    ",checked:CHECKED,present:[...present].sort(),presentNames:[...names].sort(),allowedPresent:[...allowedPresent].sort(),allowedMismatch:[...allowedMismatch].sort(),envCount,unnamedEnvCount:unnamed,unreportedPresentCount:unreported,metadata}));};",
  "if(!metaUrl){out({attempted:false});}else{",
  " let host=\"invalid\";try{host=new URL(metaUrl).host;}catch{}",
  " const ac=new AbortController();const t=setTimeout(()=>ac.abort(),3000);",
  " fetch(metaUrl,{redirect:\"manual\",signal:ac.signal})",
  "  .then((r)=>{clearTimeout(t);try{r.body&&r.body.cancel();}catch{}out({attempted:true,target:host,reachable:true,httpStatus:r.status});})",
  "  .catch((e)=>{clearTimeout(t);let c=e,code=null;for(let i=0;i<5&&c;i++){if(c.code){code=String(c.code);break;}c=c.cause;}",
  "   out({attempted:true,target:host,reachable:false,errorCode:code||String(e&&e.name||\"error\")});});",
  "}",
].join("\n");

/** The probe's report (the `{checked, present}` interface of the task, plus the observation). */
export interface EnvProbeReport {
  readonly probe: string;
  readonly checked: readonly string[];
  readonly present: readonly string[];
  readonly presentNames: readonly string[];
  readonly allowedPresent: readonly string[];
  /** Allowed NAMES whose observed value is not the one this run redeemed (Codex P1). */
  readonly allowedMismatch: readonly string[];
  readonly envCount: number;
  readonly unnamedEnvCount: number;
  /** Credential-shaped env names the probe did NOT serialize, because their canonical form is not
   * in its own table — counted, never named. An env NAME is sandbox-controlled data and, unlike a
   * redeemed value, is not in the run canaries, so nothing downstream would scrub it (Codex P2,
   * 4th + 7th rounds). `presentNames` therefore only ever carries the probe's own tokens. */
  readonly unreportedPresentCount: number;
  readonly metadata: {
    readonly attempted: boolean;
    readonly target?: string;
    readonly reachable?: boolean;
    readonly httpStatus?: number;
    readonly errorCode?: string;
  };
}

/** The exit code the `sh` wrapper uses when the sandbox image carries no `node`, so the cause is
 * NAMED rather than surfacing as an anonymous non-zero exit. 78 is `EX_CONFIG` (`sysexits.h`), the
 * same code CLI-008's staged-input guard uses for "the sandbox is not what this run needs". */
export const ENV_PROBE_NO_NODE_EXIT_CODE = 78;

/** What the wrapper prints on stderr when there is no `node`. */
export const ENV_PROBE_NO_NODE_MARKER = "DEP017_PROBE_NO_NODE";

/**
 * The `sh -c` wrapper: run the probe under `node` when the image has one, and NAME the cause when
 * it does not. `$0` is the probe source, `$@` its arguments — nothing is interpolated into the
 * wrapper, so no argument can close a quote and append a command.
 */
export const ENV_PROBE_SH_WRAPPER =
  `if command -v node >/dev/null 2>&1; then exec node -e "$0" "$@"; ` +
  `else echo ${ENV_PROBE_NO_NODE_MARKER} >&2; exit ${ENV_PROBE_NO_NODE_EXIT_CODE}; fi`;

export interface EnvProbeInvocationInput {
  readonly ownOrganizationId: string;
  readonly allowedNames: readonly string[];
  /** The metadata endpoint to OBSERVE, or null to skip (the planted control skips it). */
  readonly metadataUrl: string | null;
  /** The per-run salt for the value-identity digests (Codex P1). */
  readonly salt: string;
  /** `NAME -> sha256(salt + expectedValue)` for every credential THIS run redeemed. */
  readonly expectedDigests: Readonly<Record<string, string>>;
}

/** `NAME -> sha256(salt + value)` over the env this run redeemed — what the probe compares the
 * OBSERVED value against. Never printed by the probe; see the script's header. */
export function envProbeExpectedDigests(env: Readonly<Record<string, string>>, salt: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    out[name] = createHash("sha256").update(salt + value).digest("hex");
  }
  return out;
}

/** The `node` argv the probe runs under. */
export function envProbeNodeArgs(input: EnvProbeInvocationInput): string[] {
  return [
    "-e",
    ENV_PROBE_SCRIPT,
    input.ownOrganizationId,
    [...input.allowedNames].join(","),
    input.metadataUrl ?? "",
    input.salt,
    JSON.stringify(input.expectedDigests),
  ];
}

/** Build the probe's `ExecuteInput` fields (command/args): the `sh` wrapper over the node argv. */
export function buildEnvProbeInvocation(input: EnvProbeInvocationInput): { command: string; args: string[] } {
  return { command: "sh", args: ["-c", ENV_PROBE_SH_WRAPPER, ...envProbeNodeArgs(input).slice(1)] };
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CLASS_RE = /^[a-z_]+$/;

function isStringArray(value: unknown, re: RegExp): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && re.test(v));
}

/**
 * Parse the LAST report line out of a scrubbed stdout tail. Strict: every name must be a POSIX
 * name and every class a known token shape. A scrub marker, a truncated line or any extra shape
 * makes the report UNREADABLE (null) — which fails the run, never passes it.
 */
export function parseEnvProbeReport(stdoutTail: string): EnvProbeReport | null {
  const lines = String(stdoutTail ?? "").split(/\r?\n/).filter((l) => l.startsWith(ENV_PROBE_REPORT_PREFIX));
  const line = lines[lines.length - 1];
  if (line === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(ENV_PROBE_REPORT_PREFIX.length));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (r.probe !== ENV_PROBE_VERSION) return null;
  if (!isStringArray(r.checked, CLASS_RE) || !isStringArray(r.present, CLASS_RE)) return null;
  if (!isStringArray(r.presentNames, NAME_RE) || !isStringArray(r.allowedPresent, NAME_RE)) return null;
  if (!isStringArray(r.allowedMismatch, NAME_RE)) return null;
  if (!Number.isInteger(r.envCount) || !Number.isInteger(r.unnamedEnvCount)) return null;
  if (!Number.isInteger(r.unreportedPresentCount)) return null;
  const m = r.metadata;
  if (m === null || typeof m !== "object" || Array.isArray(m) || typeof (m as { attempted?: unknown }).attempted !== "boolean") return null;
  const meta = m as Record<string, unknown>;
  const metadata: EnvProbeReport["metadata"] = {
    attempted: meta.attempted as boolean,
    ...(typeof meta.target === "string" && /^[A-Za-z0-9.:[\]-]{1,255}$/.test(meta.target) ? { target: meta.target } : {}),
    ...(typeof meta.reachable === "boolean" ? { reachable: meta.reachable } : {}),
    ...(Number.isInteger(meta.httpStatus) ? { httpStatus: meta.httpStatus as number } : {}),
    ...(typeof meta.errorCode === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(meta.errorCode) ? { errorCode: meta.errorCode } : {}),
  };
  return {
    probe: ENV_PROBE_VERSION,
    checked: r.checked,
    present: r.present,
    presentNames: r.presentNames,
    allowedPresent: r.allowedPresent,
    allowedMismatch: r.allowedMismatch,
    envCount: r.envCount as number,
    unnamedEnvCount: r.unnamedEnvCount as number,
    unreportedPresentCount: r.unreportedPresentCount as number,
    metadata,
  };
}

/** The planted positive control: two canaries added to the run's env for the control execute. */
export interface PlantedControl {
  readonly env: Record<string, string>;
  /** The planted VALUES, to push into the run's canary array before the control executes. */
  readonly canaries: string[];
  /** NAME -> the class the probe must report for it. Names only; safe to log. */
  readonly expect: ReadonlyArray<{ readonly name: string; readonly expectClass: string }>;
}

export function buildPlantedControl(input: {
  readonly ownOrganizationId: string;
  /** The names this run redeemed. The FIRST is substituted with a foreign value, so the
   * value-identity arm carries its own positive control on every run (Codex P1). */
  readonly redeemedNames?: readonly string[];
  /** The allowed provider-auth names, so the cross-tenant plant can pick one that is NOT the
   * substituted name. Without it, a run redeeming only `OPENAI_API_KEY` collapses the two arms
   * onto one variable and the MARKER alone satisfies both, leaving the digest comparison
   * uncontrolled (Codex P2, second round). */
  readonly allowedNames?: readonly string[];
  readonly randomToken?: () => string;
  readonly foreignOrganizationId?: () => string;
}): PlantedControl {
  const token = input.randomToken ?? (() => randomBytes(24).toString("base64url"));
  const foreign = (input.foreignOrganizationId ?? randomUUID)();
  const redeemed = [...(input.redeemedNames ?? [])].sort();
  const allowed = input.allowedNames && input.allowedNames.length > 0 ? [...input.allowedNames] : ["OPENAI_API_KEY"];
  // The value-identity case goes on a name this run actually redeemed: there is otherwise no
  // expectation to violate, and a control that cannot fire must not be asserted.
  const substituted = redeemed[0];
  // The cross-tenant case goes on a DIFFERENT allowed name, preferring one this run did not
  // redeem, so neither plant can stand in for the other.
  const crossTenantName =
    allowed.find((n) => n !== substituted && !redeemed.includes(n)) ?? allowed.find((n) => n !== substituted) ?? "OPENAI_API_KEY";
  const infra = `${ENV_PROBE_CANARY_MARKER}${input.ownOrganizationId}.datastore_credential.${token()}`;
  const crossTenant = `${ENV_PROBE_CANARY_MARKER}${foreign}.model_provider.${token()}`;
  const env: Record<string, string> = { DATABASE_URL: infra, [crossTenantName]: crossTenant };
  const canaries = [infra, crossTenant];
  const expect = [
    { name: "DATABASE_URL", expectClass: "datastore_credential" },
    { name: crossTenantName, expectClass: ENV_PROBE_VALUE_CLASSES.crossTenant },
  ];
  if (substituted !== undefined) {
    // Carries NO marker and no credential-shaped name of its own: ONLY the digest comparison can
    // catch it, which is exactly the arm it controls.
    const foreignValue = `not-this-runs-credential-${token()}`;
    env[substituted] = foreignValue;
    canaries.push(foreignValue);
    expect.push({ name: substituted, expectClass: ENV_PROBE_VALUE_MISMATCH });
  }
  return { env, canaries, expect };
}

/** The default budget for EACH of the two probe executions. Small on purpose: the probe's time is
 * carved out of the run's own deadline (`supervisor.ts`), so a large budget would shorten the
 * tenant command rather than delay it. */
export const ENV_PROBE_DEFAULT_DEADLINE_MS = 20_000;

export type EnvProbeVerdict = "absent" | "present" | "blind" | "not_run";

/** The error code each failing verdict terminalizes the attempt with. */
export const ENV_PROBE_ERROR_CODES: Readonly<Record<Exclude<EnvProbeVerdict, "absent">, string>> = Object.freeze({
  present: "env_probe_credential_present",
  blind: "env_probe_blind",
  not_run: "env_probe_not_run",
});

export interface EnvProbeSummary {
  readonly probe: string;
  readonly verdict: EnvProbeVerdict;
  /** Why `not_run` (a bounded token), when it is. */
  readonly reason?: string;
  readonly clean: (EnvProbeReport & { readonly redeemedNames: readonly string[] }) | null;
  readonly plantedControl: {
    /** Each planted case, with whether the probe attributed its class to THAT variable. */
    readonly planted: ReadonlyArray<{ readonly name: string; readonly expectClass: string; readonly satisfied: boolean }>;
    readonly detected: readonly string[];
    readonly red: boolean;
  } | null;
}

/**
 * The verdict, from the two reports. `redeemedNames` are the env NAMES this run put in the sandbox
 * (`Object.keys(spec.env)`): an allowed name present but not redeemed is `unredeemed_provider_credential`.
 */
export function evaluateEnvProbe(input: {
  readonly clean: EnvProbeReport | null;
  readonly planted: EnvProbeReport | null;
  readonly redeemedNames: readonly string[];
  readonly control: PlantedControl;
  readonly notRunReason?: string;
}): EnvProbeSummary {
  const redeemed = new Set(input.redeemedNames);
  const clean = input.clean
    ? (() => {
        const unredeemed = input.clean.allowedPresent.filter((n) => !redeemed.has(n));
        const mismatched = [...input.clean.allowedMismatch];
        const present = [...new Set([
          ...input.clean.present,
          ...(unredeemed.length > 0 ? [ENV_PROBE_UNREDEEMED] : []),
          ...(mismatched.length > 0 ? [ENV_PROBE_VALUE_MISMATCH] : []),
        ])].sort();
        const presentNames = [...new Set([...input.clean.presentNames, ...unredeemed, ...mismatched])].sort();
        return {
          ...input.clean,
          checked: [...input.clean.checked, ENV_PROBE_UNREDEEMED],
          present,
          presentNames,
          redeemedNames: [...redeemed].sort(),
        };
      })()
    : null;
  // The planted report's `present` carries the probe's own classes; the value-identity class is
  // WORKER-derived (the probe reports names, the worker decides), so it must be folded in here too
  // or the control's mismatch arm could never be detected.
  const detected = input.planted
    ? [...new Set([
        ...input.planted.present,
        ...(input.planted.allowedMismatch.length > 0 ? [ENV_PROBE_VALUE_MISMATCH] : []),
      ])].sort()
    : [];
  // ★ EACH ARM IS BOUND TO ITS OWN VARIABLE (Codex P2, third round). Checking classes alone would
  // let a regression that flagged a DIFFERENT allowed credential satisfy the mismatch arm while the
  // deliberately substituted one went unnoticed — a control that is red for the wrong reason.
  const satisfied = input.control.expect.map((e) => {
    if (input.planted === null) return { ...e, satisfied: false };
    const named =
      e.expectClass === ENV_PROBE_VALUE_MISMATCH
        ? input.planted.allowedMismatch.includes(e.name)
        : input.planted.presentNames.includes(e.name);
    return { ...e, satisfied: named && detected.includes(e.expectClass) };
  });
  const red = input.planted !== null && satisfied.every((e) => e.satisfied);
  const plantedControl = { planted: satisfied, detected, red };
  const summary = (verdict: EnvProbeVerdict, reason?: string): EnvProbeSummary => ({
    probe: ENV_PROBE_VERSION,
    verdict,
    ...(reason ? { reason } : {}),
    clean,
    plantedControl: input.planted === null && input.clean === null ? null : plantedControl,
  });
  if (clean === null) return summary("not_run", input.notRunReason ?? "no_report");
  // ★ THE WHOLE TAXONOMY, not merely a non-empty list (Codex P2, PR #565). A drifted or partially
  // replaced probe could report a SHORT `checked` set, still detect the two classes the planted
  // control exercises, and pass — a gate that observed a fraction of what it claims. Set equality
  // against this build's own class list, fail closed on any difference.
  const expectedChecked = envProbeCheckedClasses();
  const reported = new Set(input.clean!.checked);
  if (reported.size !== expectedChecked.length || expectedChecked.some((c) => !reported.has(c))) {
    return summary("not_run", "checked_set_mismatch");
  }
  if (clean.present.length > 0) return summary("present");
  if (!red) return summary("blind", input.planted === null ? (input.notRunReason ?? "control_no_report") : "control_not_red");
  return summary("absent");
}

/** The log-event message carrying the summary (names and classes only). */
export function envProbeLogMessage(summary: EnvProbeSummary): string {
  return ENV_PROBE_LOG_PREFIX + JSON.stringify(summary);
}

/** A deadline race, injected by the supervisor so the probe shares its scheduler. */
export type WithDeadline = <T>(op: Promise<T>, deadlineMs: number) => Promise<T | symbol>;

/**
 * Run the probe and its planted control in ONE live sandbox and return the summary. Never throws:
 * every failure is a `not_run`/`blind` summary the supervisor terminalizes.
 */
export async function runEnvProbe(input: {
  readonly sandboxId: string;
  readonly env: Readonly<Record<string, string>>;
  readonly ownOrganizationId: string;
  readonly allowedNames: readonly string[];
  /** The run's LIVE canary array: the planted values are pushed into it before the control runs. */
  readonly runCanaries: string[];
  readonly execute: (input: ExecuteInput) => Promise<ExecuteResult>;
  readonly withDeadline: WithDeadline;
  readonly deadlineMs: number;
  /** The DE-08 residual to observe; defaults to {@link ENV_PROBE_METADATA_URL}. `null` skips it. */
  readonly metadataUrl?: string | null;
  readonly randomToken?: () => string;
  readonly foreignOrganizationId?: () => string;
}): Promise<EnvProbeSummary> {
  // ONE salt and ONE expectation map for BOTH executions: the planted execution substitutes a
  // redeemed value, so it must be judged against the ORIGINAL expectation or the control could
  // never fire.
  const salt = randomBytes(32).toString("base64url");
  const expectedDigests = envProbeExpectedDigests(input.env, salt);
  const control = buildPlantedControl({
    ownOrganizationId: input.ownOrganizationId,
    redeemedNames: Object.keys(input.env),
    allowedNames: input.allowedNames,
    ...(input.randomToken ? { randomToken: input.randomToken } : {}),
    ...(input.foreignOrganizationId ? { foreignOrganizationId: input.foreignOrganizationId } : {}),
  });
  const once = async (env: Readonly<Record<string, string>>, metadataUrl: string | null): Promise<{ report: EnvProbeReport | null; reason?: string }> => {
    const capture = createRunOutputCapture({ canaries: input.runCanaries });
    const invocation = buildEnvProbeInvocation({
      ownOrganizationId: input.ownOrganizationId,
      allowedNames: input.allowedNames,
      metadataUrl,
      salt,
      expectedDigests,
    });
    try {
      const raced = await input.withDeadline(
        input.execute({ sandboxId: input.sandboxId, command: invocation.command, args: invocation.args, env, onStdout: capture.onStdout }),
        input.deadlineMs,
      );
      const { stdoutTail } = capture.close();
      if (typeof raced === "symbol") return { report: null, reason: "probe_timeout" };
      if (raced.exitCode !== 0 || raced.timedOut) return { report: null, reason: "probe_exit_nonzero" };
      const report = parseEnvProbeReport(stdoutTail);
      return report ? { report } : { report: null, reason: "probe_report_unreadable" };
    } catch {
      capture.close();
      return { report: null, reason: "probe_execute_failed" };
    }
  };
  const clean = await once(input.env, input.metadataUrl === undefined ? ENV_PROBE_METADATA_URL : input.metadataUrl);
  if (clean.report === null) {
    return evaluateEnvProbe({ clean: null, planted: null, redeemedNames: Object.keys(input.env), control, notRunReason: clean.reason });
  }
  // Seed the planted values as canaries BEFORE they can reach any output (acceptance 3).
  input.runCanaries.push(...control.canaries);
  const planted = await once({ ...input.env, ...control.env }, null);
  return evaluateEnvProbe({
    clean: clean.report,
    planted: planted.report,
    redeemedNames: Object.keys(input.env),
    control,
    ...(planted.reason ? { notRunReason: planted.reason } : {}),
  });
}
