// server/src/services/artifact-transfer-grant.ts
//
// DAT-002 — the `artifact_transfer_grant` service. It mints a scoped, expiring,
// credential-scrubbed presigned URL so a worker uploads/downloads an artifact
// DIRECTLY to/from object storage — the bytes never traverse the control-plane API
// body path. The wire shapes are FROZEN (worker-protocol v1); this service issues
// them and self-validates with the frozen schema before sending.
//
// Fence posture (D4):
//   * UPLOAD  requires a LIVE fence — `lockActiveFence` runs the shared guard
//     (a stale/terminal/revoked fence → `rejected{stale_fence|attempt_terminal|
//     target_revoked}`), because writing new bytes for an attempt is a governed act.
//   * DOWNLOAD is tenant-scoped + object-existence, NOT fence-current — a committed
//     artifact must stay readable after lease loss. It proves a committed
//     `job_artifacts` row exists for the tenant (RLS-scoped) instead of guarding.
//
// Auth failures (proof/authority/target) throw `JobLeasingError` → the route maps
// them to an HTTP protocol error; only fence/existence refusals are a 200 `rejected`.

import type { Db } from "@armyofagents/db";
import { resolveGrantTtlSeconds } from "./artifact-grant-ttl.js";
import { JobFenceError as DbJobFenceError, type JobFenceErrorCode } from "@armyofagents/db";
import {
  artifactTransferGrantOperationRequestV1Schema,
  artifactTransferGrantOperationResponseV1Schema,
  artifactUploadGrantV1Schema,
  artifactDownloadGrantV1Schema,
  expectedAttemptObjectPrefix,
  type ArtifactTransferGrantOperationRequestV1,
  type ArtifactTransferGrantOperationResponseV1,
} from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import { JobLeasingError, type VerifiedWorkerOperation } from "./job-leasing.js";
import { resolveWorkerFenceContext } from "./worker-fence-context.js";
import type { StorageProvider } from "../storage/types.js";

/** Map the guard's fence-error code onto the frozen protocol reason vocabulary. */
function fenceReason(code: JobFenceErrorCode): "stale_fence" | "attempt_terminal" | "target_revoked" {
  return code;
}

