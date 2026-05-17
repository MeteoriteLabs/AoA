/**
 * GitCommandCentre — root component for the project-level git visualization.
 *
 * Data fetching:
 *   /git/graph  — fast (~50ms), git-only, 30s polling via React Query
 *   /git/enrich — slow (~1–2s), GitHub PR+CI badges, separate query
 *
 * Live refresh:
 *   WebSocket heartbeat.run.status events trigger a refetch.
 *   Payload has NO issueId — we do a blanket refetch on any terminal event
 *   for this company. The 25s server cache absorbs burst events.
 *
 * Visibility gate:
 *   Both queries are gated on isWorkspacesTabActive to prevent polling
 *   when the tab is CSS-hidden (which this component is when switching tabs).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { GitBranchInfo, LiveEvent } from "@armyofagents/shared";
import { projectGitApi } from "@/api/project-git";
import { cn } from "@/lib/utils";
import { GitGraphCanvas } from "./GitGraphCanvas";
import { GitHoverCard, type HoveredNode } from "./GitHoverCard";
import { GitPipelineView } from "./GitPipelineView";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "map" | "pipeline";
type FilterMode = "all" | "running" | "blocked" | "prs";

interface GitCommandCentreProps {
  projectId: string;
  companyId: string;
  /** Gate queries when the Workspaces tab is CSS-hidden (not unmounted). */
  isWorkspacesTabActive: boolean;
  onSelectIssue: (issueId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeEnrichments(
  branches: GitBranchInfo[] | undefined,
  enrichments: Array<{ branchName: string; pr: GitBranchInfo["pr"] }> | undefined,
): GitBranchInfo[] {
  if (!branches) return [];
  if (!enrichments?.length) return branches;

  const enrichMap = new Map(enrichments.map((e) => [e.branchName, e.pr]));
  return branches.map((b) => {
    const enrichedPr = enrichMap.get(b.name);
    if (enrichedPr === undefined) return b;
    return { ...b, pr: enrichedPr };
  });
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function NoWorkspaceState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
      <div className="w-12 h-12 rounded-full bg-[#6470DC]/10 flex items-center justify-center">
        <svg
          className="w-6 h-6 text-[#6470DC]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 7c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM12 3c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 8c0 1.1-.9 2-2 2m4 0c0 1.1.9 2 2 2M7 11v2m10-2v2M12 7v2"
          />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium">No git workspaces yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Create a task and assign it to this project to see the git graph.
        </p>
      </div>
    </div>
  );
}

function NoBranchesState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
      <p className="text-sm text-muted-foreground">No branches found in the repository.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GitCommandCentre({
  projectId,
  companyId,
  isWorkspacesTabActive,
  onSelectIssue,
}: GitCommandCentreProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

  // ── Data fetching ────────────────────────────────────────────────────────

  const { data: graphData, refetch: refetchGraph } = useQuery({
    queryKey: ["git-graph", companyId, projectId],
    queryFn: () => projectGitApi.getGraph(companyId, projectId),
    refetchInterval: 30_000,
    staleTime: 25_000,
    enabled: isWorkspacesTabActive,
  });

  const { data: enrichData, refetch: refetchEnrich } = useQuery({
    queryKey: ["git-enrich", companyId, projectId],
    queryFn: () => projectGitApi.getEnrich(companyId, projectId),
    refetchInterval: 30_000,
    staleTime: 25_000,
    enabled: isWorkspacesTabActive && !graphData?.noWorkspaceYet && graphData?.hasGitHubPat,
  });

  // Merge enrichment patches onto graph branches
  const branches = useMemo(
    () => mergeEnrichments(graphData?.branches, enrichData?.enrichments),
    [graphData?.branches, enrichData?.enrichments],
  );

  // ── SSE smart refresh (Issue A + Issue 3 fixes) ─────────────────────────
  // heartbeat.run.status payload has NO issueId — blanket refetch on terminal.
  // Use ref to avoid stale closure over refetch functions.

  const refetchRef = useRef({ refetchGraph, refetchEnrich });
  useEffect(() => {
    refetchRef.current = { refetchGraph, refetchEnrich };
  }, [refetchGraph, refetchEnrich]);

  useEffect(() => {
    if (!isWorkspacesTabActive) return;

    let socket: WebSocket | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/api/companies/${encodeURIComponent(companyId)}/events/ws`;
      socket = new WebSocket(url);

      socket.onmessage = (message) => {
        const raw = typeof message.data === "string" ? message.data : "";
        if (!raw) return;
        let event: LiveEvent;
        try {
          event = JSON.parse(raw) as LiveEvent;
        } catch {
          return;
        }
        if (event.companyId !== companyId) return;
        if (event.type !== "heartbeat.run.status") return;

        const status = (event.payload as Record<string, unknown>)?.["status"] as string | undefined;
        const TERMINAL = new Set(["completed", "failed", "error", "timed_out", "cancelled"]);
        if (!status || !TERMINAL.has(status)) return;

        // Blanket refetch — 25s server cache absorbs burst events
        refetchRef.current.refetchGraph();
        refetchRef.current.refetchEnrich();
      };

      socket.onclose = () => {
        if (!closed) setTimeout(connect, 3_000);
      };
    };

    connect();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [companyId, isWorkspacesTabActive]);

  // ── Hover ────────────────────────────────────────────────────────────────

  const handleHover = useCallback(
    (node: HoveredNode | null, position: { x: number; y: number }) => {
      setHoveredNode(node);
      setHoverPosition(position);
    },
    [],
  );

  const handleClick = useCallback(
    (node: HoveredNode) => {
      if (node.type === "task" && node.branch.linkedIssueId) {
        onSelectIssue(node.branch.linkedIssueId);
      }
    },
    [onSelectIssue],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (!graphData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-muted-foreground animate-pulse">Loading git graph…</div>
      </div>
    );
  }

  if (graphData.noWorkspaceYet) {
    return <NoWorkspaceState />;
  }

  if (branches.length === 0) {
    return <NoBranchesState />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 shrink-0">
        {/* View toggle */}
        <div className="flex items-center gap-1 bg-white/5 rounded p-0.5">
          {(["map", "pipeline"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              className={cn(
                "px-3 py-1 rounded text-xs transition-colors capitalize",
                viewMode === mode
                  ? "bg-[#6470DC] text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setViewMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1">
          {(
            [
              { key: "all", label: "All" },
              { key: "running", label: "Running" },
              { key: "blocked", label: "Blocked" },
              { key: "prs", label: "PRs" },
            ] as Array<{ key: FilterMode; label: string }>
          ).map(({ key, label }) => (
            <button
              key={key}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] transition-colors",
                filter === key
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* PAT notice */}
        {!graphData.hasGitHubPat && (
          <span className="text-[11px] text-amber-400">
            Connect GitHub in Settings → Integrations to see PR & CI status
          </span>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 relative overflow-hidden">
        {viewMode === "map" ? (
          <>
            <GitGraphCanvas
              branches={branches}
              graph={graphData.graph}
              filter={filter}
              onHover={handleHover}
              onClick={handleClick}
            />
            <GitHoverCard
              node={hoveredNode}
              position={hoverPosition}
              onOpenTask={onSelectIssue}
            />
          </>
        ) : (
          <GitPipelineView branches={branches} onOpenIssue={onSelectIssue} />
        )}
      </div>
    </div>
  );
}
