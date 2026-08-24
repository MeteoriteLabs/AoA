// server/src/services/artifact-commit.ts
//
// DAT-002 — the `artifact_commit` service: the fenced, verified commit of an
// artifact manifest. It mirrors `createJobEventIngestService.ingest`'s one-tx,
// fence-first template. The FROZEN worker-protocol shapes are consumed, never
// extended; the committed response returns `{artifactId, versionNumber, committedAt}`.
//
// Ordering + precedence (D5, the hard invariant):
//   1. headObject(manifest.objectKey) on the control plane's INTERNAL endpoint →
//      the store-observed {ContentLength, ChecksumSHA256}. A missing/incomplete
//      object or a store that cannot supply a checksum fails closed BEFORE the tx.
//   2. ONE `runInTenant` tx: resolve the fence identity, then the guarded
//      `commitArtifactVersion` mutator runs `guardActiveFence` FIRST — so a stale
//      fence surfaces as `stale_fence` BEFORE any hash/size/prefix check — then
//      verifies prefix/tenant/size/sha and idempotently inserts the committed row.
//   3. `JobFenceError.code` → `rejected{stale_fence|attempt_terminal|target_revoked}`;
//      an `ArtifactCommitRejection` → `rejected` mapped onto the frozen closed
//      protocol vocabulary (`hash_mismatch` → `event_hash_mismatch`; wrong-prefix /
//      size / tenant → `malformed`, deliberately coarse + redaction-safe — the
//      frozen `protocolErrorCodeSchema` has no finer artifact-reject codes).
//
// Auth-layer failures (proof/authority/no-lease) throw `JobLeasingError` → the route
// maps them to an HTTP protocol error, exactly like the event-ingest path.

import type { Db } from "@armyofagents/db";
import {
  JobFenceError as DbJobFenceError,
  ArtifactCommitRejection,
  type ArtifactCommitRejectionReason,
  type JobFenceErrorCode,
} from "@armyofagents/db";
import {
  artifactCommitOperationRequestV1Schema,
  artifactCommitOperationResponseV1Schema,
  expectedAttemptObjectPrefix,
  type ArtifactCommitOperationRequestV1,
  type ArtifactCommitOperationResponseV1,
} from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import { logger } from "../middleware/logger.js";
import { resolveStoredRetention } from "./artifact-retention-authority.js";
import type { SweepTrigger } from "./artifact-sweep-trigger.js";
import { JobLeasingError, type VerifiedWorkerOperation } from "./job-leasing.js";
import { resolveWorkerFenceContext } from "./worker-fence-context.js";
import type { StorageProvider } from "../storage/types.js";
import type { JobControlMetrics } from "./job-control-metrics.js";

/** A guarded-fence refusal → the frozen protocol reason vocabulary. */
function fenceReason(code: JobFenceErrorCode): "stale_fence" | "attempt_terminal" | "target_revoked" {
  return code;
}

/** An artifact-verification refusal → the frozen closed protocol reason vocabulary.
 * `hash_mismatch` maps to `event_hash_mismatch` (the only content-hash code); the
 * rest are coarse `malformed` (which is also redaction-safe — a tenant mismatch must
 * not disclose a foreign resource). */
function verificationReason(reason: ArtifactCommitRejectionReason): "event_hash_mismatch" | "malformed" {
  return reason === "hash_mismatch" ? "event_hash_mismatch" : "malformed";
}

