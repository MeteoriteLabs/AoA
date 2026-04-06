// ui/src/components/workspace/transcript/TranscriptEditGroup.tsx

import { useState } from "react";
import { cn } from "@/lib/utils";
import { FileEdit, ChevronRight, ChevronDown } from "lucide-react";
import type { AggregatedGroup } from "./types";
import { parseEditStats, extractFilePath } from "./aggregate-blocks";

interface TranscriptEditGroupProps {
  group: Extract<AggregatedGroup, { type: "edit_group" | "multi_edit_group" }>;
  className?: string;
}

export function TranscriptEditGroup({ group, className }: TranscriptEditGroupProps) {
  const [expanded, setExpanded] = useState(false);

  const label = group.type === "edit_group"
    ? group.filePath.split("/").pop() ?? group.filePath
    : `Edited · ${group.fileCount} files`;

  const totalStats = group.type === "edit_group"
    ? { additions: group.totalAdditions, deletions: group.totalDeletions }
    : group.items.reduce(
        (acc, item) => {
          const s = parseEditStats(item.result);
          return { additions: acc.additions + s.additions, deletions: acc.deletions + s.deletions };
        },
        { additions: 0, deletions: 0 },
      );

  return (
    <div className={cn("", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 h-10 rounded-lg bg-muted/40 hover:bg-muted/60 text-left transition-colors"
      >
        <FileEdit className="h-4 w-4 text-muted-foreground" />
        <span className="text-[13px] text-foreground/80 font-mono flex-1">
          {label} · {group.items.length} edit{group.items.length !== 1 ? "s" : ""}
        </span>
        {(totalStats.additions > 0 || totalStats.deletions > 0) && (
          <span className="text-xs shrink-0">
            {totalStats.additions > 0 && <span className="text-emerald-500">+{totalStats.additions}</span>}
            {totalStats.additions > 0 && totalStats.deletions > 0 && " "}
            {totalStats.deletions > 0 && <span className="text-red-400">-{totalStats.deletions}</span>}
          </span>
        )}
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="ml-4 mt-1 space-y-1">
          {group.items.map((item, i) => {
            const stats = parseEditStats(item.result);
            const filePath = extractFilePath(item.input);
            return (
              <div key={i} className="flex items-center gap-2 px-3 h-8 text-xs text-muted-foreground">
                <span className="font-mono truncate flex-1">{filePath ?? `Edit ${i + 1}`}</span>
                {(stats.additions > 0 || stats.deletions > 0) && (
                  <span>
                    {stats.additions > 0 && <span className="text-emerald-500">+{stats.additions}</span>}
                    {stats.additions > 0 && stats.deletions > 0 && " "}
                    {stats.deletions > 0 && <span className="text-red-400">-{stats.deletions}</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
