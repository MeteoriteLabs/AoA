import { Router } from "express";
import type { Db } from "@armyofagents/db";
import { eq, and } from "drizzle-orm";
import { discussions, threadInboxItems } from "@armyofagents/db";
import { z } from "zod";
import {
  createDiscussionSchema,
  createDiscussionEntrySchema,
  updateDiscussionSchema,
  approveItemsSchema,
  createAnnotationSchema,
  THREAD_PHASES,
  THREAD_PARTICIPANT_PRINCIPAL_TYPES,
  THREAD_PARTICIPANT_ROLES,
  THREAD_LINK_KINDS,
} from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { discussionService, logActivity, permissionService } from "../services/index.js";
import { HttpError } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";
import { threadService, parseMentions, processMentions } from "../services/threads.js";
import type { Actor } from "../services/threads.js";

// ── Thread lifecycle request-body schemas ────────────────────────────────────
const phaseSchema = z.object({ phase: z.enum(THREAD_PHASES) });
const transferSchema = z.object({ toUserId: z.string().min(1) });
const addParticipantSchema = z.object({
  principalType: z.enum(THREAD_PARTICIPANT_PRINCIPAL_TYPES),
  principalId: z.string().min(1),
  role: z.enum(THREAD_PARTICIPANT_ROLES),
});

