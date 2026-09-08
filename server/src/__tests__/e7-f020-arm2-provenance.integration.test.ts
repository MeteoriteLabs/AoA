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
// ═══════════════════════════════════════════════════════════════════════════════
// ★★★ SECOND SUBJECT, SAME FILE, ON PURPOSE — E7-F030, the sibling W21 left behind.
//
// `countProducedOutputs` (arm 2) and `listRunSecretScanSurfaces` (clause 4's task_outputs
// source) are TWO consumers of one question — "which task_outputs rows belong to this
// run?" — and W21 moved only the first. A row projected through the bridge with NO
// caller-supplied run id (exactly the `[positive B]` case below, which asserts that shape
// is SUPPORTED) counted as capability evidence and was NEVER scanned for secrets, so the
// verifier could print a clean mechanism/capability verdict over a leaked key.
//
// The two consumers want OPPOSITE error directions — the counter PRECISION, the scanner
// RECALL — so the second describe block below pins BOTH directions at once, and the
// file keeps them adjacent so the next person to "make the predicates consistent" trips
// over the pin before the edit. See the census in the store's module header.
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
import {
  createE7DistributedRunVerifier,
  type E7ProducedOutputCounts,
  type E7ScanSurface,
  type E7VerifyResult,
} from "../services/e7-distributed-run-verifier.js";

const ENABLED_ENV = { AOA_DISTRIBUTED_EXECUTION_ENABLED: "true" } as const;
const AGENT = "a8000000-0000-4000-8000-0000000000e1";
const USER = "w21-user";
const ISSUE = "a8000000-0000-4000-8000-0000000000f1";
const RUN = "a8000000-0000-4000-8000-0000000000c1";
const SERVICE = "a8000000-0000-4000-8000-0000000000d1";
const DIGEST = "c".repeat(64);
// A recognizable leak-class value for clause 4's `provider_key` matcher
// (/\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/). NOT a credential — the same synthetic shape the
// pure verifier suite already plants (`e7-distributed-run-verifier.test.ts:39`).
const PLANTED_PROVIDER_KEY = "sk-ant-api03W21SCANNERPROOF0123456789";
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

/**
 * Bind the run to a distributed job, then read BOTH clause-4 inputs through the REAL store:
 * the raw scan surfaces, and the full verifier verdict computed over them. The verdict is
 * what the mandate asks for — "assert clause 4 SEES it" — and the raw surfaces are kept so a
 * failure says whether the row was missed by the SCAN or lost between scan and verdict.
 */
async function scanForJob(
  jobId: string | null,
  attemptId: string | null,
): Promise<{ surfaces: readonly E7ScanSurface[]; result: E7VerifyResult }> {
  await fixture!.admin`UPDATE heartbeat_runs
    SET execution_owner = 'distributed', distributed_job_id = ${jobId}, distributed_attempt_id = ${attemptId}
    WHERE id = ${RUN}`;
  return runInTenantReadOnly(fixture!.app.db, ORG, async (_repos, tx) => {
    const store = createDrizzleE7RunVerifierStore(tx as Db);
    const run = await store.getRun(RUN);
    if (!run) throw new Error("run row missing");
    const surfaces = await store.listRunSecretScanSurfaces(run);
    const result = await createE7DistributedRunVerifier({ store }).verify({ runId: RUN });
    return { surfaces, result };
  });
}

/** The clause-4 hard failures naming a specific `task_outputs` row. SHAPE only — the reason
 * string carries the matched CLASS and the row id, never the matched substring. */
