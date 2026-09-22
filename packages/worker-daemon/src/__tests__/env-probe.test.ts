import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { leaseOfferV1Schema, type WorkerEventV1 } from "@armyofagents/worker-protocol";

import { PROVIDER_AUTH_ENV_TARGETS } from "../lease/secret-redemption.js";
import type { LeaseHandoff } from "../poll/poll-loop.js";
import {
  ENV_PROBE_CANARY_MARKER,
  ENV_PROBE_CREDENTIAL_CLASSES,
  ENV_PROBE_ERROR_CODES,
  ENV_PROBE_LOG_PREFIX,
  ENV_PROBE_REPORT_PREFIX,
  ENV_PROBE_SCRIPT,
  ENV_PROBE_UNCLASSIFIED,
  ENV_PROBE_UNREDEEMED,
  ENV_PROBE_VALUE_CLASSES,
  buildEnvProbeInvocation,
  envProbeExpectedDigests,
  envProbeNodeArgs,
  ENV_PROBE_VALUE_MISMATCH,
  ENV_PROBE_SH_WRAPPER,
  ENV_PROBE_NO_NODE_EXIT_CODE,
  ENV_PROBE_NO_NODE_MARKER,
  buildPlantedControl,
  envProbeCheckedClasses,
  evaluateEnvProbe,
  parseEnvProbeReport,
  runEnvProbe,
  type EnvProbeReport,
  type EnvProbeSummary,
} from "../supervisor/env-probe.js";
import type { ExecuteInput, ExecuteResult, SandboxProvider } from "../supervisor/provider.js";
import { REDACTION_MARKER } from "../supervisor/redaction.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import { createMetrics, SANDBOX_OP_METRIC } from "../metrics/metrics.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { compatibleOffer } from "./support/poll-fixtures.js";
import { collectingSink, makeHandoff, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";

// -----------------------------------------------------------------------------
// DEP-017 — the live env-absence probe (criterion 5, ruling F9).
//
// ★ The probe tests EXECUTE THE REAL BYTES. `ENV_PROBE_SCRIPT` is exactly what `node -e` runs
// inside the sandbox; every "probe" test here spawns a real node process with a crafted env and
// reads what it printed. The supervisor tests route the probe's `execute` through a provider that
// does the same, so the whole chain — invocation → in-sandbox read → stdout channel → per-run
// scrub → report parse → verdict → `log` event → terminal — runs for real, keylessly.
// The live keyed observation (a real E2B sandbox) is the DEP-015 lane's, not this file's.
// -----------------------------------------------------------------------------

const ORG_A = "00000000-0000-4000-8000-00000000d0a1";
const ORG_B = "00000000-0000-4000-8000-00000000d0b1";
const ALLOWED = [...PROVIDER_AUTH_ENV_TARGETS];

/** The minimum a node process needs to start on this OS — the "template env" of a local run. */
function osBaseEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME"]) {
    const v = process.env[key];
    if (typeof v === "string") base[key] = v;
  }
  return base;
}

const SALT = "dep017-test-salt-0123456789";

/** The value-identity expectations handed to the probe. By default, the allowed names in `env`
 * exactly as they are — so a clean run reports no mismatch; pass `expectedEnv` to simulate a value
 * that is NOT the one the run redeemed. */
function digestsFor(env: Record<string, string>, expectedEnv?: Record<string, string>): Record<string, string> {
  const source = expectedEnv ?? env;
  return envProbeExpectedDigests(
    Object.fromEntries(Object.entries(source).filter(([n]) => ALLOWED.includes(n))),
    SALT,
  );
}

function runProbe(env: Record<string, string>, own = ORG_A, metadataUrl = "", expectedEnv?: Record<string, string>): { stdout: string; status: number | null; report: EnvProbeReport | null } {
  const args = envProbeNodeArgs({ ownOrganizationId: own, allowedNames: ALLOWED, metadataUrl: metadataUrl || null, salt: SALT, expectedDigests: digestsFor(env, expectedEnv) });
  const res = spawnSync(process.execPath, args, { env: { ...osBaseEnv(), ...env }, encoding: "utf8", timeout: 20_000 });
  return { stdout: res.stdout ?? "", status: res.status, report: parseEnvProbeReport(res.stdout ?? "") };
}

/** The same, asynchronously — the metadata test's server lives in THIS process, and a
 * `spawnSync` would block the event loop that has to answer it. */
async function runProbeAsync(env: Record<string, string>, own: string, metadataUrl: string): Promise<{ stdout: string; report: EnvProbeReport | null }> {
  const args = envProbeNodeArgs({ ownOrganizationId: own, allowedNames: ALLOWED, metadataUrl, salt: SALT, expectedDigests: digestsFor(env) });
  const child = spawn(process.execPath, args, { env: { ...osBaseEnv(), ...env } });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c: string) => { stdout += c; });
  await new Promise((resolve) => child.on("close", resolve));
  return { stdout, report: parseEnvProbeReport(stdout) };
}

const marked = (org: string, cls: string, tail = "Zq9vT3kLr8wYp2mN4bX6cJ1h") => `${ENV_PROBE_CANARY_MARKER}${org}.${cls}.${tail}`;