export function createArtifactCommitService(input: {
  appDb: Db;
  storage: StorageProvider;
  maxHeartbeatAgeMs?: number;
  /** Server-authoritative absolute per-object ceiling (the grant's maxBytes is
   * advisory + unpersisted, and a presigned PUT imposes no size bound). */
  maxArtifactBytes?: number;
  /** DEP-007 — count-only, id-free artifact-commit telemetry. Defaults to the no-op
   * surface; the composition root threads the shared pino instance when distributed
   * execution is enabled. Emission is best-effort and never alters the commit path. */
  metrics?: JobControlMetrics;
  /** DAT-011 — the orphan-sweep trigger. Same shape and same contract as `metrics`
   * above: defaults to a NO-OP, is best-effort, and NEVER alters the commit path. A
   * commit event is the only moment an orphan sweep can run inside the right tenant
   * context without enumerating organizations, which the tenant boundary forbids. */
  sweepTrigger?: SweepTrigger;
}) {
  // No-op default, so a composition root that has not wired the sweep changes nothing.
  const sweepTrigger: SweepTrigger = input.sweepTrigger ?? { trigger() {}, async triggerAndWait() {} };
  const maxHeartbeatAgeMs = Math.max(1000, input.maxHeartbeatAgeMs ?? 300_000);
  const maxArtifactBytes = Math.max(1, input.maxArtifactBytes ?? 5 * 1024 ** 3);
  // Optional-chained (no NOOP VALUE import) so this module carries no runtime
  // dependency on job-control-metrics unless a live instance is passed (dormancy gate).
  const metrics = input.metrics;

  return {
    async commit(commitInput: {
      auth: VerifiedWorkerOperation;
      request: ArtifactCommitOperationRequestV1;
    }): Promise<ArtifactCommitOperationResponseV1> {
      const parsed = artifactCommitOperationRequestV1Schema.safeParse(commitInput.request);
      if (!parsed.success) throw new JobLeasingError("malformed");
      const request = parsed.data;
      const payload = request.body;
      const manifest = payload.manifest;
      const auth = commitInput.auth;
      if (payload.workerId !== auth.workerId) throw new JobLeasingError("unauthorized");

      const rejected = (reason: string): ArtifactCommitOperationResponseV1 =>
        artifactCommitOperationResponseV1Schema.parse({
          protocolVersion: 1,
          correlationId: request.correlationId,
          serverTime: new Date().toISOString(),
          outcome: "rejected",
          reason,
        });

      const response = await runInTenant(input.appDb, auth.organizationId, async (repos) => {
        const ctx = await resolveWorkerFenceContext(repos, auth, {
          leaseId: payload.leaseId,
          jobId: payload.jobId,
          attempt: payload.attempt,
          fenceToken: payload.fenceToken,
        }, maxHeartbeatAgeMs);

        // Object existence + store-observed integrity, run ONLY AFTER the fence
        // IDENTITY is resolved (an unresolvable/foreign fence throws above, before the
        // store is ever touched) — so a caller cannot use object existence/metadata as
        // a cross-tenant oracle. A never-uploaded (incomplete) object, or a store that
        // cannot supply a SHA256 checksum, fails closed — an unverifiable hash must
        // never commit.
        const head = await input.storage.headObject({ objectKey: manifest.objectKey });
        if (!head.exists) return rejected("malformed"); // upload_incomplete
        if (typeof head.contentLength !== "number" || !head.checksumSha256) {
          return rejected("event_hash_mismatch"); // integrity unverifiable → fail closed
        }
        const actualSizeBytes = head.contentLength;
        const actualSha256 = head.checksumSha256;
        // Server-authoritative absolute size ceiling (the grant's maxBytes is not
        // persisted and a presigned PUT imposes no size bound at the store).
        if (actualSizeBytes > maxArtifactBytes) return rejected("malformed");

        // Tenant + prefix validity are evaluated with the AUTH org + the LOCKED
        // lease's company (never the manifest's self-asserted org/company) and
        // re-checked inside the mutator AFTER the guard, preserving fence-first.
        const tenantValid =
          String(manifest.organizationId) === String(auth.organizationId)
          && String(manifest.companyId) === String(ctx.companyId);
        const prefix = expectedAttemptObjectPrefix({
          organizationId: auth.organizationId,
          jobId: payload.jobId,
          attempt: payload.attempt,
        });
        const prefixValid = manifest.objectKey.startsWith(prefix);

        // Decided BEFORE the mutator call so the stored value is never the declared one.
        const retentionDecision = resolveStoredRetention({
          kind: manifest.kind,
          declared: manifest.retention,
        });
        if (retentionDecision.declarationIgnored) {
          // Observed, not swallowed: a disagreement means a buggy worker or an attempted
          // downgrade. This is a LOG LINE, not an audit record — DE-11 claims retention is
          // audited and nothing audits it; this ticket does not pretend to close that.
          logger.warn(
            {
              artifactId: manifest.artifactId,
              kind: manifest.kind,
              declaredRetention: manifest.retention,
              storedRetention: retentionDecision.retention,
            },
            "artifact retention declaration ignored — retention is control-plane-owned",
          );
        }

        let row;
        try {
          row = await repos.jobControl.commitArtifactVersion({
            ...ctx.fenceIdentity,
            identifier: manifest.artifactId,
            objectKey: manifest.objectKey,
            contentType: manifest.contentType,
            kind: manifest.kind,
            // `sensitivity` stays as declared DELIBERATELY: artifactSensitivitySchema is a
            // single-valued literal, so the frozen schema already makes it unforgeable and
            // deriving it here would compute a constant. If it ever gains a second value it
            // must move to the control plane that day (DAT-010 §4).
            sensitivity: manifest.sensitivity,
            // ★ DAT-010 — retention is CONTROL-PLANE-OWNED, derived from the frozen `kind`,
            // and the manifest's declaration is IGNORED. A worker choosing the retention of
            // a browser_cookie_state / browser_storage_state artifact is a privilege the
            // threat model must not grant: those bytes ARE a live session credential.
            retention: retentionDecision.retention,
            declaredSizeBytes: manifest.sizeBytes,
            declaredSha256: manifest.sha256,
            actualSizeBytes,
            actualSha256,
            prefixValid,
            tenantValid,
          });
        } catch (error) {
          if (error instanceof DbJobFenceError) {
            // ★ DAT-011 — a `stale_fence` refusal is the exact moment an orphan exists: the
            // bytes landed (commit was attempted, so the PUT completed) and the fence that
            // authorised them is gone. Fire-and-forget; it cannot affect this response.
            //
            // It does NOT collect THIS object: the grant stays redeemable until `expiresAt`,
            // so a retry could still re-PUT to the same key. `isSweepEligible` remains the
            // single authority and is unchanged. This sweeps what has ALREADY expired.
            sweepTrigger.trigger(auth.organizationId);
            return rejected(fenceReason(error.code));
          }
          if (error instanceof ArtifactCommitRejection) return rejected(verificationReason(error.reason));
          throw error;
        }

        // ★ DAT-011 — also on SUCCESS, deliberately. Success is the common event, so it
        // gives far more collection opportunities than refusals alone, and the sweep is a
        // no-op when nothing has expired. This is what keeps the residual to "the org's last
        // orphan" rather than "every orphan after the last refusal".
        sweepTrigger.trigger(auth.organizationId);
        return artifactCommitOperationResponseV1Schema.parse({
          protocolVersion: 1,
          correlationId: request.correlationId,
          serverTime: ctx.authorityNow.toISOString(),
          outcome: "committed",
          artifactId: row.identifier,
          versionNumber: row.versionNumber!,
          committedAt: (row.committedAt ?? new Date()).toISOString(),
        });
      });

      // DEP-007 — count-only artifact-commit telemetry (committed | rejected), emitted
      // AFTER the authoritative response is resolved so it can never alter the commit
      // path. Best-effort: a failing metric surface is swallowed.
      try {
        metrics?.artifactOp({
          operation: "commit",
          outcome: response.outcome === "committed" ? "committed" : "rejected",
          count: 1,
        });
      } catch {
        /* best-effort telemetry */
      }
      return response;
    },
  };
}
