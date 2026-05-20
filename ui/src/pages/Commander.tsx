import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { AgentPanelContent } from "../components/InternalAgentPanel";
import { CommanderSessionsSidebar } from "../components/CommanderSessionsSidebar";
import { commanderConversationsApi, internalAgentApi } from "../api/internal-agent";
import { queryKeys } from "../lib/queryKeys";

export function Commander() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Commander" }]);
  }, [setBreadcrumbs]);

  const { data: config } = useQuery({
    queryKey: queryKeys.agentConfig(selectedCompanyId!),
    queryFn: () => internalAgentApi.getConfig(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const handleNewConversation = async () => {
    if (!selectedCompanyId) return;
    const conv = await commanderConversationsApi.create(selectedCompanyId);
    setActiveConversationId(conv.id);
    queryClient.invalidateQueries({ queryKey: ["commander-conversations"] });
  };

  return (
    // Negative margins bleed out of the global <main> padding (p-4 md:p-6)
    // so Commander chrome goes edge-to-edge.
    <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 md:-m-6">
      {/* Compressed topbar — 40px tall, no big heading */}
      <div className="flex items-center justify-between h-10 px-5 border-b border-border bg-bg shrink-0">
        <div className="flex items-center gap-2 text-xs text-dim">
          <span>AoA Online</span>
          <span className="text-very-dim">›</span>
          <span className="text-text font-medium">Commander</span>
          <span className="ml-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[0.7rem] bg-card-2 border border-border">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
            online
          </span>
        </div>
        <div className="flex items-center gap-3">
          {config?.model && (
            <span className="font-mono text-[0.7rem] text-dim">
              {config.model}
            </span>
          )}
        </div>
      </div>

      {/* Best-effort badge (non-claude_cli warning) */}
      {config?.cliTool && config.cliTool !== "claude_cli" && (
        <div className="px-5 py-1.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-200 inline-flex items-center gap-1.5 shrink-0">
          <Info className="h-3 w-3 shrink-0" />
          <span>Confirmation gates use best-effort detection on <code className="font-mono">{config.cliTool}</code>. Switch to Claude CLI for strict gating.</span>
        </div>
      )}

      {/* Chat workspace — sessions + chat panel, fills remaining height */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <CommanderSessionsSidebar
          activeConversationId={activeConversationId}
          onSelect={setActiveConversationId}
          onNewConversation={handleNewConversation}
        />
        <div className="flex-1 min-w-0 overflow-hidden bg-bg">
          <AgentPanelContent conversationId={activeConversationId} />
        </div>
      </div>
    </div>
  );
}
