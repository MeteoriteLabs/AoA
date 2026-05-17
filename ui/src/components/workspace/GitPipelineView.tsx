/**
 * GitPipelineView — tabular "pipeline" view for the Git Command Centre.
 *
 * One row per branch. Linked-task branches show full detail.
 * Unlinked git-only branches collapse to a secondary strip.
 * Done rows are dimmed and hidden behind a toggle.
 */

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { issueStatusText, issueStatusTextDefault } from "@/lib/status-colors";
import type { GitBranchInfo, GitPrReviewState, GitCIStatus } from "@armyofagents/shared";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = ["Changes", "Committed", "Pushed", "PR", "Merged"] as const;

function PipelineDots({ branch }: { branch: GitBranchInfo }) {
  const activeIdx = (() => {
    if (branch.pr?.reviewState === "merged") return 4;
    if (branch.pr) return 3;
    if (branch.isRemote && branch.aheadCount === 0) return 2;
    if (branch.aheadCount > 0) return 1;
    return 0;
  })();

  return (
    <div className="flex items-center gap-1" title={PIPELINE_STAGES[activeIdx]}>
      {PIPELINE_STAGES.map((stage, idx) => (
        <div
          key={stage}
          className={cn(
            "w-2 h-2 rounded-full",
            idx < activeIdx
              ? "bg-[#4FB67E]"
              : idx === activeIdx
                ? "bg-[#6470DC]"
                : "bg-[#7E8AA8]/30",
          )}
          title={stage}
        />
      ))}
    </div>
  );
}

function PrBadge({ reviewState }: { reviewState: GitPrReviewState }) {
  const cls: Record<GitPrReviewState, string> = {
    draft: "bg-muted text-muted-foreground",
    open: "bg-blue-500/20 text-blue-400",
    changes_requested: "bg-amber-500/20 text-amber-400",
    approved: "bg-green-500/20 text-green-400",
    merged: "bg-indigo-500/20 text-indigo-400",
    closed: "bg-muted text-muted-foreground",
  };
  const labels: Record<GitPrReviewState, string> = {
    draft: "Draft",
    open: "Open",
    changes_requested: "Changes",
    approved: "Approved",
    merged: "Merged",
    closed: "Closed",
  };
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", cls[reviewState])}>
      {labels[reviewState]}
    </span>
  );
}

