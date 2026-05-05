import type { UpdateInternalAgentConfig } from "@armyofagents/shared";
import { api, ApiError } from "./client";

/* ------------------------------------------------------------------ */
/*  Response types                                                     */
/* ------------------------------------------------------------------ */

export interface AgentConversation {
  conversation: {
    id: string;
    status: "active" | "archived";
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  };
  messages: AgentMessage[];
  summarizedContext: string | null;
  total: number;
  limit: number;
  offset: number;
}

export interface AgentMessage {
  id: string;
  role: "assistant" | "user" | "system" | "tool";
  content: string;
  toolCalls: unknown | null;
  pageContext: string | null;
  createdAt: string;
}

export interface AgentConfig {
  id: string;
  executionMode: string;
  provider: string | null;
  model: string | null;
  cliTool: string | null;
  autonomyLevel: number;
  enabledCapabilities: string[];
  notificationPreference: string;
  contextTokenBudget: number;
  budgetMonthlyCents: number | null;
  spentMonthlyCents: number;
  proactiveIntervalMinutes: number;
  lastProactiveRunAt: string | null;
}

export interface AgentRunToolCall {
  name: string;
  durationMs: number;
  success: boolean;
}

export interface AgentRun {
  id: string;
  triggerType: "conversation" | "proactive" | "event" | "sub_agent";
  triggerSource: string;
  status: "running" | "completed" | "failed";
  toolsCalled: AgentRunToolCall[];
  tokenUsage: { inputTokens: number; outputTokens: number };
  costCents: number;
  durationMs: number;
  summary: string | null;
  departmentContext: string | null;
  userId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AgentRunsResponse {
  runs: AgentRun[];
  total: number;
  limit: number;
  offset: number;
  aggregates: {
    totalCostCents: number;
    totalRuns: number;
    avgDurationMs: number;
    failureRate: number;
  };
}

export interface AgentRunFilters {
  triggerType?: string;
  triggerSource?: string;
  status?: string;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
}

export interface AgentReminder {
  id: string;
  content: string;
  triggerAt: string;
  status: "pending" | "fired" | "cancelled";
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

export interface AgentRemindersResponse {
  reminders: AgentReminder[];
}

/* ------------------------------------------------------------------ */
/*  SSE streaming types                                                */
/* ------------------------------------------------------------------ */

export type SSEEventType =
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "content"
  | "action_confirm"
  | "done"
  | "error";

export interface SSEEvent {
  event: SSEEventType;
  data: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  SSE streaming helper (POST-based — NOT EventSource)                */
/* ------------------------------------------------------------------ */

function parseSSEPart(part: string): SSEEvent | null {
  if (!part.trim()) return null;

  const lines = part.split("\n");
  let event = "message";
  let dataStr = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      event = line.slice(7);
    } else if (line.startsWith("data: ")) {
      // Accumulate multi-line data fields per SSE spec
      dataStr += (dataStr ? "\n" : "") + line.slice(6);
    }
  }

  if (!dataStr) return null;

  try {
    const data = JSON.parse(dataStr) as Record<string, unknown>;
    return { event: event as SSEEventType, data };
  } catch {
    return null;
  }
}

export async function* streamAgentChat(
  companyId: string,
  message: string,
  pageContext?: string | null,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const response = await fetch(
    `/api/companies/${encodeURIComponent(companyId)}/internal-agent/chat`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, pageContext }),
      signal,
    },
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new ApiError(
      (errorBody as { error?: string } | null)?.error ??
        `Agent chat failed: ${response.status}`,
      response.status,
      errorBody,
    );
  }

  if (!response.body) {
    throw new ApiError("No response body received", response.status, null);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;

      for (const part of parts) {
        const parsed = parseSSEPart(part);
        if (parsed) yield parsed;
      }
    }

    // Process any remaining buffer
    const parsed = parseSSEPart(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  REST API client                                                    */
/* ------------------------------------------------------------------ */

function buildRunParams(filters: AgentRunFilters): string {
  const params = new URLSearchParams();
  if (filters.triggerType) params.set("triggerType", filters.triggerType);
  if (filters.triggerSource) params.set("triggerSource", filters.triggerSource);
  if (filters.status) params.set("status", filters.status);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface AgentGreeting {
  greeting: string;
  findingCount: number;
  lastCheckedAt: string | null;
}

export const internalAgentApi = {
  getGreeting: (companyId: string) =>
    api.get<AgentGreeting>(`/companies/${companyId}/internal-agent/greeting`),

  getConversation: (
    companyId: string,
    opts?: { limit?: number; offset?: number; includeArchived?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    if (opts?.includeArchived) params.set("includeArchived", "true");
    const qs = params.toString();
    return api.get<AgentConversation>(
      `/companies/${companyId}/internal-agent/conversation${qs ? `?${qs}` : ""}`,
    );
  },

  resetConversation: (companyId: string) =>
    api.delete<{ archivedConversationId: string; newConversationId: string }>(
      `/companies/${companyId}/internal-agent/conversation`,
    ),

  confirmAction: (companyId: string, confirmId: string, approved: boolean) =>
    api.post<{ confirmId: string; result: string; entityType?: string; entityId?: string }>(
      `/companies/${companyId}/internal-agent/confirm`,
      { confirmId, approved },
    ),

  getConfig: (companyId: string) =>
    api.get<AgentConfig>(`/companies/${companyId}/internal-agent/config`),

  updateConfig: (companyId: string, data: UpdateInternalAgentConfig) =>
    api.patch<AgentConfig>(`/companies/${companyId}/internal-agent/config`, data),

  getRuns: (companyId: string, filters: AgentRunFilters = {}) =>
    api.get<AgentRunsResponse>(
      `/companies/${companyId}/internal-agent/runs${buildRunParams(filters)}`,
    ),

  getReminders: (companyId: string, status?: string) => {
    const params = status ? `?status=${encodeURIComponent(status)}` : "";
    return api.get<AgentRemindersResponse>(
      `/companies/${companyId}/internal-agent/reminders${params}`,
    );
  },

  cancelReminder: (companyId: string, reminderId: string) =>
    api.patch<AgentReminder>(
      `/companies/${companyId}/internal-agent/reminders/${reminderId}`,
      { status: "cancelled" },
    ),

  testConnection: (companyId: string) =>
    api.post<{ success: boolean; error?: string }>(
      `/companies/${companyId}/internal-agent/test-connection`,
      {},
    ),
};