describe("DEP-017 — the in-sandbox probe script (real node execution)", () => {
  it("a clean env reports ABSENCE and names every class it checked", () => {
    const { status, report } = runProbe({ E2B_SANDBOX: "true", ANTHROPIC_API_KEY: "sk-ant-own-key-value-000000" });
    expect(status).toBe(0);
    expect(report).not.toBeNull();
    expect(report!.present).toEqual([]);
    expect(report!.presentNames).toEqual([]);
    expect(report!.allowedPresent).toEqual(["ANTHROPIC_API_KEY"]);
    expect(report!.checked).toEqual(envProbeCheckedClasses());
    // Every named taxonomy class, the name heuristic, and the cross-tenant value class.
    for (const c of ENV_PROBE_CREDENTIAL_CLASSES) expect(report!.checked).toContain(c.class);
    expect(report!.checked).toContain(ENV_PROBE_UNCLASSIFIED);
    expect(report!.checked).toContain(ENV_PROBE_VALUE_CLASSES.crossTenant);
    expect(report!.metadata).toEqual({ attempted: false });
  });

  // One representative NAME per class — the table is the taxonomy, so each row must fire.
  const perClass: Array<[string, string]> = [
    ["DATABASE_URL", "datastore_credential"],
    ["AOA_SECRETS_MASTER_KEY", "secrets_master_key"],
    ["BETTER_AUTH_SECRET", "auth_signing_secret"],
    ["GITHUB_PAT", "source_control_token"],
    ["CLAUDE_CODE_OAUTH_TOKEN", "subscription_login"],
    ["E2B_API_KEY", "provider_control_key"],
    ["AWS_SECRET_ACCESS_KEY", "object_store_credential"],
    ["AOA_WORKER_ENROLLMENT_CODE", "worker_enrollment"],
    ["GOOGLE_CLIENT_SECRET", "oauth_client_secret"],
    ["AOA_MCP_GITHUB_TOKEN", "connector_token"],
    ["AOA_EMBEDDINGS_API_KEY", "embeddings_key"],
    ["PAPERCLIP_API_KEY", "legacy_agent_key"],
    ["AOA_STORAGE_S3_ENDPOINT", "host_control_plane_env"],
    ["GEMINI_API_KEY", "model_provider_key_not_allowed"],
    ["SOME_VENDOR_PASSWORD", ENV_PROBE_UNCLASSIFIED],
  ];
  it.each(perClass)("POSITIVE CONTROL: a planted %s turns the probe red as class %s", (name, cls) => {
    const { report } = runProbe({ [name]: `planted-${name}-value-9f8e7d6c5b4a` });
    expect(report!.present).toEqual([cls]);
    expect(report!.presentNames).toEqual([name]);
  });

  it("covers every class in the table (no class is untested)", () => {
    const tested = new Set(perClass.map(([, c]) => c));
    for (const c of ENV_PROBE_CREDENTIAL_CLASSES) expect(tested.has(c.class)).toBe(true);
  });

  it("never prints a value — only names and classes", () => {
    const values = {
      DATABASE_URL: "postgres://aoa:SuperSecretPw123@db:5432/aoa",
      E2B_API_KEY: "e2b_live_key_abcdef0123456789",
      ANTHROPIC_API_KEY: "sk-ant-api03-own-key-abcdef",
      OPENAI_API_KEY: marked(ORG_B, "model_provider"),
    };
    const { stdout, report } = runProbe(values);
    expect(report!.present.sort()).toEqual(["cross_tenant_credential", "datastore_credential", "provider_control_key"]);
    for (const v of Object.values(values)) expect(stdout).not.toContain(v);
    expect(stdout).not.toContain("Zq9vT3kLr8wYp2mN4bX6cJ1h"); // the canary's random tail
    expect(stdout).not.toContain(ORG_B); // not even the foreign Organization's id
  });

  it("CROSS-TENANT: another tenant's credential under an ALLOWED name is caught by value, the tenant's own is not", () => {
    const foreign = runProbe({ ANTHROPIC_API_KEY: marked(ORG_B, "model_provider") }, ORG_A);
    expect(foreign.report!.present).toEqual([ENV_PROBE_VALUE_CLASSES.crossTenant]);
    expect(foreign.report!.presentNames).toEqual(["ANTHROPIC_API_KEY"]);
    // Same-tenant positive control: the SAME value, run as its own Organization, is allowed.
    const own = runProbe({ ANTHROPIC_API_KEY: marked(ORG_B, "model_provider") }, ORG_B);
    expect(own.report!.present).toEqual([]);
    expect(own.report!.allowedPresent).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("VALUE IDENTITY: an allowed name holding a value this run did NOT redeem is reported by NAME (Codex P1)", () => {
    const redeemed = { ANTHROPIC_API_KEY: "sk-ant-the-runs-own-key-0001" };
    // The sandbox holds a DIFFERENT value under the right name — a resolver mix-up, a provider
    // precedence bug, or a host/foreign key baked into the template. No marker, no odd name:
    // only the digest comparison can see it.
    const observed = { ANTHROPIC_API_KEY: "sk-ant-somebody-elses-key-9999" };
    const { stdout, report } = runProbe(observed, ORG_A, "", redeemed);
    expect(report!.allowedMismatch).toEqual(["ANTHROPIC_API_KEY"]);
    expect(report!.allowedPresent).toEqual(["ANTHROPIC_API_KEY"]);
    expect(report!.present).toEqual([]); // the CLASS is the worker's call, from this name list
    // Nothing derived is printed: no value, and no digest.
    for (const v of [...Object.values(observed), ...Object.values(redeemed)]) expect(stdout).not.toContain(v);
    expect(stdout).not.toContain(SALT);
    expect(/[0-9a-f]{32}/.test(stdout)).toBe(false);
  });

  it("VALUE IDENTITY: the value this run DID redeem is not a mismatch (the same-value control)", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-the-runs-own-key-0001" };
    expect(runProbe(env).report!.allowedMismatch).toEqual([]);
  });

  it("POSITIVE CONTROL: a credential under a legal NON-POSIX name is classified and COUNTED, never named (Codex P2, 4th round)", () => {
    const { stdout, report } = runProbe({ "GITHUB-TOKEN": "ghp_not_a_posix_name_0001", "DATABASE-URL": "postgres://u:p@h/db" });
    expect(report!.present.sort()).toEqual(["datastore_credential", "source_control_token"]);
    expect(report!.unnamedPresentCount).toBe(2);
    expect(report!.presentNames).toEqual([]); // only POSIX names may ride the report
    expect(stdout).not.toContain("ghp_not_a_posix_name_0001");
    expect(stdout).not.toContain("GITHUB-TOKEN");
  });

  it("POSITIVE CONTROL: a lowercase or mixed-case credential name is classified too (Codex P2, 5th round)", () => {
    const { report } = runProbe({ github_token: "ghp_lowercase_0001", "Database-Url": "postgres://u:p@h/db", anthropic_api_key: "sk-ant-not-the-allow-listed-name" });
    // `anthropic_api_key` is a DIFFERENT variable from the allow-listed `ANTHROPIC_API_KEY`, so it
    // is classified rather than waved through as "the tenant's own key".
    expect(report!.present.sort()).toEqual(["datastore_credential", "model_provider_key_not_allowed", "source_control_token"]);
    expect(report!.allowedPresent).toEqual([]);
  });

  it("POSITIVE CONTROL: the whole separator class is folded, not one spelling (Codex P2, 6th round)", () => {
    // Repeated, mixed and edge separators, each a legal process-environment name.
    const { report } = runProbe({
      "DATABASE--URL": "postgres://u:p@h/db",
      "github..token": "ghp_0002",
      "_AWS_SECRET_ACCESS_KEY_": "aws-0003",
      "E2B.API-KEY": "e2b-0004",
    });
    expect(report!.present.sort()).toEqual([
      "datastore_credential",
      "object_store_credential",
      "provider_control_key",
      "source_control_token",
    ]);
    // `_AWS_SECRET_ACCESS_KEY_` is a legal POSIX name, so it is NAMED; the other three are counted.
    expect(report!.presentNames).toEqual(["_AWS_SECRET_ACCESS_KEY_"]);
    expect(report!.unnamedPresentCount).toBe(3);
  });

  it("a name that merely CONTAINS a keyword is not credential-shaped (TOKENIZERS_PARALLELISM)", () => {
    expect(runProbe({ TOKENIZERS_PARALLELISM: "false", E2B_SANDBOX_ID: "abc" }).report!.present).toEqual([]);
  });

  it("is invoked as `sh -c <wrapper> <script> <own> <allowed> <metadata>`", () => {
    const inv = buildEnvProbeInvocation({ ownOrganizationId: ORG_A, allowedNames: ALLOWED, metadataUrl: null, salt: SALT, expectedDigests: { ANTHROPIC_API_KEY: "abc" } });
    expect(inv.command).toBe("sh");
    expect(inv.args[0]).toBe("-c");
    expect(inv.args[1]).toBe(ENV_PROBE_SH_WRAPPER);
    expect(inv.args[2]).toBe(ENV_PROBE_SCRIPT);
    expect(inv.args.slice(3)).toEqual([ORG_A, ALLOWED.join(","), "", SALT, JSON.stringify({ ANTHROPIC_API_KEY: "abc" })]);
  });

  // The wrapper is what the sandbox's shell actually runs. Executed for real wherever `sh` exists
  // (always on the Linux `verify` shard; skipped on a Windows dev box with no `sh` on PATH).
  const shPath = spawnSync(process.platform === "win32" ? "where" : "which", ["sh"], { encoding: "utf8" });
  const hasSh = shPath.status === 0 && String(shPath.stdout).trim() !== "";
  const itSh = hasSh ? it : it.skip;

  itSh("the sh wrapper runs the probe under node and yields the same report", () => {
    const inv = buildEnvProbeInvocation({ ownOrganizationId: ORG_A, allowedNames: ALLOWED, metadataUrl: null, salt: SALT, expectedDigests: {} });
    const nodeDir = process.execPath.slice(0, Math.max(process.execPath.lastIndexOf("/"), process.execPath.lastIndexOf("\\")));
    const env = { ...osBaseEnv(), DATABASE_URL: "postgres://u:p@h/db" };
    env.PATH = `${nodeDir}${process.platform === "win32" ? ";" : ":"}${env.PATH ?? env.Path ?? ""}`;
    const res = spawnSync("sh", inv.args, { env, encoding: "utf8", timeout: 20_000 });
    expect(res.status).toBe(0);
    expect(parseEnvProbeReport(res.stdout ?? "")!.present).toEqual(["datastore_credential"]);
  });

  itSh("POSITIVE CONTROL: an image with no node NAMES the cause and exits 78 (never a silent pass)", () => {
    const inv = buildEnvProbeInvocation({ ownOrganizationId: ORG_A, allowedNames: ALLOWED, metadataUrl: null, salt: SALT, expectedDigests: {} });
    // An empty PATH: `command -v node` finds nothing, and the wrapper says so.
    // `sh` by ABSOLUTE path: the empty PATH is what the wrapper's `command -v node` must see, and
    // it must not also stop the shell itself from being found.
    const sh = String(shPath.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]!;
    const res = spawnSync(sh, inv.args, { env: { PATH: "" }, encoding: "utf8", timeout: 20_000 });
    expect(res.status).toBe(ENV_PROBE_NO_NODE_EXIT_CODE);
    expect(`${res.stderr}`).toContain(ENV_PROBE_NO_NODE_MARKER);
    expect(parseEnvProbeReport(res.stdout ?? "")).toBeNull();
  });

  it("carries no single quote, so the E2B transport's shell-quoted argv delivers it verbatim", () => {
    expect(ENV_PROBE_SCRIPT.includes("'")).toBe(false);
    expect(ENV_PROBE_SH_WRAPPER.includes("'")).toBe(false);
    expect(ENV_PROBE_SCRIPT.startsWith("const CLASSES=")).toBe(true);
  });

  describe("the DE-08 metadata observation (records, never judges)", () => {
    let server: Server;
    let url = "";
    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.writeHead(418, { "content-type": "text/plain" });
        res.end("METADATA-BODY-MUST-NOT-BE-READ");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    });
    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("an answering endpoint is recorded reachable with its status and NO body", async () => {
      const { stdout, report } = await runProbeAsync({}, ORG_A, url);
      expect(report!.metadata).toMatchObject({ attempted: true, reachable: true, httpStatus: 418 });
      expect(stdout).not.toContain("METADATA-BODY");
      expect(report!.present).toEqual([]); // an observation, not a finding
    });

    it("a refusing endpoint is recorded unreachable with an error code", async () => {
      const { report } = await runProbeAsync({}, ORG_A, "http://127.0.0.1:1/");
      expect(report!.metadata.attempted).toBe(true);
      expect(report!.metadata.reachable).toBe(false);
      expect(typeof report!.metadata.errorCode).toBe("string");
    });
  });
});

