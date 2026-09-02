/**
 * CLI-008 Unit B — worker-side resolution of the control plane's STAGED INPUT.
 *
 * The inverse of DAT-009's export. The control plane authored files for this job BEFORE the
 * work started, put them in object storage and recorded committed `job_artifacts` rows; the
 * lease envelope carries a POINTER to them in `extensions[]`; and this module turns that
 * pointer into one short-lived DOWNLOAD GRANT per file over the frozen
 * `artifact_transfer_grant` op.
 *
 * ★ GRANTS OUT, NEVER BYTES. Nothing here fetches an object. The grant — opaque, ~1 KB, no
 * payload — is what crosses into the provider, and the provider redeems it. A bytes-shaped
 * seam would route payloads through a daemon that is dependency-pinned (E4-D01) precisely so
 * it does not handle them.
 *
 * ★ THE POINTER IS NOT TRUSTED FOR CONTENT. It says which artifact and what it should hash
 * to; the server independently proves the object exists and is committed under THIS tenant
 * before it presigns anything (`artifact-transfer-grant.ts`, download branch), and the
 * provider independently verifies the digest before it writes. The pointer being wrong in any
 * direction produces a refusal, never a silently different file.
 *
 * ★ AND IT IS NOT TRUSTED FOR SHAPE. `extensions[].value` is `z.unknown()` on the frozen
 * schema — the refiner bounds its SIZE and STRUCTURE, not its fields — so every field is
 * checked here. A malformed pointer yields NO staged files rather than a throw: an
 * unrecognised extension must behave exactly like an absent one, which is what makes staging
 * optional for every worker that predates it.
 *
 * Runtime imports: `@armyofagents/worker-protocol` + relative modules — the E4-D01 boundary.
 */

import { randomUUID } from "node:crypto";

import {
  artifactDownloadGrantV1Schema,
  isTransferGrantResponsePairedV1,
  type ArtifactDownloadGrantV1,
} from "@armyofagents/worker-protocol";

import type { DeviceKey } from "../identity/device-key.js";
import { signDeviceProof } from "../identity/device-proof.js";
import type { WorkerSession } from "../enrollment/enroll.js";
import type { ControlPlaneClient } from "../transport/client.js";
import type { StagedFileRequest } from "../supervisor/provider.js";
import type { LeaseHandoff } from "../poll/poll-loop.js";
import type { RunFenceContext } from "./secret-redemption.js";

/** The namespace the control plane publishes the staged-input pointer under. MUST match
 * `STAGED_INPUT_EXTENSION_NAMESPACE` in `server/src/services/job-input-staging.ts`; the two
 * cannot import each other across the E4-D01 boundary, and
 * `staged-input-namespace.contract.test.ts` pins that they agree. */
export const STAGED_INPUT_EXTENSION_NAMESPACE = "com.armyofagents.job/staged-input";

