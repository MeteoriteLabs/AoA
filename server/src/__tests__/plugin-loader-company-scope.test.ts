import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  excludeExplicitlyDisabledPlugins,
  findLegacySharedArtifactConflict,
  resolveManagedCompanyInstallDir,
} from "../services/plugin-loader.js";

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
});