describe("DEP-017 — parseEnvProbeReport is strict (an unreadable report fails, never passes)", () => {
  const good = (): Record<string, unknown> => ({
    probe: "dep017-env-absence/v1",
    checked: ["datastore_credential"],
    present: [],
    presentNames: [],
    allowedPresent: [],
    allowedMismatch: [],
    envCount: 3,
    unnamedEnvCount: 0,
    unnamedPresentCount: 0,
    metadata: { attempted: false },
  });
  const line = (o: unknown) => `${ENV_PROBE_REPORT_PREFIX}${JSON.stringify(o)}`;

  it("reads the LAST report line", () => {
    const later = { ...good(), present: ["datastore_credential"], presentNames: ["DATABASE_URL"] };
    expect(parseEnvProbeReport(`noise\n${line(good())}\n${line(later)}\n`)!.present).toEqual(["datastore_credential"]);
  });
  it("no report line → null", () => expect(parseEnvProbeReport("hello\n")).toBeNull());
  it("a scrub marker inside the report → null (a canary overlapped the report)", () => {
    expect(parseEnvProbeReport(line({ ...good(), presentNames: [REDACTION_MARKER] }))).toBeNull();
  });
  it("a wrong probe version → null", () => expect(parseEnvProbeReport(line({ ...good(), probe: "x" }))).toBeNull());
  it("a non-POSIX name → null", () => expect(parseEnvProbeReport(line({ ...good(), allowedPresent: ["A B"] }))).toBeNull());
  it("a truncated line → null", () => expect(parseEnvProbeReport(line(good()).slice(0, -3))).toBeNull());
});

