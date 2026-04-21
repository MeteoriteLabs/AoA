import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { feedbackTargetTypeSchema, upsertIssueFeedbackVoteSchema } from "@paperclipai/shared";
import { feedbackVotesService } from "../services/feedback-votes.js";
import { issueService } from "../services/issues.js";
import { logActivity } from "../services/activity-log.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function feedbackRoutes(db: Db) {
  const router = Router();
  const votes = feedbackVotesService(db);
  const issues = issueService(db);

  // POST /issues/:id/feedback-votes — upsert current user's vote on an issue target.
  // Mirrors Paperclip's POST /issues/:id/feedback-votes (paperclip routes/issues.ts:2529),
  // minus the `allowSharing` flag (feedback-data-sharing toggle is wired in F.4).
  router.post(
    "/issues/:id/feedback-votes",
    validate(upsertIssueFeedbackVoteSchema),
    async (req, res) => {
      const issueId = req.params.id as string;
      const issue = await issues.getById(issueId);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      assertCompanyAccess(req, issue.companyId);
      if (req.actor.type !== "board") {
        res.status(403).json({ error: "Only board users can vote on AI feedback" });
        return;
      }
      const authorUserId = req.actor.userId ?? "local-board";

      const saved = await votes.recordVote({
        companyId: issue.companyId,
        authorUserId,
        issueId: issue.id,
        targetType: req.body.targetType,
        targetId: req.body.targetId,
        vote: req.body.vote,
        reason: req.body.reason,
      });

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.feedback_vote_saved",
        entityType: "issue",
        entityId: issue.id,
        details: {
          identifier: issue.identifier,
          targetType: saved.targetType,
          targetId: saved.targetId,
          vote: saved.vote,
          hasReason: Boolean(saved.reason),
        },
      });

      res.status(201).json(saved);
    },
  );

  // GET /issues/:id/feedback-votes — list the current user's votes for an issue.
  router.get("/issues/:id/feedback-votes", async (req, res) => {
    const issueId = req.params.id as string;
    const issue = await issues.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only board users can view feedback votes" });
      return;
    }
    const authorUserId = req.actor.userId ?? "local-board";
    const rows = await votes.listVotes({
      companyId: issue.companyId,
      issueId: issue.id,
      authorUserId,
    });
    res.json(rows);
  });

  // GET /issues/:id/feedback-votes/summary — aggregate ups/downs (company-scoped).
  router.get("/issues/:id/feedback-votes/summary", async (req, res) => {
    const issueId = req.params.id as string;
    const issue = await issues.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);

    const targetTypeRaw = typeof req.query.targetType === "string" ? req.query.targetType : null;
    const targetId = typeof req.query.targetId === "string" ? req.query.targetId : null;
    if (!targetTypeRaw || !targetId) {
      res.status(400).json({ error: "targetType and targetId query parameters are required" });
      return;
    }
    const parsedType = feedbackTargetTypeSchema.safeParse(targetTypeRaw);
    if (!parsedType.success) {
      res.status(400).json({ error: "Invalid targetType" });
      return;
    }

    const summary = await votes.voteSummaryForTarget({
      companyId: issue.companyId,
      issueId: issue.id,
      targetType: parsedType.data,
      targetId,
    });
    res.json(summary);
  });

  // DELETE /feedback-votes/:voteId — author-only dismissal.
  router.delete("/feedback-votes/:voteId", async (req, res) => {
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only board users can dismiss feedback votes" });
      return;
    }
    const voteId = req.params.voteId as string;
    const authorUserId = req.actor.userId ?? "local-board";
    await votes.dismissVote(voteId, authorUserId);
    res.status(204).send();
  });

  return router;
}
