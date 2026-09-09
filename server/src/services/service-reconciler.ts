// server/src/services/service-reconciler.ts
//
// SVC-002 — the service reconciler.
//
// ONE SERVICE, ONE RUNNING INSTANCE, CONVERGED FROM DESIRED STATE, WITHOUT DUPLICATE
// PLACEMENT. That is the whole ticket, and the four words that bound it are in §2 of
// docs/replatform/epics/E9-service-agents/tickets/SVC-002-design.md.
//
// ── WHICH SOURCE IS OBSERVED AND WHICH IS INTENDED ───────────────────────────────────────
//
//   INTENDED  `services.desired_state` + `services.generation` (pinned under a row lock),
//             and the immutable `service_generations.definition` for that generation.
//   OBSERVED  the count of `service_instances` rows for the service that are NOT in one of
//             the three frozen terminal states.
//
// The reconciler creates an instance only when the intent is `running`, the intent is fully
// READABLE, and the observation is zero. Every other combination returns `{action:"none"}`
// with a reason naming which side stopped it.
//
// ★ WHAT HAPPENS WHEN THE INTENT IS UNKNOWN RATHER THAN ABSENT. `service_generations` has
// zero writers in the tree and SVC-002 adds none (SVC-007 owns the create/update controls),
// so `findServiceGenerationDefinition` answers `null` for every service on a real deployment
// today. That `null` is treated as "cannot decide" — `{action:"none", reason:"no_generation"}`
// — and NOT as "start it with a default command". A default branch that returns a definite
// answer for an unreadable intent is the fail-open SVC-008b's stop-verdict work exists to
// refuse; an honest stall is better than a confident wrong verdict that acts.
//
// ── WHAT THIS DOES NOT DO, so a green suite is not over-read ─────────────────────────────
//
//   * It converges ZERO instances → ONE instance and then goes quiescent. It has no way to
//     observe that an instance has STOPPED being one: `recordServiceHealth` is the only
//     writer of `service_instances.status` and it has no consumer. Nothing here drives an
//     instance to a terminal status. That seam is SVC-003's.
//   * It refuses a DRAINING target only in the sense that placement will not select one for
//     a NEW instance. It does not move, stop or replace an instance already running on a
//     target that has begun draining — that needs a fence and a stop channel over a live
//     lease (SVC-003/SVC-005).
//   * It adds NO routes. There is still no way for a human to create a service, so on a real
//     deployment `listReconcilableServices` returns an empty page and this loop is a no-op.
//     Said plainly because "the first ticket in E9 with a producer" is easy to over-read.
//   * A service job it submits is placed `queued` / `no_eligible_target` unless a daemon in
//     the fleet advertises `workload.service` with a free service slot. SVC-008b widened the
//     daemon constant so that is now possible rather than structurally impossible, but
//     E9-F002 stays open on its other conjunct and a supervised service is bounded at 240 s.

import { createHash, randomUUID } from "node:crypto";
import type { Db, TenantRepositories } from "@armyofagents/db";
import { HttpError } from "../errors.js";
import { runInTenant } from "../db/tenant-context.js";
import { assertAdmissibleOrganization } from "./tenant-admission.js";
import { submitJobWithinTenant } from "./job-submission.js";

/**
 * Fixed, never-rotate namespace UUID for deriving a service reconciliation's identity
 * (RFC 4122 v5). Generated once as a random UUID and hardcoded as a protocol constant.
 *
 * ★ DO NOT CHANGE IT. `reconciliationId` is one of the seven columns of
 * `jobs_submission_idempotency_uq`, so rotating this namespace would make every already
 * submitted service job un-replayable: a resubmission for the same instance would mint a
 * different identity, miss the composite, and insert a SECOND job.
 *
 * Self-contained rather than a dependency for the same reason
 * `derivePlatformDefaultEnvironmentId` is: no `uuid` package is a resolvable direct
 * dependency of `server/`.
 */
const SERVICE_RECONCILE_NAMESPACE = "6b1f0c74-0f2a-4d51-9a3c-7c5f2e18b4d0";

