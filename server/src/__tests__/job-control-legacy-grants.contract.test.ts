import { describe, expect, it } from "vitest";
import {
  APP_MCP_API_KEY_COLUMN_GRANTS,
  JOB_CONTROL_LEGACY_GRANTS,
  JOB_CONTROL_NEW_PATH_GRANTS,
  JOB_LEASING_NEW_PATH_GRANTS,
} from "../db/job-control-legacy-grants.js";
import * as grants from "../db/job-control-legacy-grants.js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("JOB-001 bounded aoa_app authority", () => {
  it("adds the outbox as a forced-RLS new-path table with exact DML", () => {
    const submissionNewPath = (grants as typeof grants & {
      JOB_SUBMISSION_NEW_PATH_GRANTS?: Record<string, readonly string[]>;
    }).JOB_SUBMISSION_NEW_PATH_GRANTS;
    expect(JOB_CONTROL_NEW_PATH_GRANTS).not.toHaveProperty("job_outbox");
    expect(submissionNewPath).toHaveProperty("job_outbox", [
      "SELECT", "INSERT", "UPDATE", "DELETE",
    ]);
    const migration = readFileSync(
      fileURLToPath(new URL("../../../packages/db/src/migrations/0218_job_control_submission_rls.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('ALTER TABLE "job_outbox" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "job_outbox_tenant_isolation"');
  });

  it("admits the org/company/membership edge and source agent with read-only legacy grants", () => {
    const submissionLegacy = (grants as typeof grants & {
      JOB_SUBMISSION_LEGACY_GRANTS?: Record<string, readonly string[]>;
    }).JOB_SUBMISSION_LEGACY_GRANTS;
    expect(JOB_CONTROL_LEGACY_GRANTS).toMatchObject({
      organizations: ["SELECT"],
      companies: expect.arrayContaining(["SELECT"]),
      company_memberships: ["SELECT"],
      agents: expect.arrayContaining(["SELECT"]),
      heartbeat_runs: expect.arrayContaining(["SELECT"]),
      issues: expect.arrayContaining(["SELECT"]),
    });
    expect(JOB_CONTROL_LEGACY_GRANTS).not.toHaveProperty("organization_memberships");
    expect(submissionLegacy).toHaveProperty("organization_memberships", ["SELECT"]);
    expect(submissionLegacy?.organization_memberships).not.toEqual(
      expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]),
    );
    expect(JOB_CONTROL_LEGACY_GRANTS).not.toHaveProperty("mcp_api_keys");
    expect(APP_MCP_API_KEY_COLUMN_GRANTS).toEqual(["id", "company_id", "user_id", "revoked_at"]);
  });

  it("does not grant worker contact or target placement authority", () => {
    expect(JOB_CONTROL_LEGACY_GRANTS).not.toHaveProperty("execution_targets");
    expect(JOB_CONTROL_LEGACY_GRANTS).not.toHaveProperty("worker_sessions");
    expect(JOB_CONTROL_LEGACY_GRANTS).not.toHaveProperty("worker_enrollment_codes");
  });
});