describe("DEP-017 — evaluateEnvProbe (the verdict)", () => {
  const control = buildPlantedControl({ ownOrganizationId: ORG_A, randomToken: () => "tok", foreignOrganizationId: () => ORG_B });
  const report = (over: Partial<EnvProbeReport> = {}): EnvProbeReport => ({
    probe: "dep017-env-absence/v1",
    checked: envProbeCheckedClasses(),
    present: [],
    presentNames: [],
    allowedPresent: [],
    allowedMismatch: [],
    envCount: 1,
    unnamedEnvCount: 0,
    unnamedPresentCount: 0,
    metadata: { attempted: false },
    ...over,
  });
  // A planted report that satisfies EVERY arm, each attributed to its own planted variable.
  const red = report({
    present: ["cross_tenant_credential", "datastore_credential"],
    presentNames: control.expect.filter((e) => e.expectClass !== ENV_PROBE_VALUE_MISMATCH).map((e) => e.name),
    allowedMismatch: control.expect.filter((e) => e.expectClass === ENV_PROBE_VALUE_MISMATCH).map((e) => e.name),
  });

  it("absent: clean report + red control", () => {
    expect(evaluateEnvProbe({ clean: report(), planted: red, redeemedNames: [], control }).verdict).toBe("absent");
  });
  it("present: any class in the clean report", () => {
    expect(evaluateEnvProbe({ clean: report({ present: ["provider_control_key"] }), planted: red, redeemedNames: [], control }).verdict).toBe("present");
  });
  it("present: an allowed name in the sandbox that this run did NOT redeem (template/host-sourced)", () => {
    const s = evaluateEnvProbe({ clean: report({ allowedPresent: ["OPENAI_API_KEY"] }), planted: red, redeemedNames: ["ANTHROPIC_API_KEY"], control });
    expect(s.verdict).toBe("present");
    expect(s.clean!.present).toEqual([ENV_PROBE_UNREDEEMED]);
    expect(s.clean!.presentNames).toEqual(["OPENAI_API_KEY"]);
  });
  it("the redeemed key where the design says is allowed", () => {
    const s = evaluateEnvProbe({ clean: report({ allowedPresent: ["ANTHROPIC_API_KEY"] }), planted: red, redeemedNames: ["ANTHROPIC_API_KEY"], control });
    expect(s.verdict).toBe("absent");
  });
  it("blind: the control did not turn red for BOTH planted cases", () => {
    expect(evaluateEnvProbe({ clean: report(), planted: report({ present: ["datastore_credential"] }), redeemedNames: [], control }).verdict).toBe("blind");
    expect(evaluateEnvProbe({ clean: report(), planted: null, redeemedNames: [], control }).verdict).toBe("blind");
  });
  it("the control is red only when EACH arm is attributed to ITS OWN variable (Codex P2, third round)", () => {
    const control = buildPlantedControl({
      ownOrganizationId: ORG_A,
      redeemedNames: ["ANTHROPIC_API_KEY"],
      allowedNames: ALLOWED,
      randomToken: () => "tok0123456789abcdefghij",
      foreignOrganizationId: () => ORG_B,
    });
    const names = Object.fromEntries(control.expect.map((e) => [e.expectClass, e.name]));
    const plantedReport = (over: Partial<EnvProbeReport>): EnvProbeReport => ({
      probe: "dep017-env-absence/v1",
      checked: envProbeCheckedClasses(),
      present: ["cross_tenant_credential", "datastore_credential"],
      presentNames: ["DATABASE_URL", names[ENV_PROBE_VALUE_CLASSES.crossTenant]!],
      allowedPresent: [],
      allowedMismatch: [names[ENV_PROBE_VALUE_MISMATCH]!],
      envCount: 1,
      unnamedEnvCount: 0,
      unnamedPresentCount: 0,
    unnamedPresentCount: 0,
      metadata: { attempted: false },
      ...over,
    });
    const clean = plantedReport({ present: [], presentNames: [], allowedMismatch: [] });
    // Every class present and attributed to the planted variable -> red.
    expect(evaluateEnvProbe({ clean, planted: plantedReport({}), redeemedNames: ["ANTHROPIC_API_KEY"], control }).verdict).toBe("absent");
    // The SAME classes, but the mismatch attributed to a DIFFERENT allowed credential -> blind.
    const wrongVariable = plantedReport({ allowedMismatch: ["AOA_API_KEY"] });
    const s = evaluateEnvProbe({ clean, planted: wrongVariable, redeemedNames: ["ANTHROPIC_API_KEY"], control });
    expect(s.verdict).toBe("blind");
    expect(s.plantedControl!.planted.find((e) => e.expectClass === ENV_PROBE_VALUE_MISMATCH)!.satisfied).toBe(false);
    // ...and likewise for a name-class arm attributed to the wrong variable.
    const wrongName = plantedReport({ presentNames: ["SOMETHING_ELSE"] });
    expect(evaluateEnvProbe({ clean, planted: wrongName, redeemedNames: ["ANTHROPIC_API_KEY"], control }).verdict).toBe("blind");
  });

  it("not_run: no clean report, or a report that checked nothing", () => {
    expect(evaluateEnvProbe({ clean: null, planted: null, redeemedNames: [], control, notRunReason: "probe_timeout" })).toMatchObject({ verdict: "not_run", reason: "probe_timeout" });
    // A SHORT checked set is not a check either (Codex P2): set equality against this build's list.
    expect(evaluateEnvProbe({ clean: report({ checked: [] }), planted: red, redeemedNames: [], control })).toMatchObject({ verdict: "not_run", reason: "checked_set_mismatch" });
    expect(evaluateEnvProbe({
      clean: report({ checked: envProbeCheckedClasses().filter((c) => c !== "secrets_master_key") }),
      planted: red, redeemedNames: [], control,
    })).toMatchObject({ verdict: "not_run", reason: "checked_set_mismatch" });
  });
});

