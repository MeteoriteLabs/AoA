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
});
