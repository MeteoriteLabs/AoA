import { eq } from "drizzle-orm";
import { discussionEntries, discussionEntryAttachments } from "@armyofagents/db";
import type { AgentTool } from "../types.js";

function extensionFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0 || lastDot === filename.length - 1) return null;
  return filename.slice(lastDot + 1).toLowerCase();
}

function contentTypeFromExtension(extension: string | null, artifactType: string): string | null {
  switch (extension) {
    case "md":
    case "mdx":
      return "text/markdown";
    case "html":
    case "htm":
      return "text/html";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "svg":
      return "image/svg+xml";
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "css":
      return "text/plain";
    default:
      return artifactType === "document" ? "text/markdown" : "text/plain";
  }
}

export function createArtifactTool(): AgentTool {
  return {
    name: "create_artifact",
    description:
      "Create a new artifact (document, code, report, etc.) and optionally link it to a thread entry.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Artifact title",
        },
        type: {
          type: "string",
          description:
            "Artifact type: document | presentation | code | design | report | other",
        },
        content: {
          type: "string",
          description: "Text content for this artifact version (optional)",
        },
        fileRef: {
          type: "string",
          description:
            "File URL reference (optional, use instead of content for file-backed artifacts)",
        },
        filename: {
          type: "string",
          description: "Original filename for the artifact version (optional)",
        },
        contentType: {
          type: "string",
          description: "MIME content type for the artifact version (optional)",
        },
        discussionId: {
          type: "string",
          description: "Thread to associate this artifact with (optional, informational)",
        },
        attachToEntryId: {
          type: "string",
          description:
            "Entry ID to link this artifact to by updating its sourceInfo (optional)",
        },
      },
      required: ["title", "type"],
    },
    category: "action",
    requiredRole: "team_member",
    requiresConfirmation: false,
    execute: async (params: unknown, ctx) => {
      const { title, type, content, fileRef, filename, contentType, attachToEntryId } =
        (params ?? {}) as Record<string, unknown>;
      const artifactTitle = title as string;
      const artifactType = (type as string) ?? "document";
      const versionFilename = typeof filename === "string" && filename.trim()
        ? filename.trim()
        : artifactTitle;
      const extension = extensionFromFilename(versionFilename);
      const inferredContentType = typeof contentType === "string" && contentType.trim()
        ? contentType.trim().toLowerCase()
        : contentTypeFromExtension(extension, artifactType);

      const result = await ctx.services.artifacts.create(
        ctx.companyId,
        ctx.agentId ?? "aoa-agent",
        {
          title: artifactTitle,
          type: artifactType,
          source: "agent",
          content: (content as string) ?? null,
          fileUrl: (fileRef as string) ?? null,
          filename: versionFilename,
          contentType: inferredContentType,
          extension,
          storageKind: fileRef ? "external" : "inline",
        },
      );

      const artifactId = result.id;
      const versionId = (result.versions as Array<{ id: string }>)[0]?.id ?? null;

      if (attachToEntryId) {
        const existing = await ctx.db
          .select({ sourceInfo: discussionEntries.sourceInfo })
          .from(discussionEntries)
          .where(eq(discussionEntries.id, attachToEntryId as string))
          .then((rows: Array<{ sourceInfo: unknown }>) => rows[0] ?? null);

        if (existing) {
          const existingSourceInfo =
            (existing.sourceInfo as Record<string, unknown>) ?? {};
          await ctx.db
            .update(discussionEntries)
            .set({
              sourceInfo: {
                ...existingSourceInfo,
                artifact: { artifactId, versionId },
              },
            })
            .where(eq(discussionEntries.id, attachToEntryId as string));

          await ctx.db.insert(discussionEntryAttachments).values({
            discussionEntryId: attachToEntryId as string,
            assetId: null,
            artifactId,
          });
        }
      }

      return {
        success: true,
        data: { artifactId, versionId },
        summary: `Created artifact: ${artifactTitle}`,
      };
    },
  };
}