function CIBadge({ status, ciUrl }: { status: GitCIStatus; ciUrl: string | null }) {
  if (!status) return null;
  const cls: Record<Exclude<GitCIStatus, null>, string> = {
    pending: "text-amber-400",
    passing: "text-green-400",
    failing: "text-red-400",
  };
  const dots: Record<Exclude<GitCIStatus, null>, string> = {
    pending: "●",
    passing: "✓",
    failing: "✗",
  };
  const inner = (
    <span className={cn("text-[11px] font-mono", cls[status])}>
      {dots[status]}
    </span>
  );
  if (ciUrl && status === "failing") {
    return (
      <a href={ciUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
        {inner}
      </a>
    );
  }
  return inner;
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function BranchRow({
  branch,
  dimmed,
  onOpenIssue,
}: {
  branch: GitBranchInfo;
  dimmed: boolean;
  onOpenIssue?: (id: string) => void;
}) {
  const statusClass = issueStatusText[branch.linkedIssueStatus ?? ""] ?? issueStatusTextDefault;

  return (
    <tr
      className={cn(
        "border-b border-white/5 hover:bg-white/5 transition-colors text-sm",
        dimmed && "opacity-40",
      )}
    >
      {/* Color bar */}
      <td className="w-1 p-0">
        <div
          className="w-1 h-8 rounded-r"
          style={{
            backgroundColor:
              branch.pr?.reviewState === "merged"
                ? "#4FB67E"
                : branch.linkedIssueStatus === "blocked"
                  ? "#ef4444"
                  : "#6470DC",
          }}
        />
      </td>

      {/* Task ID */}
      <td className="px-3 py-2 whitespace-nowrap">
        {branch.linkedIssueIdentifier ? (
          <span className="text-[11px] font-mono text-muted-foreground">
            {branch.linkedIssueIdentifier}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">—</span>
        )}
      </td>

      {/* Title */}
      <td className="px-3 py-2 max-w-[220px]">
        <div className="truncate">
          {branch.linkedIssueTitle ?? (
            <span className="text-muted-foreground italic text-xs">No linked task</span>
          )}
        </div>
      </td>

      {/* Branch name */}
      <td className="px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[120px] block">
          {branch.name}
        </span>
      </td>

      {/* Status */}
      <td className="px-3 py-2 whitespace-nowrap">
        {branch.linkedIssueStatus ? (
          <span className={cn("text-xs capitalize", statusClass)}>
            {branch.linkedIssueStatus.replace(/_/g, " ")}
          </span>
        ) : null}
      </td>

      {/* Pipeline dots */}
      <td className="px-3 py-2">
        <PipelineDots branch={branch} />
      </td>

      {/* Ahead/behind */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex gap-1 text-[11px]">
          {branch.aheadCount > 0 && (
            <span className="text-green-400">↑{branch.aheadCount}</span>
          )}
          {branch.behindCount > 0 && (
            <span className="text-amber-400">↓{branch.behindCount}</span>
          )}
        </div>
      </td>

      {/* PR badge */}
      <td className="px-3 py-2">
        {branch.pr && <PrBadge reviewState={branch.pr.reviewState} />}
      </td>

      {/* CI badge */}
      <td className="px-3 py-2 text-center">
        {branch.pr && (
          <CIBadge status={branch.pr.ciStatus} ciUrl={branch.pr.ciUrl} />
        )}
      </td>

      {/* Open button */}
      <td className="px-3 py-2">
        {branch.linkedIssueId && onOpenIssue && (
          <button
            className="text-[11px] text-[#6470DC] hover:text-[#8490e8] whitespace-nowrap"
            onClick={() => onOpenIssue(branch.linkedIssueId!)}
          >
            Open →
          </button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GitPipelineView({
  branches,
  onOpenIssue,
}: {
  branches: GitBranchInfo[];
  onOpenIssue?: (issueId: string) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const [showUnlinked, setShowUnlinked] = useState(false);

  const linked = branches.filter((b) => b.linkedIssueId);
  const unlinked = branches.filter((b) => !b.linkedIssueId);

  const active = linked.filter(
    (b) => b.linkedIssueStatus !== "done" && b.linkedIssueStatus !== "cancelled",
  );
  const done = linked.filter(
    (b) => b.linkedIssueStatus === "done" || b.linkedIssueStatus === "cancelled",
  );

  return (
    <div className="overflow-auto h-full">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-white/10 text-[11px] text-muted-foreground uppercase tracking-wider">
            <th className="w-1" />
            <th className="px-3 py-2 text-left font-normal">ID</th>
            <th className="px-3 py-2 text-left font-normal">Task</th>
            <th className="px-3 py-2 text-left font-normal">Branch</th>
            <th className="px-3 py-2 text-left font-normal">Status</th>
            <th className="px-3 py-2 text-left font-normal">Pipeline</th>
            <th className="px-3 py-2 text-left font-normal">±</th>
            <th className="px-3 py-2 text-left font-normal">PR</th>
            <th className="px-3 py-2 text-center font-normal">CI</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {active.map((b) => (
            <BranchRow key={b.name} branch={b} dimmed={false} onOpenIssue={onOpenIssue} />
          ))}

          {/* Done rows toggle */}
          {done.length > 0 && (
            <>
              <tr>
                <td colSpan={10} className="px-3 py-1.5">
                  <button
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowDone((v) => !v)}
                  >
                    {showDone ? "▾" : "▸"} Show done ({done.length})
                  </button>
                </td>
              </tr>
              {showDone &&
                done.map((b) => (
                  <BranchRow key={b.name} branch={b} dimmed onOpenIssue={onOpenIssue} />
                ))}
            </>
          )}

          {/* Unlinked git-only branches */}
          {unlinked.length > 0 && (
            <>
              <tr>
                <td colSpan={10} className="px-3 py-1.5 border-t border-white/10">
                  <button
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowUnlinked((v) => !v)}
                  >
                    {showUnlinked ? "▾" : "▸"} Git-only branches ({unlinked.length})
                  </button>
                </td>
              </tr>
              {showUnlinked &&
                unlinked.map((b) => (
                  <BranchRow key={b.name} branch={b} dimmed />
                ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
