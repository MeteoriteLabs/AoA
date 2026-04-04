import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import type { ExecutionWorkspace } from "@paperclipai/shared";
import type { Project } from "@paperclipai/shared";
import { WorkspaceTaskNav } from "./WorkspaceTaskNav";
import { DependencyChain } from "./DependencyChain";
import { WorkspaceTimeline } from "./WorkspaceTimeline";

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
        <Panel id="center-left" minSize="20%" className="min-w-0 h-full overflow-hidden flex flex-col" data-testid="workspace-center-panel">
          {selectedIssueId && (
            <DependencyChain
              issueId={selectedIssueId}
              companyId={companyId}
              selectedIssueId={selectedIssueId}
              onSelectIssue={onSelectIssue}
            />
          )}
          {selectedIssueId ? (
            <WorkspaceTimeline issueId={selectedIssueId} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Select a task to view its timeline
            </div>
          )}
        </Panel>

        <Separator
          id="center-separator"
          className="w-1 bg-transparent hover:bg-brand/50 transition-colors cursor-col-resize"
          data-testid="workspace-resizable-handle"
        />

        <Panel id="center-right" minSize="20%" className="min-w-0 h-full overflow-hidden" data-testid="workspace-preview-panel">
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Changes / Preview / Logs coming soon
          </div>
        </Panel>
      </Group>

      {/* Right panel — fixed ~280px */}
      <div className="w-[280px] shrink-0 h-full overflow-hidden border-l border-border" data-testid="workspace-right-panel">
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
          Context sections coming soon
        </div>
      </div>
    </div>
  );
}
