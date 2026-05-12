import { describe, expect, it } from "vitest";
import {
  createSecretBindingSchema,
  createSecretProviderConfigSchema,
  remoteSecretImportCommitSchema,
  remoteSecretImportPreviewSchema,
  secretProviderConfigPayloadSchema,
} from "./secret.js";

describe("secret validators", () => {
  it("accepts an AWS provider config with AoA defaults", () => {
    const parsed = createSecretProviderConfigSchema.parse({
      provider: "aws_secrets_manager",
      displayName: "Production AWS",
      config: { region: "us-east-1", secretNamePrefix: "aoa/prod" },
    });

    expect(parsed.provider).toBe("aws_secrets_manager");
  });

  it("requires valid UUIDs for remote import preview", () => {
    expect(() => remoteSecretImportPreviewSchema.parse({ providerConfigId: "nope" })).toThrow();
  });

  it("validates provider-specific config payloads", () => {
    expect(() =>
      secretProviderConfigPayloadSchema.parse({
        provider: "aws_secrets_manager",
        config: { secretNamePrefix: "aoa/prod" },
      }),
    ).toThrow();

    expect(
      secretProviderConfigPayloadSchema.parse({
        provider: "gcp_secret_manager",
        config: { projectId: "future" },
      }).provider,
    ).toBe("gcp_secret_manager");
  });

  it("accepts binding and remote import commit payloads", () => {
    const providerConfigId = "00000000-0000-4000-8000-000000000001";
    const secretId = "00000000-0000-4000-8000-000000000002";

    expect(
      createSecretBindingSchema.parse({
        secretId,
        targetType: "agent",
        targetId: "agent-1",
        configPath: "env.OPENAI_API_KEY",
      }).versionSelector,
    ).toBeUndefined();

    expect(
      remoteSecretImportCommitSchema.parse({
        providerConfigId,
        secrets: [{ externalRef: "arn:aws:secretsmanager:us-east-1:123:secret:aoa/prod/key" }],
      }).secrets,
    ).toHaveLength(1);
  });
});
