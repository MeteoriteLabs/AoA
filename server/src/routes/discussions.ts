import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createDiscussionSchema,
  createDiscussionEntrySchema,
  updateDiscussionSchema,
  approveItemsSchema,
  createAnnotationSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { discussionService, logActivity } from "../services/index.js";
import { HttpError } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";

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
          const { discussionExtractedItems } = await import("@paperclipai/db");

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

  return router;
}
