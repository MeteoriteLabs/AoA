// server/src/routes/internal-agent.ts
// Internal Agent HTTP endpoints — T13a
import { Router } from "express";
import { z } from "zod";
import { and, eq, asc, desc, gte, lte, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  internalAgentConfig,
  internalAgentConversations,
  internalAgentMessages,
  internalAgentRuns,
  internalAgentReminders,
} from "@armyofagents/db";
import { validate } from "../middleware/index.js";
import { assertRole } from "../middleware/rbac.js";
import { internalAgentChatLimiter } from "../middleware/rate-limit.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { HttpError, badRequest, notFound } from "../errors.js";
import { agentLoopService } from "../services/internal-agent/agent-loop.js";
import { permissionService } from "../services/permissions.js";
import type { UserRole } from "@armyofagents/shared";

// ── Schemas ──────────────────────────────────────────────────────────────────

const chatMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  pageContext: z.string().optional(),
});

const confirmActionSchema = z.object({
  confirmId: z.string().uuid(),
  approved: z.boolean(),
});

const updateConfigSchema = z.object({
  executionMode: z.enum(["api", "cli"]).optional(),
  provider: z.enum(["anthropic", "openai", "google"]).optional(),
  model: z.string().optional(),
  cliTool: z.string().nullable().optional(),
  autonomyLevel: z.number().int().min(0).max(0).optional(), // v2.5: only 0
  enabledCapabilities: z.array(z.string()).optional(),
  notificationPreference: z.enum(["silent", "digest", "realtime"]).optional(),
  contextTokenBudget: z.number().int().min(2000).max(32000).optional(),
  budgetMonthlyCents: z.number().int().min(0).nullable().optional(),
  proactiveIntervalMinutes: z.number().int().min(30).max(1440).optional(),
  cheapModel: z.string().nullable().optional(),
});

const cancelReminderSchema = z.object({
  status: z.literal("cancelled"),
});

// ── Route factory ────────────────────────────────────────────────────────────

