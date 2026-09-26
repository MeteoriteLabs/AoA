/**
 * Startup restart-recovery + orphan reconciliation (WRK-007).
 *
 * A ONE-SHOT boot pass that reconciles locally-known sandboxes + outbox streams
 * against control-plane lease authority and drives the correct cleanup:
 *   - authority is INFERRED per-lease via `lease_renew` (GAP-1: the frozen protocol
 *     exposes NO lease-state query op), reusing WRK-005's `renewLeaseOnce`;
 *   - stale sandboxes are torn down through the distinct monotonic
 *     {@link CleanupAuthority} (escalation survives lease loss), NEVER re-attached
 *     (D2 conservative default: never resume in-flight execution);
 *   - dead-lease outbox streams are ABANDONED via `stopStream` (D7), owned streams
 *     resume-drain; a poison row never blocks the sandbox pass (D8);
 *   - staged output artifacts under dead fences are QUARANTINED via WRK-005's
 *     device-session `runOrphanQuarantine` (survives lease loss; non-promotable).
 *
 * It is best-effort + convergent (re-run without double-kill), observable, and
 * worker-daemon-only. The server `reapExpiredLeases` reaper is the authoritative
 * orphan-safety net (JOB-006) — this is the fast-path cleanliness pass. Nothing here
 * starts a loop. WRK-013 composes it at boot (`composeDispatchRuntime`'s `start()`),
 * BEFORE the poll loop, over the durable lease-candidate store.
 *
 * ★ WRK-013 / founder ruling F5 — a lease the probe finds LIVE is FENCED. The frozen
 * protocol has no lease-state query, so the probe IS one `lease_renew`; that renewal is
 * the LAST this daemon ever issues for the lease. Nothing here re-registers it with a
 * renewal loop and nothing re-attaches its sandbox (D2): the control plane's reaper ends
 * the attempt and JOB-006 mints a fresh one. The result names the fenced leases.
 *
 * ★ WRK-013 / founder ruling F4 — the sandbox pass is CONDITIONAL. It needs a
 * process-level provider and an Organization-scoped ownership selector. The container
 * path has neither (its provider is built per run from a capability that has lapsed by
 * restart) and a platform-scoped target has no Organization to select by; there the pass
 * is SKIPPED BY NAME and orphan reclamation rests on the adapter-manager reaper — a named
 * narrowing of journey item 8's cleanup/recovery clause, owned by WRK-013.
 *
 * Runtime imports: relative modules + the frozen protocol (`LeaseOfferV1` type) +
 * `node:crypto` — the E4-D01 boundary.
 */

import { randomUUID } from "node:crypto";

import type { LeaseOfferV1 } from "@armyofagents/worker-protocol";

import type { DeviceKey } from "../identity/device-key.js";
import type { Logger } from "../logging/logger.js";
import {
  CLEANUP_ESCALATION_METRIC,
  CLEANUP_OUTCOME_METRIC,
  RECONCILE_ORPHANS_METRIC,
  type Metrics,
} from "../metrics/metrics.js";
import type { OperationRandomness, SessionProvider } from "../poll/poll-loop.js";
import { SessionTerminalError } from "../poll/poll-loop.js";
import type { ControlPlaneClient } from "../transport/client.js";
import { renewLeaseOnce, type RenewAttempt, type RenewalIdentity } from "../lease/lease-renewal.js";
import {
  classifyOrphanOutput,
  runOrphanQuarantine,
  type QuarantineArtifact,
  type QuarantineIdentity,
  type QuarantineOutcome,
} from "../lease/quarantine.js";
import type { DurableEventStore } from "../events/event-outbox-store.js";
import type { EventOutboxDrain } from "../events/event-outbox-drain.js";
import { CleanupAuthority, ResourceNotAvailableError, type CleanupStage } from "./cleanup-authority.js";
import type { EffectFence } from "./effect-authority.js";
import {
  hashResourceLabels,
  type CleanupStatus,
  type OwnershipSelector,
  type ProviderOpContext,
  type ResourceLabels,
  type ResourceSummary,
  type SandboxProvider,
  type SandboxState,
} from "./provider.js";