export function createArtifactTransferGrantService(input: {
  appDb: Db;
  storage: StorageProvider;
  grantTtlSeconds?: number;
  maxHeartbeatAgeMs?: number;
}) {
  // DAT-009 slice 2 §4.1 — CLAMPED, not merely floored. This was
  // `Math.max(30, input.grantTtlSeconds ?? 300)`: a floor, a default, and no ceiling, so
  // the frozen schema (whose only temporal assertion is `expiresAt > issuedAt`) would have
  // accepted a seven-day ordinary upload grant. The TTL is the ONLY revocation mechanism
  // here — the issued grant carries no fence material and no revocation concept exists —
  // so it is exactly the window in which a dead fence's PUT still lands.
  const grantTtlSeconds = resolveGrantTtlSeconds(input.grantTtlSeconds);
  const maxHeartbeatAgeMs = Math.max(1000, input.maxHeartbeatAgeMs ?? 300_000);

  return {
    async grant(grantInput: {
      auth: VerifiedWorkerOperation;
      request: ArtifactTransferGrantOperationRequestV1;
    }): Promise<ArtifactTransferGrantOperationResponseV1> {
      const parsed = artifactTransferGrantOperationRequestV1Schema.safeParse(grantInput.request);
      if (!parsed.success) throw new JobLeasingError("malformed");
      const request = parsed.data;
      const body = request.body;
      const auth = grantInput.auth;
      // The grant is bound to the authenticated worker.
      if (body.workerId !== auth.workerId) throw new JobLeasingError("unauthorized");

      const rejected = (reason: string): ArtifactTransferGrantOperationResponseV1 =>
        artifactTransferGrantOperationResponseV1Schema.parse({
          protocolVersion: 1,
          correlationId: request.correlationId,
          serverTime: new Date().toISOString(),
          outcome: "rejected",
          reason,
        });

      return runInTenant(input.appDb, auth.organizationId, async (repos) => {
        const ctx = await resolveWorkerFenceContext(repos, auth, {
          leaseId: body.leaseId,
          jobId: body.jobId,
          attempt: body.attempt,
          fenceToken: body.fenceToken,
        }, maxHeartbeatAgeMs);

        const issuedAt = ctx.authorityNow;
        const expiresAt = new Date(issuedAt.getTime() + grantTtlSeconds * 1000);

        if (body.operation === "upload") {
          // A live fence is required to write new bytes for this attempt.
          try {
            await repos.jobControl.lockActiveFence(ctx.fenceIdentity);
          } catch (error) {
            if (error instanceof DbJobFenceError) return rejected(fenceReason(error.code));
            throw error;
          }
          // Bind the write key to THIS org's prefix. The frozen request schema binds
          // only job/attempt (artifacts.ts:383-391), never the org segment, so without
          // this check a live-fenced worker could mint a presigned PUT into a FOREIGN
          // org's object-key namespace (the download branch already guards this).
          const uploadPrefix = expectedAttemptObjectPrefix({
            organizationId: auth.organizationId,
            jobId: body.jobId,
            attempt: body.attempt,
          });
          if (!body.expectedObjectKey.startsWith(uploadPrefix)) return rejected("malformed");
          // Immutable-artifact guard (Rule #7 / Decisions #43/#45): never re-grant an
          // upload for an ALREADY-committed artifact — a re-PUT to the committed key
          // would silently overwrite immutable bytes a reader still trusts.
          const alreadyCommitted = await repos.jobArtifacts.findCommitted({
            jobId: body.jobId,
            attempt: body.attempt,
            identifier: body.artifactId,
          });
          if (alreadyCommitted) return rejected("malformed");
          if (!input.storage.presignPut) throw new Error("storage provider cannot presign uploads");
          const signed = await input.storage.presignPut({
            objectKey: body.expectedObjectKey,
            expiresInSeconds: grantTtlSeconds,
            maxBytes: body.maxBytes,
            checksumSha256: body.expectedSha256,
          });
          const grant = artifactUploadGrantV1Schema.parse({
            protocolVersion: 1,
            operation: "upload",
            artifactId: body.artifactId,
            method: "PUT",
            url: signed.url,
            headers: signed.headers,
            issuedAt: issuedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            maxBytes: body.maxBytes,
            expectedSha256: body.expectedSha256,
            objectKey: body.expectedObjectKey,
            redaction: "secret",
          });
          return artifactTransferGrantOperationResponseV1Schema.parse({
            protocolVersion: 1,
            correlationId: request.correlationId,
            serverTime: issuedAt.toISOString(),
            outcome: "upload_granted",
            grant,
          });
        }

        // operation === "download": fence-independent, but tenant-scoped + object
        // must already be committed under this tenant.
        const committed = await repos.jobArtifacts.findCommitted({
          jobId: body.jobId,
          attempt: body.attempt,
          identifier: body.artifactId,
        });
        // Defense-in-depth: the committed key must match the requested key AND bind
        // this org/job/attempt prefix (never grant a download of a foreign key).
        const prefix = expectedAttemptObjectPrefix({
          organizationId: auth.organizationId,
          jobId: body.jobId,
          attempt: body.attempt,
        });
        if (!committed
          || committed.objectKey !== body.expectedObjectKey
          || !body.expectedObjectKey.startsWith(prefix)) {
          return rejected("malformed");
        }
        if (!input.storage.presignGet) throw new Error("storage provider cannot presign downloads");
        const signed = await input.storage.presignGet({
          objectKey: body.expectedObjectKey,
          expiresInSeconds: grantTtlSeconds,
          maxBytes: body.maxBytes,
          checksumSha256: body.expectedSha256,
        });
        const grant = artifactDownloadGrantV1Schema.parse({
          protocolVersion: 1,
          operation: "download",
          artifactId: body.artifactId,
          method: "GET",
          url: signed.url,
          headers: signed.headers,
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          maxBytes: body.maxBytes,
          expectedSha256: body.expectedSha256,
          objectKey: body.expectedObjectKey,
          redaction: "secret",
        });
        return artifactTransferGrantOperationResponseV1Schema.parse({
          protocolVersion: 1,
          correlationId: request.correlationId,
          serverTime: issuedAt.toISOString(),
          outcome: "download_granted",
          grant,
        });
      });
    },
  };
}
