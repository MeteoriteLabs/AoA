import { useEffect, useRef } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "./components/Layout";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { authApi } from "./api/auth";
import { healthApi } from "./api/health";
import { Dashboard } from "./pages/Dashboard";
import { Lobby } from "./pages/Lobby";
import { Companies } from "./pages/Companies";
import { Agents } from "./pages/Agents";
import { AgentDetail } from "./pages/AgentDetail";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Issues } from "./pages/Issues";
import { Goals } from "./pages/Goals";
import { GoalDetail } from "./pages/GoalDetail";
import { Memory } from "./pages/Memory";
import { Approvals } from "./pages/Approvals";
import { ApprovalDetail } from "./pages/ApprovalDetail";
import { Inbox } from "./pages/Inbox";
import { SettingsPage } from "./pages/SettingsPage";
import { InternalAgentSettingsPage } from "./pages/InternalAgentSettingsPage";
import { VisionMission } from "./pages/VisionMission";
import { DesignGuide } from "./pages/DesignGuide";
import { TeamPage } from "./pages/TeamPage";
import { HumanDetail } from "./pages/HumanDetail";
import { ActiveAgents } from "./pages/ActiveAgents";
import { DiscussionCaptureModal } from "./components/DiscussionCaptureModal";
import { Discussions } from "./pages/Discussions";
import { DiscussionDetail } from "./pages/DiscussionDetail";
import { Skills } from "./pages/Skills";
import { AuthPage } from "./pages/Auth";
import { BoardClaimPage } from "./pages/BoardClaim";
import { InviteLandingPage } from "./pages/InviteLanding";
import { queryKeys } from "./lib/queryKeys";
import { useCompany } from "./context/CompanyContext";
import { useDialog } from "./context/DialogContext";

function BootstrapPendingPage() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Instance setup required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No instance admin exists yet. Run this command in your AoA environment to generate
          the first admin invite URL:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
{`pnpm paperclipai auth bootstrap-ceo`}
        </pre>
      </div>
    </div>
  );
}

function CloudAccessGate() {
  const location = useLocation();
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  const isAuthenticatedMode = healthQuery.data?.deploymentMode === "authenticated";
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: isAuthenticatedMode,
    retry: false,
  });

  if (healthQuery.isLoading || (isAuthenticatedMode && sessionQuery.isLoading)) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  if (healthQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-destructive">
        {healthQuery.error instanceof Error ? healthQuery.error.message : "Failed to load app state"}
      </div>
    );
  }

  if (isAuthenticatedMode && healthQuery.data?.bootstrapStatus === "bootstrap_pending") {
    return <BootstrapPendingPage />;
  }

  if (isAuthenticatedMode && !sessionQuery.data) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  return <Outlet />;
}

