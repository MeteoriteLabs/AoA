// W21 / E7-F020 — arm 2 of `capabilityProven` must count DISTRIBUTED provenance only.
//
// ★★★ THIS IS A DISCRIMINATION TEST, NOT A SUPPRESSION TEST. `return 0` would satisfy any
// suite that only checks the runtime-service row stops counting, and a capability bar nobody
// can pass gets deleted. So every arm below is paired:
//
//   NEGATIVE  — a `task_outputs` row written by the ORDINARY heartbeat path
//               (`emitRuntimeServiceTaskOutput`, the E7-F020 writer) with
//               `created_by_run_id = <this run>` must NOT be counted.
//   POSITIVE  — a `task_outputs` row of genuine distributed provenance
//               (`jobOutputBridge.projectAcceptedOutput`, driven by a REAL live lease fence
//               on this run's distributed job) MUST still be counted.
//   MIXED     — both rows present for the same run counts EXACTLY ONE.
//
// Pre-fix (predicate `eq(taskOutputs.createdByRunId, run.id)`) the NEGATIVE arm and the MIXED
// arm are RED and both POSITIVE arms behave differently — that observation is what pins the
// defect. Post-fix all of them are green.
//
// Embedded PG; Linux CI is the formal authority. SKIPPED on Windows unless
// AOA_RUN_WIN_INTEGRATION=1 (Issue #114), exactly like every sibling suite.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@armyofagents/db";
import type { SubmitJobSource } from "@armyofagents/shared";
import {
  setupJobControlFixture,
  COMPANY,
  ORG,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";
import { runInTenantReadOnly } from "../db/tenant-context.js";
import { jobOutputBridge, type BridgeActor } from "../services/job-output-bridge.js";
import { emitRuntimeServiceTaskOutput } from "../services/task-output-emitters.js";
import { createDrizzleE7RunVerifierStore } from "../services/e7-distributed-run-verifier-store.js";
import type { E7ProducedOutputCounts } from "../services/e7-distributed-run-verifier.js";

const ENABLED_ENV = { AOA_DISTRIBUTED_EXECUTION_ENABLED: "true" } as const;
const AGENT = "a8000000-0000-4000-8000-0000000000e1";
const USER = "w21-user";
const ISSUE = "a8000000-0000-4000-8000-0000000000f1";
const RUN = "a8000000-0000-4000-8000-0000000000c1";
const SERVICE = "a8000000-0000-4000-8000-0000000000d1";
const DIGEST = "c".repeat(64);
const actor: BridgeActor = { kind: "user", id: USER, companyId: COMPANY };
const TASK_SOURCE: SubmitJobSource = {
  kind: "task_run",
  runId: RUN,
  issueId: ISSUE,
  assigneeAgentId: AGENT,
};

let fixture: JobControlFixture | null = null;
let setupError: unknown = null;

function guard(): void {
  if (setupError) throw new Error(`fixture setup failed: ${String(setupError)}`);
}

/** Bind the run row to a distributed job, then read the counts through the REAL store. */
async function countsForJob(jobId: string | null, attemptId: string | null): Promise<E7ProducedOutputCounts> {
  await fixture!.admin`UPDATE heartbeat_runs
    SET execution_owner = 'distributed', distributed_job_id = ${jobId}, distributed_attempt_id = ${attemptId}
    WHERE id = ${RUN}`;
  return runInTenantReadOnly(fixture!.app.db, ORG, async (_repos, tx) => {
    const store = createDrizzleE7RunVerifierStore(tx as Db);
    const run = await store.getRun(RUN);
    if (!run) throw new Error("run row missing");
    return store.countProducedOutputs(run);
  });
}

/** The E7-F020 writer, called for real — `heartbeat.ts:4524`'s emitter with this run's id. */
async function writeRuntimeServiceOutput(): Promise<void> {
  await fixture!.admin`INSERT INTO workspace_runtime_services
    (id, company_id, issue_id, scope_type, service_name, status, lifecycle, provider, started_by_run_id)
    VALUES (${SERVICE}, ${COMPANY}, ${ISSUE}, 'issue', 'dev server', 'starting', 'ephemeral', 'local', ${RUN})
    ON CONFLICT (id) DO NOTHING`;
  const emitted = await emitRuntimeServiceTaskOutput(fixture!.app.db, {
    id: SERVICE,
    companyId: COMPANY,
    issueId: ISSUE,
    serviceName: "dev server",
    provider: "local",
    status: "starting",
    startedByRunId: RUN,
  });
  // The emitter is best-effort and swallows every error, so a silent no-op would make the
  // negative arm VACUOUS. Assert the row actually landed, with the run linkage that is the
  // whole point of the finding.
  if (!emitted) throw new Error("emitRuntimeServiceTaskOutput wrote nothing — negative arm would be vacuous");
  const [row] = await fixture!.admin`SELECT count(*)::int AS n FROM task_outputs
    WHERE created_by_run_id = ${RUN} AND runtime_service_id = ${SERVICE}`;
  if ((row as { n: number }).n !== 1) {
    throw new Error("expected exactly one platform-written task_output carrying this run id");
  }
}

beforeAll(async () => {
  try {
    fixture = await setupJobControlFixture("w21-e7f020");
    await fixture.admin`INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES (${AGENT}, ${COMPANY}, 'W21 Agent', 'org', 'idle', 'claude_local', ${fixture.admin.json({})})`;
    await fixture.admin`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${USER}, 'W21 User', 'w21@example.test', true, now(), now())`;
    await fixture.admin`INSERT INTO company_memberships (company_id, principal_type, principal_id, status, membership_role)
      VALUES (${COMPANY}, 'user', ${USER}, 'active', 'owner')`;
    await fixture.admin`INSERT INTO issues (id, company_id, title) VALUES (${ISSUE}, ${COMPANY}, 'W21 Task')`;
    await fixture.admin`INSERT INTO heartbeat_runs (id, company_id, agent_id, status)
      VALUES (${RUN}, ${COMPANY}, ${AGENT}, 'succeeded')`;
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  await fixture?.teardown().catch(() => {});
}, 60_000);

beforeEach(async () => {
  if (!fixture) return;
  await fixture.admin`DELETE FROM task_outputs`;
  await fixture.admin`DELETE FROM workspace_runtime_services`;
});

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "E7-F020 — arm 2 counts distributed provenance only",
  () => {
    // NEGATIVE ------------------------------------------------------------
    it("[negative] a runtime-service task_output written by the platform for this run is NOT counted", async () => {
      guard();
      const { seeded } = await fixture!.activateLease(1);
      await writeRuntimeServiceOutput();
      const counts = await countsForJob(seeded.jobId, seeded.attemptId);
      expect(counts.taskOutputs).toBe(0);
      expect(counts.workspacePatchArtifacts).toBe(0);
    });

    // POSITIVE CONTROL A ---------------------------------------------------
    it("[positive] an output projected through the distributed bridge on this run's job IS counted", async () => {
      guard();
      const { seeded, identity: fence } = await fixture!.activateLease(2);
      const projected = await jobOutputBridge(fixture!.app.db, { env: ENABLED_ENV }).projectAcceptedOutput({
        source: TASK_SOURCE,
        actor,
        fence,
        acceptedEventId: randomUUID(),
        eventDigest: DIGEST,
        issueId: ISSUE,
        output: { type: "external_link", title: "W21 agent output", url: "https://example.test/w21", createdByRunId: RUN },
      });
      expect(projected.status).toBe("recorded");
      const counts = await countsForJob(seeded.jobId, seeded.attemptId);
      expect(counts.taskOutputs).toBe(1);
    });

    // POSITIVE CONTROL B ---------------------------------------------------
    it("[positive] it is counted even when the bridge caller supplied NO run id — provenance is the receipt, not the column", async () => {
      guard();
      const { seeded, identity: fence } = await fixture!.activateLease(3);
      const projected = await jobOutputBridge(fixture!.app.db, { env: ENABLED_ENV }).projectAcceptedOutput({
        source: TASK_SOURCE,
        actor,
        fence,
        acceptedEventId: randomUUID(),
        eventDigest: DIGEST,
        issueId: ISSUE,
        output: { type: "external_link", title: "W21 no-run-id output", url: "https://example.test/w21b" },
      });
      expect(projected.status).toBe("recorded");
      const [row] = await fixture!.admin`SELECT count(*)::int AS n FROM task_outputs WHERE created_by_run_id IS NULL`;
      expect((row as { n: number }).n).toBe(1);
      const counts = await countsForJob(seeded.jobId, seeded.attemptId);
      expect(counts.taskOutputs).toBe(1);
    });

    // MIXED — the arm that `return 0` cannot pass and the pre-fix predicate cannot pass ----
    it("[mixed] with BOTH rows present the count is exactly one — the distributed one", async () => {
      guard();
      const { seeded, identity: fence } = await fixture!.activateLease(4);
      await writeRuntimeServiceOutput();
      const projected = await jobOutputBridge(fixture!.app.db, { env: ENABLED_ENV }).projectAcceptedOutput({
        source: TASK_SOURCE,
        actor,
        fence,
        acceptedEventId: randomUUID(),
        eventDigest: DIGEST,
        issueId: ISSUE,
        output: { type: "external_link", title: "W21 agent output", url: "https://example.test/w21c", createdByRunId: RUN },
      });
      const [total] = await fixture!.admin`SELECT count(*)::int AS n FROM task_outputs WHERE issue_id = ${ISSUE}`;
      expect((total as { n: number }).n).toBe(2);
      const counts = await countsForJob(seeded.jobId, seeded.attemptId);
      expect(counts.taskOutputs).toBe(1);
      const [receipt] = await fixture!.admin`SELECT target_aggregate_id FROM job_projection_receipts
        WHERE projection_kind = 'output_projection'`;
      expect((receipt as { target_aggregate_id: string }).target_aggregate_id).toBe(projected.outputId);
    });

    // CROSS-JOB ------------------------------------------------------------
    it("[cross-job] a projected output does not count for a run bound to a DIFFERENT distributed job", async () => {
      guard();
      const { identity: fence } = await fixture!.activateLease(5);
      await jobOutputBridge(fixture!.app.db, { env: ENABLED_ENV }).projectAcceptedOutput({
        source: TASK_SOURCE,
        actor,
        fence,
        acceptedEventId: randomUUID(),
        eventDigest: DIGEST,
        issueId: ISSUE,
        output: { type: "external_link", title: "W21 other job", url: "https://example.test/w21d", createdByRunId: RUN },
      });
      const counts = await countsForJob(randomUUID(), randomUUID());
      expect(counts.taskOutputs).toBe(0);
    });

    // NO DISTRIBUTED JOB ---------------------------------------------------
    it("[no job] an ordinary non-distributed run counts nothing, however many platform rows it wrote", async () => {
      guard();
      await fixture!.resetRuntimeRows();
      await writeRuntimeServiceOutput();
      const counts = await countsForJob(null, null);
      expect(counts.taskOutputs).toBe(0);
      expect(counts.workspacePatchArtifacts).toBe(0);
    });
  },
);
