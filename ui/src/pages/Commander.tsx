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
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-[1.6rem] font-bold tracking-tight">
          Commander<span className="text-brand">.</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your always-on AI assistant for coordination and proactive monitoring.
        </p>
        {config?.cliTool && config.cliTool !== "claude_cli" && (
          <div className="mb-3 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 inline-flex items-center gap-1.5">
            <Info className="h-3 w-3 shrink-0" />
            <span>
              Confirmation gates use best-effort detection on <code className="font-mono">{config.cliTool}</code>. Switch to Claude CLI for strict gating.
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden rounded-lg border border-border">
        {/* Sessions sidebar */}
        <CommanderSessionsSidebar
          activeConversationId={activeConversationId}
          onSelect={setActiveConversationId}
          onNewConversation={handleNewConversation}
        />

        {/* Conversation area */}
        <div className="flex-1 min-w-0 overflow-hidden bg-background">
          <AgentPanelContent conversationId={activeConversationId} />
        </div>
      </div>
    </div>
  );
}
