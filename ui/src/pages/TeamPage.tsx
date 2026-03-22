import { useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Bot } from "lucide-react";
import { agentsApi, type OrgNode } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useTeamAccess } from "../hooks/useTeamAccess";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { PageTabBar } from "../components/PageTabBar";
import { AgentCard } from "../components/AgentCard";
import { Tabs } from "@/components/ui/tabs";
import { Team } from "./Team";
import type { Agent } from "@paperclipai/shared";

const VALID_TABS = ["org", "agents", "humans"] as const;
type TeamTab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is TeamTab {
  return VALID_TABS.includes(value as TeamTab);
}

const TAB_ITEMS = [
  { value: "org", label: "Org Tree" },
  { value: "agents", label: "Agents" },
  { value: "humans", label: "Humans" },
];

export function TeamPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get("tab");
  const activeTab: TeamTab = isValidTab(rawTab) ? rawTab : "org";
  const highlightId = searchParams.get("highlight");

  useEffect(() => {
    setBreadcrumbs([{ label: "Team" }]);
  }, [setBreadcrumbs]);

  const handleTabChange = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", value);
        next.delete("highlight");
        return next;
      });
    },
    [setSearchParams],
  );

  // Shared data: org tree
  const orgTreeQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.org.tree(selectedCompanyId)
      : ["org", "none", "tree"],
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && activeTab === "org",
  });

  // Shared data: agents list
  const agentsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.agents.list(selectedCompanyId)
      : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && activeTab === "agents",
  });

  // Shared data: team summary (humans)
  const teamAccess = useTeamAccess(
    activeTab === "humans" ? selectedCompanyId : undefined,
  );

  // Cache invalidation helper — invalidates all three datasets
  const invalidateAll = useCallback(() => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.org.tree(selectedCompanyId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.agents.list(selectedCompanyId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.team.summary(selectedCompanyId),
    });
  }, [queryClient, selectedCompanyId]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  const isLoading =
    (activeTab === "org" && orgTreeQuery.isLoading) ||
    (activeTab === "agents" && agentsQuery.isLoading) ||
    (activeTab === "humans" && teamAccess.isLoading);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PageTabBar
          items={TAB_ITEMS}
          value={activeTab}
          onValueChange={handleTabChange}
        />
      </Tabs>

      {isLoading && <PageSkeleton variant="list" />}

      {!isLoading && activeTab === "org" && (
        <OrgTreeTab orgTree={orgTreeQuery.data ?? []} highlightId={highlightId} />
      )}

      {!isLoading && activeTab === "agents" && (
        <AgentsTab agents={agentsQuery.data ?? []} highlightId={highlightId} />
      )}

      {!isLoading && activeTab === "humans" && <Team />}
    </div>
  );
}

function OrgTreeTab({
  orgTree,
  highlightId,
}: {
  orgTree: OrgNode[];
  highlightId: string | null;
}) {
  if (orgTree.length === 0) {
    return (
      <EmptyState
        icon={Users}
        message="No organizational hierarchy defined"
        description="Add agents with reporting relationships to build your org tree."
      />
    );
  }

  return (
    <div className="border border-border py-1">
      {orgTree.map((node) => (
        <OrgTreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          highlightId={highlightId}
        />
      ))}
    </div>
  );
}

function OrgTreeNodeRow({
  node,
  depth,
  highlightId,
}: {
  node: OrgNode;
  depth: number;
  highlightId: string | null;
}) {
  const isHighlighted = node.id === highlightId;

  return (
    <div style={{ paddingLeft: depth * 24 }}>
      <div
        className={`flex items-center gap-3 px-3 py-2 text-sm ${
          isHighlighted
            ? "bg-accent/50 ring-1 ring-ring"
            : "hover:bg-accent/30"
        } transition-colors`}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-muted-foreground/40" />
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-medium">{node.name}</span>
          <span className="text-xs text-muted-foreground ml-2">{node.role}</span>
        </div>
      </div>
      {node.reports && node.reports.length > 0 && (
        <div className="border-l border-border/50 ml-4">
          {node.reports.map((child) => (
            <OrgTreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              highlightId={highlightId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentsTab({
  agents,
  highlightId,
}: {
  agents: Agent[];
  highlightId: string | null;
}) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        message="No agents yet"
        description="Create agents to build your AI workforce."
        entityColor="var(--entity-agent)"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className={
            agent.id === highlightId ? "ring-2 ring-ring rounded-xl" : ""
          }
        >
          <AgentCard agent={agent} liveRun={null} trustScore={null} />
        </div>
      ))}
    </div>
  );
}