// -----------------------------------------------------------------------------
// Lease-authority inference (GAP-1) — probe `lease_renew`, classify per-lease.
// -----------------------------------------------------------------------------

/** Per-lease liveness inferred from a `lease_renew` probe. `unreachable` = the probe
 * could not complete (offline/partition/terminal session) — fail CLOSED: never
 * resume, never kill on it; leave it to the server reaper (design §2.3 / §11). */
export type LeaseLiveness = "live" | "dead" | "unreachable";

export interface LeaseAuthorityEntry {
  readonly leaseId: string;
  readonly state: LeaseLiveness;
  /** The `renewLeaseOnce` classification the state was derived from (observability). */
  readonly probeKind: "renewed" | "rejected" | "terminal" | "protocol" | "transient" | "unprobed";
}

export type LeaseAuthorityMap = ReadonlyMap<string, LeaseAuthorityEntry>;

export interface ProbeLeaseAuthorityDeps {
  readonly client: ControlPlaneClient;
  readonly session: SessionProvider;
  readonly key: DeviceKey;
  /** Full lease offers reconstructed from durable local state (test-injected in
   * CORE — the durable persisted-offer index is the deferred enumeration gap, D5). */
  readonly candidates: readonly LeaseOfferV1[];
  /**
   * WRK-013 — called IMMEDIATELY BEFORE this candidate's own `lease_renew`, never earlier and
   * never in a batch. It is where the composition durably CLAIMS the candidate, so a crash while
   * probing one lease leaves every later one unclaimed and probeable on the next boot (Codex P1,
   * PR #553). Returning `false` (a claim that did not become durable) SKIPS that candidate: it is
   * not probed and gets no map entry, because a lease the daemon cannot account for must not be
   * renewed. Absent ⇒ every candidate is probed, which is the unit-test shape.
   */
  readonly beforeProbe?: (offer: LeaseOfferV1) => boolean;
  readonly now?: () => number;
  readonly randomness?: OperationRandomness;
  readonly logger?: Logger;
}

/**
 * Probe each candidate lease via `lease_renew` and build a per-`leaseId` liveness
 * map. A `renewed` verdict is live; a `rejected`/`terminal`/`protocol` verdict is
 * dead (stale fence / revoked / attempt-terminal); a transient/unexpected outcome
 * is `unreachable` (fail closed). A terminal session (or one that cannot be
 * obtained) marks EVERY candidate unreachable — the worker cannot govern-probe.
 * NEVER throws.
 */
export async function probeLeaseAuthority(deps: ProbeLeaseAuthorityDeps): Promise<LeaseAuthorityMap> {
  const map = new Map<string, LeaseAuthorityEntry>();
  const dedupeLeaseIds = new Set<string>();
  const candidates = deps.candidates.filter((offer) => {
    const leaseId = String(offer.leaseId);
    if (dedupeLeaseIds.has(leaseId)) return false;
    dedupeLeaseIds.add(leaseId);
    return true;
  });
  if (candidates.length === 0) return map;

  let session;
  try {
    session = await deps.session.get();
  } catch (err) {
    // No live session ⇒ we cannot probe. Fail closed: every candidate unreachable.
    const cause = err instanceof SessionTerminalError ? "session_terminal" : "session_error";
    deps.logger?.info({ cause, candidates: candidates.length }, "startup-reconcile: lease probe skipped (no session)");
    for (const offer of candidates) {
      const leaseId = String(offer.leaseId);
      map.set(leaseId, { leaseId, state: "unreachable", probeKind: "unprobed" });
    }
    return map;
  }

  for (const offer of candidates) {
    const leaseId = String(offer.leaseId);
    // Claim THIS lease, now, immediately before its own request.
    if (deps.beforeProbe !== undefined && !deps.beforeProbe(offer)) {
      deps.logger?.warn({ leaseId }, "startup-reconcile: candidate not claimed; NOT probed");
      continue;
    }
    let entry: LeaseAuthorityEntry;
    try {
      const attempt = await renewLeaseOnce({
        client: deps.client,
        session,
        offer,
        key: deps.key,
        idempotencyKey: (deps.randomness?.newIdempotencyKey ?? randomUUID)(),
        now: deps.now,
        newCorrelationId: deps.randomness?.newCorrelationId,
        newProofId: deps.randomness?.newProofId,
        newNonce: deps.randomness?.newNonce,
      });
      entry = { leaseId, state: livenessOf(attempt), probeKind: attempt.kind };
    } catch (err) {
      // renewLeaseOnce only re-throws a NON-transport failure (signing / parse /
      // mid-stream). Fail closed to unreachable — never crash the boot pass.
      deps.logger?.error({ leaseId, err }, "startup-reconcile: lease probe threw; marking unreachable");
      entry = { leaseId, state: "unreachable", probeKind: "transient" };
    }
    map.set(leaseId, entry);
  }
  return map;
}

