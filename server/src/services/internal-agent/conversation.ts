import { and, eq, desc, gt, gte, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  internalAgentConversations,
  internalAgentMessages,
} from "@armyofagents/db";
import { commanderOutputRefSchema } from "@armyofagents/shared";
import { mergeOutputRefs } from "./output-refs.js";

export interface MessageInput {
  role: string;
  content?: string | null;
  toolCalls?: unknown;
  toolResults?: unknown;
  pageContext?: string | null;
  departmentContext?: string | null;
  tokenCount?: number | null;
  runId?: string | null;
  outputRefs?: unknown;
  reasoning?: string | null;
  clientSubmissionId?: string | null;
}

const MESSAGE_THRESHOLD = 20;

export function conversationService(db: Db) {
  return {
    async getOrCreateActive(companyId: string, userId: string) {
      const existing = await db
        .select()
        .from(internalAgentConversations)
        .where(
          and(
            eq(internalAgentConversations.companyId, companyId),
            eq(internalAgentConversations.userId, userId),
            eq(internalAgentConversations.status, "active"),
          ),
        )
        .limit(1)
        .then((rows: any[]) => rows[0] ?? null);

      if (existing) return existing;

      return db
        .insert(internalAgentConversations)
        .values({ companyId, userId, status: "active", messageCount: 0 })
        .returning()
        .then((rows: any[]) => rows[0]);
    },

    async appendMessage(conversationId: string, message: MessageInput) {
      // Viewer refs: validate PER REF at the persistence boundary — one malformed
      // lifted ref must not erase the message's valid refs (T2 review). Message
      // itself always saves. mergeOutputRefs unifies the cap with
      // the design's created-first precedence AND dedupes (T7 review).
      let outputRefs: unknown = null;
      if (Array.isArray(message.outputRefs) && message.outputRefs.length > 0) {
        const valid = message.outputRefs.flatMap((r) => {
          const p = commanderOutputRefSchema.safeParse(r);
          return p.success ? [p.data] : [];
        });
        const merged = mergeOutputRefs([], valid);
        outputRefs = merged.length > 0 ? merged : null;
      }

      const inserted = await db
        .insert(internalAgentMessages)
        .values({
          conversationId,
          role: message.role,
          content: message.content ?? null,
          toolCalls: message.toolCalls ?? null,
          toolResults: message.toolResults ?? null,
          pageContext: message.pageContext ?? null,
          departmentContext: message.departmentContext ?? null,
          tokenCount: message.tokenCount ?? null,
          runId: message.runId ?? null,
          outputRefs,
          reasoning: message.reasoning ?? null,
          clientSubmissionId: message.clientSubmissionId ?? null,
        })
        // Concurrency backstop for the replay check in agent-loop.chat(): a
        // simultaneous duplicate key resolves to one row via the partial index.
        .onConflictDoNothing()
        .returning()
        .then((rows: any[]) => rows[0]);

      // A lost insert race means the duplicate turn is already recorded; don't
      // double-count the conversation's messages.
      if (!inserted) return inserted;

      await db
        .update(internalAgentConversations)
        .set({
          messageCount: sql`${internalAgentConversations.messageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(internalAgentConversations.id, conversationId));

      return inserted;
    },

    /** Idempotency lookup: the user message previously persisted for this key. */
    async getMessageByClientSubmissionId(
      conversationId: string,
      clientSubmissionId: string,
    ) {
      return db
        .select()
        .from(internalAgentMessages)
        .where(
          and(
            eq(internalAgentMessages.conversationId, conversationId),
            eq(internalAgentMessages.clientSubmissionId, clientSubmissionId),
          ),
        )
        .then((rows: any[]) => rows[0] ?? null);
    },

    /** The first assistant reply persisted at/after the given timestamp. */
    async getAssistantReplyAfter(conversationId: string, afterCreatedAt: Date) {
      return db
        .select()
        .from(internalAgentMessages)
        .where(
          and(
            eq(internalAgentMessages.conversationId, conversationId),
            eq(internalAgentMessages.role, "assistant"),
            gte(internalAgentMessages.createdAt, afterCreatedAt),
          ),
        )
        .orderBy(internalAgentMessages.createdAt, internalAgentMessages.id)
        .limit(1)
        .then((rows: any[]) => rows[0] ?? null);
    },

    async getRecentMessages(conversationId: string, limit = 50) {
      return db
        .select()
        .from(internalAgentMessages)
        .where(eq(internalAgentMessages.conversationId, conversationId))
        .orderBy(desc(internalAgentMessages.createdAt), desc(internalAgentMessages.id))
        .limit(limit)
        .then((rows: any[]) => rows.reverse());
    },

    async getMessagesSince(conversationId: string, sinceMessageId: string | null, limit = 50) {
      let markerCreatedAt: Date | null = null;
      if (sinceMessageId) {
        const markerRows = await db
          .select({ createdAt: internalAgentMessages.createdAt })
          .from(internalAgentMessages)
          .where(eq(internalAgentMessages.id, sinceMessageId))
          .then((r: { createdAt: Date }[]) => r);
        markerCreatedAt = markerRows[0]?.createdAt ?? null;
      }
      const base = db
        .select()
        .from(internalAgentMessages)
        .where(
          markerCreatedAt
            ? and(eq(internalAgentMessages.conversationId, conversationId), gt(internalAgentMessages.createdAt, markerCreatedAt))
            : eq(internalAgentMessages.conversationId, conversationId),
        );
      // Chronological; cap at `limit` most-recent then re-sort ascending.
      const rows = await base
        .orderBy(desc(internalAgentMessages.createdAt), desc(internalAgentMessages.id))
        .limit(limit)
        .then((r: any[]) => r.reverse());
      return rows;
    },

    async summarizeIfNeeded(
      conversationId: string,
      summarize: (transcript: string) => Promise<string>,
    ) {
      const countResult = await db
        .select({ count: sql`count(*)` })
        .from(internalAgentMessages)
        .where(eq(internalAgentMessages.conversationId, conversationId))
        .then((rows: any[]) => rows[0]);

      const totalCount = Number(countResult?.count ?? 0);
      if (totalCount <= MESSAGE_THRESHOLD) return;

      const offsetCount = totalCount - MESSAGE_THRESHOLD;
      const oldMessages = await db
        .select()
        .from(internalAgentMessages)
        .where(eq(internalAgentMessages.conversationId, conversationId))
        .orderBy(internalAgentMessages.createdAt)
        .limit(offsetCount);

      if (oldMessages.length === 0) return;

      const transcript = oldMessages
        .map((m: any) => {
          if (m.role === "tool_call" && m.toolCalls) {
            const calls = (m.toolCalls as any[]).map((tc: any) => tc.name).join(", ");
            return `assistant: [Called tools: ${calls}]`;
          }
          if (m.content) return `${m.role}: ${m.content}`;
          return null;
        })
        .filter(Boolean)
        .join("\n");

      if (!transcript.trim()) return;

      const summary = await summarize(transcript);
      if (!summary || !summary.trim()) return;

      const lastOldMessage = oldMessages[oldMessages.length - 1] as any;
      await db
        .update(internalAgentConversations)
        .set({
          summarizedContext: summary,
          summarizedUpToMessageId: lastOldMessage.id,
          updatedAt: new Date(),
        })
        .where(eq(internalAgentConversations.id, conversationId));
    },

    async getById(conversationId: string) {
      const [conv] = await db
        .select()
        .from(internalAgentConversations)
        .where(eq(internalAgentConversations.id, conversationId));
      return conv ?? null;
    },

    async reset(companyId: string, userId: string) {
      await db
        .update(internalAgentConversations)
        .set({ status: "archived", updatedAt: new Date() })
        .where(
          and(
            eq(internalAgentConversations.companyId, companyId),
            eq(internalAgentConversations.userId, userId),
            eq(internalAgentConversations.status, "active"),
          ),
        );

      return db
        .insert(internalAgentConversations)
        .values({ companyId, userId, status: "active", messageCount: 0 })
        .returning()
        .then((rows: any[]) => rows[0]);
    },
  };
}
