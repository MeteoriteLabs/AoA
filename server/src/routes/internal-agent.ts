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
import { HttpError, badRequest, notFound, forbidden } from "../errors.js";
import { agentLoopService } from "../services/internal-agent/agent-loop.js";
import {
  createToolRegistry,
  executeTool,
} from "../services/internal-agent/tool-registry.js";
import { createServiceContainer } from "../services/internal-agent/service-container.js";
import { permissionService } from "../services/permissions.js";
import type { UserRole } from "@armyofagents/shared";
import { COMMANDER_TOOL_PERMISSION_DEFAULT } from "@armyofagents/shared";

// ── Pending Confirmation Store ───────────────────────────────────────────────
// In-memory Map: confirmId → pending tool execution.
// Populated when Commander emits a ⚡CONFIRM:...⚡ marker and cleared when the
// user clicks Confirm or Cancel in the UI. Scoped to the server process;
// cleared on restart (acceptable — pending confirmations are ephemeral).

interface PendingConfirmation {
  toolName: string;
  params: unknown;
  companyId: string;
  userId: string;
  userRole: UserRole;
  enabledCapabilities: string[];
  actorType?: string;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

// ── Schemas ──────────────────────────────────────────────────────────────────

const chatMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  pageContext: z.string().optional(),
  conversationId: z.string().uuid().optional(),
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

const toolPermissionSchema = z.object({
  enabled: z.boolean(),
  requireConfirmation: z.boolean(),
  minimumRole: z.enum(["founder", "team_lead", "team_member"]),
});

const updateToolPermissionsSchema = z.record(z.string(), toolPermissionSchema);

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
          conversationId: req.body.conversationId ?? undefined,
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
            case "action_confirmation": {
              const confirmId = chunk.runId;
              // Store the pending execution so /confirm can re-execute directly.
              pendingConfirmations.set(confirmId, {
                toolName: chunk.toolName,
                params: chunk.params,
                companyId,
                userId: actor.actorId,
                userRole,
                enabledCapabilities,
                actorType: "commander",
              });
              const paramsSummary =
                chunk.params &&
                typeof chunk.params === "object" &&
                Object.keys(chunk.params as object).length > 0
                  ? ` with ${Object.entries(chunk.params as Record<string, unknown>)
                      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                      .join(", ")}`
                  : "";
              res.write(
                `event: action_confirm\ndata: ${JSON.stringify({
                  confirmId,
                  action: chunk.toolName,
                  description: `${chunk.toolName}${paramsSummary}`,
                })}\n\n`,
              );
              break;
            }
            case "options_prompt":
              res.write(
                `event: options_prompt\ndata: ${JSON.stringify({
                  promptId: chunk.promptId,
                  question: chunk.question,
                  options: chunk.options,
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

      const { confirmId, approved } = req.body as { confirmId: string; approved: boolean };

      const pending = pendingConfirmations.get(confirmId);
      if (!pending) {
        throw notFound(`No pending confirmation for id: ${confirmId}`);
      }

      if (pending.companyId !== companyId) {
        // Defense-in-depth: a confirmId from one company can't be replayed against
        // another company's endpoint. Treat as not-found to avoid leaking existence.
        throw notFound(`No pending confirmation for id: ${confirmId}`);
      }

      pendingConfirmations.delete(confirmId);

      if (!approved) {
        res.json({ confirmId, result: "rejected", entityType: null, entityId: null });
        return;
      }

      // Direct re-execution: bypass Commander's LLM and run the tool with the
      // exact stored params. Industry-standard pattern.

      const tools = createToolRegistry();
      const tool = tools.find((t) => t.name === pending.toolName);
      if (!tool) {
        throw notFound(`Tool not found: ${pending.toolName}`);
      }

      const services = createServiceContainer(db);
      const toolContext = {
        companyId: pending.companyId,
        userId: pending.userId,
        userRole: pending.userRole,
        enabledCapabilities: pending.enabledCapabilities,
        agentKind: undefined,
        toolAllowlist: [] as string[],
        actorType: pending.actorType,
        db,
        services,
      };

      const result = await executeTool(tool, pending.params, toolContext);

      res.json({
        confirmId,
        result: result.success ? "executed" : "failed",
        summary: result.summary ?? null,
        error: result.error ?? null,
        entityType: null,
        entityId: null,
      });
    },
  );

  // ── Tool Permissions ──────────────────────────────────────────────────
  router.get(
    "/companies/:companyId/internal-agent/tool-permissions",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const [config] = await db
        .select({ commanderToolPermissions: internalAgentConfig.commanderToolPermissions })
        .from(internalAgentConfig)
        .where(eq(internalAgentConfig.companyId, companyId));

      const stored = (config?.commanderToolPermissions as Record<string, unknown> | null) ?? {};
      res.json({ permissions: stored, default: COMMANDER_TOOL_PERMISSION_DEFAULT });
    },
  );

  router.patch(
    "/companies/:companyId/internal-agent/tool-permissions",
    validate(updateToolPermissionsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      await db
        .update(internalAgentConfig)
        .set({ commanderToolPermissions: req.body })
        .where(eq(internalAgentConfig.companyId, companyId));

      res.json({ success: true });
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

  // ── Conversations: list ──────────────────────────────────────────────
  router.get(
    "/companies/:companyId/internal-agent/conversations",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      // RBAC: local_implicit and isInstanceAdmin actors get founder-equivalent
      // access (mirrors the chat route bypass semantics at lines 113-133).
      // Otherwise, look up the actor's effective role.
      const isLocalImplicit =
        req.actor.type === "board" && req.actor.source === "local_implicit";
      const isInstanceAdmin =
        req.actor.type === "board" && req.actor.isInstanceAdmin === true;

      let isFounder: boolean;
      if (isLocalImplicit || isInstanceAdmin) {
        isFounder = true;
      } else {
        const role = await permissionService(db).getEffectiveRole(
          companyId,
          actor.actorId,
        );
        isFounder = role === "founder";
      }

      // Build conditions array — Drizzle's and() does not accept undefined.
      const conditions: SQL[] = [
        eq(internalAgentConversations.companyId, companyId),
        isNull(internalAgentConversations.archivedAt),
      ];
      if (!isFounder) {
        conditions.push(eq(internalAgentConversations.userId, actor.actorId));
      }

      const rows = await db
        .select()
        .from(internalAgentConversations)
        .where(and(...conditions))
        .orderBy(desc(internalAgentConversations.updatedAt));

      res.json({ conversations: rows });
    },
  );

  // ── Conversations: create new ────────────────────────────────────────
  router.post(
    "/companies/:companyId/internal-agent/conversations",
    validate(z.object({ title: z.string().max(200).optional() })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const [conv] = await db
        .insert(internalAgentConversations)
        .values({
          companyId,
          userId: actor.actorId,
          // "pending" until conversation switching is wired (full multi-chat support).
          // "active" is reserved for the conversation the agentLoop is currently using;
          // creating a second "active" row would make chat routing non-deterministic.
          status: "pending",
          title: req.body.title ?? null,
        })
        .returning();

      res.status(201).json(conv);
    },
  );

  // ── Conversations: archive ───────────────────────────────────────────
  router.patch(
    "/companies/:companyId/internal-agent/conversations/:convId/archive",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const convId = req.params.convId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      // Get role FIRST so we can embed ownership in the WHERE clause and avoid
      // leaking conversation existence to non-owners via a 403 vs 404 distinction.
      const isLocalImplicit =
        req.actor.type === "board" && req.actor.source === "local_implicit";
      const isInstanceAdmin =
        req.actor.type === "board" && req.actor.isInstanceAdmin === true;

      let isFounderRole: boolean;
      if (isLocalImplicit || isInstanceAdmin) {
        isFounderRole = true;
      } else {
        const role = await permissionService(db).getEffectiveRole(
          companyId,
          actor.actorId,
        );
        isFounderRole = role === "founder";
      }

      // Build conditions: the conversation must be in this company AND either:
      // - it belongs to the current user (non-founders), or
      // - we don't filter by userId (founders see all)
      const convConditions = [
        eq(internalAgentConversations.id, convId),
        eq(internalAgentConversations.companyId, companyId),
      ];
      if (!isFounderRole) {
        convConditions.push(eq(internalAgentConversations.userId, actor.actorId));
      }

      const [existing] = await db
        .select()
        .from(internalAgentConversations)
        .where(and(...convConditions));

      if (!existing) throw notFound("Conversation not found");
      // No separate ownership check needed — WHERE clause already enforces it

      const [updated] = await db
        .update(internalAgentConversations)
        .set({ archivedAt: new Date(), status: "archived" })
        .where(eq(internalAgentConversations.id, convId))
        .returning();

      res.json(updated);
    },
  );

  // ── Get Messages for a Specific Conversation ─────────────────────────
  router.get(
    "/companies/:companyId/internal-agent/conversations/:convId/messages",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const convId = req.params.convId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      // Verify the conversation belongs to this company AND this user
      const [conv] = await db
        .select()
        .from(internalAgentConversations)
        .where(
          and(
            eq(internalAgentConversations.id, convId),
            eq(internalAgentConversations.companyId, companyId),
            eq(internalAgentConversations.userId, actor.actorId),
          ),
        );

      if (!conv) {
        throw notFound("Conversation not found");
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const messages = await db
        .select()
        .from(internalAgentMessages)
        .where(eq(internalAgentMessages.conversationId, convId))
        .orderBy(asc(internalAgentMessages.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({ messages, conversationId: convId });
    },
  );

  return router;
}
