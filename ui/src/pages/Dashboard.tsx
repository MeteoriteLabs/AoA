import { useEffect, type ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { useHomeSummary } from "../hooks/useHomeSummary";
import { authApi } from "../api/auth";
import { suggestionsApi } from "../api/suggestions";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useLiveAgentCount } from "../hooks/useLiveAgentCount";
import { useTeamAccess } from "../hooks/useTeamAccess";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { HomeBoard } from "../components/home/HomeBoard";
import { buildActionGroups, getTotalActionCount } from "../components/home/actionQueue";
import { Home, MessageSquare, Plus, Target } from "lucide-react";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function QuickActionCard({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-3 border border-border rounded-md hover:bg-accent/50 hover:border-accent transition-colors text-sm font-medium group"
    >
      <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
        <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <span>{label}</span>
    </button>
  );
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openNewIssue, openDiscussionCapture, openNewGoal } = useDialog();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const liveAgentCount = useLiveAgentCount();

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Home" }]);
  }, [setBreadcrumbs]);

  // Shared with Layout's WS9 first-run full-bleed check via the same
  // `queryKeys.home(companyId)` entry (see useHomeSummary).
  const { data, isLoading, error } = useHomeSummary(selectedCompanyId);

  const { data: suggestions = [] } = useQuery({
    queryKey: queryKeys.suggestions.pending(selectedCompanyId!),
    queryFn: () => suggestionsApi.pending(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { role: teamRole } = useTeamAccess(selectedCompanyId);

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={Home}
          message="Welcome to AoA. Set up your first company and agent to get started."
          action="Get Started"
          onAction={() => navigate("/onboarding")}
        />
      );
    }
    return <EmptyState icon={Home} message="Create or select a company to get started." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const userName = session?.user?.name?.split(" ")[0] ?? null;
  const greeting = userName ? `${getGreeting()}, ${userName}` : getGreeting();
  // Onboarding (spine + persona fork + in-flight tail) lives ENTIRELY in the
  // standalone /onboarding dark flow and never takes over the dashboard. A
  // founder who hasn't finished their first-run tail is routed back to
  // /onboarding by the index gate (see resumeFirstRunCompanyId), so Home is
  // always the steady dashboard here.

  const actionGroups = data ? buildActionGroups(data) : [];
  const totalActions = getTotalActionCount(actionGroups, suggestions.length);
  const statusParts: string[] = [];

  if (liveAgentCount > 0) {
    statusParts.push(`${liveAgentCount} agent${liveAgentCount === 1 ? "" : "s"} working`);
  }
  if (totalActions > 0) {
    statusParts.push(`${totalActions} item${totalActions === 1 ? "" : "s"} need attention`);
  }

  const statusLine = statusParts.length > 0
    ? statusParts.join(" · ")
    : "All clear — nothing needs your attention right now.";

  return (
    <div className="space-y-6 max-w-3xl">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        {data && <p className="text-sm text-muted-foreground mt-1">{statusLine}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <QuickActionCard icon={Plus} label="+ New Task" onClick={() => openNewIssue()} />
        <QuickActionCard icon={MessageSquare} label="+ Discussion" onClick={() => openDiscussionCapture()} />
        <QuickActionCard icon={Target} label="+ New Goal" onClick={() => openNewGoal()} />
      </div>

      <HomeBoard companyId={selectedCompanyId} role={teamRole} />

      {data && actionGroups.length === 0 && suggestions.length === 0 && data.recentActivity.length === 0 && (
        <div className="border border-border rounded-md p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        </div>
      )}
    </div>
  );
}
