// server/src/services/job-accepted-output-projection.ts
//
// JOB-017 — the OUTPUT registration on the E3-D-ACC in-transaction accepted-event seam.
// Decision: `docs/replatform/epics/E3-job-control/decisions.md`, `E3-D-OUTPUT-MAP` (what an
// accepted output event projects to) under `E3-D-ACC` (the seam contract).
//
// `acceptEvent` runs this projector, inside its own SAVEPOINT, for each newly accepted
// `artifact_prepared` event while the fence is still live — so an output event and the terminal
// event in ONE batch project the output BEFORE the terminal closes the fence, and nothing throws
// `attempt_terminal`. It calls the transaction-taking `projectAcceptedOutputCore`
// (job-output-bridge.ts) and returns the `task_outputs` row id; the SEAM writes the
// `output_projection` receipt in the same savepoint.
//
// WHEN IT IS REGISTERED. Only a `task_run` job has a task to project onto; every other source
// (commander/crew/one-shot/browser/service) has none, and the JOB-014 contract is "no fabricated
// task IDs" — so for those sources the projector is simply not registered (the equivalent of the
// JOB-014 wrapper's `skipped`: nothing written, no receipt). The ingest decides this per batch
// from the job's SERVER-recorded `jobs.source_intent`, read under the fence the ingest already
// holds (`resolveAcceptedOutputProjector`).
//
// WHAT IT PROJECTS (E3-D-OUTPUT-MAP, deliberately minimal — `CLI-014` owns the rich mapping):
//   * provenance is FAIL-CLOSED: the event's `artifactId` must name a COMMITTED `job_artifacts`
//     row of THIS Organization, job and attempt (the control plane's own fenced-commit record).
//     A worker announcing an artifact it never committed projects nothing — the savepoint throws
//     and the seam records a surfaced `pending` receipt.
//   * ONE `task_outputs` row on the job's own task, `type: "artifact"`, in a provider namespace
//     ONLY this projector writes (`DISTRIBUTED_JOB_ARTIFACT_PROVIDER`) keyed by the committed
//     row's server-minted id — so a worker-chosen identifier can never upsert onto a platform or
//     legacy row. `isPrimary` is forced false by the core; `artifactId` stays null because
//     promoting a `job_artifacts` row into a product `artifacts` row is `CLI-014`'s.
//
// Multi-tenant (F10): `task_outputs` has no RLS (E2-D03). Company and Organization come from the
// FENCE; the core refuses a Company its Organization does not own, and `upsertTaskOutputForIssue`
// refuses an issue of any other Company.

import { and, eq } from "drizzle-orm";
import {
  jobArtifacts,
  jobs,
  type AcceptEventInput,
  type AcceptedEventProjector,
  type ActiveFenceRequest,
  type Db,
} from "@armyofagents/db";
import { submitJobSourceSchema } from "@armyofagents/shared";
import { artifactPreparedPayloadV1Schema } from "@armyofagents/worker-protocol";
import { outputSourceIdentity, projectAcceptedOutputCore } from "./job-output-bridge.js";

/** The `task_outputs.provider` namespace this projector — and nothing else — writes. */
export const DISTRIBUTED_JOB_ARTIFACT_PROVIDER = "aoa_distributed_job";

/** Why an accepted output event could not be projected. Surfaces as the `pending` receipt's reason. */
export class AcceptedOutputProjectionError extends Error {
  readonly code: string;
  constructor(code: "payload_unparseable" | "artifact_not_committed" | "source_unreadable") {
    super(`accepted output could not be projected: ${code}`);
    this.name = "AcceptedOutputProjectionError";
    this.code = `ACCEPTED_OUTPUT_${code.toUpperCase()}`;
  }
}

/** The task a `task_run` job projects onto, from the job's submit-time source. */
export interface OutputTarget {
  issueId: string;
  assigneeAgentId: string;
}

/** Everything the projection of ONE accepted `artifact_prepared` event needs. The seam fills it
 * from the live fence; the re-drive fills it from the locked receipt and the STORED event row. */
export interface AcceptedOutputContext {
  organizationId: string;
  companyId: string;
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  eventId: string;
  /** The whole stored/accepted wire event; its `payload` is the frozen artifact_prepared payload. */
  wireEvent: Record<string, unknown>;
}

/** Read the job's SERVER-recorded source: its task for a `task_run`, `null` for any other source.
 * Throws `source_unreadable` when the job is missing or its source does not parse. */
