import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { artifactsApi } from "../../api/artifacts";
import { heartbeatsApi } from "../../api/heartbeats";
import { activityApi, type RunForIssue } from "../../api/activity";
import { executionWorkspacesApi } from "../../api/execution-workspaces";
import { queryKeys } from "../../lib/queryKeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitCompareArrows, Eye, Terminal, X, RefreshCw, Globe } from "lucide-react";
import { formatBytes, sourceLabel, fileIcon } from "./workspace-utils";
import type { ArtifactWithVersions, ArtifactVersion, DetectedOutput } from "@armyofagents/shared";

export type PreviewMode = "changes" | "preview" | "logs";

interface WorkspacePreviewPanelProps {
  issueId: string;
  companyId: string;
  activeMode: PreviewMode | null;
  onModeChange: (mode: PreviewMode | null) => void;
  /** Artifact version to preview (set by ArtifactsSection click) */
  previewArtifact?: { artifact: ArtifactWithVersions; version: ArtifactVersion } | null;
  /** Department function type — gates software-dev-only features */
  functionType?: string | null;
  /** Execution workspace ID — used for dev server preview */
  workspaceId?: string | null;
  /** Currently selected file path from FileTree in right sidebar */
  selectedFile?: string | null;
}

export function WorkspacePreviewPanel({
  issueId,
  companyId,
  activeMode,
  onModeChange,
  previewArtifact,
  functionType,
  workspaceId,
  selectedFile,
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
        {activeMode === "changes" && <ChangesView issueId={issueId} functionType={functionType ?? null} selectedFile={selectedFile ?? null} />}
        {activeMode === "preview" && (
          <PreviewView
            artifact={previewArtifact?.artifact ?? artifact ?? null}
            version={previewArtifact?.version ?? null}
            functionType={functionType ?? null}
            workspaceId={workspaceId ?? null}
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

function ChangesView({ issueId, functionType, selectedFile }: { issueId: string; functionType: string | null; selectedFile: string | null }) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: runs } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
  });

  if (functionType !== "software_development") {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground" data-testid="changes-no-code">
        No code changes to display
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground" data-testid="changes-no-runs">
        No runs yet
      </div>
    );
  }

  const activeRunId = selectedRunId ?? runs[0].runId;
  const activeRun = runs.find((r) => r.runId === activeRunId);
  const outputs: DetectedOutput[] = activeRun?.detectedOutputs ?? [];

  return (
    <div className="flex flex-col h-full" data-testid="changes-view">
      {runs.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto">
          {runs.slice(0, 10).map((r) => (
            <Button
              key={r.runId}
              variant={activeRunId === r.runId ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs shrink-0"
              onClick={() => setSelectedRunId(r.runId)}
            >
              Run {r.runId.slice(0, 6)}
            </Button>
          ))}
        </div>
      )}

      {outputs.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground" data-testid="changes-empty-run">
          No changes detected in this run
        </div>
      ) : selectedFile ? (
        // File detail card when a file is selected from the sidebar FileTree
        (() => {
          const output = outputs.find((o) => o.path === selectedFile);
          if (!output) return (
            <div className="p-4 text-sm text-muted-foreground">File not found in this run</div>
          );
          const Icon = fileIcon(output.contentType);
          const badge = sourceLabel(output.source);
          return (
            <div className="p-4 space-y-3" data-testid="changes-file-detail">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="text-sm font-mono font-medium truncate">{output.filename}</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">Path</span>
                  <code className="font-mono text-[11px] truncate">{output.path}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">Type</span>
                  <span>{output.contentType}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">Size</span>
                  <span>{formatBytes(output.byteSize)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">Source</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", badge.className)}>
                    {badge.text}
                  </span>
                </div>
                {output.sha256 && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">SHA-256</span>
                    <code className="font-mono text-[10px] truncate">{output.sha256}</code>
                  </div>
                )}
                {output.status && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">Status</span>
                    <span>{output.status}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        // Summary view: flat file list (default when no file selected)
        <div className="flex flex-col">
          {outputs.map((output, idx) => {
            const Icon = fileIcon(output.contentType);
            const badge = sourceLabel(output.source);
            return (
              <div
                key={`${output.path}-${idx}`}
                className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted/50"
                data-testid="changes-file-row"
                data-file-path={output.path}
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-xs font-mono truncate" title={output.path}>
                  {output.path}
                </span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", badge.className)}>
                  {badge.text}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatBytes(output.byteSize)}
                </span>
              </div>
            );
          })}
          <div className="px-3 py-2 text-[10px] text-muted-foreground">
            {outputs.length} file{outputs.length !== 1 ? "s" : ""} changed in this run
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewView({
  artifact,
  version: versionOverride,
  functionType,
  workspaceId,
}: {
  artifact: ArtifactWithVersions | null;
  version: ArtifactVersion | null;
  functionType: string | null;
  workspaceId: string | null;
}) {
  const [iframeKey, setIframeKey] = useState(0);

  const { data: runtimeServices } = useQuery({
    queryKey: ["runtime-services", workspaceId],
    queryFn: () => executionWorkspacesApi.runtimeServices(workspaceId!),
    enabled: functionType === "software_development" && !!workspaceId,
    refetchInterval: 10000,
  });

  const runningService = runtimeServices?.find((s) => s.status === "running" && s.url);

  // Dev server iframe for software departments
  if (functionType === "software_development" && workspaceId) {
    if (runningService?.url) {
      return (
        <div className="flex flex-col h-full" data-testid="preview-devserver">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1 text-xs font-mono text-muted-foreground truncate">
              {runningService.url}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIframeKey((k) => k + 1)}
              title="Refresh preview"
              data-testid="preview-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <iframe
            key={iframeKey}
            src={runningService.url}
            className="flex-1 w-full border-0"
            title="Dev server preview"
            data-testid="preview-iframe"
          />
        </div>
      );
    }

    // No running dev server — show message, then fall through to artifact preview below
    if (!artifact) {
      return (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-sm text-muted-foreground" data-testid="preview-no-devserver">
          <Globe className="h-5 w-5" />
          <p>No dev server running</p>
          <p className="text-xs">Dev servers start automatically during agent runs.</p>
        </div>
      );
    }
  }

  // Existing artifact preview (unchanged from current code)
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
