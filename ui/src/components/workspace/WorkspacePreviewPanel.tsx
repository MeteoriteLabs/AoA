import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { artifactsApi } from "../../api/artifacts";
import { heartbeatsApi } from "../../api/heartbeats";
import { activityApi, type RunForIssue } from "../../api/activity";
import { queryKeys } from "../../lib/queryKeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitCompareArrows, Eye, Terminal, X } from "lucide-react";
import type { ArtifactWithVersions, ArtifactVersion } from "@paperclipai/shared";

export type PreviewMode = "changes" | "preview" | "logs";

interface WorkspacePreviewPanelProps {
  issueId: string;
  companyId: string;
  activeMode: PreviewMode | null;
  onModeChange: (mode: PreviewMode | null) => void;
  /** Artifact version to preview (set by ArtifactsSection click) */
  previewArtifact?: { artifact: ArtifactWithVersions; version: ArtifactVersion } | null;
}

export function WorkspacePreviewPanel({
  issueId,
  companyId,
  activeMode,
  onModeChange,
  previewArtifact,
}: WorkspacePreviewPanelProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: artifact } = useQuery({
    queryKey: queryKeys.artifacts.byIssue(issueId),
    queryFn: () => artifactsApi.getByIssueId(issueId),
    enabled: activeMode === "preview" && !previewArtifact,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
    enabled: activeMode === "logs",
  });

  const latestRunId = selectedRunId ?? (runs && runs.length > 0 ? runs[0].runId : null);

  const { data: logData } = useQuery({
    queryKey: ["run-log", latestRunId],
    queryFn: () => heartbeatsApi.log(latestRunId!),
    enabled: activeMode === "logs" && !!latestRunId,
    refetchInterval: 5000,
  });

  if (!activeMode) return null;

  return (
    <div className="flex flex-col h-full" data-testid="workspace-preview-content">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {activeMode === "changes" && "Changes"}
          {activeMode === "preview" && "Preview"}
          {activeMode === "logs" && "Logs"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onModeChange(null)}
          data-testid="preview-close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {activeMode === "changes" && <ChangesView />}
        {activeMode === "preview" && (
          <PreviewView
            artifact={previewArtifact?.artifact ?? artifact ?? null}
            version={previewArtifact?.version ?? null}
          />
        )}
        {activeMode === "logs" && (
          <LogsView
            runs={runs ?? []}
            selectedRunId={latestRunId}
            onSelectRun={setSelectedRunId}
            logContent={logData?.content ?? null}
          />
        )}
      </ScrollArea>
    </div>
  );
}

/** Toolbar buttons rendered in the center panel header */
export function PreviewModeToolbar({
  activeMode,
  onModeChange,
}: {
  activeMode: PreviewMode | null;
  onModeChange: (mode: PreviewMode | null) => void;
}) {
  const modes: { key: PreviewMode; icon: typeof GitCompareArrows; label: string }[] = [
    { key: "changes", icon: GitCompareArrows, label: "Changes" },
    { key: "preview", icon: Eye, label: "Preview" },
    { key: "logs", icon: Terminal, label: "Logs" },
  ];

  return (
    <div className="flex items-center gap-1" data-testid="preview-mode-toolbar">
      {modes.map(({ key, icon: Icon, label }) => (
        <Button
          key={key}
          variant={activeMode === key ? "secondary" : "ghost"}
          size="sm"
          className={cn(
            "h-7 px-2 text-xs gap-1.5",
            activeMode === key && "bg-accent text-accent-foreground",
          )}
          onClick={() => onModeChange(activeMode === key ? null : key)}
          data-testid={`preview-mode-${key}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Button>
      ))}
    </div>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────────────────

function ChangesView() {
  return (
    <div className="flex items-center justify-center h-48 text-sm text-muted-foreground" data-testid="changes-placeholder">
      Diff viewer coming in Phase 4
    </div>
  );
}

function PreviewView({
  artifact,
  version: versionOverride,
}: {
  artifact: ArtifactWithVersions | null;
  version: ArtifactVersion | null;
}) {
  if (!artifact) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground" data-testid="preview-empty">
        No artifacts linked to this task
      </div>
    );
  }

  const version = versionOverride ?? (artifact.versions.length > 0 ? artifact.versions[0] : null);

  if (!version) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No versions available
      </div>
    );
  }

  const isImage = artifact.type === "design" || (version.fileUrl && /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(version.fileUrl));

  if (isImage && version.fileUrl) {
    return (
      <div className="p-4" data-testid="preview-image">
        <img src={version.fileUrl} alt={artifact.title} className="max-w-full rounded border border-border" />
      </div>
    );
  }

  if (version.content) {
    return (
      <div className="p-4" data-testid="preview-text">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono bg-muted/50 rounded p-3 border border-border">
          {version.content}
        </pre>
      </div>
    );
  }

  if (version.fileUrl) {
    return (
      <div className="flex items-center justify-center h-48" data-testid="preview-download">
        <a
          href={version.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-500 hover:underline"
        >
          Download {artifact.title} (v{version.versionNumber})
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
      No content to preview
    </div>
  );
}

function LogsView({
  runs,
  selectedRunId,
  onSelectRun,
  logContent,
}: {
  runs: RunForIssue[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  logContent: string | null;
}) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground" data-testid="logs-empty">
        No runs yet
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="logs-view">
      {runs.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto">
          {runs.slice(0, 10).map((r) => (
            <Button
              key={r.runId}
              variant={selectedRunId === r.runId ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs shrink-0"
              onClick={() => onSelectRun(r.runId)}
            >
              Run {r.runId.slice(0, 6)}
            </Button>
          ))}
        </div>
      )}
      <pre className="flex-1 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono overflow-auto" data-testid="logs-content">
        {logContent || "Loading logs..."}
      </pre>
    </div>
  );
}
