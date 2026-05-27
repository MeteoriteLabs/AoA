import { useState } from "react";
import type { Agent, AgentTrustScore } from "@armyofagents/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../../context/CompanyContext";
import { cn } from "../../lib/utils";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NewAoaAgentDialog } from "./NewAoaAgentDialog";
import { CommanderRosterTab } from "./CommanderRosterTab";
import { CommanderKanbanTab } from "./CommanderKanbanTab";
import { CommanderGovernanceTab } from "./CommanderGovernanceTab";
import type { LiveRunForIssue } from "../../api/heartbeats";

type SubTab = "roster" | "kanban" | "governance";

interface CommanderTeamTabPermissions {
  isFounder: boolean;
}

interface CommanderTeamTabProps {
  agents: Agent[];
  trustScores: AgentTrustScore[];
  liveRuns: LiveRunForIssue[];
  permissions: CommanderTeamTabPermissions;
  onMutationSuccess?: () => void;
}

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "roster",     label: "Roster" },
  { id: "kanban",     label: "Kanban" },
  { id: "governance", label: "Governance" },
];

export function CommanderTeamTab({
  agents,
  trustScores,
  liveRuns,
  permissions,
  onMutationSuccess,
}: CommanderTeamTabProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("roster");
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleNewAoaAgent() {
    setDialogOpen(true);
  }

  function handleDialogSuccess() {
    queryClient.invalidateQueries({ queryKey: ["aoa-agents", selectedCompanyId] });
    onMutationSuccess?.();
  }

  function handleGovernanceMutation() {
    queryClient.invalidateQueries({ queryKey: ["aoa-agents", selectedCompanyId] });
    onMutationSuccess?.();
  }

  if (agents.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Bot />}
          title="No AoA agents yet"
          description="Deploy your first Commander or AoA member agent to build your autonomous team."
          action={
            permissions.isFounder ? (
              <Button size="sm" onClick={handleNewAoaAgent}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New AoA Agent
              </Button>
            ) : undefined
          }
        />
        {selectedCompanyId && (
          <NewAoaAgentDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            companyId={selectedCompanyId}
            onSuccess={handleDialogSuccess}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="px-5 pt-4">
        {/* Sub-tab bar */}
        <div className="flex gap-0 border-b border-border mb-4">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              data-testid={`commander-subtab-${tab.id}`}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                activeSubTab === tab.id
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sub-tab content */}
        {activeSubTab === "roster" && (
          <CommanderRosterTab
            agents={agents}
            trustScores={trustScores}
            isFounder={permissions.isFounder}
            onNewAgent={handleNewAoaAgent}
          />
        )}
        {activeSubTab === "kanban" && (
          <CommanderKanbanTab agents={agents} liveRuns={liveRuns} />
        )}
        {activeSubTab === "governance" && (
          <CommanderGovernanceTab
            agents={agents}
            trustScores={trustScores}
            isFounder={permissions.isFounder}
            onMutationSuccess={handleGovernanceMutation}
          />
        )}
      </div>

      {selectedCompanyId && (
        <NewAoaAgentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          companyId={selectedCompanyId}
          onSuccess={handleDialogSuccess}
        />
      )}
    </>
  );
}
