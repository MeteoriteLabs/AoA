import { FileCode, ListChecks } from "lucide-react";
import { getAdapterInfo } from "./adapter-utils";
import { formatBytes } from "./workspace-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatbarStatusRowProps {
  agentName: string;
  adapterType: string;
  /** Number of files changed in latest run */
  fileCount: number;
  /** Total bytes changed in latest run */
  totalBytes: number;
  /** Tokens used so far (input + output) — null if unavailable */
  tokensUsed: number | null;
  /** Max context window tokens — null if unknown */
  contextLimit: number | null;
  /** Todo progress — null if unavailable */
  todoProgress: { completed: number; total: number } | null;
  onTodoClick?: () => void;
}

export function ChatbarStatusRow({
  agentName,
  adapterType,
  fileCount,
  totalBytes,
  tokensUsed,
  contextLimit,
  todoProgress,
  onTodoClick,
}: ChatbarStatusRowProps) {
  const adapter = getAdapterInfo(adapterType);
  const AdapterIcon = adapter.icon;

  // Context donut calculation
  const contextRatio =
    tokensUsed != null && contextLimit != null && contextLimit > 0
      ? Math.min(tokensUsed / contextLimit, 1)
      : null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
      {/* Left: adapter icon + agent name */}
      <div className="flex items-center gap-1.5 shrink-0">
        <AdapterIcon className={`h-3.5 w-3.5 ${adapter.color}`} />
        <span className="font-medium text-foreground/80 truncate max-w-[120px]">
          {agentName}
        </span>
      </div>

      {/* Center-left: diff stats */}
      {fileCount > 0 && (
        <div className="flex items-center gap-1 text-[10px] bg-muted/50 rounded px-1.5 py-0.5 shrink-0">
          <FileCode className="h-3 w-3" />
          <span>
            {fileCount} file{fileCount !== 1 ? "s" : ""}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span>{formatBytes(totalBytes)}</span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: context donut + todo icon — always visible */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Context donut */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="p-0.5 rounded inline-flex">
                <ContextDonutIcon ratio={contextRatio ?? 0} className="h-4 w-4" empty={contextRatio == null} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {contextRatio != null
                ? `${formatTokens(tokensUsed!)} / ${formatTokens(contextLimit!)} tokens`
                : "Context usage unavailable"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Todo icon */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onTodoClick}
                aria-label="Task progress"
                className="p-0.5 hover:bg-muted/50 rounded transition-colors flex items-center gap-1"
              >
                <ListChecks className="h-3.5 w-3.5" />
                {todoProgress != null && (
                  <span className="text-[10px]">
                    {todoProgress.completed}/{todoProgress.total}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {todoProgress != null
                ? `Tasks: ${todoProgress.completed} of ${todoProgress.total} completed`
                : "Task progress unavailable"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

/* ── Context Donut SVG ──────────────────────────────────────────────────────── */

function ContextDonutIcon({
  ratio,
  className,
  empty = false,
}: {
  ratio: number;
  className?: string;
  empty?: boolean;
}) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const filled = empty ? 0 : circumference * ratio;

  // Color based on usage — muted when empty
  let strokeColor = "stroke-muted-foreground/40";
  if (!empty) {
    strokeColor = "stroke-green-500";
    if (ratio > 0.8) strokeColor = "stroke-red-500";
    else if (ratio > 0.6) strokeColor = "stroke-yellow-500";
  }

  return (
    <svg viewBox="0 0 20 20" className={className}>
      {/* Background ring */}
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        className="stroke-muted/50"
        strokeWidth="2.5"
      />
      {/* Filled arc */}
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        className={strokeColor}
        strokeWidth="2.5"
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeDashoffset={circumference * 0.25}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
