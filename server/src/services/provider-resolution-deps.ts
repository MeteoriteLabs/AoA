// server/src/services/provider-resolution-deps.ts
import type { Db } from "@armyofagents/db";
import { providerAssignments, providerConnections } from "@armyofagents/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { CliAuthTopology } from "./cli-auth-topology.js";
import { secretService } from "./secrets.js";
import { companyKeyTargetForAdapter, shouldEnforceSecretBinding } from "./secrets.js";
import { getSecretProvider } from "../secrets/provider-registry.js";
import { SecretCandidateUnavailableError } from "../secrets/secret-candidate-errors.js";
import type { SecretProviderVaultRuntimeConfig } from "../secrets/types.js";
import { envVarForProvider } from "./providers/provider-key.js";
import {
  resolveAgentSubscriptionEnvironment,
  type CliSubscriptionProvider,
} from "./provider-credential-bindings.js";
import { candidateMatchesScope } from "./provider-resolution.js";
import type {
  CandidateRow,
  ResolveArgs,
  ResolveDeps,
} from "./provider-resolution.js";

// ---------------------------------------------------------------------------------------------
// E7-1 provider-credential broker (migration 0281). In multi_tenant the serving roles hold ZERO
// grants on the owner-only credential model (enforced at CP boot), so the direct drizzle reads
// below raise 42501 / return nothing. The composition root registers the aoa_operator pool once
// at boot; the broker path routes the credential reads/writes through the SECURITY DEFINER
// functions over THAT pool. Read LAZILY (per-call), never captured at buildResolveDeps time — a
// port captured at build time is a no-op for anything the composition root wired earlier.
// ---------------------------------------------------------------------------------------------
let brokerOperatorDb: Db | undefined;
/** Called once by the composition root (index.ts) with distributedExecutionDatabases.operatorDb. */
export function setProviderCredentialBrokerDb(db: Db): void {
  brokerOperatorDb = db;
}

/** node-postgres returns `{ rows }`; some drivers return an array. Mirrors canary-preflight-evidence.ts. */
function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** Mirrors secrets.ts errorCode (not exported); classifies the audit error_code. */
function brokerErrorCode(err: unknown): string {
  if (err instanceof SecretCandidateUnavailableError) return err.code;
  if (err && typeof err === "object" && "status" in err) return `http_${String((err as { status?: unknown }).status)}`;
  return "secret_resolve_failed";
}

/** Function A over the operator pool: assignment JOIN connection candidates, then the SAME
 *  candidateMatchesScope defence-in-depth filter the direct path applies. */
async function loadCandidateRowsViaBroker(operatorDb: Db, args: ResolveArgs): Promise<CandidateRow[]> {
  const result = await operatorDb.execute(sql`
    SELECT * FROM public.resolve_provider_assignment_candidates(
      ${args.organizationId}::uuid, ${args.companyId}::uuid, ${args.provider}::text)`);
  return rowsOf<Record<string, unknown>>(result)
    .map(
      (r): CandidateRow => ({
        connectionId: r.connection_id as string,
        authMethod: r.auth_method as CandidateRow["authMethod"],
        scopeType: r.scope_type as CandidateRow["scopeType"],
        scopeId: (r.scope_id as string | null) ?? null,
        priority: Number(r.priority ?? 0),
        connectionUpdatedAt: r.connection_updated_at ? new Date(r.connection_updated_at as string).getTime() : 0,
        state: r.state as string,
        termsAttestedAt: r.terms_attested_at ? new Date(r.terms_attested_at as string) : null,
        sharingPolicy: r.sharing_policy as CandidateRow["sharingPolicy"],
        connectionCompanyId: (r.connection_company_id as string | null) ?? null,
        connectionOrganizationId: (r.connection_organization_id as string | null) ?? null,
        connectionOwnerUserId: (r.connection_owner_user_id as string | null) ?? null,
        executionTargetId: (r.execution_target_id as string | null) ?? null,
        config: (r.config as Record<string, unknown>) ?? {},
        secretRef: (r.secret_ref as string | null) ?? null,
      }),
    )
    .filter((r) => candidateMatchesScope(r, args));
}

/** Function B (read bundle) + Node decryption + Function C (audit + touch) over the operator pool.
 *  Reproduces secrets.ts resolveSecretValue's checks and audit-after-decrypt timing exactly; the
 *  policy decisions and AES-256-GCM decryption stay here in Node. */