describe("DEP-017 — runEnvProbe scrubs the probe's output with the run's canaries (acceptance 3)", () => {
  it("a doctored probe that smuggles the redeemed key into a free-text field cannot carry it out", async () => {
    const secret = "sk-ant-api03-SMUGGLED-0123456789";
    const smuggling = (input: ExecuteInput): Promise<ExecuteResult> => {
      const planted = input.env.DATABASE_URL !== undefined;
      input.onStdout?.(`${ENV_PROBE_REPORT_PREFIX}${JSON.stringify({
        probe: "dep017-env-absence/v1",
        checked: envProbeCheckedClasses(),
        present: planted ? ["cross_tenant_credential", "datastore_credential"] : [],
        // Each arm attributed to its own planted variable (the control's cross-tenant plant lands
        // on an allowed name this run did NOT redeem, so it is not ANTHROPIC_API_KEY here).
        presentNames: planted ? ["DATABASE_URL", "OPENAI_API_KEY"] : [],
        allowedPresent: ["ANTHROPIC_API_KEY"],
        // The control also substitutes the redeemed value, so the planted run reports the mismatch.
        allowedMismatch: planted ? ["ANTHROPIC_API_KEY"] : [],
        envCount: 1,
        unnamedEnvCount: 0,
        unnamedPresentCount: 0,
      unnamedPresentCount: 0,
    unnamedPresentCount: 0,
        metadata: { attempted: true, target: secret, reachable: false, errorCode: "ECONNREFUSED" },
      })}\n`);
      return Promise.resolve({ providerOpId: "p", exitCode: 0, signal: null, timedOut: false, stdoutRef: "r", stderrRef: "r" });
    };
    const summary = await runEnvProbe({
      sandboxId: "sbx",
      env: { ANTHROPIC_API_KEY: secret },
      ownOrganizationId: ORG_A,
      allowedNames: ALLOWED,
      runCanaries: [secret],
      execute: smuggling,
      withDeadline: (op) => op,
      deadlineMs: 1000,
      metadataUrl: null,
    });
    expect(summary.verdict).toBe("absent");
    expect(JSON.stringify(summary)).not.toContain(secret);
  });
});

// --- the supervisor, end to end --------------------------------------------------------------

interface LocalExecOptions {
  /** The sandbox's own ("template") env, underneath the per-command env. */
  readonly templateEnv?: Record<string, string>;
  /** Replace the probe's execution entirely (a doctored probe). */
  readonly probeOverride?: (input: ExecuteInput) => Promise<ExecuteResult>;
  /** Echo every env VALUE to stdout before the report (a hostile probe; acceptance 3). */
  readonly echoValues?: boolean;
  /** Applied AFTER the run's env, as a template default or a provider would — the value-identity
   * case: the right NAME holding a value this run did not redeem. */
  readonly clobberEnv?: Record<string, string>;
}

/**
 * The fake provider, except that the probe's `node` execute RUNS the real probe bytes in a local
 * node process whose env is `templateEnv ⊕ input.env` — the same composition E2B applies
 * (sandbox env, then the command's `envs`). The tenant command stays on the fake (never spawned).
 */
