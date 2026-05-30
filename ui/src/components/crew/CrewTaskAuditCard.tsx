import { useQuery } from "@tanstack/react-query";
import { Loader2, TerminalSquare } from "lucide-react";
import type { Issue } from "@armyofagents/shared";
import { activityApi, type RunForIssue } from "../../api/activity";
import { queryKeys } from "../../lib/queryKeys";
import { cn, formatDateTime, formatTokens, relativeTime } from "../../lib/utils";
import { StatusBadge } from "../StatusBadge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

/**
 * P3-T3.3: Per-task audit card for the crew board.
 *
 * Opens as a right-side Sheet from a crew board task card. Reads the task's
 * run history via the existing `GET /issues/:id/runs` endpoint (activityApi)
 * which returns usageJson (token counts) and resultJson (outcome summary /
 * costUsd). Each run row renders:
 *   - Prompt context: wakeReason / invocationSource from the run metadata
 *   - Reasoning/output: the resultJson summary (the agent's written outcome)
 *   - Tool calls: not persisted individually per run in this API, but the
 *     resultJson may include tool-level detail; we render what's available.
 *   - Token usage: input + output + cached tokens from usageJson
 *   - Cost: costUsd from resultJson
 *   - Outcome: status badge
 *
 * Note: The actual system prompt text assembled for the agent is NOT stored
 * in the database — it is assembled at runtime and written to a temp file
 * passed to the CLI adapter. What IS stored is the contextSnapshot (issueId,
 * wakeReason, wakeSource etc.) and the run's resultJson summary. This card
 * renders all persisted post-run audit data.
 */

/* ── Helpers ── */

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms <= 0) return null;
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return min > 0 ? `${min}m ${rem}s` : `${sec}s`;
}

function parseUsage(usageJson: Record<string, unknown> | null): {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
} {
  if (!usageJson) return { inputTokens: null, outputTokens: null, cachedInputTokens: null };
  return {
    inputTokens:
      asNumber(usageJson.rawInputTokens) ??
      asNumber(usageJson.inputTokens) ??
      null,
    outputTokens:
      asNumber(usageJson.rawOutputTokens) ??
      asNumber(usageJson.outputTokens) ??
      null,
    cachedInputTokens:
      asNumber(usageJson.rawCachedInputTokens) ??
      asNumber(usageJson.cachedInputTokens) ??
      null,
  };
}

function parseCostUsd(resultJson: Record<string, unknown> | null): number | null {
  if (!resultJson) return null;
  const raw =
    asNumber(resultJson.total_cost_usd) ??
    asNumber(resultJson.cost_usd) ??
    asNumber(resultJson.costUsd) ??
    null;
  return raw;
}

function parseOutcomeSummary(resultJson: Record<string, unknown> | null): string | null {
  if (!resultJson) return null;
  return (
    asString(resultJson.summary) ??
    asString(resultJson.result) ??
    asString(resultJson.message) ??
    null
  );
}

function parseToolCalls(resultJson: Record<string, unknown> | null): string[] {
  if (!resultJson) return [];
  const raw = resultJson.toolsCalled ?? resultJson.tools_called;
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string");
  }
  return [];
}

function outcomeFromStatus(status: string): "succeeded" | "failed" | "cancelled" | "timed_out" | "running" | string {
  return status;
}

const STATUS_DOT: Record<string, string> = {
  succeeded: "bg-green-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  timed_out: "bg-orange-500",
  cancelled: "bg-neutral-400",
  running: "bg-cyan-500 animate-pulse",
  queued: "bg-yellow-400",
  scheduled_retry: "bg-amber-400",
};

/* ── Single run row ── */

