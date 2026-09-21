// server/src/__tests__/distributed-tool-surface-arming.integration.test.ts
//
// CLI-016 (M1b) — the distributed tool surface, armed PER ORGANIZATION (founder ruling F10),
// proven against real PostgreSQL with two tenants.
//
// Two Organizations run canary distributed execution. Org A carries `tools: true` in
// AOA_DISTRIBUTED_EXECUTION_ROLLOUT; Org B does not. The deployment flag is armed
// (`AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED=per-organization`, decision E7-D10). Proven here:
//
//   DISPATCH — the heartbeat's composition (hook -> real company->Organization edge ->
//     `resolveDistributedToolSurface` -> `buildTaskRunBatchWorkload`) gives A's run the
//     `--mcp-config` argv and gives B's run NONE. Same deployment, same flag, same moment.
//   USE — at `/mcp` authorization, the per-Organization gate
//     (`createDistributedToolSurfaceUseResolver`) ADMITS A's live run and DENIES B's live run;
//     the DAT-007 currency gate (`createDistributedRunCurrencyResolver`) DENIES A's run once its
//     lease has expired, and both gates DENY an unauthorized run id (A's run presented at B's
//     company). Currency is enforced at USE, never at mint.
//   KILL SWITCH / ROLLBACK — unsetting the flag, or removing A's `tools`, denies A's already-
//     dispatched live run at use with no restart.
//
// Every deny has a same-tenant positive control beside it, so a gate that always denied could
// not pass, and neither could one that always admitted.
//
// ★ WINDOWS: `skipIf(win32 && AOA_RUN_WIN_INTEGRATION !== "1")` — the form the E7 plan's
// Windows verify command needs. With a bare `win32` skip that command runs ZERO tests and exits
// 0. The formal evidence is the Linux `verify` shard's executed count.
//
// SEEDING mirrors `distributed-run-currency.integration.test.ts` (DAT-007-S3): hand-inserted
// rows as the embedded-pg superuser, one fresh leaf chain per case.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { brokeredAoaMcpConfig } from "@armyofagents/adapter-utils";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import { createDistributedRunCurrencyResolver } from "../mcp/distributed-run-currency-resolver.js";
import { createDistributedToolSurfaceUseResolver } from "../mcp/distributed-tool-surface-use-resolver.js";
import {
  DISTRIBUTED_EXECUTION_ENABLED_ENV,
  DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV,
  readDistributedToolSurfaceFlag,
  resolveDistributedToolSurface,
} from "../config/distributed-execution.js";
import {
  DISTRIBUTED_EXECUTION_ROLLOUT_ENV,
  createDistributedExecutionRolloutSource,
} from "../config/distributed-execution-rollout-source.js";
import { createHeartbeatDistributedRolloutHook } from "../services/heartbeat-distributed-rollout.js";
import { resolveCompanyOrganizationId } from "../services/org-concurrency.js";
import { buildTaskRunBatchWorkload } from "../services/task-run-batch-workload.js";
import type { JobConvertOrchestrator } from "../services/job-convert-orchestrator.js";
import type { JobShadowComparator } from "../services/job-shadow-comparator.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
}) => EmbeddedPostgresInstance;

