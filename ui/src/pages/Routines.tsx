import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { ChevronDown, ChevronRight, LayoutGrid, List, MoreHorizontal, Plus, Repeat } from "lucide-react";
import type { RoutineListItem } from "@armyofagents/shared";
import { routinesApi } from "../api/routines";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { RoutineRunDialog } from "../components/routines/RoutineRunDialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { getRecentAssigneeIds, sortAgentsByRecency, trackRecentAssignee } from "../lib/recent-assignees";
import { EmptyState } from "../components/EmptyState";
import { RoutineCard } from "../components/RoutineCard";
import {
  autoResizeTextarea,
  catchUpPolicies,
  catchUpPolicyDescriptions,
  concurrencyPolicies,
  concurrencyPolicyDescriptions,
  runStatusStyle,
} from "../lib/routine-constants";
import { timeAgo } from "../lib/timeAgo";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { InlineEntitySelector, type InlineEntityOption } from "../components/InlineEntitySelector";
import { MarkdownEditor, type MarkdownEditorRef } from "../components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function nextRoutineStatus(currentStatus: string, enabled: boolean) {
  if (currentStatus === "archived" && enabled) return "active";
  return enabled ? "active" : "paused";
}

export function Routines() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const descriptionEditorRef = useRef<MarkdownEditorRef>(null);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const assigneeSelectorRef = useRef<HTMLButtonElement | null>(null);
  const projectSelectorRef = useRef<HTMLButtonElement | null>(null);
  const [runDialogRoutine, setRunDialogRoutine] = useState<RoutineListItem | null>(null);
  const [statusMutationRoutineId, setStatusMutationRoutineId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<"all" | "active" | "paused" | "archived">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    projectId: "",
    assigneeAgentId: "",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Routines" }]);
  }, [setBreadcrumbs]);

  const { data: routines, isLoading, error } = useQuery({
    queryKey: queryKeys.routines.list(selectedCompanyId!),
    queryFn: () => routinesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
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

  useEffect(() => {
    autoResizeTextarea(titleInputRef.current);
  }, [draft.title, composerOpen]);

  const createRoutine = useMutation({
    mutationFn: () =>
      routinesApi.create(selectedCompanyId!, {
        ...draft,
        description: draft.description.trim() || null,
      }),
    onSuccess: async (routine) => {
      setDraft({
        title: "",
        description: "",
        projectId: "",
        assigneeAgentId: "",
        priority: "medium",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
      });
      setComposerOpen(false);
      setAdvancedOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) });
      pushToast({
        title: "Routine created",
        body: "Add the first trigger to turn it into a live workflow.",
        tone: "success",
      });
      navigate(`/routines/${routine.id}?tab=triggers`);
    },
  });

  const updateRoutineStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => routinesApi.update(id, { status }),
    onMutate: ({ id }) => {
      setStatusMutationRoutineId(id);
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(variables.id) }),
      ]);
    },
    onSettled: () => {
      setStatusMutationRoutineId(null);
    },
    onError: (mutationError) => {
      pushToast({
        title: "Failed to update routine",
        body: mutationError instanceof Error ? mutationError.message : "AoA could not update the routine.",
        tone: "error",
      });
    },
  });

  const handleRunComplete = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(selectedCompanyId!) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(id) }),
    ]);
  };

  const recentAssigneeIds = useMemo(() => getRecentAssigneeIds(), [composerOpen]);
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
  const agentById = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.id, agent])),
    [agents],
  );
  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );
  const filteredRoutines = useMemo(() => {
    return (routines ?? []).filter((r) => {
      if (filterTab === "all") return r.status !== "archived";
      return r.status === filterTab;
    });
  }, [routines, filterTab]);
  const currentAssignee = draft.assigneeAgentId ? agentById.get(draft.assigneeAgentId) ?? null : null;
  const currentProject = draft.projectId ? projectById.get(draft.projectId) ?? null : null;

  if (!selectedCompanyId) {
    return <EmptyState icon={Repeat} message="Select a company to view routines." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="issues-list" />;
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            Routines
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Beta</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {(routines ?? []).length} {(routines ?? []).length === 1 ? "routine" : "routines"}
          </p>
        </div>
        <Button onClick={() => setComposerOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create routine
        </Button>
      </div>

      {/* Filter tabs + view toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {(["all", "active", "paused", "archived"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterTab(tab)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors capitalize ${
                filterTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`rounded p-1.5 transition-colors ${
              viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`rounded p-1.5 transition-colors ${
              viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Dialog
        open={composerOpen}
        onOpenChange={(open) => {
          if (!createRoutine.isPending) {
            setComposerOpen(open);
          }
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-3xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">New routine</DialogTitle>
          <DialogDescription className="sr-only">Create a recurring routine for agents to execute</DialogDescription>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">New routine</p>
              <p className="text-sm text-muted-foreground">
                Define the recurring work first. Trigger setup comes next on the detail page.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setComposerOpen(false);
                setAdvancedOpen(false);
              }}
              disabled={createRoutine.isPending}
            >
              Cancel
            </Button>
          </div>

          <div className="px-5 pt-5 pb-3">
            <textarea
              ref={titleInputRef}
              className="w-full resize-none overflow-hidden bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground/50"
              placeholder="Routine title"
              rows={1}
              value={draft.title}
              onChange={(event) => {
                setDraft((current) => ({ ...current, title: event.target.value }));
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
                  if (draft.assigneeAgentId) {
                    if (draft.projectId) {
                      descriptionEditorRef.current?.focus();
                    } else {
                      projectSelectorRef.current?.focus();
                    }
                  } else {
                    assigneeSelectorRef.current?.focus();
                  }
                }
              }}
              autoFocus
            />
          </div>

          <div className="px-5 pb-3">
            <div className="overflow-x-auto overscroll-x-contain">
              <div className="inline-flex min-w-full flex-wrap items-center gap-2 text-sm text-muted-foreground sm:min-w-max sm:flex-nowrap">
                <span>For</span>
                <InlineEntitySelector
                  ref={assigneeSelectorRef}
                  value={draft.assigneeAgentId}
                  options={assigneeOptions}
                  placeholder="Assignee"
                  noneLabel="No assignee"
                  searchPlaceholder="Search assignees..."
                  emptyMessage="No assignees found."
                  onChange={(assigneeAgentId) => {
                    if (assigneeAgentId) trackRecentAssignee(assigneeAgentId);
                    setDraft((current) => ({ ...current, assigneeAgentId }));
                  }}
                  onConfirm={() => {
                    if (draft.projectId) {
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
                  value={draft.projectId}
                  options={projectOptions}
                  placeholder="Project"
                  noneLabel="No project"
                  searchPlaceholder="Search projects..."
                  emptyMessage="No projects found."
                  onChange={(projectId) => setDraft((current) => ({ ...current, projectId }))}
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
          </div>

          <div className="border-t border-border/60 px-5 py-4">
            <MarkdownEditor
              ref={descriptionEditorRef}
              value={draft.description}
              onChange={(description) => setDraft((current) => ({ ...current, description }))}
              placeholder="Add instructions..."
              bordered={false}
              contentClassName="min-h-[160px] text-sm text-muted-foreground"
              onSubmit={() => {
                if (!createRoutine.isPending && draft.title.trim() && draft.projectId && draft.assigneeAgentId) {
                  createRoutine.mutate();
                }
              }}
            />
          </div>

          <div className="border-t border-border/60 px-5 py-3">
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
                <div>
                  <p className="text-sm font-medium">Advanced delivery settings</p>
                  <p className="text-sm text-muted-foreground">Keep policy controls secondary to the work definition.</p>
                </div>
                {advancedOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Concurrency</p>
                    <Select
                      value={draft.concurrencyPolicy}
                      onValueChange={(concurrencyPolicy) => setDraft((current) => ({ ...current, concurrencyPolicy }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {concurrencyPolicies.map((value) => (
                          <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{concurrencyPolicyDescriptions[draft.concurrencyPolicy]}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Catch-up</p>
                    <Select
                      value={draft.catchUpPolicy}
                      onValueChange={(catchUpPolicy) => setDraft((current) => ({ ...current, catchUpPolicy }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {catchUpPolicies.map((value) => (
                          <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{catchUpPolicyDescriptions[draft.catchUpPolicy]}</p>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              After creation, AoA takes you straight to trigger setup for schedules, webhooks, or internal runs.
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button
                onClick={() => createRoutine.mutate()}
                disabled={
                  createRoutine.isPending ||
                  !draft.title.trim() ||
                  !draft.projectId ||
                  !draft.assigneeAgentId
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                {createRoutine.isPending ? "Creating..." : "Create routine"}
              </Button>
              {createRoutine.isError ? (
                <p className="text-sm text-destructive">
                  {createRoutine.error instanceof Error ? createRoutine.error.message : "Failed to create routine"}
                </p>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load routines"}
          </CardContent>
        </Card>
      ) : null}

      {/* Empty state */}
      {filteredRoutines.length === 0 ? (
        <div className="py-12">
          <EmptyState
            icon={Repeat}
            message={filterTab === "all" ? "No routines yet" : `No ${filterTab} routines`}
            description={
              filterTab === "all"
                ? "Create your first routine to automate recurring work."
                : undefined
            }
            action={filterTab === "all" ? "Create routine" : undefined}
            onAction={filterTab === "all" ? () => setComposerOpen(true) : undefined}
          />
        </div>
      ) : viewMode === "grid" ? (
        /* Card grid view */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRoutines.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              agentById={agentById}
              projectById={projectById}
              isRunning={runDialogRoutine?.id === routine.id}
              isStatusPending={statusMutationRoutineId === routine.id}
              onNavigate={() => navigate(`/routines/${routine.id}`)}
              onRun={() => setRunDialogRoutine(routine)}
              onToggleStatus={() =>
                updateRoutineStatus.mutate({
                  id: routine.id,
                  status: nextRoutineStatus(routine.status, routine.status !== "active"),
                })
              }
              onArchive={() =>
                updateRoutineStatus.mutate({
                  id: routine.id,
                  status: routine.status === "archived" ? "active" : "archived",
                })
              }
            />
          ))}
        </div>
      ) : (
        /* List (table) view */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 font-medium">Agent</th>
                <th className="px-3 py-2.5 font-medium">Last run</th>
                <th className="px-3 py-2.5 font-medium">Enabled</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filteredRoutines.map((routine) => {
                const enabled = routine.status === "active";
                const isArchived = routine.status === "archived";
                const isStatusPending = statusMutationRoutineId === routine.id;
                const routineAgent = routine.assigneeAgentId ? agentById.get(routine.assigneeAgentId) : undefined;
                const lastRun = routine.lastRun ? runStatusStyle(routine.lastRun.status) : null;
                return (
                  <tr
                    key={routine.id}
                    className="align-middle border-b border-border transition-colors hover:bg-accent/50 last:border-b-0 cursor-pointer"
                    onClick={() => navigate(`/routines/${routine.id}`)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="min-w-[180px]">
                        <span className="font-medium">{routine.title}</span>
                        {(isArchived || routine.status === "paused") && (
                          <div className="mt-0.5 text-xs text-muted-foreground capitalize">{routine.status}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {routine.projectId ? (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <span
                            className="shrink-0 h-2.5 w-2.5 rounded-sm"
                            style={{ backgroundColor: projectById.get(routine.projectId)?.color ?? "#64748b" }}
                          />
                          <span className="truncate">{projectById.get(routine.projectId)?.name ?? "Unknown"}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {routineAgent ? (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <AgentIcon icon={routineAgent.icon} className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{routineAgent.name}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{routine.assigneeAgentId ? "Unknown" : "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {routine.lastRun && lastRun ? (
                        <div>
                          <div className="text-muted-foreground">{timeAgo(routine.lastRun.triggeredAt)}</div>
                          <div className={`mt-0.5 text-xs ${lastRun.colorClass}`}>
                            {lastRun.label}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Never</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={enabled ? `Disable ${routine.title}` : `Enable ${routine.title}`}
                          disabled={isStatusPending || isArchived}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            enabled ? "bg-emerald-500" : "bg-muted"
                          } ${isStatusPending || isArchived ? "cursor-not-allowed opacity-50" : ""}`}
                          onClick={() =>
                            updateRoutineStatus.mutate({
                              id: routine.id,
                              status: nextRoutineStatus(routine.status, !enabled),
                            })
                          }
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
                              enabled ? "translate-x-4.5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                        <span className="text-xs text-muted-foreground">
                          {isArchived ? "Archived" : enabled ? "On" : "Off"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${routine.title}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/routines/${routine.id}`)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isArchived}
                            onClick={() => setRunDialogRoutine(routine)}
                          >
                            Run now
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              updateRoutineStatus.mutate({
                                id: routine.id,
                                status: nextRoutineStatus(routine.status, !enabled),
                              })
                            }
                            disabled={isStatusPending || isArchived}
                          >
                            {enabled ? "Pause" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              updateRoutineStatus.mutate({
                                id: routine.id,
                                status: routine.status === "archived" ? "active" : "archived",
                              })
                            }
                            disabled={isStatusPending}
                          >
                            {routine.status === "archived" ? "Restore" : "Archive"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {runDialogRoutine ? (
        <RoutineRunDialog
          open
          onOpenChange={(next) => {
            if (!next) setRunDialogRoutine(null);
          }}
          routineId={runDialogRoutine.id}
          routineTitle={runDialogRoutine.title}
          variables={runDialogRoutine.variables}
          onRunComplete={() => handleRunComplete(runDialogRoutine.id)}
        />
      ) : null}
    </div>
  );
}