function uuidV5(name: string, namespaceUuid: string): string {
  const namespaceBytes = Buffer.from(namespaceUuid.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * ★★★ THE TRAP THIS EXISTS FOR, and it is the single most important fact in this file.
 *
 * `jobs_submission_idempotency_uq` is a SEVEN-column composite that includes
 * `authenticated_source_identity` — and for a `service_reconcile` source that field IS
 * `source.reconciliationId` (packages/shared/src/job-control-source.ts). So pinning
 * `idempotencyKey` while leaving `reconciliationId` a fresh `randomUUID()` pins six of seven
 * columns and ADMITS A DUPLICATE: an identical resubmission does not collide and a second
 * job is created. A green idempotency test over a pinned key would not see it.
 *
 * Both halves are therefore derived from the one id the partial unique index
 * `service_instances_live_service_uq` already guarantees is unique. Every remaining column of
 * the composite is also a function of the instance (org and company from its own row,
 * principal kind/id and source kind constant), so the whole seven-column key reduces to
 * `serviceInstanceId`, which is a primary key.
 *
 * ★ REACHABILITY, STATED HONESTLY. No path in SVC-002 submits twice for one instance id —
 * the loser of the index race returns before the submission, and the observed-state check
 * short-circuits before a later tick can. So this property is UNREACHABLE from the
 * reconciler, and a test that drives the reconciler cannot kill a "revert to randomUUID()"
 * mutant. It is pinned by a test that performs the second submission ITSELF (T1c in
 * service-reconciler.integration.test.ts); SVC-004's replacement path is its first real
 * consumer.
 */
export function deriveReconciliationId(serviceInstanceId: string): string {
  return uuidV5(`service-reconcile:${serviceInstanceId}`, SERVICE_RECONCILE_NAMESPACE);
}

/** The submission idempotency key for one service instance. See {@link deriveReconciliationId}. */
export function deriveServiceIdempotencyKey(serviceInstanceId: string): string {
  return `svc-instance:${serviceInstanceId}`;
}

export type ServiceReconcileNoneReason =
  /** The service row is not visible in this tenant (deleted, or a stale sweep window). */
  | "service_absent"
  /** INTENDED state is not `running`. Covers `paused`, `stopped` and `deleted` alike. */
  | "desired_state_not_running"
  /** INTENDED state is unreadable: no `service_generations` row for this generation. */
  | "no_generation"
  /** The frozen service workload cannot be built from the stored definition. */
  | "invalid_definition"
  /** OBSERVED state already has a non-terminal instance — the sequential and the raced path
   *  return this SAME value, which is what "idempotent" means here. */
  | "instance_present"
  /** Organization budget hard-stop or concurrency cap; the transaction rolled back whole. */
  | "quota_denied";

export type ServiceReconcileOutcome =
  | {
      action: "created";
      serviceInstanceId: string;
      jobId: string;
      attemptId: string;
      replayed: boolean;
    }
  | { action: "none"; reason: ServiceReconcileNoneReason };

export interface ReconcileServiceInput {
  organizationId: string;
  companyId: string;
  serviceId: string;
}

/**
 * The service workload's non-identity half, as frozen `serviceWorkloadV1Schema` names it.
 * Read out of the immutable `service_generations.definition` rather than invented here.
 */
function readDefinition(definition: Record<string, unknown>): {
  command: unknown;
  args: unknown;
  gracefulStopSeconds: unknown;
} {
  return {
    command: definition.command,
    args: definition.args,
    gracefulStopSeconds: definition.gracefulStopSeconds,
  };
}

/**
 * ONE reconcile pass for one `(organization, service)`, entirely inside ONE already-open
 * tenant transaction.
 *
 * ★ THE SINGLE TRANSACTION IS LOAD-BEARING, NOT TIDINESS. `submitJobWithinTenant` composes
 * `admitAttemptCapacity`, which raises a 429 on a budget hard-stop or a full concurrency cap.
 * Because the instance insert shares this transaction, that 429 unwinds the instance row too:
 * quota exhaustion creates NO instance and NO job. Written in a separate transaction, quota
 * exhaustion would leave an orphan `pending` instance that the observed-state check then
 * reads as "instance present" — and the service would never start again. A silent permanent
 * wedge.
 *
 * Errors are NOT caught here, deliberately: a caught 429 that returned normally would COMMIT
 * the orphan this composition exists to prevent. The mapping to `quota_denied` happens in
 * {@link reconcileService}, strictly outside the transaction, after the rollback.
 */
export async function reconcileServiceWithinTenant(
  repos: TenantRepositories,
  tx: Db,
  input: ReconcileServiceInput,
): Promise<ServiceReconcileOutcome> {
  // 1 + 2: serialize concurrent passes into a wait, then PIN desired_state AND generation
  // for the whole transaction so a concurrent SVC-005 generation bump cannot land between
  // this read and the insert.
  const service = await repos.jobControl.lockServiceForReconcile({
    organizationId: input.organizationId,
    companyId: input.companyId,
    serviceId: input.serviceId,
  });
  if (!service) return { action: "none", reason: "service_absent" };

  // 3: INTENDED state. An allow-list, matching the predicate now carried by
  // `serviceSourceIsAdmitted` — the authority every submission passes through.
  if (service.desiredState !== "running") {
    return { action: "none", reason: "desired_state_not_running" };
  }

  // 3b: the rest of the INTENDED state. `null` is "the read answered and there is no
  // definition", which is a stall, never a default.
  const generation = await repos.jobControl.findServiceGenerationDefinition({
    organizationId: input.organizationId,
    companyId: input.companyId,
    serviceId: input.serviceId,
    generation: service.generation,
  });
  if (!generation) return { action: "none", reason: "no_generation" };

  // 4: OBSERVED state. NON-TERMINAL, not `healthy` — see the repository docstring.
  const live = await repos.jobControl.countNonTerminalInstances({
    organizationId: input.organizationId,
    serviceId: input.serviceId,
  });
  if (live >= 1) return { action: "none", reason: "instance_present" };

  // 5: mint the instance FIRST, because the frozen workload carries `serviceInstanceId` and
  // the derived idempotency identity is a function of it. RANDOM, not derived: a
  // deterministic id keyed on (service, generation) would make SVC-004's replacement
  // impossible, because a second instance for the same service and generation would collide
  // with the corpse of the first.
  const serviceInstanceId = randomUUID();
  const inserted = await repos.jobControl.insertServiceInstance({
    id: serviceInstanceId,
    organizationId: input.organizationId,
    companyId: input.companyId,
    serviceId: input.serviceId,
    generation: service.generation,
    status: "pending",
  });
  // ★ The loser of a race against the partial unique index returns the SAME value the
  // sequential path returns at step 4, with no error raised and no extra field. The two
  // outcomes are indistinguishable to the caller, which is what "idempotent" means. The
  // submission is not run by the loser at all.
  if (inserted.outcome === "conflict") return { action: "none", reason: "instance_present" };

  const { command, args, gracefulStopSeconds } = readDefinition(generation.definition);

  // 6: the submission, on the SAME repos and the SAME tx.
  const submitted = await submitJobWithinTenant(
    repos,
    {
      organizationId: input.organizationId,
      companyId: input.companyId,
      // The FIRST real `system`-principal submitter this repository has ever had:
      // SOURCE_REQUESTER_KINDS.service_reconcile is `["system"]` and the only prior
      // `{kind:"system"}` producer feeds the read-only shadow recorder, not a submission.
      principal: { kind: "system", id: input.companyId },
      command: {
        idempotencyKey: deriveServiceIdempotencyKey(serviceInstanceId),
        source: {
          kind: "service_reconcile",
          serviceId: input.serviceId,
          generation: service.generation,
          reconciliationId: deriveReconciliationId(serviceInstanceId),
        },
        input: {
          // `serviceId` and `generation` are re-stamped from the AUTHORIZED source by
          // `stampServiceIdentity`, so these two are tautologically consistent for this
          // caller. `serviceInstanceId` is NOT stamped: SVC-002 closes it BY CONSTRUCTION
          // (it is the primary key of a row inserted in this same transaction), which is
          // airtight for this caller and proves nothing about the submission path. Adding
          // the field to the frozen source schema is a Protocol Custodian STOP and is still
          // open (SVC-002-design.md §10.2).
          serviceId: input.serviceId,
          serviceInstanceId,
          generation: service.generation,
          command,
          args,
          checkpointArtifactId: generation.checkpointArtifactId,
          gracefulStopSeconds,
        },
      },
    },
    tx,
  );

  // 6b: attribute the instance to the job serving it, still inside this transaction. Without
  // this the instance row is unattributable and SVC-003 has nothing to fence against.
  await repos.jobControl.attributeServiceInstance({
    organizationId: input.organizationId,
    serviceInstanceId,
    jobId: submitted.jobId,
    attemptId: submitted.attemptId,
  });

  return {
    action: "created",
    serviceInstanceId,
    jobId: submitted.jobId,
    attemptId: submitted.attemptId,
    replayed: submitted.replayed,
  };
}

/**
 * A 429 from the composed org-capacity admission, unwrapped through the cause chain.
 *
 * Narrow on purpose: only budget/capacity denial becomes a `none` outcome. Any other failure
 * propagates and the sweeper counts a failed pass, because a reconciler that swallowed
 * everything would report "nothing to do" for a tenant whose database is unreachable.
 */
function quotaDenied(error: unknown): boolean {
  return error instanceof HttpError && error.status === 429;
}

/** A 400 from the frozen service-workload validator: the stored definition is unusable. */
function invalidDefinition(error: unknown): boolean {
  return error instanceof HttpError && error.status === 400;
}

/**
 * One reconcile pass, opening (and on failure ROLLING BACK) its own tenant transaction.
 *
 * The catches live HERE rather than inside the transaction for the reason
 * {@link reconcileServiceWithinTenant} states: catching a 429 inside would commit the orphan
 * instance the single-transaction composition exists to prevent.
 */
export async function reconcileService(
  appDb: Db,
  input: ReconcileServiceInput,
): Promise<ServiceReconcileOutcome> {
  // Parity with `jobSubmissionService.submit`, which asserts this before opening its own
  // transaction. `listAdmittedOrganizationIds` already excludes the sentinel org, but this
  // function is exported and a future caller need not come through the sweeper — and a
  // forbidden sentinel must never reach the distributed path by an unguarded route (FND-007,
  // Decision #121). It THROWS rather than returning a `none` reason: a sentinel org is a
  // programming error, not a state the reconciler converges.
  assertAdmissibleOrganization(input.organizationId);
  try {
    return await runInTenant(appDb, input.organizationId, (repos, tx) =>
      reconcileServiceWithinTenant(repos, tx, input));
  } catch (error) {
    if (quotaDenied(error)) return { action: "none", reason: "quota_denied" };
    if (invalidDefinition(error)) return { action: "none", reason: "invalid_definition" };
    throw error;
  }
}

export interface ServiceReconcilerTickResult {
  organizations: number;
  services: number;
  created: number;
  unchanged: number;
  failed: number;
}

const ZERO_TICK: ServiceReconcilerTickResult = {
  organizations: 0, services: 0, created: 0, unchanged: 0, failed: 0,
};

export interface ServiceReconciler {
  tick(): Promise<ServiceReconcilerTickResult>;
  nextDelayMs(result: ServiceReconcilerTickResult): number;
}

/**
 * The polling sweeper that drives {@link reconcileService}.
 *
 * Shape copied from MIG-002's convergence sweeper deliberately: one in-flight tick, bounded
 * batches, a fair rotating org cursor, a wall-clock tick budget, and a `nextDelayMs` backoff
 * the composition root must actually USE (half the MIG-002 sweeper's interface sat
 * unexercised until someone did, and using it is what made its backoff real).
 *
 * POLLING, not events, and that is honest rather than lazy: there is no event source for a
 * desired-state change, because the routes that would change it are SVC-007's and do not
 * exist. The convergence latency is therefore bounded by the tick interval, stated as a
 * bound rather than as "promptly".
 */
export function createServiceReconciler(input: {
  appDb: Db;
  listAdmittedOrganizationIds: (page: {
    afterOrganizationId: string | null;
    limit: number;
  }) => Promise<string[]>;
  enabled?: boolean;
  maxOrganizationShards?: number;
  serviceBatchLimit?: number;
  tickBudgetMs?: number;
  idleDelayMs?: number;
  activeDelayMs?: number;
  monotonicNow?: () => number;
  onPassFailure?: (error: unknown, context: { organizationId: string; serviceId: string }) => void;
}): ServiceReconciler {
  const enabled = input.enabled ?? true;
  const maxOrganizations = Math.max(1, Math.min(64, Math.floor(input.maxOrganizationShards ?? 32)));
  const serviceBatchLimit = Math.max(1, Math.min(256, Math.floor(input.serviceBatchLimit ?? 32)));
  const tickBudgetMs = Math.max(1, Math.min(5_000, Math.floor(input.tickBudgetMs ?? 1_000)));
  const idleDelayMs = Math.max(1, Math.floor(input.idleDelayMs ?? 30_000));
  const activeDelayMs = Math.max(1, Math.floor(input.activeDelayMs ?? 2_000));
  const monotonicNow = input.monotonicNow ?? (() => performance.now());

  let cursor: string | null = null;
  /**
   * ★ PER-ORGANIZATION SERVICE CURSOR — the fix for a starvation bug this reconciler had.
   *
   * The first version always asked for the FIRST page (`afterServiceId: null`). A converged
   * service stays `desired_state = 'running'` forever, so for a tenant with more than
   * `serviceBatchLimit` running services the same lowest-id rows filled every page on every
   * tick and every later service was NEVER reconciled. Caught in review on PR #406.
   *
   * The sweep now pages from a per-organization cursor and carries it across ticks, so a
   * tenant whose sweep is cut short by the tick budget resumes where it stopped instead of
   * restarting at the head. A short page means the end of the tenant's services was reached,
   * and the cursor resets to `null` so the next tick starts over — the same
   * rotate-then-wrap discipline the organization cursor above uses.
   *
   * Bounded: entries are only ever added for organizations the admitted-org enumerator
   * returned, and an organization that stops being admitted simply stops being visited (the
   * map is process-local and dies with the process, like the org cursor).
   */
  const serviceCursors = new Map<string, string | null>();
  let inFlight: Promise<ServiceReconcilerTickResult> | null = null;

  function remaining(deadline: number): number {
    return Math.max(0, Math.floor(deadline - monotonicNow()));
  }

  async function admittedWindow(): Promise<string[]> {
    // Rotate from the cursor; wrap once from the head to fill the window fairly.
    const tail = [...new Set(await input.listAdmittedOrganizationIds({
      afterOrganizationId: cursor,
      limit: maxOrganizations,
    }))].sort().filter((id) => cursor === null || id > cursor).slice(0, maxOrganizations);
    if (cursor === null || tail.length >= maxOrganizations) return tail;
    const head = [...new Set(await input.listAdmittedOrganizationIds({
      afterOrganizationId: null,
      limit: maxOrganizations - tail.length,
    }))].sort();
    const seen = new Set(tail);
    return [...tail, ...head.filter((id) => !seen.has(id))].slice(0, maxOrganizations);
  }

  async function runTick(): Promise<ServiceReconcilerTickResult> {
    if (!enabled) return { ...ZERO_TICK };
    const deadline = monotonicNow() + tickBudgetMs;
    const organizationIds = await admittedWindow();
    const result: ServiceReconcilerTickResult = { ...ZERO_TICK };
    for (const organizationId of organizationIds) {
      if (remaining(deadline) < 1) break;
      // Advance on admission, not completion, so a slow tenant cannot pin the rotation.
      cursor = organizationId;
      result.organizations += 1;
      // Page through this tenant's running services from its own cursor until the budget is
      // out or the tenant is exhausted. Each window is read in its own short tenant
      // transaction; each PASS then opens its own, so one service's failure cannot roll back
      // another's convergence.
      let serviceCursor = serviceCursors.get(organizationId) ?? null;
      while (remaining(deadline) >= 1) {
        const after: string | null = serviceCursor;
        const window = await runInTenant(input.appDb, organizationId, (repos) =>
          repos.jobControl.listReconcilableServices({
            afterServiceId: after,
            limit: serviceBatchLimit,
          }));
        if (window.length === 0) {
          // End of this tenant's services. Wrap so the next tick starts at the head.
          serviceCursor = null;
          break;
        }
        for (const row of window) {
          if (remaining(deadline) < 1) break;
          // Advance on admission, not on completion, so one wedged service cannot pin the
          // rotation and starve the rest of the tenant on every subsequent tick.
          serviceCursor = row.serviceId;
          result.services += 1;
          try {
            const outcome = await reconcileService(input.appDb, {
              organizationId,
              companyId: row.companyId,
              serviceId: row.serviceId,
            });
            if (outcome.action === "created") result.created += 1;
            else result.unchanged += 1;
          } catch (error) {
            // Per-service and best-effort: one tenant's broken service must not cost the rest
            // of the sweep, and must never fail the tick.
            result.failed += 1;
            input.onPassFailure?.(error, { organizationId, serviceId: row.serviceId });
          }
        }
        // A short page is the end of the tenant; wrap rather than re-request it next tick.
        if (window.length < serviceBatchLimit) {
          serviceCursor = null;
          break;
        }
      }
      serviceCursors.set(organizationId, serviceCursor);
    }
    return result;
  }

  return {
    tick() {
      if (inFlight) return inFlight;
      const current = runTick();
      inFlight = current;
      current.finally(() => {
        if (inFlight === current) inFlight = null;
      }).catch(() => {
        // The caller observes the original rejection; this only handles the promise the
        // `finally` returns so it cannot become an unhandled branch.
      });
      return current;
    },
    nextDelayMs(result) {
      return result.created > 0 ? activeDelayMs : idleDelayMs;
    },
  };
}
