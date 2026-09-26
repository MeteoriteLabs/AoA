// server/src/__tests__/distributed-run-currency.integration.test.ts
//
// DAT-007 item #1 — Tier-3 real-Postgres proof of the currency-resolver QUERY.
//
// This exercises `createDistributedRunCurrencyResolver(db).resolve(...)` (the DB
// reader in `../mcp/distributed-run-currency-resolver.ts`, already merged) against
// a seeded embedded-postgres database and asserts the two-valued verdict
// ("admit" | "deny"). It is RESOLVER-DIRECT: no HTTP router, no run-JWT — those
// paths are proven in `mcp-run-currency-gate.test.ts` (stubbed classifier unit)
// and `broker-internal-registry.test.ts` (real HTTP broker). What is proven HERE,
// and only here, is that the bounded `heartbeat_runs -> job_attempts -> leases ->
// execution_targets` join composes against real Postgres and that its SQL-side
// freshness (`leases.expires_at > clock_timestamp()`) and terminal-attempt cutoff
// actually fire — via a single-knob differential across the admit/deny cases.
//
// SEED APPROACH — HAND-INSERT exact columns as the embedded-pg initdb superuser
// (`test`), mirroring the harness of `broker-internal-registry.test.ts`, NOT the
// `runInTenant`/`createJobLeasingService` RLS path of `job-leasing.integration.test.ts`.
// Rationale: (a) the resolver takes a plain superuser `Db` and reads via `db.select`
// — a superuser bypasses even FORCE'd RLS, so no `aoa_app` role plumbing is needed;
// (b) cases 2 and 3 are precisely the adversarial states the real leasing service
// REFUSES to construct — an `active` lease already past its `expires_at`, and an
// `active`+fresh lease over a TERMINAL (`expired`) attempt — so only direct inserts
// can build them. Every seeded row satisfies its NOT-NULL / CHECK / composite-FK
// constraints by construction (verified against packages/db/src/schema at HEAD),
// because this suite runs ONLY on Linux CI (embedded-pg cannot boot on the Windows
// CI runner — Issue #114) and so must be right the first time.
//
// The tenant SPINE (organizations -> companies -> agents) is seeded once in
// beforeAll; each case then seeds its OWN fresh leaf chain (execution_target ->
// worker -> job -> job_attempt -> lease -> heartbeat_run) with `randomUUID()` ids,
// so no case can leak into another (every resolver join is keyed by id).
//
// DAT-007-S3 extends the five original cases (unchanged) with: a replaced target
// generation, a disabled target, wrong-Organization / wrong-company / cross-tenant
// attempt-pointer denials against a SECOND tenant (ruling F10) each with a same-tenant
// positive control, two real-database throws that must propagate (fail-closed), and a
// plan-shape pin that every hop is an index probe. Mutants are in
// docs/replatform/epics/E5-workspaces-secrets/tickets/DAT-007-S3-result.md.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import { createDistributedRunCurrencyResolver } from "../mcp/distributed-run-currency-resolver.js";

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

// leases.profile_hash / provider_constraint_hash carry a `~ '^[0-9a-f]{64}$'`
// CHECK (leases_authority_atomic_check, leases.ts:63-64); 'a'*64 / 'b'*64 are
// valid lowercase hex.
const HEX64 = "a".repeat(64);
const PROVIDER_HEX64 = "b".repeat(64);

