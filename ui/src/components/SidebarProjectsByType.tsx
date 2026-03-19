import { useCallback, useMemo, useState } from "react";
import { NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderOpen, Plus } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { authApi } from "../api/auth";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { cn, projectRouteRef } from "../lib/utils";
import { useProjectOrder } from "../hooks/useProjectOrder";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Project } from "@paperclipai/shared";

function SortableProjectItem({
  activeProjectRef,
  isMobile,
  project,
  setSidebarOpen,
}: {
  activeProjectRef: string | null;
  isMobile: boolean;
  project: Project;
  setSidebarOpen: (open: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const routeRef = projectRouteRef(project);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(isDragging && "opacity-80")}
      {...attributes}
      {...listeners}
    >
      <NavLink
        to={`/projects/${routeRef}/issues`}
        onClick={() => {
          if (isMobile) setSidebarOpen(false);
        }}
        className={cn(
          "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-colors",
          activeProjectRef === routeRef || activeProjectRef === project.id
            ? "bg-accent text-foreground"
            : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
        )}
      >
        <span
          className="shrink-0 h-3.5 w-3.5 rounded-sm"
          style={{ backgroundColor: project.color ?? "#6366f1" }}
        />
        <span className="flex-1 truncate">{project.name}</span>
      </NavLink>
    </div>
  );
}

interface SidebarProjectsByTypeProps {
  type: "department" | "project";
  label: string;
  collapsed?: boolean;
}

export function SidebarProjectsByType({ type, label, collapsed }: SidebarProjectsByTypeProps) {
  const [open, setOpen] = useState(true);
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const location = useLocation();

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const visibleProjects = useMemo(
    () => (projects ?? []).filter((p: Project) => !p.archivedAt && p.type === type),
    [projects, type],
  );
  const { orderedProjects, persistOrder } = useProjectOrder({
    projects: visibleProjects,
    companyId: selectedCompanyId,
    userId: currentUserId,
  });

  const projectMatch = location.pathname.match(/^\/(?:[^/]+\/)?projects\/([^/]+)/);
  const activeProjectRef = projectMatch?.[1] ?? null;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = orderedProjects.map((project) => project.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedProjects, persistOrder],
  );

  const newLabel = type === "department" ? "New Department" : "New Project";

  // Collapsed mode: single folder icon with popover
  if (collapsed) {
    return (
      <div className="w-full">
        <div className="mx-auto w-8 my-1.5 border-t border-border" />
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center justify-center w-10 h-8 rounded-md transition-colors mx-auto text-foreground/80 hover:bg-accent/50 hover:text-foreground"
                  aria-label={label}
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-48 p-2">
            <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-border">
              <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">{label}</span>
              <button
                onClick={() => openNewProject({ type })}
                className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors"
                aria-label={newLabel}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {orderedProjects.length === 0 && (
                <span className="text-xs text-muted-foreground px-2 py-1">None yet</span>
              )}
              {orderedProjects.map((project: Project) => {
                const routeRef = projectRouteRef(project);
                return (
                  <NavLink
                    key={project.id}
                    to={`/projects/${routeRef}/issues`}
                    onClick={() => { if (isMobile) setSidebarOpen(false); }}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 text-[13px] font-medium rounded-md transition-colors",
                      activeProjectRef === routeRef || activeProjectRef === project.id
                        ? "bg-accent text-foreground"
                        : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className="shrink-0 h-3 w-3 rounded-sm"
                      style={{ backgroundColor: project.color ?? "#6366f1" }}
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                  </NavLink>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // Expanded mode: collapsible list with drag-drop
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90"
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              {label}
            </span>
          </CollapsibleTrigger>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openNewProject({ type });
            }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label={newLabel}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      <CollapsibleContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedProjects.map((project) => project.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-0.5 mt-0.5">
              {orderedProjects.map((project: Project) => (
                <SortableProjectItem
                  key={project.id}
                  activeProjectRef={activeProjectRef}
                  isMobile={isMobile}
                  project={project}
                  setSidebarOpen={setSidebarOpen}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </CollapsibleContent>
    </Collapsible>
  );
}
