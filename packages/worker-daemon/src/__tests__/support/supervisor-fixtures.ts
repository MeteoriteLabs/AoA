/**
 * Shared builders for the WRK-004 sandbox-supervisor tests. Boundary-clean (Node
 * builtins + frozen worker-protocol + the worker's own relative modules).
 *
 * Two flavours:
 *  - `sampleLabels` / `makeCtx` for the provider + authority UNIT tests (labels are
 *    opaque strings the fake/authorities treat structurally).
 *  - `makeHandoff` / `SUPERVISOR_IDENTITY` for the supervisor COMPONENT tests,
 *    which emit real `workerEventV1` records and so need schema-valid delivery
 *    identity (the parsed `compatibleOffer` supplies uuids + a valid fence).
 */

import {
  leaseOfferV1Schema,
  type LeaseOfferV1,
  type WorkerEventV1,
} from "@armyofagents/worker-protocol";

import type { LeaseHandoff } from "../../poll/poll-loop.js";
import type { WorkerEventSink } from "../../supervisor/events.js";
import type { ProviderOpContext, ResourceLabels } from "../../supervisor/provider.js";
import type { WorkerSupervisionIdentity } from "../../supervisor/supervisor.js";
import { compatibleOffer, POLL_FIXTURE_IDS } from "./poll-fixtures.js";

let ctxCounter = 0;

/** A fresh op context with a unique idempotency key (stable when `key` given). */
export function makeCtx(key?: string, deadlineMs = 60_000): ProviderOpContext {
  return { deadlineMs, idempotencyKey: key ?? `idem-${++ctxCounter}` };
}

/** Opaque-string labels for provider/authority unit tests. */
export function sampleLabels(overrides: Partial<ResourceLabels> = {}): ResourceLabels {
  return {
    organizationId: "org-1",
    targetId: "target-1",
    workerId: "worker-1",
    jobId: "job-1",
    attempt: 1,
    leaseId: "lease-1",
    deviceGeneration: 1,
    ...overrides,
  };
}

export const SUPERVISOR_IDENTITY: WorkerSupervisionIdentity = {
  targetId: POLL_FIXTURE_IDS.target,
  deviceGeneration: 1,
};

/** Parse the shared compatible offer and wrap it as a `LeaseHandoff`. */
export function makeHandoff(overrides: Record<string, unknown> = {}): LeaseHandoff {
  const offer: LeaseOfferV1 = leaseOfferV1Schema.parse(compatibleOffer(overrides));
  return {
    offer,
    leaseId: String(offer.leaseId),
    fenceToken: String(offer.fenceToken),
    workloadClass: "batch",
  };
}

/** The exact `ResourceLabels` the supervisor derives from `makeHandoff()` — for
 * building a CleanupAuthority / create spec bound to the same resource. */
export function handoffLabels(): ResourceLabels {
  return {
    organizationId: POLL_FIXTURE_IDS.org,
    targetId: SUPERVISOR_IDENTITY.targetId,
    workerId: POLL_FIXTURE_IDS.worker,
    jobId: POLL_FIXTURE_IDS.job,
    attempt: 1,
    leaseId: POLL_FIXTURE_IDS.lease,
    deviceGeneration: SUPERVISOR_IDENTITY.deviceGeneration,
  };
}

export interface CollectingSink extends WorkerEventSink {
  readonly events: WorkerEventV1[];
}

/** An in-memory event sink (durable upload is WRK-006). */
export function collectingSink(): CollectingSink {
  const events: WorkerEventV1[] = [];
  return {
    events,
    emit(event: WorkerEventV1): void {
      events.push(event);
    },
  };
}

/** A resolvable barrier for holding a run in-flight at `execute`. */
export function makeGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

/** Poll `cond` until true or `timeoutMs` elapses. */
export async function waitFor(cond: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition not met in time");
    await new Promise((r) => setTimeout(r, 2));
  }
}
