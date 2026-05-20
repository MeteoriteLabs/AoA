import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { AgentPanelContent } from "../components/InternalAgentPanel";
import { CommanderSessionsSidebar } from "../components/CommanderSessionsSidebar";
import { commanderConversationsApi } from "../api/internal-agent";

export function Commander() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Commander" }]);
  }, [setBreadcrumbs]);

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