function livenessOf(attempt: RenewAttempt): LeaseLiveness {
  switch (attempt.kind) {
    case "renewed":
      return "live";
    case "rejected":
    case "protocol":
      return "dead";
    case "terminal":
      // `renewLeaseOnce` returns `terminal` for BOTH a genuinely-dead `target_revoked`
      // (409) AND a recoverable 401 `unauthorized`. A 401 is a SESSION-credential
      // failure (a boot clock-skew / audience desync), NOT a lease-liveness verdict —
      // WRK-005's driver recovers it under a cap, never an immediate loss. Fail CLOSED
      // to `unreachable` so a transient auth blip never mass-kills live-owned sandboxes
      // or mass-abandons their outbox streams; only `target_revoked` is confirmed-dead.
      return attempt.reason === "target_revoked" ? "dead" : "unreachable";
    case "transient":
      return "unreachable";
  }
}

/**
 * The synchronous `reconcile()` seam predicate derived from a lease-authority map:
 * a sandbox is an orphan iff its lease probed CONFIRMED DEAD. A live, unreachable,
 * or unknown (un-probed) lease is NOT an orphan under this predicate — the richer
 * three-way classification (keep / kill / unknown_sandbox) lives in the startup
 * reconciler (Slice 2); this narrow predicate exists to reuse WRK-004's `reconcile`
 * shell for the confirmed-dead path without ever killing an ambiguous sandbox.
 */
export function buildControlPlaneIsOrphan(map: LeaseAuthorityMap): (summary: ResourceSummary) => boolean {
  return (summary: ResourceSummary): boolean => map.get(summary.resourceLabels.leaseId)?.state === "dead";
}

// -----------------------------------------------------------------------------
// The startup reconciler — three-way sandbox classification + teardown.
// -----------------------------------------------------------------------------

/** WRK-013 — why the sandbox pass did not run. Bounded tokens, logged as `reason`. */
export const SANDBOX_PASS_SKIP_REASONS = {
  /** F4: the container path has no process-level provider to enumerate with (its per-run
   * provider rides a capability that lapsed with the previous process). Orphan reclamation
   * rests on the adapter-manager reaper — a NAMED NARROWING owned by WRK-013. */
  containerPathNoEnumeration: "sandbox_pass_skipped_container_path_f4",
  /** A platform-scoped target has no Organization to build an ownership selector from. */
  platformScopedTarget: "sandbox_pass_skipped_platform_scoped_target",
  /** No provider/selector was supplied and the caller named no reason. Still never silent. */
  noProvider: "sandbox_pass_skipped_no_provider",
} as const;

const ALIVE_STATES: ReadonlySet<SandboxState> = new Set<SandboxState>(["creating", "running", "cancelling"]);
const DEFAULT_PAGE_SIZE = 50;

/** A sandbox's terminal disposition after the startup pass. */
export type SandboxDisposition = "keep" | "killed" | "kill_failed" | "unknown_sandbox" | "indeterminate";

export interface SandboxOutcomeRecord {
  readonly sandboxId: string;
  readonly resourceLabelsHash: string;
  readonly disposition: SandboxDisposition;
  /** The escalation rung reached (only for a teardown). */
  readonly escalationStage?: CleanupStage;
}

