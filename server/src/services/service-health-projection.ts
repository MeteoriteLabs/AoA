// server/src/services/service-health-projection.ts
//
// SVC-003 — WHAT A SERVICE OBSERVATION MEANS FOR THE INSTANCE ROW.
//
// This module is the whole semantic half of the service-health projection, and it is
// deliberately PURE: one frozen worker event in, one decided projection (or `null`) out, no
// database, no clock, no I/O. The transactional half — attribution, the generation fence, the
// legality predicate and the write — is `applyServiceProjectionForFence` in
// `packages/db/src/repositories/tenant/job-control.ts`.
//
// ── WHY THE DECISION IS MADE HERE AND NOT IN THE REPOSITORY ──────────────────────────────
//
// The authority for a legal service-instance status move is `SERVICE_INSTANCE_TRANSITIONS` in
// `packages/worker-protocol`, and `packages/db` deliberately does not depend on that package
// (the `services` / `service_instances` schema headers say so, and it is why the status CHECK
// and the partial-index predicate are hand-written copies reconciled by a server-side test).
// Re-deriving the table inside the repository would be a FIFTH copy of a frozen list. So the
// server — which owns the frozen helper — computes the predecessor set and hands it down, the
// same shape `commitArtifactVersion` uses for its pre-evaluated `prefixValid`/`tenantValid`.
//
// ★ THIS IS ALSO WHAT ARMS `canTransitionServiceInstanceStatus`. At the base commit that
// exported helper had ZERO production callers — its only references were its own definition,
// the package barrel, and its own unit test. A frozen lifecycle table that nothing consults is
// a clause that is vacuously true. `predecessorsOf` below is its first production consumer.
//
// ── THE MAPPING, WITH THE JUSTIFICATION FOR EVERY LINE ───────────────────────────────────
//
//   attempt_started            -> `leased`     the control plane's own fact. `guardActiveFence`
//                                              has just proven an ACTIVE lease for this
//                                              attempt, and nothing else in the tree writes
//                                              `leased`, so without this arm `pending` is a
//                                              dead end and `starting` is unreachable.
//                                              Carries NO claim (its payload is `{sandboxId}`);
//                                              see `ServiceInstanceProjectionInput.claim`.
//   service_instance_started   -> `starting`   SVC-008b emits it meaning exactly `starting` and
//                                              its docstring says it "asserts `starting` and
//                                              NOTHING about the process".
//   service_health healthy     -> `healthy`    the provider's verdict about the supervised
//   service_health unhealthy   -> `unhealthy`  process, verbatim, from a `processStatus` read.
//   service_instance_stopped   -> `stopped`    the process was OBSERVED gone.
//   service_instance_lost      -> `lost`       the instance can no longer be accounted for.
//
// ── AND THE SIX THAT DELIBERATELY PROJECT NOTHING ────────────────────────────────────────
//
//   service_graceful_stop_observed  A stop REQUEST is not an observation of the process.
//                                   Its frozen payload is `{ref, deadline}` and SVC-008b's own
//                                   emitter docstring says it "claims nothing about the
//                                   process". Moving the row to `stopping` here would assert
//                                   from a request exactly the way E7-F034's
//                                   `ProcessSignalResult.accepted` did — the fail-open
//                                   SVC-008a exists to refuse. SVC-005 owns the request side.
//   service_checkpoint_prepared     Checkpoint policy is SVC-004's, and neither event says
//   service_checkpoint_restored     anything about whether the process is up.
//   service_provider_interrupted    No emitter exists for either (SVC-008b §6.3: `SandboxState`
//   service_provider_resumed        has no suspended inhabitant), so a projection for them
//                                   would be a consumer of something nothing can produce —
//                                   vacuously true, and untestable end to end.
//   terminal / log / usage / …      Attempt-scoped, not instance-scoped.
//
// A worker that wants an instance status it cannot witness therefore has no event that
// produces one. That is the property, not an accident of coverage.

