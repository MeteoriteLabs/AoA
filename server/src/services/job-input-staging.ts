// server/src/services/job-input-staging.ts
//
// CLI-008 Unit B — THE CONTROL-PLANE STAGING WRITE. The first of the four orphaned
// components on the inbound byte path, given a caller.
//
// It is the exact inversion of DAT-009's export: the control plane authors bytes for a job
// BEFORE the work starts, puts them in object storage, and records a committed
// `job_artifacts` row so the frozen `artifact_transfer_grant` DOWNLOAD branch can later
// prove the object exists and presign a GET for the worker.
//
// ★ WHY THIS DOES NOT USE THE FENCED MUTATORS. `authorizeArtifactCommit`,
// `recordArtifactGrantIntent` and `commitArtifactVersion` are all in `GUARDED_JOB_MUTATORS`
// and each begins with `guardActiveFence`. That machinery is built for the OUTBOUND
// direction — a worker committing its own output under a live fence — and it is unusable
// here BY CONSTRUCTION, not merely by policy: `ActiveFenceRequest` demands `leaseId`,
// `fence`, `workerId`, `targetGeneration`, `profileHash` and `providerConstraintHash`, none
// of which exist before placement mints them. The control plane cannot even construct the
// argument. (Measured: a `leases` row correct in all thirteen identity fields but
// `status='offered'` still throws `stale_fence` — a fence begins at worker ACK, so the whole
// span from admission through placement, offer and ack-in-flight has none.)
//
// `JobArtifactsRepository.insert` is the path that works: a plain, UNGUARDED tenant-repo
// write, not in `GUARDED_JOB_MUTATORS`, never calling `guardActiveFence`. Both remaining
// barriers are real and both are satisfied simply by writing this way:
//   * RLS is enforced — a foreign `organization_id` fails `42501`; satisfied by writing
//     inside `runInTenant(organizationId)`.
//   * The composite FK `job_artifacts_org_job_fk` is enforced — a ghost job fails `23503`;
//     satisfied by staging only for a job that already exists.
// There is no CHECK on `status`, and `attempt`, `lease_id`, `fence_token`, `object_key` and
// `sha256` are all nullable — so `leaseId: null, fenceToken: null` is a legal committed row.
// `job-input-staging.integration.test.ts` pins the no-lease/no-fence property on real
// serving roles, because that property is the whole reason this path was chosen and it is
// the one a future refactor is most likely to break by "tidying" the write behind a guard.
//
// ★ ONE OBJECT PER FILE, NOT ONE BUNDLE ARCHIVE. Each staged file is its own committed
// artifact with its own sha256 and size, which is what `job_artifacts` already models and
// what the frozen grant already addresses. A bundle-document format would need a codec
// shared between the control plane and the sandbox provider, and those two packages have no
// common non-frozen home; per-file artifacts need no codec at all.
//
// ★ THE POINTER RIDES `extensions[]`; THE BYTES DO NOT. Task 1 measured the inline
// `extensions[]` ceiling at 48,960 bytes and chose object storage for the PAYLOAD. The
// worker still has to learn WHICH artifact to fetch and what it should hash to, and the
// frozen envelope has no field for that — `extensions` is the container the protocol
// designates for exactly this ("safe additive data"). The pointer is ~200 bytes per file,
// `critical: false` so a worker that does not understand it ignores it and simply stages
// nothing, which is what keeps staging OPTIONAL.

import { createHash } from "node:crypto";

import type { Db } from "@armyofagents/db";
import { expectedAttemptObjectPrefix } from "@armyofagents/worker-protocol";

import { runInTenant } from "../db/tenant-context.js";
import type { StorageProvider } from "../storage/types.js";

/** `job_artifacts.kind` for a control-plane-authored inbound file. Distinct from every
 * worker-authored kind so a sweep or an audit can tell the directions apart. */
export const STAGED_INPUT_ARTIFACT_KIND = "staged_input";

/** The wire-extension namespace the staged-input pointer travels under. Reverse-DNS with a
 * name, as `wireExtensionSchema`'s namespace regex requires. */
export const STAGED_INPUT_EXTENSION_NAMESPACE = "com.armyofagents.job/staged-input";

/** The pointer payload's schema version, carried on the extension. */
export const STAGED_INPUT_EXTENSION_SCHEMA_VERSION = 1;

/** A file the control plane wants to exist inside the sandbox before the agent runs. */
export interface StagedInputFile {
  /** The ABSOLUTE in-sandbox path to write. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** Stored on the artifact row for audit; defaults to `application/octet-stream`. */
  readonly contentType?: string;
}