function boardRoutes() {
  return (
    <>
      <Route index element={<Navigate to="home" replace />} />
      <Route path="home" element={<Dashboard />} />
      <Route path="companies" element={<Companies />} />
      <Route path="vision" element={<VisionMission />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="settings/internal-agent" element={<InternalAgentSettingsPage />} />
      <Route path="company/settings" element={<Navigate to="../settings" replace />} />
      <Route path="org" element={<TeamPage />} />
      <Route path="team/:userId" element={<HumanDetail />} />
      <Route path="team/:userId/:tab" element={<HumanDetail />} />
      <Route path="agents" element={<Navigate to="/agents/all" replace />} />
      <Route path="agents/all" element={<Agents />} />
      <Route path="agents/active" element={<Agents />} />
      <Route path="agents/paused" element={<Agents />} />
      <Route path="agents/error" element={<Agents />} />
      <Route path="agents/:agentId" element={<AgentDetail />} />
      <Route path="agents/:agentId/:tab" element={<AgentDetail />} />
      <Route path="agents/:agentId/runs/:runId" element={<AgentDetail />} />
      <Route path="projects" element={<Projects />} />
      <Route path="projects/:projectId" element={<ProjectDetail />} />
      <Route path="projects/:projectId/overview" element={<ProjectDetail />} />
      <Route path="projects/:projectId/goals" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues/:filter" element={<ProjectDetail />} />
      <Route path="projects/:projectId/team" element={<ProjectDetail />} />
      <Route path="projects/:projectId/budget" element={<ProjectDetail />} />
      <Route path="projects/:projectId/discussions" element={<ProjectDetail />} />
      <Route path="issues" element={<Issues />} />
      <Route path="issues/all" element={<Navigate to="/issues" replace />} />
      <Route path="issues/active" element={<Navigate to="/issues" replace />} />
      <Route path="issues/backlog" element={<Navigate to="/issues" replace />} />
      <Route path="issues/done" element={<Navigate to="/issues" replace />} />
      <Route path="issues/recent" element={<Navigate to="/issues" replace />} />
      <Route path="issues/:issueId" element={<Issues />} />
      <Route path="goals" element={<Goals />} />
      <Route path="goals/:goalId" element={<GoalDetail />} />
      <Route path="skills/*" element={<Skills />} />
      <Route path="discussions" element={<Discussions />} />
      <Route path="discussions/:discussionId" element={<DiscussionDetail />} />
      <Route path="briefs" element={<Navigate to="/discussions" replace />} />
      <Route path="briefs/:briefId" element={<Navigate to="/discussions" replace />} />
      <Route path="debriefs" element={<Navigate to="/discussions" replace />} />
      <Route path="active-agents" element={<ActiveAgents />} />
      <Route path="memory" element={<Memory />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="costs" element={<Navigate to="../settings" replace />} />
      <Route path="activity" element={<Navigate to="../settings" replace />} />
      <Route path="inbox" element={<Navigate to="/inbox/new" replace />} />
      <Route path="inbox/new" element={<Inbox />} />
      <Route path="inbox/all" element={<Inbox />} />
      <Route path="design-guide" element={<DesignGuide />} />
    </>
  );
}

function CompanyRootRedirect() {
  const { companies, selectedCompany, loading } = useCompany();
  const { onboardingOpen } = useDialog();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  // Keep the first-run onboarding mounted until it completes.
  if (onboardingOpen) {
    return <NoCompaniesStartPage autoOpen={false} />;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    return <NoCompaniesStartPage />;
  }

  return <Navigate to={`/${targetCompany.issuePrefix}/home`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    return <NoCompaniesStartPage />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

function NoCompaniesStartPage({ autoOpen = true }: { autoOpen?: boolean }) {
  const { openOnboarding } = useDialog();
  const opened = useRef(false);

  useEffect(() => {
    if (!autoOpen) return;
    if (opened.current) return;
    opened.current = true;
    openOnboarding();
  }, [autoOpen, openOnboarding]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Create your first company</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating a company.
        </p>
        <div className="mt-4">
          <Button onClick={() => openOnboarding()}>New Company</Button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="auth" element={<AuthPage />} />
        <Route path="board-claim/:token" element={<BoardClaimPage />} />
        <Route path="invite/:token" element={<InviteLandingPage />} />

        <Route element={<CloudAccessGate />}>
          <Route index element={<Lobby />} />
          <Route path="companies" element={<UnprefixedBoardRedirect />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="discussions" element={<UnprefixedBoardRedirect />} />
          <Route path="discussions/:discussionId" element={<UnprefixedBoardRedirect />} />
          <Route path="briefs" element={<Navigate to="/discussions" replace />} />
          <Route path="briefs/*" element={<Navigate to="/discussions" replace />} />
          <Route path="vision" element={<UnprefixedBoardRedirect />} />
          <Route path="memory" element={<UnprefixedBoardRedirect />} />
          <Route path="projects" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/overview" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/goals" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/team" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/budget" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/*" element={<UnprefixedBoardRedirect />} />
          <Route path=":companyPrefix" element={<Layout />}>
            {boardRoutes()}
          </Route>
        </Route>
      </Routes>
      <OnboardingWizard />
      <DiscussionCaptureModal />
    </>
  );
}
