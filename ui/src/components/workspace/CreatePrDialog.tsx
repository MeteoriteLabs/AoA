import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, Github, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  ExecutionWorkspace,
  GitHubPrCreateResponse,
} from "@paperclipai/shared";
import { issuesApi } from "../../api/issues";
import { githubIntegrationApi } from "../../api/github-integration";
import { ApiError } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { queryKeys } from "../../lib/queryKeys";

interface Props {
  issueId: string;
  workspace: ExecutionWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (pr: GitHubPrCreateResponse) => void;
}

/**
 * Create PR dialog — prefills title/body from the linked task, base from
 * `workspace.baseRef ?? "main"`, head from `workspace.branchName` (read-only).
 * On submit, calls the server which uses the company's stored GitHub PAT to
 * create the PR, persists `workspace.metadata.pr`, posts a task comment, and
 * logs activity.
 *
 * Error banners surface:
 * - 412 "GitHub not configured" with link to Settings → Integrations
 * - 401/403 auth/scope problems with hint text from the server
 * - other errors as a generic "Failed to create PR" message
 */
export function CreatePrDialog({
  issueId,
  workspace,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const qc = useQueryClient();
  const { pushToast } = useToast();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState(workspace.baseRef ?? "main");
  const [draft, setDraft] = useState(false);

  const issueQuery = useQuery({
    queryKey: queryKeys.issues.detail(issueId),
    queryFn: () => issuesApi.get(issueId),
    enabled: open,
  });

  // Prefill when dialog opens / when the issue loads.
  useEffect(() => {
    if (!open) return;
    if (issueQuery.data) {
      setTitle(issueQuery.data.title ?? "");
      setBody(issueQuery.data.description ?? "");
    }
    setBase(workspace.baseRef ?? "main");
    setDraft(false);
  }, [open, issueQuery.data, workspace.baseRef]);

  const mutation = useMutation({
    mutationFn: () =>
      githubIntegrationApi.createPR(issueId, {
        workspaceId: workspace.id,
        title,
        body,
        base,
        draft,
      }),
    onSuccess: (pr) => {
      pushToast({
        title: `PR #${pr.number} created`,
        tone: "success",
      });
      qc.invalidateQueries({
        queryKey: queryKeys.executionWorkspaces.detail(workspace.id),
      });
      qc.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      qc.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
      onCreated?.(pr);
      onOpenChange(false);
    },
  });

  const error = mutation.error instanceof ApiError ? mutation.error : null;
  const errorHint =
    error && typeof (error.body as { hint?: unknown } | null)?.hint === "string"
      ? ((error.body as { hint: string }).hint)
      : null;

  const canSubmit =
    title.trim().length > 0 && base.trim().length > 0 && !mutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent data-testid="create-pr-dialog" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="h-4 w-4" aria-hidden="true" />
              Create pull request
            </DialogTitle>
            <DialogDescription>
              Open a GitHub PR using the company's saved token. The PR URL will
              be saved to this workspace and posted as a task comment.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="pr-title" className="text-sm font-medium">
                Title
              </Label>
              <Input
                id="pr-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={mutation.isPending}
                data-testid="pr-title-input"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <Label htmlFor="pr-body" className="text-sm font-medium">
                Description
              </Label>
              <Textarea
                id="pr-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                disabled={mutation.isPending}
                data-testid="pr-body-input"
              />
              <p className="text-xs text-muted-foreground">
                Prefilled from the linked task. Supports GitHub markdown.
              </p>
            </div>

            {/* Base / head */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pr-base" className="text-sm font-medium">
                  Base branch
                </Label>
                <Input
                  id="pr-base"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  disabled={mutation.isPending}
                  data-testid="pr-base-input"
                />
                <p className="text-xs text-muted-foreground">
                  The branch to merge into.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Head branch</Label>
                <div
                  className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm font-mono text-muted-foreground truncate"
                  data-testid="pr-head-readonly"
                  title={workspace.branchName ?? ""}
                >
                  {workspace.branchName ?? "—"}
                </div>
                <p className="text-xs text-muted-foreground">
                  From this workspace.
                </p>
              </div>
            </div>

            {/* Draft */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="pr-draft"
                checked={draft}
                onCheckedChange={(checked) => setDraft(checked === true)}
                disabled={mutation.isPending}
                data-testid="pr-draft-checkbox"
              />
              <Label htmlFor="pr-draft" className="text-sm">
                Open as draft
              </Label>
            </div>

            {/* Error banner */}
            {error && error.status === 412 && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
                data-testid="pr-error-412"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                  aria-hidden="true"
                />
                <div className="flex-1 space-y-1">
                  <div className="font-medium">GitHub not connected</div>
                  <p className="text-xs text-muted-foreground">
                    Connect a personal access token before creating PRs.
                  </p>
                  <Link
                    to="/settings/integrations"
                    className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    Open Settings → Integrations
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}

            {error && (error.status === 401 || error.status === 403) && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                data-testid="pr-error-scope"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <div className="flex-1 space-y-1">
                  <div className="font-medium">{error.message}</div>
                  {errorHint && (
                    <p className="text-xs text-muted-foreground">{errorHint}</p>
                  )}
                </div>
              </div>
            )}

            {error &&
              error.status !== 412 &&
              error.status !== 401 &&
              error.status !== 403 && (
                <div
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                  data-testid="pr-error-generic"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span>Failed to create PR: {error.message}</span>
                </div>
              )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit} data-testid="pr-submit">
                {mutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                    Creating…
                  </>
                ) : (
                  "Create PR"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
