import { useEffect, useMemo, useState, type ElementType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@/lib/router";
import {
  MEMORY_ITEM_CATEGORIES,
  MEMORY_ITEM_LAYERS,
  type GoalProgress,
  type HomeSummary,
  type MemoryItemCategory,
  type MemoryItemLayer,
  type RecentActivityItem,
  type SetupStatus,
  type Suggestion,
} from "@armyofagents/shared";
import { homeApi } from "../api/dashboard";
import { authApi } from "../api/auth";
import { suggestionsApi } from "../api/suggestions";
import { memoryApi } from "../api/memory";
import { goalsApi } from "../api/goals";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { useLiveAgentCount } from "../hooks/useLiveAgentCount";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  Bot,
  Brain,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Eye,
  GitPullRequest,
  Home,
  Lightbulb,
  MessageSquare,
  Plus,
  RotateCcw,
  ShieldAlert,
  Target,
  Workflow,
  type LucideIcon,
} from "lucide-react";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface ActionGroupItem {
  key: string;
  label: string;
  sublabel?: string;
  to: string;
}

interface ActionGroup {
  id: string;
  title: string;
  icon: ElementType;
  items: ActionGroupItem[];
}

interface SetupStepDef {
  key: string;
  label: string;
  description: string;
  icon: ElementType;
  done: boolean;
}

interface SuggestedMemoryDraft {
  suggestionId: string;
  title: string;
  content: string;
  category: MemoryItemCategory;
  layer: MemoryItemLayer;
  departmentId: string;
  goalId: string;
  taskId: string;
  tags: string;
}

const SUGGESTION_CATEGORY_ICONS: Record<Suggestion["category"], LucideIcon> = {
  goal_gap: Target,
  pipeline_bottleneck: Workflow,
  memory_gap: Brain,
  pattern_detected: RotateCcw,
  budget_optimization: CircleDollarSign,
  recurring_work: CalendarClock,
  risk_flag: ShieldAlert,
  workload_balance: ArrowRightLeft,
  agent_proposal: GitPullRequest,
};

const MEMORY_LAYER_LABELS: Record<MemoryItemLayer, string> = {
  identity: "Identity",
  domain: "Domain",
  active_context: "Active Context",
  working: "Working",
};

