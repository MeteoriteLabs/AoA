import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  Clock3,
  Copy,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  Trash2,
  Webhook,
  Zap,
} from "lucide-react";
import { routinesApi, type RoutineTriggerResponse, type RotateRoutineTriggerResponse } from "../api/routines";
import { heartbeatsApi } from "../api/heartbeats";
import { LiveRunWidget } from "../components/LiveRunWidget";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import {
  autoResizeTextarea,
  catchUpPolicies,
  concurrencyPolicies,
  runStatusBadgeClass,
} from "../lib/routine-constants";
import { buildRoutineTriggerPatch } from "../lib/routine-trigger-patch";
import { timeAgo } from "../lib/timeAgo";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { InlineEntitySelector, type InlineEntityOption } from "../components/InlineEntitySelector";
import { MarkdownEditor, type MarkdownEditorRef } from "../components/MarkdownEditor";
import { ScheduleEditor, describeSchedule } from "../components/ScheduleEditor";
import { getRecentAssigneeIds, sortAgentsByRecency, trackRecentAssignee } from "../lib/recent-assignees";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { RoutineTrigger } from "@paperclipai/shared";

const triggerKinds = ["schedule", "webhook"];
const signingModes = ["bearer", "hmac_sha256"];
const routineTabs = ["triggers", "runs", "activity"] as const;

type RoutineTab = (typeof routineTabs)[number];

type SecretMessage = {
  title: string;
  webhookUrl: string;
  webhookSecret: string;
};

function isRoutineTab(value: string | null): value is RoutineTab {
  return value !== null && routineTabs.includes(value as RoutineTab);
}

function getRoutineTabFromSearch(search: string): RoutineTab {
  const tab = new URLSearchParams(search).get("tab");
  return isRoutineTab(tab) ? tab : "triggers";
}

function formatActivityDetailValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.map((item) => formatActivityDetailValue(item)).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function formatActivityAction(action: string): string {
  const parts = action.split(".");
  const verb = parts[parts.length - 1];
  const subject = parts.length > 1 ? parts[0] : null;
  const verbFormatted = verb.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
  if (subject === "routine" || !subject) return verbFormatted;
  const subjectFormatted = subject.replace("routine_", "").replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
  return `${subjectFormatted} ${verb.replaceAll("_", " ")}`.replace(/^\w/, (c) => c.toUpperCase());
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function TriggerCard({
  trigger,
  onSave,
  onRotate,
  onDelete,
}: {
  trigger: RoutineTrigger;
  onSave: (id: string, patch: Record<string, unknown>) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState({
    label: trigger.label ?? "",
    cronExpression: trigger.cronExpression ?? "",
    signingMode: trigger.signingMode ?? "bearer",
    replayWindowSec: String(trigger.replayWindowSec ?? 300),
  });

  useEffect(() => {
    setDraft({
      label: trigger.label ?? "",
      cronExpression: trigger.cronExpression ?? "",
      signingMode: trigger.signingMode ?? "bearer",
      replayWindowSec: String(trigger.replayWindowSec ?? 300),
    });
  }, [trigger]);

  const borderColorClass =
    trigger.kind === "schedule"
      ? "border-l-blue-500"
      : trigger.kind === "webhook"
        ? "border-l-purple-500"
        : "border-l-gray-500";

  return (
    <div className={`rounded-lg border border-l-4 ${borderColorClass} p-4 space-y-3`}>
      {/* Card header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {trigger.kind === "schedule" ? (
            <Clock3 className="h-3.5 w-3.5 text-blue-400" />
          ) : trigger.kind === "webhook" ? (
            <Webhook className="h-3.5 w-3.5 text-purple-400" />
          ) : (
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="capitalize text-xs font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {trigger.kind}
          </span>
          {trigger.label && trigger.label !== trigger.kind && (
            <span className="text-muted-foreground text-xs">{trigger.label}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </Button>
          )}
          {!isEditing && (confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => onDelete(trigger.id)}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      </div>

      {/* Schedule description */}
      {trigger.kind === "schedule" && trigger.cronExpression && (
        <p className="text-sm">{describeSchedule(trigger.cronExpression)}</p>
      )}

      {/* Metadata grid */}
      {(trigger.nextRunAt || trigger.lastFiredAt || trigger.lastResult) && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {trigger.kind === "schedule" && trigger.nextRunAt && (
            <>
              <span className="font-medium text-foreground/70">Next run</span>
              <span>{new Date(trigger.nextRunAt).toLocaleString()}</span>
            </>
          )}
          {trigger.lastFiredAt && (
            <>
              <span className="font-medium text-foreground/70">Last fired</span>
              <span>{new Date(trigger.lastFiredAt).toLocaleString()}</span>
            </>
          )}
          {trigger.lastResult && (
            <>
              <span className="font-medium text-foreground/70">Last result</span>
              <span className={trigger.lastResult === "success" ? "text-emerald-400" : "text-muted-foreground"}>
                {trigger.lastResult}
              </span>
            </>
          )}
        </div>
      )}

      {/* Inline edit form — only when isEditing */}
      {isEditing && (
        <div className="border-t border-border pt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Label</Label>
              <Input
                value={draft.label}
                onChange={(e) => setDraft((c) => ({ ...c, label: e.target.value }))}
              />
            </div>
            {trigger.kind === "schedule" && (
              <div className="md:col-span-2 space-y-1.5">
                <Label className="text-xs">Schedule</Label>
                <ScheduleEditor
                  value={draft.cronExpression}
                  onChange={(cronExpression) => setDraft((c) => ({ ...c, cronExpression }))}
                />
              </div>
            )}
            {trigger.kind === "webhook" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Signing mode</Label>
                  <Select
                    value={draft.signingMode}
                    onValueChange={(signingMode) => setDraft((c) => ({ ...c, signingMode }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {signingModes.map((mode) => (<SelectItem key={mode} value={mode}>{mode}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Replay window (seconds)</Label>
                  <Input
                    value={draft.replayWindowSec}
                    onChange={(e) => setDraft((c) => ({ ...c, replayWindowSec: e.target.value }))}
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {trigger.kind === "webhook" && (
              <Button variant="outline" size="sm" onClick={() => onRotate(trigger.id)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Rotate secret
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onSave(trigger.id, buildRoutineTriggerPatch(trigger, draft, getLocalTimezone()));
                  setIsEditing(false);
                }}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function RoutineDetail() {
  const { routineId } = useParams<{ routineId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { pushToast } = useToast();
  const hydratedRoutineIdRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionEditorRef = useRef<MarkdownEditorRef>(null);
  const assigneeSelectorRef = useRef<HTMLButtonElement | null>(null);
  const projectSelectorRef = useRef<HTMLButtonElement | null>(null);
  const [secretMessage, setSecretMessage] = useState<SecretMessage | null>(null);
  const [addTriggerOpen, setAddTriggerOpen] = useState(false);
  const [newTrigger, setNewTrigger] = useState({
    kind: "schedule",
    cronExpression: "0 10 * * *",
    signingMode: "bearer",
    replayWindowSec: "300",
  });
  const [editDraft, setEditDraft] = useState({
    title: "",
    description: "",
    projectId: "",
    assigneeAgentId: "",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
  });
  const activeTab = useMemo(() => getRoutineTabFromSearch(location.search), [location.search]);

  const { data: routine, isLoading, error } = useQuery({
    queryKey: queryKeys.routines.detail(routineId!),
    queryFn: () => routinesApi.get(routineId!),
    enabled: !!routineId,
  });
  const activeIssueId = routine?.activeIssue?.id;
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.issues.liveRuns(activeIssueId!),
    queryFn: () => heartbeatsApi.liveRunsForIssue(activeIssueId!),
    enabled: !!activeIssueId,
    refetchInterval: 3000,
  });
  const hasLiveRun = (liveRuns ?? []).length > 0;
  const { data: routineRuns } = useQuery({
    queryKey: queryKeys.routines.runs(routineId!),
    queryFn: () => routinesApi.listRuns(routineId!),
    enabled: !!routineId,
    refetchInterval: hasLiveRun ? 3000 : false,
  });
  const relatedActivityIds = useMemo(
    () => ({
      triggerIds: routine?.triggers.map((trigger) => trigger.id) ?? [],
      runIds: routineRuns?.map((run) => run.id) ?? [],
    }),
    [routine?.triggers, routineRuns],
  );
  const { data: activity } = useQuery({
    queryKey: [
      ...queryKeys.routines.activity(selectedCompanyId!, routineId!),
      relatedActivityIds.triggerIds.join(","),
      relatedActivityIds.runIds.join(","),
    ],
    queryFn: () => routinesApi.activity(selectedCompanyId!, routineId!, relatedActivityIds),
    enabled: !!selectedCompanyId && !!routineId && !!routine,
  });
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const routineDefaults = useMemo(
    () =>
      routine
        ? {
            title: routine.title,
            description: routine.description ?? "",
            projectId: routine.projectId,
            assigneeAgentId: routine.assigneeAgentId,
            priority: routine.priority,
            concurrencyPolicy: routine.concurrencyPolicy,
            catchUpPolicy: routine.catchUpPolicy,
          }
        : null,
    [routine],
  );
  const isEditDirty = useMemo(() => {
    if (!routineDefaults) return false;
    return (
      editDraft.title !== routineDefaults.title ||
      editDraft.description !== routineDefaults.description ||
      editDraft.projectId !== routineDefaults.projectId ||
      editDraft.assigneeAgentId !== routineDefaults.assigneeAgentId ||
      editDraft.priority !== routineDefaults.priority ||
      editDraft.concurrencyPolicy !== routineDefaults.concurrencyPolicy ||
      editDraft.catchUpPolicy !== routineDefaults.catchUpPolicy
    );
  }, [editDraft, routineDefaults]);

  useEffect(() => {
    if (!routine) return;
    setBreadcrumbs([{ label: "Routines", href: "/routines" }, { label: routine.title }]);
    if (!routineDefaults) return;

    const changedRoutine = hydratedRoutineIdRef.current !== routine.id;
    if (changedRoutine || !isEditDirty) {
      setEditDraft(routineDefaults);
      hydratedRoutineIdRef.current = routine.id;
    }
  }, [routine, routineDefaults, isEditDirty, setBreadcrumbs]);

  useEffect(() => {
    autoResizeTextarea(titleInputRef.current);
  }, [editDraft.title, routine?.id]);

  const copySecretValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast({ title: `${label} copied`, tone: "success" });
    } catch (error) {
      pushToast({
        title: `Failed to copy ${label.toLowerCase()}`,
        body: error instanceof Error ? error.message : "Clipboard access was denied.",
        tone: "error",
      });
    }
  };

  const setActiveTab = (value: string) => {
    if (!routineId || !isRoutineTab(value)) return;
    const params = new URLSearchParams(location.search);
    if (value === "triggers") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const search = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : "",
      },
      { replace: true },
    );
  };

  const saveRoutine = useMutation({
    mutationFn: () => {
      return routinesApi.update(routineId!, {
        ...editDraft,
        description: editDraft.description.trim() || null,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.activity(selectedCompanyId!, routineId!) }),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to save routine",
        body: error instanceof Error ? error.message : "AoA could not save the routine.",
        tone: "error",
      });
    },
  });

  const runRoutine = useMutation({
    mutationFn: () => routinesApi.run(routineId!, { source: "manual" }),
    onSuccess: async () => {
      pushToast({ title: "Routine run started", tone: "success" });
      setActiveTab("runs");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.runs(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.activity(selectedCompanyId!, routineId!) }),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: "Routine run failed",
        body: error instanceof Error ? error.message : "AoA could not start the routine run.",
        tone: "error",
      });
    },
  });

  const updateRoutineStatus = useMutation({
    mutationFn: (status: string) => routinesApi.update(routineId!, { status }),
    onSuccess: async (_data, status) => {
      pushToast({
        title: "Routine saved",
        body: status === "paused" ? "Automation paused." : "Automation enabled.",
        tone: "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to update routine",
        body: error instanceof Error ? error.message : "AoA could not update the routine.",
        tone: "error",
      });
    },
  });

  const createTrigger = useMutation({
    mutationFn: async (): Promise<RoutineTriggerResponse> => {
      const existingOfKind = (routine?.triggers ?? []).filter((t) => t.kind === newTrigger.kind).length;
      const autoLabel = existingOfKind > 0 ? `${newTrigger.kind}-${existingOfKind + 1}` : newTrigger.kind;
      return routinesApi.createTrigger(routineId!, {
        kind: newTrigger.kind,
        label: autoLabel,
        ...(newTrigger.kind === "schedule"
          ? { cronExpression: newTrigger.cronExpression.trim(), timezone: getLocalTimezone() }
          : {}),
        ...(newTrigger.kind === "webhook"
          ? {
            signingMode: newTrigger.signingMode,
            replayWindowSec: Number(newTrigger.replayWindowSec || "300"),
          }
          : {}),
      });
    },
    onSuccess: async (result) => {
      setAddTriggerOpen(false);
      if (result.secretMaterial) {
        setSecretMessage({
          title: "Webhook trigger created",
          webhookUrl: result.secretMaterial.webhookUrl,
          webhookSecret: result.secretMaterial.webhookSecret,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.activity(selectedCompanyId!, routineId!) }),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to add trigger",
        body: error instanceof Error ? error.message : "AoA could not create the trigger.",
        tone: "error",
      });
    },
  });

  const updateTrigger = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => routinesApi.updateTrigger(id, patch),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.activity(selectedCompanyId!, routineId!) }),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to update trigger",
        body: error instanceof Error ? error.message : "AoA could not update the trigger.",
        tone: "error",
      });
    },
  });

  const deleteTrigger = useMutation({
    mutationFn: (id: string) => routinesApi.deleteTrigger(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.activity(selectedCompanyId!, routineId!) }),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to delete trigger",
        body: error instanceof Error ? error.message : "AoA could not delete the trigger.",
        tone: "error",
      });
    },
  });

  const rotateTrigger = useMutation({
    mutationFn: (id: string): Promise<RotateRoutineTriggerResponse> => routinesApi.rotateTriggerSecret(id),
    onSuccess: async (result) => {
      setSecretMessage({
        title: "Webhook secret rotated",
        webhookUrl: result.secretMaterial.webhookUrl,
        webhookSecret: result.secretMaterial.webhookSecret,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routineId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.activity(selectedCompanyId!, routineId!) }),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to rotate webhook secret",
        body: error instanceof Error ? error.message : "AoA could not rotate the webhook secret.",
        tone: "error",
      });
    },
  });

  const agentById = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.id, agent])),
    [agents],
  );
  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );
  const recentAssigneeIds = useMemo(() => getRecentAssigneeIds(), [routine?.id]);
  const assigneeOptions = useMemo<InlineEntityOption[]>(
    () =>
      sortAgentsByRecency(
        (agents ?? []).filter((agent) => agent.status !== "terminated"),
        recentAssigneeIds,
      ).map((agent) => ({
        id: agent.id,
        label: agent.name,
        searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
      })),
    [agents, recentAssigneeIds],
  );
  const projectOptions = useMemo<InlineEntityOption[]>(
    () =>
      (projects ?? []).map((project) => ({
        id: project.id,
        label: project.name,
        searchText: project.description ?? "",
      })),
    [projects],
  );
  const currentAssignee = editDraft.assigneeAgentId ? agentById.get(editDraft.assigneeAgentId) ?? null : null;
  const currentProject = editDraft.projectId ? projectById.get(editDraft.projectId) ?? null : null;

  if (!selectedCompanyId) {
    return <EmptyState icon={Repeat} message="Select a company to view routines." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="issues-list" />;
  }

  if (error || !routine) {
    return (
      <p className="pt-6 text-sm text-destructive">
        {error instanceof Error ? error.message : "Routine not found"}
      </p>
    );
  }

  const automationEnabled = routine.status === "active";
  const automationToggleDisabled = updateRoutineStatus.isPending || routine.status === "archived";
  const automationLabel = routine.status === "archived" ? "Archived" : automationEnabled ? "Active" : "Paused";
  const automationLabelClassName = routine.status === "archived"
    ? "text-muted-foreground"
    : automationEnabled
      ? "text-emerald-400"
      : "text-muted-foreground";

  return (
    <div className="max-w-2xl space-y-4">
      {/* Routine definition card */}
      <div className="border border-border rounded-lg bg-card p-5 space-y-4">
        {/* Header: editable title + actions */}
        <div className="flex items-start gap-4">
          <textarea
            ref={titleInputRef}
            className="flex-1 min-w-0 resize-none overflow-hidden bg-transparent text-xl font-bold outline-none placeholder:text-muted-foreground/50"
            placeholder="Routine title"
            rows={1}
            value={editDraft.title}
            onChange={(event) => {
              setEditDraft((current) => ({ ...current, title: event.target.value }));
              autoResizeTextarea(event.target);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                descriptionEditorRef.current?.focus();
                return;
              }
              if (event.key === "Tab" && !event.shiftKey) {
                event.preventDefault();
                if (editDraft.assigneeAgentId) {
                  if (editDraft.projectId) {
                    descriptionEditorRef.current?.focus();
                  } else {
                    projectSelectorRef.current?.focus();
                  }
                } else {
                  assigneeSelectorRef.current?.focus();
                }
              }
            }}
          />
          <div className="flex shrink-0 items-center gap-3 pt-1">
            <Button size="sm" variant="outline" onClick={() => runRoutine.mutate()} disabled={runRoutine.isPending}>
              <Play className="mr-1.5 h-3.5 w-3.5" /> Run now
            </Button>
            <button
              type="button"
              role="switch"
              data-slot="toggle"
              aria-checked={automationEnabled}
              aria-label={automationEnabled ? "Pause automatic triggers" : "Enable automatic triggers"}
              disabled={automationToggleDisabled}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                automationEnabled ? "bg-emerald-500" : "bg-muted"
              } ${automationToggleDisabled ? "cursor-not-allowed opacity-50" : ""}`}
              onClick={() => updateRoutineStatus.mutate(automationEnabled ? "paused" : "active")}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
                  automationEnabled ? "translate-x-4.5" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className={`min-w-[3.75rem] text-sm font-medium ${automationLabelClassName}`}>
              {automationLabel}
            </span>
          </div>
        </div>

        {/* Secret message banner */}
        {secretMessage && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-3 text-sm">
            <div>
              <p className="font-medium">{secretMessage.title}</p>
              <p className="text-xs text-muted-foreground">Save this now. AoA will not show the secret value again.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input value={secretMessage.webhookUrl} readOnly className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => copySecretValue("Webhook URL", secretMessage.webhookUrl)}>
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  URL
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Input value={secretMessage.webhookSecret} readOnly className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => copySecretValue("Webhook secret", secretMessage.webhookSecret)}>
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  Secret
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Assignment row */}
        <div className="overflow-x-auto overscroll-x-contain">
          <div className="inline-flex min-w-full flex-wrap items-center gap-2 text-sm text-muted-foreground sm:min-w-max sm:flex-nowrap">
            <span>For</span>
            <InlineEntitySelector
              ref={assigneeSelectorRef}
              value={editDraft.assigneeAgentId}
              options={assigneeOptions}
              placeholder="Assignee"
              noneLabel="No assignee"
              searchPlaceholder="Search assignees..."
              emptyMessage="No assignees found."
              onChange={(assigneeAgentId) => {
                if (assigneeAgentId) trackRecentAssignee(assigneeAgentId);
                setEditDraft((current) => ({ ...current, assigneeAgentId }));
              }}
              onConfirm={() => {
                if (editDraft.projectId) {
                  descriptionEditorRef.current?.focus();
                } else {
                  projectSelectorRef.current?.focus();
                }
              }}
              renderTriggerValue={(option) =>
                option ? (
                  currentAssignee ? (
                    <>
                      <AgentIcon icon={currentAssignee.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{option.label}</span>
                    </>
                  ) : (
                    <span className="truncate">{option.label}</span>
                  )
                ) : (
                  <span className="text-muted-foreground">Assignee</span>
                )
              }
              renderOption={(option) => {
                if (!option.id) return <span className="truncate">{option.label}</span>;
                const assignee = agentById.get(option.id);
                return (
                  <>
                    {assignee ? <AgentIcon icon={assignee.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                    <span className="truncate">{option.label}</span>
                  </>
                );
              }}
            />
            <span>in</span>
            <InlineEntitySelector
              ref={projectSelectorRef}
              value={editDraft.projectId}
              options={projectOptions}
              placeholder="Project"
              noneLabel="No project"
              searchPlaceholder="Search projects..."
              emptyMessage="No projects found."
              onChange={(projectId) => setEditDraft((current) => ({ ...current, projectId }))}
              onConfirm={() => descriptionEditorRef.current?.focus()}
              renderTriggerValue={(option) =>
                option && currentProject ? (
                  <>
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: currentProject.color ?? "#64748b" }}
                    />
                    <span className="truncate">{option.label}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Project</span>
                )
              }
              renderOption={(option) => {
                if (!option.id) return <span className="truncate">{option.label}</span>;
                const project = projectById.get(option.id);
                return (
                  <>
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: project?.color ?? "#64748b" }}
                    />
                    <span className="truncate">{option.label}</span>
                  </>
                );
              }}
            />
          </div>
        </div>

        {/* Instructions */}
        <MarkdownEditor
          ref={descriptionEditorRef}
          value={editDraft.description}
          onChange={(description) => setEditDraft((current) => ({ ...current, description }))}
          placeholder="Add instructions..."
          bordered={false}
          contentClassName="min-h-[120px] text-[15px] leading-7"
          onSubmit={() => {
            if (!saveRoutine.isPending && editDraft.title.trim() && editDraft.projectId && editDraft.assigneeAgentId) {
              saveRoutine.mutate();
            }
          }}
        />

        {/* Delivery settings — compact, always visible */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Concurrency:</span>
            <Select
              value={editDraft.concurrencyPolicy}
              onValueChange={(concurrencyPolicy) => setEditDraft((current) => ({ ...current, concurrencyPolicy }))}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-1 text-sm focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {concurrencyPolicies.map((value) => (
                  <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Catch-up:</span>
            <Select
              value={editDraft.catchUpPolicy}
              onValueChange={(catchUpPolicy) => setEditDraft((current) => ({ ...current, catchUpPolicy }))}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-1 text-sm focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catchUpPolicies.map((value) => (
                  <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>{/* closes definition card */}

      {/* Sticky save bar — only renders when dirty */}
      {isEditDirty && (
        <div className="sticky bottom-0 z-10 border border-amber-500/30 bg-amber-950/60 backdrop-blur-sm px-5 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm text-amber-200">⚠ Unsaved changes</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (routineDefaults) {
                  setEditDraft({
                    ...routineDefaults,
                    projectId: routineDefaults.projectId ?? "",
                    assigneeAgentId: routineDefaults.assigneeAgentId ?? "",
                  });
                }
              }}
              disabled={saveRoutine.isPending}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => saveRoutine.mutate()}
              disabled={saveRoutine.isPending || !editDraft.title.trim() || !editDraft.projectId || !editDraft.assigneeAgentId}
            >
              {saveRoutine.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
        <TabsList variant="line" className="w-full justify-start gap-1">
          <TabsTrigger value="triggers" className="gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />
            Triggers
            {routine.triggers.length > 0 && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {routine.triggers.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Runs
            {(routineRuns ?? []).length > 0 && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {(routineRuns ?? []).length}
              </span>
            )}
            {hasLiveRun && <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <ActivityIcon className="h-3.5 w-3.5" />
            Activity
            {(activity ?? []).length > 0 && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {(activity ?? []).length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="triggers" className="space-y-3">
          {/* Existing trigger cards */}
          {routine.triggers.length === 0 && !addTriggerOpen ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground space-y-3">
              <p>No triggers configured.</p>
              <p className="text-xs">Add a schedule or webhook trigger to automate this routine.</p>
              <Button variant="outline" size="sm" onClick={() => setAddTriggerOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add trigger
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {routine.triggers.map((trigger) => (
                  <TriggerCard
                    key={trigger.id}
                    trigger={trigger}
                    onSave={(id, patch) => updateTrigger.mutate({ id, patch })}
                    onRotate={(id) => rotateTrigger.mutate(id)}
                    onDelete={(id) => deleteTrigger.mutate(id)}
                  />
                ))}
              </div>

              {/* Add trigger — collapsed button or expanded form */}
              {addTriggerOpen ? (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <p className="text-sm font-medium">New trigger</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Kind</Label>
                      <Select value={newTrigger.kind} onValueChange={(kind) => setNewTrigger((current) => ({ ...current, kind }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {triggerKinds.map((kind) => (
                            <SelectItem key={kind} value={kind} disabled={kind === "webhook"}>
                              {kind}{kind === "webhook" ? " — coming soon" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {newTrigger.kind === "schedule" && (
                      <div className="md:col-span-2 space-y-1.5">
                        <Label className="text-xs">Schedule</Label>
                        <ScheduleEditor
                          value={newTrigger.cronExpression}
                          onChange={(cronExpression) => setNewTrigger((current) => ({ ...current, cronExpression }))}
                        />
                      </div>
                    )}
                    {newTrigger.kind === "webhook" && (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Signing mode</Label>
                          <Select value={newTrigger.signingMode} onValueChange={(signingMode) => setNewTrigger((current) => ({ ...current, signingMode }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {signingModes.map((mode) => (<SelectItem key={mode} value={mode}>{mode}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Replay window (seconds)</Label>
                          <Input value={newTrigger.replayWindowSec} onChange={(e) => setNewTrigger((c) => ({ ...c, replayWindowSec: e.target.value }))} />
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAddTriggerOpen(false)}
                      disabled={createTrigger.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => createTrigger.mutate()}
                      disabled={createTrigger.isPending}
                    >
                      {createTrigger.isPending ? "Adding..." : "Add trigger"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setAddTriggerOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add trigger
                </Button>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-4">
          {hasLiveRun && activeIssueId && routine && (
            <LiveRunWidget issueId={activeIssueId} companyId={routine.companyId} />
          )}
          {(routineRuns ?? []).length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No runs yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Use Run now or add a trigger to start.</p>
            </div>
          ) : (
            <div className="border border-border rounded-lg divide-y divide-border">
              {(routineRuns ?? []).map((run) => (
                <div key={run.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="secondary" className="shrink-0">{run.source}</Badge>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 ${runStatusBadgeClass(run.status)}`}
                      >
                        {run.status.replaceAll("_", " ")}
                      </Badge>
                      {run.trigger && (
                        <span className="text-muted-foreground truncate">{run.trigger.label ?? run.trigger.kind}</span>
                      )}
                      {run.linkedIssue && (
                        <Link to={`/issues/${run.linkedIssue.identifier ?? run.linkedIssue.id}`} className="text-muted-foreground hover:underline truncate">
                          {run.linkedIssue.identifier ?? run.linkedIssue.id.slice(0, 8)}
                        </Link>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(run.triggeredAt)}</span>
                  </div>
                  {run.failureReason && (
                    <p className="text-xs text-destructive/80 pl-0.5">{run.failureReason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity">
          {(activity ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="border border-border rounded-lg divide-y divide-border">
              {(activity ?? []).map((event) => (
                <div key={event.id} className="flex items-start justify-between px-4 py-3 text-xs gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-foreground/90 shrink-0">{formatActivityAction(event.action)}</span>
                    {event.details && Object.keys(event.details).length > 0 && (
                      <span className="text-muted-foreground truncate">
                        {Object.entries(event.details).slice(0, 3).map(([key, value], i) => (
                          <span key={key}>
                            {i > 0 && <span className="mx-1 text-border">·</span>}
                            <span className="text-muted-foreground/70">{key.replaceAll("_", " ")}:</span>{" "}
                            {formatActivityDetailValue(value)}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground/60 shrink-0">{timeAgo(event.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
