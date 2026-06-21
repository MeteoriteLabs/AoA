// server/src/services/internal-agent/tools/artifact-create-version.ts
//
// Task C2 batch 2 — `create_artifact_version` (action tool, Engineer iteration).
//
// Creates a new version of an existing artifact and updates artifacts.
// current_version_id to point at it. Wrapped in a transaction so the
// artifacts row's pointer is never left pointing at a non-existent
// version (or stuck on the previous version when the insert succeeded).
//
// versionNumber is allocated atomically inside the transaction by reading
// the current max(version_number) for the artifactId and adding 1. This
// matches the existing artifactService.create-version pattern.

import { eq, sql } from "drizzle-orm";
import { artifacts, artifactVersions } from "@armyofagents/db";
import type { AgentTool } from "../types.js";

export const createArtifactVersionTool: AgentTool = {
  name: "create_artifact_version",
  description:
    "Create a new version of an existing artifact (Engineer iteration loop).",
  parameters: {
    type: "object",
    properties: {
      artifactId: { type: "string", description: "Artifact id to add a version to" },
      content: { type: "string", description: "Text content for the new version" },
      parentVersionId: {
        type: "string",
        description: "Optional FK to a previous version for branching",
      },
    },
    required: ["artifactId", "content"],
  },
  category: "action",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { artifactId, content, parentVersionId } = (params ?? {}) as {
      artifactId?: string;
      content?: string;
      parentVersionId?: string;
    };
    if (!artifactId || typeof artifactId !== "string") {
      return {
        success: false,
        data: null,
        summary: "artifactId is required",
        error: "INVALID_PARAMS",
      };
    }
    if (typeof content !== "string") {
      return {
        success: false,
        data: null,
        summary: "content must be a string",
        error: "INVALID_PARAMS",
      };
    }

    // SECURITY (company scoping): this is a crew-agent tool (Engineer/Planner)
    // driven by an LLM over untrusted task/discussion content — a prompt-injection
    // surface. artifactId is an arbitrary tool param; nothing below filters by
    // company, so without this gate a crew agent could add a version to, and
    // repoint current_version_id on, ANOTHER company's artifact. We verify
    // ownership on ctx.db BEFORE the transaction and treat a cross-company hit
    // exactly like a miss (same NOT_FOUND, nothing created) so the tool never
    // writes onto, or leaks the existence of, another company's artifact. This
    // MUST run before ctx.db.transaction(...): returning a failure from inside
    // the tx callback would be lost — the outer handler reads result.versionNumber
    // and would report success with bogus data.
    const [art] = await ctx.db
      .select({ companyId: artifacts.companyId })
      .from(artifacts)
      .where(eq(artifacts.id, artifactId));
    if (!art || art.companyId !== ctx.companyId) {
      return {
        success: false,
        data: null,
        summary: "Artifact not found",
        error: "NOT_FOUND",
      };
    }

    try {
      const result = await ctx.db.transaction(async (tx: any) => {
        const latestRows = await tx
          .select({
            max: sql<number>`coalesce(max(${artifactVersions.versionNumber}), 0)::int`,
          })
          .from(artifactVersions)
          .where(eq(artifactVersions.artifactId, artifactId));
        const latest = Array.isArray(latestRows) ? latestRows[0] : latestRows;
        const currentMax = Number(latest?.max ?? 0);
        const nextVersion = currentMax + 1;

        const inserted = await tx
          .insert(artifactVersions)
          .values({
            artifactId,
            versionNumber: nextVersion,
            content,
            source: "agent",
            parentVersionId: parentVersionId ?? null,
          })
          .returning();
        const newVersion = Array.isArray(inserted) ? inserted[0] : inserted;
        if (!newVersion || !newVersion.id) {
          throw new Error("artifact_versions insert returned no row");
        }

        await tx
          .update(artifacts)
          .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
          .where(eq(artifacts.id, artifactId));

        return { versionId: newVersion.id, versionNumber: nextVersion };
      });

      return {
        success: true,
        data: result,
        summary: `Created artifact v${result.versionNumber}`,
      };
    } catch (err: any) {
      return {
        success: false,
        data: null,
        summary: `Failed to create artifact version: ${err?.message ?? "unknown error"}`,
        error: "TRANSACTION_FAILED",
      };
    }
  },
};
