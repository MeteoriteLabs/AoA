import { eq } from "drizzle-orm";
import { discussionEntries } from "@armyofagents/db";
import type { AgentTool } from "../types.js";
import { buildArtifactCandidateIdempotencyKey } from "./thread-action-keys.js";

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
      const { title, type, content, fileRef, discussionId, attachToEntryId } =
        (params ?? {}) as Record<string, unknown>;

      if (ctx.discussionRunMode === "controller_action_gate") {
        if (!ctx.runId) {
          return {
            success: false,
            data: null,
            summary: "Cannot queue artifact candidate without a run id",
            error: "MISSING_RUN_ID",
          };
        }
        const threadId = typeof discussionId === "string" && discussionId.length > 0
          ? discussionId
          : undefined;
        if (!threadId) {
          return {
            success: false,
            data: null,
            summary: "discussionId is required in action-gated discussion artifact context",
            error: "INVALID_PARAMS",
          };
        }

        const { threadAgentActionService } = await import("../../thread-agent-actions.js");
        const action = await threadAgentActionService(ctx.db).proposeThreadAction({
          companyId: ctx.companyId,
          threadId,
          runId: ctx.runId,
          agentId: ctx.agentId ?? null,
          actionType: "create_artifact_candidate",
          payload: {
            title: title as string,
            artifactType: (type as string) ?? "document",
            content: (content as string) ?? null,
            fileRef: (fileRef as string) ?? null,
            discussionId: threadId,
            attachToEntryId: (attachToEntryId as string) ?? null,
          },
          idempotencyKey: buildArtifactCandidateIdempotencyKey({
            threadId,
            agentId: ctx.agentId,
            title: title as string,
            content: (content as string) ?? null,
            fileRef: (fileRef as string) ?? null,
            turnAnchor:
              ctx.threadFreshness?.latestHumanSeq != null
                ? String(ctx.threadFreshness.latestHumanSeq)
                : null,
          }),
          freshness: ctx.threadFreshness ?? {},
        }) as { id?: string };

        return {
          success: true,
          data: { actionId: action.id, queued: true },
          summary: "Queued artifact candidate for freshness-checked scope commit",
        };
      }

      const result = await ctx.services.artifacts.create(
        ctx.companyId,
        ctx.agentId ?? "aoa-agent",
        {
          title: title as string,
          type: (type as string) ?? "document",
          source: "agent",
          content: (content as string) ?? null,
          fileUrl: (fileRef as string) ?? null,
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
        }
      }

      return {
        success: true,
        data: { artifactId, versionId },
        summary: `Created artifact: ${title as string}`,
      };
    },
  };
}
