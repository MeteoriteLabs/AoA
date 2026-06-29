import { Router } from "express";
import type { Db } from "@armyofagents/db";
import {
  addApprovalCommentSchema,
  createApprovalSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
  resubmitApprovalSchema,
} from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  approvalService,
  heartbeatService,
  issueApprovalService,
  logActivity,
  notifyHireApproved,
  secretService,
  trustScoreService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { redactEventPayload } from "../redaction.js";
import { buildApprovalHubEmit, emitHubItem } from "../services/hub-source-producers.js";
import { hubItemsService } from "../services/hub-items.js";

function redactApprovalPayload<T extends { payload: Record<string, unknown> }>(approval: T): T {
  return {
    ...approval,
    payload: redactEventPayload(approval.payload) ?? {},
  };
}

export function approvalRoutes(db: Db) {
  const router = Router();
  const svc = approvalService(db);
  const heartbeat = heartbeatService(db);
  const issueApprovalsSvc = issueApprovalService(db);
  const secretsSvc = secretService(db);
  const trustScoreSvc = trustScoreService(db);
  const strictSecretsMode = process.env.AOA_SECRETS_STRICT_MODE === "true";

  router.get("/companies/:companyId/approvals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const status = req.query.status as string | undefined;
    const result = await svc.list(companyId, status);
    res.json(result.map((approval) => redactApprovalPayload(approval)));
  });

  router.get("/approvals/:id", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    res.json(redactApprovalPayload(approval));
  });

  router.post("/companies/:companyId/approvals", validate(createApprovalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rawIssueIds = req.body.issueIds;
    const issueIds = Array.isArray(rawIssueIds)
      ? rawIssueIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const uniqueIssueIds = Array.from(new Set(issueIds));
    const { issueIds: _issueIds, ...approvalInput } = req.body;
    const normalizedPayload =
      approvalInput.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            companyId,
            approvalInput.payload,
            { strictMode: strictSecretsMode },
          )
        : approvalInput.payload;

    const actor = getActorInfo(req);
    const approval = await db.transaction(async (tx) => {
      const txApprovalSvc = approvalService(tx as unknown as Db);
      const txIssueApprovalsSvc = issueApprovalService(tx as unknown as Db);
      const created = await txApprovalSvc.create(companyId, {
        ...approvalInput,
        payload: normalizedPayload,
        requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
        requestedByAgentId:
          approvalInput.requestedByAgentId ?? (actor.actorType === "agent" ? actor.actorId : null),
        status: "pending",
        decisionNote: null,
        decidedByUserId: null,
        decidedAt: null,
        updatedAt: new Date(),
      });

      if (uniqueIssueIds.length > 0) {
        await txIssueApprovalsSvc.linkManyForApproval(created.id, uniqueIssueIds, {
          agentId: actor.agentId,
          userId: actor.actorType === "user" ? actor.actorId : null,
        });
      }

      await logActivity(tx as unknown as Db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "approval.created",
        entityType: "approval",
        entityId: created.id,
        details: { type: created.type, issueIds: uniqueIssueIds },
      });
      await emitHubItem(tx as unknown as Db, buildApprovalHubEmit(created));
      return created;
    });

    res.status(201).json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/issues", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const issues = await issueApprovalsSvc.listIssuesForApproval(id);
    res.json(issues);
  });

  router.post("/approvals/:id/approve", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const decidedBy = req.actor.userId ?? "local-board";
    const approvalResult = await db.transaction(async (tx) => {
      const txApprovalSvc = approvalService(tx as unknown as Db);
      const txIssueApprovalsSvc = issueApprovalService(tx as unknown as Db);
      const approval = await txApprovalSvc.approve(id, existing.companyId, decidedBy, req.body.decisionNote);
      if (!approval) {
        return { approval: null, linkedIssueIds: [] as string[] };
      }
      const linkedIssues = await txIssueApprovalsSvc.listIssuesForApproval(approval.id);
      const linkedIssueIds = linkedIssues.map((issue) => issue.id);
      await logActivity(tx as unknown as Db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.approved",
        entityType: "approval",
        entityId: approval.id,
        details: {
          type: approval.type,
          requestedByAgentId: approval.requestedByAgentId,
          linkedIssueIds,
        },
      });
      await hubItemsService(tx as unknown as Db).reconcile(approval.companyId, { sourceType: "approval", sourceId: approval.id });
      return { approval, linkedIssueIds };
    });
    const { approval, linkedIssueIds } = approvalResult;
    if (!approval) {
      // Service returned null — companyId WHERE didn't match (TOCTOU or
      // upstream guard bypass). Surface as 404 rather than crashing on
      // downstream property access.
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    const primaryIssueId = linkedIssueIds[0] ?? null;
    const approvedHireAgentId = (approval as typeof approval & { __approvedHireAgentId?: string }).__approvedHireAgentId ?? null;

    // Update trust score when task-related approval is approved (agent work accepted without changes)
    if (approval.requestedByAgentId && linkedIssueIds.length > 0) {
      void trustScoreSvc.updateOnReview(approval.requestedByAgentId, true).catch((err) => {
        logger.warn({ err, agentId: approval.requestedByAgentId }, "failed to update trust score on approve");
      });
    }

    if (approval.requestedByAgentId) {
      try {
        const wakeRun = await heartbeat.wakeup(approval.requestedByAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "approval_approved",
          payload: {
            approvalId: approval.id,
            approvalStatus: approval.status,
            issueId: primaryIssueId,
            issueIds: linkedIssueIds,
          },
          requestedByActorType: "user",
          requestedByActorId: req.actor.userId ?? "board",
          contextSnapshot: {
            source: "approval.approved",
            approvalId: approval.id,
            approvalStatus: approval.status,
            issueId: primaryIssueId,
            issueIds: linkedIssueIds,
            taskId: primaryIssueId,
            wakeReason: "approval_approved",
          },
        });

        await logActivity(db, {
          companyId: approval.companyId,
          actorType: "user",
          actorId: req.actor.userId ?? "board",
          action: "approval.requester_wakeup_queued",
          entityType: "approval",
          entityId: approval.id,
          details: {
            requesterAgentId: approval.requestedByAgentId,
            wakeRunId: wakeRun?.id ?? null,
            linkedIssueIds,
          },
        });
      } catch (err) {
        logger.warn(
          {
            err,
            approvalId: approval.id,
            requestedByAgentId: approval.requestedByAgentId,
          },
          "failed to queue requester wakeup after approval",
        );
        await logActivity(db, {
          companyId: approval.companyId,
          actorType: "user",
          actorId: req.actor.userId ?? "board",
          action: "approval.requester_wakeup_failed",
          entityType: "approval",
          entityId: approval.id,
          details: {
            requesterAgentId: approval.requestedByAgentId,
            linkedIssueIds,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
    if (approvedHireAgentId) {
      void notifyHireApproved(db, {
        companyId: approval.companyId,
        agentId: approvedHireAgentId,
        source: "approval",
        sourceId: approval.id,
        approvedAt: approval.decidedAt ?? new Date(),
      }).catch(() => {});
    }
    res.json(redactApprovalPayload(approval));
  });

  router.post("/approvals/:id/reject", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const decidedBy = req.actor.userId ?? "local-board";
    const approval = await db.transaction(async (tx) => {
      const txApprovalSvc = approvalService(tx as unknown as Db);
      const rejected = await txApprovalSvc.reject(id, existing.companyId, decidedBy, req.body.decisionNote);
      if (!rejected) return null;
      await logActivity(tx as unknown as Db, {
        companyId: rejected.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.rejected",
        entityType: "approval",
        entityId: rejected.id,
        details: { type: rejected.type },
      });
      await hubItemsService(tx as unknown as Db).reconcile(rejected.companyId, { sourceType: "approval", sourceId: rejected.id });
      return rejected;
    });
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }

    // Update trust score when task-related approval is rejected (agent work not accepted)
    if (approval.requestedByAgentId) {
      const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
      if (linkedIssues.length > 0) {
        void trustScoreSvc.updateOnReview(approval.requestedByAgentId, false).catch((err) => {
          logger.warn({ err, agentId: approval.requestedByAgentId }, "failed to update trust score on reject");
        });
      }
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post(
    "/approvals/:id/request-revision",
    validate(requestApprovalRevisionSchema),
    async (req, res) => {
      assertBoard(req);
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Approval not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);

      const decidedBy = req.actor.userId ?? "local-board";
      const approval = await db.transaction(async (tx) => {
        const txApprovalSvc = approvalService(tx as unknown as Db);
        const revised = await txApprovalSvc.requestRevision(
          id,
          existing.companyId,
          decidedBy,
          req.body.decisionNote,
        );
        if (!revised) return null;
        await logActivity(tx as unknown as Db, {
          companyId: revised.companyId,
          actorType: "user",
          actorId: req.actor.userId ?? "board",
          action: "approval.revision_requested",
          entityType: "approval",
          entityId: revised.id,
          details: { type: revised.type },
        });
        await emitHubItem(tx as unknown as Db, buildApprovalHubEmit(revised));
        return revised;
      });
      if (!approval) {
        res.status(404).json({ error: "Approval not found" });
        return;
      }

      // Update trust score when revision requested (agent work not accepted as-is)
      if (approval.requestedByAgentId) {
        const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
        if (linkedIssues.length > 0) {
          void trustScoreSvc.updateOnReview(approval.requestedByAgentId, false).catch((err) => {
            logger.warn({ err, agentId: approval.requestedByAgentId }, "failed to update trust score on revision request");
          });
        }
      }

      res.json(redactApprovalPayload(approval));
    },
  );

  router.post("/approvals/:id/resubmit", validate(resubmitApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    if (req.actor.type === "agent" && req.actor.agentId !== existing.requestedByAgentId) {
      res.status(403).json({ error: "Only requesting agent can resubmit this approval" });
      return;
    }

    const normalizedPayload = req.body.payload
      ? existing.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            existing.companyId,
            req.body.payload,
            { strictMode: strictSecretsMode },
          )
        : req.body.payload
      : undefined;
    const actor = getActorInfo(req);
    const approval = await db.transaction(async (tx) => {
      const txApprovalSvc = approvalService(tx as unknown as Db);
      const resubmitted = await txApprovalSvc.resubmit(id, existing.companyId, normalizedPayload);
      if (!resubmitted) return null;
      await logActivity(tx as unknown as Db, {
        companyId: resubmitted.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "approval.resubmitted",
        entityType: "approval",
        entityId: resubmitted.id,
        details: { type: resubmitted.type },
      });
      await emitHubItem(tx as unknown as Db, buildApprovalHubEmit(resubmitted));
      return resubmitted;
    });
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    res.json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/comments", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const comments = await svc.listComments(id);
    res.json(comments);
  });

  router.post("/approvals/:id/comments", validate(addApprovalCommentSchema), async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const actor = getActorInfo(req);
    const comment = await svc.addComment(id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.comment_added",
      entityType: "approval",
      entityId: approval.id,
      details: { commentId: comment.id },
    });

    res.status(201).json(comment);
  });

  return router;
}
