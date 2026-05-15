import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Github,
  Loader2,
  Upload,
} from "lucide-react";
import type { ExecutionWorkspace, GitHubPrMetadata } from "@armyofagents/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OpenInIdeButton } from "../OpenInIdeButton";
import { CreatePrDialog } from "../CreatePrDialog";
import { useToast } from "../../../context/ToastContext";
import {
  executionWorkspacesApi,
  type GitFileEntry,
  type GitStatusResponse,
  type GitLogEntry,
  type WorkspaceMutationSafety,
} from "@/api/execution-workspaces";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitPanelProps {
  workspace: ExecutionWorkspace;
  issueId?: string | null;
  isExpanded?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_POLL_INTERVAL = 10_000; // 10s — server cache is 5s
const LOG_POLL_INTERVAL = 30_000;

const FILE_STATUS_COLORS: Record<string, string> = {
  modified: "text-yellow-400",
  added: "text-green-400",
  deleted: "text-red-400",
  renamed: "text-blue-400",
  copied: "text-blue-400",
  untracked: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

const FILE_STATUS_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "?",
  unknown: "?",
};

const prStateColor: Record<string, string> = {
  open: "bg-green-500/15 text-green-400",
  merged: "bg-purple-500/15 text-purple-400",
  closed: "bg-red-500/15 text-red-400",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WorkspaceBadge({ workspace }: { workspace: ExecutionWorkspace }) {
  const isIsolated = workspace.providerType === "git_worktree";
  const hasRemote = Boolean(workspace.repoUrl);
  return (
    <div className="flex items-center gap-1 mb-2">
      <span
        className={cn(
          "text-[10px] px-1.5 py-0.5 rounded font-medium",
          isIsolated
            ? "bg-blue-500/15 text-blue-400"
            : "bg-amber-500/15 text-amber-400",
        )}
      >
        {isIsolated ? "Isolated" : "Shared"}
      </span>
      <span
        className={cn(
          "text-[10px] px-1.5 py-0.5 rounded font-medium",
          hasRemote
            ? "bg-green-500/15 text-green-400"
            : "bg-zinc-500/15 text-zinc-400",
        )}
      >
        {hasRemote ? "Remote" : "Local"}
      </span>
    </div>
  );
}

function AheadBehindIndicator({ ahead, behind }: { ahead: number | null | undefined; behind: number | null | undefined }) {
  if (ahead == null && behind == null) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {(ahead ?? 0) > 0 && (
        <span className="flex items-center gap-0.5 text-green-400" title={`${ahead} commit(s) ahead of remote`}>
          <ArrowUp className="h-3 w-3" />{ahead}
        </span>
      )}
      {(behind ?? 0) > 0 && (
        <span className="flex items-center gap-0.5 text-orange-400" title={`${behind} commit(s) behind remote`}>
          <ArrowDown className="h-3 w-3" />{behind}
        </span>
      )}
      {(ahead ?? 0) === 0 && (behind ?? 0) === 0 && (
        <span className="text-muted-foreground">up to date</span>
      )}
    </div>
  );
}

function CommitLogSection({ workspaceId, isExpanded }: { workspaceId: string; isExpanded: boolean }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["workspace-git-log", workspaceId],
    queryFn: () => executionWorkspacesApi.getGitLog(workspaceId, 5),
    refetchInterval: LOG_POLL_INTERVAL,
    staleTime: LOG_POLL_INTERVAL - 2000,
    enabled: isExpanded && open,
  });

  const entries: GitLogEntry[] = data?.entries ?? [];

  return (
    <div className="mt-2">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <GitCommit className="h-3 w-3" />
        Recent commits
      </button>
      {open && entries.length > 0 && (
        <div className="mt-1 space-y-1 ml-4">
          {entries.map((entry) => (
            <div key={entry.hash} className="text-xs" title={`${entry.author} · ${entry.timestamp}`}>
              <span className="font-mono text-muted-foreground mr-1.5">{entry.shortHash}</span>
              <span className="text-foreground truncate">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
      {open && entries.length === 0 && (
        <div className="mt-1 ml-4 text-xs text-muted-foreground">No commits yet</div>
      )}
    </div>
  );
}

function SafetyConfirmationDialog({
  safety,
  onCancel,
  onContinue,
}: {
  safety: WorkspaceMutationSafety | null;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={!!safety} onOpenChange={(open) => { if (!open) onCancel(); }}>
      {safety && (
        <DialogContent data-testid="workspace-safety-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
              Workspace safety check
            </DialogTitle>
            <DialogDescription>
              This workspace may still have agent work in flight. Review the current state before continuing.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3 text-sm">
            {safety.task && (
              <div className="rounded-md border border-border px-3 py-2">
                <div className="text-xs text-muted-foreground">Task</div>
                <div className="font-medium">
                  {safety.task.identifier ? `${safety.task.identifier} · ` : ""}
                  {safety.task.title}
                </div>
                <div className="text-xs text-muted-foreground">Status: {safety.task.status}</div>
              </div>
            )}
            {safety.activeRun && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <div className="text-xs text-muted-foreground">Active run</div>
                <div className="font-medium">Run {safety.activeRun.id}</div>
                <div className="text-xs text-muted-foreground">Status: {safety.activeRun.status}</div>
              </div>
            )}
            {safety.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {safety.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="button" onClick={onContinue}>Continue anyway</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function GitPanel({ workspace, issueId, isExpanded = true }: GitPanelProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  // ── State ──
  const [copied, setCopied] = useState(false);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showCommitForm, setShowCommitForm] = useState(false);
  const [safetyConfirmation, setSafetyConfirmation] = useState<{
    safety: WorkspaceMutationSafety;
    onContinue: () => void;
  } | null>(null);
  const [checkingSafetyFor, setCheckingSafetyFor] = useState<"commit" | "push" | null>(null);

  // ── Live git status query ──
  const {
    data: statusData,
    isLoading: statusLoading,
    error: statusError,
  } = useQuery({
    queryKey: ["workspace-git-status", workspace.id],
    queryFn: () => executionWorkspacesApi.getGitStatus(workspace.id),
    refetchInterval: STATUS_POLL_INTERVAL,
    staleTime: STATUS_POLL_INTERVAL - 2000,
    enabled: isExpanded && Boolean(workspace.cwd),
  });

  // ── Derived values from live status ──
  const gitAvailable = statusData?.gitAvailable ?? false;
  const liveBranch = statusData?.branch ?? workspace.branchName ?? null;
  const detachedHead = statusData?.detachedHead ?? false;
  const files: GitFileEntry[] = statusData?.files ?? [];
  const isClean = statusData?.clean ?? true;
  const remote = statusData?.remote ?? null;
  const ahead = statusData?.ahead;
  const behind = statusData?.behind;

  // PR metadata from workspace
  const raw = (workspace.metadata as Record<string, unknown> | null)?.pr;
  const pr =
    typeof raw === "object" && raw !== null && "url" in raw && "number" in raw && "state" in raw
      ? (raw as GitHubPrMetadata)
      : undefined;

  // ── File selection helpers ──
  const committableFiles = useMemo(
    () => files.filter((f) => f.status !== "unknown"),
    [files],
  );

  const toggleFile = useCallback((filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(committableFiles.map((f) => f.path)));
  }, [committableFiles]);

  const selectNone = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  // ── Commit mutation ──
  const commitMutation = useMutation({
    mutationFn: (data: { message: string; files: string[] }) =>
      executionWorkspacesApi.gitCommit(workspace.id, data),
    onSuccess: (result) => {
      pushToast({
        tone: "success",
        title: "Committed",
        body: `${result.filesCommitted.length} file(s) committed`,
      });
      if (result.activeRunWarning) {
        pushToast({
          tone: "warn",
          title: "Agent running",
          body: "An agent is currently active on this workspace. Your commit may conflict.",
        });
      }
      if (result.skippedFiles.length > 0) {
        pushToast({
          tone: "warn",
          title: "Files skipped",
          body: `${result.skippedFiles.length} file(s) excluded by security policy: ${result.skippedFiles.join(", ")}`,
        });
      }
      // Reset form
      setCommitMessage("");
      setSelectedFiles(new Set());
      setShowCommitForm(false);
      // Refresh status
      queryClient.invalidateQueries({ queryKey: ["workspace-git-status", workspace.id] });
      queryClient.invalidateQueries({ queryKey: ["workspace-git-log", workspace.id] });
    },
    onError: (err: Error) => {
      pushToast({ tone: "error", title: "Commit failed", body: err.message });
    },
  });

  // ── Push mutation ──
  const pushMutation = useMutation({
    mutationFn: () => executionWorkspacesApi.gitPush(workspace.id),
    onSuccess: (result) => {
      pushToast({
        tone: "success",
        title: "Pushed",
        body: `Pushed to ${result.remote}/${result.branch}`,
      });
      if (result.activeRunWarning) {
        pushToast({
          tone: "warn",
          title: "Agent running",
          body: "An agent is currently active on this workspace.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["workspace-git-status", workspace.id] });
      queryClient.invalidateQueries({ queryKey: ["workspace-git-log", workspace.id] });
    },
    onError: (err: Error) => {
      pushToast({ tone: "error", title: "Push failed", body: err.message });
    },
  });

  // ── Copy branch name ──
  const handleCopy = async () => {
    if (!liveBranch) return;
    try {
      await navigator.clipboard.writeText(liveBranch);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  };

  const runWithSafety = async (kind: "commit" | "push", onContinue: () => void) => {
    setCheckingSafetyFor(kind);
    try {
      const safety = await executionWorkspacesApi.safety(workspace.id);
      if (safety.requiresConfirmation[kind]) {
        setSafetyConfirmation({ safety, onContinue });
        return;
      }
      onContinue();
    } catch {
      onContinue();
    } finally {
      setCheckingSafetyFor(null);
    }
  };

  // ── Commit handler ──
  const handleCommit = () => {
    if (!commitMessage.trim() || selectedFiles.size === 0) return;
    const payload = {
      message: commitMessage.trim(),
      files: Array.from(selectedFiles),
    };
    void runWithSafety("commit", () => commitMutation.mutate(payload));
  };

  // ── PR availability ──
  const hasRepoUrl = Boolean(workspace.repoUrl);
  const canCreatePr = Boolean(issueId) && (hasRepoUrl || !!remote) && !!liveBranch;

  // ── No workspace path ──
  if (!workspace.cwd) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="git-panel">
        No workspace directory configured.
      </div>
    );
  }

  // ── Loading ──
  if (statusLoading && !statusData) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2" data-testid="git-panel">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading git status...
      </div>
    );
  }

  // ── Git not available ──
  if (statusData && !gitAvailable) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="git-panel">
        {statusData.reason ?? "Git is not available for this workspace."}
      </div>
    );
  }

  // ── Error ──
  if (statusError && !statusData) {
    return (
      <div className="text-xs text-red-400" data-testid="git-panel">
        Failed to load git status.
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm" data-testid="git-panel">
      {/* Workspace type badges */}
      <WorkspaceBadge workspace={workspace} />

      {/* Open in IDE */}
      {workspace.cwd && (
        <div className="pb-2 border-b border-border" data-testid="git-panel-open-in-ide">
          <OpenInIdeButton cwd={workspace.cwd} />
        </div>
      )}

      {/* Detached HEAD warning */}
      {detachedHead && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Detached HEAD — commits and pushes are disabled.
        </div>
      )}

      {/* Branch */}
      {liveBranch && (
        <div className="flex items-center gap-2" data-testid="branch-row">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono text-xs truncate">{liveBranch}</span>
          <button
            onClick={handleCopy}
            className="ml-auto shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
            data-testid="copy-branch-btn"
            title={copied ? "Copied!" : "Copy branch name"}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-400" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        </div>
      )}

      {/* Base ref */}
      {workspace.baseRef && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="base-ref-row">
          <span className="ml-5.5">from</span>
          <span className="font-mono">{workspace.baseRef}</span>
        </div>
      )}

      {/* Ahead/Behind indicator */}
      {gitAvailable && !detachedHead && remote && (
        <div className="ml-5.5" data-testid="ahead-behind-row">
          <AheadBehindIndicator ahead={ahead} behind={behind} />
        </div>
      )}

      {/* Repo URL */}
      {workspace.repoUrl && (
        <div className="flex items-center gap-2" data-testid="repo-url-row">
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {workspace.repoUrl.startsWith("http") ? (
            <a
              href={workspace.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline truncate"
            >
              {workspace.repoUrl.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <span className="text-xs text-muted-foreground truncate">{workspace.repoUrl}</span>
          )}
        </div>
      )}

      {/* File changes */}
      {gitAvailable && !isClean && (
        <div className="space-y-1" data-testid="file-changes">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {files.length} changed file{files.length !== 1 ? "s" : ""}
            </span>
            {!detachedHead && (
              <button
                type="button"
                className="text-[10px] text-blue-400 hover:underline"
                onClick={() => {
                  setShowCommitForm(!showCommitForm);
                  if (!showCommitForm && selectedFiles.size === 0) selectAll();
                }}
              >
                {showCommitForm ? "Hide" : "Commit..."}
              </button>
            )}
          </div>

          {/* File list (always visible when dirty) */}
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {files.map((file) => (
              <div
                key={file.path}
                className="flex items-center gap-1.5 text-xs group"
              >
                {showCommitForm && (
                  <Checkbox
                    checked={selectedFiles.has(file.path)}
                    onCheckedChange={() => toggleFile(file.path)}
                    className="h-3 w-3"
                  />
                )}
                <span
                  className={cn(
                    "font-mono text-[10px] w-3 text-center shrink-0",
                    FILE_STATUS_COLORS[file.status] ?? "text-muted-foreground",
                  )}
                  title={file.status}
                >
                  {FILE_STATUS_LABELS[file.status] ?? "?"}
                </span>
                <span className="font-mono text-xs text-foreground truncate" title={file.path}>
                  {file.path}
                </span>
              </div>
            ))}
          </div>

          {/* Commit form */}
          {showCommitForm && (
            <div className="space-y-1.5 pt-1 border-t border-border" data-testid="commit-form">
              <div className="flex items-center gap-2 text-[10px]">
                <button type="button" className="text-blue-400 hover:underline" onClick={selectAll}>
                  All
                </button>
                <button type="button" className="text-blue-400 hover:underline" onClick={selectNone}>
                  None
                </button>
                <span className="text-muted-foreground ml-auto">
                  {selectedFiles.size}/{committableFiles.length} selected
                </span>
              </div>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message..."
                className="w-full text-xs bg-muted/50 border border-border rounded px-2 py-1.5 resize-none min-h-[52px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="commit-message-input"
              />
              <Button
                size="sm"
                variant="default"
                className="w-full"
                disabled={
                  !commitMessage.trim() ||
                  selectedFiles.size === 0 ||
                  commitMutation.isPending ||
                  checkingSafetyFor === "commit"
                }
                onClick={handleCommit}
                data-testid="commit-btn"
              >
                {commitMutation.isPending || checkingSafetyFor === "commit" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <GitCommit className="h-3.5 w-3.5 mr-1.5" />
                )}
                Commit {selectedFiles.size} file{selectedFiles.size !== 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Clean working tree */}
      {gitAvailable && isClean && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Check className="h-3 w-3 text-green-400" />
          Working tree clean
        </div>
      )}

      {/* Push button */}
      {gitAvailable && !detachedHead && remote && (ahead ?? 0) > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={pushMutation.isPending || checkingSafetyFor === "push"}
          onClick={() => void runWithSafety("push", () => pushMutation.mutate())}
          data-testid="push-btn"
        >
          {pushMutation.isPending || checkingSafetyFor === "push" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-1.5" />
          )}
          Push {ahead} commit{ahead === 1 ? "" : "s"}
        </Button>
      )}

      {gitAvailable && !detachedHead && remote && (ahead ?? 0) === 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Check className="h-3 w-3 text-green-400" />
          Pushed
        </div>
      )}

      {/* Recent commits (collapsible) */}
      {gitAvailable && (
        <CommitLogSection workspaceId={workspace.id} isExpanded={isExpanded} />
      )}

      {/* PR state */}
      <div className="flex items-center gap-2 pt-1 border-t border-border" data-testid="pr-row">
        <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {pr ? (
          <div className="flex items-center gap-1.5">
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline"
            >
              #{pr.number}
            </a>
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                prStateColor[pr.state] ?? "bg-muted text-muted-foreground",
              )}
            >
              {pr.state}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No PR created</span>
        )}
      </div>

      {/* Create PR / View PR */}
      {pr ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          data-testid="pr-link"
        >
          <ExternalLink className="h-3 w-3" />
          View PR #{pr.number}
        </a>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={!canCreatePr}
          title={
            !issueId
              ? "Link a task to this workspace to create a PR"
              : !liveBranch
                ? "Branch not yet provisioned"
                : !(hasRepoUrl || remote)
                  ? "No remote configured"
                  : "Open pull request on GitHub"
          }
          onClick={() => setCreatePrOpen(true)}
          data-testid="create-pr-btn"
        >
          <Github className="h-4 w-4 mr-2" />
          Create PR
        </Button>
      )}

      {issueId && (
        <CreatePrDialog
          issueId={issueId}
          workspace={workspace}
          open={createPrOpen}
          onOpenChange={setCreatePrOpen}
          liveBranch={liveBranch}
        />
      )}

      <SafetyConfirmationDialog
        safety={safetyConfirmation?.safety ?? null}
        onCancel={() => setSafetyConfirmation(null)}
        onContinue={() => {
          const action = safetyConfirmation?.onContinue;
          setSafetyConfirmation(null);
          action?.();
        }}
      />
    </div>
  );
}