/** Build the (correlation-only) effect fence for a sandbox from its labels. The
 * fenceToken is NOT carried in `ResourceLabels`; it is used only for the authority's
 * correlation binding, so the leaseId is a stable stand-in. */
function fenceFromLabels(labels: ResourceLabels): EffectFence {
  return {
    jobId: labels.jobId,
    attempt: labels.attempt,
    leaseId: labels.leaseId,
    fenceToken: labels.leaseId,
    deviceGeneration: labels.deviceGeneration,
    observedSeq: 0,
  };
}

export interface StartupReconcileResult {
  readonly sandboxesScanned: number;
  readonly sandboxesKept: number;
  readonly sandboxesKilled: number;
  readonly sandboxesFailed: number;
  readonly unknownSandboxes: number;
  readonly indeterminateSandboxes: number;
  readonly streamsResumed: number;
  readonly streamsAbandoned: number;
  readonly artifactsQuarantined: number;
  readonly artifactsDropped: number;
  readonly leaseProbes: LeaseAuthorityMap;
  /** WRK-013 / F5 — leases the probe found LIVE and therefore FENCED: the probe's renewal was
   * the last; nothing renews or re-attaches them; the control-plane reaper ends the attempt. */
  readonly fencedLeaseIds: readonly string[];
  /** WRK-013 / F4 — the named reason the sandbox pass was skipped, or `null` when it ran. */
  readonly sandboxPassSkipped: string | null;
  readonly sandboxOutcomes: readonly SandboxOutcomeRecord[];
  readonly streamOutcomes: readonly StreamOutcomeRecord[];
  readonly quarantineOutcomes: readonly QuarantineOutcomeRecord[];
}

/** A resumed vs abandoned outbox stream (Slice 3). */
export interface StreamOutcomeRecord {
  readonly streamKey: string;
  readonly disposition: "resume_drain" | "abandoned";
}

/** A swept staged output artifact (Slice 4). */
export interface QuarantineOutcomeRecord {
  readonly artifactId: string;
  readonly status: QuarantineOutcome["status"] | "skipped_live";
}

export interface StartupReconcilerDeps {
  /**
   * The process-level provider + the Organization-scoped selector the SANDBOX pass lists by.
   * OPTIONAL since WRK-013: the pass runs only when BOTH are present (and `makeCtx`); otherwise
   * it is skipped under {@link StartupReconcilerDeps.sandboxPassSkipReason} (F4 container path /
   * platform target) and the lease + outbox passes still run.
   */
  readonly provider?: SandboxProvider;
  readonly ownershipSelector?: OwnershipSelector;
  /** Mints a fresh op context (deadline + STABLE-per-attempt idempotency key). */
  readonly makeCtx?: () => ProviderOpContext;
  /** WRK-013 — the named reason logged when the sandbox pass cannot run. */
  readonly sandboxPassSkipReason?: string;
  /**
   * WRK-013 / F5 — treat a LIVE-probed lease's sandbox as STALE and tear it down.
   *
   * ★ Off by default, which keeps WRK-007 CORE's `keep` disposition exactly as it shipped. The
   * COMPOSED daemon turns it on, because under founder ruling F5 a live-probed lease is FENCED:
   * the probe's renewal was its last, nothing re-attaches (D2), and no later pass will see the
   * sandbox again — so leaving it alive abandons a running tenant command to the provider's TTL
   * while the control plane mints a fresh attempt. That is what WRK-007's own D2 prescribes:
   * "regardless of `renewed`, do NOT re-attach … kill it via the cleanup authority, and let
   * JOB-006 mint a fresh fenced attempt". (Codex P1, PR #553.)
   */
  readonly fencedLeasesAreStale?: boolean;
  // --- control-plane lease-authority probe ---
  readonly client: ControlPlaneClient;
  readonly session: SessionProvider;
  readonly key: DeviceKey;
  readonly identity: RenewalIdentity;
  /** Full lease offers reconstructed from durable local state (test-injected). */
  readonly leaseCandidates: readonly LeaseOfferV1[];
  /** WRK-013 — see {@link ProbeLeaseAuthorityDeps.beforeProbe}: claim one candidate, immediately
   * before its own probe. A `false` return skips that candidate. */
  readonly beforeProbe?: (offer: LeaseOfferV1) => boolean;
  // --- optional outbox + quarantine (Slices 3–4) ---
  readonly outbox?: StartupOutboxDeps;
  readonly quarantineCandidates?: readonly StartupQuarantineCandidate[];
  // --- tuning / observability ---
  readonly pageSize?: number;
  /** Cleanup deadline for the per-sandbox CleanupAuthority (defaults to now = expired). */
  readonly cleanupDeadlineMs?: number;
  readonly metrics?: Metrics;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly randomness?: OperationRandomness;
}

