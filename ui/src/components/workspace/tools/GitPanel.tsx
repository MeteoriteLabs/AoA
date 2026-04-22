import { useState } from "react";
import { GitBranch, Copy, Check, ExternalLink, GitPullRequest, Github } from "lucide-react";
import type { ExecutionWorkspace, GitHubPrMetadata } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OpenInIdeButton } from "../OpenInIdeButton";
import { CreatePrDialog } from "../CreatePrDialog";

interface GitPanelProps {
  workspace: ExecutionWorkspace;
  issueId?: string | null;
}

const prStateColor: Record<string, string> = {
  open: "bg-green-500/15 text-green-400",
  merged: "bg-purple-500/15 text-purple-400",
  closed: "bg-red-500/15 text-red-400",
};

export function GitPanel({ workspace, issueId }: GitPanelProps) {
  const [copied, setCopied] = useState(false);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const raw = (workspace.metadata as Record<string, unknown> | null)?.pr;
  const pr =
    typeof raw === "object" && raw !== null && "url" in raw && "number" in raw && "state" in raw
      ? (raw as GitHubPrMetadata)
      : undefined;

  const handleCopy = async () => {
    if (!workspace.branchName) return;
    try {
      await navigator.clipboard.writeText(workspace.branchName);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available in this context
    }
  };

  const canCreatePr = Boolean(issueId);

  return (
    <div className="space-y-2 text-sm" data-testid="git-panel">
      {/* Open in IDE — launches VS Code / Cursor / Zed or reveals in file manager */}
      {workspace.cwd && (
        <div className="pb-2 border-b border-border" data-testid="git-panel-open-in-ide">
          <OpenInIdeButton cwd={workspace.cwd} />
        </div>
      )}

      {/* Branch */}
      {workspace.branchName && (
        <div className="flex items-center gap-2" data-testid="branch-row">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono text-xs truncate">{workspace.branchName}</span>
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

      {/* PR state */}
      <div className="flex items-center gap-2" data-testid="pr-row">
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

      {/* Create PR button (or link to existing PR) */}
      {pr ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1"
          data-testid="pr-link"
        >
          <ExternalLink className="h-3 w-3" />
          View PR #{pr.number}
        </a>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full mt-1"
          disabled={!canCreatePr}
          title={
            canCreatePr
              ? "Open pull request on GitHub"
              : "Link a task to this workspace to create a PR"
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
        />
      )}
    </div>
  );
}
