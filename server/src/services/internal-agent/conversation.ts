import { and, eq, desc, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  internalAgentConversations,
  internalAgentMessages,
} from "@armyofagents/db";
import type { LLMProvider, ChatMessage } from "./providers/types.js";

export interface MessageInput {
  role: string;
  content?: string | null;
  toolCalls?: unknown;
  toolResults?: unknown;
  pageContext?: string | null;
  departmentContext?: string | null;
  tokenCount?: number | null;
  runId?: string | null;
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
        })
        .returning()
        .then((rows: any[]) => rows[0]);

      await db
        .update(internalAgentConversations)
        .set({
          messageCount: sql`${internalAgentConversations.messageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(internalAgentConversations.id, conversationId));

      return inserted;
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

    async summarizeIfNeeded(
      conversationId: string,
      provider: LLMProvider,
      config: { model: string },
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

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: `Summarize this conversation history concisely, preserving key decisions, action items, and context:\n\n${transcript}`,
        },
      ];

      let summary = "";
      for await (const chunk of provider.chat({
        messages,
        tools: [],
        model: config.model,
        maxTokens: 1000,
        systemPrompt: "You are a conversation summarizer. Be concise.",
      })) {
        if (chunk.type === "text") {
          summary += chunk.delta;
        }
      }

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