async function resolveSecretValueViaBroker(
  operatorDb: Db,
  row: CandidateRow,
  args: ResolveArgs,
): Promise<string | null> {
  if (!row.secretRef) return null;
  const configPath = `provider_connection.${row.connectionId}`;
  const ctx = { ...args.context, configPath };
  const secretId = row.secretRef;
  let resolvedVersion: number | null = null;
  let secretProvider: string | null = null;

  const audit = (outcome: "success" | "failure", code: string | null) =>
    operatorDb.execute(sql`SELECT public.record_company_secret_access(
      ${args.companyId}::uuid, ${secretId}::uuid, ${resolvedVersion}::integer, ${secretProvider}::text,
      ${ctx.actorType ?? "system"}::text, ${ctx.actorId ?? null}::text,
      ${ctx.consumerType}::text, ${ctx.consumerId}::text,
      ${ctx.issueId ?? null}::uuid, ${ctx.heartbeatRunId ?? null}::uuid, ${ctx.pluginId ?? null}::uuid,
      ${ctx.configPath ?? null}::text, ${outcome}::text, ${code}::text)`);

  try {
    const bundle = rowsOf<Record<string, unknown>>(
      await operatorDb.execute(sql`
        SELECT * FROM public.resolve_company_secret_bundle(
          ${args.companyId}::uuid, ${secretId}::uuid, NULL::integer,
          ${ctx.consumerType}::text, ${ctx.consumerId}::text, ${configPath}::text)`),
    )[0];
    // Row absent entirely → mirror getById() returning null in resolveSecretValue: NO failure
    // audit (there is no secret to attribute the event to, and no provider for p_provider).
    if (!bundle || bundle.secret_found !== true) {
      throw new SecretCandidateUnavailableError("secret_missing", "Secret not found");
    }
    // Row exists (even if soft-deleted) → mirror `if (secret)` in resolveSecretValue: EVERY
    // failure from here on writes a failure audit, so capture the provider now (it is also the
    // audit row's p_provider). Without this, inactive/deleted/company-mismatch failures on the
    // distributed path would silently skip the secret_access_events tamper record that the
    // direct path always writes.
    secretProvider = bundle.secret_provider as string;
    if (bundle.secret_is_deleted === true) {
      throw new SecretCandidateUnavailableError("secret_missing", "Secret not found");
    }
    if (bundle.secret_company_id !== args.companyId) throw new Error("Secret must belong to same company");
    if (bundle.secret_status !== "active") {
      throw new SecretCandidateUnavailableError("secret_inactive", "Secret is not active");
    }
    if (shouldEnforceSecretBinding(ctx) && bundle.binding_found !== true) {
      throw new SecretCandidateUnavailableError("secret_unbound", "Secret is not bound to this consumer path");
    }
    // Mirror resolveSecretValue ordering: resolvedVersion is set BEFORE the version-row lookup,
    // so a version_missing failure audits with the resolved version rather than null.
    resolvedVersion = Number(bundle.resolved_version);
    if (bundle.version_found !== true) {
      throw new SecretCandidateUnavailableError("secret_version_missing", "Secret version not found");
    }
    let providerConfig: SecretProviderVaultRuntimeConfig | null = null;
    if (bundle.secret_provider_config_id) {
      if (bundle.provider_config_found !== true) throw new Error("Secret provider config not found");
      if (bundle.provider_config_company_id !== args.companyId || bundle.provider_config_provider !== secretProvider) {
        throw new Error("Secret provider config does not match secret");
      }
      if (bundle.provider_config_disabled === true) {
        throw new SecretCandidateUnavailableError("provider_config_disabled", "Secret provider config is disabled");
      }
      providerConfig = {
        id: bundle.secret_provider_config_id as string,
        provider: secretProvider,
        status: bundle.provider_config_status as string,
        config: (bundle.provider_config_config as Record<string, unknown>) ?? {},
      } as SecretProviderVaultRuntimeConfig;
    }
    const value = await getSecretProvider(secretProvider as Parameters<typeof getSecretProvider>[0]).resolveVersion({
      material: bundle.version_material as Record<string, unknown> as never,
      externalRef: (bundle.secret_external_ref as string | null) ?? null,
      providerConfig,
      versionSelector: "latest",
    });
    await audit("success", null);
    return value;
  } catch (err) {
    if (secretProvider !== null) await audit("failure", brokerErrorCode(err)).catch(() => {});
    throw err;
  }
}

/**
 * Live wiring. Every credential read REUSES an existing service:
 *   - secret_ref value  → secretService.resolveSecretValue (owner-hop respected upstream)
 *   - subscription home → resolveAgentSubscriptionEnvironment (home-safety untouched)
 *   - legacy fallback   → secretService.resolveAdapterConfigForRuntime
 */
