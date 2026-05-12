import { describe, expect, it } from "vitest";
import { secretService } from "../services/secrets.js";

describe("secretService", () => {
  it("exposes vault, binding, import, and audited resolve APIs", () => {
    const svc = secretService({} as any);

    expect(typeof svc.listProviderConfigs).toBe("function");
    expect(typeof svc.createProviderConfig).toBe("function");
    expect(typeof svc.checkProviderConfig).toBe("function");
    expect(typeof svc.createBinding).toBe("function");
    expect(typeof svc.syncEnvBindingsForTarget).toBe("function");
    expect(typeof svc.previewRemoteImport).toBe("function");
    expect(typeof svc.importRemoteSecrets).toBe("function");
    expect(typeof svc.resolveSecretValue).toBe("function");
  });
});
