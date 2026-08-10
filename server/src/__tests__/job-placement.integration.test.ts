import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import {
  applyPendingMigrations,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import {
  canonicalProviderConstraintProfileDigestInputV1,
  canonicalizeJsonV1,
  type ProviderConstraintProfileV1,
  type RegisteredTargetProfileV1,
} from "@armyofagents/worker-protocol";
import * as resolverNamespace from "../services/execution-target-resolver.js";
import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";
import { runInTenant } from "../db/tenant-context.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const ORG_A = "91000000-0000-4000-8000-000000000001";
const ORG_B = "91000000-0000-4000-8000-000000000002";
const TARGET_A = "92000000-0000-4000-8000-000000000001";
const TARGET_B = "92000000-0000-4000-8000-000000000002";
const TARGET_PLATFORM = "92000000-0000-4000-8000-000000000003";
const PASSWORD = "job-009-role-password";
const POLICY_HASH = "a".repeat(64);

const integration = process.env.AOA_RUN_WIN_INTEGRATION === "1" ? describe : describe.skip;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function providerProfile(): ProviderConstraintProfileV1 {
  const unsigned = {
    profileId: "platform-v1",
    version: 1,
    maxContinuousRuntimeSeconds: 3_600,
    maxIdleSeconds: 300,
    resourceCeiling: { cpuMillis: 2_000, memoryMiB: 4_096, pids: 512, diskMiB: 8_192 },
    maxConcurrentOperations: 8,
    supportedOperations: [
      "create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup",
    ],
    localityTags: ["transfer_allowed"],
    checkpointMode: "none",
    healthMode: "none",
  } as const;
  return {
    ...unsigned,
    digest: sha256(canonicalProviderConstraintProfileDigestInputV1(unsigned)),
  };
}

function registeredProfile(provider: ProviderConstraintProfileV1): RegisteredTargetProfileV1 {
  return {
    protocolVersion: 1,
    targetId: TARGET_PLATFORM,
    targetClass: "managed_cloud",
    scope: "platform",
    organizationId: null,
    ownerPrincipalId: null,
    trustCeiling: "shared_isolated",
    credentialCeiling: "platform_brokered",
    dataLocalityCeiling: "transfer_allowed",
    providerConstraints: {
      profileId: provider.profileId,
      version: provider.version,
      digest: provider.digest,
    },
    capabilityCeiling: ["workload.batch", "sandbox.process_isolated"],
    deviceGeneration: 4,
    revokedAt: null,
    policyHash: POLICY_HASH,
  };
}

describe("JOB-009 slice A registry normalization", () => {
  it("normalizes a server-owned target/profile snapshot without trusting the legacy row alone", async () => {
    const provider = providerProfile();
    const registered = registeredProfile(provider);
    const normalize = (resolverNamespace as Record<string, unknown>).normalizePlacementRegistryTarget;
    expect(typeof normalize, "the existing resolver must expose the JOB-009 normalization seam").toBe("function");

    const result = await (normalize as (input: unknown) => Promise<unknown>)({
      id: TARGET_PLATFORM,
      slug: "platform-main",
      kind: "pooled_gvisor",
      trustClass: "shared_multitenant",
      status: "active",
      organizationId: null,
      ownerUserId: null,
      scope: "platform",
      targetAuthorityKey: "platform",
      deviceGeneration: 4,
      registeredProfile: registered,
      registeredProfileHash: sha256(canonicalizeJsonV1(registered)),
      providerConstraintProfile: provider,
      lastSeenAt: new Date("2026-08-10T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      targetId: TARGET_PLATFORM,
      targetClass: "managed_cloud",
      targetScope: "platform",
      targetGeneration: 4,
      profileHash: sha256(canonicalizeJsonV1(registered)),
      providerConstraintHash: provider.digest,
      status: "active",
    });
  });

  it("fails closed when the bounded row and registered E1 profile disagree", async () => {
    const provider = providerProfile();
    const registered = registeredProfile(provider);
    const normalize = (resolverNamespace as Record<string, unknown>).normalizePlacementRegistryTarget;
    expect(typeof normalize).toBe("function");
    await expect((normalize as (input: unknown) => Promise<unknown>)({
      id: TARGET_PLATFORM,
      slug: "platform-main",
      kind: "desktop",
      trustClass: "local_trusted",
      status: "active",
      organizationId: null,
      ownerUserId: null,
      scope: "platform",
      targetAuthorityKey: "platform",
      deviceGeneration: 4,
      registeredProfile: registered,
      registeredProfileHash: sha256(canonicalizeJsonV1(registered)),
      providerConstraintProfile: provider,
      lastSeenAt: new Date("2026-08-10T10:00:00.000Z"),
    })).resolves.toBeNull();
  });
});

integration("JOB-009 slice A schema and role boundaries", () => {
  let embedded: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  let adminUrl = "";
  let admin: Sql | null = null;
  let app: NonOwnerDbConnection | null = null;
  let operator: NonOwnerDbConnection | null = null;
  let setupError: unknown = null;

  function guard() {
    if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
    if (!admin || !app || !operator) throw new Error("test setup incomplete");
    return { admin, app, operator };
  }

  beforeAll(async () => {
    try {
      dataDir = await mkdtemp(join(tmpdir(), "aoa-job-placement-a-"));
      const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
        default: EmbeddedPostgresCtor;
      };
      const port = await allocateEmbeddedPgPort();
      embedded = new EmbeddedPostgres({
        databaseDir: join(dataDir, "db"), user: "test", password: "test", port,
        persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"],
      });
      await embedded.initialise();
      await embedded.start();
      adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
      await applyPendingMigrations(adminUrl);
      admin = postgres(adminUrl, { max: 2 });
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", PASSWORD));
      app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`));
      operator = createOperatorDbConnection(adminUrl.replace("test:test", `aoa_operator:${PASSWORD}`));
      await admin`INSERT INTO organizations (id, name, slug) VALUES
        (${ORG_A}, 'Placement A', 'placement-a'), (${ORG_B}, 'Placement B', 'placement-b')`;
      await admin`INSERT INTO execution_targets
        (id, organization_id, owner_user_id, slug, kind, trust_class, status, capabilities, config,
         scope, target_authority_key, device_generation)
        VALUES
        (${TARGET_A}, ${ORG_A}, NULL, 'placement-a', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
         'organization', ${`organization:${ORG_A}`}, 1),
        (${TARGET_B}, ${ORG_B}, NULL, 'placement-b', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
         'organization', ${`organization:${ORG_B}`}, 1),
        (${TARGET_PLATFORM}, NULL, NULL, 'platform-main', 'pooled_gvisor', 'shared_multitenant', 'active', '{}', '{}',
         'platform', 'platform', 4)`;
    } catch (error) {
      setupError = error;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await operator?.close().catch(() => {});
    await admin?.end().catch(() => {});
    await embedded?.stop().catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it("applies the placement migration at head and replays the journal as a no-op", async () => {
    const { admin } = guard();
    await expect(applyPendingMigrations(adminUrl)).resolves.toBeUndefined();
    const columns = await admin<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (
        (table_name = 'job_attempts' AND column_name IN (
          'placement_disposition', 'placement_owner', 'placement_target_id', 'placement_target_class',
          'placement_target_scope', 'placement_target_generation', 'placement_profile_hash',
          'placement_provider_constraint_hash', 'placement_fallback_disposition', 'placement_reason_code',
          'placement_mode', 'placement_lease_eligible', 'placement_input_digest', 'placement_policy_digest',
          'placement_decided_at'
        )) OR
        (table_name = 'execution_targets' AND column_name IN (
          'registered_profile', 'registered_profile_hash', 'provider_constraint_profile'
        )) OR
        (table_name = 'workers' AND column_name = 'profile_snapshot')
      )
    `;
    expect(columns).toHaveLength(19);
  });

  it("keeps composite target lookup tenant-bound with foreign and missing IDs indistinguishable", async () => {
    const { app } = guard();
    const [foreign, missing, own] = await runInTenant(app.db, ORG_A, async (repos) => Promise.all([
      repos.workerEnrollment.findActiveTarget({ executionTargetId: TARGET_B, scope: "organization", ownerUserId: null }),
      repos.workerEnrollment.findActiveTarget({ executionTargetId: "92000000-0000-4000-8000-000000000099", scope: "organization", ownerUserId: null }),
      repos.workerEnrollment.findActiveTarget({ executionTargetId: TARGET_A, scope: "organization", ownerUserId: null }),
    ]));
    expect(foreign).toBeNull();
    expect(missing).toBeNull();
    expect(own?.id).toBe(TARGET_A);
  });

  it("lets the operator read only bounded null-Organization placement metadata and never jobs", async () => {
    const { operator } = guard();
    const rows = await operator.db.execute<{
      id: string; registered_profile: unknown; registered_profile_hash: string | null;
      provider_constraint_profile: unknown;
    }>(sql`SELECT id, registered_profile, registered_profile_hash, provider_constraint_profile
        FROM execution_targets ORDER BY id`);
    expect(rows.map((row) => row.id)).toEqual([TARGET_PLATFORM]);
    await expect(operator.db.execute(sql`SELECT id FROM jobs`)).rejects.toThrow();
  });
});