export function buildResolveDeps(db: Db, topology: CliAuthTopology): ResolveDeps {
  const secrets = secretService(db);
  // multi_tenant: the credential model is owner-only and the serving roles are fenced off, so the
  // direct reads below cannot see it — route through the 0281 definer broker over the operator pool.
  // Self-hosted/embedded keeps the direct owner-`db` path unchanged.
  const useBroker = topology.trustBoundary === "multi_tenant";
  return {
    async loadCandidateRows(_db: Db, args: ResolveArgs): Promise<CandidateRow[]> {
      if (useBroker && brokerOperatorDb) return loadCandidateRowsViaBroker(brokerOperatorDb, args);
      const query = db
        .select({
          connectionId: providerConnections.id,
          authMethod: providerConnections.authMethod,
          scopeType: providerAssignments.scopeType,
          scopeId: providerAssignments.scopeId,
          priority: providerAssignments.priority,
          connectionUpdatedAt: providerConnections.updatedAt,
          state: providerConnections.state,
          termsAttestedAt: providerConnections.termsAttestedAt,
          sharingPolicy: providerConnections.sharingPolicy,
          connectionCompanyId: providerConnections.companyId,
          connectionOrganizationId: providerConnections.organizationId,
          connectionOwnerUserId: providerConnections.ownerUserId,
          executionTargetId: providerConnections.executionTargetId,
          config: providerConnections.config,
          secretRef: providerConnections.secretRef,
        })
        .from(providerAssignments)
        .innerJoin(providerConnections, eq(providerAssignments.connectionId, providerConnections.id));

      // Cross-tenant safety (M1): an org_default row is included ONLY when its
      // organization_id equals the run's organization_id. When the run has no
      // organization_id (pre-P1 company), org_default is skipped entirely — never
      // "include every org_default". Company rows are always scoped by company_id.
      const orgDefaultClause = args.organizationId
        ? and(
            isNull(providerAssignments.companyId),
            eq(providerAssignments.scopeType, "org_default"),
            eq(providerAssignments.organizationId, args.organizationId),
          )
        : null;
      const scopeClause = orgDefaultClause
        ? or(eq(providerAssignments.companyId, args.companyId), orgDefaultClause)
        : eq(providerAssignments.companyId, args.companyId);
      const rowsQuery = query.where(
        and(
          eq(providerAssignments.provider, args.provider),
          eq(providerAssignments.state, "active"),
          scopeClause,
        ),
      );
      const rows = await rowsQuery;

      // Filter scoped rows to THIS agent / owner + defense-in-depth org gate.
      // The org-scope decision is the pure candidateMatchesScope (M1 cross-tenant
      // safety), unit-tested independently in Task 15.
      return rows
        .filter((r) => candidateMatchesScope(r, args))
        .map((r) => ({
          ...r,
          connectionUpdatedAt: r.connectionUpdatedAt ? new Date(r.connectionUpdatedAt).getTime() : 0,
          config: (r.config as Record<string, unknown>) ?? {},
        })) as CandidateRow[];
    },

    async resolveSecretValueForConnection(_db, row, args) {
      if (!row.secretRef) return null;
      if (useBroker && brokerOperatorDb) return resolveSecretValueViaBroker(brokerOperatorDb, row, args);
      return secrets.resolveSecretValue(args.companyId, row.secretRef, "latest", {
        ...args.context,
        configPath: `provider_connection.${row.connectionId}`,
      });
    },

    async resolveSubscriptionEnv(_db, row, args) {
      const provider = args.provider as CliSubscriptionProvider;
      const env = await resolveAgentSubscriptionEnvironment(db, {
        companyId: args.companyId,
        agentId: args.agentId ?? "",
        provider,
        executionTargetId: row.executionTargetId ?? args.executionTargetId,
        // Chokepoint consistency: the resolver's Layer-1 backstop already skips
        // personal_subscription candidates in multi_tenant before this runs, so this
        // is never reached there — but pass the real topology so the invariant holds
        // if that guard is ever bypassed.
        trustBoundary: topology.trustBoundary,
      });
      // Narrow NodeJS.ProcessEnv → Record<string,string>.
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
      return out;
    },

    envVarForProvider: (provider: string) => {
      // Reuse the same env var the api-key ladder uses (owner-hopped internally).
      try {
        return envVarForProvider(provider);
      } catch {
        const target = companyKeyTargetForAdapter(`${provider}_local`);
        return target?.envVar ?? "ANTHROPIC_API_KEY";
      }
    },

    async legacyResolveConfig(cfg) {
      // Caller passes adapterType-specific closure; here we can't know it, so this
      // default is replaced by the call-site wiring (Tasks 11-13) which binds the
      // real adapterType. Kept as identity so unit tests exercise the seam.
      return cfg;
    },

    async legacySubscriptionEnv(_postLegacyEnv) {
      return null;
    },

    selfHostedSingleTenant: topology.trustBoundary !== "multi_tenant",

    // Dark-launch kill-switch: AOA_PROVIDER_RESOLVER=legacy skips the new-model
    // candidate read so every run resolves exactly as it does today (legacy
    // ladder only) with no redeploy.
    bypassNewModel: (process.env.AOA_PROVIDER_RESOLVER?.trim().toLowerCase() ?? "") === "legacy",
  };
}
