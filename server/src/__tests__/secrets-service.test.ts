import { describe, expect, it } from "vitest";
import {
  normalizeProviderConfigStatus,
  secretService,
  shouldEnforceSecretBinding,
} from "../services/secrets.js";

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

  it("keeps legacy system reads audited but unbound while enforcing runtime env bindings", () => {
    expect(shouldEnforceSecretBinding({
      consumerType: "system",
      consumerId: "github:auto-push",
      actorType: "system",
      configPath: "github.pat",
    })).toBe(false);

    expect(shouldEnforceSecretBinding({
      consumerType: "routine",
      consumerId: "routine-1",
      actorType: "system",
      configPath: "routine.triggerSecret",
    })).toBe(false);

    expect(shouldEnforceSecretBinding({
      consumerType: "plugin",
      consumerId: "plugin-1",
      actorType: "plugin",
      configPath: "plugin.config.apiKey",
    })).toBe(false);

    expect(shouldEnforceSecretBinding({
      consumerType: "agent",
      consumerId: "agent-1",
      actorType: "agent",
      configPath: "env.OPENAI_API_KEY",
    })).toBe(true);
  });

  it("forces non-AWS external providers to stay coming soon", () => {
    expect(normalizeProviderConfigStatus("gcp_secret_manager", "ready")).toBe("coming_soon");
    expect(normalizeProviderConfigStatus("vault", "disabled")).toBe("coming_soon");
    expect(normalizeProviderConfigStatus("aws_secrets_manager", undefined)).toBe("ready");
    expect(normalizeProviderConfigStatus("aws_secrets_manager", "warning")).toBe("warning");
  });
});
