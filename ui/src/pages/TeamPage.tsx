import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useTeamAccess } from "../hooks/useTeamAccess";
import { queryKeys } from "../lib/queryKeys";
import { OrgTreeTab } from "../components/team/OrgTreeTab";
import { AgentsTab } from "../components/team/AgentsTab";
import { HumansTab } from "../components/team/HumansTab";
import { EmptyState } from "../components/EmptyState";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Users, Network, Bot } from "lucide-react";

type TabValue = "org" | "agents" | "humans";

const VALID_TABS: TabValue[] = ["org", "agents", "humans"];

function isValidTab(value: string | null): value is TabValue {
  return value !== null && VALID_TABS.includes(value as TabValue);
}

export function TeamPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab: TabValue = isValidTab(searchParams.get("tab"))
    ? (searchParams.get("tab") as TabValue)
    : "org";
  const highlightId = searchParams.get("highlight");

  const { summary, permissions, isLoading: isTeamLoading } = useTeamAccess(selectedCompanyId);

  // Fetch org tree
  const { data: orgTree, isLoading: isOrgLoading } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.org(selectedCompanyId) : ["org", "none"],
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  // Fetch agents list
  const { data: agentsList, isLoading: isAgentsLoading } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  // Fetch projects (for departments)
  const { data: projects } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const departments = useMemo(
    () => (projects ?? []).filter((p) => p.type === "department"),
    [projects],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Team" }]);
  }, [setBreadcrumbs]);

  // Invalidate all team-related queries after any mutation
  const invalidateAll = useCallback(() => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId) });
  }, [queryClient, selectedCompanyId]);

  // Tab change handler (preserves highlight only when setting tab from click-through)
  const handleTabChange = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("tab", value);
      // Clear highlight when manually switching tabs
      next.delete("highlight");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // OrgTree node click -> switch tab + highlight
  const handleNodeClick = useCallback(
    (id: string, nodeType: "agent" | "user") => {
      const next = new URLSearchParams();
      next.set("tab", nodeType === "agent" ? "agents" : "humans");
      next.set("highlight", id);
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  // Clear highlight param after animation completes
  const handleHighlightClear = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("highlight");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Page header */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Team</h1>
            <p className="text-sm text-muted-foreground">
              Manage your organization, agents, and team members.
            </p>
          </div>
        </div>

        {/* Tabbed content */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList variant="line">
            <TabsTrigger value="org">
              <Network className="h-4 w-4" />
              Org Tree
            </TabsTrigger>
            <TabsTrigger value="agents">
              <Bot className="h-4 w-4" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="humans">
              <Users className="h-4 w-4" />
              Humans
            </TabsTrigger>
          </TabsList>

          <TabsContent value="org">
            <OrgTreeTab
              orgTree={orgTree ?? []}
              agents={agentsList ?? []}
              isLoading={isOrgLoading || isAgentsLoading}
              onNodeClick={handleNodeClick}
            />
          </TabsContent>

          <TabsContent value="agents">
            <AgentsTab
              agents={agentsList ?? []}
              isLoading={isAgentsLoading}
              highlightId={activeTab === "agents" ? highlightId : null}
              onHighlightClear={handleHighlightClear}
            />
          </TabsContent>

          <TabsContent value="humans">
            <HumansTab
              summary={summary}
              companyId={selectedCompanyId}
              departments={departments}
              isLoading={isTeamLoading}
              highlightId={activeTab === "humans" ? highlightId : null}
              onHighlightClear={handleHighlightClear}
              onMutationSuccess={invalidateAll}
              permissions={permissions}
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
