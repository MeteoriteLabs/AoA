import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useTeamAccess } from "../hooks/useTeamAccess";
import { queryKeys } from "../lib/queryKeys";
import { OrgTreeTab } from "../components/team/OrgTreeTab";
import { AgentsTab } from "../components/team/AgentsTab";
import { HumansTab } from "../components/team/HumansTab";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

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

  const { summary: teamSummary, permissions, role, isLoading: isTeamLoading } = useTeamAccess(selectedCompanyId);

  // Org tree (shared: OrgTreeTab + AgentsTab)
  const orgTreeQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.org.tree(selectedCompanyId)
      : ["org", "none", "tree"],
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  // Agents list
  const agentsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.agents.list(selectedCompanyId)
      : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Team" }]);
  }, [setBreadcrumbs]);

  // Tab change — clears highlight when manually switching
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

  // OrgTree node click → switch to corresponding tab + highlight
  const handleNodeClick = useCallback(
    (id: string, nodeType: "agent" | "user") => {
      const next = new URLSearchParams();
      next.set("tab", nodeType === "agent" ? "agents" : "humans");
      next.set("highlight", id);
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  // Cache invalidation — all three data sets
  const invalidateAll = useCallback(() => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.org.tree(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId) });
  }, [queryClient, selectedCompanyId]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  const isLoading =
    (activeTab === "org" && orgTreeQuery.isLoading) ||
    (activeTab === "agents" && agentsQuery.isLoading) ||
    (activeTab === "humans" && isTeamLoading);

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
          <PageTabBar
            items={TAB_ITEMS}
            value={activeTab}
            onValueChange={handleTabChange}
          />

          {isLoading && <PageSkeleton variant={activeTab === "org" ? "org-chart" : "list"} />}

          {!isLoading && activeTab === "org" && (
            <OrgTreeTab
              orgTree={orgTreeQuery.data ?? []}
              onNodeClick={handleNodeClick}
            />
          )}

          {!isLoading && activeTab === "agents" && (
            <AgentsTab
              agents={agentsQuery.data ?? []}
              orgTree={orgTreeQuery.data ?? []}
              highlightId={highlightId}
              permissions={{ isFounder: role === "founder" }}
              onMutationSuccess={invalidateAll}
            />
          )}

          {!isLoading && activeTab === "humans" && teamSummary && (
            <HumansTab
              teamSummary={teamSummary}
              highlightId={highlightId}
              permissions={permissions}
              onMutationSuccess={invalidateAll}
            />
          )}
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