/** What the worker needs to fetch one staged file and prove it got the right bytes. */
export interface StagedInputPointer {
  /** The wire `artifactId` — also the `job_artifacts.identifier`. A UUID, because
   * `artifactIdSchema` brands `uuidSchema`. */
  readonly artifactId: string;
  /** The ABSOLUTE in-sandbox path this object's bytes are written to. */
  readonly path: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface StageJobInputFilesInput {
  readonly appDb: Db;
  readonly storage: StorageProvider;
  readonly organizationId: string;
  readonly jobId: string;
  /** The attempt's ROW id. The attempt NUMBER (which the object key binds) is resolved from
   * it here — the submission response carries only the id, and deriving the number at the
   * call site would put a tenant read outside the tenant context. */
  readonly attemptId: string;
  readonly files: readonly StagedInputFile[];
  /** Injectable id minter (tests pin the ids). Defaults to `crypto.randomUUID`. */
  readonly newArtifactId?: () => string;
  readonly now?: () => Date;
}

export type StageJobInputFilesResult =
  | { readonly staged: false; readonly reason: "no_files" | "unknown_attempt" }
  | { readonly staged: true; readonly attempt: number; readonly pointers: readonly StagedInputPointer[] };

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Stage `files` for a job that ALREADY EXISTS, before its attempt becomes leasable.
 *
 * Order is load-bearing: the object goes to the store FIRST and the committed row LAST, so a
 * committed row always has bytes behind it. The reverse order would let the download branch
 * prove existence for an object that is not there yet and presign a GET that 404s inside the
 * sandbox. If the row write fails the object is deleted best-effort — the storage port has no
 * list operation, so an object nobody recorded can never be found again.
 *
 * Idempotent per (attempt, path, digest): a replayed stage that finds a committed staged-input
 * row for the same path and digest reuses it instead of writing a second object. The
 * identifier is minted, so a replay is recognised by scanning this attempt's rows rather than
 * by guessing the id.
 */
export async function stageJobInputFiles(
  input: StageJobInputFilesInput,
): Promise<StageJobInputFilesResult> {
  if (input.files.length === 0) return { staged: false, reason: "no_files" };

  const newArtifactId = input.newArtifactId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date());

  // 1. Resolve the attempt NUMBER and this attempt's existing staged rows, in ONE tenant
  //    transaction. RLS supplies the organization; an attempt in another tenant simply is
  //    not visible, which is the refusal we want rather than an error to interpret.
  const resolved = await runInTenant(input.appDb, input.organizationId, async (repos) => {
    const attempt = await repos.attempts.getById(input.attemptId);
    if (!attempt || attempt.jobId !== input.jobId || typeof attempt.attemptNumber !== "number") {
      return null;
    }
    const rows = await repos.jobArtifacts.listForJob(input.jobId);
    return { attempt: attempt.attemptNumber, rows };
  });
  if (!resolved) return { staged: false, reason: "unknown_attempt" };

  const existing = stagedInputPointersFromRows(resolved.rows, resolved.attempt);
  const prefix = expectedAttemptObjectPrefix({
    organizationId: input.organizationId,
    jobId: input.jobId,
    attempt: resolved.attempt,
  });

  const pointers: StagedInputPointer[] = [];
  const pending: Array<{ pointer: StagedInputPointer; contentType: string }> = [];
  for (const file of input.files) {
    const sha256 = sha256Hex(file.bytes);
    const replay = existing.find((p) => p.path === file.path && p.sha256 === sha256);
    if (replay) {
      pointers.push(replay);
      continue;
    }
    const artifactId = newArtifactId();
    const pointer: StagedInputPointer = {
      artifactId,
      path: file.path,
      objectKey: `${prefix}${artifactId}`,
      sha256,
      sizeBytes: file.bytes.byteLength,
    };
    // 2. The bytes, BEFORE the row.
    await input.storage.putObject({
      objectKey: pointer.objectKey,
      body: Buffer.from(file.bytes),
      contentType: file.contentType ?? "application/octet-stream",
      contentLength: pointer.sizeBytes,
    });
    pending.push({ pointer, contentType: file.contentType ?? "application/octet-stream" });
    pointers.push(pointer);
  }

