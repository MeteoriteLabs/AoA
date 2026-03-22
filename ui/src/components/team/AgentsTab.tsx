import { useEffect, useRef } from "react";
import { useNavigate } from "@/lib/router";
import type { Agent } from "@paperclipai/shared";
import { AgentIcon } from "../AgentIconPicker";
import { StatusBadge } from "../StatusBadge";
import { EmptyState } from "../EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { agentStatusDot, agentStatusDotDefault } from "../../lib/status-colors";
import { relativeTime, cn, agentUrl } from "../../lib/utils";
import { Bot } from "lucide-react";

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  openclaw: "OpenClaw",
  process: "Process",
  http: "HTTP",
  claude_api: "Claude API",
  openai_api: "OpenAI API",
  gemini_api: "Gemini API",
};

const roleLabels: Record<string, string> = {
  ceo: "CEO", cto: "CTO", cmo: "CMO", cfo: "CFO",
  engineer: "Engineer", designer: "Designer", pm: "PM",
  qa: "QA", devops: "DevOps", researcher: "Researcher", general: "General",
};

interface AgentsTabProps {
  agents: Agent[];
  isLoading: boolean;
  highlightId: string | null;
  onHighlightClear: () => void;
}

export function AgentsTab({ agents, isLoading, highlightId, onHighlightClear }: AgentsTabProps) {
  const navigate = useNavigate();
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Scroll to highlighted card and flash animation
  useEffect(() => {
    if (!highlightId) return;

    const el = cardRefs.current.get(highlightId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-blue-400");

      highlightTimerRef.current = setTimeout(() => {
        el.classList.remove("ring-2", "ring-blue-400");
        onHighlightClear();
      }, 2000);
    } else {
      // Card not found, clear highlight immediately
      onHighlightClear();
    }

    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [highlightId, onHighlightClear]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const nonTerminated = agents.filter((a) => a.status !== "terminated");

  if (nonTerminated.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        message="No agents yet"
        description="Create your first agent to get started. Agents can be assigned tasks and will execute them autonomously."
      />
    );
  }

  return (
    <div className="space-y-3">
      {nonTerminated.map((agent) => {
        const statusColor = agentStatusDot[agent.status] ?? agentStatusDotDefault;

        return (
          <div
            key={agent.id}
            ref={(el) => {
              if (el) cardRefs.current.set(agent.id, el);
              else cardRefs.current.delete(agent.id);
            }}
            className="rounded-xl border border-border bg-card p-4 cursor-pointer hover:shadow-md hover:border-foreground/20 transition-all duration-150"
            onClick={() => navigate(agentUrl(agent))}
          >
            <div className="flex items-start gap-3">
              {/* Agent icon + status dot */}
              <div className="relative shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-accent">
                  <AgentIcon icon={agent.icon} className="h-5 w-5" />
                </div>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                    statusColor,
                  )}
                />
              </div>

              {/* Name + role + adapter */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold truncate">{agent.name}</h3>
                  <StatusBadge status={agent.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {roleLabels[agent.role] ?? agent.role}
                  {agent.title ? ` \u00B7 ${agent.title}` : ""}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                  <span className="font-mono">
                    {adapterLabels[agent.adapterType] ?? agent.adapterType}
                  </span>
                  {agent.lastHeartbeatAt && (
                    <>
                      <span className="text-border">&middot;</span>
                      <span>Last active {relativeTime(agent.lastHeartbeatAt)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