function clause4HitsFor(result: E7VerifyResult, outputId: string): readonly string[] {
  return result.failures
    .filter((f) => f.clause === 4 && f.reason.includes(`task_outputs#${outputId}`))
    .map((f) => f.reason);
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

// ═══════════════════════════════════════════════════════════════════════════════
// E7-F030 — clause 4's task_outputs scan surface is the UNION, not the counter's predicate.
//
// ★ WHY THESE LIVE BESIDE THE ARM-2 TESTS. The defect they pin is not "the scanner has the
// wrong predicate" — it is "TWO consumers of one provenance notion drifted apart, and
// nothing noticed". Splitting them into a separate file would let the next edit to arm 2
// happen without this suite in view, which is precisely how the drift happened.
//
// ★ WHICH ARM CATCHES WHICH MISTAKE:
//   [union]   RED before this fix — the reviewer-found defect itself.
//   [legacy]  GREEN before AND after — the POSITIVE CONTROL, and the more important of the
//             two: it is the only arm that reddens on the tempting "just copy the counter's
//             receipt predicate into the scanner" fix, which would silently stop scanning
//             every legacy platform writer (the mirror defect).
//   [dedupe]  a row satisfying BOTH notions is scanned ONCE.
// ═══════════════════════════════════════════════════════════════════════════════
describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "E7-F030 — the secret-scan surface is the union of both provenance notions",
  () => {
    // THE DEFECT ------------------------------------------------------------
    // RED at f433c8391: the row's created_by_run_id is NULL (asserted below, the same shape
    // `[positive B]` asserts is supported), so the pre-fix `eq(createdByRunId, run.id)` scan
    // never saw it — arm 2 counted it as capability evidence while clause 4 reported clean.
    it("[union] a bridge-projected output with NO caller run id is SCANNED — its planted key reaches clause 4", async () => {
      guard();
      const { seeded, identity: fence } = await fixture!.activateLease(6);
      const projected = await jobOutputBridge(fixture!.app.db, { env: ENABLED_ENV }).projectAcceptedOutput({
        source: TASK_SOURCE,
        actor,
        fence,
        acceptedEventId: randomUUID(),
        eventDigest: DIGEST,
        issueId: ISSUE,
        output: {
          type: "external_link",
          title: "W21B leaked-summary output",
          url: "https://example.test/w21b-scan",
          // NO createdByRunId — provenance is the receipt, and the leak is in the summary.
          summary: `agent transcript tail: exporting ${PLANTED_PROVIDER_KEY} to the sandbox`,
        },
      });
      expect(projected.status).toBe("recorded");
      const outputId = projected.outputId as string;

      // Anti-vacuity: the row really is invisible to the OLD predicate. If this ever becomes
      // 0, the fixture stopped exercising the defect and the arm below proves nothing.
      const [nulls] = await fixture!.admin`SELECT count(*)::int AS n FROM task_outputs
        WHERE id = ${outputId} AND created_by_run_id IS NULL`;
      expect((nulls as { n: number }).n).toBe(1);

      const { surfaces, result } = await scanForJob(seeded.jobId, seeded.attemptId);
      expect(surfaces.some((s) => s.surface === "task_outputs" && s.fieldOrEventId === outputId)).toBe(true);
      const hits = clause4HitsFor(result, outputId);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain("provider_key");
      // SHAPE ONLY — the reason must never quote the matched value (design §6 / §8 BLOCKER 3).
      expect(hits[0]).not.toContain(PLANTED_PROVIDER_KEY);
      // And the row IS the one arm 2 counts, which is what made the gap dangerous.
      expect(result.observed.producedArtifacts.taskOutputs).toBe(1);
    });

    // POSITIVE CONTROL — green before and after; reds on a same-predicate "consistency" fix.
    it("[legacy] a platform row linked ONLY by created_by_run_id is STILL scanned", async () => {
      guard();
      const { seeded } = await fixture!.activateLease(7);
      await writeRuntimeServiceOutput();
      const [row] = await fixture!.admin`UPDATE task_outputs
        SET summary = ${`dev server env dump: ${PLANTED_PROVIDER_KEY}`}
        WHERE created_by_run_id = ${RUN} RETURNING id`;
      const outputId = (row as { id: string }).id;
      // It carries NO receipt — so a scanner narrowed to the counter's predicate loses it.
      const [receipts] = await fixture!.admin`SELECT count(*)::int AS n FROM job_projection_receipts
        WHERE target_aggregate_id = ${outputId}`;
      expect((receipts as { n: number }).n).toBe(0);

      const { surfaces, result } = await scanForJob(seeded.jobId, seeded.attemptId);
      expect(surfaces.some((s) => s.surface === "task_outputs" && s.fieldOrEventId === outputId)).toBe(true);
      expect(clause4HitsFor(result, outputId)).toHaveLength(1);
      // The counter must NOT count it — the two consumers disagreeing about THIS row is the
      // whole point, and this asserts the divergence rather than merely tolerating it.
      expect(result.observed.producedArtifacts.taskOutputs).toBe(0);
    });

    // DEDUPE ----------------------------------------------------------------
    it("[dedupe] a row satisfying BOTH notions is scanned exactly once", async () => {
      guard();
      const { seeded, identity: fence } = await fixture!.activateLease(8);
      const projected = await jobOutputBridge(fixture!.app.db, { env: ENABLED_ENV }).projectAcceptedOutput({
        source: TASK_SOURCE,
        actor,
        fence,
        acceptedEventId: randomUUID(),
        eventDigest: DIGEST,
        issueId: ISSUE,
        output: {
          type: "external_link",
          title: "W21B both-notions output",
          url: "https://example.test/w21b-both",
          summary: `both linkages: ${PLANTED_PROVIDER_KEY}`,
          createdByRunId: RUN,
        },
      });
      expect(projected.status).toBe("recorded");
      const outputId = projected.outputId as string;

      const { surfaces, result } = await scanForJob(seeded.jobId, seeded.attemptId);
      expect(surfaces.filter((s) => s.surface === "task_outputs" && s.fieldOrEventId === outputId)).toHaveLength(1);
      // One surface ⇒ one clause-4 failure. A duplicated surface would double-report the
      // same leak and inflate every count printed beside the verdict.
      expect(clause4HitsFor(result, outputId)).toHaveLength(1);
      expect(result.observed.producedArtifacts.taskOutputs).toBe(1);
    });
  },
);
