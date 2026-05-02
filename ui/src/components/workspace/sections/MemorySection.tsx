import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, Search, MousePointerClick, FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { memoryRetrievalsApi, type MemoryRetrievalRowApi } from "../../../api/memoryRetrievals";
import { queryKeys } from "../../../lib/queryKeys";

/**
 * V2.6 Phase 3 — workspace right-panel Memory section.
 *
 * Reads memory_retrievals (audit log written by Phase 1's
 * recordMemoryRetrievals) and shows the founder what memory each
 * agent run actually saw. Replaces the previous "coming soon"
 * placeholder.
 *
 * Groups retrievals by triggeredBy:
 *   - AUTO: pre-run injection (memorySvc.searchMultiPath called from
 *     fetchMemoryContext — wired in a later phase)
 *   - AGENT-PULLED: agent.search + agent.get MCP calls during the run
 *   - SKILL-MATERIALIZED: pinned-memory skill synthesis (Phase 2).
 *     Collapsed by default to keep the section compact.
 *
 * Click any item → navigate to /<companyPrefix>/memory/explore?item=<id> (the
 * Memory page reads ?item to select-and-open the detail view).
 */

type RetrievalGroup = "auto" | "agent-pulled" | "skill" | "other";

function classifyGroup(trigger: MemoryRetrievalRowApi["triggeredBy"]): RetrievalGroup {
  switch (trigger) {
    case "auto":
      return "auto";
    case "agent_search":
    case "agent_get":
      return "agent-pulled";
    case "skill_materialize":
      return "skill";
    case "commander_query":
      return "other";
    default:
      return "other";
  }
}

interface MemorySectionProps {
  issueId: string;
  companyId: string;
  companyPrefix: string;
}

export function MemorySection({ issueId, companyId, companyPrefix }: MemorySectionProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.memory.retrievalsForIssue(companyId, issueId),
    queryFn: () => memoryRetrievalsApi.listForIssue(companyId, issueId, { limit: 100 }),
    enabled: Boolean(companyId && issueId),
  });

  const groups = useMemo(() => {
    const auto: MemoryRetrievalRowApi[] = [];
    const agentPulled: MemoryRetrievalRowApi[] = [];
    const skill: MemoryRetrievalRowApi[] = [];
    const other: MemoryRetrievalRowApi[] = [];
    for (const row of data ?? []) {
      const g = classifyGroup(row.triggeredBy);
      if (g === "auto") auto.push(row);
      else if (g === "agent-pulled") agentPulled.push(row);
      else if (g === "skill") skill.push(row);
      else other.push(row);
    }
    return { auto, agentPulled, skill, other };
  }, [data]);

  if (isLoading) {
    return (
      <div className="px-3 space-y-2" data-testid="memory-section-skeleton">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="mx-3 p-3 rounded-md border border-dashed border-destructive/30 text-xs text-muted-foreground"
        data-testid="memory-section-error"
      >
        Couldn't load memory retrievals for this task.
      </div>
    );
  }

  const total = (data ?? []).length;
  if (total === 0) {
    return (
      <div
        className="mx-3 p-3 rounded-md border border-dashed border-muted-foreground/30 flex items-start gap-2"
        data-testid="memory-section-empty"
      >
        <Brain className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          No memory retrievals recorded for this task yet. Memory the
          agent uses during runs (auto-retrieved or pulled via
          memory.search) will show up here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3" data-testid="memory-section">
      <div className="text-xs text-muted-foreground">
        {total} memory {total === 1 ? "retrieval" : "retrievals"} on this task
      </div>

      {groups.auto.length > 0 && (
        <RetrievalGroupView
          label="Auto-retrieved"
          icon={Brain}
          rows={groups.auto}
          companyPrefix={companyPrefix}
          testid="memory-group-auto"
        />
      )}

      {groups.agentPulled.length > 0 && (
        <RetrievalGroupView
          label="Agent-pulled"
          icon={Search}
          rows={groups.agentPulled}
          companyPrefix={companyPrefix}
          testid="memory-group-agent-pulled"
        />
      )}

      {groups.other.length > 0 && (
        <RetrievalGroupView
          label="Commander queries"
          icon={MousePointerClick}
          rows={groups.other}
          companyPrefix={companyPrefix}
          testid="memory-group-other"
        />
      )}

      {groups.skill.length > 0 && (
        // Collapsed by default via <details> — pinned-skill deliveries
        // tend to be high-volume (one row per pinned item per run) and
        // less interesting per-item than auto/agent-pulled.
        <details className="space-y-1" data-testid="memory-group-skill">
          <summary className="text-xs uppercase tracking-wide text-muted-foreground cursor-pointer flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            <span>Skill-materialized · {groups.skill.length}</span>
          </summary>
          <div className="space-y-1 mt-1">
            {groups.skill.map((row) => (
              <RetrievalRow key={row.id} row={row} companyPrefix={companyPrefix} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

interface RetrievalGroupViewProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: MemoryRetrievalRowApi[];
  companyPrefix: string;
  testid: string;
}

function RetrievalGroupView({ label, icon: Icon, rows, companyPrefix, testid }: RetrievalGroupViewProps) {
  return (
    <div className="space-y-1" data-testid={testid}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        <span>
          {label} · {rows.length}
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <RetrievalRow key={row.id} row={row} companyPrefix={companyPrefix} />
        ))}
      </div>
    </div>
  );
}

function RetrievalRow({ row, companyPrefix }: { row: MemoryRetrievalRowApi; companyPrefix: string }) {
  const title = row.itemTitle ?? "(item deleted)";
  const isDeleted = !row.itemTitle;
  const sim = row.similarityScore ? Math.round(parseFloat(row.similarityScore) * 100) : null;
  const href = row.itemId ? `/${companyPrefix}/memory/explore?item=${row.itemId}` : null;

  const content = (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm truncate", isDeleted && "italic text-muted-foreground")}>
          {title}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {row.itemLayer && (
            <Badge variant="outline" className="text-[10px] h-4 px-1">
              {row.itemLayer}
            </Badge>
          )}
          {row.itemCategory && (
            <Badge variant="outline" className="text-[10px] h-4 px-1">
              {row.itemCategory}
            </Badge>
          )}
          {!row.shownToAgent && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">
              filtered
            </Badge>
          )}
          {sim !== null && (
            <span className="text-[10px] text-muted-foreground tabular-nums">{sim}%</span>
          )}
          {row.rank !== null && (
            <span className="text-[10px] text-muted-foreground tabular-nums">#{row.rank}</span>
          )}
        </div>
      </div>
      {href && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />}
    </div>
  );

  if (href) {
    return (
      <a href={href} data-testid="memory-retrieval-row" className="block">
        {content}
      </a>
    );
  }
  return (
    <div data-testid="memory-retrieval-row" className="cursor-default">
      {content}
    </div>
  );
}
