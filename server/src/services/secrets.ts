import { and, desc, eq, isNull, ne, notInArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  companySecretBindings,
  companySecretProviderConfigs,
  companySecrets,
  companySecretVersions,
  secretAccessEvents,
} from "@armyofagents/db";
import type {
  AgentEnvConfig,
  EnvBinding,
  SecretBindingTargetType,
  SecretManagedMode,
  SecretProvider,
} from "@armyofagents/shared";
import {
  createSecretProviderConfigSchema,
  envBindingSchema,
  remoteSecretImportCommitSchema,
  remoteSecretImportPreviewSchema,
  secretProviderConfigPayloadSchema,
  updateSecretProviderConfigSchema,
} from "@armyofagents/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { getSecretProvider, listSecretProviders } from "../secrets/provider-registry.js";
import type { SecretProviderVaultRuntimeConfig } from "../secrets/types.js";

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SENSITIVE_ENV_KEY_RE =
  /(api[-_]?key|access[-_]?token|auth(?:_?token)?|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)/i;
const REDACTED_SENTINEL = "***REDACTED***";
const STUB_EXTERNAL_PROVIDERS = new Set<SecretProvider>(["gcp_secret_manager", "vault"]);

type CanonicalEnvBinding =
  | { type: "plain"; value: string }
  | { type: "secret_ref"; secretId: string; version: number | "latest" };

export type SecretConsumerContext = {
  consumerType: SecretBindingTargetType;
  consumerId: string;
  configPath?: string | null;
  actorType?: "agent" | "user" | "system" | "plugin";
  actorId?: string | null;
  issueId?: string | null;
  heartbeatRunId?: string | null;
  pluginId?: string | null;
};

