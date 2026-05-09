import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { agentsApi } from "../api/agents";
import { teamApi } from "../api/team";
import { teamsApi } from "../api/teams";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { useTeamAccess } from "../hooks/useTeamAccess";
import { queryKeys } from "../lib/queryKeys";
import { OrgTreeTab, type OrgNodeAction } from "../components/team/OrgTreeTab";
import { AgentsTab } from "../components/team/AgentsTab";
import { HumansTab } from "../components/team/HumansTab";
import { TeamLayout, type TeamSectionId } from "../components/team/TeamLayout";
import { TeamsListPage } from "./TeamsListPage";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { TooltipProvider } from "@/components/ui/tooltip";

const VALID_TABS = ["org", "agents", "humans", "teams"] as const;
type TeamTab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is TeamTab {
  return VALID_TABS.includes(value as TeamTab);
}

const TAB_TO_SECTION: Record<TeamTab, TeamSectionId> = {
  org: "org-tree",
  agents: "agents",
  humans: "humans",
  teams: "teams",
};

const SECTION_TO_TAB: Record<TeamSectionId, TeamTab> = {
  "org-tree": "org",
  agents: "agents",
  humans: "humans",
  teams: "teams",
};

export function TeamPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get("tab");
  const activeTab: TeamTab = isValidTab(rawTab) ? rawTab : "org";
  const highlightId = searchParams.get("highlight");

  const navigate = useNavigate();
  const { pushToast } = useToast();
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

  // Teams list — used only for the secondary-sidebar count badge.
  // The TeamsListPage owns its own copy of this query (cached via TanStack
  // Query so the dual subscription is free).
  const teamsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.teams.list(selectedCompanyId)
      : ["teams", "none"],
    queryFn: () => teamsApi.list(selectedCompanyId!),
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

  // Cache invalidation — all four data sets
  const invalidateAll = useCallback(() => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.org.tree(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.teams.list(selectedCompanyId) });
  }, [queryClient, selectedCompanyId]);

  const resendInviteMutation = useMutation({
    mutationFn: (inviteId: string) => teamApi.resendInvite(selectedCompanyId!, inviteId),
    onSuccess: () => {
      invalidateAll();
      pushToast({ title: "Invite resent", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Failed", body: err.message, tone: "error" }),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => teamApi.revokeInvite(selectedCompanyId!, inviteId),
    onSuccess: () => {
      invalidateAll();
      pushToast({ title: "Invite revoked", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Failed", body: err.message, tone: "error" }),
  });

  const handleNodeAction = useCallback(
    (action: OrgNodeAction) => {
      switch (action.type) {
        case "view-profile":
          navigate(`/team/${action.userId}`);
          break;
        case "view-agent":
          navigate(`/agents/${action.agentId}`);
          break;
        case "change-role":
          setSearchParams({ tab: "humans", highlight: action.userId });
          break;
        case "change-reports-to":
          setSearchParams({ tab: "agents", highlight: action.agentId });
          break;
        case "remove":
          setSearchParams({ tab: "humans", highlight: action.userId });
          break;
        case "resend-invite":
          resendInviteMutation.mutate(action.inviteId);
          break;
        case "revoke-invite":
          revokeInviteMutation.mutate(action.inviteId);
          break;
      }
    },
    [navigate, setSearchParams, resendInviteMutation, revokeInviteMutation],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  const isLoading =
    (activeTab === "org" && orgTreeQuery.isLoading) ||
    (activeTab === "agents" && agentsQuery.isLoading) ||
    (activeTab === "humans" && isTeamLoading);

  return (
    <TooltipProvider>
      <TeamLayout
        activeSection={TAB_TO_SECTION[activeTab]}
        onSectionChange={(id) => handleTabChange(SECTION_TO_TAB[id])}
        counts={{
          agents: agentsQuery.data?.length,
          humans: teamSummary?.members.length,
          teams: teamsQuery.data?.items.length,
        }}
      >
        {isLoading && <PageSkeleton variant={activeTab === "org" ? "org-chart" : "list"} />}

        {!isLoading && activeTab === "org" && (
          <OrgTreeTab
            orgTree={orgTreeQuery.data ?? []}
            pendingInvites={teamSummary?.pendingInvites}
            onNodeClick={handleNodeClick}
            onNodeAction={handleNodeAction}
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
            isSystemAdmin={teamSummary.currentUser?.isSystemAdmin ?? false}
            onMutationSuccess={invalidateAll}
          />
        )}

        {!isLoading && activeTab === "teams" && <TeamsListPage />}
      </TeamLayout>
    </TooltipProvider>
  );
}