export function discussionRoutes(db: Db) {
  const router = Router();
  const svc = discussionService(db);

  // 1.1 List discussions
  router.get("/companies/:companyId/discussions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const filters = {
      status: req.query.status as string | undefined,
      scopeType: req.query.scopeType as string | undefined,
      scopeId: req.query.scopeId as string | undefined,
      hasPendingItems:
        req.query.hasPendingItems === "true"
          ? true
          : req.query.hasPendingItems === "false"
            ? false
            : undefined,
      inputType: req.query.inputType as string | undefined,
    };

    const result = await svc.list(companyId, filters);
    res.json({
      discussions: result,
      total: result.length,
      limit: 50,
      offset: 0,
    });
  });

  // 1.2 Get discussion detail
  router.get(
    "/companies/:companyId/discussions/:discussionId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);

      const discussion = await svc.getById(companyId, discussionId);
      if (!discussion) {
        res.status(404).json({ error: "Discussion not found" });
        return;
      }
      res.json(discussion);
    },
  );

  // 1.3 Create discussion
  router.post(
    "/companies/:companyId/discussions",
    validate(createDiscussionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      const actor = getActorInfo(req);
      try {
        const discussion = await svc.create(companyId, req.body, actor.actorId);
        res.status(201).json(discussion);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.4 Update discussion
  router.patch(
    "/companies/:companyId/discussions/:discussionId",
    validate(updateDiscussionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      try {
        const updated = await svc.update(companyId, discussionId, req.body);
        if (!updated) {
          res.status(404).json({ error: "Discussion not found" });
          return;
        }

        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "discussion.updated",
          entityType: "discussion",
          entityId: discussionId,
          details: req.body,
        });

        res.json(updated);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.5 Add entry to discussion
  router.post(
    "/companies/:companyId/discussions/:discussionId/entries",
    validate(createDiscussionEntrySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      const actor = getActorInfo(req);
      try {
        const entry = await svc.addEntry(
          companyId,
          discussionId,
          req.body,
          actor.actorId,
        );

        // Process @mentions in the entry text (fire-and-forget; errors must not
        // fail the request since the entry is already committed).
        const rawContent: string = (req.body as { rawContent?: string }).rawContent ?? "";
        const mentions = parseMentions(rawContent);
        if (mentions.length > 0) {
          processMentions(db, companyId, discussionId, entry.id, mentions).catch(
            (err) => console.error("[threads] processMentions error:", err),
          );
        }

        res.status(201).json(entry);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.6 Reprocess entry — founder only
  router.post(
    "/companies/:companyId/discussions/:discussionId/entries/:entryId/reprocess",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      const entryId = req.params.entryId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      try {
        const result = await svc.reprocessEntry(companyId, entryId);

        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "discussion.entry.reprocessed",
          entityType: "discussion_entry",
          entityId: entryId,
          details: { discussionId },
        });

        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.6b Reprocess all entries in a discussion — founder only
  router.post(
    "/companies/:companyId/discussions/:discussionId/reprocess",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      try {
        const result = await svc.reprocessAllEntries(companyId, discussionId);

        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "discussion.reprocessed",
          entityType: "discussion",
          entityId: discussionId,
          details: result,
        });

        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.7 Update extracted item
  router.patch(
    "/companies/:companyId/discussions/:discussionId/entries/:entryId/items/:itemId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      const itemId = req.params.itemId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      try {
        const updated = await svc.updateItem(companyId, itemId, req.body);

        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "discussion.item.updated",
          entityType: "discussion_extracted_item",
          entityId: itemId,
          details: { discussionId, fields: Object.keys(req.body) },
        });

        res.json(updated);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.8 Approve discussion items — founder only
  router.post(
    "/companies/:companyId/discussions/:discussionId/approve",
    validate(approveItemsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const actor = getActorInfo(req);

      type ItemAction = {
        itemId: string;
        action: string;
        edits?: Record<string, unknown>;
      };
      const items = req.body.items as ItemAction[];
      const dependencies = req.body.dependencies as
        | Array<{ dependentItemId: string; dependencyItemId: string }>
        | undefined;

      try {
        // Step 1: Apply edits to items with action="edited" before approval
        const editedItems = items.filter((i) => i.action === "edited" && i.edits);
        for (const item of editedItems) {
          await svc.updateItem(companyId, item.itemId, item.edits!);
        }

        // Step 2: Approve items (approved + edited both get approved)
        const approveIds = items
          .filter((i) => i.action === "approved" || i.action === "edited")
          .map((i) => i.itemId);

        const rejectIds = items
          .filter((i) => i.action === "rejected")
          .map((i) => i.itemId);

        let approveResult = {
          createdTaskIds: [] as string[],
          createdMemoryIds: [] as string[],
          approvedCount: 0,
        };
        let rejectResult = { rejectedCount: 0 };

        if (approveIds.length > 0) {
          approveResult = await svc.approveItems(
            companyId,
            discussionId,
            approveIds,
            actor.actorId,
          );
        }

        if (rejectIds.length > 0) {
          rejectResult = await svc.rejectItems(
            companyId,
            discussionId,
            rejectIds,
            actor.actorId,
          );
        }

        // Step 3: Create task dependencies if specified
        // Dependencies reference itemIds — we need to map them to the created taskIds.
        // The approveItems service returns createdTaskIds in order, but we need the
        // item→task mapping. For now, we look up the resultTaskId from the items.
        if (dependencies && dependencies.length > 0 && approveResult.createdTaskIds.length > 0) {
          const { dependencyService } = await import("../services/index.js");
          const depSvc = dependencyService(db);

          // Fetch the item→task mapping for all approved items
          const { eq, inArray } = await import("drizzle-orm");
          const { discussionExtractedItems } = await import("@armyofagents/db");

          const allItemIds = dependencies.flatMap((d) => [
            d.dependentItemId,
            d.dependencyItemId,
          ]);
          const uniqueItemIds = [...new Set(allItemIds)];

          const itemTaskMap = await db
            .select({
              id: discussionExtractedItems.id,
              resultTaskId: discussionExtractedItems.resultTaskId,
            })
            .from(discussionExtractedItems)
            .where(inArray(discussionExtractedItems.id, uniqueItemIds));

          const taskMap = new Map(
            itemTaskMap
              .filter((r) => r.resultTaskId != null)
              .map((r) => [r.id, r.resultTaskId!]),
          );

          for (const dep of dependencies) {
            const dependentTaskId = taskMap.get(dep.dependentItemId);
            const dependencyTaskId = taskMap.get(dep.dependencyItemId);
            if (dependentTaskId && dependencyTaskId) {
              await depSvc.addDependency(
                companyId,
                dependentTaskId,
                dependencyTaskId,
              );
            }
          }
        }

        res.json({
          approved: approveResult.approvedCount,
          rejected: rejectResult.rejectedCount,
          tasksCreated: approveResult.createdTaskIds,
          memoryItemsCreated: approveResult.createdMemoryIds,
        });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.9 Add annotation
  router.post(
    "/companies/:companyId/discussions/:discussionId/entries/:entryId/annotations",
    validate(createAnnotationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const entryId = req.params.entryId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      const actor = getActorInfo(req);
      try {
        const annotation = await svc.addAnnotation(
          companyId,
          entryId,
          req.body,
          actor.actorId,
        );
        res.status(201).json(annotation);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // 1.10 Link entry to different discussion — founder only
  router.post(
    "/companies/:companyId/discussions/link",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const { entryId, targetDiscussionId } = req.body;
      if (!entryId || !targetDiscussionId) {
        res
          .status(400)
          .json({ error: "entryId and targetDiscussionId are required" });
        return;
      }

      try {
        const result = await svc.linkEntry(
          companyId,
          entryId,
          targetDiscussionId,
        );

        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "discussion.entry.linked",
          entityType: "discussion_entry",
          entityId: entryId,
          details: {
            sourceDiscussionId: result.sourceDiscussionId,
            targetDiscussionId: result.targetDiscussionId,
          },
        });

        res.json({
          entryId: result.entryId,
          previousDiscussionId: result.sourceDiscussionId,
          newDiscussionId: result.targetDiscussionId,
        });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // ── Thread lifecycle routes (Threads v1 Plan 2) ───────────────────────────

  /**
   * Build an Actor from request context.
   * Role is resolved from permissionService for non-founders.
   * In local_trusted mode (source=local_implicit) or instance admins,
   * the effective role defaults to "founder".
   */
  async function buildActor(req: Parameters<typeof getActorInfo>[0], companyId: string): Promise<Actor> {
    const info = getActorInfo(req);
    const isHuman = req.actor.type === "board";

    // local_implicit or instance admin → treat as founder
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      return { userId: info.actorId, role: "founder", isHuman };
    }
    if (req.actor.type === "agent") {
      return { userId: info.actorId, role: "team_member", isHuman: false };
    }

    const perms = permissionService(db);
    const role = await perms.getEffectiveRole(companyId, info.actorId);
    return { userId: info.actorId, role, isHuman };
  }

  const tSvc = threadService(db);

  // T.1 Advance thread phase
  router.patch(
    "/companies/:companyId/discussions/:discussionId/phase",
    validate(phaseSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);
      try {
        const result = await tSvc.advancePhase(companyId, discussionId, req.body.phase, actor);
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // T.2 Claim a thread
  router.post(
    "/companies/:companyId/discussions/:discussionId/claim",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);
      try {
        const result = await tSvc.claim(companyId, discussionId, actor);
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // T.3 Transfer thread ownership
  router.post(
    "/companies/:companyId/discussions/:discussionId/transfer",
    validate(transferSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);
      try {
        const result = await tSvc.transferOwnership(companyId, discussionId, req.body.toUserId, actor);
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // T.4 Add participant to thread
  router.post(
    "/companies/:companyId/discussions/:discussionId/participants",
    validate(addParticipantSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);
      try {
        const result = await tSvc.addParticipant(companyId, discussionId, req.body, actor);
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // T.5 Promote thread to goal
  router.post(
    "/companies/:companyId/discussions/:discussionId/promote-to-goal",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");
      const actor = await buildActor(req, companyId);
      try {
        const result = await tSvc.promoteToGoal(companyId, discussionId, req.body, actor);
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // T.6 Assign scope items to tasks
  router.post(
    "/companies/:companyId/discussions/:discussionId/assign",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");
      const actor = await buildActor(req, companyId);
      try {
        const result = await tSvc.assignScopeItems(companyId, discussionId, actor);
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // Plan 3 Task 8: thread-level crew kill-switch.
  // POST /companies/:companyId/discussions/:discussionId/crew/pause
  // POST /companies/:companyId/discussions/:discussionId/crew/resume
  // Role: founder (only founder can halt crew for a thread).
  router.post(
    "/companies/:companyId/discussions/:discussionId/crew/pause",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");
      await db.update(discussions).set({ crewPaused: true, updatedAt: new Date() }).where(eq(discussions.id, discussionId));
      res.json({ crewPaused: true });
    },
  );

  router.post(
    "/companies/:companyId/discussions/:discussionId/crew/resume",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");
      await db.update(discussions).set({ crewPaused: false, updatedAt: new Date() }).where(eq(discussions.id, discussionId));
      res.json({ crewPaused: false });
    },
  );

  // ── Plan 5: Inbox/Unlisted lane endpoints ─────────────────────────────────

  // T.I1 List pending inbox items (the Unlisted lane)
  router.get(
    "/companies/:companyId/discussions/inbox",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      const { desc } = await import("drizzle-orm");

      const items = await db
        .select()
        .from(threadInboxItems)
        .where(
          and(
            eq(threadInboxItems.companyId, companyId),
            eq(threadInboxItems.status, "pending"),
          ),
        )
        .orderBy(desc(threadInboxItems.createdAt));

      res.json({ items, total: items.length });
    },
  );

  // T.I2 Triage an inbox item — attach, dismiss, or promote to thread
  const triageBodySchema = z.object({
    action: z.enum(["attach", "dismiss", "make_thread"]),
    threadId: z.string().uuid().optional(),
  }).refine(
    (data) => data.action !== "attach" || !!data.threadId,
    { message: "threadId is required when action is attach", path: ["threadId"] },
  );

  router.post(
    "/companies/:companyId/discussions/inbox/:itemId/triage",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const itemId = req.params.itemId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder", "team_lead");

      const parsed = triageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
        return;
      }

      const { action, threadId } = parsed.data;

      // Fetch the item to validate it belongs to this company
      const [item] = await db
        .select()
        .from(threadInboxItems)
        .where(
          and(
            eq(threadInboxItems.id, itemId),
            eq(threadInboxItems.companyId, companyId),
          ),
        );

      if (!item) {
        res.status(404).json({ error: "Inbox item not found" });
        return;
      }

      // Fix C3: Prevent re-triaging already-processed items
      if (item.status !== "pending") {
        res.status(409).json({ error: "Inbox item has already been triaged" });
        return;
      }

      const actor = getActorInfo(req);

      if (action === "dismiss") {
        await db
          .update(threadInboxItems)
          .set({ status: "dismissed" })
          .where(eq(threadInboxItems.id, itemId));

        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "thread.inbox_item.dismissed",
          entityType: "thread_inbox_item",
          entityId: itemId,
          details: {},
        });

        res.json({ itemId, status: "dismissed" });
        return;
      }

      if (action === "attach") {
        // Fix C2: Validate target thread belongs to same company
        const [targetThread] = await db
          .select({ id: discussions.id })
          .from(discussions)
          .where(and(eq(discussions.id, threadId!), eq(discussions.companyId, companyId)));
        if (!targetThread) {
          res.status(404).json({ error: "Thread not found" });
          return;
        }

        // Attach inbox item to an existing thread (mark as attached)
        await db
          .update(threadInboxItems)
          .set({ status: "attached", suggestedThreadId: threadId })
          .where(eq(threadInboxItems.id, itemId));

        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "thread.inbox_item.attached",
          entityType: "thread_inbox_item",
          entityId: itemId,
          details: { threadId },
        });

        res.json({ itemId, status: "attached", threadId });
        return;
      }

      if (action === "make_thread") {
        // Fix C1: Wrap create + status update in a transaction to prevent orphaned
        // discussions if the process crashes between the two DB calls.
        const newDiscussion = await db.transaction(async (tx) => {
          const txSvc = discussionService(tx as unknown as typeof db);
          const created = await txSvc.create(
            companyId,
            {
              title: item.rawContent.slice(0, 80).replace(/\n/g, " ") || "New thread",
            },
            actor.actorId,
          );

          // Mark inbox item as attached to the new thread within the same transaction
          await tx
            .update(threadInboxItems)
            .set({ status: "attached", suggestedThreadId: created.id })
            .where(eq(threadInboxItems.id, itemId));

          return created;
        });

        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "thread.inbox_item.promoted",
          entityType: "thread_inbox_item",
          entityId: itemId,
          details: { newDiscussionId: newDiscussion.id },
        });

        res.status(201).json({ itemId, status: "attached", threadId: newDiscussion.id, thread: newDiscussion });
        return;
      }

      // Should never reach here — zod enum guards all actions
      res.status(400).json({ error: "Unknown triage action" });
    },
  );

  // ── Plan 6: Spin-off thread ───────────────────────────────────────────────

  const spinOffBodySchema = z.object({
    scopeItemId: z.string().uuid(),
    title: z.string().optional(),
  });

  // T.SO1 Spin off a child thread from a scope item
  router.post(
    "/companies/:companyId/discussions/:discussionId/spin-off",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);

      const parsed = spinOffBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
        return;
      }

      try {
        const result = await tSvc.spinOff(companyId, discussionId, parsed.data, actor);
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // ── Plan 6: Scope-item dependencies ──────────────────────────────────────

  const scopeDepBodySchema = z.object({
    blockerItemId: z.string().uuid(),
    blockedItemId: z.string().uuid(),
  });

  // T.SD1 Add a scope-item dependency
  router.post(
    "/companies/:companyId/discussions/:discussionId/scope-deps",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");
      const actor = await buildActor(req, companyId);

      const parsed = scopeDepBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
        return;
      }

      try {
        const result = await tSvc.addScopeItemDependency(companyId, discussionId, parsed.data, actor);
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // T.SD2 Graduate scope-item deps → task_dependencies
  router.post(
    "/companies/:companyId/discussions/:discussionId/scope-deps/graduate",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const discussionId = req.params.discussionId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");
      const actor = await buildActor(req, companyId);

      try {
        // Route handler performs the two-step lookup and passes pre-computed rows
        // to the service (avoids complex aliased joins in the service layer).
        const { eq: drizzleEq, inArray: drizzleInArray } = await import("drizzle-orm");
        const { scopeItemDependencies, discussionExtractedItems, discussionEntries } =
          await import("@armyofagents/db");

        // Step 1: get all entry IDs for this discussion
        const entryIds = await db
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(drizzleEq(discussionEntries.discussionId, discussionId))
          .then((rows) => rows.map((r) => r.id));

        if (entryIds.length === 0) {
          res.json({ graduated: 0 });
          return;
        }

        // Step 2: get all scope deps for items in this discussion
        const allItemIds = await db
          .select({ id: discussionExtractedItems.id, resultTaskId: discussionExtractedItems.resultTaskId })
          .from(discussionExtractedItems)
          .where(drizzleInArray(discussionExtractedItems.discussionEntryId, entryIds))
          .then((rows) => rows);

        const itemTaskMap = new Map(allItemIds.map((r) => [r.id, r.resultTaskId]));
        const itemIdList = allItemIds.map((r) => r.id);

        if (itemIdList.length === 0) {
          res.json({ graduated: 0 });
          return;
        }

        const sidRows = await db
          .select({ id: scopeItemDependencies.id, blockerItemId: scopeItemDependencies.blockerItemId, blockedItemId: scopeItemDependencies.blockedItemId })
          .from(scopeItemDependencies)
          .where(drizzleInArray(scopeItemDependencies.blockerItemId, itemIdList))
          .then((rows) => rows);

        // Build pre-computed rows with both sides' resultTaskIds
        const precomputed = sidRows.map((row) => ({
          id: row.id,
          blockerItemId: row.blockerItemId,
          blockedItemId: row.blockedItemId,
          blockerResultTaskId: itemTaskMap.get(row.blockerItemId) ?? null,
          blockedResultTaskId: itemTaskMap.get(row.blockedItemId) ?? null,
        }));

        const result = await tSvc.graduateScopeItemDependencies(
          companyId, discussionId, actor, precomputed,
        );
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // ── Plan 6: Per-item routing ───────────────────────────────────────────────

  const routingBodySchema = z.object({
    departmentId: z.string().uuid().optional(),
    assigneeAgentId: z.string().uuid().optional(),
    assigneeUserId: z.string().optional(),
  });

  // T.R1 PATCH per-item routing (service-level guard; hide-don't-403)
  router.patch(
    "/companies/:companyId/discussions/:discussionId/items/:itemId/routing",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const itemId = req.params.itemId as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);

      const parsed = routingBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
        return;
      }

      try {
        const result = await tSvc.routeItem(companyId, itemId, parsed.data, actor);
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // ── Plan 6: Cross-thread links ────────────────────────────────────────────

  const createLinkSchema = z.object({
    toThreadId: z.string().uuid(),
    kind: z.enum(THREAD_LINK_KINDS),
  });

  // T.L1 Create a cross-thread link
  router.post(
    "/companies/:companyId/discussions/:fromId/links",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const fromId = req.params.fromId as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);

      const parsed = createLinkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
        return;
      }

      try {
        const link = await tSvc.createLink(companyId, fromId, parsed.data.toThreadId, parsed.data.kind, actor);
        res.status(201).json(link);
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  // T.L2 List cross-thread links for a thread (bidirectional)
  router.get(
    "/companies/:companyId/discussions/:id/links",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = await buildActor(req, companyId);

      try {
        const links = await tSvc.listLinks(companyId, id, actor);
        res.json({ links, total: links.length });
      } catch (err) {
        if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
        throw err;
      }
    },
  );

  return router;
}
