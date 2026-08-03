import { afterEach, describe, expect, it } from "vitest";
import { buildInstanceHealthReport } from "../services/health/instance-health.js";
import { setDeploymentMode } from "../config/deployment-mode.js";
import { CLOUD_PLUGIN_BLOCK_MESSAGE } from "../services/cloud-plugin-execution.js";

afterEach(() => setDeploymentMode("local_trusted"));

describe("instance health cloud plugin policy", () => {
  it("counts a stale ready plugin as blocked and emits an error finding", async () => {
    setDeploymentMode("cloud_auth");
    const rows = [
      {
        id: "plugin-1",
        companyId: "company-1",
        pluginKey: "acme.plugin",
        status: "ready",
        manifestJson: { displayName: "Acme Plugin" },
        lastError: null,
      },
    ];
    const db = {
      select: () => ({
        from: () => ({
          orderBy: () => ({ limit: async () => rows }),
        }),
      }),
    } as any;

    const report = await buildInstanceHealthReport(db, {
      deploymentMode: "cloud_auth",
      deploymentExposure: "network",
      authReady: true,
      companyDeletionEnabled: false,
    });

    expect(report.sections.platform.plugins).toMatchObject({
      total: 1,
      ready: 0,
      notReady: 1,
    });
    expect(report.sections.platform.plugins.plugins[0]).toMatchObject({
      id: "plugin-1",
      status: "error",
      lastError: CLOUD_PLUGIN_BLOCK_MESSAGE,
    });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "instance-plugin-plugin-1",
          severity: "error",
        }),
      ])
    );
  });

  it("does not report a historical cloud block as active after moving to self-hosted", async () => {
    setDeploymentMode("authenticated");
    const rows = [
      {
        id: "plugin-1",
        companyId: "company-1",
        pluginKey: "acme.plugin",
        status: "error",
        statusReasonCode: "PLUGIN_WORKER_BLOCKED_IN_CLOUD",
        manifestJson: { displayName: "Acme Plugin" },
        lastError: CLOUD_PLUGIN_BLOCK_MESSAGE,
      },
    ];
    const db = {
      select: () => ({
        from: () => ({
          orderBy: () => ({ limit: async () => rows }),
        }),
      }),
    } as any;

    const report = await buildInstanceHealthReport(db, {
      deploymentMode: "authenticated",
      deploymentExposure: "network",
      authReady: true,
      companyDeletionEnabled: false,
    });

    expect(report.sections.platform.plugins.plugins[0]).toMatchObject({
      id: "plugin-1",
      status: "error",
    });
    expect(report.sections.platform.plugins.plugins[0]?.lastError).toBeUndefined();
    expect(
      report.findings.find((finding) => finding.id === "instance-plugin-plugin-1")
        ?.message,
    ).toBe("Plugin is not ready.");
  });
});