function RunRow({ run, index }: { run: RunForIssue; index: number }) {
  const usage = parseUsage(run.usageJson);
  const costUsd = parseCostUsd(run.resultJson);
  const summary = parseOutcomeSummary(run.resultJson);
  const toolCalls = parseToolCalls(run.resultJson);
  const duration = formatDuration(run.startedAt, run.finishedAt);
  const dotColor = STATUS_DOT[run.status] ?? "bg-neutral-400";

  const wakeReason = asString(run.invocationSource);

  return (
    <div
      className="border border-border rounded-md bg-card/50 overflow-hidden"
      data-testid={`crew-audit-run-${run.runId}`}
    >
      {/* Run header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/30">
        <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
        <span className="text-[11px] font-mono text-muted-foreground">
          {index === 0 ? "Latest run" : `Run ${index + 1}`}
        </span>
        <StatusBadge status={run.status} />
        <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
          {relativeTime(run.createdAt)}
        </span>
      </div>

      <div className="px-3 py-2 space-y-3">
        {/* Prompt context section */}
        <div data-testid="crew-audit-prompt">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Prompt context
          </p>
          {/* Meta sub-line: invocationSource + timing */}
          <div className="text-xs space-y-0.5 mb-2">
            {wakeReason && (
              <div>
                <span className="text-muted-foreground">Source: </span>
                <span className="font-mono">{wakeReason}</span>
              </div>
            )}
            {run.startedAt && (
              <div>
                <span className="text-muted-foreground">Started: </span>
                <span>{formatDateTime(run.startedAt)}</span>
              </div>
            )}
            {duration && (
              <div>
                <span className="text-muted-foreground">Duration: </span>
                <span>{duration}</span>
              </div>
            )}
            {!wakeReason && !run.startedAt && (
              <p className="text-muted-foreground italic">No context data.</p>
            )}
          </div>
          {/* System prompt snapshot */}
          {run.promptSnapshot ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                System prompt (redacted)
              </p>
              <pre className="text-[11px] font-mono leading-relaxed bg-muted/50 border border-border/60 rounded p-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                {run.promptSnapshot}
              </pre>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Full prompt not captured for this run.
            </p>
          )}
        </div>

        {/* Reasoning / output section */}
        {summary && (
          <div data-testid="crew-audit-reasoning">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Reasoning / outcome
            </p>
            <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
              {summary}
            </p>
          </div>
        )}

        {/* Tool calls section */}
        <div data-testid="crew-audit-tools">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Tools
          </p>
          {toolCalls.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {toolCalls.map((tool, i) => (
                <span
                  key={`${tool}-${i}`}
                  className="inline-flex items-center rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-700 dark:text-cyan-300"
                >
                  {tool}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No tool calls recorded.</p>
          )}
        </div>

        {/* Cost section */}
        <div data-testid="crew-audit-cost">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Token usage &amp; cost
          </p>
          <div className="flex items-center gap-4 text-xs flex-wrap">
            {usage.inputTokens != null && (
              <span>
                <span className="text-muted-foreground">In: </span>
                <span className="tabular-nums font-medium">{formatTokens(usage.inputTokens)}</span>
                {usage.cachedInputTokens != null && usage.cachedInputTokens > 0 && (
                  <span className="text-muted-foreground ml-1">
                    ({formatTokens(usage.cachedInputTokens)} cached)
                  </span>
                )}
              </span>
            )}
            {usage.outputTokens != null && (
              <span>
                <span className="text-muted-foreground">Out: </span>
                <span className="tabular-nums font-medium">{formatTokens(usage.outputTokens)}</span>
              </span>
            )}
            {costUsd != null && (
              <span>
                <span className="text-muted-foreground">Cost: </span>
                <span className="tabular-nums font-medium">${costUsd.toFixed(4)}</span>
              </span>
            )}
            {usage.inputTokens == null && usage.outputTokens == null && costUsd == null && (
              <span className="text-muted-foreground italic">No usage data recorded.</span>
            )}
          </div>
        </div>

        {/* Outcome section */}
        <div data-testid="crew-audit-outcome">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Outcome
          </p>
          <div className="flex items-center gap-2 text-xs">
            <StatusBadge status={outcomeFromStatus(run.status)} />
            {run.finishedAt && (
              <span className="text-muted-foreground">
                finished {relativeTime(run.finishedAt)}
              </span>
            )}
          </div>
        </div>

        {/* Detected outputs */}
        {run.detectedOutputs && run.detectedOutputs.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Detected outputs
            </p>
            <div className="space-y-0.5">
              {run.detectedOutputs.slice(0, 10).map((o, i) => (
                <div key={i} className="text-[11px] font-mono text-muted-foreground truncate">
                  {String(o.path ?? o.filename ?? "(unknown path)")}
                </div>
              ))}
              {run.detectedOutputs.length > 10 && (
                <div className="text-[11px] text-muted-foreground">
                  +{run.detectedOutputs.length - 10} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main component ── */

export interface CrewTaskAuditCardProps {
  issue: Pick<Issue, "id" | "title" | "identifier" | "status"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CrewTaskAuditCard({ issue, open, onOpenChange }: CrewTaskAuditCardProps) {
  const runsQuery = useQuery({
    queryKey: queryKeys.issues.runs(issue?.id ?? ""),
    queryFn: () => activityApi.runsForIssue(issue!.id),
    enabled: Boolean(issue?.id) && open,
    staleTime: 10_000,
  });

  const runs = runsQuery.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col overflow-hidden">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-muted-foreground shrink-0" />
            <SheetTitle className="text-sm font-semibold leading-tight">
              Run audit
            </SheetTitle>
          </div>
          {issue && (
            <SheetDescription className="text-xs leading-snug line-clamp-2 mt-0.5">
              {issue.identifier ? `${issue.identifier} · ` : ""}{issue.title}
            </SheetDescription>
          )}
        </SheetHeader>

        <div
          className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
          data-testid="crew-audit-card"
        >
          {!issue && (
            <p className="text-sm text-muted-foreground text-center py-10">
              No task selected.
            </p>
          )}

          {issue && runsQuery.isLoading && (
            <div
              className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
              data-testid="crew-audit-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading run history…
            </div>
          )}

          {issue && !runsQuery.isLoading && runs.length === 0 && (
            <p
              className="text-sm text-muted-foreground text-center py-10"
              data-testid="crew-audit-empty"
            >
              No runs recorded for this task yet.
            </p>
          )}

          {runs.map((run, i) => (
            <RunRow key={run.runId} run={run} index={i} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
