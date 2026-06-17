import { and, eq, desc } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  artifacts,
  artifactVersions,
  discussionEntryAttachments,
  issueContextBundleItems,
  issues,
  memoryExtractions,
  memoryItems,
  taskOutputs,
} from "@armyofagents/db";
import { conflict, notFound } from "../errors.js";

export type ArtifactReferenceType =
  | "discussion_attachment"
  | "task"
  | "task_output"
  | "memory_item"
  | "memory_extraction"
  | "context_bundle_item";

export interface ArtifactReference {
  type: ArtifactReferenceType;
  id: string;
}

/** Fetch artifact row + its versions (newest first) */
async function fetchWithVersions(db: Db, artifactId: string) {
  const artifact = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .then((rows) => rows[0] ?? null);
  if (!artifact) return null;

  const versions = await db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.versionNumber));

  return { ...artifact, versions };
}

export function artifactService(db: Db) {
  async function assertArtifactCompany(companyId: string, artifactId: string) {
    const artifact = await db
      .select({ id: artifacts.id, companyId: artifacts.companyId })
      .from(artifacts)
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!artifact) throw notFound("Artifact not found");
    return artifact;
  }

  async function getArtifactReferences(companyId: string, artifactId: string): Promise<ArtifactReference[]> {
    const references: ArtifactReference[] = [];

    const discussionRows = await db
      .select({ id: discussionEntryAttachments.id })
      .from(discussionEntryAttachments)
      .where(eq(discussionEntryAttachments.artifactId, artifactId));
    references.push(...discussionRows.map((row) => ({ type: "discussion_attachment" as const, id: row.id })));

    const issueRows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.artifactId, artifactId)));
    references.push(...issueRows.map((row) => ({ type: "task" as const, id: row.id })));

    const outputRows = await db
      .select({ id: taskOutputs.id })
      .from(taskOutputs)
      .where(and(eq(taskOutputs.companyId, companyId), eq(taskOutputs.artifactId, artifactId)));
    references.push(...outputRows.map((row) => ({ type: "task_output" as const, id: row.id })));

    const memoryRows = await db
      .select({ id: memoryItems.id })
      .from(memoryItems)
      .where(and(eq(memoryItems.companyId, companyId), eq(memoryItems.sourceArtifactId, artifactId)));
    references.push(...memoryRows.map((row) => ({ type: "memory_item" as const, id: row.id })));

    const extractionRows = await db
      .select({ id: memoryExtractions.id })
      .from(memoryExtractions)
      .where(and(eq(memoryExtractions.companyId, companyId), eq(memoryExtractions.resultArtifactId, artifactId)));
    references.push(...extractionRows.map((row) => ({ type: "memory_extraction" as const, id: row.id })));

    const contextRows = await db
      .select({ id: issueContextBundleItems.id })
      .from(issueContextBundleItems)
      .where(
        and(
          eq(issueContextBundleItems.companyId, companyId),
          eq(issueContextBundleItems.itemType, "artifact"),
          eq(issueContextBundleItems.sourceId, artifactId),
        ),
      );
    references.push(...contextRows.map((row) => ({ type: "context_bundle_item" as const, id: row.id })));

    return references;
  }

  return {
    list: async (companyId: string) => {
      return db
        .select()
        .from(artifacts)
        .where(eq(artifacts.companyId, companyId))
        .orderBy(desc(artifacts.updatedAt));
    },

    getById: async (id: string) => {
      return fetchWithVersions(db, id);
    },

    getArtifactReferences,

    archiveArtifact: async (input: { companyId: string; artifactId: string }) => {
      await assertArtifactCompany(input.companyId, input.artifactId);
      const [artifact] = await db
        .update(artifacts)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(artifacts.id, input.artifactId), eq(artifacts.companyId, input.companyId)))
        .returning();
      if (!artifact) throw notFound("Artifact not found");
      return artifact;
    },

    deleteArtifact: async (input: { companyId: string; artifactId: string; force?: boolean }) => {
      await assertArtifactCompany(input.companyId, input.artifactId);
      const references = await getArtifactReferences(input.companyId, input.artifactId);
      if (references.length > 0 && !input.force) {
        throw conflict("Artifact is referenced and cannot be deleted without force", { references });
      }

      await db.transaction(async (tx) => {
        if (input.force) {
          await tx
            .delete(discussionEntryAttachments)
            .where(eq(discussionEntryAttachments.artifactId, input.artifactId));
          await tx
            .delete(issueContextBundleItems)
            .where(
              and(
                eq(issueContextBundleItems.companyId, input.companyId),
                eq(issueContextBundleItems.itemType, "artifact"),
                eq(issueContextBundleItems.sourceId, input.artifactId),
              ),
            );
        }
        await tx
          .delete(artifacts)
          .where(and(eq(artifacts.id, input.artifactId), eq(artifacts.companyId, input.companyId)));
      });

      return { deleted: true as const, mode: "hard_delete" as const, references };
    },

    create: async (
      companyId: string,
      createdById: string,
      data: {
        title: string;
        description?: string | null;
        type: string;
        source?: string;
        sourceDetail?: string | null;
        changelog?: string | null;
        content?: string | null;
        fileUrl?: string | null;
        filename?: string | null;
        contentType?: string | null;
        extension?: string | null;
        storageKind?: string | null;
        assetId?: string | null;
        byteSize?: number | null;
        sha256?: string | null;
      },
    ) => {
      const {
        source,
        sourceDetail,
        changelog,
        content,
        fileUrl,
        filename,
        contentType,
        extension,
        storageKind,
        assetId,
        byteSize,
        sha256,
        ...artifactData
      } = data;

      return db.transaction(async (tx) => {
        const [artifact] = await tx
          .insert(artifacts)
          .values({ ...artifactData, companyId, createdById })
          .returning();

        if (source) {
          const [version] = await tx
            .insert(artifactVersions)
            .values({
              artifactId: artifact.id,
              versionNumber: 1,
              source,
              sourceDetail: sourceDetail ?? null,
              changelog: changelog ?? null,
              content: content ?? null,
              fileUrl: fileUrl ?? null,
              filename: filename ?? null,
              contentType: contentType ?? null,
              extension: extension ?? null,
              storageKind: storageKind ?? "inline",
              assetId: assetId ?? null,
              byteSize: byteSize ?? null,
              sha256: sha256 ?? null,
            })
            .returning();

          const [updated] = await tx
            .update(artifacts)
            .set({ currentVersionId: version.id, updatedAt: new Date() })
            .where(eq(artifacts.id, artifact.id))
            .returning();

          return { ...updated, versions: [version] };
        }

        return { ...artifact, versions: [] };
      });
    },

    update: async (
      id: string,
      data: {
        title?: string;
        description?: string | null;
        type?: string;
        status?: string;
      },
    ) => {
      return db
        .update(artifacts)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(artifacts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    addVersion: async (
      artifactId: string,
      data: {
        source: string;
        sourceDetail?: string | null;
        changelog?: string | null;
        parentVersionId?: string | null;
        content?: string | null;
        fileUrl?: string | null;
        filename?: string | null;
        contentType?: string | null;
        extension?: string | null;
        storageKind?: string | null;
        assetId?: string | null;
        byteSize?: number | null;
        sha256?: string | null;
      },
    ) => {
      return db.transaction(async (tx) => {
        // Read max version inside transaction for atomicity
        const existing = await tx
          .select({ versionNumber: artifactVersions.versionNumber })
          .from(artifactVersions)
          .where(eq(artifactVersions.artifactId, artifactId))
          .orderBy(desc(artifactVersions.versionNumber))
          .limit(1);

        const nextVersion = existing.length > 0 ? existing[0].versionNumber + 1 : 1;

        const [version] = await tx
          .insert(artifactVersions)
          .values({
            artifactId,
            versionNumber: nextVersion,
            source: data.source,
            sourceDetail: data.sourceDetail ?? null,
            changelog: data.changelog ?? null,
            parentVersionId: data.parentVersionId ?? null,
            content: data.content ?? null,
            fileUrl: data.fileUrl ?? null,
            filename: data.filename ?? null,
            contentType: data.contentType ?? null,
            extension: data.extension ?? null,
            storageKind: data.storageKind ?? "inline",
            assetId: data.assetId ?? null,
            byteSize: data.byteSize ?? null,
            sha256: data.sha256 ?? null,
          })
          .returning();

        await tx
          .update(artifacts)
          .set({ currentVersionId: version.id, updatedAt: new Date() })
          .where(eq(artifacts.id, artifactId));

        return version;
      });
    },

    /** Returns { companyId } for the issue, or null if issue not found */
    getIssueCompanyId: async (issueId: string) => {
      return db
        .select({ companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
    },

    getByIssueId: async (issueId: string) => {
      const issue = await db
        .select({ artifactId: issues.artifactId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);

      if (!issue?.artifactId) return null;

      return fetchWithVersions(db, issue.artifactId);
    },
  };
}