/** One staged file, as the envelope describes it. */
export interface StagedInputPointer {
  readonly artifactId: string;
  /** The ABSOLUTE in-sandbox path the bytes must be written to. */
  readonly path: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPointer(entry: unknown): StagedInputPointer | null {
  if (!isRecord(entry)) return null;
  const { id, path, key, sha256, size } = entry;
  if (typeof id !== "string" || id === "") return null;
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  if (typeof key !== "string" || key === "") return null;
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return null;
  return { artifactId: id, path, objectKey: key, sha256, sizeBytes: size };
}

/**
 * Read this run's staged-input pointers off the frozen envelope's `extensions[]`.
 *
 * Returns `[]` for an absent, unknown, or malformed extension — an unrecognised pointer must
 * be indistinguishable from no pointer, or every worker built before this existed would start
 * failing runs it used to complete. A pointer that is PARTLY malformed yields `[]` for the
 * whole extension rather than a subset: staging a subset of a bundle is the partial-stage
 * failure the provider refuses for the same reason.
 */
export function readStagedInputPointers(extensions: unknown): readonly StagedInputPointer[] {
  if (!Array.isArray(extensions)) return [];
  const extension = extensions.find(
    (entry) => isRecord(entry) && entry.namespace === STAGED_INPUT_EXTENSION_NAMESPACE,
  );
  if (!isRecord(extension) || !isRecord(extension.value)) return [];
  const files = extension.value.files;
  if (!Array.isArray(files) || files.length === 0) return [];
  const pointers: StagedInputPointer[] = [];
  for (const entry of files) {
    const pointer = readPointer(entry);
    if (!pointer) return [];
    pointers.push(pointer);
  }
  return pointers;
}

export interface CreateStagedInputResolverDeps {
  readonly client: Pick<ControlPlaneClient, "artifactTransferGrant" | "artifactTransferGrantPath">;
  readonly key: DeviceKey;
  /** Resolves the live session at mint time, so a renewed token is picked up. */
  readonly session: () => Promise<WorkerSession>;
  readonly now?: () => number;
  readonly newCorrelationId?: () => string;
  readonly newProofId?: () => string;
}

function defaultProofId(): string {
  return `prf_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** Build the signed operation-request bytes for ONE download grant. */
function buildGrantRequest(
  deps: CreateStagedInputResolverDeps,
  session: WorkerSession,
  fence: RunFenceContext,
  pointer: StagedInputPointer,
): { bytes: Buffer; sessionToken: string; proofHeaders: Readonly<Record<string, string>> } {
  const now = deps.now ?? (() => Date.now());
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const issuedAt = new Date(now()).toISOString();
  const request = {
    protocolVersion: 1 as const,
    correlationId,
    issuedAt,
    nonce: randomUUID(),
    audience: "worker_run" as const,
    idempotencyKey: `stage-${fence.leaseId}-${pointer.artifactId}`,
    body: {
      protocolVersion: 1 as const,
      operation: "download" as const,
      workerId: fence.workerId,
      jobId: fence.jobId,
      attempt: fence.attempt,
      leaseId: fence.leaseId,
      fenceToken: fence.fenceToken,
      artifactId: pointer.artifactId,
      expectedObjectKey: pointer.objectKey,
      expectedSha256: pointer.sha256,
      maxBytes: pointer.sizeBytes,
    },
  };
  const bytes = Buffer.from(JSON.stringify(request), "utf8");
  const proof = signDeviceProof({
    method: "POST",
    path: deps.client.artifactTransferGrantPath,
    rawBody: bytes,
    correlationId,
    issuedAt,
    proofId: (deps.newProofId ?? defaultProofId)(),
    key: deps.key,
  });
  return { bytes, sessionToken: session.token, proofHeaders: proof.headers };
}

/** Thrown when a pointer exists but no grant could be obtained for it. Carries no url. */
export class StagedInputUnavailableError extends Error {
  readonly artifactId: string;
  constructor(artifactId: string, detail: string) {
    super(`staged input ${artifactId} could not be granted: ${detail}`);
    this.name = "StagedInputUnavailableError";
    this.artifactId = artifactId;
  }
}

/**
 * A `resolveStagedFiles` closure for the supervisor: pointer → download grant, per file.
 *
 * ★ FAIL CLOSED. A pointer with no grant THROWS, and the supervisor turns that into a failed
 * attempt. The alternative — staging what we could and running anyway — produces a sandbox
 * whose agent works from part of its context and whose run terminalizes cleanly, which is the
 * one failure nothing downstream can detect.
 *
 * ★ HTTP 200 IS NOT SUCCESS. The op answers 200 for `rejected` as well as for
 * `download_granted` (the same fail-open trap `secret-redemption.ts` documents), so every
 * branch keys on the BODY's `outcome`, and the frozen pairing rule is checked so a
 * cross-paired `upload_granted` can never be mistaken for a download.
 */
export function createStagedInputResolver(
  deps: CreateStagedInputResolverDeps,
): (input: { handoff: LeaseHandoff }) => Promise<readonly StagedFileRequest[]> {
  return async ({ handoff }) => {
    const pointers = readStagedInputPointers(handoff.offer.job.extensions);
    if (pointers.length === 0) return [];

    const fence: RunFenceContext = {
      workerId: String(handoff.offer.workerId),
      jobId: String(handoff.offer.job.jobId),
      attempt: handoff.offer.job.attempt,
      leaseId: handoff.leaseId,
      fenceToken: String(handoff.fenceToken),
    };
    const session = await deps.session();

    const staged: StagedFileRequest[] = [];
    for (const pointer of pointers) {
      const response = await deps.client.artifactTransferGrant(
        buildGrantRequest(deps, session, fence, pointer),
      );
      if (response.status !== 200) {
        throw new StagedInputUnavailableError(pointer.artifactId, `status ${response.status}`);
      }
      const body = response.body;
      if (!isRecord(body) || typeof body.outcome !== "string") {
        throw new StagedInputUnavailableError(pointer.artifactId, "unreadable response");
      }
      if (!isTransferGrantResponsePairedV1("download", body.outcome)) {
        // A `rejected` lands here, and so would a cross-paired `upload_granted`.
        throw new StagedInputUnavailableError(pointer.artifactId, `outcome ${body.outcome}`);
      }
      const parsed = artifactDownloadGrantV1Schema.safeParse(body.grant);
      if (!parsed.success) {
        throw new StagedInputUnavailableError(pointer.artifactId, "malformed grant");
      }
      const grant: ArtifactDownloadGrantV1 = parsed.data;
      // The server echoes the key it proved committed. If it does not match what the pointer
      // named, something is inconsistent and the safe reading is "do not stage".
      if (grant.objectKey !== pointer.objectKey) {
        throw new StagedInputUnavailableError(pointer.artifactId, "granted a different object key");
      }
      staged.push({ path: pointer.path, grant });
    }
    return staged;
  };
}