function localExecProvider(opts: LocalExecOptions = {}) {
  const fake = createFakeSandboxProvider();
  const probeEnvs: Array<Record<string, string>> = [];
  /** Every execute's ctx budget, in order: probe, planted control, then the tenant command. */
  const deadlines: Array<{ kind: "probe" | "tenant"; deadlineMs: number }> = [];
  const provider: SandboxProvider = {
    ...fake,
    async execute(input: ExecuteInput, ctx): Promise<ExecuteResult> {
      if (input.command !== "sh") {
        deadlines.push({ kind: "tenant", deadlineMs: ctx.deadlineMs });
        return fake.execute(input, ctx);
      }
      deadlines.push({ kind: "probe", deadlineMs: ctx.deadlineMs });
      probeEnvs.push({ ...input.env });
      if (opts.probeOverride) return opts.probeOverride(input);
      const env = { ...osBaseEnv(), ...(opts.templateEnv ?? {}), ...input.env, ...(opts.clobberEnv ?? {}) };
      // The sandbox runs `sh -c <wrapper> <script> …`; locally we run what the wrapper would exec.
      const child = spawn(process.execPath, ["-e", ...(input.args as string[]).slice(2)], { env });
      if (opts.echoValues) for (const v of Object.values(input.env)) input.onStdout?.(`echo ${v}\n`);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => input.onStdout?.(chunk));
      const exitCode: number | null = await new Promise((resolve) => child.on("close", (code) => resolve(code)));
      return { providerOpId: `probe-${probeEnvs.length}`, exitCode, signal: null, timedOut: false, stdoutRef: "ref", stderrRef: "ref" };
    },
  };
  return { fake, provider, probeEnvs, deadlines };
}

function orgHandoff(organizationId: string, leaseSuffix: string): LeaseHandoff {
  const base = compatibleOffer({ leaseId: `00000000-0000-4000-8000-0000000000${leaseSuffix}` });
  const job = base.job as Record<string, unknown>;
  const offer = leaseOfferV1Schema.parse({ ...base, job: { ...job, organizationId } });
  return { offer, leaseId: String(offer.leaseId), fenceToken: String(offer.fenceToken), workloadClass: "batch" };
}

function probeLog(events: readonly WorkerEventV1[]): EnvProbeSummary | null {
  const log = events.find((e) => e.eventType === "log" && String((e.payload as { message?: string }).message).startsWith(ENV_PROBE_LOG_PREFIX));
  if (!log) return null;
  return JSON.parse(String((log.payload as { message: string }).message).slice(ENV_PROBE_LOG_PREFIX.length)) as EnvProbeSummary;
}

function terminal(events: readonly WorkerEventV1[]) {
  return events.find((e) => e.eventType === "terminal")?.payload as { status: string; errorCode: string | null } | undefined;
}

async function runSupervised(opts: {
  handoff?: LeaseHandoff;
  secrets?: Record<string, string>;
  local?: LocalExecOptions;
  composed?: boolean;
}) {
  const { fake, provider, probeEnvs, deadlines } = localExecProvider(opts.local);
  const sink = collectingSink();
  const secrets = opts.secrets ?? { ANTHROPIC_API_KEY: "sk-ant-api03-OWN-KEY-0123456789" };
  // ★ REAL metrics, not omitted. `emitOp` throws on a value outside the CLOSED allow-list, and
  // that throw escapes into `accept()`'s last-resort catch, which emits NO terminal — so a probe
  // step whose `operation` label was never registered would STRAND every probed run. Composing
  // the real metrics here is what makes these cases catch it (mutation M8).
  const metrics = createMetrics();
  const supervisor = createSupervisor({
    provider,
    identity: SUPERVISOR_IDENTITY,
    eventSink: sink,
    metrics,
    redactionCanaries: [],
    materializeRunSecrets: async () => ({ env: { ...secrets }, canaries: Object.values(secrets) }),
    ...(opts.composed === false ? {} : { envProbe: { metadataUrl: null } }),
  });
  const handoff = opts.handoff ?? makeHandoff();
  await supervisor.accept(handoff);
  const sandboxId = fake.calls().find((c) => c.op === "create")?.sandboxId;
  const tenantExecutions = sandboxId ? fake.executionsOf(sandboxId) : [];
  return { events: sink.events, probeEnvs, tenantExecutions, metrics, deadlines };
}

describe("DEP-017 - the planted control keeps its two arms on DIFFERENT variables (Codex P2, second round)", () => {
  it("a run that redeemed only OPENAI_API_KEY still gets a value-identity expectation", () => {
    const control = buildPlantedControl({
      ownOrganizationId: ORG_A,
      redeemedNames: ["OPENAI_API_KEY"],
      allowedNames: ALLOWED,
      randomToken: () => "tok0123456789abcdefghij",
      foreignOrganizationId: () => ORG_B,
    });
    const byClass = Object.fromEntries(control.expect.map((e) => [e.expectClass, e.name]));
    expect(byClass[ENV_PROBE_VALUE_MISMATCH]).toBe("OPENAI_API_KEY");
    // ...and the cross-tenant plant moved OFF that variable, so the marker cannot stand in for the
    // digest comparison (which is the collapse this case exists to prevent).
    expect(byClass[ENV_PROBE_VALUE_CLASSES.crossTenant]).not.toBe("OPENAI_API_KEY");
    expect(ALLOWED).toContain(byClass[ENV_PROBE_VALUE_CLASSES.crossTenant]);
  });

  it("an OPENAI-only run is judged ABSENT end to end (both control arms fire on real bytes)", async () => {
    const { events, tenantExecutions } = await runSupervised({ secrets: { OPENAI_API_KEY: "sk-openai-the-runs-own-0001" } });
    const s = probeLog(events)!;
    expect(s.verdict).toBe("absent");
    expect(s.plantedControl!.detected).toContain(ENV_PROBE_VALUE_MISMATCH);
    expect(s.plantedControl!.detected).toContain(ENV_PROBE_VALUE_CLASSES.crossTenant);
    expect(tenantExecutions).toHaveLength(1);
  });
});