// Skipped on Windows: embedded-postgres cannot start on the Windows CI runner
// (Issue #114); Linux CI is the authoritative gate. Placing the hooks INSIDE the
// describe means the whole suite (boot included) is skipped on Windows, mirroring
// job-leasing.integration.test.ts:889/971.
describe.skipIf(process.platform === "win32")(
  "DAT-007 item #1 — distributed-run currency resolver (real PG)",
  () => {
    let pg: EmbeddedPostgresInstance | null = null;
    let dataDir = "";
    let db: Db;
    let setupError: unknown = null;
    let setupFailed = false;
    let connectionString = "";
    let pgPort = 0;

    // Shared tenant spine (seeded once). Fresh random ids so a re-run never
    // collides with a leftover row and organizations_slug_uq stays unique.
    const ORG = randomUUID();
    const COMPANY = randomUUID();
    const AGENT = randomUUID();
    // execution_targets_authority_scope_check (execution_targets.ts:67-68) requires
    // the organization-scope authority key to be exactly this string.
    const AUTHORITY_KEY = `organization:${ORG}`;

    // DAT-007-S3 (ruling F10, multi-tenant): a SECOND Organization with its own company and
    // agent, and a SECOND company inside the FIRST Organization. Both are seeded in beforeAll
    // alongside the original spine. TENANT_A is exactly the original spine above.
    type Tenant = { org: string; company: string; agent: string; authorityKey: string };
    const TENANT_A: Tenant = { org: ORG, company: COMPANY, agent: AGENT, authorityKey: AUTHORITY_KEY };
    const ORG_B = randomUUID();
    const TENANT_B: Tenant = {
      org: ORG_B,
      company: randomUUID(),
      agent: randomUUID(),
      authorityKey: `organization:${ORG_B}`,
    };
    // Same Organization as TENANT_A, different company: the wrong-COMPANY (not wrong-org) case.
    const COMPANY_A2 = randomUUID();

    function assertSetupOk(): void {
      const dbReady = (db as Db | undefined) !== undefined;
      if (!setupFailed && dbReady) return;
      throw new Error(
        `embedded-postgres setup failed (see the console.error above): ${
          setupError instanceof Error ? setupError.message : String(setupError)
        }`,
      );
    }

    beforeAll(async () => {
      try {
        dataDir = await mkdtemp(join(tmpdir(), "aoa-dat007-currency-"));
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
        connectionString = `postgres://test:test@localhost:${port}/postgres`;
        pgPort = port;
        await applyPendingMigrations(connectionString);
        db = createDb(connectionString);

        // Spine: organizations -> companies -> agents. Only the columns that are
        // NOT NULL without a default are supplied; everything else defaults.
        await db.execute(sql`
          INSERT INTO organizations (id, name, slug)
          VALUES (${ORG}, 'DAT-007 currency org', ${`dat-007-currency-${ORG}`})`);
        await db.execute(sql`
          INSERT INTO companies (id, organization_id, name, issue_prefix)
          VALUES (${COMPANY}, ${ORG}, 'DAT-007 currency co', 'D007')`);
        // kind='org' keeps this row out of the agents_aoa_name_per_company_idx
        // partial unique (WHERE kind='aoa').
        await db.execute(sql`
          INSERT INTO agents (id, company_id, name, kind, status)
          VALUES (${AGENT}, ${COMPANY}, 'DAT-007 currency agent', 'org', 'idle')`);

        // DAT-007-S3: the second tenant spine (Organization B) and a second company in
        // Organization A. issue_prefix is globally unique (companies_issue_prefix_idx).
        await db.execute(sql`
          INSERT INTO organizations (id, name, slug)
          VALUES (${TENANT_B.org}, 'DAT-007 currency org B', ${`dat-007-currency-${TENANT_B.org}`})`);
        await db.execute(sql`
          INSERT INTO companies (id, organization_id, name, issue_prefix)
          VALUES (${TENANT_B.company}, ${TENANT_B.org}, 'DAT-007 currency co B', 'D07B')`);
        await db.execute(sql`
          INSERT INTO agents (id, company_id, name, kind, status)
          VALUES (${TENANT_B.agent}, ${TENANT_B.company}, 'DAT-007 currency agent B', 'org', 'idle')`);
        await db.execute(sql`
          INSERT INTO companies (id, organization_id, name, issue_prefix)
          VALUES (${COMPANY_A2}, ${ORG}, 'DAT-007 currency co A2', 'D07C')`);
      } catch (err) {
        setupError = err;
        setupFailed = true;
        // eslint-disable-next-line no-console
        console.error("[dat-007-currency] embedded-postgres setup failed:", err);
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

    // Seed a full distributed leaf chain (fresh ids) against the shared spine and
    // return the SIGNED run id (heartbeat_runs.id). `attemptStatus` flips the
    // attempt between non-terminal ('running') and terminal ('expired');
    // `leaseExpiry` flips the lease between fresh ('future') and stale ('past').
    // Every other field is held constant, so a resolver that ignored freshness or
    // terminality could not distinguish the three distributed cases — that is the
    // anti-vacuity control.
    async function seedDistributedRun(opts: {
      attemptStatus: "running" | "expired";
      leaseExpiry: "future" | "past";
    }): Promise<string> {
      return (await seedDistributedChain(opts)).runId;
    }

    // DAT-007-S3: the same chain with three further single knobs, each defaulting to the
    // value the five original cases use (so those cases are byte-identical in effect):
    //   - `targetDeviceGeneration` — the execution target's CURRENT generation. The lease
    //     always stores target_generation 1, so 2 models a target re-enrolled/replaced
    //     after the lease was granted (the generation half of the target_revoked cutoff).
    //   - `targetStatus` — 'disabled' models a revoked execution target.
    //   - `tenant` — which Organization/Company/Agent spine the whole chain belongs to
    //     (ruling F10: M1 is multi-tenant; cross-tenant cases need a second tenant).
    // Returns every id so the cross-tenant pointer case can reuse another tenant's attempt.
    async function seedDistributedChain(opts: {
      attemptStatus: "running" | "expired";
      leaseExpiry: "future" | "past";
      targetDeviceGeneration?: number;
      targetStatus?: "active" | "disabled";
      tenant?: Tenant;
    }): Promise<{ runId: string; attemptId: string; jobId: string }> {
      const tenant = opts.tenant ?? TENANT_A;
      const ORG = tenant.org;
      const COMPANY = tenant.company;
      const AGENT = tenant.agent;
      const AUTHORITY_KEY = tenant.authorityKey;
      const targetDeviceGeneration = opts.targetDeviceGeneration ?? 1;
      const targetStatus = opts.targetStatus ?? "active";
      const runId = randomUUID();
      const jobId = randomUUID();
      const attemptId = randomUUID();
      const targetId = randomUUID();
      const workerId = randomUUID();
      const leaseId = randomUUID();

      // execution_target: organization-scope, current (device_generation matches the
      // lease's target_generation, status != 'disabled'). Placement-profile columns
      // omitted -> the all-NULL branch of execution_targets_placement_profiles_atomic_check.
      await db.execute(sql`
        INSERT INTO execution_targets
          (id, organization_id, scope, target_authority_key, device_generation,
           slug, kind, trust_class, status)
        VALUES
          (${targetId}, ${ORG}, 'organization', ${AUTHORITY_KEY}, ${targetDeviceGeneration},
           ${`dat007-target-${targetId}`}, 'dedicated_worker', 'dedicated_tenant', ${targetStatus})`);

      // worker: mandatory because leases_org_worker_fk (leases.ts:92-96) binds
      // (organization_id, worker_id) -> workers(organization_id, id) and the rich
      // lease tuple requires worker_id NOT NULL. Its (target_authority_key,
      // execution_target_id) pair satisfies workers_target_authority_fk against the
      // target above. status='enrolled' + all device identity columns set clears
      // workers_device_identity_check.
      await db.execute(sql`
        INSERT INTO workers
          (id, scope, organization_id, execution_target_id, target_authority_key,
           device_public_key, device_thumbprint, device_generation, profile_hash,
           enrolled_at, label, status)
        VALUES
          (${workerId}, 'organization', ${ORG}, ${targetId}, ${AUTHORITY_KEY},
           'dat007-pk', 'dat007-thumb', 1, ${HEX64},
           clock_timestamp(), 'DAT-007 worker', 'enrolled')`);

      // job: only (id, organization_id, company_id) are non-defaulted; idempotency_key
      // defaults to a fresh uuid so jobs_submission_idempotency_uq never collides
      // across cases. Satisfies jobs_org_company_fk against the spine company.
      await db.execute(sql`
        INSERT INTO jobs (id, organization_id, company_id)
        VALUES (${jobId}, ${ORG}, ${COMPANY})`);

      // job_attempt: placement columns omitted -> all-NULL branch of
      // job_attempts_placement_atomic_check; capacity_claim_state defaults
      // 'unclaimed'. attempt_number=1. Satisfies job_attempts_org_job_fk against the
      // job. status is the flipped knob ('running' non-terminal / 'expired' terminal).
      await db.execute(sql`
        INSERT INTO job_attempts
          (id, organization_id, company_id, job_id, attempt_number, status)
        VALUES
          (${attemptId}, ${ORG}, ${COMPANY}, ${jobId}, 1, ${opts.attemptStatus})`);

      // lease: FULL rich authority tuple (leases_authority_atomic_check). status
      // 'active' with activated_at set clears leases_activation_check. ack_deadline
      // is strictly before expires_at in BOTH the future and past variants.
      const expiresAt =
        opts.leaseExpiry === "future"
          ? sql`clock_timestamp() + interval '1 hour'`
          : sql`clock_timestamp() - interval '1 hour'`;
      const ackDeadline =
        opts.leaseExpiry === "future"
          ? sql`clock_timestamp() + interval '30 minutes'`
          : sql`clock_timestamp() - interval '2 hours'`;
      await db.execute(sql`
        INSERT INTO leases
          (id, organization_id, attempt_id, company_id, job_id, attempt_number,
           worker_id, target_id, target_authority_key, target_generation,
           profile_hash, provider_constraint_hash, status, fence,
           ack_deadline, expires_at, activated_at)
        VALUES
          (${leaseId}, ${ORG}, ${attemptId}, ${COMPANY}, ${jobId}, 1,
           ${workerId}, ${targetId}, ${AUTHORITY_KEY}, 1,
           ${HEX64}, ${PROVIDER_HEX64}, 'active', ${`dat007-fence-${leaseId}`},
           ${ackDeadline}, ${expiresAt}, clock_timestamp())`);

      // heartbeat_run: the SIGNED run id. execution_owner='distributed' points the
      // resolver's job_attempts join at this attempt (same company). distributed_*
      // columns have no CHECK/FK, set freely.
      await db.execute(sql`
        INSERT INTO heartbeat_runs
          (id, company_id, agent_id, execution_owner, distributed_job_id, distributed_attempt_id)
        VALUES
          (${runId}, ${COMPANY}, ${AGENT}, 'distributed', ${jobId}, ${attemptId})`);

      return { runId, attemptId, jobId };
    }

    // Local org run: ONLY a heartbeat_runs row, execution_owner left NULL. No
    // job/attempt/lease/target — the resolver's distributed joins yield nulls.
    async function seedLocalRun(): Promise<string> {
      const runId = randomUUID();
      await db.execute(sql`
        INSERT INTO heartbeat_runs (id, company_id, agent_id)
        VALUES (${runId}, ${COMPANY}, ${AGENT})`);
      return runId;
    }

    it("ADMIT — live distributed run: active fresh lease, non-terminal attempt, current target", async () => {
      assertSetupOk();
      const runId = await seedDistributedRun({ attemptStatus: "running", leaseExpiry: "future" });
      const verdict = await createDistributedRunCurrencyResolver(db).resolve({
        signedRunId: runId,
        companyId: COMPANY,
        agentId: AGENT,
      });
      expect(verdict).toBe("admit");
    });

    it("DENY — stale: lease expires_at is in the past (fails the SQL-clock freshness check)", async () => {
      assertSetupOk();
      // Single-knob flip from the admit baseline: expiry future -> past.
      const runId = await seedDistributedRun({ attemptStatus: "running", leaseExpiry: "past" });
      const verdict = await createDistributedRunCurrencyResolver(db).resolve({
        signedRunId: runId,
        companyId: COMPANY,
        agentId: AGENT,
      });
      expect(verdict).toBe("deny");
    });

    it("DENY — replaced: attempt status is terminal ('expired') though the lease is active+fresh", async () => {
      assertSetupOk();
      // Single-knob flip from the admit baseline: attempt running -> expired. The
      // lease stays active+fresh — the adversarial "not yet reaped" race that the
      // terminal-attempt cutoff must catch independently of lease liveness.
      const runId = await seedDistributedRun({ attemptStatus: "expired", leaseExpiry: "future" });
      const verdict = await createDistributedRunCurrencyResolver(db).resolve({
        signedRunId: runId,
        companyId: COMPANY,
        agentId: AGENT,
      });
      expect(verdict).toBe("deny");
    });

    it("ADMIT — local run: heartbeat_runs.execution_owner IS NULL (central false-deny guard)", async () => {
      assertSetupOk();
      const runId = await seedLocalRun();
      const verdict = await createDistributedRunCurrencyResolver(db).resolve({
        signedRunId: runId,
        companyId: COMPANY,
        agentId: AGENT,
      });
      expect(verdict).toBe("admit");
    });

    it("ADMIT — no run row: a signed run id with no heartbeat_runs row (fail-open, TTL-bounded)", async () => {
      assertSetupOk();
      const verdict = await createDistributedRunCurrencyResolver(db).resolve({
        signedRunId: randomUUID(),
        companyId: COMPANY,
        agentId: AGENT,
      });
      expect(verdict).toBe("admit");
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // DAT-007-S3 — the genuinely-missing Tier-3 cases (E5 implementation plan,
    // `DAT-007-S3`). Each is a SINGLE-KNOB flip from the live-run admit baseline above
    // (case 1), and each is paired with the mutant of the resolver/classifier line it
    // exercises in `tickets/DAT-007-S3-result.md`.
    // ─────────────────────────────────────────────────────────────────────────────

    const resolveFor = (signedRunId: string, tenant: { company: string; agent: string }) =>
      createDistributedRunCurrencyResolver(db).resolve({
        signedRunId,
        companyId: tenant.company,
        agentId: tenant.agent,
      });

    // Pull a Postgres SQLSTATE out of a thrown error, whether the driver error is thrown
    // directly or wrapped (drizzle wraps query errors and keeps the driver error as `cause`).
    function pgCode(err: unknown): string | undefined {
      let cur: unknown = err;
      for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth += 1) {
        const code = (cur as { code?: unknown }).code;
        if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
        cur = (cur as { cause?: unknown }).cause;
      }
      return undefined;
    }

    it("DENY — replaced target generation: target device_generation moved past the lease's target_generation", async () => {
      assertSetupOk();
      // Single-knob flip from the admit baseline: the target's CURRENT generation is 2 while
      // the lease still carries target_generation 1 (the target was re-enrolled/replaced after
      // the lease was granted). Lease active+fresh, attempt running, target not disabled.
      const { runId } = await seedDistributedChain({
        attemptStatus: "running",
        leaseExpiry: "future",
        targetDeviceGeneration: 2,
      });
      expect(await resolveFor(runId, TENANT_A)).toBe("deny");
    });

    it("DENY — revoked target: execution_targets.status = 'disabled' under a live lease", async () => {
      assertSetupOk();
      // Single-knob flip from the admit baseline: target status active -> disabled. The
      // generations still match (1/1), so only the disabled arm can produce the deny.
      const { runId } = await seedDistributedChain({
        attemptStatus: "running",
        leaseExpiry: "future",
        targetStatus: "disabled",
      });
      expect(await resolveFor(runId, TENANT_A)).toBe("deny");
    });

    it("DENY — wrong ORGANIZATION: a live Org-A run presented against Org B's company (same-tenant control admits)", async () => {
      assertSetupOk();
      const { runId } = await seedDistributedChain({ attemptStatus: "running", leaseExpiry: "future" });
      // Same-tenant positive control: the SAME live run, presented against its own company.
      expect(await resolveFor(runId, TENANT_A)).toBe("admit");
      // Cross-tenant: the identical signed run id presented at Org B's company URL.
      expect(await resolveFor(runId, TENANT_B)).toBe("deny");
    });

    it("DENY — wrong ORGANIZATION, reversed: a live Org-B run presented against Org A's company (same-tenant control admits)", async () => {
      assertSetupOk();
      const { runId } = await seedDistributedChain({
        attemptStatus: "running",
        leaseExpiry: "future",
        tenant: TENANT_B,
      });
      // Same-tenant positive control: proves the Org-B chain is itself a live, admissible run.
      expect(await resolveFor(runId, TENANT_B)).toBe("admit");
      expect(await resolveFor(runId, TENANT_A)).toBe("deny");
    });

    it("DENY — wrong COMPANY in the SAME Organization: a live company-A run presented against company A2", async () => {
      assertSetupOk();
      const { runId } = await seedDistributedChain({ attemptStatus: "running", leaseExpiry: "future" });
      expect(await resolveFor(runId, TENANT_A)).toBe("admit");
      expect(await resolveFor(runId, { company: COMPANY_A2, agent: AGENT })).toBe("deny");
    });

    it("DENY — cross-tenant attempt pointer: an Org-A run whose distributed_attempt_id names Org B's LIVE attempt", async () => {
      assertSetupOk();
      // Org B holds a fully live chain. Its own run admits — the positive control that the
      // attempt/lease/target being pointed at really is live.
      const b = await seedDistributedChain({
        attemptStatus: "running",
        leaseExpiry: "future",
        tenant: TENANT_B,
      });
      expect(await resolveFor(b.runId, TENANT_B)).toBe("admit");
      // An Org-A distributed run row whose attempt pointer names Org B's attempt (the
      // distributed_* columns carry no FK). It must NOT borrow B's liveness: the resolver's
      // attempt join requires job_attempts.company_id = heartbeat_runs.company_id, so the
      // attempt/lease/target hops all miss and the distributed run is denied.
      const foreignRunId = randomUUID();
      await db.execute(sql`
        INSERT INTO heartbeat_runs
          (id, company_id, agent_id, execution_owner, distributed_job_id, distributed_attempt_id)
        VALUES
          (${foreignRunId}, ${COMPANY}, ${AGENT}, 'distributed', ${b.jobId}, ${b.attemptId})`);
      expect(await resolveFor(foreignRunId, TENANT_A)).toBe("deny");
    });

    it("FAIL-CLOSED — a real query error inside the real resolver propagates (malformed signed run id → 22P02)", async () => {
      assertSetupOk();
      // heartbeat_runs.id is uuid; a signed run_id that is not a uuid makes Postgres itself
      // reject the real query (invalid_text_representation). The resolver must REJECT — a
      // catch-and-admit reader would resolve "admit" here and this test would red.
      const err = await resolveFor("not-a-uuid", TENANT_A).then(
        (verdict) => ({ resolvedWith: verdict }),
        (e: unknown) => e,
      );
      expect(err).not.toHaveProperty("resolvedWith");
      expect(pgCode(err)).toBe("22P02");
    });

    it("FAIL-CLOSED — a real connection-level error inside the real resolver propagates (absent database → 3D000)", async () => {
      assertSetupOk();
      // Same real server, a database that does not exist: the pool itself fails on connect.
      const brokenDb = createDb(`postgres://test:test@localhost:${pgPort}/dat007_absent_database`);
      try {
        const err = await createDistributedRunCurrencyResolver(brokenDb)
          .resolve({ signedRunId: randomUUID(), companyId: COMPANY, agentId: AGENT })
          .then(
            (verdict) => ({ resolvedWith: verdict }),
            (e: unknown) => e,
          );
        expect(err).not.toHaveProperty("resolvedWith");
        expect(pgCode(err)).toBe("3D000");
      } finally {
        await (brokenDb as unknown as { $client: { end(): Promise<void> } }).$client.end();
      }
    });

    it("PLAN SHAPE — every hop of the real resolver query is an index probe (no scan), with a scan-detecting positive control", async () => {
      assertSetupOk();
      // Capture the EXACT statement the real resolver sends, via a traced client.
      const captured: Array<{ query: string; params: unknown[] }> = [];
      const client = postgres(connectionString, {
        connection: { client_encoding: "UTF8" },
        debug: (_conn: number, query: string, params: unknown[]) => {
          captured.push({ query, params });
        },
      });
      try {
        const tracedDb = drizzlePg(client) as unknown as Db;
        const { runId } = await seedDistributedChain({ attemptStatus: "running", leaseExpiry: "future" });
        expect(
          await createDistributedRunCurrencyResolver(tracedDb).resolve({
            signedRunId: runId,
            companyId: COMPANY,
            agentId: AGENT,
          }),
        ).toBe("admit");
        const statement = captured.find((c) => c.query.includes('"heartbeat_runs"'));
        expect(statement, "the resolver's statement was captured").toBeDefined();

        type PlanNode = {
          "Node Type": string;
          "Relation Name"?: string;
          "Index Name"?: string;
          "Index Cond"?: string;
          Plans?: PlanNode[];
        };
        const explain = async (query: string, params: unknown[]): Promise<PlanNode> =>
          client.begin(async (tx) => {
            // Seq scans OFF: on tiny test tables the planner would otherwise prefer a scan
            // even where an index exists. With them off, any relation that STILL appears as a
            // non-probe scan has no usable index for this predicate — the regression we pin.
            await tx.unsafe("SET LOCAL enable_seqscan = off");
            const rows = (await tx.unsafe(`EXPLAIN (FORMAT JSON) ${query}`, params as never[])) as unknown as Array<
              Record<string, Array<{ Plan: PlanNode }>>
            >;
            return rows[0]!["QUERY PLAN"]![0]!.Plan;
          }) as Promise<PlanNode>;
        const relationScans = (node: PlanNode, out: PlanNode[] = []): PlanNode[] => {
          if (node["Relation Name"]) out.push(node);
          for (const child of node.Plans ?? []) relationScans(child, out);
          return out;
        };
        const nonProbes = (plan: PlanNode) =>
          relationScans(plan).filter(
            (n) => !(/^Index (Only )?Scan$/.test(n["Node Type"]) && typeof n["Index Cond"] === "string"),
          );

        const plan = await explain(statement!.query, statement!.params);
        const scans = relationScans(plan);
        // eslint-disable-next-line no-console
        console.log(
          "[dat-007-s3] resolver plan (enable_seqscan=off):",
          JSON.stringify(scans.map((n) => [n["Relation Name"], n["Node Type"], n["Index Name"] ?? null, n["Index Cond"] ?? null])),
        );
        // All four hops are present (no join was elided) ...
        expect(new Set(scans.map((n) => n["Relation Name"]))).toEqual(
          new Set(["heartbeat_runs", "job_attempts", "leases", "execution_targets"]),
        );
        // ... and every one is an index probe with an index condition.
        expect(nonProbes(plan)).toEqual([]);

        // Positive control: the same detector on a predicate with NO index (organizations.name)
        // must report a non-probe scan, or the assertion above could be vacuous.
        const control = await explain("SELECT id FROM organizations WHERE name = $1", ["x"]);
        expect(nonProbes(control).length).toBeGreaterThan(0);
      } finally {
        await client.end();
      }
    });
  },
);
