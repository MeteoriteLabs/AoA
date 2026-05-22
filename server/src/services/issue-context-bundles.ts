import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  artifacts,
  issueAttachments,
  issueComments,
  issueContextBundleItems,
  issueContextBundles,
  issues,
  memoryItems,
} from "@armyofagents/db";
import { unprocessable } from "../errors.js";

type ContextBundleDb = Pick<Db, "select" | "insert">;

export const CONTEXT_BUNDLE_ITEM_TYPES = ["comment", "attachment", "artifact", "memory", "text"] as const;
export type ContextBundleItemType = (typeof CONTEXT_BUNDLE_ITEM_TYPES)[number];

export type CreateIssueContextBundleItemInput = {
  type: ContextBundleItemType | string;
  id?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CreateIssueContextBundleInput = {
  companyId: string;
  sourceIssueId: string;
  targetIssueId: string;
  brief?: string | null;
  items?: CreateIssueContextBundleItemInput[];
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
};

const MAX_CONTEXT_BUNDLE_ITEMS = 10;

function isContextBundleItemType(value: string): value is ContextBundleItemType {
  return (CONTEXT_BUNDLE_ITEM_TYPES as readonly string[]).includes(value);
}

function requireSourceId(item: CreateIssueContextBundleItemInput): string {
  if (!item.id) throw unprocessable(`Context item ${item.type} requires an id`);
  return item.id;
}

async function assertIssueInCompany(db: ContextBundleDb, companyId: string, issueId: string, field: string) {
  const row = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
    .then((rows) => rows[0] ?? null);
  if (!row) throw unprocessable(`${field} does not belong to this company`);
}

async function assertContextItemInCompany(db: ContextBundleDb, companyId: string, item: CreateIssueContextBundleItemInput) {
  if (!isContextBundleItemType(item.type)) {
    throw unprocessable(`Unsupported context item type: ${item.type}`);
  }

  if (item.type === "text") return;

  const sourceId = requireSourceId(item);
  const lookup =
    item.type === "comment"
      ? db
          .select({ id: issueComments.id })
          .from(issueComments)
          .where(and(eq(issueComments.id, sourceId), eq(issueComments.companyId, companyId)))
      : item.type === "attachment"
        ? db
            .select({ id: issueAttachments.id })
            .from(issueAttachments)
            .where(and(eq(issueAttachments.id, sourceId), eq(issueAttachments.companyId, companyId)))
        : item.type === "artifact"
          ? db
              .select({ id: artifacts.id })
              .from(artifacts)
              .where(and(eq(artifacts.id, sourceId), eq(artifacts.companyId, companyId)))
          : db
              .select({ id: memoryItems.id })
              .from(memoryItems)
              .where(and(eq(memoryItems.id, sourceId), eq(memoryItems.companyId, companyId)));

  const row = await lookup.then((rows) => rows[0] ?? null);
  if (!row) throw unprocessable(`Context item ${item.type} does not belong to this company`);
}

export async function validateContextBundleItems(db: ContextBundleDb, input: CreateIssueContextBundleInput) {
  const items = input.items ?? [];
  if (items.length > MAX_CONTEXT_BUNDLE_ITEMS) {
    throw unprocessable(`At most ${MAX_CONTEXT_BUNDLE_ITEMS} context items are allowed`);
  }

  await assertIssueInCompany(db, input.companyId, input.sourceIssueId, "sourceIssueId");
  await assertIssueInCompany(db, input.companyId, input.targetIssueId, "targetIssueId");

  for (const item of items) {
    await assertContextItemInCompany(db, input.companyId, item);
  }
}

export async function createIssueContextBundle(db: ContextBundleDb, input: CreateIssueContextBundleInput) {
  await validateContextBundleItems(db, input);

  const [bundle] = await db
    .insert(issueContextBundles)
    .values({
      companyId: input.companyId,
      sourceIssueId: input.sourceIssueId,
      targetIssueId: input.targetIssueId,
      brief: input.brief ?? null,
      createdByAgentId: input.createdByAgentId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();

  const itemValues = (input.items ?? []).map((item) => ({
    companyId: input.companyId,
    bundleId: bundle.id,
    itemType: item.type,
    sourceId: item.id ?? null,
    label: item.label ?? null,
    metadata: item.metadata ?? {},
  }));

  const items = itemValues.length > 0
    ? await db.insert(issueContextBundleItems).values(itemValues).returning()
    : [];

  return { ...bundle, items };
}

export async function listIssueContextBundlesForIssue(db: ContextBundleDb, companyId: string, issueId: string) {
  const bundles = await db
    .select()
    .from(issueContextBundles)
    .where(and(eq(issueContextBundles.companyId, companyId), eq(issueContextBundles.targetIssueId, issueId)));

  if (bundles.length === 0) return [];

  const results = [];
  for (const bundle of bundles) {
    const items = await db
      .select()
      .from(issueContextBundleItems)
      .where(and(eq(issueContextBundleItems.companyId, companyId), eq(issueContextBundleItems.bundleId, bundle.id)));
    results.push({ ...bundle, items });
  }
  return results;
}