type Actor = { userId?: string | null; agentId?: string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isSensitiveEnvKey(key: string) {
  return SENSITIVE_ENV_KEY_RE.test(key);
}

function canonicalizeBinding(binding: EnvBinding): CanonicalEnvBinding {
  if (typeof binding === "string") return { type: "plain", value: binding };
  if (binding.type === "plain") return { type: "plain", value: String(binding.value) };
  return { type: "secret_ref", secretId: binding.secretId, version: binding.version ?? "latest" };
}

function normalizeManagedMode(mode: unknown): SecretManagedMode {
  return mode === "external_reference" ? "external_reference" : "aoa_managed";
}

function keyForSecret(input: { key?: string | null; name: string }) {
  return input.key?.trim() || input.name.trim().replace(/[^A-Za-z0-9_]+/g, "_").toUpperCase();
}

function versionSelectorToString(value: number | "latest" | undefined) {
  return value === undefined ? "latest" : String(value);
}

function versionSelectorFromString(value: string): number | "latest" {
  if (value === "latest") return "latest";
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : "latest";
}

function errorCode(err: unknown) {
  if (err && typeof err === "object" && "status" in err) return `http_${String((err as any).status)}`;
  return "secret_resolve_failed";
}

function defaultConsumerContext(configPath?: string | null): SecretConsumerContext {
  return {
    consumerType: "system",
    consumerId: "legacy-secret-resolver",
    actorType: "system",
    configPath,
  };
}

export function shouldEnforceSecretBinding(context: SecretConsumerContext) {
  if (!context.configPath) return false;

  // Legacy/system-owned secret consumers predate binding rows. Keep them audited
  // with their config path while avoiding synthetic bootstrap bindings for
  // provider API keys, GitHub PATs, and routine trigger secrets.
  if (context.consumerType === "system") return false;
  if (context.consumerType === "routine" && context.actorType === "system") return false;

  // Plugin secrets are authorized by plugin config-schema allowlisting in
  // plugin-secrets-handler; the config path is still captured for audit.
  if (context.consumerType === "plugin") return false;

  return true;
}

export function normalizeProviderConfigStatus(
  provider: SecretProvider,
  requestedStatus?: string | null,
) {
  if (STUB_EXTERNAL_PROVIDERS.has(provider)) return "coming_soon";
  return requestedStatus ?? "ready";
}

export function normalizeProviderConfigDefault(status: string, requested?: boolean, existing = false) {
  if (status === "coming_soon") return false;
  return requested ?? existing;
}

export function secretService(db: Db) {
  async function getById(id: string) {
    return db.select().from(companySecrets).where(eq(companySecrets.id, id)).then((rows) => rows[0] ?? null);
  }

  async function getByName(companyId: string, name: string) {
    return db
      .select()
      .from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, name), isNull(companySecrets.deletedAt)))
      .then((rows) => rows[0] ?? null);
  }

  async function getSecretVersion(secretId: string, version: number) {
    return db
      .select()
      .from(companySecretVersions)
      .where(and(eq(companySecretVersions.secretId, secretId), eq(companySecretVersions.version, version)))
      .then((rows) => rows[0] ?? null);
  }

  async function assertSecretInCompany(companyId: string, secretId: string) {
    const secret = await getById(secretId);
    if (!secret || secret.deletedAt) throw notFound("Secret not found");
    if (secret.companyId !== companyId) throw unprocessable("Secret must belong to same company");
    return secret;
  }

  async function getProviderConfigById(id: string) {
    return db
      .select()
      .from(companySecretProviderConfigs)
      .where(eq(companySecretProviderConfigs.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function providerConfigForSecret(secret: typeof companySecrets.$inferSelect) {
    if (!secret.providerConfigId) return null;
    const row = await getProviderConfigById(secret.providerConfigId);
    if (!row) throw unprocessable("Secret provider config not found");
    if (row.companyId !== secret.companyId || row.provider !== secret.provider) {
      throw unprocessable("Secret provider config does not match secret");
    }
    if (row.status === "disabled" || row.disabledAt) throw unprocessable("Secret provider config is disabled");
    return {
      id: row.id,
      provider: row.provider as SecretProvider,
      status: row.status,
      config: row.config as Record<string, unknown>,
    } satisfies SecretProviderVaultRuntimeConfig;
  }

  async function assertProviderConfig(
    companyId: string,
    provider: SecretProvider,
    providerConfigId?: string | null,
  ) {
    if (!providerConfigId) return null;
    const row = await getProviderConfigById(providerConfigId);
    if (!row) throw notFound("Provider vault not found");
    if (row.companyId !== companyId || row.provider !== provider) {
      throw unprocessable("Provider vault must belong to the same company and provider");
    }
    if (row.status === "disabled" || row.disabledAt) throw unprocessable("Provider vault is disabled");
    return {
      id: row.id,
      provider: row.provider as SecretProvider,
      status: row.status,
      config: row.config as Record<string, unknown>,
    } satisfies SecretProviderVaultRuntimeConfig;
  }

  async function auditAccess(
    secret: typeof companySecrets.$inferSelect,
    version: number | null,
    context: SecretConsumerContext,
    outcome: "success" | "failure",
    code?: string | null,
  ) {
    await db.insert(secretAccessEvents).values({
      companyId: secret.companyId,
      secretId: secret.id,
      version,
      provider: secret.provider,
      actorType: context.actorType ?? "system",
      actorId: context.actorId ?? null,
      consumerType: context.consumerType,
      consumerId: context.consumerId,
      configPath: context.configPath ?? null,
      issueId: context.issueId ?? null,
      heartbeatRunId: context.heartbeatRunId ?? null,
      pluginId: context.pluginId ?? null,
      outcome,
      errorCode: code ?? null,
    });
  }

  async function assertBinding(secret: typeof companySecrets.$inferSelect, context: SecretConsumerContext) {
    if (!shouldEnforceSecretBinding(context)) return;
    const configPath = context.configPath;
    if (!configPath) return;
    const binding = await db
      .select()
      .from(companySecretBindings)
      .where(
        and(
          eq(companySecretBindings.companyId, secret.companyId),
          eq(companySecretBindings.secretId, secret.id),
          eq(companySecretBindings.targetType, context.consumerType),
          eq(companySecretBindings.targetId, context.consumerId),
          eq(companySecretBindings.configPath, configPath),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!binding) throw unprocessable("Secret is not bound to this consumer path");
  }

  async function resolveSecretValue(
    companyId: string,
    secretId: string,
    version: number | "latest",
    context: SecretConsumerContext,
  ): Promise<string> {
    let secret: typeof companySecrets.$inferSelect | null = null;
    let resolvedVersion: number | null = null;
    try {
      secret = await assertSecretInCompany(companyId, secretId);
      if (secret.status !== "active") throw unprocessable("Secret is not active");
      await assertBinding(secret, context);
      resolvedVersion = version === "latest" ? secret.latestVersion : version;
      const versionRow = await getSecretVersion(secret.id, resolvedVersion);
      if (!versionRow) throw notFound("Secret version not found");
      const provider = getSecretProvider(secret.provider as SecretProvider);
      const value = await provider.resolveVersion({
        material: versionRow.material as Record<string, unknown>,
        externalRef: secret.externalRef,
        providerConfig: await providerConfigForSecret(secret),
        versionSelector: version,
      });
      await db.update(companySecrets).set({ lastResolvedAt: new Date(), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
      await auditAccess(secret, resolvedVersion, context, "success");
      return value;
    } catch (err) {
      if (secret) await auditAccess(secret, resolvedVersion, context, "failure", errorCode(err));
      throw err;
    }
  }

  async function normalizeEnvConfig(
    companyId: string,
    envValue: unknown,
    opts?: { strictMode?: boolean },
  ): Promise<AgentEnvConfig> {
    const record = asRecord(envValue);
    if (!record) throw unprocessable("adapterConfig.env must be an object");
    const normalized: AgentEnvConfig = {};
    for (const [key, rawBinding] of Object.entries(record)) {
      if (!ENV_KEY_RE.test(key)) throw unprocessable(`Invalid environment variable name: ${key}`);
      const parsed = envBindingSchema.safeParse(rawBinding);
      if (!parsed.success) throw unprocessable(`Invalid environment binding for key: ${key}`);
      const binding = canonicalizeBinding(parsed.data as EnvBinding);
      if (binding.type === "plain") {
        if (opts?.strictMode && isSensitiveEnvKey(key) && binding.value.trim().length > 0) {
          throw unprocessable(`Strict secret mode requires secret references for sensitive key: ${key}`);
        }
        if (binding.value === REDACTED_SENTINEL) throw unprocessable(`Refusing to persist redacted placeholder for key: ${key}`);
        normalized[key] = binding;
      } else {
        await assertSecretInCompany(companyId, binding.secretId);
        normalized[key] = { type: "secret_ref", secretId: binding.secretId, version: binding.version };
      }
    }
    return normalized;
  }

  async function normalizeAdapterConfigForPersistenceInternal(
    companyId: string,
    adapterConfig: Record<string, unknown>,
    opts?: { strictMode?: boolean },
  ) {
    const normalized = { ...adapterConfig };
    if (Object.prototype.hasOwnProperty.call(adapterConfig, "env")) {
      normalized.env = await normalizeEnvConfig(companyId, adapterConfig.env, opts);
    }
    return normalized;
  }

  async function listBindingsForSecret(companyId: string, secretId: string) {
    await assertSecretInCompany(companyId, secretId);
    return db
      .select()
      .from(companySecretBindings)
      .where(and(eq(companySecretBindings.companyId, companyId), eq(companySecretBindings.secretId, secretId)))
      .orderBy(desc(companySecretBindings.createdAt));
  }

  async function listAccessEvents(companyId: string, secretId: string) {
    await assertSecretInCompany(companyId, secretId);
    return db
      .select()
      .from(secretAccessEvents)
      .where(and(eq(secretAccessEvents.companyId, companyId), eq(secretAccessEvents.secretId, secretId)))
      .orderBy(desc(secretAccessEvents.createdAt));
  }

  async function getBindingById(id: string) {
    return db.select().from(companySecretBindings).where(eq(companySecretBindings.id, id)).then((rows) => rows[0] ?? null);
  }

  return {
    listProviders: () => listSecretProviders(),

    list: async (companyId: string) => {
      const rows = await db
        .select()
        .from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), isNull(companySecrets.deletedAt)))
        .orderBy(desc(companySecrets.createdAt));
      const bindings = await db.select().from(companySecretBindings).where(eq(companySecretBindings.companyId, companyId));
      return rows.map((row) => ({
        ...row,
        managedMode: normalizeManagedMode(row.managedMode),
        referenceCount: bindings.filter((binding) => binding.secretId === row.id).length,
      }));
    },

    getById,
    getByName,
    getBindingById,
    getProviderConfigById,

    async resolveByName(companyId: string, name: string, context: SecretConsumerContext): Promise<string> {
      const secret = await getByName(companyId, name);
      if (!secret) throw notFound(`Secret not found: ${name}`);
      return resolveSecretValue(companyId, secret.id, "latest", context);
    },

    resolveSecretValue,

    listProviderConfigs: (companyId: string) =>
      db
        .select()
        .from(companySecretProviderConfigs)
        .where(eq(companySecretProviderConfigs.companyId, companyId))
        .orderBy(desc(companySecretProviderConfigs.createdAt)),

    async createProviderConfig(companyId: string, input: unknown, actor?: Actor) {
      const parsed = createSecretProviderConfigSchema.parse(input);
      const payload = secretProviderConfigPayloadSchema.parse({
        provider: parsed.provider,
        config: parsed.config ?? {},
      });
      const status = normalizeProviderConfigStatus(parsed.provider, parsed.status);
      const isDefault = normalizeProviderConfigDefault(status, parsed.isDefault);
      if (parsed.isDefault && status === "coming_soon") throw unprocessable("Coming-soon providers cannot be default");
      return db.transaction(async (tx) => {
        if (isDefault) {
          await tx
            .update(companySecretProviderConfigs)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(eq(companySecretProviderConfigs.companyId, companyId), eq(companySecretProviderConfigs.provider, parsed.provider)));
        }
        return tx
          .insert(companySecretProviderConfigs)
          .values({
            companyId,
            provider: parsed.provider,
            displayName: parsed.displayName,
            status,
            isDefault,
            config: payload.config,
            disabledAt: status === "disabled" ? new Date() : null,
            createdByAgentId: actor?.agentId ?? null,
            createdByUserId: actor?.userId ?? null,
          })
          .returning()
          .then((rows) => rows[0]);
      });
    },

    async updateProviderConfig(id: string, patch: unknown) {
      const existing = await getProviderConfigById(id);
      if (!existing) throw notFound("Provider vault not found");
      const parsed = updateSecretProviderConfigSchema.parse(patch);
      const nextStatus = normalizeProviderConfigStatus(existing.provider as SecretProvider, parsed.status ?? existing.status);
      const nextIsDefault = normalizeProviderConfigDefault(nextStatus, parsed.isDefault, existing.isDefault);
      if (parsed.isDefault && nextStatus === "coming_soon") throw unprocessable("Coming-soon providers cannot be default");
      const nextConfig =
        parsed.config === undefined
          ? existing.config
          : secretProviderConfigPayloadSchema.parse({ provider: existing.provider as SecretProvider, config: parsed.config }).config;
      return db.transaction(async (tx) => {
        if (nextIsDefault) {
          await tx
            .update(companySecretProviderConfigs)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(eq(companySecretProviderConfigs.companyId, existing.companyId), eq(companySecretProviderConfigs.provider, existing.provider), ne(companySecretProviderConfigs.id, id)));
        }
        return tx
          .update(companySecretProviderConfigs)
          .set({
            displayName: parsed.displayName ?? existing.displayName,
            status: nextStatus,
            isDefault: nextIsDefault,
            config: nextConfig,
            disabledAt: nextStatus === "disabled" ? existing.disabledAt ?? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(companySecretProviderConfigs.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });
    },

    async deleteProviderConfig(id: string) {
      const existing = await getProviderConfigById(id);
      if (!existing) return null;
      return db
        .update(companySecretProviderConfigs)
        .set({ status: "disabled", isDefault: false, disabledAt: new Date(), updatedAt: new Date() })
        .where(eq(companySecretProviderConfigs.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    async checkProviderConfig(id: string) {
      const existing = await getProviderConfigById(id);
      if (!existing) throw notFound("Provider vault not found");
      const checkedAt = new Date();
      const provider = getSecretProvider(existing.provider as SecretProvider);
      const health = provider.healthCheck
        ? await provider.healthCheck({
            providerConfig: {
              id: existing.id,
              provider: existing.provider as SecretProvider,
              status: existing.status,
              config: existing.config as Record<string, unknown>,
            },
          })
        : { status: "coming_soon" as const, message: "Provider is coming soon", details: null };
      await db
        .update(companySecretProviderConfigs)
        .set({
          healthStatus: health.status,
          healthMessage: health.message,
          healthDetails: health.details ?? null,
          healthCheckedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(companySecretProviderConfigs.id, id));
      return {
        providerConfigId: id,
        provider: existing.provider as SecretProvider,
        status: health.status,
        message: health.message,
        details: health.details ?? null,
        checkedAt,
      };
    },

    create: async (
      companyId: string,
      input: {
        name: string;
        key?: string | null;
        provider: SecretProvider;
        providerConfigId?: string | null;
        managedMode?: SecretManagedMode | null;
        value?: string | null;
        description?: string | null;
        externalRef?: string | null;
        providerVersionRef?: string | null;
      },
      actor?: Actor,
    ) => {
      const existing = await getByName(companyId, input.name);
      if (existing) throw conflict(`Secret already exists: ${input.name}`);
      const managedMode = normalizeManagedMode(input.managedMode);
      if (managedMode === "aoa_managed" && !input.value) throw unprocessable("Managed secrets require a value");
      if (managedMode === "external_reference" && !input.externalRef) throw unprocessable("External reference secrets require externalRef");
      const providerConfig = await assertProviderConfig(companyId, input.provider, input.providerConfigId);
      const provider = getSecretProvider(input.provider);
      const key = keyForSecret(input);
      const prepared =
        managedMode === "external_reference"
          ? await provider.linkExternalSecret?.({
              providerConfig: providerConfig!,
              externalRef: input.externalRef!,
              name: input.name,
              key,
              providerVersionRef: input.providerVersionRef ?? null,
              description: input.description ?? null,
            })
          : await provider.createVersion({
              value: input.value!,
              externalRef: input.externalRef ?? null,
              providerConfig,
              context: { companyId, secretKey: key, secretName: input.name, version: 1 },
            });
      if (!prepared) throw unprocessable("Provider does not support external references");
      return db.transaction(async (tx) => {
        const secret = await tx
          .insert(companySecrets)
          .values({
            companyId,
            name: input.name,
            key,
            status: "active",
            managedMode,
            provider: input.provider,
            providerConfigId: input.providerConfigId ?? null,
            providerMetadata: prepared.providerMetadata ?? null,
            externalRef: prepared.externalRef,
            latestVersion: 1,
            description: input.description ?? null,
            createdByAgentId: actor?.agentId ?? null,
            createdByUserId: actor?.userId ?? null,
          })
          .returning()
          .then((rows) => rows[0]);
        await tx.insert(companySecretVersions).values({
          secretId: secret.id,
          version: 1,
          material: prepared.material,
          providerVersionRef: prepared.providerVersionRef ?? null,
          status: "current",
          valueSha256: prepared.valueSha256,
          fingerprintSha256: prepared.fingerprintSha256 ?? prepared.valueSha256,
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.userId ?? null,
        });
        return secret;
      });
    },

    rotate: async (
      secretId: string,
      input: { value: string; externalRef?: string | null; providerConfigId?: string | null; providerVersionRef?: string | null },
      actor?: Actor,
    ) => {
      const secret = await getById(secretId);
      if (!secret || secret.deletedAt) throw notFound("Secret not found");
      if (normalizeManagedMode(secret.managedMode) !== "aoa_managed") throw unprocessable("External reference secrets cannot be rotated by AoA");
      const providerConfigId = input.providerConfigId ?? secret.providerConfigId;
      const providerConfig = await assertProviderConfig(secret.companyId, secret.provider as SecretProvider, providerConfigId);
      const provider = getSecretProvider(secret.provider as SecretProvider);
      const nextVersion = secret.latestVersion + 1;
      const prepared = await provider.createVersion({
        value: input.value,
        externalRef: input.externalRef ?? secret.externalRef ?? null,
        providerConfig,
        context: {
          companyId: secret.companyId,
          secretId: secret.id,
          secretKey: secret.key ?? keyForSecret(secret),
          secretName: secret.name,
          version: nextVersion,
        },
      });
      return db.transaction(async (tx) => {
        await tx.update(companySecretVersions).set({ status: "previous" }).where(eq(companySecretVersions.secretId, secret.id));
        await tx.insert(companySecretVersions).values({
          secretId: secret.id,
          version: nextVersion,
          material: prepared.material,
          providerVersionRef: prepared.providerVersionRef ?? null,
          status: "current",
          valueSha256: prepared.valueSha256,
          fingerprintSha256: prepared.fingerprintSha256 ?? prepared.valueSha256,
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.userId ?? null,
        });
        return tx
          .update(companySecrets)
          .set({
            latestVersion: nextVersion,
            providerConfigId,
            providerMetadata: prepared.providerMetadata ?? secret.providerMetadata,
            externalRef: prepared.externalRef,
            lastRotatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(companySecrets.id, secret.id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });
    },

    update: async (
      secretId: string,
      patch: { name?: string; key?: string | null; description?: string | null; externalRef?: string | null; status?: string },
    ) => {
      const secret = await getById(secretId);
      if (!secret || secret.deletedAt) throw notFound("Secret not found");
      if (patch.name && patch.name !== secret.name) {
        const duplicate = await getByName(secret.companyId, patch.name);
        if (duplicate && duplicate.id !== secret.id) throw conflict(`Secret already exists: ${patch.name}`);
      }
      return db
        .update(companySecrets)
        .set({
          name: patch.name ?? secret.name,
          key: patch.key === undefined ? secret.key : patch.key,
          description: patch.description === undefined ? secret.description : patch.description,
          externalRef: patch.externalRef === undefined ? secret.externalRef : patch.externalRef,
          status: patch.status ?? secret.status,
          updatedAt: new Date(),
        })
        .where(eq(companySecrets.id, secret.id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    remove: async (secretId: string) => {
      const secret = await getById(secretId);
      if (!secret) return null;
      const provider = getSecretProvider(secret.provider as SecretProvider);
      const latestVersion = await getSecretVersion(secret.id, secret.latestVersion);
      if (provider.deleteOrArchive) {
        await provider.deleteOrArchive({
          providerConfig: await providerConfigForSecret(secret).catch(() => null),
          material: (latestVersion?.material as Record<string, unknown>) ?? null,
          externalRef: secret.externalRef,
          managedMode: normalizeManagedMode(secret.managedMode),
        });
      }
      return db
        .update(companySecrets)
        .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(companySecrets.id, secretId))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    delete: async (companyId: string, name: string): Promise<boolean> => {
      const existing = await getByName(companyId, name);
      if (!existing) return false;
      await db.update(companySecrets).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      return true;
    },

    async createBinding(input: {
      companyId: string;
      secretId: string;
      targetType: SecretBindingTargetType;
      targetId: string;
      configPath: string;
      versionSelector?: number | "latest";
      required?: boolean;
      label?: string | null;
    }) {
      await assertSecretInCompany(input.companyId, input.secretId);
      return db
        .insert(companySecretBindings)
        .values({
          companyId: input.companyId,
          secretId: input.secretId,
          targetType: input.targetType,
          targetId: input.targetId,
          configPath: input.configPath,
          versionSelector: versionSelectorToString(input.versionSelector),
          required: input.required ?? true,
          label: input.label ?? null,
        })
        .onConflictDoUpdate({
          target: [
            companySecretBindings.companyId,
            companySecretBindings.targetType,
            companySecretBindings.targetId,
            companySecretBindings.configPath,
          ],
          set: {
            secretId: input.secretId,
            versionSelector: versionSelectorToString(input.versionSelector),
            required: input.required ?? true,
            label: input.label ?? null,
            updatedAt: new Date(),
          },
        })
        .returning()
        .then((rows) => rows[0]);
    },

    async deleteBinding(id: string) {
      const existing = await getBindingById(id);
      if (!existing) return null;
      await db.delete(companySecretBindings).where(eq(companySecretBindings.id, id));
      return existing;
    },

    listBindingsForSecret,
    listAccessEvents,

    async syncEnvBindingsForTarget(
      companyId: string,
      target: { targetType: SecretBindingTargetType; targetId: string; pathPrefix?: string },
      envValue: unknown,
    ) {
      const record = asRecord(envValue) ?? {};
      const seenPaths: string[] = [];
      for (const [key, rawBinding] of Object.entries(record)) {
        const parsed = envBindingSchema.safeParse(rawBinding);
        if (!parsed.success) continue;
        const binding = canonicalizeBinding(parsed.data as EnvBinding);
        const configPath = `${target.pathPrefix ?? "env"}.${key}`;
        if (binding.type === "secret_ref") {
          seenPaths.push(configPath);
          await this.createBinding({
            companyId,
            secretId: binding.secretId,
            targetType: target.targetType,
            targetId: target.targetId,
            configPath,
            versionSelector: binding.version,
            required: true,
            label: key,
          });
        }
      }
      const base = and(
        eq(companySecretBindings.companyId, companyId),
        eq(companySecretBindings.targetType, target.targetType),
        eq(companySecretBindings.targetId, target.targetId),
      );
      if (seenPaths.length === 0) {
        await db.delete(companySecretBindings).where(base);
      } else {
        await db.delete(companySecretBindings).where(and(base, notInArray(companySecretBindings.configPath, seenPaths)));
      }
    },

    normalizeAdapterConfigForPersistence: async (
      companyId: string,
      adapterConfig: Record<string, unknown>,
      opts?: { strictMode?: boolean },
    ) => normalizeAdapterConfigForPersistenceInternal(companyId, adapterConfig, opts),

    normalizeHireApprovalPayloadForPersistence: async (
      companyId: string,
      payload: Record<string, unknown>,
      opts?: { strictMode?: boolean },
    ) => {
      const normalized = { ...payload };
      const adapterConfig = asRecord(payload.adapterConfig);
      if (adapterConfig) normalized.adapterConfig = await normalizeAdapterConfigForPersistenceInternal(companyId, adapterConfig, opts);
      return normalized;
    },

    resolveEnvBindings: async (companyId: string, envValue: unknown, context: Omit<SecretConsumerContext, "configPath">) => {
      const record = asRecord(envValue);
      if (!record) return {} as Record<string, string>;
      const resolved: Record<string, string> = {};
      for (const [key, rawBinding] of Object.entries(record)) {
        if (!ENV_KEY_RE.test(key)) throw unprocessable(`Invalid environment variable name: ${key}`);
        const parsed = envBindingSchema.safeParse(rawBinding);
        if (!parsed.success) throw unprocessable(`Invalid environment binding for key: ${key}`);
        const binding = canonicalizeBinding(parsed.data as EnvBinding);
        resolved[key] =
          binding.type === "plain"
            ? binding.value
            : await resolveSecretValue(companyId, binding.secretId, binding.version, {
                ...context,
                configPath: `env.${key}`,
              });
      }
      return resolved;
    },

    async resolveAdapterConfigForRuntime(
      companyId: string,
      adapterConfig: Record<string, unknown>,
      context: Omit<SecretConsumerContext, "configPath">,
    ) {
      const resolved = { ...adapterConfig };
      resolved.env = await this.resolveEnvBindings(companyId, adapterConfig.env, context);
      return resolved;
    },

    async previewRemoteImport(companyId: string, input: unknown) {
      const parsed = remoteSecretImportPreviewSchema.parse(input);
      const config = await getProviderConfigById(parsed.providerConfigId);
      if (!config || config.companyId !== companyId) throw notFound("Provider vault not found");
      await assertProviderConfig(companyId, config.provider as SecretProvider, config.id);
      const provider = getSecretProvider(config.provider as SecretProvider);
      if (!provider.listRemoteSecrets || !provider.linkExternalSecret) throw unprocessable("Provider does not support remote import");
      const runtimeConfig = {
        id: config.id,
        provider: config.provider as SecretProvider,
        status: config.status,
        config: config.config as Record<string, unknown>,
      };
      const listed = await provider.listRemoteSecrets({
        providerConfig: runtimeConfig,
        query: parsed.query,
        nextToken: parsed.nextToken,
        pageSize: parsed.pageSize,
      });
      const existing = await db.select().from(companySecrets).where(and(eq(companySecrets.companyId, companyId), isNull(companySecrets.deletedAt)));
      const candidates = await Promise.all(
        listed.candidates.map(async (candidate) => {
          const linked = await provider.linkExternalSecret!({
            providerConfig: runtimeConfig,
            externalRef: candidate.externalRef,
            name: candidate.name,
            key: candidate.key,
            providerVersionRef: candidate.providerVersionRef,
            description: candidate.description,
          });
          const duplicate = existing.some((secret) => secret.providerConfigId === config.id && secret.externalRef === linked.externalRef);
          const conflictRow = existing.find((secret) => secret.name === linked.name || (linked.key && secret.key === linked.key));
          return {
            ...candidate,
            externalRef: linked.externalRef ?? candidate.externalRef,
            name: linked.name,
            key: linked.key,
            description: linked.description,
            status: duplicate ? "duplicate" as const : conflictRow ? "conflict" as const : "ready" as const,
            reason: duplicate ? "Already imported" : conflictRow ? "Name or key already exists" : null,
          };
        }),
      );
      return { providerConfigId: config.id, candidates, nextToken: listed.nextToken };
    },

    async importRemoteSecrets(companyId: string, input: unknown, actor?: Actor) {
      const parsed = remoteSecretImportCommitSchema.parse(input);
      const config = await getProviderConfigById(parsed.providerConfigId);
      if (!config || config.companyId !== companyId) throw notFound("Provider vault not found");
      await assertProviderConfig(companyId, config.provider as SecretProvider, config.id);
      const results = [];
      for (const row of parsed.secrets) {
        try {
          const created = await this.create(
            companyId,
            {
              name: row.name || row.externalRef.split(/[/:]/).filter(Boolean).at(-1) || row.externalRef,
              key: row.key ?? null,
              provider: config.provider as SecretProvider,
              providerConfigId: config.id,
              managedMode: "external_reference",
              externalRef: row.externalRef,
              providerVersionRef: row.providerVersionRef ?? null,
              description: row.description ?? null,
            },
            actor,
          );
          results.push({ externalRef: row.externalRef, name: created.name, status: "imported" as const, secretId: created.id });
        } catch (err) {
          results.push({ externalRef: row.externalRef, name: row.name ?? null, status: "error" as const, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { providerConfigId: config.id, results };
    },
  };
}
