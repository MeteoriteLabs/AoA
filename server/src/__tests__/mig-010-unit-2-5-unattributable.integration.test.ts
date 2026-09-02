// MIG-010 Unit 2.5 — E7-F006's MECHANISM, on a real database, and its remedy.
//
// THE FINDING. `assertClosure` fails on ANY record whose disposition is `unattributable`
// (`legacy-resource-reconciliation.ts:290`), and `resolveResourceType` produces that
// disposition for a lease that is not `ephemeral` and carries no `agentId`,
// `commanderConversationId` or `executionWorkspaceId` (`:95-101`). The crosswalk is
// APPEND-ONLY: migration `0256` grants no DELETE, `insertRecordIfAbsent` is
// `onConflictDoNothing`, and no application code updates a record. So one such record
// refuses the canary gate PERMANENTLY, and neither the pass nor the gate can clear it.
//
// ★ IT WAS LATENT UNTIL WE MADE IT REACHABLE. Unit 2.3 gave the pass its first caller and
// Unit 2.4 made the gate read the pass's durable output. This file is the reproduction that
// had to exist before the remedy, not after it.
//
// ★ THE CASES SHARE ONE FIXTURE AND RUN IN ORDER, deliberately — the same shape the Unit 2.2
// repro and the Unit 2.3 pass test use. Task 1 asserts the trap and its permanence; Task 3
// then runs the resolution command against the SAME record and asserts the gate opens. That
// before/after sequence is the evidence, so these are not independently runnable with `-t`.
//
// TWO ORGANIZATIONS, on purpose. The gate is organization-scoped and refuses on the first
// failing Company, so a poisoned Company would mask every later assertion about a healthy
// one. ORG_A carries the orphan lease; ORG_B carries the agent-owned lease whose owner is
// then deleted.
//
// Windows-skipped unless AOA_RUN_WIN_INTEGRATION=1 (Issue #114); Linux CI is the authority.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import type { Db } from "@armyofagents/db";
import { createCanaryPreflight } from "../services/canary-preflight.js";
import { createDrizzleCanaryPreflightStore } from "../services/canary-preflight-store.js";
import { reconcileOrganizationLegacyResources } from "../services/legacy-resource-reconciliation.js";
import { createDrizzleReconciliationStore } from "../services/legacy-resource-reconciliation-store.js";
import { startMigratedDatabase } from "./helpers/migrated-database.js";

// ORG_A — the orphan lease: not `ephemeral`, no owner FK at all. This is the shape
// `resolveResourceType` cannot classify.
const ORG_A = "e5000000-0000-4000-8000-000000000001";
const COMPANY_A = "e5000000-0000-4000-8000-000000000002";
const ENV_A = "e5000000-0000-4000-8000-000000000003";
const LEASE_A = "e5000000-0000-4000-8000-000000000004";
const SECRET_A = "e5000000-0000-4000-8000-000000000005";

// ORG_B — the agent-owned lease. Classifiable today; unclassifiable the moment the founder
// deletes the agent, because `environment_leases.agent_id` is ON DELETE SET NULL.
const ORG_B = "e5000000-0000-4000-8000-000000000011";
const COMPANY_B = "e5000000-0000-4000-8000-000000000012";
const ENV_B = "e5000000-0000-4000-8000-000000000013";
const LEASE_B = "e5000000-0000-4000-8000-000000000014";
const SECRET_B = "e5000000-0000-4000-8000-000000000015";
const AGENT_B = "e5000000-0000-4000-8000-000000000016";

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";

type Fixture = {
  operatorDb: Db;
  admin: Sql;
  adminUrl: string;
  operatorUrl: string;
  teardown: () => Promise<void>;
};
let fixture: Fixture | null = null;

/** Run the real pass, as the real serving role, exactly as the operator CLI does. */
async function runPass(organizationId: string) {
  return reconcileOrganizationLegacyResources(organizationId, {
    store: createDrizzleReconciliationStore(fixture!.operatorDb),
  });
}

