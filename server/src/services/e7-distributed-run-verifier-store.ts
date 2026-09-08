// server/src/services/e7-distributed-run-verifier-store.ts
//
// evidence-verifier A — drizzle wiring for the read-only run-verifier store.
//
// Kept OUT of the pure `e7-distributed-run-verifier.ts` acceptance module so its
// fail-first unit tests never load drizzle internals (CLAUDE.md Test Patterns /
// drizzle-ESM split), exactly as `canary-preflight-store.ts` keeps drizzle out of
// `canary-preflight.ts`. This is the ONLY file that imports the schema.
//
// SECURITY (Decision #104): every method returns already-fetched plain data. NO key
// value crosses the port as a parameter; the pure service matches leak-CLASS patterns
// over the raw-at-rest scan text and discards it. The store exposes ONLY SELECTs, so
// A structurally cannot mutate state as a side effect of being consulted.
//
// TENANT: methods read by run/attempt/job id (all globally unique) and RETURN each
// row's company_id / organization_id; the pure service asserts tenant consistency
// (run.company_id vs every corroborating row). The distributed kernel tables carry
// FORCE RLS + the aoa_app policy, so the CLI must open the DB with a role/tenant
// context that can see the run's tenant rows — otherwise clause 5 fails SAFE-CLOSED
// (missing corroboration → refuse to bless), never a false PASS.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ★★★ PROVENANCE CENSUS — "which rows belong to this run", per consumer.
//
// W21 narrowed ONE consumer (arm 2 of `countProducedOutputs`) onto a receipt join and
// left its sibling in `listRunSecretScanSurfaces` on `created_by_run_id`, so a receipt-
// linked row with a NULL run id counted as capability evidence and was never scanned for
// secrets (E7-F030, found in review of PR #385). The two consumers had drifted because
// the notion was never written down in one place. It is written down here.
//
// ★ THE NOTION IS NOT CENTRALISABLE INTO ONE PREDICATE, and that is the point. Each
// consumer's correct predicate is chosen by its ERROR DIRECTION:
//
//   PRECISION consumers (a wrong row → a false PASS / false PROVEN → must EXCLUDE when unsure)
//   RECALL    consumers (a missed row → a missed secret / missed refusal → must INCLUDE when unsure)
//
// | # | consumer                                | linkage used                                    | direction | right? |
// |---|-----------------------------------------|-------------------------------------------------|-----------|--------|
// | 1 | getRun                                  | heartbeat_runs.id = runId (PK)                  | exact     | yes    |
// | 2 | getAttempt                              | job_attempts.id = run.distributed_attempt_id    | precision | yes — the service re-checks company_id and job_id against the run (clause 5), so a dangling/mismatched id REFUSES |
// | 3 | listLeases                              | leases.attempt_id                               | precision | yes — clause 5 counts corroboration; a foreign lease would be a false PASS. Tenant-filtered in the service |
// | 4 | listJobEvents                           | job_events.attempt_id                           | BOTH      | yes — serves clause 5 (counts, tenant-filtered) AND clause 4 (payload scan, unfiltered). attempt_id is the only linkage the table has, and it is exact, so the two directions do not conflict here |
// | 5 | getAttemptTerminalReceipt               | job_projection_receipts.attempt_id + kind       | precision | yes |
// | 6 | listRunSecretScanSurfaces (1) heartbeat | heartbeat_runs.id (PK)                          | exact     | yes    |
// | 7 | listRunSecretScanSurfaces (2) outputs   | ★ UNION: applied output_projection receipt on   | RECALL    | yes, AS OF THIS CHANGE. It was `created_by_run_id` alone — E7-F030 |
// |   |                                         |   run.distributed_job_id  OR  created_by_run_id |           |        |
// | 8 | listRunSecretScanSurfaces (3) artifacts | job_artifacts.job_id = run.distributed_job_id   | recall    | yes — job_id is the ONLY linkage the table has (no run column), so the union is a singleton |
// | 9 | countProducedOutputs arm 1              | job_artifacts.job_id + kind + status            | precision | yes (its open question is E7-F019 — `kind` is the caller's declaration — not its linkage) |
// |10 | countProducedOutputs arm 2              | applied output_projection receipt on job_id     | PRECISION | yes — E7-F020's narrowing. DO NOT widen it to #7's union |
//
// #7 and #10 read the same table for opposite purposes and MUST stay divergent. The
// divergence is the correct state; what was missing was a written reason, which is now
// at the #7 call site.
//
// ★ A MEASURED RESIDUAL IN #7, reported rather than silently widened: it scans only
// `summary` + `metadata`. `title` (NOT NULL) and `url` are also agent-authored on a
// bridge-projected row and are NOT scanned. That is a COLUMN-set recall gap, a different
// axis from the ROW-set gap fixed here, and widening it changes what trips clause 4 for
// every legacy row too — so it wants its own pinning test and its own review. Recorded in
// E7-F030 rather than fixed here.
// ═══════════════════════════════════════════════════════════════════════════════

