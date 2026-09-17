import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { universeDrafts } from "@armyofagents/db";
import {
  draftPatchSchema,
  type UniverseDraft,
  type UniverseDraftDestination,
} from "@armyofagents/shared";
import { conflict } from "../errors.js";
import type { UniverseScope } from "./universe-layout-document.js";

export type { UniverseScope } from "./universe-layout-document.js";

const emptyDraft = (): UniverseDraft => ({
  revision: 0,
  text: "",
  attachmentAssetIds: [],
});

export function universeDraftsService(db: Db) {
  const scopeWhere = (
    scope: UniverseScope,
    destination: UniverseDraftDestination,
  ) =>
    and(
      eq(universeDrafts.companyId, scope.companyId),
      eq(universeDrafts.userId, scope.userId),
      eq(universeDrafts.conversationId, scope.conversationId),
      eq(universeDrafts.destinationKind, destination.kind),
      eq(universeDrafts.destinationId, destination.id),
    );

  return {
    async get(
      scope: UniverseScope,
      destination: UniverseDraftDestination,
    ): Promise<UniverseDraft> {
      const [row] = await db
        .select({
          revision: universeDrafts.revision,
          text: universeDrafts.text,
          attachmentAssetIds: universeDrafts.attachmentAssetIds,
        })
        .from(universeDrafts)
        .where(scopeWhere(scope, destination));
      if (!row) return emptyDraft();
      return {
        revision: row.revision,
        text: row.text,
        attachmentAssetIds: row.attachmentAssetIds,
      };
    },

    /** Compare-and-set on `expectedRevision`. A stale revision is a 409 carrying
     * the current server revision; the client retains its local draft (both
     * versions are kept — the server never concatenates). Clearing after a
     * durable send is just a patch to empty text/attachments. */
    async patch(
      scope: UniverseScope,
      destination: UniverseDraftDestination,
      patch: unknown,
    ): Promise<UniverseDraft> {
      const parsed = draftPatchSchema.parse(patch);
      return db.transaction(async (tx) => {
        await tx
          .insert(universeDrafts)
          .values({
            companyId: scope.companyId,
            userId: scope.userId,
            conversationId: scope.conversationId,
            destinationKind: destination.kind,
            destinationId: destination.id,
            revision: 0,
            text: "",
            attachmentAssetIds: [],
          })
          .onConflictDoNothing();
        const [row] = await tx
          .select({
            id: universeDrafts.id,
            revision: universeDrafts.revision,
          })
          .from(universeDrafts)
          .where(scopeWhere(scope, destination))
          .for("update");
        if (parsed.expectedRevision !== row.revision)
          throw conflict("Stale draft revision", { revision: row.revision });
        const nextRevision = row.revision + 1;
        const [updated] = await tx
          .update(universeDrafts)
          .set({
            text: parsed.text,
            attachmentAssetIds: parsed.attachmentAssetIds,
            revision: nextRevision,
            updatedAt: new Date(),
          })
          .where(eq(universeDrafts.id, row.id))
          .returning({
            revision: universeDrafts.revision,
            text: universeDrafts.text,
            attachmentAssetIds: universeDrafts.attachmentAssetIds,
          });
        return {
          revision: updated.revision,
          text: updated.text,
          attachmentAssetIds: updated.attachmentAssetIds,
        };
      });
    },
  };
}
