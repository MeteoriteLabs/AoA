import { useState, useEffect, useRef, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, AgentTrustScore } from "@paperclipai/shared";
import type { OrgNode } from "../../api/agents";
import { agentsApi } from "../../api/agents";
import { useCompany } from "../../context/CompanyContext";
import { useDialog } from "../../context/DialogContext";
import { useToast } from "../../context/ToastContext";
import { queryKeys } from "../../lib/queryKeys";
import { agentStatusDot, agentStatusDotDefault } from "../../lib/status-colors";
import { cn, formatCents } from "../../lib/utils";
import { adapterLabels, roleLabels } from "../agent-config-primitives";
import { AgentIcon } from "../AgentIconPicker";
import { TrustScoreBadge } from "../TrustScoreBadge";
import { StatusBadge } from "../StatusBadge";
import { NewAgentDialog } from "../NewAgentDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  Edit2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Trash2,
  XCircle,
  User,
} from "lucide-react";

interface AgentsTabPermissions {
  isFounder: boolean;
}

interface AgentsTabProps {
  agents: Agent[];
  orgTree: OrgNode[];
  highlightId?: string | null;
  permissions: AgentsTabPermissions;
  trustScores?: Map<string, AgentTrustScore>;
  onMutationSuccess?: () => void;
}

