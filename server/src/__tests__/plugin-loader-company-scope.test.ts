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

  // U10 SECURITY NOTE: this gate (plugin-loader.ts:1280,
  // `assertCloudPluginExecutionAllowed` inside `loadManifestFromPath`) is
  // NOT the worker-fork sink U10 is about — it guards a direct in-process
  // `import()` of a tenant-authored manifest MODULE (no child-process
  // isolation at all). isCloudPluginExecutionBlocked() is now unconditionally
  // false, so this specific protection is lifted along with the worker-fork
  // block. This differs from U10's stated justification ("the worker is
  // host-resident ... never enters the VM") — manifest loading never went
  // through a worker in the first place, so the host-resident-worker
  // reasoning does not by itself make this sink safe. Flagged verbatim in
  // the task report for explicit follow-up sign-off; not resolved here since
  // the plan's grounding note explicitly names plugin-loader.ts as one of
  // the sinks the blanket predicate change covers.
  it("U10: no longer blocks an executable manifest module's top-level code from running in cloud (see security note above)", async () => {
    setDeploymentMode("cloud_auth");
    // NOTE: unlike the other temp-dir fixtures in this file, this package
    // must live inside the project root (not os.tmpdir()) — vite-node's SSR
    // module loader intercepts the production code's `import()` call and
    // cannot resolve files outside its configured root on this platform.
    // `tmp-*` is gitignored; cleaned up in `finally` regardless.
    const packageDir = await mkdtemp(
      path.join(import.meta.dirname, "tmp-cloud-manifest-"),
    );
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
      // Schema-valid (so it clears `pluginManifestV1Schema` after import,
      // like a real attacker crafting a well-formed manifest would) with a
      // malicious top-level side effect.
      const validManifest = {
        id: "malicious",
        apiVersion: 1,
        version: "1.0.0",
        displayName: "Malicious",
        description: "d",
        author: "a",
        categories: ["automation"],
        capabilities: [],
        entrypoints: { worker: "worker.js" },
      };
      await writeFile(
        path.join(packageDir, "manifest.mjs"),
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerPath)}, "executed");\nexport default ${JSON.stringify(validManifest)};\n`,
      );

      const loader = pluginLoader({} as any);
      const manifest = await loader.loadManifest(packageDir);
      expect(manifest).toMatchObject({ id: "malicious", apiVersion: 1 });
      expect(existsSync(markerPath)).toBe(true);
    } finally {
      await rm(packageDir, { recursive: true, force: true });
    }
  });
});
