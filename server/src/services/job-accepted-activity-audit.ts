// server/src/services/job-accepted-activity-audit.ts
//
// JOB-017 — the ACTIVITY-AUDIT registration on the E3-D-ACC in-transaction accepted-event seam.
// Decision: `docs/replatform/epics/E3-job-control/decisions.md`, `E3-D-AUDIT-SET` (the named set
// of audited accepted mutations) under `E3-D-ACC` (the seam contract).
//
// `acceptEvent` runs this projector, inside its own SAVEPOINT, for each newly accepted event of
// the named set while the fence is still live (before that event's own attempt projection). It
// calls the transaction-taking `recordAcceptedActivityCore` (job-audit-bridge.ts) and returns the
// activity_log row id; the SEAM writes the `activity_audit` receipt in the same savepoint. It
// never opens a transaction, never re-guards the fence, never writes a receipt and never
// publishes: the prepared live event is handed to the ingest, which publishes it AFTER commit and
// only for an `applied` outcome.
//
// THE NAMED SET (E3-D-AUDIT-SET) — the accepted STATE mutations the ingest itself performs:
//   * `attempt_started` → the attempt leased→running and the job queued→running;
//   * `terminal`        → the attempt (and job) driven to its terminal status.
// Every other event type is an OBSERVATION (log, progress, network_denied, service_*, browser_*)
// or has its own durable record on this seam (`usage` → the `cost_events` row + its
// `authoritative_cost` receipt; `artifact_prepared` → the `task_outputs` row + its
// `output_projection` receipt), so it is NOT audited here. The set is closed: a new entry is a
// recorded decision, not an edit here.
//
// Multi-tenant (F10): `activity_log` has no RLS (E2-D03). The row's Company and Organization are
// the FENCE's — the lease the ingest guard locked — never the worker's, and the core refuses a
// Company its Organization does not own.

import type { AcceptEventInput, AcceptedEventProjector, ActiveFenceRequest } from "@armyofagents/db";
import type { PreparedActivityEvent } from "./activity-log.js";
import { activitySourceIdentity, recordAcceptedActivityCore } from "./job-audit-bridge.js";
import { JOB_AUDIT_ENTITY_TYPE } from "./job-control-audit.js";

/** E3-D-AUDIT-SET — accepted event type → the activity action its accepted mutation records. */
export const ACCEPTED_ACTIVITY_AUDIT_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  attempt_started: "job.attempt_started",
  terminal: "job.attempt_terminal",
});

/** The actor of an ingest-accepted mutation: the worker whose fenced event the server accepted.
 * A worker is not a user or an agent, so the actor type is `system` and the id names the worker. */
export function acceptedEventActorId(workerId: string): string {
  return `worker:${workerId}`;
}

function auditedAction(event: AcceptEventInput): string | null {
  return Object.prototype.hasOwnProperty.call(ACCEPTED_ACTIVITY_AUDIT_ACTIONS, event.eventType)
    ? ACCEPTED_ACTIVITY_AUDIT_ACTIONS[event.eventType]!
    : null;
}

/**
 * THE JOB-017 audit registration. Its receipt identity is JOB-013's, `activity:{company}:{eventId}`,
 * so the wrapper and the seam share one idempotency key and can never audit an event twice.
 */
export function createAcceptedActivityAuditProjector(options?: {
  /** Receives each audited event's prepared live event. The projector runs in a savepoint of an
   * uncommitted ingest, so it must NOT publish; the ingest publishes after commit, and only for
   * events whose seam outcome is `applied` (a rolled-back savepoint owes nothing). */
  onPreparedActivity?: (eventId: string, prepared: PreparedActivityEvent) => void;
}): AcceptedEventProjector {
  return {
    projectionKind: "activity_audit",
    aggregateKind: "activity_log",
    sourceIdentity(event: AcceptEventInput, fence: ActiveFenceRequest) {
      return auditedAction(event) === null ? null : activitySourceIdentity(fence.companyId, event.eventId);
    },
    async apply({ tx, event, fence }) {
      const action = auditedAction(event);
      if (action === null) throw new Error("accepted-activity audit applied to an unaudited event type");
      const recorded = await recordAcceptedActivityCore({ tx }, {
        organizationId: fence.organizationId,
        companyId: fence.companyId,
        acceptedEventId: event.eventId,
        activity: {
          companyId: fence.companyId,
          actorType: "system",
          actorId: acceptedEventActorId(fence.workerId),
          action,
          entityType: JOB_AUDIT_ENTITY_TYPE,
          entityId: fence.jobId,
          agentId: null,
          details: {
            organizationId: fence.organizationId,
            jobId: fence.jobId,
            attemptId: fence.attemptId,
            attemptNumber: fence.attemptNumber,
            leaseId: fence.leaseId,
            workerId: fence.workerId,
            eventId: event.eventId,
            sequence: event.sequence,
            // The SERVER-applied transition input (`toAcceptInputs` sets it for a terminal only).
            ...(event.terminalStatus ? { terminalStatus: event.terminalStatus } : {}),
          },
        },
      });
      options?.onPreparedActivity?.(event.eventId, recorded.prepared);
      return { targetAggregateId: recorded.activityId };
    },
  };
}
