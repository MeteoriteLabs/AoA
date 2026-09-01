// BLOCKER E (E-1) regression — the canary preflight on a REAL `aoa_app` connection.
//
// Every other preflight test injects a fake store (`cli-006-canary-preflight-store.test.ts:44`
// literally constructs the store with `{} as never`), so none of them can observe what
// actually broke: the store runs on the NON-OWNER `aoa_app` pool and is permission-denied on
// three of its evidence reads (`environment_leases`, `environments`, and the
// `runtime_provider_keys` -> `company_secret_versions` pointer chain). Each raises 42501, the
// catch at `canary-preflight.ts:191-200` folds it into `preflight_error`, and
// `run-execution-owner.ts:254-257` returns owner="legacy".
//
// This asserts the DISTINCTION, not the outcome. The gate SHOULD still refuse — E-2 and E-3
// are unfixed, and this fixture seeds no BYO e2b key so provider-control authority has not
// moved. What it may never do is refuse because it could not READ: an unreadability refusal
// is unfalsifiable and indistinguishable from a policy decision.
//
// Windows-skipped unless AOA_RUN_WIN_INTEGRATION=1 (embedded-postgres cannot start on the
// `runneradmin` CI runner — Issue #114); Linux CI is the authority.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import {
  applyPendingMigrations,
  createTenantAppDbConnection,
  type Db,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import { createCanaryPreflight } from "../services/canary-preflight.js";
import { createDrizzleCanaryPreflightStore } from "../services/canary-preflight-store.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const PASSWORD = "blocker-e-real-role-password";
const ORG = "e1000000-0000-4000-8000-000000000001";
const COMPANY = "e1000000-0000-4000-8000-000000000002";

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";

type Fixture = {
  appDb: Db;
  organizationId: string;
  teardown: () => Promise<void>;
};

// ONE fixture for the whole describe. An embedded-postgres instance per `it()` leaks
// processes on every lane.
async function setUpRealRoleFixture(): Promise<Fixture> {
  const dataDir = await mkdtemp(join(tmpdir(), "aoa-blocker-e-"));
  const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
    default: EmbeddedPostgresCtor;
  };
  const port = await allocateEmbeddedPgPort();
  const embedded = new EmbeddedPostgres({
    databaseDir: join(dataDir, "db"),
    user: "test",
    password: "test",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  let admin: Sql | null = null;
  let app: NonOwnerDbConnection | null = null;
  const teardown = async () => {
    await app?.close({ timeoutSeconds: 5 }).catch(() => {});
    await admin?.end().catch(() => {});
    await embedded.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  };
  try {
    await embedded.initialise();
    await embedded.start();
    const adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await applyPendingMigrations(adminUrl);
    admin = postgres(adminUrl, { max: 2 });
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
    app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`), {
      max: 4,
    });

    // Seed as ADMIN, read as `aoa_app` — that asymmetry is the whole point.
    //
    // Seeding a Company is MANDATORY: with none the gate short-circuits on `no_companies`
    // (`canary-preflight.ts:132-137`) and the test would pass for the wrong reason. Nothing
    // else is seeded — no leases, no runtime_provider_keys — so the post-fix verdict is a
    // clean policy refusal rather than an artefact of fixture data.
    await admin`INSERT INTO organizations (id, name, slug)
      VALUES (${ORG}, 'Blocker E org', 'blocker-e-org')`;
    await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
      VALUES (${COMPANY}, ${ORG}, 'Blocker E company', 'BLKE')`;

    return { appDb: app.db, organizationId: ORG, teardown };
  } catch (error) {
    await teardown();
    throw error;
  }
}

describe.skipIf(!RUN)("BLOCKER E — canary preflight on a real aoa_app connection", () => {
  let fixture: Fixture | null = null;

  beforeAll(async () => {
    fixture = await setUpRealRoleFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.teardown();
  }, 60_000);

  function gate() {
    if (!fixture) throw new Error("real-role fixture was not initialized");
    return createCanaryPreflight({
      store: createDrizzleCanaryPreflightStore(fixture.appDb),
    });
  }

  it("does not refuse with preflight_error", async () => {
    const result = await gate().check({ organizationId: fixture!.organizationId });

    // Assert on the REASON, never on which table name surfaces: `canary-preflight.ts:139-145`
    // fires the reads in one unordered `Promise.all`, so which of the 42501s wins is
    // race-dependent.
    expect(
      result.ok ? null : result.reason,
      "an unreadable gate is a closed gate that cannot say why — this is Blocker E",
    ).not.toBe("preflight_error");
  });

  it("gives a policy reason, with no permission error in the detail", async () => {
    const result = await gate().check({ organizationId: fixture!.organizationId });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The expected reason is `credential_authority_not_moved`, NOT
      // `reconciliation_incomplete`: `canary-preflight.ts:150-156` checks the key generation
      // BEFORE closure is evaluated, and this fixture seeds no BYO e2b key, so
      // `deriveE2bKeyGeneration` returns null (the operator env default — ungenerationed).
      expect(result.reason).toBe("credential_authority_not_moved");
      expect(result.detail ?? "").not.toMatch(/permission denied/i);
    }
  });
});
