import { useState, useCallback } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import type { ExecutionWorkspace } from "@paperclipai/shared";
import type { Project } from "@paperclipai/shared";
import type { ArtifactWithVersions, ArtifactVersion } from "@paperclipai/shared";
import { WorkspaceTaskNav } from "./WorkspaceTaskNav";
import { DependencyChain } from "./DependencyChain";
import { WorkspaceTimeline } from "./WorkspaceTimeline";
import { WorkspacePreviewPanel, PreviewModeToolbar, type PreviewMode } from "./WorkspacePreviewPanel";
import { WorkspaceRightPanel } from "./WorkspaceRightPanel";
import { useSidebar } from "../../context/SidebarContext";
import { useSidebarCollapsed } from "./useSidebarCollapsed";
import { ListTodo, MessageSquare, Eye, Layers, AlertTriangle, MoreHorizontal, Archive, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const MOBILE_TABS = [
  { key: "tasks" as const, label: "Tasks", icon: ListTodo },
  { key: "timeline" as const, label: "Timeline", icon: MessageSquare },
  { key: "preview" as const, label: "Preview", icon: Eye },
  { key: "context" as const, label: "Context", icon: Layers },
];

interface WorkspaceLayoutProps {
  workspace: ExecutionWorkspace;
  project: Project | null;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  companyId: string;
  companyPrefix: string;
  onBack: () => void;
}

export function WorkspaceLayout({
  workspace,
  project,
  selectedIssueId,
  onSelectIssue,
  companyId,
  companyPrefix,
  onBack,
}: WorkspaceLayoutProps) {
  const { isMobile } = useSidebar();
  const [mobileTab, setMobileTab] = useState<"tasks" | "timeline" | "preview" | "context">("timeline");

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `aoa:workspace:panel-sizes:${workspace.id}`,
    storage: localStorage,
    panelIds: ["center-left", "center-right"],
  });

  const [previewMode, setPreviewMode] = useState<PreviewMode | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<{
    artifact: ArtifactWithVersions;
    version: ArtifactVersion;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Header action state — wired by later Phase I tasks (Settings → Task 10, Archive → Task 5).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  // Sidebar collapse state (desktop only; persisted per workspace)
  const [leftCollapsed, setLeftCollapsed] = useSidebarCollapsed(workspace.id, "left");
  const [rightCollapsed, setRightCollapsed] = useSidebarCollapsed(workspace.id, "right");
  const [scrollToGroup, setScrollToGroup] = useState<{ group: string; nonce: number } | null>(null);
  const [openSectionRequest, setOpenSectionRequest] = useState<{ section: string; nonce: number } | null>(null);

  const handleExpandAndShowGroup = useCallback(
    (group: string) => {
      setLeftCollapsed(false);
      setScrollToGroup({ group, nonce: Date.now() });
    },
    [setLeftCollapsed],
  );

  const handleExpandAndShowSection = useCallback(
    (section: string) => {
      setRightCollapsed(false);
      setOpenSectionRequest({ section, nonce: Date.now() });
    },
    [setRightCollapsed],
  );

  const handlePreviewArtifact = useCallback(
    (artifact: ArtifactWithVersions, version: ArtifactVersion) => {
      setPreviewArtifact({ artifact, version });
      setPreviewMode("preview");
    },
    [],
  );

  const handleModeChange = useCallback((mode: PreviewMode | null) => {
    setPreviewMode(mode);
    if (!mode) {
      setPreviewArtifact(null);
      setSelectedFile(null);
    }
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFile(path);
    // Auto-open changes panel if not already open
    if (previewMode !== "changes") {
      setPreviewMode("changes");
    }
  }, [previewMode]);

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="workspace-layout">
      {/* Archived banner */}
      {workspace.status === "archived" && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-50 border-b border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300 shrink-0" data-testid="workspace-archived-banner">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This workspace is archived
        </div>
      )}

      {/* Header chrome — workspace title + actions kebab. Menu items are disabled pending later Phase I tasks. */}
      <header
        className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-2 shrink-0"
        data-testid="workspace-header"
      >
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-medium truncate" data-testid="workspace-header-name">
            {workspace.name}
          </h1>
          {workspace.branchName && (
            <span
              className="text-xs text-muted-foreground truncate"
              data-testid="workspace-header-branch"
            >
              on {workspace.branchName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Open in IDE button — wired in Task 6 */}
          <DropdownMenu open={headerMenuOpen} onOpenChange={setHeaderMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Workspace actions"
                data-testid="workspace-header-menu-trigger"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            {headerMenuOpen && (
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  disabled
                  data-testid="workspace-header-menu-settings"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                  <span className="ml-auto text-xs text-muted-foreground">Task 10</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setArchiveOpen(true)}
                  variant="destructive"
                  disabled
                  data-testid="workspace-header-menu-archive"
                >
                  <Archive className="h-4 w-4 mr-2" />
                  Archive
                  <span className="ml-auto text-xs text-muted-foreground">Task 5</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      </header>

      {isMobile ? (
        <>
          {/* Mobile tab bar */}
          <div className="flex border-b border-border shrink-0" data-testid="workspace-mobile-tabs">
            {MOBILE_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobileTab(key)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors",
                  mobileTab === key
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`mobile-tab-${key}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Mobile panels — all rendered, only active visible via CSS */}
          <div className="flex-1 min-h-0 relative">
            <div className={cn("absolute inset-0 overflow-auto", mobileTab !== "tasks" && "hidden")} data-testid="mobile-panel-tasks">
              <WorkspaceTaskNav
                companyId={companyId}
                companyPrefix={companyPrefix}
                projectId={workspace.projectId}
                selectedIssueId={selectedIssueId}
                onSelectIssue={onSelectIssue}
                onBack={onBack}
                departmentName={project?.name ?? "Department"}
              />
            </div>

            <div className={cn("absolute inset-0 overflow-hidden flex flex-col", mobileTab !== "timeline" && "hidden")} data-testid="mobile-panel-timeline">
              {selectedIssueId ? (
                <>
                  <div className="shrink-0 border-b border-border">
                    <DependencyChain
                      issueId={selectedIssueId}
                      companyId={companyId}
                      selectedIssueId={selectedIssueId}
                      onSelectIssue={onSelectIssue}
                    />
                  </div>
                  <div className="flex-1 min-h-0">
                    <WorkspaceTimeline issueId={selectedIssueId} />
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Select a task to view its timeline
                </div>
              )}
            </div>

            <div className={cn("absolute inset-0 overflow-hidden", mobileTab !== "preview" && "hidden")} data-testid="mobile-panel-preview">
              {selectedIssueId ? (
                <WorkspacePreviewPanel
                  issueId={selectedIssueId}
                  companyId={companyId}
                  activeMode={previewMode ?? "changes"}
                  onModeChange={handleModeChange}
                  previewArtifact={previewArtifact}
                  functionType={project?.functionType ?? null}
                  workspaceId={workspace.id}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Select a task to preview
                </div>
              )}
            </div>

            <div className={cn("absolute inset-0 overflow-auto", mobileTab !== "context" && "hidden")} data-testid="mobile-panel-context">
              {selectedIssueId ? (
                <WorkspaceRightPanel
                  issueId={selectedIssueId}
                  companyId={companyId}
                  companyPrefix={companyPrefix}
                  workspace={workspace}
                  functionType={project?.functionType ?? null}
                  previewMode={previewMode}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  onPreviewArtifact={handlePreviewArtifact}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
                  Select a task to view context
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Desktop layout — existing code */
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left panel */}
          <div
            className={cn(
              "shrink-0 h-full overflow-hidden border-r border-border transition-[width] duration-200",
              leftCollapsed ? "w-[48px]" : "w-[250px]",
            )}
            data-testid="workspace-left-panel"
            data-collapsed={leftCollapsed ? "true" : "false"}
          >
            <WorkspaceTaskNav
              companyId={companyId}
              companyPrefix={companyPrefix}
              projectId={workspace.projectId}
              selectedIssueId={selectedIssueId}
              onSelectIssue={onSelectIssue}
              onBack={onBack}
              departmentName={project?.name ?? "Department"}
              collapsed={leftCollapsed}
              onToggleCollapse={() => setLeftCollapsed(!leftCollapsed)}
              onExpandAndShowGroup={handleExpandAndShowGroup}
              scrollToGroup={scrollToGroup}
            />
          </div>

          {/* Center */}
          <Group
            orientation="horizontal"
            className="flex-1 min-w-0 h-full"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
            data-testid="workspace-center-group"
          >
            <Panel
              id="center-left"
              minSize="20%"
              className="min-w-0 h-full overflow-hidden flex flex-col"
              data-testid="workspace-center-panel"
            >
              {selectedIssueId && (
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
                  <DependencyChain
                    issueId={selectedIssueId}
                    companyId={companyId}
                    selectedIssueId={selectedIssueId}
                    onSelectIssue={onSelectIssue}
                  />
                  <PreviewModeToolbar activeMode={previewMode} onModeChange={handleModeChange} />
                </div>
              )}

              {selectedIssueId ? (
                <WorkspaceTimeline issueId={selectedIssueId} />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Select a task to view its timeline
                </div>
              )}
            </Panel>

            {previewMode && (
              <>
                <Separator
                  id="center-separator"
                  className="w-1 bg-transparent hover:bg-brand/50 transition-colors cursor-col-resize"
                  data-testid="workspace-resizable-handle"
                />
                <Panel
                  id="center-right"
                  minSize="20%"
                  className="min-w-0 h-full overflow-hidden"
                  data-testid="workspace-preview-panel"
                >
                  {selectedIssueId && (
                    <WorkspacePreviewPanel
                      issueId={selectedIssueId}
                      companyId={companyId}
                      activeMode={previewMode}
                      onModeChange={handleModeChange}
                      previewArtifact={previewArtifact}
                      functionType={project?.functionType ?? null}
                      workspaceId={workspace.id}
                      selectedFile={selectedFile}
                    />
                  )}
                </Panel>
              </>
            )}
          </Group>

          {/* Right panel */}
          <div
            className={cn(
              "shrink-0 h-full overflow-hidden border-l border-border transition-[width] duration-200",
              rightCollapsed ? "w-[48px]" : "w-[280px]",
            )}
            data-testid="workspace-right-panel"
            data-collapsed={rightCollapsed ? "true" : "false"}
          >
            {selectedIssueId ? (
              <WorkspaceRightPanel
                issueId={selectedIssueId}
                companyId={companyId}
                companyPrefix={companyPrefix}
                workspace={workspace}
                functionType={project?.functionType ?? null}
                previewMode={previewMode}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
                onPreviewArtifact={handlePreviewArtifact}
                collapsed={rightCollapsed}
                onToggleCollapse={() => setRightCollapsed(!rightCollapsed)}
                onExpandAndShowSection={handleExpandAndShowSection}
                openSection={openSectionRequest}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
                Select a task to view context
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
