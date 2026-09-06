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

      // (2) task_outputs authored by this run (createdByRunId — clean run linkage).
      const outputs = await db
        .select({ id: taskOutputs.id, summary: taskOutputs.summary, metadata: taskOutputs.metadata })
        .from(taskOutputs)
        .where(eq(taskOutputs.createdByRunId, run.id));
      for (const o of outputs) {
        const text = `${textOf(o.summary)} ${textOf(o.metadata)}`.trim();
        if (text) surfaces.push({ surface: "task_outputs", fieldOrEventId: o.id, text });
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
      const outputRows = await db
        .select({ id: taskOutputs.id })
        .from(taskOutputs)
        .where(eq(taskOutputs.createdByRunId, run.id));
      return { workspacePatchArtifacts, taskOutputs: outputRows.length };
    },
  };
}