const HEX64 = "a".repeat(64);
const PROVIDER_HEX64 = "b".repeat(64);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "CLI-016 — per-Organization distributed tool surface (real PG, two tenants)",
  () => {
    let pg: EmbeddedPostgresInstance | null = null;
    let dataDir = "";
    let db: Db;
    let setupError: unknown = null;

    type Tenant = { org: string; company: string; agent: string; authorityKey: string };
    const mkTenant = (): Tenant => {
      const org = randomUUID();
      return { org, company: randomUUID(), agent: randomUUID(), authorityKey: `organization:${org}` };
    };
    const TENANT_A = mkTenant(); // tools: true
    const TENANT_B = mkTenant(); // canary, NO tools

    const armedRollout = () =>
      JSON.stringify({
        organizations: {
          [TENANT_A.org]: { mode: "canary", workloads: ["*"], tools: true },
          [TENANT_B.org]: { mode: "canary", workloads: ["*"] },
        },
      });

    // One env bag per case, mutated in place for the kill-switch / rollback cases — the
    // resolvers read it per call, exactly as they read process.env in production.
    const armedEnv = (): Record<string, string | undefined> => ({
      [DISTRIBUTED_EXECUTION_ENABLED_ENV]: "true",
      [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: "per-organization",
      [DISTRIBUTED_EXECUTION_ROLLOUT_ENV]: armedRollout(),
    });

    function assertSetupOk(): void {
      if (setupError === null && (db as Db | undefined) !== undefined) return;
      throw new Error(
        `embedded-postgres setup failed: ${setupError instanceof Error ? setupError.message : String(setupError)}`,
      );
    }

    beforeAll(async () => {
      try {
        dataDir = await mkdtemp(join(tmpdir(), "aoa-cli016-"));
        const port = await allocateEmbeddedPgPort();
        const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
          default: EmbeddedPostgresCtor;
        };
        pg = new EmbeddedPostgres({
          databaseDir: join(dataDir, "db"),
          user: "test",
          password: "test",
          port,
          persistent: false,
          initdbFlags: ["--encoding=UTF8", "--locale=C"],
        });
        await pg.initialise();
        await pg.start();
        const connectionString = `postgres://test:test@localhost:${port}/postgres`;
        await applyPendingMigrations(connectionString);
        db = createDb(connectionString);
        for (const [t, prefix] of [
          [TENANT_A, "C16A"],
          [TENANT_B, "C16B"],
        ] as const) {
          await db.execute(sql`
            INSERT INTO organizations (id, name, slug)
            VALUES (${t.org}, ${`CLI-016 org ${prefix}`}, ${`cli-016-${t.org}`})`);
          await db.execute(sql`
            INSERT INTO companies (id, organization_id, name, issue_prefix)
            VALUES (${t.company}, ${t.org}, ${`CLI-016 co ${prefix}`}, ${prefix})`);
          await db.execute(sql`
            INSERT INTO agents (id, company_id, name, kind, status)
            VALUES (${t.agent}, ${t.company}, ${`CLI-016 agent ${prefix}`}, 'org', 'idle')`);
        }
      } catch (err) {
        setupError = err;
        // eslint-disable-next-line no-console
        console.error("[cli-016] embedded-postgres setup failed:", err);
      }
    }, 180_000);

    afterAll(async () => {
      try {
        if (pg) await pg.stop();
      } catch {
        /* ignore */
      }
      try {
        if (dataDir) await rm(dataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }, 60_000);

    // A full distributed leaf chain for `tenant`: execution_target -> worker -> job ->
    // job_attempt -> lease -> heartbeat_run (execution_owner='distributed'). `leaseExpiry`
    // is the single knob for the expired-lease case. Same shape as DAT-007-S3's seeder.
    async function seedDistributedRun(tenant: Tenant, leaseExpiry: "future" | "past" = "future"): Promise<string> {
      const runId = randomUUID();
      const jobId = randomUUID();
      const attemptId = randomUUID();
      const targetId = randomUUID();
      const workerId = randomUUID();
      const leaseId = randomUUID();
      await db.execute(sql`
        INSERT INTO execution_targets
          (id, organization_id, scope, target_authority_key, device_generation,
           slug, kind, trust_class, status)
        VALUES
          (${targetId}, ${tenant.org}, 'organization', ${tenant.authorityKey}, 1,
           ${`cli016-target-${targetId}`}, 'dedicated_worker', 'dedicated_tenant', 'active')`);
      await db.execute(sql`
        INSERT INTO workers
          (id, scope, organization_id, execution_target_id, target_authority_key,
           device_public_key, device_thumbprint, device_generation, profile_hash,
           enrolled_at, label, status)
        VALUES
          (${workerId}, 'organization', ${tenant.org}, ${targetId}, ${tenant.authorityKey},
           'cli016-pk', 'cli016-thumb', 1, ${HEX64},
           clock_timestamp(), 'CLI-016 worker', 'enrolled')`);
      await db.execute(sql`
        INSERT INTO jobs (id, organization_id, company_id)
        VALUES (${jobId}, ${tenant.org}, ${tenant.company})`);
      await db.execute(sql`
        INSERT INTO job_attempts
          (id, organization_id, company_id, job_id, attempt_number, status)
        VALUES
          (${attemptId}, ${tenant.org}, ${tenant.company}, ${jobId}, 1, 'running')`);
      const expiresAt =
        leaseExpiry === "future" ? sql`clock_timestamp() + interval '1 hour'` : sql`clock_timestamp() - interval '1 hour'`;
      const ackDeadline =
        leaseExpiry === "future"
          ? sql`clock_timestamp() + interval '30 minutes'`
          : sql`clock_timestamp() - interval '2 hours'`;
      await db.execute(sql`
        INSERT INTO leases
          (id, organization_id, attempt_id, company_id, job_id, attempt_number,
           worker_id, target_id, target_authority_key, target_generation,
           profile_hash, provider_constraint_hash, status, fence,
           ack_deadline, expires_at, activated_at)
        VALUES
          (${leaseId}, ${tenant.org}, ${attemptId}, ${tenant.company}, ${jobId}, 1,
           ${workerId}, ${targetId}, ${tenant.authorityKey}, 1,
           ${HEX64}, ${PROVIDER_HEX64}, 'active', ${`cli016-fence-${leaseId}`},
           ${ackDeadline}, ${expiresAt}, clock_timestamp())`);
      await db.execute(sql`
        INSERT INTO heartbeat_runs
          (id, company_id, agent_id, execution_owner, distributed_job_id, distributed_attempt_id)
        VALUES
          (${runId}, ${tenant.company}, ${tenant.agent}, 'distributed', ${jobId}, ${attemptId})`);
      return runId;
    }

    async function seedLocalRun(tenant: Tenant): Promise<string> {
      const runId = randomUUID();
      await db.execute(sql`
        INSERT INTO heartbeat_runs (id, company_id, agent_id)
        VALUES (${runId}, ${tenant.company}, ${tenant.agent})`);
      return runId;
    }

    // The two use-side gates, in the order the /mcp mount runs them (server.ts).
    async function useVerdicts(env: Record<string, string | undefined>, runId: string, at: Tenant) {
      const currency = await createDistributedRunCurrencyResolver(db).resolve({
        signedRunId: runId,
        companyId: at.company,
        agentId: at.agent,
      });
      const toolSurface = await createDistributedToolSurfaceUseResolver(db, { env }).resolve({
        signedRunId: runId,
        companyId: at.company,
      });
      return { currency, toolSurface };
    }

    // The heartbeat dispatch composition, verbatim in shape (heartbeat.ts, the canary block):
    // the hook resolves the run's Organization through the REAL company -> Organization edge,
    // the flag and that Organization's policy are combined, and the combined decision is what
    // decides whether the argv carries the brokered `aoa` MCP config.
    async function dispatchFor(env: Record<string, string | undefined>, tenant: Tenant) {
      const hook = createHeartbeatDistributedRolloutHook({
        env,
        deploymentMode: "cloud_auth",
        rolloutSource: createDistributedExecutionRolloutSource(env),
        resolveOrganizationId: (companyId) => resolveCompanyOrganizationId(db, companyId),
        convertOrchestrator: {} as unknown as JobConvertOrchestrator,
        comparator: {} as unknown as JobShadowComparator,
      });
      const resolution = await hook.resolveRunRolloutState({ companyId: tenant.company, sourceKind: "task_run" });
      const toolSurfaceDecision = resolveDistributedToolSurface({
        deploymentArmed: readDistributedToolSurfaceFlag(env),
        organizationToolsEnabled: hook.resolveOrganizationToolSurface(resolution.organizationId),
      });
      const aoaMcpConfig = toolSurfaceDecision.authorized
        ? brokeredAoaMcpConfig({ apiBaseUrl: "https://cp.example.test", companyId: tenant.company })
        : null;
      const workload = buildTaskRunBatchWorkload({
        adapterType: "claude_local",
        runtimeCommandSpec: { command: "claude" },
        adapterConfig: {},
        currentTaskMarkdown: "Do the task.",
        instructions: null,
        aoaMcpConfig,
      });
      if (!workload.ok) throw new Error(`workload refused: ${workload.reason}`);
      return { resolution, toolSurfaceDecision, argv: workload.workload.args.join(" ") };
    }

    it("DISPATCH (F10): with ONE armed deployment, A's run gets the tool surface and B's gets NONE", async () => {
      assertSetupOk();
      const env = armedEnv();
      const a = await dispatchFor(env, TENANT_A);
      const b = await dispatchFor(env, TENANT_B);
      // Both are live canary tenants — B is excluded by tools policy, not by rollout state.
      expect(a.resolution).toEqual({ state: "canary", organizationId: TENANT_A.org });
      expect(b.resolution).toEqual({ state: "canary", organizationId: TENANT_B.org });
      expect(a.toolSurfaceDecision).toEqual({ authorized: true, reason: "enabled" });
      expect(a.argv).toContain("--mcp-config");
      expect(a.argv).toContain("--strict-mcp-config");
      expect(b.toolSurfaceDecision).toEqual({ authorized: false, reason: "organization_not_enabled" });
      expect(b.argv).not.toContain("--mcp-config");
    });

    it("USE (F10): A's live run is admitted by both gates; B's live run is DENIED by the per-Organization gate", async () => {
      assertSetupOk();
      const env = armedEnv();
      const a = await seedDistributedRun(TENANT_A);
      const b = await seedDistributedRun(TENANT_B);
      expect(await useVerdicts(env, a, TENANT_A)).toEqual({ currency: "admit", toolSurface: "admit" });
      // B's run is fence-current (currency admits) — only the per-Organization gate denies it.
      expect(await useVerdicts(env, b, TENANT_B)).toEqual({ currency: "admit", toolSurface: "deny" });
    });

    it("USE: an EXPIRED lease is denied by the currency gate (same tenant's live run is the control)", async () => {
      assertSetupOk();
      const env = armedEnv();
      const live = await seedDistributedRun(TENANT_A, "future");
      const expired = await seedDistributedRun(TENANT_A, "past");
      expect((await useVerdicts(env, live, TENANT_A)).currency).toBe("admit");
      expect((await useVerdicts(env, expired, TENANT_A)).currency).toBe("deny");
    });

    it("USE: an UNAUTHORIZED run id — A's live run presented at B's company — is denied by BOTH gates", async () => {
      assertSetupOk();
      const env = armedEnv();
      const a = await seedDistributedRun(TENANT_A);
      expect(await useVerdicts(env, a, TENANT_A)).toEqual({ currency: "admit", toolSurface: "admit" });
      expect(await useVerdicts(env, a, TENANT_B)).toEqual({ currency: "deny", toolSurface: "deny" });
    });

    it("USE: a LOCAL run in the not-enabled tenant is untouched (the false-deny guard)", async () => {
      assertSetupOk();
      const local = await seedLocalRun(TENANT_B);
      expect(await useVerdicts(armedEnv(), local, TENANT_B)).toEqual({ currency: "admit", toolSurface: "admit" });
    });

    it("KILL SWITCH: unsetting the deployment flag denies A's already-dispatched live run at use and disarms dispatch", async () => {
      assertSetupOk();
      const env = armedEnv();
      const a = await seedDistributedRun(TENANT_A);
      expect((await useVerdicts(env, a, TENANT_A)).toolSurface).toBe("admit");
      delete env[DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV];
      expect((await useVerdicts(env, a, TENANT_A)).toolSurface).toBe("deny");
      const d = await dispatchFor(env, TENANT_A);
      expect(d.toolSurfaceDecision).toEqual({ authorized: false, reason: "deployment_disabled" });
      expect(d.argv).not.toContain("--mcp-config");
    });

    it("PER-TENANT ROLLBACK: removing A's `tools` denies A's live run at use, with no restart", async () => {
      assertSetupOk();
      const env = armedEnv();
      const a = await seedDistributedRun(TENANT_A);
      expect((await useVerdicts(env, a, TENANT_A)).toolSurface).toBe("admit");
      env[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = JSON.stringify({
        organizations: { [TENANT_A.org]: { mode: "canary", workloads: ["*"] } },
      });
      expect((await useVerdicts(env, a, TENANT_A)).toolSurface).toBe("deny");
    });
  },
);
