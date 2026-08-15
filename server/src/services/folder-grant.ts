// server/src/services/folder-grant.ts
//
// DAT-006 — the local-folder-grant admission service + resolver. It admits an explicit
// `(owner, execution_target, declared base)` grant into the tenant-scoped `folder_grants`
// table (the durable record the FROZEN `snapshotProvenance.folderGrantId` uuid resolves
// to) and resolves a `folderGrantId` at stage/reconcile time to gate that a captured path
// is WITHIN the declared base. It is INERT until a capture/reconcile path reads it (the
// frozen `folderGrantId` points at nothing today) — default-off distributed posture.
//
// It uses the tenant transaction (`runInTenant` sets the `aoa.organization_id` GUC so the
// per-table FORCE RLS + tenant-isolation policy scope every row to the caller's org); it
// touches `folder_grants` directly via the tx (there is no cross-tenant folder-grant read).

import { and, eq, isNull, sql } from "drizzle-orm";
import { folderGrants, type Db } from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import { isSafeWorkspacePath, isPathWithinBase, isLikelySecretPath } from "./folder-grant-path.js";

export type FolderGrantErrorReason = "invalid_base";

export class FolderGrantError extends Error {
  constructor(public readonly reason: FolderGrantErrorReason) {
    super(`Folder grant ${reason}`);
    this.name = "FolderGrantError";
  }
}

export interface AdmitFolderGrantInput {
  organizationId: string;
  ownerUserId: string;
  executionTargetId: string;
  targetAuthorityKey: string;
  deviceGeneration: number;
  declaredBasePath: string;
}

export interface AdmitFolderGrantResult {
  folderGrantId: string;
  /** false on an idempotent replay (an active grant for this base already existed). */
  admitted: boolean;
}

export interface ResolvedFolderGrant {
  folderGrantId: string;
  ownerUserId: string;
  executionTargetId: string;
  deviceGeneration: number;
  declaredBasePath: string;
}

export interface ResolveCapturedPathResult {
  admitted: boolean;
  grant: ResolvedFolderGrant | null;
}

export function createFolderGrantService(input: { appDb: Db }) {
  return {
    /** Admit an explicit folder grant (idempotent on the active-base natural key). */
    async admit(admitInput: AdmitFolderGrantInput): Promise<AdmitFolderGrantResult> {
      // The declared base must be a safe RELATIVE path — an absolute path, `..` escape,
      // drive letter, or NUL/control is rejected before any row is written.
      if (!isSafeWorkspacePath(admitInput.declaredBasePath)) throw new FolderGrantError("invalid_base");
      return runInTenant(input.appDb, admitInput.organizationId, async (_repos, tx) => {
        const inserted = await tx.insert(folderGrants).values({
          organizationId: admitInput.organizationId,
          ownerUserId: admitInput.ownerUserId,
          executionTargetId: admitInput.executionTargetId,
          targetAuthorityKey: admitInput.targetAuthorityKey,
          deviceGeneration: admitInput.deviceGeneration,
          declaredBasePath: admitInput.declaredBasePath,
        }).onConflictDoNothing({
          target: [
            folderGrants.organizationId,
            folderGrants.executionTargetId,
            folderGrants.ownerUserId,
            folderGrants.declaredBasePath,
          ],
          where: sql`revoked_at IS NULL`,
        }).returning({ folderGrantId: folderGrants.folderGrantId });
        if (inserted[0]) return { folderGrantId: inserted[0].folderGrantId, admitted: true };

        // Conflict → an active grant for this base already exists (idempotent replay).
        const [existing] = await tx.select({ folderGrantId: folderGrants.folderGrantId })
          .from(folderGrants)
          .where(and(
            eq(folderGrants.organizationId, admitInput.organizationId),
            eq(folderGrants.executionTargetId, admitInput.executionTargetId),
            eq(folderGrants.ownerUserId, admitInput.ownerUserId),
            eq(folderGrants.declaredBasePath, admitInput.declaredBasePath),
            isNull(folderGrants.revokedAt),
          ))
          .limit(1);
        if (!existing) throw new FolderGrantError("invalid_base");
        return { folderGrantId: existing.folderGrantId, admitted: false };
      });
    },

    /** Resolve an ACTIVE (non-revoked) folder grant by its frozen `folderGrantId`. */
    async resolve(resolveInput: { organizationId: string; folderGrantId: string }): Promise<ResolvedFolderGrant | null> {
      return runInTenant(input.appDb, resolveInput.organizationId, async (_repos, tx) => {
        const [row] = await tx.select({
          folderGrantId: folderGrants.folderGrantId,
          ownerUserId: folderGrants.ownerUserId,
          executionTargetId: folderGrants.executionTargetId,
          deviceGeneration: folderGrants.deviceGeneration,
          declaredBasePath: folderGrants.declaredBasePath,
        }).from(folderGrants).where(and(
          eq(folderGrants.folderGrantId, resolveInput.folderGrantId),
          isNull(folderGrants.revokedAt),
        )).limit(1);
        return row ?? null;
      });
    },

    /** Resolve a folder grant and gate that a single captured path is WITHIN its declared
     * base. A revoked/absent grant, or an out-of-base/unsafe path, is not admitted. */
    async resolveCapturedPath(pathInput: {
      organizationId: string;
      folderGrantId: string;
      capturedPath: string;
    }): Promise<ResolveCapturedPathResult> {
      const grant = await this.resolve({ organizationId: pathInput.organizationId, folderGrantId: pathInput.folderGrantId });
      if (!grant) return { admitted: false, grant: null };
      // Enforce the SAME always-on secret floor the batch admitCapturedPaths applies —
      // a grant is permission to stage source, NEVER to exfiltrate a `.env`/`id_rsa`/
      // `*.pem`/credential even when it sits inside the declared base.
      const admitted = isPathWithinBase(grant.declaredBasePath, pathInput.capturedPath)
        && !isLikelySecretPath(pathInput.capturedPath);
      return { admitted, grant };
    },
  };
}
