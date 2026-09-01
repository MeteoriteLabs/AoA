// MIG-010 Unit 2.2 — E10-F002 and E7-F004 REPRODUCED on real serving roles.
//
// E10-F002: `reconcileCompanyLegacyResources` and `createDrizzleReconciliationStore` each have
// ZERO non-test callers, so `legacy_resource_reconciliation` is never written and every
// inventory key is unmapped.
//
// E7-F004: the gate re-derives inventory from LIVE `environment_leases` rows, so a lease created
// after a pass is an unmapped key. On a box with traffic the gate can never close.
//
// ★ These tests assert TODAY'S broken behaviour on purpose. When Units 2.3-2.6 land they must be
// INVERTED, not deleted — a deleted test subtracts a failure instead of proving a fix (DSK-003).
//
// Windows-skipped unless AOA_RUN_WIN_INTEGRATION=1 (Issue #114); Linux CI is the authority.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import type { Db } from "@armyofagents/db";
import { createCanaryPreflight } from "../services/canary-preflight.js";
import { createDrizzleCanaryPreflightStore } from "../services/canary-preflight-store.js";
import { startMigratedDatabase } from "./helpers/migrated-database.js";

const ORG = "e2000000-0000-4000-8000-000000000001";
const COMPANY = "e2000000-0000-4000-8000-000000000002";
const ENV = "e2000000-0000-4000-8000-000000000003";
const LEASE_1 = "e2000000-0000-4000-8000-000000000004";
const LEASE_2 = "e2000000-0000-4000-8000-000000000005";
const SECRET = "e2000000-0000-4000-8000-000000000006";

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";

type Fixture = { operatorDb: Db; admin: Sql; teardown: () => Promise<void> };
let fixture: Fixture | null = null;

describe.skipIf(!RUN)("MIG-010 Unit 2.2 — the reconciliation defects, reproduced", () => {
  beforeAll(async () => {
    const database = await startMigratedDatabase({ label: "aoa-mig-010-" });
    const { admin, operatorDb, teardown } = database;
    try {
      await admin`INSERT INTO organizations (id, name, slug)
        VALUES (${ORG}, 'MIG-010 org', 'mig-010-org')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${COMPANY}, ${ORG}, 'MIG-010 company', 'M010')`;

      // ★ The key generation. Without it `canary-preflight.ts:150-156` refuses with
      // `credential_authority_not_moved` BEFORE the closure check, and every assertion below
      // would pass while proving nothing. deriveE2bKeyGeneration walks
      // runtime_provider_keys(provider='e2b', is_default) -> company_secret_versions(status='current').
      await admin`INSERT INTO company_secrets (id, company_id, name, latest_version)
        VALUES (${SECRET}, ${COMPANY}, 'e2b-key', 1)`;
      await admin`INSERT INTO company_secret_versions
        (secret_id, version, material, status, value_sha256)
        VALUES (${SECRET}, 1, '{}'::jsonb, 'current', 'sha-not-a-real-digest')`;
      await admin`INSERT INTO runtime_provider_keys
        (company_id, provider, display_name, secret_id, is_default)
        VALUES (${COMPANY}, 'e2b', 'MIG-010 e2b key', ${SECRET}, TRUE)`;

      // Exactly ONE lease, and NO platform-default environments row, so the inventory is a
      // single key and `unmapped=1` is unambiguous. `provider_lease_id` is set so
      // classifyLease sees a live handle (it is `mapped`, left for drain).
      await admin`INSERT INTO environments (id, company_id, name, driver, status)
        VALUES (${ENV}, ${COMPANY}, 'mig-010-env', 'sandbox', 'active')`;
      await admin`INSERT INTO environment_leases
        (id, company_id, environment_id, status, lease_policy, provider, provider_lease_id)
        VALUES (${LEASE_1}, ${COMPANY}, ${ENV}, 'active', 'ephemeral', 'e2b', 'sbx-1')`;
    } catch (error) {
      await teardown();
      throw error;
    }
    fixture = { operatorDb, admin, teardown };
  }, 180_000);

  afterAll(async () => {
    await fixture?.teardown();
    fixture = null;
  });

  // The gate reads through the operator pool since Unit 1.7 moved EXECUTE there
  // (`index.ts:1256`). Building it per-call keeps each assertion independent.
  const check = () =>
    createCanaryPreflight({
      store: createDrizzleCanaryPreflightStore(fixture!.operatorDb),
    }).check({ organizationId: ORG });
});
