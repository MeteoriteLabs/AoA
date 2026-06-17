import { eq, desc } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { artifacts, artifactVersions, issues } from "@armyofagents/db";

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
        sourceActionId?: string | null;
      },
    ) => {
      const { source, sourceDetail, changelog, content, fileUrl, sourceActionId, ...artifactData } =
        data;

      return db.transaction(async (tx) => {
        const [artifact] = await tx
          .insert(artifacts)
          .values({ ...artifactData, companyId, createdById, sourceActionId: sourceActionId ?? null })
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
