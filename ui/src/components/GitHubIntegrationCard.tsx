import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Github,
  Loader2,
} from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { githubIntegrationApi } from "../api/github-integration";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";

const PAT_DOCS_URL = "https://github.com/settings/tokens?type=beta";

/**
 * Settings → Integrations → GitHub card.
 * Stores a per-company GitHub PAT (verified via Octokit on the server).
 * The PAT itself is never returned to the UI — the status endpoint only
 * echoes `{configured, githubUser, createdAt}`.
 */
export function GitHubIntegrationCard() {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [patInput, setPatInput] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.github.patStatus(selectedCompanyId!),
    queryFn: () => githubIntegrationApi.status(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const invalidateStatus = () => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.github.patStatus(selectedCompanyId),
    });
  };

  const setPatMutation = useMutation({
    mutationFn: (pat: string) =>
      githubIntegrationApi.setPat(selectedCompanyId!, pat),
    onSuccess: (data) => {
      setPatInput("");
      setInlineError(null);
      invalidateStatus();
      pushToast({
        title: `Connected to GitHub as @${data.githubUser}`,
        tone: "success",
      });
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Failed to save GitHub PAT";
      setInlineError(message);
    },
  });

  const removePatMutation = useMutation({
    mutationFn: () => githubIntegrationApi.removePat(selectedCompanyId!),
    onSuccess: () => {
      setInlineError(null);
      invalidateStatus();
      pushToast({ title: "Disconnected from GitHub", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: err instanceof Error ? err.message : "Failed to disconnect",
        tone: "warn",
      });
    },
  });

  if (!selectedCompanyId) {
    return null;
  }

  const status = statusQuery.data;
  const isLoading = statusQuery.isLoading;
  const isConnected = status?.configured === true;

  function handleConnect() {
    const trimmed = patInput.trim();
    if (!trimmed) return;
    setInlineError(null);
    setPatMutation.mutate(trimmed);
  }

  return (
    <div className="rounded-md border border-border px-4 py-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <Github className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">GitHub</div>
          <div className="text-xs text-muted-foreground">
            Store a Personal Access Token to enable Create PR from workspaces.
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading status…
        </div>
      ) : isConnected ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
            <CheckCircle2
              className="mt-0.5 h-4 w-4 text-emerald-500"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                Connected as{" "}
                <span className="font-mono">@{status?.githubUser ?? "unknown"}</span>
              </div>
              {status?.createdAt && (
                <div className="text-xs text-muted-foreground">
                  Saved {new Date(status.createdAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => removePatMutation.mutate()}
              disabled={removePatMutation.isPending}
            >
              {removePatMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Create a fine-grained PAT with{" "}
            <span className="font-mono">repo</span> and{" "}
            <span className="font-mono">pull request</span> permissions, then
            paste it below.
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={patInput}
              onChange={(e) => {
                setPatInput(e.target.value);
                if (inlineError) setInlineError(null);
              }}
              placeholder="github_pat_…"
              aria-label="GitHub Personal Access Token"
              disabled={setPatMutation.isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && patInput.trim()) {
                  e.preventDefault();
                  handleConnect();
                }
              }}
            />
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!patInput.trim() || setPatMutation.isPending}
            >
              {setPatMutation.isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
          {inlineError && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle
                className="mt-0.5 h-4 w-4"
                aria-hidden="true"
              />
              <span>{inlineError}</span>
            </div>
          )}
          <a
            href={PAT_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Create a GitHub PAT
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}
