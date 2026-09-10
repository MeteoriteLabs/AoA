import { describe, expect, it } from "vitest";
import {
  assertHostedExecutionStartupSafe,
  HOSTED_EXECUTION_STARTUP_SAFETY_CONTROL,
  HostedExecutionStartupUnsafeError,
  APP_DATABASE_URL_ENV,
  DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV,
  DISTRIBUTED_EXECUTION_ENABLED_ENV,
  DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV,
  OPERATOR_DATABASE_URL_ENV,
  UNSANDBOXED_MULTITENANT_OPT_IN_ENV,
  type HostedExecutionStartupSafetyOutcome,
} from "../config/distributed-execution.js";
import {
  HOSTED_EXECUTION_STARTUP_SAFETY_PASSED_EVENT,
  HOSTED_EXECUTION_STARTUP_SAFETY_REFUSED_EVENT,
  loadConfigWithStartupSafetyAudit,
} from "../config/hosted-execution-startup-audit.js";

/**
 * DE-14's `audit` clause: "the startup safety-assertion outcome is logged".
 *
 * Before this suite's change NEITHER outcome was recorded — `E0-F010` measured
 * `config/distributed-execution.ts` as importing no logger and containing no
 * `logger`/`console` call at all, so a refusal surfaced only as an unhandled
 * module-eval crash trace and a pass was never noted anywhere.
 *
 * The clause is single-conjunct but two-DIRECTIONAL: "the outcome" is a pass or
 * a refusal, so both are asserted, and the refusal arms assert the reason is
 * read from the BRANCH rather than stamped as a constant.
 */

function captureLog() {
  const info: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const error: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  return {
    info,
    error,
    log: {
      info(obj: Record<string, unknown>, msg: string) {
        info.push({ obj, msg });
      },
      error(obj: Record<string, unknown>, msg: string) {
        error.push({ obj, msg });
      },
    },
  };
}

function passedConfig(
  overrides: Partial<HostedExecutionStartupSafetyOutcome> = {},
): { hostedExecutionStartupSafety: HostedExecutionStartupSafetyOutcome; marker: string } {
  return {
    marker: "the-real-config",
    hostedExecutionStartupSafety: {
      outcome: "passed",
      deploymentMode: "cloud_auth",
      distributedExecutionEnabled: true,
      control: HOSTED_EXECUTION_STARTUP_SAFETY_CONTROL,
      ...overrides,
    },
  };
}

