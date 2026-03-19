import { useEffect, useState } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { homeApi } from "../api/dashboard";
import { authApi } from "../api/auth";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useLiveAgentCount } from "../hooks/useLiveAgentCount";
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
  ChevronDown,
  AlertTriangle,
  AlertCircle,
  Clock,
  Lightbulb,
  Plus,
} from "lucide-react";
import type { HomeSummary, RecentActivityItem, SetupStatus, GoalGapNudge, GoalProgress } from "@paperclipai/shared";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// --- Action Queue Group Types (T10) ---

interface ActionGroupItem {
  key: string;
  label: string;
  sublabel?: string;
  to: string;
}

interface ActionGroup {
  id: string;
  title: string;
  icon: React.ElementType;
  items: ActionGroupItem[];
}

function buildActionGroups(data: HomeSummary): ActionGroup[] {
  const groups: ActionGroup[] = [];

  // Needs Review: briefs awaiting review + tasks in review
  const needsReviewItems: ActionGroupItem[] = [];
  if (data.briefsAwaitingReview > 0) {
    needsReviewItems.push({
      key: "briefs-review",
      label: `${data.briefsAwaitingReview} brief${data.briefsAwaitingReview === 1 ? "" : "s"} awaiting review`,
      to: "/briefs",
    });
  }
  if (data.tasksInReview > 0) {
    needsReviewItems.push({
      key: "tasks-review",
      label: `${data.tasksInReview} task${data.tasksInReview === 1 ? "" : "s"} in review`,
      to: "/issues?status=in_review",
    });
  }
  if (needsReviewItems.length > 0) {
    groups.push({ id: "needs-review", title: "Needs Review", icon: Eye, items: needsReviewItems });
  }

  // Blocked
  if (data.blockedTasks > 0) {
    groups.push({
      id: "blocked",
      title: "Blocked",
      icon: AlertCircle,
      items: [{
        key: "blocked-tasks",
        label: `${data.blockedTasks} blocked task${data.blockedTasks === 1 ? "" : "s"}`,
        to: "/issues?status=blocked",
      }],
    });
  }

  // Due Today
  if (data.myTasksDueToday.length > 0) {
    groups.push({
      id: "due-today",
      title: "Due Today",
      icon: Clock,
      items: data.myTasksDueToday.map((task) => ({
        key: `due-${task.id}`,
        label: task.title,
        sublabel: task.status === "in_progress" ? "In progress" : task.status === "todo" ? "To do" : task.status,
        to: `/issues/${task.id}`,
      })),
    });
  }

  // Suggestions: pending memory items + goal nudges
  const suggestionItems: ActionGroupItem[] = [];
  if (data.pendingMemoryItems > 0) {
    suggestionItems.push({
      key: "memory-pending",
      label: `${data.pendingMemoryItems} pending memory item${data.pendingMemoryItems === 1 ? "" : "s"}`,
      to: "/memory?status=pending",
    });
  }
  if (data.nudges) {
    for (const nudge of data.nudges) {
      suggestionItems.push({
        key: `nudge-${nudge.goalId}`,
        label: nudge.goalTitle,
        sublabel: nudge.message,
        to: `/goals/${nudge.goalId}`,
      });
    }
  }
  if (suggestionItems.length > 0) {
    groups.push({ id: "suggestions", title: "Suggestions", icon: Lightbulb, items: suggestionItems });
  }

  return groups;
}

function getTotalActionCount(groups: ActionGroup[]): number {
  return groups.reduce((sum, g) => sum + g.items.length, 0);
}

// --- Setup helpers ---

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

// --- Activity helpers ---

function formatAction(item: RecentActivityItem): string {
  const verb = item.action.replace(/[._]/g, " ").replace(/\bissue\b/g, "task");
  return verb;
}

function activityEntityName(item: RecentActivityItem): string {
  const details = item.details as Record<string, unknown> | null;
  if (details?.title && typeof details.title === "string") return details.title;
  if (details?.name && typeof details.name === "string") return details.name;
  return item.entityType;
}

// --- Collapsible Action Group Component (T10) ---

function ActionQueueGroup({ group }: { group: ActionGroup }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = group.icon;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm font-medium hover:bg-accent/30 transition-colors"
      >
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="flex-1 text-left">{group.title}</span>
        <span className="text-xs font-normal bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full tabular-nums">
          {group.items.length}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${
            expanded ? "" : "-rotate-90"
          }`}
        />
      </button>
      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {group.items.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
            >
              <span className="flex-1 min-w-0 truncate">{item.label}</span>
              {item.sublabel && (
                <span className="text-xs text-muted-foreground shrink-0">{item.sublabel}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Quick Action Card Component (T8) ---

function QuickActionCard({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
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

// --- Main Dashboard Component ---

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding, openNewIssue, openDebrief, openNewProject, openNewAgent, openNewGoal } = useDialog();
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
  const actionGroups = data ? buildActionGroups(data) : [];
  const totalActions = getTotalActionCount(actionGroups);

  // Build status line: "{X} agents working · {Y} tasks need attention"
  const statusParts: string[] = [];
  if (liveAgentCount > 0) {
    statusParts.push(`${liveAgentCount} agent${liveAgentCount === 1 ? "" : "s"} working`);
  }
  if (totalActions > 0) {
    statusParts.push(`${totalActions} task${totalActions === 1 ? "" : "s"} need attention`);
  }
  const statusLine = statusParts.length > 0
    ? statusParts.join(" \u00B7 ")
    : "All clear \u2014 nothing needs your attention right now.";

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

      {/* Greeting + Status Line */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}
        </h1>
        {data && !showOnboarding && (
          <p className="text-sm text-muted-foreground mt-1">{statusLine}</p>
        )}
        {showOnboarding && (
          <p className="text-sm text-muted-foreground mt-1">
            Let's get your workspace set up. Complete these steps to get started.
          </p>
        )}
      </div>

      {/* Quick Action Cards (T8) */}
      {!showOnboarding && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickActionCard icon={Plus} label="+ New Task" onClick={() => openNewIssue()} />
          <QuickActionCard icon={FileText} label="+ Debrief" onClick={() => openDebrief()} />
          <QuickActionCard icon={Target} label="+ New Goal" onClick={() => openNewGoal()} />
        </div>
      )}

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

      {/* Action Queue — Categorized Groups (T10) */}
      {!showOnboarding && actionGroups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Action Queue
          </h2>
          {actionGroups.map((group) => (
            <ActionQueueGroup key={group.id} group={group} />
          ))}
        </div>
      )}

      {/* Goal Progress */}
      {!showOnboarding && data && data.goalProgress && data.goalProgress.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Active Goals
          </h2>
          <div className="border border-border divide-y divide-border rounded-md overflow-hidden">
            {data.goalProgress.map((goal: GoalProgress) => (
              <Link
                key={goal.id}
                to={`/goals/${goal.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
              >
                <Target className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{goal.title}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${
                      goal.status === "at_risk"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-primary/10 text-primary"
                    }`}>
                      {goal.status === "at_risk" ? "At Risk" : "Active"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${goal.progressPercent}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {goal.doneTasks}/{goal.totalTasks} tasks
                    </span>
                  </div>
                </div>
              </Link>
            ))}
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
      {!showOnboarding && data && actionGroups.length === 0 && data.recentActivity.length === 0 && (
        <div className="border border-border rounded-md p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        </div>
      )}
    </div>
  );
}
