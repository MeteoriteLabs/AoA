import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { warn, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn,
    info,
  },
}));

import {
  assertCloudPluginExecutionAllowed,
  beginCloudPluginBootReconciliation,
  CLOUD_PLUGIN_BLOCK_MESSAGE,
  getCloudPluginBlockMetrics,
  isCloudPluginExecutionBlocked,
  projectCloudPluginPolicyState,
  recordCloudPluginBlock,
  recordCloudPluginBootReconciled,
} from "../services/cloud-plugin-execution.js";
import { setDeploymentMode } from "../config/deployment-mode.js";

afterEach(() => setDeploymentMode("local_trusted"));

describe("cloud plugin execution observability", () => {
  beforeEach(() => {
    warn.mockClear();
    info.mockClear();
    beginCloudPluginBootReconciliation();
  });

  it("emits the bounded block event and source/reason counters without secrets", () => {
    const before = getCloudPluginBlockMetrics();
    recordCloudPluginBlock({
      pluginId: "plugin-a",
      companyId: "company-a",
      source: "marketplace",
      sink: "lifecycle",
    });

    const fields = warn.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(fields).toMatchObject({
      service: "cloud-plugin-execution",
      event: "plugin.worker.cloud_blocked",
      pluginId: "plugin-a",
      companyId: "company-a",
      activationSource: "marketplace",
      reasonCode: "PLUGIN_WORKER_BLOCKED_IN_CLOUD",
    });
    expect(Object.keys(fields)).not.toContain("config");
    expect(Object.keys(fields)).not.toContain("secrets");

    const after = getCloudPluginBlockMetrics();
    expect(after.total).toBe(before.total + 1);
    expect(after.bySource.marketplace).toBe(before.bySource.marketplace + 1);
    expect(after.byReason.PLUGIN_WORKER_BLOCKED_IN_CLOUD).toBe(
      before.byReason.PLUGIN_WORKER_BLOCKED_IN_CLOUD + 1
    );
  });

  it("emits boot reconciliation count and current gauge", () => {
    recordCloudPluginBootReconciled({
      pluginId: "plugin-a",
      companyId: "company-a",
    });

    expect(info.mock.calls.at(-1)?.[0]).toMatchObject({
      service: "cloud-plugin-execution",
      event: "plugin.worker.cloud_boot_reconciled",
      reasonCode: "PLUGIN_WORKER_BLOCKED_IN_CLOUD",
      bootReconciledGauge: 1,
    });
  });

  it("keeps the canonical remediation guide published in the docs navigation", () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const guidePath = `${repoRoot}docs/guides/cloud-plugin-execution.md`;
    const docsConfigPath = `${repoRoot}docs/docs.json`;

    expect(existsSync(guidePath)).toBe(true);
    const docsConfig = JSON.parse(readFileSync(docsConfigPath, "utf8"));
    expect(JSON.stringify(docsConfig.navigation)).toContain("guides/cloud-plugin-execution");
  });

  it("U10: leaves every non-blocked-history cloud row untouched (no live block projection)", () => {
    setDeploymentMode("cloud_auth");
    for (const status of ["installed", "disabled", "error", "upgrade_pending"]) {
      const plugin = {
        id: `plugin-${status}`,
        status,
        statusReasonCode: null,
        lastError: status === "error" ? "generic error" : null,
      };
      // isCloudPluginExecutionBlocked() is always false now (host-resident
      // worker model), so the live projection is a no-op — the row passes
      // through byte-identical instead of being rewritten to status: "error".
      expect(projectCloudPluginPolicyState(plugin)).toBe(plugin);
    }
    expect(
      projectCloudPluginPolicyState({
        id: "plugin-uninstalled",
        status: "uninstalled",
        statusReasonCode: null,
        lastError: null,
      }).status,
    ).toBe("uninstalled");
  });

  it("treats a persisted cloud block as recoverable after moving to self-hosted", () => {
    setDeploymentMode("authenticated");
    expect(
      projectCloudPluginPolicyState({
        status: "error",
        statusReasonCode: "PLUGIN_WORKER_BLOCKED_IN_CLOUD",
        lastError: CLOUD_PLUGIN_BLOCK_MESSAGE,
      }),
    ).toEqual({
      status: "error",
      statusReasonCode: null,
      lastError: null,
    });
  });

  it("preserves unrelated self-hosted error diagnostics", () => {
    setDeploymentMode("authenticated");
    const plugin = {
      status: "error",
      statusReasonCode: "PLUGIN_ACTIVATION_FAILED",
      lastError: "worker crashed",
    };
    expect(projectCloudPluginPolicyState(plugin)).toBe(plugin);
  });
});

describe("cloud plugin execution — host-resident worker model (U10)", () => {
  afterEach(() => setDeploymentMode("local_trusted"));

  it("does NOT block plugin worker execution on cloud_auth (host-resident worker, U10)", () => {
    setDeploymentMode("cloud_auth");
    expect(isCloudPluginExecutionBlocked()).toBe(false);
  });

  it("assertCloudPluginExecutionAllowed no longer throws on cloud for a host worker fork", () => {
    setDeploymentMode("cloud_auth");
    expect(() =>
      assertCloudPluginExecutionAllowed({
        pluginId: "p1",
        sink: "worker-fork",
        source: "direct",
      }),
    ).not.toThrow();
  });

  it("stays false on every deployment mode (desktop/local_trusted unchanged, still permissive)", () => {
    for (const mode of ["local_trusted", "authenticated", "cloud_auth"] as const) {
      setDeploymentMode(mode);
      expect(isCloudPluginExecutionBlocked()).toBe(false);
    }
  });
});