describe("DEP-017 — the supervisor runs the probe inside the run's sandbox, fail closed", () => {
  it("clean: the probe runs with THIS run's env, reports absence (control red), and the tenant command runs", async () => {
    const { events, probeEnvs, tenantExecutions } = await runSupervised({});
    const s = probeLog(events)!;
    expect(s.verdict).toBe("absent");
    expect(s.clean!.present).toEqual([]);
    expect(s.clean!.allowedPresent).toEqual(["ANTHROPIC_API_KEY"]);
    expect(s.clean!.redeemedNames).toEqual(["ANTHROPIC_API_KEY"]);
    expect(s.plantedControl!.red).toBe(true);
    // The probe saw EXACTLY the run's redeemed env (then the env + the two planted canaries).
    expect(Object.keys(probeEnvs[0])).toEqual(["ANTHROPIC_API_KEY"]);
    expect(Object.keys(probeEnvs[1]).sort()).toEqual(["ANTHROPIC_API_KEY", "DATABASE_URL", "OPENAI_API_KEY"]);
    expect(tenantExecutions).toHaveLength(1);
    expect(terminal(events)!.status).toBe("succeeded");
    // Order: attempt_started < the probe log < terminal.
    const types = events.map((e) => e.eventType);
    expect(types.indexOf("attempt_started")).toBeLessThan(types.indexOf("log"));
    expect(types.indexOf("log")).toBeLessThan(types.indexOf("terminal"));
  });

  it("POSITIVE CONTROL: an infrastructure credential in the sandbox template turns the run RED before the tenant command", async () => {
    const { events, tenantExecutions } = await runSupervised({ local: { templateEnv: { E2B_API_KEY: "e2b_TEMPLATE_LEAK_0123456789" } } });
    const s = probeLog(events)!;
    expect(s.verdict).toBe("present");
    expect(s.clean!.present).toEqual(["provider_control_key"]);
    expect(s.clean!.presentNames).toEqual(["E2B_API_KEY"]);
    expect(terminal(events)).toMatchObject({ status: "failed", errorCode: ENV_PROBE_ERROR_CODES.present });
    expect(tenantExecutions).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("e2b_TEMPLATE_LEAK_0123456789");
  });

  it("POSITIVE CONTROL: a model-provider key the run did NOT redeem (host/template-sourced) turns it RED", async () => {
    const { events } = await runSupervised({ local: { templateEnv: { OPENAI_API_KEY: "sk-host-embeddings-key-00000000" } } });
    const s = probeLog(events)!;
    expect(s.verdict).toBe("present");
    expect(s.clean!.present).toEqual([ENV_PROBE_UNREDEEMED]);
    expect(JSON.stringify(events)).not.toContain("sk-host-embeddings-key-00000000");
  });

  it("POSITIVE CONTROL: a value the run did NOT redeem, under the RIGHT name, reds the run (Codex P1)", async () => {
    // `clobberEnv` is applied AFTER the run's env, exactly as a template or provider default would.
    const { events, tenantExecutions } = await runSupervised({
      secrets: { ANTHROPIC_API_KEY: "sk-ant-api03-THE-RUNS-OWN-000" },
      local: { clobberEnv: { ANTHROPIC_API_KEY: "sk-ant-api03-SOMEBODY-ELSES" } },
    });
    const s = probeLog(events)!;
    expect(s.verdict).toBe("present");
    expect(s.clean!.present).toEqual([ENV_PROBE_VALUE_MISMATCH]);
    expect(s.clean!.presentNames).toEqual(["ANTHROPIC_API_KEY"]);
    expect(terminal(events)).toMatchObject({ status: "failed", errorCode: ENV_PROBE_ERROR_CODES.present });
    expect(tenantExecutions).toHaveLength(0);
    const all = JSON.stringify(events);
    expect(all).not.toContain("sk-ant-api03-SOMEBODY-ELSES");
    expect(all).not.toContain("sk-ant-api03-THE-RUNS-OWN-000");
  });

  it("MULTI-TENANT (F10): another Organization's credential redeemed into this run is RED; the owner's own is not", async () => {
    const keyOfA = marked(ORG_A, "model_provider", "k3yOfTenantA0000000000000");
    // Same-tenant positive control: tenant A's key in tenant A's run.
    const a = await runSupervised({ handoff: orgHandoff(ORG_A, "a5"), secrets: { ANTHROPIC_API_KEY: keyOfA } });
    expect(probeLog(a.events)!.verdict).toBe("absent");
    expect(terminal(a.events)!.status).toBe("succeeded");
    // Cross-tenant: tenant A's key in tenant B's run.
    const b = await runSupervised({ handoff: orgHandoff(ORG_B, "b5"), secrets: { ANTHROPIC_API_KEY: keyOfA } });
    const s = probeLog(b.events)!;
    expect(s.verdict).toBe("present");
    expect(s.clean!.present).toEqual([ENV_PROBE_VALUE_CLASSES.crossTenant]);
    expect(terminal(b.events)).toMatchObject({ status: "failed", errorCode: ENV_PROBE_ERROR_CODES.present });
    const all = JSON.stringify(b.events);
    expect(all).not.toContain(keyOfA);
    expect(all).not.toContain(ORG_A); // tenant B's evidence never names tenant A
  });

  it("the probe's output passes the run's canary scrub before it leaves the worker (a probe that echoes every value)", async () => {
    const secret = "sk-ant-api03-ECHOED-KEY-abcdef0123";
    const { events } = await runSupervised({ secrets: { ANTHROPIC_API_KEY: secret }, local: { echoValues: true } });
    const s = probeLog(events)!;
    expect(s.verdict).toBe("absent");
    const all = JSON.stringify(events);
    expect(all).not.toContain(secret);
    expect(all).not.toContain(ENV_PROBE_CANARY_MARKER); // the planted values were scrubbed too
  });

  it("BLIND: a probe that reports nothing for the planted control fails the run (a check that sees nothing is not a check)", async () => {
    const emptyReport = `${ENV_PROBE_REPORT_PREFIX}${JSON.stringify({
      probe: "dep017-env-absence/v1", checked: envProbeCheckedClasses(), present: [], presentNames: [], allowedPresent: [], allowedMismatch: [],
      envCount: 1, unnamedEnvCount: 0, unnamedPresentCount: 0, metadata: { attempted: false },
    })}\n`;
    const { events, tenantExecutions } = await runSupervised({
      local: {
        probeOverride: async (input) => {
          input.onStdout?.(emptyReport);
          return { providerOpId: "p", exitCode: 0, signal: null, timedOut: false, stdoutRef: "r", stderrRef: "r" };
        },
      },
    });
    expect(probeLog(events)!.verdict).toBe("blind");
    expect(terminal(events)).toMatchObject({ status: "failed", errorCode: ENV_PROBE_ERROR_CODES.blind });
    expect(tenantExecutions).toHaveLength(0);
  });

  it("NOT RUN: a probe whose execute fails fails the run closed", async () => {
    const { events, tenantExecutions } = await runSupervised({
      local: { probeOverride: async () => { throw new Error("node: not found"); } },
    });
    expect(probeLog(events)).toMatchObject({ verdict: "not_run", reason: "probe_execute_failed" });
    expect(terminal(events)).toMatchObject({ status: "failed", errorCode: ENV_PROBE_ERROR_CODES.not_run });
    expect(tenantExecutions).toHaveLength(0);
  });

  it("NOT RUN: a probe that exits non-zero (e.g. no node in the template) fails the run closed", async () => {
    const { events } = await runSupervised({
      local: { probeOverride: async () => ({ providerOpId: "p", exitCode: 127, signal: null, timedOut: false, stdoutRef: "r", stderrRef: "r" }) },
    });
    expect(probeLog(events)).toMatchObject({ verdict: "not_run", reason: "probe_exit_nonzero" });
  });

  it("the `env_probe` metric label is REGISTERED — an unregistered one would strand the run with no terminal", async () => {
    const metrics = createMetrics();
    expect(() => metrics.inc(SANDBOX_OP_METRIC, { operation: "env_probe", outcome: "success" })).not.toThrow();
    expect(() => metrics.inc(SANDBOX_OP_METRIC, { operation: "env_probe", outcome: "failed" })).not.toThrow();
    // …and the run that emits it still reaches a durable terminal with real metrics composed.
    const { events } = await runSupervised({});
    expect(terminal(events)!.status).toBe("succeeded");
  });

  it("the probe's time is CARVED from the run's budget, never added to it (the capability window)", async () => {
    // The run's ceiling sits one teardown headroom under the owned-labels capability window, so a
    // probe that ADDED its time would push destroy past the capability's expiry and leave a
    // BILLABLE sandbox recorded `orphaned`. The tenant command's ctx must therefore be SHORTER
    // than the probe's by at least what the probe took, and `makeCtx` reads the live field so the
    // supervisor race and the provider ctx stay the same number (H1).
    const delayMs = 80;
    const slow = (extra: (input: ExecuteInput) => void = () => {}) => async (input: ExecuteInput): Promise<ExecuteResult> => {
      await new Promise((r) => setTimeout(r, delayMs));
      extra(input);
      input.onStdout?.(`${ENV_PROBE_REPORT_PREFIX}${JSON.stringify({
        probe: "dep017-env-absence/v1",
        checked: envProbeCheckedClasses(),
        // The planted execution carries DATABASE_URL + the foreign OPENAI canary: report BOTH
        // expected classes so the control is red and the tenant command actually runs.
        present: input.env.DATABASE_URL === undefined ? [] : ["cross_tenant_credential", "datastore_credential"],
        presentNames: input.env.DATABASE_URL === undefined ? [] : ["DATABASE_URL", "OPENAI_API_KEY"],
        allowedPresent: [],
        allowedMismatch: input.env.DATABASE_URL === undefined ? [] : ["ANTHROPIC_API_KEY"],
        envCount: 1,
        unnamedEnvCount: 0,
        unnamedPresentCount: 0,
      unnamedPresentCount: 0,
    unnamedPresentCount: 0,
        metadata: { attempted: false },
      })}
`);
      return { providerOpId: "p", exitCode: 0, signal: null, timedOut: false, stdoutRef: "r", stderrRef: "r" };
    };
    const { events, deadlines, tenantExecutions } = await runSupervised({ local: { probeOverride: slow() } });
    expect(probeLog(events)!.verdict).toBe("absent");
    expect(tenantExecutions).toHaveLength(1);
    const probeDeadlines = deadlines.filter((d) => d.kind === "probe").map((d) => d.deadlineMs);
    const tenantDeadline = deadlines.find((d) => d.kind === "tenant")!.deadlineMs;
    expect(probeDeadlines).toHaveLength(2);
    expect(probeDeadlines[0]).toBe(probeDeadlines[1]); // both probes run inside the SAME budget
    expect(tenantDeadline).toBeLessThanOrEqual(probeDeadlines[0]! - 2 * delayMs);
  });

  it("NOT COMPOSED (the default): no probe execute, no probe event — byte-identical lifecycle", async () => {
    const { events, probeEnvs, tenantExecutions } = await runSupervised({ composed: false });
    expect(probeEnvs).toHaveLength(0);
    expect(probeLog(events)).toBeNull();
    expect(events.some((e) => e.eventType === "log")).toBe(false);
    expect(tenantExecutions).toHaveLength(1);
    expect(terminal(events)!.status).toBe("succeeded");
  });
});
