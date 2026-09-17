import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { universeLayouts, universeLayoutOperations } from "@armyofagents/db";
import {
  emptyUniverseLayoutDocument,
  layoutPatchSchema,
  universeLayoutDocumentSchema,
  UNIVERSE_LAYOUT_SCHEMA_VERSION,
  type LayoutAck,
  type UniverseLayoutDocument,
} from "@armyofagents/shared";
import { conflict } from "../errors.js";
import {
  applyLayoutOperations,
  hashLayoutOperations,
  type UniverseScope,
} from "./universe-layout-document.js";

export type { UniverseScope } from "./universe-layout-document.js";
export {
  applyLayoutOp,
  applyLayoutOperations,
  hashLayoutOperations,
} from "./universe-layout-document.js";

export interface UniverseLayoutSnapshot {
  schemaVersion: number;
  revision: number;
  document: UniverseLayoutDocument;
}

export function universeLayoutService(db: Db) {
  return {
    async get(scope: UniverseScope): Promise<UniverseLayoutSnapshot> {
      const [row] = await db
        .select({
          schemaVersion: universeLayouts.schemaVersion,
          revision: universeLayouts.revision,
          document: universeLayouts.document,
        })
        .from(universeLayouts)
        .where(
          and(
            eq(universeLayouts.companyId, scope.companyId),
            eq(universeLayouts.userId, scope.userId),
            eq(universeLayouts.conversationId, scope.conversationId),
          ),
        );
      if (!row)
        return {
          schemaVersion: UNIVERSE_LAYOUT_SCHEMA_VERSION,
          revision: 0,
          document: emptyUniverseLayoutDocument(),
        };
      return {
        schemaVersion: row.schemaVersion,
        revision: row.revision,
        document: row.document,
      };
    },

    /** The receipt is reached only through its authorized parent layout — an
     * operation id is never standalone authorization. */
    async getReceipt(
      scope: UniverseScope,
      operationId: string,
    ): Promise<LayoutAck | null> {
      const [row] = await db
        .select({ revision: universeLayoutOperations.acknowledgedRevision })
        .from(universeLayoutOperations)
        .innerJoin(
          universeLayouts,
          eq(universeLayoutOperations.layoutId, universeLayouts.id),
        )
        .where(
          and(
            eq(universeLayouts.companyId, scope.companyId),
            eq(universeLayouts.userId, scope.userId),
            eq(universeLayouts.conversationId, scope.conversationId),
            eq(universeLayoutOperations.operationId, operationId),
          ),
        );
      if (!row) return null;
      return {
        operationId,
        revision: row.revision,
        schemaVersion: UNIVERSE_LAYOUT_SCHEMA_VERSION,
      };
    },

    /** Apply a patch atomically: ensure/lock the owner row, dedupe by receipt
     * (same payload → original ack, changed payload → 409), require the expected
     * revision, apply the operations, bump the revision, and journal the receipt
     * — all in one transaction. A failed transaction leaves neither receipt nor
     * partial geometry. */
    async apply(scope: UniverseScope, patch: unknown): Promise<LayoutAck> {
      const parsed = layoutPatchSchema.parse(patch);
      const payloadHash = hashLayoutOperations(parsed.operations);
      return db.transaction(async (tx) => {
        await tx
          .insert(universeLayouts)
          .values({
            companyId: scope.companyId,
            userId: scope.userId,
            conversationId: scope.conversationId,
            schemaVersion: UNIVERSE_LAYOUT_SCHEMA_VERSION,
            revision: 0,
            document: emptyUniverseLayoutDocument(),
          })
          .onConflictDoNothing();
        const [row] = await tx
          .select({
            id: universeLayouts.id,
            revision: universeLayouts.revision,
            document: universeLayouts.document,
          })
          .from(universeLayouts)
          .where(
            and(
              eq(universeLayouts.companyId, scope.companyId),
              eq(universeLayouts.userId, scope.userId),
              eq(universeLayouts.conversationId, scope.conversationId),
            ),
          )
          .for("update");
        const [receipt] = await tx
          .select({
            payloadHash: universeLayoutOperations.payloadHash,
            revision: universeLayoutOperations.acknowledgedRevision,
          })
          .from(universeLayoutOperations)
          .where(
            and(
              eq(universeLayoutOperations.layoutId, row.id),
              eq(universeLayoutOperations.operationId, parsed.operationId),
            ),
          );
        if (receipt) {
          if (receipt.payloadHash !== payloadHash)
            throw conflict("Operation id reused with a different payload");
          return {
            operationId: parsed.operationId,
            revision: receipt.revision,
            schemaVersion: UNIVERSE_LAYOUT_SCHEMA_VERSION,
          };
        }
        if (parsed.expectedRevision !== row.revision)
          throw conflict("Stale revision", { revision: row.revision });
        const nextDocument = universeLayoutDocumentSchema.parse(
          applyLayoutOperations(row.document, parsed.operations, scope),
        );
        const nextRevision = row.revision + 1;
        await tx
          .update(universeLayouts)
          .set({
            document: nextDocument,
            revision: nextRevision,
            updatedAt: new Date(),
          })
          .where(eq(universeLayouts.id, row.id));
        await tx.insert(universeLayoutOperations).values({
          layoutId: row.id,
          companyId: scope.companyId,
          operationId: parsed.operationId,
          payloadHash,
          acknowledgedRevision: nextRevision,
        });
        return {
          operationId: parsed.operationId,
          revision: nextRevision,
          schemaVersion: UNIVERSE_LAYOUT_SCHEMA_VERSION,
        };
      });
    },
  };
}
