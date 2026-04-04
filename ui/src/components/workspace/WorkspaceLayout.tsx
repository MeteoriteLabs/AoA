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
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "aoa:workspace:panel-sizes",
    storage: localStorage,
    panelIds: ["center-left", "center-right"],
  });

  const [previewMode, setPreviewMode] = useState<PreviewMode | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<{
    artifact: ArtifactWithVersions;
    version: ArtifactVersion;
  } | null>(null);

  const handlePreviewArtifact = useCallback(
    (artifact: ArtifactWithVersions, version: ArtifactVersion) => {
      setPreviewArtifact({ artifact, version });
      setPreviewMode("preview");
    },
    [],
  );

  const handleModeChange = useCallback((mode: PreviewMode | null) => {
    setPreviewMode(mode);
    if (!mode) setPreviewArtifact(null);
  }, []);

  return (
    <div className="flex h-full overflow-hidden" data-testid="workspace-layout">
      {/* Left panel — fixed ~250px */}
      <div className="w-[250px] shrink-0 h-full overflow-hidden border-r border-border" data-testid="workspace-left-panel">
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

      {/* Center — resizable split */}
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
          {/* Toolbar with mode switcher */}
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
                />
              )}
            </Panel>
          </>
        )}
      </Group>

      {/* Right panel — fixed ~280px */}
      <div className="w-[280px] shrink-0 h-full overflow-hidden border-l border-border" data-testid="workspace-right-panel">
        {selectedIssueId ? (
          <WorkspaceRightPanel
            issueId={selectedIssueId}
            companyId={companyId}
            companyPrefix={companyPrefix}
            workspace={workspace}
            functionType={project?.functionType ?? null}
            onPreviewArtifact={handlePreviewArtifact}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
            Select a task to view context
          </div>
        )}
      </div>
    </div>
  );
}