function buildActionGroups(data: HomeSummary): ActionGroup[] {
  const groups: ActionGroup[] = [];
  const needsReviewItems: ActionGroupItem[] = [];

  if (data.discussionsPendingReview > 0) {
    needsReviewItems.push({
      key: "discussions-review",
      label: `${data.discussionsPendingReview} discussion${data.discussionsPendingReview === 1 ? "" : "s"} pending review`,
      to: "/discussions",
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

  return groups;
}

function getTotalActionCount(groups: ActionGroup[], suggestionCount: number): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0) + suggestionCount;
}

function isSetupComplete(s: SetupStatus): boolean {
  return s.hasVisionMission && s.hasDepartment && s.hasAgent && s.hasGoal;
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
      icon: Activity,
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
  return item.action.replace(/[._]/g, " ").replace(/\bissue\b/g, "task");
}

function activityEntityName(item: RecentActivityItem): string {
  const details = item.details as Record<string, unknown> | null;
  if (details?.title && typeof details.title === "string") return details.title;
  if (details?.name && typeof details.name === "string") return details.name;
  return item.entityType === "issue" ? "task" : item.entityType;
}

function readString(payload: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readStringArray(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readMemoryCategory(payload: Record<string, unknown> | null | undefined): MemoryItemCategory {
  const category = readString(payload, "category", "memoryCategory");
  return MEMORY_ITEM_CATEGORIES.includes(category as MemoryItemCategory) ? category as MemoryItemCategory : "reference";
}

function readMemoryLayer(payload: Record<string, unknown> | null | undefined): MemoryItemLayer {
  const layer = readString(payload, "layer", "memoryLayer");
  return MEMORY_ITEM_LAYERS.includes(layer as MemoryItemLayer) ? layer as MemoryItemLayer : "domain";
}

function getSuggestionTaskDefaults(suggestion: Suggestion) {
  const payload = suggestion.actionPayload;
  return {
    title: readString(payload, "taskTitle", "title") || suggestion.title,
    description: readString(payload, "description", "taskDescription", "content") || suggestion.evidence || "",
    status: readString(payload, "status") || "todo",
    priority: readString(payload, "priority") || "medium",
    projectId: readString(payload, "projectId"),
    assigneeAgentId: readString(payload, "assigneeAgentId", "agentId"),
  };
}

function getSuggestedMemoryDraft(suggestion: Suggestion): SuggestedMemoryDraft {
  const payload = suggestion.actionPayload;
  return {
    suggestionId: suggestion.id,
    title: readString(payload, "memoryTitle", "title") || suggestion.title,
    content: readString(payload, "content", "description", "memoryContent") || suggestion.evidence || "",
    category: readMemoryCategory(payload),
    layer: readMemoryLayer(payload),
    departmentId: readString(payload, "departmentId"),
    goalId: readString(payload, "goalId"),
    taskId: readString(payload, "taskId"),
    tags: readStringArray(payload, "tags").join(", "),
  };
}

function getSuggestionAgentMeta(suggestion: Suggestion) {
  const payload = suggestion.actionPayload;
  const name = readString(payload, "agentName", "proposedByAgentName", "actorName");
  const avatarUrl = readString(payload, "agentAvatarUrl", "proposedByAgentAvatarUrl", "avatarUrl");
  return name ? { name, avatarUrl: avatarUrl || null } : null;
}

function getArchiveTargetTitle(suggestion: Suggestion) {
  return readString(suggestion.actionPayload, "memoryTitle", "targetTitle", "title") || suggestion.title;
}

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
              {item.sublabel && <span className="text-xs text-muted-foreground shrink-0">{item.sublabel}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
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

function SuggestionCard({
  suggestion,
  exiting,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  exiting: boolean;
  busy: boolean;
  onAccept: (suggestion: Suggestion) => void;
  onDismiss: (suggestion: Suggestion) => void;
}) {
  const Icon = SUGGESTION_CATEGORY_ICONS[suggestion.category] ?? Lightbulb;
  const agentMeta = suggestion.category === "agent_proposal" ? getSuggestionAgentMeta(suggestion) : null;

  return (
    <div
      className={`rounded-md border border-border bg-card p-4 transition-all duration-200 ${
        exiting ? "opacity-0 translate-x-2 scale-[0.98]" : "opacity-100 translate-x-0"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-medium leading-5">{suggestion.title}</h3>
              {suggestion.evidence && <p className="mt-1 text-sm text-muted-foreground">{suggestion.evidence}</p>}
            </div>
            {agentMeta && (
              <div className="rounded-full border border-border bg-muted/40 px-2 py-1 text-xs">
                <Identity name={agentMeta.name} avatarUrl={agentMeta.avatarUrl} size="xs" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground capitalize">{suggestion.category.replace(/_/g, " ")}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => onDismiss(suggestion)} disabled={busy}>
                Dismiss
              </Button>
              <Button size="sm" onClick={() => onAccept(suggestion)} disabled={busy}>
                Accept
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestedMemoryDialog({
  companyId,
  draft,
  open,
  onOpenChange,
  onCreated,
}: {
  companyId: string;
  draft: SuggestedMemoryDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryItemCategory>("reference");
  const [layer, setLayer] = useState<MemoryItemLayer>("domain");
  const [departmentId, setDepartmentId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!draft || !open) return;
    setTitle(draft.title);
    setContent(draft.content);
    setCategory(draft.category);
    setLayer(draft.layer);
    setDepartmentId(draft.departmentId);
    setGoalId(draft.goalId);
    setTaskId(draft.taskId);
    setTags(draft.tags);
  }, [draft, open]);

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(companyId),
    queryFn: () => goalsApi.list(companyId),
    enabled: open && layer === "active_context",
  });

  const { data: tasks } = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
    enabled: open && layer === "working",
  });

  const createMemory = useMutation({
    mutationFn: async () => {
      await memoryApi.create(companyId, {
        title: title.trim(),
        content: content.trim(),
        category,
        source: "founder",
        status: "approved",
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        departmentId: departmentId || null,
        createdBy: "founder",
        layer,
        priority: 0,
        visibility: departmentId ? "scoped" : "shared",
        goalId: layer === "active_context" && goalId ? goalId : null,
        taskId: layer === "working" && taskId ? taskId : null,
      });
      await onCreated();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
      onOpenChange(false);
      pushToast({ title: "Suggestion accepted", body: "Memory item created", tone: "success" });
    },
    onError: (error: Error) => {
      pushToast({ title: "Unable to create memory item", body: error.message, tone: "error" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Suggested Memory</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-memory-title">Title</Label>
            <Input id="dashboard-memory-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as MemoryItemCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_ITEM_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item} className="capitalize">
                      {item.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Layer</Label>
              <Select value={layer} onValueChange={(value) => setLayer(value as MemoryItemLayer)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_ITEM_LAYERS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {MEMORY_LAYER_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {layer === "active_context" && (
            <div className="space-y-1.5">
              <Label>Goal</Label>
              <Select value={goalId || "none"} onValueChange={(value) => setGoalId(value === "none" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a goal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(goals ?? []).map((goal) => (
                    <SelectItem key={goal.id} value={goal.id}>
                      {goal.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {layer === "working" && (
            <div className="space-y-1.5">
              <Label>Task</Label>
              <Select value={taskId || "none"} onValueChange={(value) => setTaskId(value === "none" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a task" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(tasks ?? []).map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-memory-tags">Tags</Label>
            <Input id="dashboard-memory-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-memory-content">Content</Label>
            <Textarea
              id="dashboard-memory-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={createMemory.isPending}>
            Cancel
          </Button>
          <Button onClick={() => createMemory.mutate()} disabled={!title.trim() || !content.trim() || createMemory.isPending}>
            {createMemory.isPending ? "Saving..." : "Create Memory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding, openNewIssue, openDiscussionCapture, openNewProject, openNewAgent, openNewGoal } = useDialog();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setBreadcrumbs } = useBreadcrumbs();
  const liveAgentCount = useLiveAgentCount();
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [exitingSuggestionIds, setExitingSuggestionIds] = useState<string[]>([]);
  const [busySuggestionIds, setBusySuggestionIds] = useState<string[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<SuggestedMemoryDraft | null>(null);

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

  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery({
    queryKey: queryKeys.suggestions.pending(selectedCompanyId!),
    queryFn: () => suggestionsApi.pending(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const detectSuggestions = useMutation({
    mutationFn: (companyId: string) => suggestionsApi.detect(companyId),
    onSuccess: async (_, companyId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.suggestions.pending(companyId) });
    },
  });

  useEffect(() => {
    if (!selectedCompanyId) return;
    detectSuggestions.mutate(selectedCompanyId);
    // Trigger detection when the page loads for the active company.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  const acceptSuggestion = useMutation({
    mutationFn: ({ companyId, suggestionId }: { companyId: string; suggestionId: string }) =>
      suggestionsApi.accept(companyId, suggestionId),
  });

  const dismissSuggestion = useMutation({
    mutationFn: ({ companyId, suggestionId }: { companyId: string; suggestionId: string }) =>
      suggestionsApi.dismiss(companyId, suggestionId),
  });

  const visibleSuggestions = useMemo(
    () => (showAllSuggestions ? suggestions : suggestions.slice(0, 10)),
    [showAllSuggestions, suggestions],
  );

  function markSuggestionBusy(suggestionId: string, busy: boolean) {
    setBusySuggestionIds((current) =>
      busy ? [...new Set([...current, suggestionId])] : current.filter((id) => id !== suggestionId),
    );
  }

  function removeSuggestionCard(suggestionId: string) {
    setExitingSuggestionIds((current) => [...new Set([...current, suggestionId])]);
    window.setTimeout(() => {
      queryClient.setQueryData<Suggestion[]>(
        queryKeys.suggestions.pending(selectedCompanyId!),
        (current) => (current ?? []).filter((suggestion) => suggestion.id !== suggestionId),
      );
      setExitingSuggestionIds((current) => current.filter((id) => id !== suggestionId));
    }, 180);
  }

  async function acceptAndRemove(suggestion: Suggestion) {
    if (!selectedCompanyId) return;
    markSuggestionBusy(suggestion.id, true);
    try {
      await acceptSuggestion.mutateAsync({ companyId: selectedCompanyId, suggestionId: suggestion.id });
      removeSuggestionCard(suggestion.id);
    } finally {
      markSuggestionBusy(suggestion.id, false);
    }
  }

  async function handleAccept(suggestion: Suggestion) {
    if (!selectedCompanyId) return;

    try {
      switch (suggestion.actionType) {
        case "create_task":
          openNewIssue({
            ...getSuggestionTaskDefaults(suggestion),
            onCreated: async () => {
              try {
                await acceptAndRemove(suggestion);
                pushToast({ title: "Suggestion accepted", body: "Task created", tone: "success" });
              } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to accept suggestion";
                pushToast({ title: "Task created, but suggestion was not cleared", body: message, tone: "error" });
              }
            },
          });
          return;
        case "suggest_memory":
          setMemoryDraft(getSuggestedMemoryDraft(suggestion));
          return;
        case "archive_memory":
          if (!window.confirm(`Archive '${getArchiveTargetTitle(suggestion)}'?`)) return;
          await acceptAndRemove(suggestion);
          pushToast({ title: "Suggestion accepted", body: "Memory item archived", tone: "success" });
          return;
        case "flag_risk":
          await acceptAndRemove(suggestion);
          pushToast({ title: "Suggestion accepted", body: "Risk flagged", tone: "success" });
          return;
        default:
          await acceptAndRemove(suggestion);
          pushToast({ title: "Suggestion accepted", tone: "success" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to accept suggestion";
      pushToast({ title: "Unable to accept suggestion", body: message, tone: "error" });
    }
  }

  async function handleDismiss(suggestion: Suggestion) {
    if (!selectedCompanyId) return;
    markSuggestionBusy(suggestion.id, true);
    try {
      await dismissSuggestion.mutateAsync({ companyId: selectedCompanyId, suggestionId: suggestion.id });
      removeSuggestionCard(suggestion.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to dismiss suggestion";
      pushToast({ title: "Unable to dismiss suggestion", body: message, tone: "error" });
    } finally {
      markSuggestionBusy(suggestion.id, false);
    }
  }

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
    return <EmptyState icon={Home} message="Create or select a company to get started." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const userName = session?.user?.name?.split(" ")[0] ?? null;
  const greeting = userName ? `${getGreeting()}, ${userName}` : getGreeting();
  const showOnboarding = data?.setupStatus && !isSetupComplete(data.setupStatus);
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

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        {data && !showOnboarding && <p className="text-sm text-muted-foreground mt-1">{statusLine}</p>}
        {showOnboarding && (
          <p className="text-sm text-muted-foreground mt-1">
            Let's get your workspace set up. Complete these steps to get started.
          </p>
        )}
      </div>

      {!showOnboarding && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickActionCard icon={Plus} label="+ New Task" onClick={() => openNewIssue()} />
          <QuickActionCard icon={MessageSquare} label="+ Discussion" onClick={() => openDiscussionCapture()} />
          <QuickActionCard icon={Target} label="+ New Goal" onClick={() => openNewGoal()} />
        </div>
      )}

      {showOnboarding && data?.setupStatus && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Getting Started</h2>
            <span className="text-xs text-muted-foreground">
              {buildSetupSteps(data.setupStatus).filter((step) => step.done).length} of 4 complete
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full mb-4 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{
                width: `${(buildSetupSteps(data.setupStatus).filter((step) => step.done).length / 4) * 100}%`,
              }}
            />
          </div>
          <div className="border border-border divide-y divide-border rounded-md overflow-hidden">
            {buildSetupSteps(data.setupStatus).map((step) => {
              const Icon = step.icon;
              const currentStepKey = buildSetupSteps(data.setupStatus).find((item) => !item.done)?.key;
              const isCurrent = step.key === currentStepKey;

              return (
                <button
                  key={step.key}
                  onClick={() => !step.done && handleStepClick(step.key)}
                  disabled={step.done}
                  className={`flex items-center gap-3 px-4 py-3 text-sm w-full text-left transition-colors ${
                    step.done ? "bg-muted/30 text-muted-foreground" : isCurrent ? "bg-accent/50" : "hover:bg-accent/30"
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
                    <span className={step.done ? "line-through" : "font-medium"}>{step.label}</span>
                    {isCurrent && <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>}
                  </div>
                  {!step.done && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!showOnboarding && actionGroups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Action Queue</h2>
          {actionGroups.map((group) => <ActionQueueGroup key={group.id} group={group} />)}
        </div>
      )}

      {!showOnboarding && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-muted-foreground">Suggestions</h2>
            </div>
            {suggestions.length > 10 && (
              <Button variant="link" size="sm" onClick={() => setShowAllSuggestions((current) => !current)}>
                {showAllSuggestions ? "Show less" : "View all"}
              </Button>
            )}
          </div>

          {suggestionsLoading ? (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              Refreshing suggestions...
            </div>
          ) : suggestions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">All caught up</p>
              <p className="mt-1 text-sm text-muted-foreground">No pending suggestions right now.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  exiting={exitingSuggestionIds.includes(suggestion.id)}
                  busy={busySuggestionIds.includes(suggestion.id)}
                  onAccept={handleAccept}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!showOnboarding && data && data.goalProgress?.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Active Goals</h2>
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
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${goal.progressPercent}%` }} />
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

      {data && data.recentActivity.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Today's Activity</h2>
          <div className="border border-border divide-y divide-border rounded-md overflow-hidden">
            {data.recentActivity.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate">
                  <span className="text-muted-foreground">{formatAction(item)}</span>{" "}
                  <span className="font-medium">{activityEntityName(item)}</span>
                </span>
                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(item.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!showOnboarding && data && actionGroups.length === 0 && suggestions.length === 0 && data.recentActivity.length === 0 && (
        <div className="border border-border rounded-md p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        </div>
      )}

      <SuggestedMemoryDialog
        companyId={selectedCompanyId}
        draft={memoryDraft}
        open={memoryDraft !== null}
        onOpenChange={(open) => {
          if (!open) setMemoryDraft(null);
        }}
        onCreated={async () => {
          if (!memoryDraft) return;
          const suggestion = suggestions.find((item) => item.id === memoryDraft.suggestionId);
          if (!suggestion) {
            setMemoryDraft(null);
            return;
          }
          try {
            await acceptAndRemove(suggestion);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to accept suggestion";
            pushToast({ title: "Memory created, but suggestion was not cleared", body: message, tone: "error" });
          } finally {
            setMemoryDraft(null);
          }
        }}
      />
    </div>
  );
}
