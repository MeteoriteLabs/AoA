// MIG-010 Unit 2.3 — E10-F002's MECHANISM, reproduced on the real serving role.
//
// The filed headline is a caller count. Its mechanism is narrower and worse: even WITH a
// caller, the pass raises 42501 on its very first read. `OPERATOR_SERVING_RELATIONS`
// (job-control-legacy-grants.ts:319-321) grants `aoa_operator` exactly one crosswalk
// relation — `legacy_resource_reconciliation` — and NOTHING on `environment_leases`,
// `environments`, `runtime_provider_keys` or `company_secret_versions`. So wiring a caller
// to `operatorDb` as the store stood would have produced a permission error, not a pass.
//
// ★ This file asserts TODAY'S broken behaviour on purpose. Unit 2.3 INVERTS it in place
// (Task 7 Step 3) rather than deleting it — a deleted test subtracts a failure instead of
// proving a fix (DSK-003).
//
// Windows-skipped unless AOA_RUN_WIN_INTEGRATION=1 (Issue #114); Linux CI is the authority.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import type { Db } from "@armyofagents/db";
import { createDrizzleReconciliationStore } from "../services/legacy-resource-reconciliation-store.js";
import { startMigratedDatabase } from "./helpers/migrated-database.js";

const ORG = "e3000000-0000-4000-8000-000000000001";
const COMPANY = "e3000000-0000-4000-8000-000000000002";
const ENV = "e3000000-0000-4000-8000-000000000003";
const LEASE_1 = "e3000000-0000-4000-8000-000000000004";
const SECRET = "e3000000-0000-4000-8000-000000000006";

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";

type Fixture = { operatorDb: Db; admin: Sql; teardown: () => Promise<void> };
let fixture: Fixture | null = null;

describe.skipIf(!RUN)("MIG-010 Unit 2.3 — the reconciliation pass, made runnable", () => {
  beforeAll(async () => {
    const database = await startMigratedDatabase({ label: "aoa-mig-010-u23-" });
    const { admin, operatorDb, teardown } = database;
    try {
      await admin`INSERT INTO organizations (id, name, slug)
        VALUES (${ORG}, 'MIG-010 u2.3 org', 'mig-010-u23-org')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${COMPANY}, ${ORG}, 'MIG-010 u2.3 company', 'M23')`;

      // ★ The key generation. Without it `canary-preflight.ts:150-156` refuses with
      // `credential_authority_not_moved` BEFORE the closure check, and every gate assertion
      // in this file would pass while proving nothing. The pass reads the same generation
      // through the same `0267` scalars function, so this seeding is load-bearing twice.
      await admin`INSERT INTO company_secrets (id, company_id, name, latest_version)
        VALUES (${SECRET}, ${COMPANY}, 'e2b-key', 1)`;
      await admin`INSERT INTO company_secret_versions
        (secret_id, version, material, status, value_sha256)
        VALUES (${SECRET}, 1, '{}'::jsonb, 'current', 'sha-not-a-real-digest')`;
      await admin`INSERT INTO runtime_provider_keys
        (company_id, provider, display_name, secret_id, is_default)
        VALUES (${COMPANY}, 'e2b', 'MIG-010 u2.3 e2b key', ${SECRET}, TRUE)`;

      // Exactly ONE lease, and NO platform-default environments row, so the inventory is a
      // single key. `provider_lease_id` is set so classifyLease sees a live handle — the
      // record is `mapped`, left for drain, and carries an attribution hash.
      await admin`INSERT INTO environments (id, company_id, name, driver, status)
        VALUES (${ENV}, ${COMPANY}, 'mig-010-u23-env', 'sandbox', 'active')`;
      await admin`INSERT INTO environment_leases
        (id, company_id, environment_id, status, lease_policy, provider, provider_lease_id)
        VALUES (${LEASE_1}, ${COMPANY}, ${ENV}, 'active', 'ephemeral', 'e2b', 'sbx-u23-1')`;
    } catch (error) {
      await teardown();
      throw error;
    }
    fixture = { operatorDb, admin, teardown };
  }, 180_000);

  afterAll(async () => {
    await fixture?.teardown();
    fixture = null;
    // 60s to match the Unit 2.2 repro: on the default hook timeout a slow embedded-postgres
    // teardown fails THIS file, which reads as a defect in the code under test rather than
    // as the shutdown being slow.
  }, 60_000);

  it("[E10-F002] TODAY the pass cannot even read: aoa_operator is denied on environment_leases", async () => {
    const store = createDrizzleReconciliationStore(fixture!.operatorDb);
    // ★ If this ever fails because the read SUCCEEDS, that is a BIGGER finding than this
    // unit: the operator role would hold a grant `job-control-legacy-grants.ts` does not
    // declare, and the authority manifest is an exact allowlist, not a partial one.
    //
    // ★ THE CODE IS ON `cause`, NOT ON THE ERROR. drizzle wraps every driver failure in a
    // `DrizzleQueryError` whose `message` is the rendered SQL; the PostgresError carrying
    // `code` is its `cause`. A top-level `{ code: "42501" }` matcher does NOT fail loudly
    // here -- it fails with a diff that looks like a shape quibble while the denial it was
    // written to catch is present. Pin the relation too: a bare 42501 would also match a
    // denial on some other table and would keep passing after this one is fixed.
    // ★ `(ORG, COMPANY)` since Unit 2.3 org-scoped the store. Every member takes the pair
    // now, and a stale one-arg call lands COMPANY in `organizationId` and leaves companyId
    // undefined -- which fails as UNDEFINED_VALUE, not 42501. Pinning the code AND the
    // message is what makes that visible instead of green-and-meaningless.
    await expect(store.listLeases(ORG, COMPANY)).rejects.toMatchObject({
      cause: { code: "42501", message: "permission denied for table environment_leases" },
    });
  });
});
