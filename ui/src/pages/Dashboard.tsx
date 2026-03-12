import { useEffect } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { homeApi } from "../api/dashboard";
import { authApi } from "../api/auth";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { timeAgo } from "../lib/timeAgo";
import {
  Home,
  FileText,
  CheckCircle2,
  CalendarClock,
  Ban,
  Brain,
  Activity,
  Eye,
  Building2,
  Bot,
  Target,
  Check,
  ChevronRight,
} from "lucide-react";
import type { HomeSummary, RecentActivityItem, SetupStatus } from "@paperclipai/shared";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function buildPulseLine(data: HomeSummary): string {
  const parts: string[] = [];
  if (data.briefsAwaitingReview > 0) {
    parts.push(`${data.briefsAwaitingReview} brief${data.briefsAwaitingReview === 1 ? "" : "s"} to review`);
  }
  if (data.tasksInReview > 0) {
    parts.push(`${data.tasksInReview} task${data.tasksInReview === 1 ? "" : "s"} in review`);
  }
  if (data.myTasksDueToday.length > 0) {
    parts.push(`${data.myTasksDueToday.length} task${data.myTasksDueToday.length === 1 ? "" : "s"} due today`);
  }
  if (data.blockedTasks > 0) {
    parts.push(`${data.blockedTasks} blocked task${data.blockedTasks === 1 ? "" : "s"}`);
  }
  if (data.pendingMemoryItems > 0) {
    parts.push(`${data.pendingMemoryItems} pending memory item${data.pendingMemoryItems === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "All clear — nothing needs your attention right now.";
  return parts.join(", ");
}

interface ActionQueueItem {
  key: string;
  icon: React.ElementType;
  label: string;
  count?: number;
  to: string;
  priority: number;
}

function buildActionQueue(data: HomeSummary): ActionQueueItem[] {
  const items: ActionQueueItem[] = [];

  if (data.briefsAwaitingReview > 0) {
    items.push({
      key: "briefs",
      icon: FileText,
      label: `${data.briefsAwaitingReview} brief${data.briefsAwaitingReview === 1 ? "" : "s"} awaiting review`,
      to: "/briefs",
      priority: 0,
    });
  }

  if (data.tasksInReview > 0) {
    items.push({
      key: "review",
      icon: CheckCircle2,
      label: `${data.tasksInReview} task${data.tasksInReview === 1 ? "" : "s"} in review`,
      to: "/issues?status=in_review",
      priority: 1,
    });
  }

  for (const task of data.myTasksDueToday) {
    items.push({
      key: `due-${task.id}`,
      icon: CalendarClock,
      label: task.title,
      to: `/issues/${task.id}`,
      priority: 2,
    });
  }

  if (data.blockedTasks > 0) {
    items.push({
      key: "blocked",
      icon: Ban,
      label: `${data.blockedTasks} blocked task${data.blockedTasks === 1 ? "" : "s"}`,
      to: "/issues?status=blocked",
      priority: 3,
    });
  }

  if (data.pendingMemoryItems > 0) {
    items.push({
      key: "memory",
      icon: Brain,
      label: `${data.pendingMemoryItems} pending memory item${data.pendingMemoryItems === 1 ? "" : "s"}`,
      to: "/memory?status=pending",
      priority: 4,
    });
  }

  return items.sort((a, b) => a.priority - b.priority);
}

function isSetupComplete(s: SetupStatus): boolean {
  return s.hasVisionMission && s.hasDepartment && s.hasAgent && s.hasGoal;
}

interface SetupStepDef {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  done: boolean;
}

function buildSetupSteps(s: SetupStatus): SetupStepDef[] {
  return [
    {
      key: "vision",
      label: "Set your Vision & Mission",
      description: "Define what your company stands for and where it's headed.",
      icon: Eye,
      done: s.hasVisionMission,
    },
    {
      key: "department",
      label: "Create your first department",
      description: "Departments organize your agents and their work.",
      icon: Building2,
      done: s.hasDepartment,
    },
    {
      key: "agent",
      label: "Add your first agent",
      description: "Agents execute tasks autonomously on your behalf.",
      icon: Bot,
      done: s.hasAgent,
    },
    {
      key: "goal",
      label: "Create your first goal",
      description: "Goals give your agents direction and purpose.",
      icon: Target,
      done: s.hasGoal,
    },
  ];
}

function formatAction(item: RecentActivityItem): string {
  const verb = item.action.replace(/[._]/g, " ");
  return verb;
}

function activityEntityName(item: RecentActivityItem): string {
  const details = item.details as Record<string, unknown> | null;
  if (details?.title && typeof details.title === "string") return details.title;
  if (details?.name && typeof details.name === "string") return details.name;
  return item.entityType;
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding, openNewProject, openNewAgent, openNewGoal } = useDialog();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Home" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.home(selectedCompanyId!),
    queryFn: () => homeApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={Home}
          message="Welcome to AoA. Set up your first company and agent to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={Home} message="Create or select a company to get started." />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const userName = session?.user?.name?.split(" ")[0] ?? null;
  const greeting = userName ? `${getGreeting()}, ${userName}` : getGreeting();
  const showOnboarding = data?.setupStatus && !isSetupComplete(data.setupStatus);
  const actionQueue = data ? buildActionQueue(data) : [];
  const pulseLine = data ? buildPulseLine(data) : "";

  const handleStepClick = (key: string) => {
    switch (key) {
      case "vision":
        navigate("/vision");
        break;
      case "department":
        openNewProject({ type: "department" });
        break;
      case "agent":
        openNewAgent();
        break;
      case "goal":
        openNewGoal();
        break;
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}
        </h1>
        {data && !showOnboarding && (
          <p className="text-sm text-muted-foreground mt-1">{pulseLine}</p>
        )}
        {showOnboarding && (
          <p className="text-sm text-muted-foreground mt-1">
            Let's get your workspace set up. Complete these steps to get started.
          </p>
        )}
      </div>

      {/* Onboarding Setup Flow */}
      {showOnboarding && data?.setupStatus && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Getting Started
            </h2>
            <span className="text-xs text-muted-foreground">
              {buildSetupSteps(data.setupStatus).filter((s) => s.done).length} of 4 complete
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-muted rounded-full mb-4 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{
                width: `${(buildSetupSteps(data.setupStatus).filter((s) => s.done).length / 4) * 100}%`,
              }}
            />
          </div>

          <div className="border border-border divide-y divide-border rounded-md overflow-hidden">
            {buildSetupSteps(data.setupStatus).map((step) => {
              const Icon = step.icon;
              // First incomplete step is the current one
              const steps = buildSetupSteps(data.setupStatus);
              const currentStepKey = steps.find((s) => !s.done)?.key;
              const isCurrent = step.key === currentStepKey;

              return (
                <button
                  key={step.key}
                  onClick={() => !step.done && handleStepClick(step.key)}
                  disabled={step.done}
                  className={`flex items-center gap-3 px-4 py-3 text-sm w-full text-left transition-colors ${
                    step.done
                      ? "bg-muted/30 text-muted-foreground"
                      : isCurrent
                        ? "bg-accent/50"
                        : "hover:bg-accent/30"
                  }`}
                >
                  {step.done ? (
                    <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                      <Check className="h-3.5 w-3.5 text-primary" />
                    </div>
                  ) : (
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
                        isCurrent ? "bg-primary/15" : "bg-muted"
                      }`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={step.done ? "line-through" : "font-medium"}>
                      {step.label}
                    </span>
                    {isCurrent && (
                      <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                    )}
                  </div>
                  {!step.done && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Queue */}
      {!showOnboarding && actionQueue.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Action Queue
          </h2>
          <div className="border border-border divide-y divide-border rounded-md overflow-hidden">
            {actionQueue.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{item.label}</span>
                  {item.key.startsWith("due-") && (
                    <span className="text-xs text-muted-foreground shrink-0">Due today</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's Activity */}
      {data && data.recentActivity.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Today's Activity
          </h2>
          <div className="border border-border divide-y divide-border rounded-md overflow-hidden">
            {data.recentActivity.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate">
                  <span className="text-muted-foreground">{formatAction(item)}</span>
                  {" "}
                  <span className="font-medium">{activityEntityName(item)}</span>
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {timeAgo(item.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All clear state */}
      {!showOnboarding && data && actionQueue.length === 0 && data.recentActivity.length === 0 && (
        <div className="border border-border rounded-md p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        </div>
      )}
    </div>
  );
}