describe("DE-14 — the startup safety assertion reports its outcome", () => {
  it("returns a PASS outcome naming the mode and the flag it read", () => {
    const outcome = assertHostedExecutionStartupSafe({
      deploymentMode: "cloud_auth",
      env: {
        [DISTRIBUTED_EXECUTION_ENABLED_ENV]: "1",
        [APP_DATABASE_URL_ENV]: "postgres://app@localhost:5432/aoa",
        [OPERATOR_DATABASE_URL_ENV]: "postgres://operator@localhost:5432/aoa",
      },
    });
    expect(outcome.outcome).toBe("passed");
    expect(outcome.deploymentMode).toBe("cloud_auth");
    // ANTI-VACUITY: the flag is read, not defaulted. The other pass arm below
    // takes the same code path with the flag OFF and must report `false`.
    expect(outcome.distributedExecutionEnabled).toBe(true);
    expect(outcome.control).toBe(HOSTED_EXECUTION_STARTUP_SAFETY_CONTROL);
  });

  it("reports the flag it actually read, not a constant", () => {
    const outcome = assertHostedExecutionStartupSafe({
      deploymentMode: "local_trusted",
      env: {},
    });
    expect(outcome.distributedExecutionEnabled).toBe(false);
    expect(outcome.deploymentMode).toBe("local_trusted");
  });

  it("carries a DISTINCT reason on each of the four refusal branches", () => {
    const refusals = [
      {
        label: "missing app database url",
        env: { [DISTRIBUTED_EXECUTION_ENABLED_ENV]: "1" },
        deploymentMode: "cloud_auth" as const,
        reason: "distributed_database_url_missing",
        envName: APP_DATABASE_URL_ENV,
      },
      {
        label: "excluded public ingress surface",
        env: { [DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV]: "true" },
        deploymentMode: "local_trusted" as const,
        reason: "excluded_surface_enabled",
        envName: DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV,
      },
      {
        label: "unsandboxed multitenant override in cloud_auth",
        env: { [UNSANDBOXED_MULTITENANT_OPT_IN_ENV]: "1" },
        deploymentMode: "cloud_auth" as const,
        reason: "unsandboxed_multitenant_in_cloud_auth",
        envName: UNSANDBOXED_MULTITENANT_OPT_IN_ENV,
      },
      {
        label: "an ambiguous flag fails closed",
        env: { [DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV]: "banana" },
        deploymentMode: "cloud_auth" as const,
        reason: "env_flag_unparseable",
        envName: DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV,
      },
    ];

    const seen = new Set<string>();
    for (const arm of refusals) {
      let thrown: unknown;
      try {
        assertHostedExecutionStartupSafe({ deploymentMode: arm.deploymentMode, env: arm.env });
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${arm.label} must refuse`).toBeInstanceOf(HostedExecutionStartupUnsafeError);
      const refusal = thrown as HostedExecutionStartupUnsafeError;
      expect(refusal.outcome, arm.label).toBe("refused");
      expect(refusal.reason, arm.label).toBe(arm.reason);
      expect(refusal.envName, arm.label).toBe(arm.envName);
      expect(refusal.deploymentMode, arm.label).toBe(arm.deploymentMode);
      expect(refusal.control, arm.label).toBe(HOSTED_EXECUTION_STARTUP_SAFETY_CONTROL);
      seen.add(refusal.reason);
    }
    // ANTI-VACUITY: a single hard-coded reason would satisfy every arm above
    // individually. Four branches must produce four codes.
    expect(seen.size).toBe(4);
  });

  it("POSITIVE CONTROL — the refusal messages and `instanceof Error` are unchanged", () => {
    expect(() =>
      assertHostedExecutionStartupSafe({
        deploymentMode: "cloud_auth",
        env: { [UNSANDBOXED_MULTITENANT_OPT_IN_ENV]: "1" },
      }),
    ).toThrow(/forbidden.*cloud_auth/i);
    expect(() =>
      assertHostedExecutionStartupSafe({
        deploymentMode: "local_trusted",
        env: { [DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV]: "1" },
      }),
    ).toThrow(new RegExp(`${DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV}.*excluded`, "i"));
    expect(() =>
      assertHostedExecutionStartupSafe({
        deploymentMode: "cloud_auth",
        env: { [DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV]: "banana" },
      }),
    ).toThrow(/is not a boolean flag/i);
    // The unchanged self-hosted path must still not refuse at all.
    expect(() =>
      assertHostedExecutionStartupSafe({
        deploymentMode: "local_trusted",
        env: { [UNSANDBOXED_MULTITENANT_OPT_IN_ENV]: "1" },
      }),
    ).not.toThrow();
  });
});

describe("DE-14 — the entrypoint records the outcome in both directions", () => {
  it("logs the PASS off the assertion's own return value", () => {
    const cap = captureLog();
    const config = passedConfig();
    const returned = loadConfigWithStartupSafetyAudit({ load: () => config, log: cap.log });

    expect(returned).toBe(config);
    expect(cap.error).toHaveLength(0);
    expect(cap.info).toHaveLength(1);
    const [{ obj }] = cap.info;
    expect(obj.event).toBe(HOSTED_EXECUTION_STARTUP_SAFETY_PASSED_EVENT);
    expect(obj.crossing).toBe("DE-14");
    expect(obj.outcome).toBe("passed");
    expect(obj.deploymentMode).toBe("cloud_auth");
    expect(obj.distributedExecutionEnabled).toBe(true);
    expect(obj.control).toBe(HOSTED_EXECUTION_STARTUP_SAFETY_CONTROL);
  });

  it("reads the logged fields from the config, not from a constant", () => {
    const cap = captureLog();
    loadConfigWithStartupSafetyAudit({
      load: () =>
        passedConfig({ deploymentMode: "local_trusted", distributedExecutionEnabled: false }),
      log: cap.log,
    });
    const [{ obj }] = cap.info;
    expect(obj.deploymentMode).toBe("local_trusted");
    expect(obj.distributedExecutionEnabled).toBe(false);
  });

  it("logs the REFUSAL with its reason and rethrows it unchanged", () => {
    const cap = captureLog();
    const refusal = new HostedExecutionStartupUnsafeError({
      message: `${UNSANDBOXED_MULTITENANT_OPT_IN_ENV} is forbidden in cloud_auth; ...`,
      reason: "unsandboxed_multitenant_in_cloud_auth",
      envName: UNSANDBOXED_MULTITENANT_OPT_IN_ENV,
      deploymentMode: "cloud_auth",
    });

    let thrown: unknown;
    try {
      loadConfigWithStartupSafetyAudit({
        load: () => {
          throw refusal;
        },
        log: cap.log,
      });
    } catch (err) {
      thrown = err;
    }

    // NEVER SWALLOWED: recording a refusal must not turn a refused startup into
    // a startup.
    expect(thrown).toBe(refusal);
    expect(cap.info).toHaveLength(0);
    expect(cap.error).toHaveLength(1);
    const [{ obj }] = cap.error;
    expect(obj.event).toBe(HOSTED_EXECUTION_STARTUP_SAFETY_REFUSED_EVENT);
    expect(obj.crossing).toBe("DE-14");
    expect(obj.outcome).toBe("refused");
    expect(obj.reason).toBe("unsandboxed_multitenant_in_cloud_auth");
    expect(obj.envName).toBe(UNSANDBOXED_MULTITENANT_OPT_IN_ENV);
    expect(obj.deploymentMode).toBe("cloud_auth");
    expect(obj.control).toBe(HOSTED_EXECUTION_STARTUP_SAFETY_CONTROL);
  });

  it("PRECISION CONTROL — an unrelated load failure is NOT recorded as a safety refusal", () => {
    const cap = captureLog();
    const unrelated = new Error('PORT="0" is not a valid TCP port');

    let thrown: unknown;
    try {
      loadConfigWithStartupSafetyAudit({
        load: () => {
          throw unrelated;
        },
        log: cap.log,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(unrelated);
    // A refusal line for an unrelated crash is a false claim of enforcement.
    expect(cap.error).toHaveLength(0);
    expect(cap.info).toHaveLength(0);
  });

  it("ARMING PATH — the entrypoint's single startup load goes through this recorder", async () => {
    const { readFile } = await import("node:fs/promises");
    const entry = await readFile(new URL("../index.ts", import.meta.url), "utf8");
    // `loadConfig()` must not be called bare at the entrypoint: that is exactly
    // the shape DE-14 was open for, and it would leave this module a writer
    // nothing calls.
    expect(entry).toContain(
      "loadConfigWithStartupSafetyAudit({ load: loadConfig, log: logger })",
    );
    // `\r?` is explicit rather than load-bearing, and that was MEASURED rather
    // than assumed: this tree checks out CRLF on Windows, so a negative assertion
    // anchored on `$` is the classic vacuous-check shape — but JS counts `\r` as
    // a line terminator, so `$` alone already matches before it. Probed against a
    // synthesised CRLF mutant: both forms match it, and both reject the shipped
    // line. Kept explicit so the next reader does not have to re-derive that.
    expect(entry).not.toMatch(/^const config = loadConfig\(\);\r?$/m);
  });
});