import {
  SERVICE_INSTANCE_STATUSES,
  canTransitionServiceInstanceStatus,
  type ServiceInstanceStatus,
  type WorkerEventV1,
} from "@armyofagents/worker-protocol";
import type { ServiceInstanceProjectionInput } from "@armyofagents/db";

/**
 * Every status from which `to` is a LEGAL move, read off the frozen transition table.
 *
 * ★ The three terminal statuses (`stopped` / `failed` / `lost`) have no outgoing edges, so
 * they are in NO predecessor set and every move out of one is refused downstream. That is the
 * split-brain refusal: an instance that reached `lost` has left
 * `service_instances_live_service_uq` and SVC-002's reconciler has already replaced it, so a
 * late event resurrecting it would put two live rows under one partial-unique key.
 */
export function predecessorsOf(to: ServiceInstanceStatus): readonly ServiceInstanceStatus[] {
  return SERVICE_INSTANCE_STATUSES.filter((from) => canTransitionServiceInstanceStatus(from, to));
}

/** The service-instance ref every service event payload carries (`serviceInstanceRefShape`). */
interface ServiceRefPayload {
  serviceId: string;
  serviceInstanceId: string;
  generation: number;
}

function claimOf(payload: unknown): ServiceRefPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<ServiceRefPayload>;
  if (typeof p.serviceId !== "string" || typeof p.serviceInstanceId !== "string") return null;
  if (typeof p.generation !== "number" || !Number.isInteger(p.generation)) return null;
  return { serviceId: p.serviceId, serviceInstanceId: p.serviceInstanceId, generation: p.generation };
}

/**
 * Decide the service-instance projection ONE accepted worker event drives, or `null` for the
 * events that drive none.
 *
 * ★ A SERVICE EVENT WHOSE REF CANNOT BE READ RETURNS `null`, WHICH IS A STALL, NOT A DEFAULT.
 * The event is still appended durably and still acknowledged; it simply projects nothing, and
 * the instance keeps whatever status it had. The alternative — projecting with a synthesized
 * ref, or projecting onto the attributed row while ignoring an unreadable claim — would be a
 * definite answer derived from an unreadable observation, which is the fail-open SVC-008b's
 * stop-verdict work exists to refuse. (In practice `workerEventV1Schema` is `.strict()` and
 * has already validated the ref, so this arm is defence in depth rather than a live path.)
 */
export function decideServiceProjection(event: {
  eventType: string;
  payload: unknown;
}): ServiceInstanceProjectionInput | null {
  const project = (
    toStatus: ServiceInstanceStatus,
    claim: ServiceRefPayload | null,
  ): ServiceInstanceProjectionInput => ({
    claim: claim
      ? {
          serviceInstanceId: claim.serviceInstanceId,
          serviceId: claim.serviceId,
          generation: claim.generation,
        }
      : null,
    toStatus: toStatus as ServiceInstanceProjectionInput["toStatus"],
    allowedFromStatuses: predecessorsOf(toStatus),
  });

  // The one arm with no claim to read — see the module header and `claim`'s docstring.
  if (event.eventType === "attempt_started") return project("leased", null);

  const claim = claimOf(event.payload);
  if (!claim) return null;

  switch (event.eventType) {
    case "service_instance_started":
      return project("starting", claim);
    case "service_health": {
      const status = (event.payload as { status?: unknown }).status;
      // The frozen `SERVICE_HEALTH_STATUSES` are exactly these two. An unreadable verdict is
      // not projected — same reasoning as an unreadable ref.
      if (status === "healthy") return project("healthy", claim);
      if (status === "unhealthy") return project("unhealthy", claim);
      return null;
    }
    case "service_instance_stopped":
      return project("stopped", claim);
    case "service_instance_lost":
      return project("lost", claim);
    default:
      return null;
  }
}

/** Narrow overload for a fully typed frozen event, so callers keep their discrimination. */
export function decideServiceProjectionForEvent(
  event: WorkerEventV1,
): ServiceInstanceProjectionInput | null {
  return decideServiceProjection({ eventType: event.eventType, payload: event.payload });
}