describe("JOB-003 bounded aoa_app authority", () => {
  it("keeps receipt and rejection-certificate DML in the exact versioned leasing grant delta", () => {
    expect(JOB_CONTROL_NEW_PATH_GRANTS).not.toHaveProperty("worker_operation_receipts");
    expect(JOB_LEASING_NEW_PATH_GRANTS).toEqual({
      worker_operation_receipts: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      worker_lease_rejections: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    });

    const migration = readFileSync(
      fileURLToPath(new URL("../../../packages/db/src/migrations/0228_job_leasing_rls.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "worker_operation_receipts" TO "aoa_app"',
    );
    expect(migration).toContain('ALTER TABLE "worker_operation_receipts" FORCE ROW LEVEL SECURITY');

    const migrationDirectory = fileURLToPath(
      new URL("../../../packages/db/src/migrations/", import.meta.url),
    );
    const rlsSuccessors = readdirSync(migrationDirectory).filter((name) => /^0231_.*\.sql$/.test(name));
    expect.soft(rlsSuccessors).toHaveLength(1);
    if (rlsSuccessors.length !== 1) return;
    const certificateMigration = readFileSync(`${migrationDirectory}/${rlsSuccessors[0]}`, "utf8");
    expect(certificateMigration).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "worker_lease_rejections" TO "aoa_app"',
    );
    expect(certificateMigration).toMatch(
      /REVOKE ALL ON(?: TABLE)? "worker_lease_rejections" FROM "aoa_operator"/,
    );
    expect(certificateMigration).toContain(
      'ALTER TABLE "worker_lease_rejections" FORCE ROW LEVEL SECURITY',
    );
  });

  it("derives one immutable serving-relation inventory from every table and column grant", () => {
    // Mutation caught: a hand-maintained startup list can omit a column-only relation or retain
    // a removed grant while the authority constants continue to look correct in isolation.
    const manifest = grants as typeof grants & {
      APP_SERVING_RELATIONS?: readonly string[];
      OPERATOR_SERVING_RELATIONS?: readonly string[];
    };
    const appExpected = [...new Set([
      ...Object.keys(grants.JOB_CONTROL_LEGACY_GRANTS),
      ...Object.keys(grants.JOB_CONTROL_NEW_PATH_GRANTS),
      ...Object.keys(grants.JOB_SUBMISSION_LEGACY_GRANTS),
      ...Object.keys(grants.JOB_SUBMISSION_NEW_PATH_GRANTS),
      ...Object.keys(grants.WORKER_ENROLLMENT_APP_GRANTS),
      ...Object.keys(grants.JOB_LEASING_NEW_PATH_GRANTS),
      "mcp_api_keys",
      "execution_targets",
    ])].sort();
    const operatorExpected = [...new Set([
      ...Object.keys(grants.WORKER_ENROLLMENT_OPERATOR_GRANTS),
      ...Object.keys(grants.OPERATOR_METADATA_COLUMN_GRANTS),
      "execution_targets",
    ])].sort();
    expect(manifest.APP_SERVING_RELATIONS).toEqual(appExpected);
    expect(manifest.OPERATOR_SERVING_RELATIONS).toEqual(operatorExpected);
    expect(Object.isFrozen(manifest.APP_SERVING_RELATIONS)).toBe(true);
    expect(Object.isFrozen(manifest.OPERATOR_SERVING_RELATIONS)).toBe(true);
  });

  it("pins the exact 15-table RLS, 14-table FORCE, and 22-row permissive policy certificate", () => {
    const manifest = grants as typeof grants & {
      RLS_RELATIONS?: readonly string[];
      FORCE_RLS_RELATIONS?: readonly string[];
      NON_FORCE_RLS_RELATIONS?: readonly string[];
      POLICY_COUNTS?: Readonly<Record<string, number>>;
      RLS_POLICY_MANIFEST?: readonly Array<{
        relation: string;
        name: string;
        command: string;
        role: string;
        permissive: boolean;
        qual: string | null;
        check: string | null;
      }>;
    };
    const rls = [
      "jobs", "job_attempts", "leases", "workers", "services", "service_instances",
      "job_artifacts", "job_secret_handles", "job_outbox", "worker_enrollment_code_routes",
      "worker_enrollment_codes", "worker_proof_replays", "execution_targets",
      "worker_operation_receipts", "worker_lease_rejections",
    ];
    const counts = {
      jobs: 1, job_attempts: 1, leases: 1, workers: 2, services: 1,
      service_instances: 1, job_artifacts: 1, job_secret_handles: 1, job_outbox: 1,
      worker_enrollment_code_routes: 3, worker_enrollment_codes: 2,
      worker_proof_replays: 2, execution_targets: 3, worker_operation_receipts: 1,
      worker_lease_rejections: 1,
    };
    const ORG = "(organization_id = (current_setting('aoa.organization_id'::text, true))::uuid)";
    const CANDIDATE_ORG = "(candidate_organization_id = (current_setting('aoa.organization_id'::text, true))::uuid)";
    const NULL_ORG = "(organization_id IS NULL)";
    const NULL_CANDIDATE_ORG = "(candidate_organization_id IS NULL)";
    const PLATFORM_WORKER = "((organization_id IS NULL) AND (scope = 'platform'::text))";
    const TENANT_TARGET = "((organization_id IS NULL) OR (organization_id = (current_setting('aoa.organization_id'::text, true))::uuid))";
    const PLATFORM_TARGET = "((organization_id IS NULL) AND (owner_user_id IS NULL))";
    const policy = (
      relation: string,
      name: string,
      command: string,
      role: string,
      qual: string,
      check: string | null,
    ) => ({ relation, name, command, role, permissive: true, qual, check });
    const policies = [
      policy("jobs", "jobs_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("job_attempts", "job_attempts_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("leases", "leases_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("workers", "workers_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("services", "services_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("service_instances", "service_instances_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("job_artifacts", "job_artifacts_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("job_secret_handles", "job_secret_handles_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("job_outbox", "job_outbox_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("worker_enrollment_code_routes", "worker_enrollment_code_routes_tenant_isolation", "ALL", "aoa_app", CANDIDATE_ORG, CANDIDATE_ORG),
      policy("worker_enrollment_code_routes", "worker_enrollment_code_routes_platform_operator", "ALL", "aoa_operator", NULL_CANDIDATE_ORG, NULL_CANDIDATE_ORG),
      policy("worker_enrollment_code_routes", "worker_enrollment_code_routes_operator_discovery", "SELECT", "aoa_operator", "true", null),
      policy("worker_enrollment_codes", "worker_enrollment_codes_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("worker_enrollment_codes", "worker_enrollment_codes_platform_operator", "ALL", "aoa_operator", NULL_ORG, NULL_ORG),
      policy("worker_proof_replays", "worker_proof_replays_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("worker_proof_replays", "worker_proof_replays_platform_operator", "ALL", "aoa_operator", NULL_ORG, NULL_ORG),
      policy("workers", "workers_platform_operator", "ALL", "aoa_operator", PLATFORM_WORKER, PLATFORM_WORKER),
      policy("execution_targets", "execution_targets_tenant_serving", "SELECT", "aoa_app", TENANT_TARGET, null),
      policy("execution_targets", "execution_targets_platform_operator", "ALL", "aoa_operator", PLATFORM_TARGET, PLATFORM_TARGET),
      policy("execution_targets", "execution_targets_tenant_enrollment_update", "UPDATE", "aoa_app", ORG, ORG),
      policy("worker_operation_receipts", "worker_operation_receipts_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
      policy("worker_lease_rejections", "worker_lease_rejections_tenant_isolation", "ALL", "aoa_app", ORG, ORG),
    ];
    expect(manifest.RLS_RELATIONS).toEqual(rls);
    expect(manifest.FORCE_RLS_RELATIONS).toEqual(rls.filter((relation) => relation !== "execution_targets"));
    expect(manifest.NON_FORCE_RLS_RELATIONS).toEqual(["execution_targets"]);
    expect(manifest.POLICY_COUNTS).toEqual(counts);
    expect(manifest.RLS_POLICY_MANIFEST).toEqual(policies);
    expect(manifest.RLS_POLICY_MANIFEST?.reduce<Record<string, number>>((actual, row) => {
      actual[row.relation] = (actual[row.relation] ?? 0) + 1;
      return actual;
    }, {})).toEqual(counts);
    expect(Object.isFrozen(manifest.RLS_POLICY_MANIFEST)).toBe(true);
  });

  it("derives exact relation and column ACL tuple manifests for every serving relation", () => {
    const manifest = grants as typeof grants & {
      APP_SERVING_RELATIONS?: readonly string[];
      OPERATOR_SERVING_RELATIONS?: readonly string[];
      RELATION_ACL_MANIFEST?: Readonly<Record<string, Readonly<{
        aclIsNull: boolean;
        tuples: readonly {
          grantor: "RELATION_OWNER";
          grantee: "RELATION_OWNER" | "PUBLIC" | "aoa_app" | "aoa_operator";
          privilegeType: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
          isGrantable: false;
        }[];
      }>>>;
      COLUMN_ACL_MANIFEST?: Readonly<Record<string, Readonly<Record<string, Readonly<{
        aclIsNull: boolean;
        tuples: readonly {
          grantor: "RELATION_OWNER";
          grantee: "RELATION_OWNER" | "PUBLIC" | "aoa_app" | "aoa_operator";
          privilegeType: "SELECT";
          isGrantable: false;
        }[];
      }>>>>>;
    };
    const relations = [...new Set([
      ...(manifest.APP_SERVING_RELATIONS ?? []),
      ...(manifest.OPERATOR_SERVING_RELATIONS ?? []),
    ])].sort();
    expect(Object.keys(manifest.RELATION_ACL_MANIFEST ?? {}).sort()).toEqual(relations);
    expect(Object.keys(manifest.COLUMN_ACL_MANIFEST ?? {}).sort()).toEqual(relations);
    for (const relation of relations) {
      const relationAcl = manifest.RELATION_ACL_MANIFEST?.[relation];
      expect.soft(relationAcl, `${relation} relacl`).toBeDefined();
      expect.soft(Object.keys(relationAcl ?? {}).sort(), `${relation} relacl shape`).toEqual([
        "aclIsNull", "tuples",
      ]);
      expect.soft(manifest.COLUMN_ACL_MANIFEST?.[relation], `${relation} attacl`).toBeDefined();
      for (const tuple of relationAcl?.tuples ?? []) {
        expect.soft(Object.keys(tuple).sort(), `${relation} exact relacl tuple`).toEqual([
          "grantee", "grantor", "isGrantable", "privilegeType",
        ]);
        expect.soft(tuple.isGrantable, `${relation} relation grant option`).toBe(false);
      }
      for (const [column, columnAcl] of Object.entries(manifest.COLUMN_ACL_MANIFEST?.[relation] ?? {})) {
        expect.soft(column.length, `${relation} nonempty column`).toBeGreaterThan(0);
        expect.soft(Object.keys(columnAcl).sort(), `${relation}.${column} attacl shape`).toEqual([
          "aclIsNull", "tuples",
        ]);
        for (const tuple of columnAcl.tuples) {
          expect.soft(Object.keys(tuple).sort(), `${relation}.${column} exact attacl tuple`).toEqual([
            "grantee", "grantor", "isGrantable", "privilegeType",
          ]);
          expect.soft(tuple).toMatchObject({ privilegeType: "SELECT", isGrantable: false });
        }
      }
    }
    expect(Object.isFrozen(manifest.RELATION_ACL_MANIFEST)).toBe(true);
    expect(Object.isFrozen(manifest.COLUMN_ACL_MANIFEST)).toBe(true);
  });
});
