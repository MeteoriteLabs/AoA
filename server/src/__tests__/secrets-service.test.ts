import { describe, expect, it } from "vitest";
import { companySecretBindings, companySecretProviderConfigs, companySecrets, companySecretVersions, secretAccessEvents } from "@armyofagents/db";
import {
  normalizeProviderConfigDefault,
  normalizeProviderConfigStatus,
  secretService,
  shouldEnforceSecretBinding,
} from "../services/secrets.js";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";

function makeThenable<T>(rows: T[]) {
  return {
    then<TResult1 = T[], TResult2 = never>(
      onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
      _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(rows).then(onfulfilled ?? ((value) => value as TResult1));
    },
    orderBy() {
      return this;
    },
  };
}

function makeFakeDb(input: {
  bindings?: unknown[];
  providerConfigs?: unknown[];
  secret: any;
  version: any;
}) {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const db = {
    inserted,
    updates,
    select() {
      return {
        from(table: unknown) {
          const rows =
            table === companySecrets
              ? [input.secret]
              : table === companySecretVersions
                ? [input.version]
                : table === companySecretBindings
                  ? (input.bindings ?? [])
                  : table === companySecretProviderConfigs
                    ? (input.providerConfigs ?? [])
                    : [];
          return {
            where() {
              return makeThenable(rows);
            },
            orderBy() {
              return makeThenable(rows);
            },
            then: makeThenable(rows).then,
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: unknown) {
          inserted.push({ table, values });
          return Promise.resolve();
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: unknown) {
          updates.push({ table, values });
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return db;
}

describe("secretService", () => {
  it("exposes vault, binding, import, and audited resolve APIs", () => {
    const svc = secretService({} as any);

    expect(typeof svc.listProviderConfigs).toBe("function");
    expect(typeof svc.createProviderConfig).toBe("function");
    expect(typeof svc.checkProviderConfig).toBe("function");
    expect(typeof svc.createBinding).toBe("function");
    expect(typeof svc.syncEnvBindingsForTarget).toBe("function");
    expect(typeof svc.normalizeEnvConfigForPersistence).toBe("function");
    expect(typeof svc.previewRemoteImport).toBe("function");
    expect(typeof svc.importRemoteSecrets).toBe("function");
    expect(typeof svc.resolveSecretValue).toBe("function");
  });

  it("normalizes env config for persistence with strict validation", async () => {
    await expect(secretService({} as any).normalizeEnvConfigForPersistence("company-1", {
      NODE_ENV: "production",
    }, { strictMode: true })).resolves.toEqual({
      NODE_ENV: { type: "plain", value: "production" },
    });

    await expect(secretService({} as any).normalizeEnvConfigForPersistence("company-1", {
      "1BAD": "value",
    }, { strictMode: true })).rejects.toThrow("Invalid environment variable name");

    await expect(secretService({} as any).normalizeEnvConfigForPersistence("company-1", {
      API_KEY: "sk-test",
    }, { strictMode: true })).rejects.toThrow("Strict secret mode requires secret references");
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
    expect(normalizeProviderConfigDefault("coming_soon", undefined, true)).toBe(false);
    expect(normalizeProviderConfigDefault("ready", undefined, true)).toBe(true);
  });

  it("audits system reads without requiring legacy binding rows", async () => {
    process.env.AOA_SECRETS_MASTER_KEY = "12345678901234567890123456789012";
    const prepared = await localEncryptedProvider.createVersion({
      value: "sk-test",
      externalRef: null,
      context: {
        companyId: "company-1",
        secretId: "secret-1",
        secretKey: "OPENAI_API_KEY",
        secretName: "OpenAI",
        version: 1,
      },
    });
    const db = makeFakeDb({
      secret: {
        id: "secret-1",
        companyId: "company-1",
        provider: "local_encrypted",
        providerConfigId: null,
        externalRef: null,
        latestVersion: 1,
        status: "active",
      },
      version: { secretId: "secret-1", version: 1, material: prepared.material },
      bindings: [],
    });

    await expect(secretService(db as any).resolveSecretValue("company-1", "secret-1", "latest", {
      consumerType: "system",
      consumerId: "llm-provider:openai",
      actorType: "system",
      configPath: "provider.openai",
    })).resolves.toBe("sk-test");

    expect(db.inserted).toEqual([
      expect.objectContaining({
        table: secretAccessEvents,
        values: expect.objectContaining({
          companyId: "company-1",
          secretId: "secret-1",
          consumerType: "system",
          configPath: "provider.openai",
          outcome: "success",
        }),
      }),
    ]);
  });

  it("preserves local encrypted external references for display metadata", async () => {
    process.env.AOA_SECRETS_MASTER_KEY = "12345678901234567890123456789012";

    const prepared = await localEncryptedProvider.createVersion({
      value: "ghp_test",
      externalRef: "octocat",
      context: {
        companyId: "company-1",
        secretId: "secret-1",
        secretKey: "GITHUB_PAT",
        secretName: "GitHub PAT",
        version: 1,
      },
    });

    expect(prepared.externalRef).toBe("octocat");
  });

  it("rejects unbound agent env reads and audits the failure", async () => {
    process.env.AOA_SECRETS_MASTER_KEY = "12345678901234567890123456789012";
    const prepared = await localEncryptedProvider.createVersion({
      value: "sk-test",
      externalRef: null,
      context: {
        companyId: "company-1",
        secretId: "secret-1",
        secretKey: "OPENAI_API_KEY",
        secretName: "OpenAI",
        version: 1,
      },
    });
    const db = makeFakeDb({
      secret: {
        id: "secret-1",
        companyId: "company-1",
        provider: "local_encrypted",
        providerConfigId: null,
        externalRef: null,
        latestVersion: 1,
        status: "active",
      },
      version: { secretId: "secret-1", version: 1, material: prepared.material },
      bindings: [],
    });

    await expect(secretService(db as any).resolveSecretValue("company-1", "secret-1", "latest", {
      consumerType: "agent",
      consumerId: "agent-1",
      actorType: "agent",
      actorId: "agent-1",
      configPath: "env.OPENAI_API_KEY",
    })).rejects.toThrow("Secret is not bound");

    expect(db.inserted).toEqual([
      expect.objectContaining({
        table: secretAccessEvents,
        values: expect.objectContaining({
          companyId: "company-1",
          secretId: "secret-1",
          consumerType: "agent",
          consumerId: "agent-1",
          configPath: "env.OPENAI_API_KEY",
          outcome: "failure",
        }),
      }),
    ]);
  });

  it("rejects remote import preview for disabled provider configs before provider calls", async () => {
    const db = makeFakeDb({
      secret: null,
      version: null,
      providerConfigs: [{
        id: "11111111-1111-4111-8111-111111111111",
        companyId: "company-1",
        provider: "aws_secrets_manager",
        status: "disabled",
        disabledAt: new Date(),
        config: { region: "us-east-1" },
      }],
    });

    await expect(secretService(db as any).previewRemoteImport("company-1", {
      providerConfigId: "11111111-1111-4111-8111-111111111111",
      query: "OPENAI",
    })).rejects.toThrow("Provider vault is disabled");
  });
});