  if (pending.length > 0) {
    try {
      // 3. The committed rows. ★ NO LEASE, NO FENCE — `leaseId` and `fenceToken` are null and
      //    no fence has ever existed for this attempt. That is the property that makes an
      //    inbound write possible at all; do not "tidy" this behind `guardActiveFence`, which
      //    cannot be satisfied here and would remove the capability rather than secure it.
      await runInTenant(input.appDb, input.organizationId, async (repos) => {
        for (const entry of pending) {
          await repos.jobArtifacts.insert({
            organizationId: input.organizationId,
            jobId: input.jobId,
            identifier: entry.pointer.artifactId,
            attempt: resolved.attempt,
            objectKey: entry.pointer.objectKey,
            sha256: entry.pointer.sha256,
            sizeBytes: entry.pointer.sizeBytes,
            contentType: stagedPathMarker(entry.pointer.path),
            kind: STAGED_INPUT_ARTIFACT_KIND,
            status: "committed",
            leaseId: null,
            fenceToken: null,
            committedAt: now(),
          });
        }
      });
    } catch (error) {
      // The row is the only durable record of the object; without it the object is
      // unfindable (the storage port has no list operation). Remove what we just wrote.
      for (const entry of pending) {
        await input.storage.deleteObject({ objectKey: entry.pointer.objectKey }).catch(() => undefined);
      }
      throw error;
    }
  }

  return { staged: true, attempt: resolved.attempt, pointers };
}

/**
 * The in-sandbox path, encoded into the row's `content_type`.
 *
 * ★ This is deliberate and it is ugly, so it is documented rather than hidden. `job_artifacts`
 * has no path column, and adding one is a migration this unit does not need: the row already
 * carries a free-form `content_type`, no consumer parses it, and the staged-input rows are
 * identified by `kind = 'staged_input'` so the encoding can never be mistaken for a real
 * media type on a worker-authored row. A path column belongs with Unit E's workspace work,
 * where more than one consumer will want it.
 */
export function stagedPathMarker(path: string): string {
  return `application/vnd.aoa.staged-input; path=${path}`;
}

/** Recover the in-sandbox path from a staged-input row's marker, or `null` if it is not one. */
export function stagedPathFromMarker(marker: string | null | undefined): string | null {
  if (typeof marker !== "string") return null;
  const match = /^application\/vnd\.aoa\.staged-input; path=(.+)$/.exec(marker);
  return match?.[1] ?? null;
}

/**
 * The wire extension carrying this attempt's staged-input pointers.
 *
 * `critical: false` is load-bearing twice over. The frozen refiner fails EVERY unknown
 * `critical: true` extension closed, so a critical pointer would make every existing worker
 * reject the offer outright; and a worker that does not understand this namespace must
 * simply not stage, which is the "staging is optional" property Task 5 asserts.
 */
export function stagedInputExtension(pointers: readonly StagedInputPointer[]): {
  namespace: string;
  schemaVersion: number;
  critical: false;
  value: { files: Array<{ id: string; path: string; key: string; sha256: string; size: number }> };
} {
  return {
    namespace: STAGED_INPUT_EXTENSION_NAMESPACE,
    schemaVersion: STAGED_INPUT_EXTENSION_SCHEMA_VERSION,
    critical: false,
    value: {
      files: pointers.map((pointer) => ({
        id: pointer.artifactId,
        path: pointer.path,
        key: pointer.objectKey,
        sha256: pointer.sha256,
        size: pointer.sizeBytes,
      })),
    },
  };
}

/** A durable `job_artifacts` row, narrowed to what the pointer needs. */
export interface StagedInputArtifactRow {
  readonly identifier: string;
  readonly attempt: number | null;
  readonly objectKey: string | null;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly contentType: string | null;
  readonly kind: string | null;
  readonly status: string | null;
}

/**
 * Rebuild this attempt's staged-input pointers from the durable rows.
 *
 * The lease path reads the ROWS, never the staging call's return value: the offer is built
 * in a different transaction, minutes later, possibly in a different process. A pointer that
 * could only be produced by the process that staged it would be no pointer at all.
 *
 * Sorted by in-sandbox path so an offer for the same attempt is byte-identical across
 * replays — the envelope is hashed downstream.
 */
export function stagedInputPointersFromRows(
  rows: readonly StagedInputArtifactRow[],
  attempt: number,
): StagedInputPointer[] {
  const pointers: StagedInputPointer[] = [];
  for (const row of rows) {
    if (row.status !== "committed") continue;
    if (row.kind !== STAGED_INPUT_ARTIFACT_KIND) continue;
    if (row.attempt !== attempt) continue;
    const path = stagedPathFromMarker(row.contentType);
    if (!path || !row.objectKey || !row.sha256 || typeof row.sizeBytes !== "number") continue;
    pointers.push({
      artifactId: row.identifier,
      path,
      objectKey: row.objectKey,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
    });
  }
  return pointers.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
