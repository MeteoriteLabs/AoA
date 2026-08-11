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
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as dbSchema from "../../../packages/db/src/schema/index.js";

type PlanGrantedPrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
type PlanRolePrivileges = Readonly<Record<
  "aoa_app" | "aoa_operator",
  readonly PlanGrantedPrivilege[]
>>;

function deepFreezeFixture<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreezeFixture(nested);
    }
    Object.freeze(value);
  }
  return value;
}

// Hand-transcribed from the accepted bounded-grant and column-projection plan. This fixture is
// intentionally independent of the production grant constants so changing a production
// privilege cannot silently rewrite both the implementation and the expected ACL certificate.
const PLAN_DERIVED_ACL_MATRIX = deepFreezeFixture({
  relations: {
    activity_log: { aoa_app: ["SELECT", "INSERT"], aoa_operator: [] },
    agent_runtime_decisions: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    agent_runtime_trust_rules: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    agent_wakeup_requests: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    agents: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: [] },
    approvals: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    artifact_versions: { aoa_app: ["SELECT"], aoa_operator: [] },
    artifacts: { aoa_app: ["SELECT"], aoa_operator: [] },
    assets: { aoa_app: ["SELECT"], aoa_operator: [] },
    budget_incidents: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    budget_policies: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    companies: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: [] },
    company_memberships: { aoa_app: ["SELECT"], aoa_operator: [] },
    cost_events: { aoa_app: ["SELECT", "INSERT"], aoa_operator: [] },
    discussion_entries: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: [] },
    execution_targets: { aoa_app: [], aoa_operator: [] },
    execution_workspaces: { aoa_app: ["SELECT"], aoa_operator: [] },
    heartbeat_runs: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    hub_audit: { aoa_app: ["INSERT"], aoa_operator: [] },
    hub_counter_snapshots: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: [] },
    internal_agent_config: { aoa_app: ["SELECT"], aoa_operator: [] },
    internal_agent_conversations: { aoa_app: ["SELECT"], aoa_operator: [] },
    internal_agent_messages: { aoa_app: ["SELECT"], aoa_operator: [] },
    internal_agent_runs: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    internal_agent_runtime_approvals: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    internal_agent_tool_trust_rules: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    issue_comments: { aoa_app: ["INSERT"], aoa_operator: [] },
    issue_labels: { aoa_app: ["SELECT"], aoa_operator: [] },
    issues: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: [] },
    job_artifacts: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    job_attempts: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    job_outbox: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    job_secret_handles: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    jobs: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    labels: { aoa_app: ["SELECT"], aoa_operator: [] },
    leases: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    mcp_api_keys: { aoa_app: [], aoa_operator: [] },
    notification_digest_items: { aoa_app: ["SELECT", "INSERT"], aoa_operator: [] },
    notification_preferences: { aoa_app: ["SELECT"], aoa_operator: [] },
    notifications: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    organization_memberships: { aoa_app: ["SELECT"], aoa_operator: [] },
    organizations: { aoa_app: ["SELECT"], aoa_operator: [] },
    projects: { aoa_app: ["SELECT"], aoa_operator: [] },
    service_instances: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    services: { aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"], aoa_operator: [] },
    task_dependencies: { aoa_app: ["SELECT"], aoa_operator: [] },
    task_outputs: { aoa_app: ["SELECT", "INSERT", "UPDATE"], aoa_operator: [] },
    thread_orchestration_state: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: [] },
    user_roles: { aoa_app: ["SELECT"], aoa_operator: [] },
    worker_enrollment_code_routes: {
      aoa_app: ["SELECT", "INSERT", "DELETE"],
      aoa_operator: ["SELECT", "INSERT", "DELETE"],
    },
    worker_enrollment_codes: {
      aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      aoa_operator: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    },
    worker_lease_rejections: {
      aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      aoa_operator: [],
    },
    worker_operation_receipts: {
      aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      aoa_operator: [],
    },
    worker_proof_replays: {
      aoa_app: ["SELECT", "INSERT", "DELETE"],
      aoa_operator: ["SELECT", "INSERT", "DELETE"],
    },
    workers: {
      aoa_app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      aoa_operator: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    },
    workspace_runtime_services: { aoa_app: ["SELECT"], aoa_operator: [] },
  },
  columns: {
    mcp_api_keys: {
      id: { aoa_app: ["SELECT"], aoa_operator: [] },
      company_id: { aoa_app: ["SELECT"], aoa_operator: [] },
      user_id: { aoa_app: ["SELECT"], aoa_operator: [] },
      revoked_at: { aoa_app: ["SELECT"], aoa_operator: [] },
    },
    workers: {
      id: { aoa_app: [], aoa_operator: ["SELECT"] },
      scope: { aoa_app: [], aoa_operator: ["SELECT"] },
      organization_id: { aoa_app: [], aoa_operator: ["SELECT"] },
      label: { aoa_app: [], aoa_operator: ["SELECT"] },
      status: { aoa_app: [], aoa_operator: ["SELECT"] },
      created_at: { aoa_app: [], aoa_operator: ["SELECT"] },
      updated_at: { aoa_app: [], aoa_operator: ["SELECT"] },
    },
    execution_targets: {
      id: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      organization_id: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      owner_user_id: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      slug: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      kind: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      trust_class: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      status: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: ["SELECT", "UPDATE"] },
      capabilities: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      scope: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      target_authority_key: { aoa_app: ["SELECT"], aoa_operator: ["SELECT"] },
      device_generation: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: ["SELECT", "UPDATE"] },
      worker_token_hash: { aoa_app: ["UPDATE"], aoa_operator: ["UPDATE"] },
      config: { aoa_app: ["SELECT"], aoa_operator: [] },
      last_seen_at: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: ["SELECT", "UPDATE"] },
      created_at: { aoa_app: [], aoa_operator: ["SELECT"] },
      updated_at: { aoa_app: ["UPDATE"], aoa_operator: ["SELECT", "UPDATE"] },
      registered_profile: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: ["SELECT", "UPDATE"] },
      registered_profile_hash: { aoa_app: ["SELECT", "UPDATE"], aoa_operator: ["SELECT", "UPDATE"] },
      provider_constraint_profile: {
        aoa_app: ["SELECT", "UPDATE"],
        aoa_operator: ["SELECT", "UPDATE"],
      },
    },
  },
} as const satisfies {
  relations: Readonly<Record<string, PlanRolePrivileges>>;
  columns: Readonly<Record<string, Readonly<Record<string, PlanRolePrivileges>>>>;
});

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
    // Mutation caught: deriving the oracle from the production grant constants lets an
    // accidental privilege expansion change both sides of the assertion and pass unnoticed.
    const expectDeepFrozenFixture = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const nested of Object.values(value as Record<string, unknown>)) {
        expectDeepFrozenFixture(nested);
      }
    };
    expectDeepFrozenFixture(PLAN_DERIVED_ACL_MATRIX);
    const manifest = grants as typeof grants & {
      APP_SERVING_RELATIONS?: readonly string[];
      OPERATOR_SERVING_RELATIONS?: readonly string[];
      RELATION_ACL_MANIFEST?: Readonly<Record<string, Readonly<{
        aclIsNull: boolean;
        tuples: readonly {
          grantor: "RELATION_OWNER";
          grantee: "RELATION_OWNER" | "PUBLIC" | "aoa_app" | "aoa_operator";
          privilegeType: string;
          isGrantable: boolean;
        }[];
      }>>>;
      COLUMN_ACL_MANIFEST?: Readonly<Record<string, Readonly<Record<string, Readonly<{
        aclIsNull: boolean;
        tuples: readonly {
          grantor: "RELATION_OWNER";
          grantee: "RELATION_OWNER" | "PUBLIC" | "aoa_app" | "aoa_operator";
          privilegeType: string;
          isGrantable: boolean;
        }[];
      }>>>>>;
    };
    const relations = [...new Set([
      ...Object.keys(grants.JOB_CONTROL_LEGACY_GRANTS),
      ...Object.keys(grants.JOB_CONTROL_NEW_PATH_GRANTS),
      ...Object.keys(grants.JOB_SUBMISSION_LEGACY_GRANTS),
      ...Object.keys(grants.JOB_SUBMISSION_NEW_PATH_GRANTS),
      ...Object.keys(grants.WORKER_ENROLLMENT_APP_GRANTS),
      ...Object.keys(grants.JOB_LEASING_NEW_PATH_GRANTS),
      ...Object.keys(grants.WORKER_ENROLLMENT_OPERATOR_GRANTS),
      ...Object.keys(grants.OPERATOR_METADATA_COLUMN_GRANTS),
      "mcp_api_keys",
      "execution_targets",
    ])].sort();
    type ExpectedTuple = {
      grantor: "RELATION_OWNER";
      grantee: "RELATION_OWNER" | "aoa_app" | "aoa_operator";
      privilegeType: string;
      isGrantable: boolean;
    };
    const tupleKey = (tuple: ExpectedTuple) => [
      tuple.grantor, tuple.grantee, tuple.privilegeType, String(tuple.isGrantable),
    ].join(":");
    const sorted = (tuples: readonly ExpectedTuple[]) => [...tuples].sort((left, right) =>
      tupleKey(left).localeCompare(tupleKey(right)));
    const ownerTablePrivileges = [
      "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
    ] as const;
    const expectedRelations: Record<string, { aclIsNull: boolean; tuples: ExpectedTuple[] }> = {};
    expect(Object.keys(PLAN_DERIVED_ACL_MATRIX.relations).sort()).toEqual(relations);
    for (const relation of relations) {
      const planPrivileges = (PLAN_DERIVED_ACL_MATRIX.relations as
        Readonly<Record<string, PlanRolePrivileges>>)[relation];
      expect(planPrivileges, `${relation} must have one literal plan-derived ACL row`).toBeDefined();
      if (!planPrivileges) continue;
      const app = planPrivileges.aoa_app;
      const operator = planPrivileges.aoa_operator;
      const aclIsNull = app.length === 0 && operator.length === 0;
      expectedRelations[relation] = {
        aclIsNull,
        tuples: aclIsNull ? [] : sorted([
          ...ownerTablePrivileges.map((privilegeType) => ({
            grantor: "RELATION_OWNER" as const,
            grantee: "RELATION_OWNER" as const,
            privilegeType,
            isGrantable: true,
          })),
          ...app.map((privilegeType) => ({
            grantor: "RELATION_OWNER" as const,
            grantee: "aoa_app" as const,
            privilegeType,
            isGrantable: false,
          })),
          ...operator.map((privilegeType) => ({
            grantor: "RELATION_OWNER" as const,
            grantee: "aoa_operator" as const,
            privilegeType,
            isGrantable: false,
          })),
        ]),
      };
    }

    const columnsByRelation = new Map<string, string[]>();
    for (const candidate of Object.values(dbSchema)) {
      try {
        const table = candidate as Table;
        const name = getTableName(table);
        columnsByRelation.set(name, Object.values(getTableColumns(table)).map((column) => column.name).sort());
      } catch { /* schema export is not a table */ }
    }
    const explicitColumns = new Map<string, Map<string, ExpectedTuple[]>>();
    for (const [relation, columns] of Object.entries(PLAN_DERIVED_ACL_MATRIX.columns)) {
      expect(relations, `${relation} column ACL fixture must name a serving relation`).toContain(relation);
      expect(columnsByRelation.get(relation), `${relation} must resolve to one checked-in Drizzle table`)
        .toEqual(expect.arrayContaining(Object.keys(columns)));
      const relationColumns = new Map<string, ExpectedTuple[]>();
      explicitColumns.set(relation, relationColumns);
      for (const [column, privilegesByRole] of Object.entries(columns)) {
        const tuples: ExpectedTuple[] = [];
        for (const role of ["aoa_app", "aoa_operator"] as const) {
          for (const privilegeType of privilegesByRole[role]) {
            tuples.push({
              grantor: "RELATION_OWNER", grantee: role, privilegeType, isGrantable: false,
            });
          }
        }
        relationColumns.set(column, sorted(tuples));
      }
    }
    const expectedColumns: Record<string, Record<string, {
      aclIsNull: boolean;
      tuples: ExpectedTuple[];
    }>> = {};
    for (const relation of relations) {
      const columns = columnsByRelation.get(relation);
      expect(columns, `${relation} must resolve to one checked-in Drizzle table`).toBeDefined();
      expectedColumns[relation] = {};
      for (const column of columns ?? []) {
        const tuples = sorted(explicitColumns.get(relation)?.get(column) ?? []);
        expectedColumns[relation]![column] = { aclIsNull: tuples.length === 0, tuples };
      }
    }

    const actualRelations = Object.fromEntries(Object.entries(manifest.RELATION_ACL_MANIFEST ?? {})
      .map(([relation, acl]) => [relation, { ...acl, tuples: sorted(acl.tuples as ExpectedTuple[]) }]));
    const actualColumns = Object.fromEntries(Object.entries(manifest.COLUMN_ACL_MANIFEST ?? {})
      .map(([relation, columns]) => [relation, Object.fromEntries(Object.entries(columns).map(
        ([column, acl]) => [column, { ...acl, tuples: sorted(acl.tuples as ExpectedTuple[]) }],
      ))]));
    expect(actualRelations).toEqual(expectedRelations);
    expect(actualColumns).toEqual(expectedColumns);
    expect(Object.isFrozen(manifest.RELATION_ACL_MANIFEST)).toBe(true);
    expect(Object.isFrozen(manifest.COLUMN_ACL_MANIFEST)).toBe(true);
  });
});
