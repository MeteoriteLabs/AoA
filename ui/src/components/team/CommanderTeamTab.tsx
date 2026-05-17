import type { Agent } from "@armyofagents/shared";
import { useNavigate } from "@/lib/router";
import { useToast } from "../../context/ToastContext";
import { cn } from "../../lib/utils";
import { StatusBadge } from "../StatusBadge";
import { AgentIcon } from "../AgentIconPicker";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Bot, Plus } from "lucide-react";

interface CommanderTeamTabPermissions {
  isFounder: boolean;
}

interface CommanderTeamTabProps {
  agents: Agent[];
  permissions: CommanderTeamTabPermissions;
  onMutationSuccess?: () => void;
}

export function CommanderTeamTab({ agents, permissions, onMutationSuccess: _onMutationSuccess }: CommanderTeamTabProps) {
  const navigate = useNavigate();
  const { pushToast } = useToast();

  function handleNewAoaAgent() {
    pushToast({ title: "Coming soon", body: "AoA agent creation is not yet available.", tone: "info" });
  }

  if (agents.length === 0) {
    return (
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
    );
  }

  return (
    <div className="space-y-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">
            Commander Team <span className="ml-1 text-xs font-medium text-muted-foreground">{agents.length}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">AoA agents in this company</p>
        </div>
        {permissions.isFounder && (
          <Button size="sm" variant="outline" onClick={handleNewAoaAgent}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New AoA Agent
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const isLead = (agent as any).runtimeConfig?.aoa?.role === "lead";

          return (
            <div
              key={agent.id}
              data-testid={`commander-agent-card-${agent.id}`}
              className={cn(
                "group relative border border-border bg-card rounded-lg p-4 transition-all duration-150 cursor-pointer hover:border-primary/40 hover:shadow-sm",
              )}
              onClick={() => navigate(`/team/aoa/${agent.id}`)}
            >
              {/* Header: Icon + Name + Lead badge */}
              <div className="flex items-start gap-3">
                <div className="shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-accent">
                  <AgentIcon icon={(agent as any).icon} className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold truncate">{agent.name}</h3>
                    {isLead && (
                      <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand ring-1 ring-inset ring-brand/20">
                        Lead
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {isLead ? "Commander" : "Member"}
                    {" · "}
                    {agent.adapterType}
                  </p>
                </div>
              </div>

              {/* Body: status */}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status={agent.status} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