/** The outbox seam the reconciler drives (Slice 3): recover, classify, resume-drain. */
export interface StartupOutboxDeps {
  readonly store: DurableEventStore;
  readonly drain: Pick<EventOutboxDrain, "recover" | "drainOnce">;
}

/** A staged output artifact to sweep to quarantine if its fence is dead (Slice 4). */
export interface StartupQuarantineCandidate {
  readonly identity: QuarantineIdentity;
  readonly artifact: QuarantineArtifact;
}

/** The concrete one-shot reconciler. `run()` returning a {@link StartupReconcileResult}
 * is assignable to the minimal `StartupReconciler` lifecycle the bootstrap depends on
 * (`lifecycle/startup-steps.ts`), so the composition root can wire it directly. */
export interface StartupReconcilePass {
  /** Run the one-shot startup reconciliation pass. Convergent + observable; NEVER
   * throws out (per-substep failures are counted + logged, not fatal). */
  run(): Promise<StartupReconcileResult>;
}

export function createStartupReconciler(deps: StartupReconcilerDeps): StartupReconcilePass {
  const now = deps.now ?? (() => Date.now());
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;

  /**
   * Reconcile outbox streams against inferred lease authority (D7). Recover stalled
   * `uploading` rows (no attempts bump), eagerly `stopStream` every CONFIRMED-dead
   * lease's stream (events under a dead fence can never be accepted), then drive ONE
   * drain pass so the surviving owned streams resume-drain (recover→resend from
   * `acceptedThroughSeq + 1`; the server dedups by seq). A stream whose lease is
   * unknown/unreachable is LEFT active — the drain's lazy stale-fence self-stop
   * handles it. A poison row stops only its own stream (corrupt_row) inside the
   * drain and never throws out, so it cannot block the later sandbox pass (D8).
   */
  async function reconcileOutboxStreams(probes: LeaseAuthorityMap): Promise<StreamOutcomeRecord[]> {
    const outbox = deps.outbox;
    if (outbox === undefined) return [];
    const outcomes: StreamOutcomeRecord[] = [];
    try {
      outbox.drain.recover();
    } catch (err) {
      deps.logger?.error({ err }, "startup-reconcile: outbox recover failed");
    }
    for (const stream of outbox.store.listActiveStreams()) {
      const probe = probes.get(stream.identity.leaseId);
      if (probe?.state === "dead") {
        // Dead fence → abandon: eager stop rather than a lazy stale_fence self-stop.
        outbox.store.stopStream(stream.streamKey, "lease_lost");
        outcomes.push({ streamKey: stream.streamKey, disposition: "abandoned" });
        deps.logger?.info({ streamKey: stream.streamKey }, "startup-reconcile: abandoned dead-lease outbox stream");
      } else {
        // Owned / unknown / unreachable → resume-drain (the drain lazily self-stops
        // an unknown/unreachable stream on a server stale_fence).
        outcomes.push({ streamKey: stream.streamKey, disposition: "resume_drain" });
      }
    }
    try {
      await outbox.drain.drainOnce();
    } catch (err) {
      // The drain is fail-closed per stream internally; a top-level throw is still
      // swallowed so a bad stream never blocks the sandbox pass.
      deps.logger?.error({ err }, "startup-reconcile: outbox drain pass failed");
    }
    return outcomes;
  }

  async function reconcileSandboxes(
    probes: LeaseAuthorityMap,
    provider: SandboxProvider,
    ownershipSelector: OwnershipSelector,
    makeCtx: () => ProviderOpContext,
  ): Promise<{ outcomes: SandboxOutcomeRecord[]; scanned: number }> {
    // Phase 1 — collect the FULL inventory read-only. Teardown MUST NOT interleave with
    // pagination: `list` excludes destroyed rows and the provider's page cursor is a
    // sandboxId (`findIndex(pageToken)+1`), so destroying a row mid-scan shifts the
    // cursor and re-processes survivors / inflates counts. Snapshot first, mutate after.
    const summaries: ResourceSummary[] = [];
    let pageToken: string | null = null;
    try {
      do {
        const page = await provider.list({ ownershipSelector, pageSize, pageToken }, makeCtx());
        summaries.push(...page.resources);
        pageToken = page.nextPageToken;
      } while (pageToken !== null);
    } catch (err) {
      // A list fault is not fatal — reconcile what was collected; the server reaper is
      // the authoritative net. (Honors run()'s "never throws out" contract.)
      deps.logger?.error({ err }, "startup-reconcile: sandbox list failed");
    }
    // Phase 2 — classify + teardown the stable snapshot, exactly once each. A per-sandbox
    // throw is contained so one bad sandbox never aborts the whole pass.
    const outcomes: SandboxOutcomeRecord[] = [];
    for (const summary of summaries) {
      try {
        outcomes.push(await classifyAndTeardown(summary, probes, provider, makeCtx));
      } catch (err) {
        const resourceLabelsHash = hashResourceLabels(summary.resourceLabels);
        deps.logger?.error({ sandboxId: summary.sandboxId, resourceLabelsHash, err }, "startup-reconcile: sandbox teardown threw");
        outcomes.push({ sandboxId: summary.sandboxId, resourceLabelsHash, disposition: "kill_failed" });
      }
    }
    return { outcomes, scanned: summaries.length };
  }

  async function classifyAndTeardown(
    summary: ResourceSummary,
    probes: LeaseAuthorityMap,
    provider: SandboxProvider,
    makeCtx: () => ProviderOpContext,
  ): Promise<SandboxOutcomeRecord> {
    const labelsHash = hashResourceLabels(summary.resourceLabels);
    const base = { sandboxId: summary.sandboxId, resourceLabelsHash: labelsHash } as const;
    const probe = probes.get(summary.resourceLabels.leaseId);

    // No probe resolves this sandbox's lease → conservative unknown_sandbox (no
    // existence-oracle probing; leave to the server reaper).
    if (probe === undefined) {
      deps.logger?.info({ ...base, disposition: "unknown_sandbox" }, "startup-reconcile: unknown sandbox (unresolved lease)");
      return { ...base, disposition: "unknown_sandbox" };
    }
    // Probe could not complete → fail closed: never resume, never kill.
    if (probe.state === "unreachable") {
      deps.logger?.info({ ...base, disposition: "indeterminate" }, "startup-reconcile: lease unreachable; leaving to reaper");
      return { ...base, disposition: "indeterminate" };
    }
    // Probe renewed AND matching device generation AND a local live lease → keep.
    // NEVER re-attached (D2) — just left for JOB-006 to mint a fresh attempt. ★ F5: `keep`
    // leaves the SANDBOX in place; it does NOT keep the LEASE alive. The probe's renewal was
    // the lease's last (it is in `fencedLeaseIds`), so the control-plane reaper ends it.
    const generationMatches = summary.resourceLabels.deviceGeneration === deps.identity.deviceGeneration;
    if (probe.state === "live" && generationMatches && summary.hasLiveLease) {
      if (deps.fencedLeasesAreStale !== true) {
        deps.logger?.info(
          { ...base, disposition: "keep" },
          "startup-reconcile: keeping live-owned sandbox (never re-attached; its lease is fenced, not renewed)",
        );
        return { ...base, disposition: "keep" };
      }
      // F5 — the lease is fenced, so this sandbox has no supervisor and no future pass of its own.
      // Tear it down through the cleanup authority rather than abandon it to the provider TTL.
      deps.logger?.info(
        { ...base, disposition: "fenced_stale" },
        "startup-reconcile: tearing down a FENCED lease's sandbox (never re-attached; no supervisor remains)",
      );
      return teardownStale(summary, base, provider, makeCtx);
    }

    // Otherwise stale → teardown.
    return teardownStale(summary, base, provider, makeCtx);
  }

  async function teardownStale(
    summary: ResourceSummary,
    base: { sandboxId: string; resourceLabelsHash: string },
    provider: SandboxProvider,
    makeCtx: () => ProviderOpContext,
  ): Promise<SandboxOutcomeRecord> {
    const liveTree = ALIVE_STATES.has(summary.state);
    let status: CleanupStatus;
    let escalationStage: CleanupStage = "none";

    if (liveTree) {
      // A still-live process tree routes through the distinct monotonic authority so
      // an ignored cancel/kill escalates to a forced destroy (survives lease loss).
      const authority = new CleanupAuthority({
        provider,
        resourceLabels: summary.resourceLabels,
        targetGeneration: summary.generation,
        fence: fenceFromLabels(summary.resourceLabels),
        deadline: deps.cleanupDeadlineMs ?? now(),
        epoch: 0,
        now,
      });
      try {
        status = await authority.converge([summary.sandboxId], makeCtx);
      } catch (err) {
        if (err instanceof ResourceNotAvailableError) {
          status = "success"; // vanished mid-converge — already gone
        } else {
          deps.logger?.error({ ...base, err }, "startup-reconcile: cleanup converge threw");
          status = "failed";
        }
      }
      escalationStage = authority.escalationStage();
    } else {
      // Empty-tree / terminal sandbox → the direct idempotent reconcile cleanup.
      const result = await provider.reconcileCleanup(summary.sandboxId, makeCtx());
      status = result.cleanupStatus;
    }

    deps.metrics?.inc(CLEANUP_ESCALATION_METRIC, { escalation_stage: escalationStage });
    deps.metrics?.inc(CLEANUP_OUTCOME_METRIC, { outcome: status });
    if (status === "success") deps.metrics?.inc(RECONCILE_ORPHANS_METRIC);
    deps.logger?.info(
      { ...base, escalationStage, cleanupStatus: status },
      "startup-reconcile: stale sandbox teardown",
    );
    return {
      ...base,
      disposition: status === "success" ? "killed" : "kill_failed",
      escalationStage,
    };
  }

  /**
   * Sweep injected staged output artifacts to quarantine (D5). An artifact whose
   * observed lease is NOT confirmed-live is orphaned → routed through WRK-005's
   * device-session `runOrphanQuarantine` with `unknown_artifact` (survives lease
   * loss; distinct `quarantine/` prefix; non-promotable; a terminal session DROPS
   * it, never the disabled ordinary-commit path). An artifact under a still-live
   * lease is skipped. The durable staged-artifact enumeration source is the deferred
   * gap (DAT-006); CORE sweeps only the injected candidates. NEVER throws out.
   */
  async function sweepUnknownArtifacts(probes: LeaseAuthorityMap): Promise<QuarantineOutcomeRecord[]> {
    const candidates = deps.quarantineCandidates;
    if (candidates === undefined || candidates.length === 0) return [];
    const outcomes: QuarantineOutcomeRecord[] = [];
    for (const candidate of candidates) {
      const probe = probes.get(candidate.identity.observedLeaseId);
      if (probe?.state === "live") {
        // Belongs to a still-live lease — not orphaned; do not quarantine.
        outcomes.push({ artifactId: candidate.artifact.artifactId, status: "skipped_live" });
        continue;
      }
      let outcome: QuarantineOutcome;
      try {
        outcome = await runOrphanQuarantine({
          client: deps.client,
          session: deps.session,
          key: deps.key,
          identity: candidate.identity,
          artifact: candidate.artifact,
          reason: classifyOrphanOutput({ unknownArtifact: true }),
          metrics: deps.metrics,
          logger: deps.logger,
          now: deps.now,
          newCorrelationId: deps.randomness?.newCorrelationId,
          newProofId: deps.randomness?.newProofId,
          newNonce: deps.randomness?.newNonce,
          newIdempotencyKey: deps.randomness?.newIdempotencyKey,
        });
      } catch (err) {
        // runOrphanQuarantine never throws by contract; belt-and-suspenders.
        deps.logger?.error({ artifactId: candidate.artifact.artifactId, err }, "startup-reconcile: quarantine sweep threw");
        outcome = { status: "failed", stage: "grant", label: "malformed" };
      }
      outcomes.push({ artifactId: candidate.artifact.artifactId, status: outcome.status });
    }
    return outcomes;
  }

  return {
    async run(): Promise<StartupReconcileResult> {
      // 1. Infer per-lease authority from durable local state.
      const leaseProbes = await probeLeaseAuthority({
        client: deps.client,
        session: deps.session,
        key: deps.key,
        candidates: deps.leaseCandidates,
        beforeProbe: deps.beforeProbe,
        now: deps.now,
        randomness: deps.randomness,
        logger: deps.logger,
      });

      // 2. Outbox streams — reconciled BEFORE the sandbox kill (D8) so terminal events
      //    land before their sandbox is destroyed.
      const streamOutcomes = await reconcileOutboxStreams(leaseProbes);

      // F5 — every LIVE lease is fenced: the probe above was its last renewal.
      const fencedLeaseIds = [...leaseProbes.values()].filter((p) => p.state === "live").map((p) => p.leaseId);

      // 3. Sandboxes — three-way classification + teardown. CONDITIONAL (F4): without a
      //    process-level provider AND an Organization-scoped selector the pass is skipped BY NAME.
      let sandboxOutcomes: SandboxOutcomeRecord[] = [];
      let scanned = 0;
      let sandboxPassSkipped: string | null = null;
      if (deps.provider !== undefined && deps.ownershipSelector !== undefined && deps.makeCtx !== undefined) {
        ({ outcomes: sandboxOutcomes, scanned } = await reconcileSandboxes(
          leaseProbes,
          deps.provider,
          deps.ownershipSelector,
          deps.makeCtx,
        ));
      } else {
        sandboxPassSkipped = deps.sandboxPassSkipReason ?? SANDBOX_PASS_SKIP_REASONS.noProvider;
        deps.logger?.info(
          { reason: sandboxPassSkipped },
          "startup-reconcile: sandbox pass skipped; orphan reclamation rests on the provider-side reaper",
        );
      }

      // 4. Quarantine sweep — staged output under dead fences.
      const quarantineOutcomes = await sweepUnknownArtifacts(leaseProbes);

      const sandboxesKept = sandboxOutcomes.filter((o) => o.disposition === "keep").length;
      const sandboxesKilled = sandboxOutcomes.filter((o) => o.disposition === "killed").length;
      const sandboxesFailed = sandboxOutcomes.filter((o) => o.disposition === "kill_failed").length;
      const unknownSandboxes = sandboxOutcomes.filter((o) => o.disposition === "unknown_sandbox").length;
      const indeterminateSandboxes = sandboxOutcomes.filter((o) => o.disposition === "indeterminate").length;

      return {
        sandboxesScanned: scanned,
        sandboxesKept,
        sandboxesKilled,
        sandboxesFailed,
        unknownSandboxes,
        indeterminateSandboxes,
        streamsResumed: streamOutcomes.filter((s) => s.disposition === "resume_drain").length,
        streamsAbandoned: streamOutcomes.filter((s) => s.disposition === "abandoned").length,
        artifactsQuarantined: quarantineOutcomes.filter((q) => q.status === "quarantined").length,
        artifactsDropped: quarantineOutcomes.filter((q) => q.status === "dropped").length,
        leaseProbes,
        fencedLeaseIds,
        sandboxPassSkipped,
        sandboxOutcomes,
        streamOutcomes,
        quarantineOutcomes,
      };
    },
  };
}