export async function loadAcceptedOutputTarget(
  db: Db,
  input: { organizationId: string; companyId: string; jobId: string },
): Promise<OutputTarget | null> {
  const [job] = await db
    .select({ sourceIntent: jobs.sourceIntent })
    .from(jobs)
    .where(and(
      eq(jobs.organizationId, input.organizationId),
      eq(jobs.companyId, input.companyId),
      eq(jobs.id, input.jobId),
    ))
    .limit(1);
  if (!job) throw new AcceptedOutputProjectionError("source_unreadable");
  const parsed = submitJobSourceSchema.safeParse(job.sourceIntent);
  if (!parsed.success) throw new AcceptedOutputProjectionError("source_unreadable");
  return parsed.data.kind === "task_run"
    ? { issueId: parsed.data.issueId, assigneeAgentId: parsed.data.assigneeAgentId }
    : null;
}

/**
 * THE one mapping from an accepted `artifact_prepared` event to its `task_outputs` row, shared by
 * the seam registration and the JOB-017 re-drive (`redrivePendingProjection`), so a re-driven
 * output is exactly the row the seam would have written. Fail-closed provenance: the artifact must
 * be a COMMITTED `job_artifacts` row of this Organization, job and attempt.
 */
export async function applyAcceptedOutputEvent(
  tx: Db,
  ctx: AcceptedOutputContext,
  target: OutputTarget,
): Promise<{ outputId: string }> {
  const parsed = artifactPreparedPayloadV1Schema.safeParse(ctx.wireEvent.payload);
  if (!parsed.success) throw new AcceptedOutputProjectionError("payload_unparseable");
  const [committed] = await tx
    .select({
      id: jobArtifacts.id,
      kind: jobArtifacts.kind,
      versionNumber: jobArtifacts.versionNumber,
    })
    .from(jobArtifacts)
    .where(and(
      eq(jobArtifacts.organizationId, ctx.organizationId),
      eq(jobArtifacts.jobId, ctx.jobId),
      eq(jobArtifacts.attempt, ctx.attemptNumber),
      eq(jobArtifacts.identifier, parsed.data.artifactId),
      eq(jobArtifacts.status, "committed"),
    ))
    .limit(1);
  if (!committed) throw new AcceptedOutputProjectionError("artifact_not_committed");
  const kind = committed.kind ?? parsed.data.kind;
  return projectAcceptedOutputCore({ tx }, {
    organizationId: ctx.organizationId,
    companyId: ctx.companyId,
    issueId: target.issueId,
    output: {
      type: "artifact",
      provider: DISTRIBUTED_JOB_ARTIFACT_PROVIDER,
      externalId: committed.id,
      title: `Distributed run artifact (${kind})`,
      status: "active",
      reviewState: "none",
      createdByAgentId: target.assigneeAgentId,
      metadata: {
        organizationId: ctx.organizationId,
        jobId: ctx.jobId,
        attemptId: ctx.attemptId,
        attemptNumber: ctx.attemptNumber,
        jobArtifactId: committed.id,
        artifactIdentifier: parsed.data.artifactId,
        artifactKind: kind,
        versionNumber: committed.versionNumber ?? null,
        eventId: ctx.eventId,
      },
    },
  });
}

function artifactOutputProjector(target: OutputTarget | Error): AcceptedEventProjector {
  return {
    projectionKind: "output_projection",
    aggregateKind: "task_outputs",
    sourceIdentity(event: AcceptEventInput, fence: ActiveFenceRequest) {
      return event.eventType === "artifact_prepared" ? outputSourceIdentity(fence.companyId, event.eventId) : null;
    },
    async apply({ tx, event, fence }) {
      // The job's source could not be read: every output event of this batch is OWED (a surfaced
      // pending receipt, which the re-drive retries), never silently dropped.
      if (target instanceof Error) throw target;
      const projected = await applyAcceptedOutputEvent(tx, {
        organizationId: fence.organizationId,
        companyId: fence.companyId,
        jobId: fence.jobId,
        attemptId: fence.attemptId,
        attemptNumber: fence.attemptNumber,
        eventId: event.eventId,
        wireEvent: event.payload,
      }, target);
      return { targetAggregateId: projected.outputId };
    },
  };
}

/**
 * Decide the output registration for ONE ingest batch. Returns `null` — register nothing — when
 * the batch carries no `artifact_prepared` event or the job is not a `task_run` (no task to
 * project onto). Called inside the ingest's tenant transaction, under the fence it holds; the read
 * runs in its own SAVEPOINT so a failure can never abort the transaction that holds the append —
 * a failed read registers a projector that records every output event of the batch as OWED.
 */
export async function resolveAcceptedOutputProjector(
  tx: Db,
  fence: { organizationId: string; companyId: string; jobId: string },
  events: readonly AcceptEventInput[],
): Promise<AcceptedEventProjector | null> {
  if (!events.some((event) => event.eventType === "artifact_prepared")) return null;
  let target: OutputTarget | null;
  try {
    target = await tx.transaction(async (sp) => loadAcceptedOutputTarget(sp as unknown as Db, fence));
  } catch (error) {
    return artifactOutputProjector(error instanceof Error ? error : new AcceptedOutputProjectionError("source_unreadable"));
  }
  return target ? artifactOutputProjector(target) : null;
}