export function AgentsTab({ agents, highlightId, permissions, trustScores, onMutationSuccess }: AgentsTabProps) {
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialog();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: "terminate" | "delete"; agent: Agent } | null>(null);

  const highlightRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted card
  useEffect(() => {
    if (highlightId && highlightRef.current && typeof highlightRef.current.scrollIntoView === "function") {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlightId]);

  // Build reportsTo name map from agents
  const reportsToMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

  const pauseResume = useMutation({
    mutationFn: async ({ agent, action }: { agent: Agent; action: "pause" | "resume" }) => {
      return action === "pause"
        ? agentsApi.pause(agent.id, selectedCompanyId ?? undefined)
        : agentsApi.resume(agent.id, selectedCompanyId ?? undefined);
    },
    onSuccess: (_, { agent, action }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
      onMutationSuccess?.();
      pushToast({
        title: action === "pause" ? "Agent paused" : "Agent resumed",
        body: agent.name,
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Action failed",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const terminateAgent = useMutation({
    mutationFn: (agent: Agent) =>
      agentsApi.terminate(agent.id, selectedCompanyId ?? undefined),
    onSuccess: (_, agent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      onMutationSuccess?.();
      pushToast({ title: "Agent terminated", body: agent.name, tone: "success" });
      setConfirmAction(null);
    },
    onError: (error) => {
      pushToast({
        title: "Terminate failed",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const deleteAgent = useMutation({
    mutationFn: (agent: Agent) =>
      agentsApi.remove(agent.id, selectedCompanyId ?? undefined),
    onSuccess: (_, agent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      onMutationSuccess?.();
      pushToast({ title: "Agent deleted", body: agent.name, tone: "success" });
      setConfirmAction(null);
    },
    onError: (error) => {
      pushToast({
        title: "Delete failed",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  function handleEdit(agent: Agent) {
    setEditAgent(agent);
    setEditOpen(true);
  }

  if (agents.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-12 text-center">
          <div className="space-y-3">
            <Bot className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No agents yet</p>
            {permissions.isFounder && (
              <Button size="sm" onClick={openNewAgent}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Agent
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header action */}
      {permissions.isFounder && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={openNewAgent}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Agent
          </Button>
        </div>
      )}

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const isHighlighted = agent.id === highlightId;
          const statusColor = agentStatusDot[agent.status] ?? agentStatusDotDefault;
          const isPaused = agent.status === "paused";
          const isTerminated = agent.status === "terminated";
          const reportsToName = agent.reportsTo ? (reportsToMap.get(agent.reportsTo) ?? null) : null;
          const score = trustScores?.get(agent.id) ?? null;

          return (
            <div
              key={agent.id}
              ref={isHighlighted ? highlightRef : undefined}
              data-testid={`agent-card-${agent.id}`}
              className={cn(
                "group relative border border-border bg-card rounded-lg p-4 transition-all duration-200",
                isHighlighted && "ring-2 ring-primary animate-pulse"
              )}
            >
              {/* Header: Icon + Name + Status + Actions */}
              <div className="flex items-start gap-3">
                <div className="shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-accent">
                  <AgentIcon icon={agent.icon} className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold truncate">{agent.name}</h3>
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className={cn("absolute inline-flex h-full w-full rounded-full", statusColor)} />
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {roleLabels[agent.role] ?? agent.role}
                    {agent.title ? ` \u00B7 ${agent.title}` : ""}
                  </p>
                </div>

                {/* Quick actions */}
                <div
                  className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {/* Pause/Resume */}
                  {!isTerminated && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => pauseResume.mutate({ agent, action: isPaused ? "resume" : "pause" })}
                          disabled={pauseResume.isPending || agent.status === "pending_approval"}
                        >
                          {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{isPaused ? "Resume" : "Pause"}</TooltipContent>
                    </Tooltip>
                  )}

                  {/* Edit */}
                  {permissions.isFounder && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleEdit(agent)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Edit</TooltipContent>
                    </Tooltip>
                  )}

                  {/* More menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {!isTerminated && (
                        <DropdownMenuItem
                          onClick={() => setConfirmAction({ type: "terminate", agent })}
                          className="text-orange-600 dark:text-orange-400"
                        >
                          <XCircle className="h-3.5 w-3.5 mr-2" />
                          Terminate
                        </DropdownMenuItem>
                      )}
                      {permissions.isFounder && (
                        <>
                          {!isTerminated && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setConfirmAction({ type: "delete", agent })}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Body: adapter + reports to */}
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">
                    {adapterLabels[agent.adapterType] ?? agent.adapterType}
                  </span>
                  <span className="text-border">&middot;</span>
                  <StatusBadge status={agent.status} />
                </div>
                {reportsToName && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    <span>Reports to: {reportsToName}</span>
                  </div>
                )}
              </div>

              {/* Footer: trust score + budget */}
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {agent.budgetMonthlyCents > 0
                    ? `Budget: ${formatCents(agent.budgetMonthlyCents)}/mo`
                    : "No budget set"}
                </span>
                <TrustScoreBadge score={score} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Agent Dialog */}
      {editOpen && (
        <NewAgentDialog
          agent={editAgent}
          open={editOpen}
          onOpenChange={setEditOpen}
          onUpdated={() => setEditAgent(null)}
        />
      )}

      {/* Confirmation Dialog */}
      {confirmAction && (
        <ConfirmActionDialog
          type={confirmAction.type}
          agentName={confirmAction.agent.name}
          isPending={confirmAction.type === "terminate" ? terminateAgent.isPending : deleteAgent.isPending}
          onConfirm={() => {
            if (confirmAction.type === "terminate") {
              terminateAgent.mutate(confirmAction.agent);
            } else {
              deleteAgent.mutate(confirmAction.agent);
            }
          }}
          onCancel={() => setConfirmAction(null)}
          isFounder={permissions.isFounder}
        />
      )}
    </div>
  );
}

function ConfirmActionDialog({
  type,
  agentName,
  isPending,
  onConfirm,
  onCancel,
  isFounder,
}: {
  type: "terminate" | "delete";
  agentName: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isFounder: boolean;
}) {
  const isTerminate = type === "terminate";

  // Delete requires founder
  if (type === "delete" && !isFounder) {
    return null;
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isTerminate ? "Terminate agent" : "Delete agent"}
          </DialogTitle>
          <DialogDescription>
            {isTerminate
              ? `Are you sure you want to terminate "${agentName}"? The agent will stop all work and cannot be resumed.`
              : `Are you sure you want to permanently delete "${agentName}"? This action cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending
              ? (isTerminate ? "Terminating\u2026" : "Deleting\u2026")
              : (isTerminate ? "Terminate" : "Delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