/** The real gate, on the real serving role. */
async function runGate(organizationId: string) {
  const preflight = createCanaryPreflight({
    store: createDrizzleCanaryPreflightStore(fixture!.operatorDb),
  });
  return preflight.check({ organizationId });
}

async function crosswalkRows(companyId: string) {
  return fixture!.admin`
    SELECT id, resource_key, resource_type, disposition, cleanup_outcome, reason, created_at
    FROM legacy_resource_reconciliation WHERE company_id = ${companyId} ORDER BY resource_key`;
}

describe.skipIf(!RUN)("MIG-010 Unit 2.5 — E7-F006: an unattributable record and its remedy", () => {
  beforeAll(async () => {
    const database = await startMigratedDatabase({ label: "aoa-mig-010-u25-" });
    const { admin, operatorDb, adminUrl, operatorUrl, teardown } = database;
    try {
      // --- ORG_A: the orphan lease ------------------------------------------------
      await admin`INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_A}, 'MIG-010 u2.5 org A', 'mig-010-u25-org-a')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${COMPANY_A}, ${ORG_A}, 'MIG-010 u2.5 company A', 'M5A')`;
      // The key generation. Without it the gate refuses `credential_authority_not_moved`
      // BEFORE the closure check and every assertion here would pass while proving nothing.
      await admin`INSERT INTO company_secrets (id, company_id, name, latest_version)
        VALUES (${SECRET_A}, ${COMPANY_A}, 'e2b-key', 1)`;
      await admin`INSERT INTO company_secret_versions
        (secret_id, version, material, status, value_sha256)
        VALUES (${SECRET_A}, 1, '{}'::jsonb, 'current', 'sha-not-a-real-digest')`;
      await admin`INSERT INTO runtime_provider_keys
        (company_id, provider, display_name, secret_id, is_default)
        VALUES (${COMPANY_A}, 'e2b', 'u2.5 A e2b key', ${SECRET_A}, TRUE)`;
      await admin`INSERT INTO environments (id, company_id, name, driver, status)
        VALUES (${ENV_A}, ${COMPANY_A}, 'mig-010-u25-env-a', 'sandbox', 'active')`;
      // ★ THE ORPHAN. `lease_policy` is NOT 'ephemeral' (so the first arm of
      // `resolveResourceType` does not fire) and all three owner FKs are NULL, so the
      // function returns null and `classifyLease` answers `unattributable`.
      await admin`INSERT INTO environment_leases
        (id, company_id, environment_id, status, lease_policy, provider, provider_lease_id)
        VALUES (${LEASE_A}, ${COMPANY_A}, ${ENV_A}, 'active', 'reuse_by_agent', 'e2b', 'sbx-u25-a')`;

      // --- ORG_B: the agent-owned lease -------------------------------------------
      await admin`INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_B}, 'MIG-010 u2.5 org B', 'mig-010-u25-org-b')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${COMPANY_B}, ${ORG_B}, 'MIG-010 u2.5 company B', 'M5B')`;
      await admin`INSERT INTO company_secrets (id, company_id, name, latest_version)
        VALUES (${SECRET_B}, ${COMPANY_B}, 'e2b-key', 1)`;
      await admin`INSERT INTO company_secret_versions
        (secret_id, version, material, status, value_sha256)
        VALUES (${SECRET_B}, 1, '{}'::jsonb, 'current', 'sha-not-a-real-digest')`;
      await admin`INSERT INTO runtime_provider_keys
        (company_id, provider, display_name, secret_id, is_default)
        VALUES (${COMPANY_B}, 'e2b', 'u2.5 B e2b key', ${SECRET_B}, TRUE)`;
      await admin`INSERT INTO environments (id, company_id, name, driver, status)
        VALUES (${ENV_B}, ${COMPANY_B}, 'mig-010-u25-env-b', 'sandbox', 'active')`;
      await admin`INSERT INTO agents (id, company_id, name, kind)
        VALUES (${AGENT_B}, ${COMPANY_B}, 'u2.5 warm agent', 'org')`;
      await admin`INSERT INTO environment_leases
        (id, company_id, environment_id, agent_id, status, lease_policy, provider, provider_lease_id)
        VALUES (${LEASE_B}, ${COMPANY_B}, ${ENV_B}, ${AGENT_B}, 'active', 'reuse_by_agent', 'e2b', 'sbx-u25-b')`;
    } catch (error) {
      await teardown();
      throw error;
    }
    fixture = { operatorDb, admin, adminUrl, operatorUrl, teardown };
  }, 180_000);

  afterAll(async () => {
    await fixture?.teardown();
    fixture = null;
    // 60s to match the Unit 2.2/2.3 fixtures: on the default hook timeout a slow
    // embedded-postgres teardown fails THIS file, which reads as a defect in the code under
    // test rather than as the shutdown being slow.
  }, 60_000);

  // --- TASK 1 STEP 1: THE TRAP -------------------------------------------------

  it("[E7-F006] a lease with no owner FK reconciles as `unattributable`, durably", async () => {
    const result = await runPass(ORG_A);

    expect(result.companies.map((c) => c.companyId)).toEqual([COMPANY_A]);
    expect(result.insertedKeys).toEqual([LEASE_A]);
    // The pass itself refuses: closure is false BECAUSE of the unattributable set, not
    // because anything is unmapped or duplicated.
    expect(result.ok).toBe(false);
    expect(result.unattributableKeys).toEqual([LEASE_A]);
    const [company] = result.companies;
    expect(company!.closure).toMatchObject({
      ok: false,
      unmapped: [],
      duplicates: [],
      unattributable: [LEASE_A],
    });

    // And it is ON DISK, in the append-only crosswalk, with the honest sentinel type.
    const rows = await crosswalkRows(COMPANY_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resource_key).toBe(LEASE_A);
    expect(rows[0]!.disposition).toBe("unattributable");
    expect(rows[0]!.resource_type).toBe("unattributable");
    expect(rows[0]!.cleanup_outcome).toBeNull();
  }, 120_000);

  it("[E7-F006] the gate refuses `reconciliation_incomplete` with unattributable=1 in the DETAIL", async () => {
    const result = await runGate(ORG_A);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("reconciliation_incomplete");
    expect(result.companyId).toBe(COMPANY_A);
    // ★ THE COUNT, NOT JUST THE REASON. Unit 2.2 proved the reason alone discriminates
    // nothing: `reconciliation_incomplete` is emitted by exactly one refusal site, but that
    // site is reached by THREE different closure arms — unmapped, duplicates, and
    // unattributable — and the detail is the only thing that says which one fired. Asserting
    // the reason alone would pass identically for an unmapped key, which is a different bug
    // with a different remedy.
    expect(result.detail).toContain("unattributable=1");
    expect(result.detail).toContain("unmapped=0");
    expect(result.detail).toContain("duplicates=0");
  }, 120_000);

  // --- TASK 1 STEP 2: DELETING AN AGENT SPRINGS IT -----------------------------

  it("an agent-owned lease reconciles as `mapped`, and ORG_B's gate closes", async () => {
    const result = await runPass(ORG_B);
    expect(result.ok).toBe(true);
    expect(result.insertedKeys).toEqual([LEASE_B]);

    const rows = await crosswalkRows(COMPANY_B);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.disposition).toBe("mapped");
    expect(rows[0]!.resource_type).toBe("warm_org");

    const gate = await runGate(ORG_B);
    if (!gate.ok) throw new Error(`gate refused ${gate.reason}: ${gate.detail}`);
    expect(gate.ok).toBe(true);
  }, 120_000);

  it("★ deleting the agent makes the pass refuse — and the SECOND pass writes NOTHING", async () => {
    const before = await crosswalkRows(COMPANY_B);

    // Ordinary operation, not corruption: a founder removes an agent.
    // `environment_leases.agent_id` is `ON DELETE SET NULL`, so the lease survives with a
    // null owner and `resolveResourceType` can no longer classify it.
    await fixture!.admin`DELETE FROM agents WHERE id = ${AGENT_B}`;
    const leaseRows = await fixture!.admin`
      SELECT agent_id FROM environment_leases WHERE id = ${LEASE_B}`;
    expect(leaseRows).toHaveLength(1);
    expect(leaseRows[0]!.agent_id).toBeNull();

    const result = await runPass(ORG_B);

    // The pass now classifies the SAME lease as unattributable and refuses.
    expect(result.ok).toBe(false);
    expect(result.unattributableKeys).toEqual([LEASE_B]);

    // ★ WHAT IS ACTUALLY OBSERVED, NOT WHAT ONE WOULD EXPECT. `insertRecordIfAbsent` is
    // `onConflictDoNothing` on `(company_id, resource_key)` and a record for this lease
    // already exists, so the newly-unattributable record is NEVER WRITTEN. The row on disk
    // is still `mapped`, byte for byte — same id, same created_at.
    expect(result.insertedKeys).toEqual([]);
    const after = await crosswalkRows(COMPANY_B);
    expect(after).toEqual(before);
    expect(after[0]!.disposition).toBe("mapped");

    // ★★★ AND SO THE GATE AND THE PASS NOW DISAGREE. The gate re-derives closure from the
    // PERSISTED records, which still say `mapped`, so it opens — while the operator's own
    // pass exits non-zero and will do so on every future run, with no record for the
    // resolution command of Task 2 to act on (that command resolves an `unattributable`
    // RECORD, and there is none here).
    //
    // This is asserted rather than asserted-away because it is the observed behaviour and
    // it is the more dangerous half of E7-F006: the durable-record trap of ORG_A refuses
    // fail-CLOSED and has a remedy; this arm diverges fail-OPEN and does not. Reported with
    // the unit rather than silently fixed — widening the remedy to rewrite a `mapped`
    // record is exactly the forgeable transition design section 9.2 forbids.
    const gate = await runGate(ORG_B);
    expect(gate.ok).toBe(true);
  }, 120_000);

  // --- TASK 1 STEP 3: PERMANENCE ------------------------------------------------

  it("[E7-F006] permanence: re-running the pass cannot clear ORG_A's unattributable record", async () => {
    const before = await crosswalkRows(COMPANY_A);

    const second = await runPass(ORG_A);
    expect(second.ok).toBe(false);
    expect(second.insertedKeys).toEqual([]);
    expect(second.unattributableKeys).toEqual([LEASE_A]);

    // Row identity included — `id` and `created_at` unchanged proves the record was not
    // deleted and rewritten, which a count-only assertion would not distinguish.
    const after = await crosswalkRows(COMPANY_A);
    expect(after).toEqual(before);
    expect(after[0]!.disposition).toBe("unattributable");

    // And the gate still refuses, for the same reason with the same count.
    const gate = await runGate(ORG_A);
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toBe("reconciliation_incomplete");
    expect(gate.detail).toContain("unattributable=1");
  }, 120_000);

  it("[E7-F006] and NO application path can clear it: the operator holds no DELETE grant", async () => {
    // The permanence is a GRANT, not a convention. `aoa_operator` holds SELECT/INSERT/UPDATE
    // and nothing else (`job-control-legacy-grants.ts:319-321`, migration 0256), so a delete
    // is refused by PostgreSQL itself. Asserting the privilege catalog rather than attempting
    // the DELETE keeps the fixture intact for Task 3.
    const grants = await fixture!.admin`
      SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'aoa_operator' AND table_name = 'legacy_resource_reconciliation'
      ORDER BY privilege_type`;
    expect(grants.map((g) => g.privilege_type)).toEqual(["INSERT", "SELECT", "UPDATE"]);

    // ★ And the UPDATE has no consumer yet. Until Task 2 there is no application or operator
    // code that issues one, which is precisely why the record is permanent today.
  }, 120_000);
});
