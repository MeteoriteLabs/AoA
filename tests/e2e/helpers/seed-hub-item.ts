import { createDb, hubItems } from "../../../packages/db/src/index";
import type { HubItemPriority, HubOwnerPool, HubSemanticType } from "../../../packages/shared/src/hub";

export interface SeedHubItemInput {
  companyId: string;
  semanticType: HubSemanticType;
  sourceType: string;
  sourceId: string;
  title: string;
  summary?: string | null;
  ownerUserId?: string | null;
  ownerPool?: HubOwnerPool | null;
  priority?: HubItemPriority;
}

function e2eDatabaseUrl() {
  const explicit =
    process.env.AOA_E2E_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (explicit) return explicit;
  const port = process.env.AOA_E2E_DB_PORT?.trim() || "54329";
  return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
}

export async function seedHubItem(input: SeedHubItemInput) {
  const db = createDb(e2eDatabaseUrl());
  try {
    const sourceUniqueKey = [
      input.companyId,
      input.sourceType,
      input.sourceId,
      input.semanticType,
      "",
    ].join(":");
    const [row] = await db
      .insert(hubItems)
      .values({
        companyId: input.companyId,
        userId: input.ownerUserId ?? "e2e-board",
        type: input.semanticType,
        title: input.title,
        message: input.summary ?? null,
        semanticType: input.semanticType,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceUniqueKey,
        summary: input.summary ?? null,
        ownerUserId: input.ownerUserId ?? null,
        ownerPool: input.ownerPool ?? null,
        priority: input.priority ?? "normal",
        status: "open",
      })
      .onConflictDoUpdate({
        target: hubItems.sourceUniqueKey,
        set: {
          title: input.title,
          message: input.summary ?? null,
          summary: input.summary ?? null,
          priority: input.priority ?? "normal",
          ownerUserId: input.ownerUserId ?? null,
          ownerPool: input.ownerPool ?? null,
        },
      })
      .returning();
    return row;
  } finally {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end();
  }
}