export function internalAgentRoutes(db: Db) {
  const router = Router();

  // ── 2.1 Send Message (SSE Streaming) ─────────────────────────────────
  // Sprint 4 S4-F: rate-limit chat (LLM-billed). 60 requests per minute per
  // actor. The route is the chat endpoint and the SSE-streaming variant —
  // it's a single route, so one limiter covers both.
  router.post(
    "/companies/:companyId/internal-agent/chat",
    internalAgentChatLimiter,
    validate(chatMessageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      // Set SSE headers (gotchas 5.2 — POST-based, not EventSource)
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Create a run record for observability in /runs UI. Sprint 2A (Decision
      // #91) — CLI-mode doesn't populate tokenUsage / costCents / toolsCalled
      // per-turn; those stay null on this record until the team-under-Commander
      // work lands. The record is still useful for "did Commander run?" audit.
      const [run] = await db
        .insert(internalAgentRuns)
        .values({
          companyId,
          triggerType: "conversation",
          triggerSource: "user_message",
          status: "running",
          userId: actor.actorId,
        })
        .returning();

      // Signal "thinking" to the UI while we kick off the dispatch.
      res.write(
        `event: thinking\ndata: ${JSON.stringify({ status: "processing" })}\n\n`,
      );

      let finalSummary:
        | {
            runId: string;
            toolsCalled: string[];
            durationMs: number;
            costCents: number;
            tokenUsage: { inputTokens: number; outputTokens: number };
          }
        | null = null;

      try {
        const svc = agentLoopService(db);
        // C13 fix: look up the caller's actual effective role and
        // capability set instead of hardcoding "founder". Special-case
        // local_implicit actors (loopback in local_trusted mode) — they
        // bypass RBAC elsewhere in the codebase and have no userRoles row,
        // so getEffectiveRole would return "team_member" by default.
        const isLocalImplicit =
          req.actor.type === "board" && req.actor.source === "local_implicit";
        const isInstanceAdmin =
          req.actor.type === "board" && req.actor.isInstanceAdmin === true;
        let userRole: UserRole;
        // Match middleware/rbac.ts:36-39 bypass semantics: local_implicit (local_trusted
        // mode) and isInstanceAdmin actors get founder-equivalent access. Note: any
        // future audit log that records userRole per-tool-call should preserve the
        // actor's actual identity (the userId is unchanged here) — the coercion to
        // "founder" applies only to the role string used for tool-dispatch authorization.
        if (isLocalImplicit || isInstanceAdmin) {
          userRole = "founder";
        } else {
          const role = await permissionService(db).getEffectiveRole(
            companyId,
            actor.actorId,
          );
          // getEffectiveRole defaults to "team_member" when no role is
          // assigned; we mirror that fallback here for clarity.
          userRole = role ?? "team_member";
        }

        // Look up the company's enabled capabilities. Empty array if no
        // config row exists — chat will surface "not configured" further
        // down anyway.
        const cfgRows = await db
          .select({ enabledCapabilities: internalAgentConfig.enabledCapabilities })
          .from(internalAgentConfig)
          .where(eq(internalAgentConfig.companyId, companyId));
        const enabledCapabilities = (cfgRows[0]?.enabledCapabilities as
          | string[]
          | null) ?? [];

        const stream = svc.chat({
          companyId,
          userId: actor.actorId,
          userRole,
          enabledCapabilities,
          content: req.body.message,
          pageContext: req.body.pageContext ?? undefined,
        });

        for await (const chunk of stream) {
          switch (chunk.type) {
            case "text":
              res.write(
                `event: content\ndata: ${JSON.stringify({ text: chunk.delta })}\n\n`,
              );
              break;
            case "tool_call":
              res.write(
                `event: tool_call\ndata: ${JSON.stringify({ name: chunk.name })}\n\n`,
              );
              break;
            case "tool_result":
              res.write(
                `event: tool_result\ndata: ${JSON.stringify({ name: chunk.name })}\n\n`,
              );
              break;
            case "action_confirmation":
              // CLI-mode doesn't yield these today (no per-tool confirmations);
              // the branch stays here to be explicit about the mapping.
              res.write(
                `event: action_confirm\ndata: ${JSON.stringify({
                  confirmId: chunk.runId,
                  action: chunk.toolName,
                  description: chunk.toolName,
                })}\n\n`,
              );
              break;
            case "error":
              res.write(
                `event: error\ndata: ${JSON.stringify({ code: "INTERNAL", message: chunk.message })}\n\n`,
              );
              break;
            case "done":
              finalSummary = chunk.summary;
              break;
          }
        }

        // Mark run completed
        await db
          .update(internalAgentRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
            durationMs: finalSummary?.durationMs ?? null,
            costCents: finalSummary?.costCents ?? null,
            tokenUsage: finalSummary?.tokenUsage ?? null,
          })
          .where(eq(internalAgentRuns.id, run.id));

        // Send done event. For CLI mode the numeric fields are zeros until
        // run tracking is re-introduced; the shape matches what the UI expects.
        res.write(
          `event: done\ndata: ${JSON.stringify({
            messageId: run.id,
            runId: run.id,
            tokenUsage: finalSummary?.tokenUsage ?? { input: 0, output: 0 },
            costCents: finalSummary?.costCents ?? 0,
          })}\n\n`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        res.write(
          `event: error\ndata: ${JSON.stringify({ code: "INTERNAL", message })}\n\n`,
        );

        // Mark run failed if it hasn't been completed already
        await db
          .update(internalAgentRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorMessage: message,
          })
          .where(eq(internalAgentRuns.id, run.id))
          .catch(() => {});
      }

      res.end();
    },
  );

  // ── 2.2 Confirm Agent Action ─────────────────────────────────────────
  router.post(
    "/companies/:companyId/internal-agent/confirm",
    validate(confirmActionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      // Placeholder: confirm/reject pending action by confirmId
      // Real implementation would look up pending confirmation and execute/reject
      res.json({
        confirmId: req.body.confirmId,
        result: "Action confirmation recorded",
        entityType: null,
        entityId: null,
      });
    },
  );

  // ── 2.3 Get Conversation ─────────────────────────────────────────────
  router.get(
    "/companies/:companyId/internal-agent/conversation",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      // Find active conversation
      const conversations = await db
        .select()
        .from(internalAgentConversations)
        .where(
          and(
            eq(internalAgentConversations.companyId, companyId),
            eq(internalAgentConversations.userId, actor.actorId),
            eq(internalAgentConversations.status, "active"),
          ),
        );

      if (conversations.length === 0) {
        res.json({
          conversation: null,
          messages: [],
          summarizedContext: null,
          total: 0,
          limit,
          offset,
        });
        return;
      }

      const conversation = conversations[0];

      // Fetch messages
      const messages = await db
        .select()
        .from(internalAgentMessages)
        .where(eq(internalAgentMessages.conversationId, conversation.id))
        .orderBy(asc(internalAgentMessages.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({
        conversation: {
          id: conversation.id,
          status: conversation.status,
          messageCount: conversation.messageCount,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
        messages,
        summarizedContext: conversation.summarizedContext,
        total: conversation.messageCount,
        limit,
        offset,
      });
    },
  );

  // ── 2.4 Reset Conversation ───────────────────────────────────────────
  router.delete(
    "/companies/:companyId/internal-agent/conversation",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      // Archive current conversation
      const conversations = await db
        .select()
        .from(internalAgentConversations)
        .where(
          and(
            eq(internalAgentConversations.companyId, companyId),
            eq(internalAgentConversations.userId, actor.actorId),
            eq(internalAgentConversations.status, "active"),
          ),
        );

      let archivedConversationId: string | null = null;
      if (conversations.length > 0) {
        archivedConversationId = conversations[0].id;
        await db
          .update(internalAgentConversations)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(internalAgentConversations.id, archivedConversationId));
      }

      // Create new conversation
      const [newConv] = await db
        .insert(internalAgentConversations)
        .values({
          companyId,
          userId: actor.actorId,
          status: "active",
        })
        .returning();

      res.json({
        archivedConversationId,
        newConversationId: newConv.id,
      });
    },
  );

  // ── 2.4b Get Greeting ──────────────────────────────────────────────
  // No role restriction — the agent panel is available to all roles (DA-22).
  // Greeting only exposes high-level summaries, not raw data.
  router.get(
    "/companies/:companyId/internal-agent/greeting",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      // Fetch recent proactive runs (last 24 hours) to build a greeting
      const since = new Date();
      since.setHours(since.getHours() - 24);

      const recentRuns = await db
        .select({
          triggerSource: internalAgentRuns.triggerSource,
          summary: internalAgentRuns.summary,
          createdAt: internalAgentRuns.createdAt,
        })
        .from(internalAgentRuns)
        .where(
          and(
            eq(internalAgentRuns.companyId, companyId),
            eq(internalAgentRuns.triggerType, "proactive"),
            eq(internalAgentRuns.status, "completed"),
            gte(internalAgentRuns.createdAt, since),
          ),
        )
        .orderBy(desc(internalAgentRuns.createdAt))
        .limit(20);

      // Build greeting from actionable findings, deduped by triggerSource (keep most recent)
      const actionableKeywords = ["Found", "Budget alert", "Fired"];
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const run of recentRuns) {
        if (!seen.has(run.triggerSource) && run.summary && actionableKeywords.some((kw) => run.summary!.startsWith(kw))) {
          seen.add(run.triggerSource);
          deduped.push(run.summary);
        }
      }

      let greeting: string;
      if (deduped.length === 0) {
        greeting = "Everything looks good! No issues detected in the last 24 hours.";
      } else {
        greeting = `Here's what I found since your last visit:\n${deduped.map((f) => `• ${f}`).join("\n")}`;
      }

      res.json({
        greeting,
        findingCount: deduped.length,
        lastCheckedAt: recentRuns[0]?.createdAt ?? null,
      });
    },
  );

  // ── 2.5 Get Agent Config ─────────────────────────────────────────────
  router.get(
    "/companies/:companyId/internal-agent/config",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const configs = await db
        .select()
        .from(internalAgentConfig)
        .where(eq(internalAgentConfig.companyId, companyId));

      if (configs.length === 0) {
        res.json(null);
        return;
      }

      res.json(configs[0]);
    },
  );

  // ── 2.6 Update Agent Config ──────────────────────────────────────────
  router.patch(
    "/companies/:companyId/internal-agent/config",
    validate(updateConfigSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      // Validate autonomy level (v2.5: only 0)
      if (req.body.autonomyLevel != null && req.body.autonomyLevel !== 0) {
        throw badRequest("Autonomy levels 1-3 are not yet available in v2.5");
      }

      const [updated] = await db
        .update(internalAgentConfig)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(internalAgentConfig.companyId, companyId))
        .returning();

      if (!updated) {
        throw notFound("Internal agent config not found");
      }

      res.json(updated);
    },
  );

  // ── 2.7 Get Agent Runs ───────────────────────────────────────────────
  router.get(
    "/companies/:companyId/internal-agent/runs",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const conditions: SQL[] = [
        eq(internalAgentRuns.companyId, companyId),
      ];

      if (req.query.triggerType) {
        conditions.push(
          eq(internalAgentRuns.triggerType, req.query.triggerType as string),
        );
      }
      if (req.query.triggerSource) {
        conditions.push(
          eq(internalAgentRuns.triggerSource, req.query.triggerSource as string),
        );
      }
      if (req.query.status) {
        conditions.push(
          eq(internalAgentRuns.status, req.query.status as string),
        );
      }
      if (req.query.from) {
        conditions.push(
          gte(internalAgentRuns.createdAt, new Date(req.query.from as string)),
        );
      }
      if (req.query.to) {
        conditions.push(
          lte(internalAgentRuns.createdAt, new Date(req.query.to as string)),
        );
      }

      // Count + aggregates query (same conditions, no pagination)
      const [aggregateRow] = await db
        .select({
          totalRuns: sql<number>`count(*)::int`,
          totalCostCents: sql<number>`coalesce(sum(${internalAgentRuns.costCents}), 0)::int`,
          avgDurationMs: sql<number>`coalesce(avg(${internalAgentRuns.durationMs}), 0)::int`,
          failedCount: sql<number>`count(*) filter (where ${internalAgentRuns.status} = 'failed')::int`,
        })
        .from(internalAgentRuns)
        .where(and(...conditions));

      const totalRuns = aggregateRow?.totalRuns ?? 0;
      const failureRate = totalRuns > 0 ? (aggregateRow?.failedCount ?? 0) / totalRuns : 0;

      // Paginated results
      const runs = await db
        .select()
        .from(internalAgentRuns)
        .where(and(...conditions))
        .orderBy(desc(internalAgentRuns.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({
        runs,
        total: totalRuns,
        limit,
        offset,
        aggregates: {
          totalCostCents: aggregateRow?.totalCostCents ?? 0,
          totalRuns,
          avgDurationMs: aggregateRow?.avgDurationMs ?? 0,
          failureRate: Math.round(failureRate * 100) / 100,
        },
      });
    },
  );

  // ── 2.8 Get Reminders ────────────────────────────────────────────────
  router.get(
    "/companies/:companyId/internal-agent/reminders",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const statusFilter = (req.query.status as string) || "pending";

      const conditions: SQL[] = [
        eq(internalAgentReminders.companyId, companyId),
        eq(internalAgentReminders.userId, actor.actorId),
      ];

      if (statusFilter !== "all") {
        conditions.push(
          eq(internalAgentReminders.status, statusFilter),
        );
      }

      const reminders = await db
        .select()
        .from(internalAgentReminders)
        .where(and(...conditions));

      res.json({ reminders });
    },
  );

  // ── 2.9 Cancel Reminder ──────────────────────────────────────────────
  router.patch(
    "/companies/:companyId/internal-agent/reminders/:reminderId",
    validate(cancelReminderSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const reminderId = req.params.reminderId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const [updated] = await db
        .update(internalAgentReminders)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(internalAgentReminders.id, reminderId),
            eq(internalAgentReminders.companyId, companyId),
            eq(internalAgentReminders.userId, actor.actorId),
          ),
        )
        .returning();

      if (!updated) {
        throw notFound("Reminder not found");
      }

      res.json(updated);
    },
  );

  return router;
}
