import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Bot,
  Check,
  Loader2,
  MessageSquarePlus,
  Mic,
  Send,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { useAgentPanel } from "../context/AgentPanelContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import {
  internalAgentApi,
  streamAgentChat,
  conversationMessagesApi,
  commanderConversationsApi,
  confirmAction,
  type AgentMessage,
  type SSEEvent,
  type AgentGreeting,
} from "../api/internal-agent";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "./MarkdownBody";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChatPaneCaption } from "./commander/ChatPaneCaption";
import { CommanderEmptyState } from "./commander/CommanderEmptyState";
import { InputAddMenu } from "./commander/InputAddMenu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ */
/*  Tool call display names                                            */
/* ------------------------------------------------------------------ */

const TOOL_LABELS: Record<string, string> = {
  list_tasks: "Checking your tasks...",
  get_task: "Looking up task details...",
  create_task: "Creating a task...",
  update_task: "Updating a task...",
  list_goals: "Reviewing goals...",
  list_agents: "Checking agents...",
  list_departments: "Looking at departments...",
  create_department: "Creating a department...",
  search_memory: "Searching memory...",
  create_discussion: "Starting a discussion...",
  list_discussions: "Checking discussions...",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name.replaceAll("_", " ")}...`;
}

/* ------------------------------------------------------------------ */
/*  Message types for local rendering                                  */
/* ------------------------------------------------------------------ */

interface ToolCallEntry {
  id: number;
  name: string;
  status: "running" | "done";
}

interface LocalMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streamingDone: boolean;
  toolCalls?: ToolCallEntry[];
  actionConfirm?: {
    confirmId: string;
    action: string;
    description: string;
    status: "pending" | "approving" | "approved" | "rejected" | "failed";
    errorMessage?: string;
  };
  optionsPrompt?: {
    promptId: string;
    question: string;
    options: string[];
    dismissed: boolean;
  };
  createdAt: string;
}

function serverToLocal(m: AgentMessage): LocalMessage {
  return {
    id: m.id,
    role: m.role === "tool" ? "system" : m.role,
    content: m.content,
    streamingDone: true,
    createdAt: m.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/*  Panel content (shared between desktop inline & mobile sheet)       */
/* ------------------------------------------------------------------ */

interface AgentPanelContentProps {
  conversationId?: string | null;
  onSelectConversation?: (id: string) => void;
}

export function AgentPanelContent({ conversationId, onSelectConversation }: AgentPanelContentProps = {}) {
  const { selectedCompanyId } = useCompany();
  const { breadcrumbs } = useBreadcrumbs();
  const { closePanel, setIsStreaming, setCurrentConversationId } = useAgentPanel();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreamingLocal] = useState(false);
  // Seam for Task 9: skill picker open state
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const localIdRef = useRef(0);
  const toolCallIdRef = useRef(0);

  const companyId = selectedCompanyId ?? "";

  // Load conversation history
  const { data: conversation } = useQuery({
    queryKey: queryKeys.agentConversation(companyId),
    queryFn: () => internalAgentApi.getConversation(companyId),
    enabled: !!companyId,
  });

  // Fetch greeting (summary of background activity since last visit)
  const { data: greeting } = useQuery({
    queryKey: queryKeys.agentGreeting(companyId),
    queryFn: () => internalAgentApi.getGreeting(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Load history when switching to a specific conversation
  const { data: historyData } = useQuery({
    queryKey: ["conversation-messages", companyId, conversationId],
    queryFn: () =>
      companyId && conversationId
        ? conversationMessagesApi.list(companyId, conversationId)
        : Promise.resolve(null),
    enabled: !!companyId && !!conversationId,
  });

  // Conversations list — same cache key as SessionsSidebar (no extra fetch)
  const { data: conversationsData } = useQuery({
    queryKey: ["commander-conversations", companyId],
    queryFn: () => commanderConversationsApi.list(companyId),
    enabled: !!companyId,
  });

  const allConversations = conversationsData?.conversations ?? [];

  // Active conversation row (for caption title/meta)
  const activeConv = useMemo(
    () => (conversationId ? allConversations.find((c) => c.id === conversationId) : undefined),
    [allConversations, conversationId],
  );

  // Top 2 most-recent conversations (by updatedAt) for empty-state recent chats,
  // excluding the currently-active one so the list isn't redundant.
  const recentChats = useMemo(
    () =>
      [...allConversations]
        .filter((c) => c.id !== conversationId)
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 2),
    [allConversations, conversationId],
  );

  // Reset messages when switching conversations
  useEffect(() => {
    if (!conversationId) return;
    setMessages([]);
    setStreamingLocal(false);
  }, [conversationId]);

  // Populate messages from history when historyData arrives
  useEffect(() => {
    if (!historyData?.messages?.length) return;
    const loaded: LocalMessage[] = historyData.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content ?? "",
        streamingDone: true,
        createdAt: m.createdAt,
      }));
    setMessages(loaded);
  }, [historyData]);

  // Sync server messages into local state (only when not streaming AND no specific conversation is selected)
  useEffect(() => {
    if (conversationId) return;
    if (streaming) return;
    if (!conversation) return;
    if (conversation.messages) {
      setMessages((prev) => {
        const localById = new Map(prev.map((m) => [m.id, m]));
        return conversation.messages.map((m) => ({
          ...serverToLocal(m),
          actionConfirm: localById.get(m.id)?.actionConfirm,
          optionsPrompt: localById.get(m.id)?.optionsPrompt,
        }));
      });
    }
    if (conversation.conversation?.id) {
      setCurrentConversationId(conversation.conversation.id);
    }
  }, [conversation, streaming, setCurrentConversationId, conversationId]);

  // Auto-scroll on new messages or streaming content/action card updates
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content, messages[messages.length - 1]?.actionConfirm]);

  // Focus input when panel opens
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Escape key closes panel on desktop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePanel]);

  const pageContext = breadcrumbs.length > 0 ? breadcrumbs.map((b) => b.label).join(" > ") : null;

  const sendText = useCallback(
    async (text: string) => {
      if (!text || !companyId || streaming) return;

      setStreamingLocal(true);
      setIsStreaming(true);

      // Add user message
      const userMsg: LocalMessage = {
        id: `local-user-${Date.now()}-${++localIdRef.current}`,
        role: "user",
        content: text,
        streamingDone: true,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Prepare assistant message placeholder
      const assistantId = `local-assistant-${Date.now()}-${++localIdRef.current}`;
      const assistantMsg: LocalMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        streamingDone: false,
        toolCalls: [],
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stream = streamAgentChat(companyId, text, pageContext, controller.signal, conversationId);

        for await (const event of stream) {
          handleSSEEvent(event, assistantId);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || "Sorry, something went wrong. Please try again.", streamingDone: true }
                : m,
            ),
          );
        }
      } finally {
        // Mark streaming done on the assistant message (fix #1: switch to markdown)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streamingDone: true } : m,
          ),
        );
        setStreamingLocal(false);
        setIsStreaming(false);
        abortRef.current = null;
        // Refresh conversation from server
        queryClient.invalidateQueries({ queryKey: queryKeys.agentConversation(companyId) });
        queryClient.invalidateQueries({ queryKey: ["commander-conversations"] });
      }
    },
    [companyId, streaming, pageContext, setIsStreaming, queryClient, conversationId],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendText(text);
  }, [input, sendText]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreamingLocal(false);
    setIsStreaming(false);
  }, [setIsStreaming]);

  // Not wrapped in useCallback intentionally — only called from handleSend's async loop,
  // and only uses setMessages (functional updater) + toolCallIdRef (ref). No stale closure risk.
  function handleSSEEvent(event: SSEEvent, assistantId: string) {
    switch (event.event) {
      case "content":
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + ((event.data as { text?: string }).text ?? "") }
              : m,
          ),
        );
        break;

      case "thinking":
        // Show thinking indicator — content stays empty until real content arrives
        break;

      case "tool_call": {
        const name = (event.data as { name?: string }).name ?? "unknown";
        const callId = ++toolCallIdRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, toolCalls: [...(m.toolCalls ?? []), { id: callId, name, status: "running" }] }
              : m,
          ),
        );
        break;
      }

      case "tool_result": {
        // Fix #3: Mark only the FIRST running tool call with this name as done (by id order)
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const toolName = (event.data as { name?: string }).name;
            let found = false;
            const updated = (m.toolCalls ?? []).map((tc) => {
              if (!found && tc.name === toolName && tc.status === "running") {
                found = true;
                return { ...tc, status: "done" as const };
              }
              return tc;
            });
            return { ...m, toolCalls: updated };
          }),
        );
        break;
      }

      case "action_confirm": {
        const { confirmId, action, description } = event.data as {
          confirmId: string;
          action: string;
          description: string;
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  actionConfirm: { confirmId, action, description, status: "pending" },
                }
              : m,
          ),
        );
        break;
      }

      case "options_prompt": {
        const { promptId, question, options } = event.data as {
          promptId: string;
          question: string;
          options: string[];
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, optionsPrompt: { promptId, question, options, dismissed: false } }
              : m,
          ),
        );
        break;
      }

      case "done":
      case "error":
        // Stream finished
        break;
    }
  }

  const sendConfirmMessage = useCallback(
    async (
      messageId: string,
      confirmId: string,
      approved: boolean,
    ) => {
      // 1. Optimistic UI: move status to "approving" / "rejected"
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.actionConfirm
            ? {
                ...m,
                actionConfirm: {
                  ...m.actionConfirm,
                  status: approved ? "approving" : "rejected",
                },
              }
            : m,
        ),
      );

      try {
        const result = await confirmAction(companyId, { confirmId, approved });

        // 2. Settle UI based on server result
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.actionConfirm
              ? {
                  ...m,
                  actionConfirm: {
                    ...m.actionConfirm,
                    status:
                      result.result === "executed"
                        ? "approved"
                        : result.result === "rejected"
                          ? "rejected"
                          : "failed",
                    errorMessage: result.error ?? undefined,
                  },
                }
              : m,
          ),
        );

        // 3. Refresh conversation so any new tool-result messages appear in chat
        queryClient.invalidateQueries({ queryKey: queryKeys.agentConversation(companyId) });
        queryClient.invalidateQueries({ queryKey: ["commander-conversations"] });
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.actionConfirm
              ? {
                  ...m,
                  actionConfirm: {
                    ...m.actionConfirm,
                    status: "failed",
                    errorMessage: err instanceof Error ? err.message : "Network error",
                  },
                }
              : m,
          ),
        );
      }
    },
    [companyId, queryClient],
  );

  const handleReset = useCallback(async () => {
    if (!companyId || streaming) return;
    // Abort any in-flight stream
    abortRef.current?.abort();
    try {
      await internalAgentApi.resetConversation(companyId);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.agentConversation(companyId) });
    } catch {
      // ignore
    }
  }, [companyId, streaming, queryClient]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat pane caption strip — shown only when there is an active conversation */}
      {conversationId && (
        <ChatPaneCaption
          title={activeConv?.title ?? "New chat"}
          messageCount={activeConv?.messageCount ?? messages.length}
          updatedAt={activeConv?.updatedAt}
          onOpenSessions={undefined}
        />
      )}

      {/* Mobile close button (absolute overlay, not in flow) */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={closePanel}
        aria-label="Close Commander"
        className="md:hidden absolute top-2 right-2 z-10"
      >
        <X className="h-4 w-4" />
      </Button>

      {/* Messages (fix #11: aria-live for streaming accessibility) */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && (
          <CommanderEmptyState
            greetingText={
              greeting
                ? (greeting.findingCount > 0 ? "Here's what happened" : greeting.greeting)
                : undefined
            }
            onPromptClick={sendText}
            recentChats={recentChats}
            onSelectChat={(id) => onSelectConversation?.(id)}
          />
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted",
              )}
            >
              {/* Tool call indicators */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="space-y-1 mb-2">
                  {msg.toolCalls.map((tc) => (
                    <div key={tc.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {tc.status === "running" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Wrench className="h-3 w-3" />
                      )}
                      <span>{toolLabel(tc.name)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Message content (fix #1: plain text while streaming, markdown when done) */}
              {msg.content ? (
                msg.role === "user" ? (
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                ) : msg.streamingDone ? (
                  <MarkdownBody className="prose-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-1 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs">
                    {msg.content}
                  </MarkdownBody>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                )
              ) : msg.role === "assistant" && streaming ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </span>
              ) : null}

              {/* Action confirmation */}
              {msg.actionConfirm && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-100">
                    <span>⚡</span>
                    <span>Action requires approval: <code className="font-mono">{msg.actionConfirm.action}</code></span>
                  </div>
                  {msg.actionConfirm.description !== msg.actionConfirm.action && (
                    <p className="text-xs text-muted-foreground">{msg.actionConfirm.description}</p>
                  )}
                  {msg.actionConfirm.status === "pending" ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => sendConfirmMessage(msg.id, msg.actionConfirm!.confirmId, true)}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => sendConfirmMessage(msg.id, msg.actionConfirm!.confirmId, false)}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  ) : msg.actionConfirm.status === "approving" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-200">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Executing…
                    </span>
                  ) : msg.actionConfirm.status === "failed" ? (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">Failed</span>
                      {msg.actionConfirm.errorMessage && (
                        <p className="text-xs text-muted-foreground">{msg.actionConfirm.errorMessage}</p>
                      )}
                    </div>
                  ) : (
                    <span
                      className={cn(
                        "text-xs font-medium",
                        msg.actionConfirm.status === "approved"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {msg.actionConfirm.status === "approved" ? "Confirmed" : "Rejected"}
                    </span>
                  )}
                </div>
              )}

              {/* Options prompt */}
              {msg.optionsPrompt && !msg.optionsPrompt.dismissed && (
                <div className="mt-2 rounded-lg border border-border bg-background p-3 space-y-2 shadow-sm">
                  <p className="text-xs text-muted-foreground">
                    Commander is asking — pick one or type your answer below:
                  </p>
                  <p className="text-xs font-medium text-foreground">{msg.optionsPrompt.question}</p>
                  <div className="flex flex-wrap gap-2">
                    {msg.optionsPrompt.options.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          // Dismiss the panel
                          setMessages((prev) =>
                            prev.map((m) =>
                              m.id === msg.id && m.optionsPrompt
                                ? { ...m, optionsPrompt: { ...m.optionsPrompt, dismissed: true } }
                                : m,
                            ),
                          );
                          // Send the selected option as a user message
                          void sendText(opt);
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-xs transition-colors",
                          i === 0
                            ? "border-primary bg-primary/5 text-primary hover:bg-primary/10 font-medium"
                            : "border-border hover:bg-muted",
                        )}
                      >
                        {opt}
                        {i === 0 && <span className="ml-1 opacity-60">(recommended)</span>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Clicking a chip sends it as your reply and dismisses this panel.
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-border p-3">
        {/* TODO(Task 9): render <SkillPicker open={skillPickerOpen} onOpenChange={setSkillPickerOpen} /> here */}
        <div className="rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-brand-focus-ring focus-within:border-brand transition-shadow">
          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent..."
            rows={1}
            className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50 max-h-[140px] min-h-[36px]"
            style={{ height: "36px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "36px";
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            disabled={streaming}
          />
          {/* Controls row */}
          <div className="flex items-center gap-1.5 px-2 pb-2">
            {/* + add menu (functional) */}
            <InputAddMenu
              onUseSkill={() => setSkillPickerOpen(true)}
              disabled={streaming}
            />

            {/* @mention (disabled, coming soon) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="size-8 rounded-full flex items-center justify-center shrink-0 text-muted-foreground opacity-40 cursor-not-allowed"
                  >
                    <AtSign className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Coming soon</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Voice (disabled, coming soon) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="size-8 rounded-full flex items-center justify-center shrink-0 text-muted-foreground opacity-40 cursor-not-allowed"
                  >
                    <Mic className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Coming soon</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send / Stop */}
            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop generation"
                className="size-8 rounded-full flex items-center justify-center shrink-0 bg-[color:var(--error,#ef4444)] text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring"
              >
                <Square className="size-3.5 fill-current" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                aria-label="Send message"
                className="size-8 rounded-full flex items-center justify-center shrink-0 bg-brand text-white hover:bg-brand-hover transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring disabled:opacity-40 disabled:pointer-events-none"
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported panel — desktop inline + mobile sheet (DA-23)             */
/* ------------------------------------------------------------------ */

export function InternalAgentPanel() {
  const { isOpen, closePanel } = useAgentPanel();
  const { isMobile } = useSidebar();

  // Mobile: full-screen sheet overlay (DA-23 mutual exclusion)
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && closePanel()}>
        <SheetContent side="right" showCloseButton={false} className="w-full sm:max-w-full p-0">
          <SheetTitle className="sr-only">Commander</SheetTitle>
          <AgentPanelContent />
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: inline right panel
  if (!isOpen) return null;

  return (
    <div className="shrink-0 w-80 border-l border-border h-full overflow-hidden bg-background">
      <AgentPanelContent />
    </div>
  );
}
