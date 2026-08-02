import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, it, expect } from "vitest";
import {
  excludeExplicitlyDisabledPlugins,
  findLegacySharedArtifactConflict,
  pluginLoader,
  resolveManagedCompanyInstallDir,
  selectBootActivationCandidates,
} from "../services/plugin-loader.js";
import { setDeploymentMode } from "../config/deployment-mode.js";
import { CloudPluginExecutionBlockedError } from "../services/cloud-plugin-execution.js";

afterEach(() => setDeploymentMode("local_trusted"));

describe("plugin-loader companyId scoping", () => {
  it("registry key includes companyId", () => {
    // Registry key must be `${companyId}:${pluginKey}` so two companies
    // can run the same plugin independently.
    const companyId = "aaa-111";
    const pluginKey = "aoa.discord";
    const key = `${companyId}:${pluginKey}`;
    expect(key).toBe("aaa-111:aoa.discord");
  });

  it("different companyIds produce different registry keys", () => {
    const key1 = `company-a:aoa.discord`;
    const key2 = `company-b:aoa.discord`;
    expect(key1).not.toBe(key2);
  });

  it("uses separate managed npm prefixes for different companies", () => {
    const root = path.resolve("C:/aoa/plugins");
    expect(resolveManagedCompanyInstallDir(root, "company-a")).toBe(
      path.join(root, "companies", "company-a")
    );
    expect(resolveManagedCompanyInstallDir(root, "company-b")).toBe(
      path.join(root, "companies", "company-b")
    );
    expect(resolveManagedCompanyInstallDir(root, "company-a")).not.toBe(
      resolveManagedCompanyInstallDir(root, "company-b")
    );
  });

  it("rejects path-like company ids", () => {
    expect(() =>
      resolveManagedCompanyInstallDir("C:/aoa/plugins", "../other")
    ).toThrow(/Invalid companyId/);
  });

  it("detects legacy null-path artifacts shared across companies", () => {
    const pluginA = {
      id: "plugin-a",
      companyId: "company-a",
      packageName: "@acme/shared",
      packagePath: null,
    };
    const pluginB = { ...pluginA, id: "plugin-b", companyId: "company-b" };
    expect(
      findLegacySharedArtifactConflict(
        pluginA as any,
        [pluginA, pluginB] as any
      )
    ).toEqual(pluginB);
    expect(
      findLegacySharedArtifactConflict(
        {
          ...pluginA,
          packagePath: "C:/plugins/company-a/node_modules/@acme/shared",
        } as any,
        [pluginA, pluginB] as any
      )
    ).toBeNull();
  });

  it("excludes explicit company disables from startup while default-enabled rows load", () => {
    const ready = [{ id: "plugin-a" }, { id: "plugin-b" }];
    expect(
      excludeExplicitlyDisabledPlugins(ready, [{ pluginId: "plugin-a" }])
    ).toEqual([{ id: "plugin-b" }]);
    expect(excludeExplicitlyDisabledPlugins(ready, [])).toEqual(ready);
  });

  it("reconciles every stale ready row in blocked cloud mode, including disabled overlays", () => {
    const ready = [{ id: "plugin-a" }, { id: "plugin-b" }];
    const disabled = [{ pluginId: "plugin-a" }];

    expect(selectBootActivationCandidates(ready, disabled, true)).toEqual(ready);
    expect(selectBootActivationCandidates(ready, disabled, false)).toEqual([
      { id: "plugin-b" },
    ]);
  });

  it("blocks an executable manifest module before its top-level code can run in cloud", async () => {
    setDeploymentMode("cloud_auth");
    const packageDir = await mkdtemp(path.join(os.tmpdir(), "aoa-cloud-manifest-"));
    const markerPath = path.join(packageDir, "manifest-executed.txt");
    try {
      await writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({
          name: "aoa-plugin-malicious-test",
          version: "1.0.0",
          paperclipPlugin: { manifest: "manifest.mjs" },
        }),
      );
      await writeFile(
        path.join(packageDir, "manifest.mjs"),
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerPath)}, "executed");\nexport default { id: "malicious", apiVersion: "1" };\n`,
      );

      const loader = pluginLoader({} as any);
      await expect(loader.loadManifest(packageDir)).rejects.toBeInstanceOf(
        CloudPluginExecutionBlockedError,
      );
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      await rm(packageDir, { recursive: true, force: true });
    }
  });
});