import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  heartbeatRuns,
  jobAttempts,
  leases,
  jobEvents,
  jobProjectionReceipts,
  taskOutputs,
  jobArtifacts,
} from "@armyofagents/db";
import type {
  E7RunVerifierStore,
  E7RunRow,
  E7AttemptRow,
  E7LeaseRow,
  E7JobEventRow,
  E7AttemptTerminalReceiptRow,
  E7ScanSurface,
  E7ProducedOutputCounts,
} from "./e7-distributed-run-verifier.js";

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

export function createDrizzleE7RunVerifierStore(db: Db): E7RunVerifierStore {
  return {
    getRun: async (runId: string): Promise<E7RunRow | null> => {
      const rows = await db
        .select({
          id: heartbeatRuns.id,
          companyId: heartbeatRuns.companyId,
          executionOwner: heartbeatRuns.executionOwner,
          distributedJobId: heartbeatRuns.distributedJobId,
          distributedAttemptId: heartbeatRuns.distributedAttemptId,
          status: heartbeatRuns.status,
          errorCode: heartbeatRuns.errorCode,
          error: heartbeatRuns.error,
          finishedAt: heartbeatRuns.finishedAt,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .limit(1);
      return rows[0] ?? null;
    },

    getAttempt: async (attemptId: string): Promise<E7AttemptRow | null> => {
      const rows = await db
        .select({
          id: jobAttempts.id,
          organizationId: jobAttempts.organizationId,
          companyId: jobAttempts.companyId,
          jobId: jobAttempts.jobId,
          status: jobAttempts.status,
        })
        .from(jobAttempts)
        .where(eq(jobAttempts.id, attemptId))
        .limit(1);
      return rows[0] ?? null;
    },

    listLeases: async (attemptId: string): Promise<readonly E7LeaseRow[]> => {
      const rows = await db
        .select({ id: leases.id, companyId: leases.companyId, status: leases.status })
        .from(leases)
        .where(eq(leases.attemptId, attemptId));
      return rows;
    },

    listJobEvents: async (attemptId: string): Promise<readonly E7JobEventRow[]> => {
      const rows = await db
        .select({
          eventId: jobEvents.eventId,
          companyId: jobEvents.companyId,
          eventType: jobEvents.eventType,
          payload: jobEvents.event,
        })
        .from(jobEvents)
        .where(eq(jobEvents.attemptId, attemptId));
      return rows;
    },

    getAttemptTerminalReceipt: async (
      attemptId: string,
    ): Promise<E7AttemptTerminalReceiptRow | null> => {
      const rows = await db
        .select({
          projectionKind: jobProjectionReceipts.projectionKind,
          status: jobProjectionReceipts.status,
          companyId: jobProjectionReceipts.companyId,
        })
        .from(jobProjectionReceipts)
        .where(
          and(
            eq(jobProjectionReceipts.attemptId, attemptId),
            eq(jobProjectionReceipts.projectionKind, "attempt_terminal"),
          ),
        );
      if (rows.length === 0) return null;
      // Prefer an APPLIED receipt when one exists; otherwise surface a pending row so
      // the service can honestly report "receipt present but not applied".
      return rows.find((r) => r.status === "applied") ?? rows[0];
    },

    listRunSecretScanSurfaces: async (run: E7RunRow): Promise<readonly E7ScanSurface[]> => {
      const surfaces: E7ScanSurface[] = [];

      // (1) heartbeat_runs raw-at-rest text fields for THIS run (re-read; getRun
      // returns only the decision fields). detected_outputs is the agent-authored
      // field most likely to leak (§8 LOW 10).
      const runRows = await db
        .select({
          stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
          stderrExcerpt: heartbeatRuns.stderrExcerpt,
          error: heartbeatRuns.error,
          promptSnapshot: heartbeatRuns.promptSnapshot,
          detectedOutputs: heartbeatRuns.detectedOutputs,
          resultJson: heartbeatRuns.resultJson,
          contextSnapshot: heartbeatRuns.contextSnapshot,
          usageJson: heartbeatRuns.usageJson,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, run.id))
        .limit(1);
      const hb = runRows[0];
      if (hb) {
        for (const [field, value] of Object.entries(hb)) {
          const text = textOf(value);
          if (text) surfaces.push({ surface: "heartbeat_runs", fieldOrEventId: field, text });
        }
      }

      // (2) task_outputs belonging to this run — the UNION of BOTH provenance notions,
      //     de-duplicated by row id.
      //
      // ★★★ DO NOT "MAKE THIS CONSISTENT" WITH `countProducedOutputs`. STOP AND READ.
      // The two consumers of "which task_outputs rows belong to this run" want OPPOSITE
      // error directions, so one predicate cannot serve both:
      //
      //   * the COUNTER (arm 2 of clause 6) wants PRECISION. Over-counting prints a false
      //     `capability: PROVEN` over a row the platform wrote, which is E7-F020 — the whole
      //     reason arm 2 was narrowed to the fenced `output_projection` receipt. A row it is
      //     unsure about must NOT be counted.
      //   * this SCANNER (clause 4) wants RECALL. Under-scanning means a recognizable secret
      //     in a row's summary/metadata never reaches clause 4 and the verifier reports a
      //     clean mechanism/capability verdict OVER A LEAKED SECRET. Scanning a row that
      //     turns out not to belong to this run costs one redundant regex pass, and if it
      //     did trip a matcher it fails CLOSED (refuse to bless), never a false PASS.
      //
      // So: narrowing this to the receipt join (the "consistency" fix) would silently stop
      // scanning every legacy platform writer — including `emitRuntimeServiceTaskOutput`,
      // the one that needs nobody to do anything — and widening the counter to this union
      // would re-open E7-F020. Both directions are regressions. A positive control in
      // `e7-f020-arm2-provenance.integration.test.ts` reds on the first; the `[negative]`
      // and `[mixed]` arms there red on the second.
      //
      // ★ THE DEFECT THIS FIXES (E7-F030, introduced by W21 and caught in review). W21 moved
      // arm 2 onto the receipt and left this sibling on `created_by_run_id`. A row projected
      // through `jobOutputBridge.projectAcceptedOutput` with NO caller-supplied run id — the
      // case W21's own `[positive B]` test asserts is SUPPORTED — counted as capability
      // evidence and was never scanned for secrets.
      //
      // ★ TWO QUERIES PLUS A MERGE, deliberately, not one clever `OR`. A single statement
      // needs a LEFT JOIN with a four-conjunct ON clause, `OR r.id IS NOT NULL`, and a
      // DISTINCT over a jsonb column, and it has to degrade correctly when the run has no
      // `distributed_job_id`. Two SELECTs into a Map keyed by row id says exactly what it
      // means and is de-duplicated by construction.
      //
      // ★ NO COMPANY CONJUNCT ON (2a), unlike the counter's. Same reason: for a scanner a
      // cross-tenant row is a redundant scan whose worst case is an over-strict refusal,
      // while for the counter it would be an over-count. (RLS makes it moot in practice —
      // the CLI opens the DB in the run's tenant context — but the asymmetry is intentional.)
      const scanRows = new Map<string, { summary: string | null; metadata: unknown }>();

      // (2a) RECEIPT provenance — the rows arm 2 counts. Present here so a distributed
      // output is scanned whatever its `created_by_run_id` says (including NULL).
      if (run.distributedJobId) {
        const projected = await db
          .select({ id: taskOutputs.id, summary: taskOutputs.summary, metadata: taskOutputs.metadata })
          .from(taskOutputs)
          .innerJoin(jobProjectionReceipts, eq(jobProjectionReceipts.targetAggregateId, taskOutputs.id))
          .where(
            and(
              eq(jobProjectionReceipts.jobId, run.distributedJobId),
              eq(jobProjectionReceipts.projectionKind, "output_projection"),
              eq(jobProjectionReceipts.aggregateKind, "task_outputs"),
              eq(jobProjectionReceipts.status, "applied"),
            ),
          );
        for (const o of projected) scanRows.set(o.id, { summary: o.summary, metadata: o.metadata });
      }

      // (2b) COLUMN provenance — every legacy platform writer that stamps this run's id
      // (`emitRuntimeServiceTaskOutput`, `POST /api/issues/:issueId/outputs`, …). Arm 2
      // deliberately stopped counting these; clause 4 must NOT stop scanning them.
      const columnLinked = await db
        .select({ id: taskOutputs.id, summary: taskOutputs.summary, metadata: taskOutputs.metadata })
        .from(taskOutputs)
        .where(eq(taskOutputs.createdByRunId, run.id));
      for (const o of columnLinked) scanRows.set(o.id, { summary: o.summary, metadata: o.metadata });

      for (const [id, o] of scanRows) {
        const text = `${textOf(o.summary)} ${textOf(o.metadata)}`.trim();
        if (text) surfaces.push({ surface: "task_outputs", fieldOrEventId: id, text });
      }

      // (3) job_artifacts for the distributed job (job id linkage). identifier /
      // object_key are the agent-influenced text; kind/status are enums.
      if (run.distributedJobId) {
        const artifacts = await db
          .select({ id: jobArtifacts.id, identifier: jobArtifacts.identifier, objectKey: jobArtifacts.objectKey })
          .from(jobArtifacts)
          .where(eq(jobArtifacts.jobId, run.distributedJobId));
        for (const a of artifacts) {
          const text = `${textOf(a.identifier)} ${textOf(a.objectKey)}`.trim();
          if (text) surfaces.push({ surface: "job_artifacts", fieldOrEventId: a.id, text });
        }
      }

      // NOTE — the run-summary `issue_comments` body is deliberately NOT scanned here.
      // A run-summary comment carries NO column identifying the RUN that authored it — it
      // is issue-scoped with authorType='system' (the one run↔comment pointer that exists,
      // heartbeat_runs.issueCommentSatisfiedByCommentId, is the reverse ask-human-ANSWER
      // link, not a run-summary key, and is unused in server/src). So attributing a summary
      // to THIS distributed run is indirect and would risk scanning a SIBLING run's summary
      // on the same task — a cross-run false HARD-fail. The comment body is a derived VIEW
      // of data A already scans at its SOURCE (detected_outputs above, task_outputs,
      // run.error), so nothing leak-relevant is lost. Scoped SHOULD-surface per design §7
      // open-Q2. Revisit if a run→summary-comment key is added.

      return surfaces;
    },

    countProducedOutputs: async (run: E7RunRow): Promise<E7ProducedOutputCounts> => {
      let workspacePatchArtifacts = 0;
      if (run.distributedJobId) {
        const artifactRows = await db
          .select({ id: jobArtifacts.id })
          .from(jobArtifacts)
          .where(
            and(
              eq(jobArtifacts.jobId, run.distributedJobId),
              eq(jobArtifacts.kind, "workspace_patch"),
              eq(jobArtifacts.status, "committed"),
            ),
          );
        workspacePatchArtifacts = artifactRows.length;
      }
      // ARM 2 — task_outputs of DISTRIBUTED PROVENANCE, and nothing else (E7-F020).
      //
      // ★★★ WHY THE PREDICATE IS A RECEIPT JOIN AND NOT `created_by_run_id = run.id`.
      // The old predicate was the whole of arm 2 and it filtered on NOTHING but a run
      // linkage that ANY writer of `task_outputs` can set. `upsertTaskOutputForIssue`
      // (`services/task-outputs.ts:135`) is the single INSERT into the table, and
      // enumerating ITS callers — not grepping for the column name — closes the writer
      // census. Eleven production call sites; ten legacy, four of those able to carry a
      // `heartbeat_runs` id, TWO of them able to fire for a handed-off run:
      //
      //   * `task-output-emitters.ts:113` `emitRuntimeServiceTaskOutput`, reached from
      //     `ensureRuntimeServicesForRun` (`heartbeat.ts:4524`) BEFORE the handoff, on the
      //     DEFAULT isolated-workspace configuration, whenever the run declares one
      //     `workspaceRuntime.services[]` entry — nobody has to do anything (E7-F020);
      //   * `routes/task-outputs.ts:54` `POST /api/issues/:issueId/outputs`, which takes
      //     `createdByRunId` from the request body (E7-F015).
      //
      // Both wrote a row this counter read as "the agent produced something". Neither
      // does now: the predicate below does not read `created_by_run_id` at all.
      //
      // WHAT IT ADMITS — exactly one writer. `jobOutputBridge.projectAcceptedOutput`
      // (`job-output-bridge.ts:303`) is the ONLY code in the tree that writes a
      // `job_projection_receipts` row with `projection_kind = 'output_projection'` and
      // `aggregate_kind = 'task_outputs'` (`:306-315`), and it writes it in the SAME
      // tenant transaction as the output, with `target_aggregate_id` = the row it just
      // wrote. `recordGovernedProjection` is the sole INSERT path for that receipt
      // (`repositories/tenant/job-control.ts:3794`) and it runs `guardActiveFence` FIRST,
      // so `job_id` / `attempt_id` are the control plane's LIVE fence — server-verified,
      // never a caller's assertion. So a counted row exists only because a distributed
      // attempt on THIS run's job had an accepted output event projected under an active
      // lease fence. That is provenance, not a heuristic over `type` or `provider`.
      //
      // WHAT IT EXCLUDES — every one of the ten legacy callers, including both live
      // writers above. None of them writes a receipt and none of them can: the receipt
      // insert is fence-guarded on a live distributed attempt, which a pre-handoff
      // heartbeat emitter and an HTTP route do not have.
      //
      // ★ FAIL-CLOSED IN BOTH DIRECTIONS, deliberately. A run with no `distributed_job_id`
      // counts 0 without issuing a query — no distributed job, no distributed output —
      // which also closes E7-F020's weaker form (pointing the verifier at an ORDINARY
      // heartbeat run used to print `capability: PROVEN`). The company conjuncts mean a
      // tenant mismatch UNDER-counts rather than over-counts.
      //
      // ★ TWO BOUNDED NOTES, stated rather than hidden. (a) One output row can carry more
      // than one receipt — `upsertTaskOutputForIssue` UPDATES in place on
      // (company, issue, provider, external_id), so two accepted events with the same
      // provider identity link the same row twice — so rows are DEDUPED by id; arm 2 is a
      // count of ROWS, as it always was. (b) A quarantined (stale/losing) output still
      // carries a receipt and is still counted: it is a real agent output that reached
      // AoA, which is exactly what this arm asks.
      //
      // ★ WHAT THIS DOES NOT BUY, and it is most of what there is: E7-F018 measured that
      // NO checked-in configuration makes any run a distributed run, and that
      // `projectAcceptedOutput` has ZERO production callers. So this predicate admits a
      // writer nothing calls, on a path nothing arms: arm 2 reads 0 on every real run
      // today. The gate is now correctly CLOSED where it was falsely open. It is not
      // working, and `capabilityProven` still gates nothing (no workflow or script reads
      // it). Do not read a change here as progress toward a green campaign.
      let distributedTaskOutputs = 0;
      if (run.distributedJobId) {
        const outputRows = await db
          .select({ id: taskOutputs.id })
          .from(taskOutputs)
          .innerJoin(
            jobProjectionReceipts,
            eq(jobProjectionReceipts.targetAggregateId, taskOutputs.id),
          )
          .where(
            and(
              eq(jobProjectionReceipts.jobId, run.distributedJobId),
              eq(jobProjectionReceipts.projectionKind, "output_projection"),
              eq(jobProjectionReceipts.aggregateKind, "task_outputs"),
              eq(jobProjectionReceipts.status, "applied"),
              eq(jobProjectionReceipts.companyId, run.companyId),
              eq(taskOutputs.companyId, run.companyId),
            ),
          );
        distributedTaskOutputs = new Set(outputRows.map((r) => r.id)).size;
      }
      return { workspacePatchArtifacts, taskOutputs: distributedTaskOutputs };
    },
  };
}
