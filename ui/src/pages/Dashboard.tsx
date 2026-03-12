import { useEffect } from "react";
import { Link } from "@/lib/router";
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
} from "lucide-react";
import type { HomeSummary, RecentActivityItem } from "@paperclipai/shared";

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
  const { openOnboarding } = useDialog();
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
  const actionQueue = data ? buildActionQueue(data) : [];
  const pulseLine = data ? buildPulseLine(data) : "";

  return (
    <div className="space-y-6 max-w-3xl">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}
        </h1>
        {data && (
          <p className="text-sm text-muted-foreground mt-1">{pulseLine}</p>
        )}
      </div>

      {/* Action Queue */}
      {actionQueue.length > 0 && (
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
      {data && actionQueue.length === 0 && data.recentActivity.length === 0 && (
        <div className="border border-border rounded-md p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        </div>
      )}
    </div>
  );
}
