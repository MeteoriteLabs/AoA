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
import { sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { createCanaryPreflight } from "../services/canary-preflight.js";
import { createDrizzleCanaryPreflightStore } from "../services/canary-preflight-store.js";
import { derivePlatformDefaultEnvironmentId } from "../services/platform-default-environment.js";
import { startMigratedDatabase } from "./helpers/migrated-database.js";

const ORG = "e1000000-0000-4000-8000-000000000001";
const COMPANY = "e1000000-0000-4000-8000-000000000002";

// A SECOND organization, used only by the company-scoping probes below, so seeding it
// cannot perturb the gate verdict asserted for ORG.
const OTHER_ORG = "e1000000-0000-4000-8000-000000000011";
const NEIGHBOUR = "e1000000-0000-4000-8000-000000000012"; // owns the seeded env + lease
const INTRUDER = "e1000000-0000-4000-8000-000000000013"; // asks about the neighbour's
const NEIGHBOUR_LEASE = "e1000000-0000-4000-8000-000000000014";

// The four tables the non-owner serving role must NEVER be granted. `material` is
// AES-256-GCM secret material; `environment_leases.metadata` is secret-bearing AT REST
// (sanitizeProviderMetadata strips only apiKey|resolvedApiKey, at read time, in memory).
const FORBIDDEN_TABLES = [
  "company_secret_versions",
  "environment_leases",
  "environments",
  "runtime_provider_keys",
] as const;

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";

type Fixture = {
  appDb: Db;
  organizationId: string;
  neighbourEnvironmentId: string;
  teardown: () => Promise<void>;
};

// ONE fixture for the whole describe. An embedded-postgres instance per `it()` leaks
// processes on every lane.
async function setUpRealRoleFixture(): Promise<Fixture> {
  const database = await startMigratedDatabase({ label: "aoa-blocker-e-" });
  const { admin, appDb, teardown } = database;
  try {
    // Seed as ADMIN, read as `aoa_app` — that asymmetry is the whole point.
    //
    // Seeding a Company is MANDATORY: with none the gate short-circuits on `no_companies`
    // (`canary-preflight.ts:132-137`) and the test would pass for the wrong reason. Nothing
    // else is seeded for ORG — no leases, no runtime_provider_keys — so the post-fix verdict
    // is a clean policy refusal rather than an artefact of fixture data.
    await admin`INSERT INTO organizations (id, name, slug)
      VALUES (${ORG}, 'Blocker E org', 'blocker-e-org')`;
    await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
      VALUES (${COMPANY}, ${ORG}, 'Blocker E company', 'BLKE')`;

    // A neighbouring tenant holding real evidence, plus an intruder that holds none. The
    // definer function runs with OWNER authority, so without its `company_id` predicates it
    // would echo the neighbour's rows back to any caller who guesses the id.
    await admin`INSERT INTO organizations (id, name, slug)
      VALUES (${OTHER_ORG}, 'Blocker E neighbour org', 'blocker-e-neighbour-org')`;
    await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
      VALUES (${NEIGHBOUR}, ${OTHER_ORG}, 'Neighbour company', 'NBR')`;
    await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
      VALUES (${INTRUDER}, ${OTHER_ORG}, 'Intruder company', 'INT')`;
    const neighbourEnvironmentId = derivePlatformDefaultEnvironmentId(NEIGHBOUR);
    await admin`INSERT INTO environments (id, company_id, name, driver, status)
      VALUES (${neighbourEnvironmentId}, ${NEIGHBOUR}, 'platform-default-e2b', 'sandbox', 'active')`;
    await admin`INSERT INTO environment_leases
      (id, company_id, environment_id, status, lease_policy)
      VALUES (${NEIGHBOUR_LEASE}, ${NEIGHBOUR}, ${neighbourEnvironmentId}, 'active', 'ephemeral')`;

    return { appDb, organizationId: ORG, neighbourEnvironmentId, teardown };
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

  // Constraint 3, pinned NEGATIVELY and permanently. The fix must widen nothing: a table
  // grant would let `aoa_app` enumerate every company's rows, including AES-256-GCM secret
  // material. Hand-running this once proves nothing about the next commit.
  it.each(FORBIDDEN_TABLES)("still denies `aoa_app` direct SELECT on %s", async (table) => {
    // Drizzle wraps the driver error ("Failed query: …") and hangs the PostgresError off
    // `cause`, so assert on the SQLSTATE rather than on the wrapper's message: 42501 is
    // insufficient_privilege and nothing else.
    let raised: unknown;
    try {
      await fixture!.appDb.execute(sql.raw(`SELECT * FROM ${table} LIMIT 1`));
    } catch (error) {
      raised = error;
    }
    expect(raised, `${table} is readable by aoa_app — a grant crept in`).toBeDefined();
    const cause = (raised as { cause?: unknown }).cause ?? raised;
    expect((cause as { code?: string }).code, table).toBe("42501");
    expect(String((cause as { message?: string }).message ?? ""), table).toMatch(
      /permission denied/i,
    );
  });

  describe("the definer function is company-scoped — no cross-tenant oracle", () => {
    async function evidence(companyId: string, defaultEnvId: string) {
      const result = await fixture!.appDb.execute(
        sql`SELECT lease_id, platform_default_environment_id, key_generation
            FROM public.canary_preflight_evidence(${companyId}::uuid, ${defaultEnvId}::uuid)`,
      );
      return (Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{
        lease_id: string | null;
        platform_default_environment_id: string | null;
      }>;
    }

    // POSITIVE CONTROL. Without this, the negative case below could pass because the probe
    // is broken rather than because the predicate holds.
    it("returns the neighbour's own environment and lease to the neighbour", async () => {
      const rows = await evidence(NEIGHBOUR, fixture!.neighbourEnvironmentId);
      expect(rows.map((row) => row.lease_id)).toEqual([NEIGHBOUR_LEASE]);
      expect(rows[0]?.platform_default_environment_id).toBe(fixture!.neighbourEnvironmentId);
    });

    it("does not echo the neighbour's environment back to a different company", async () => {
      const rows = await evidence(INTRUDER, fixture!.neighbourEnvironmentId);
      expect(rows).toHaveLength(1); // the zero-lease branch still yields exactly one row
      expect(rows[0]?.lease_id).toBeNull();
      expect(
        rows[0]?.platform_default_environment_id,
        "an owner-authority function that confirms another tenant's row id is an existence oracle",
      ).toBeNull();
    });
  });
});
