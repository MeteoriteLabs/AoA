// ui/src/components/workspace/transcript/TranscriptAggregatedGroup.tsx

import { useState } from "react";
import { cn } from "@/lib/utils";
import { FileText, Search, Globe, Terminal, Wrench, ChevronRight, ChevronDown, type LucideIcon } from "lucide-react";
import type { AggregatedGroup, DepartmentType } from "./types";
import { TranscriptToolPill } from "./TranscriptToolPill";
import { classifyToolEntry } from "./classify-entry";
import { summarizeToolInput, displayToolName } from "./normalize-transcript";

const GROUP_CONFIG: Record<string, { icon: LucideIcon; label: (n: number) => string }> = {
  read_group: { icon: FileText, label: (n) => `Read · ${n} files` },
  search_group: { icon: Search, label: (n) => `Search · ${n} queries` },
  web_group: { icon: Globe, label: (n) => `Web · ${n} requests` },
  command_group_agg: { icon: Terminal, label: (n) => `Ran · ${n} commands` },
  generic_group: { icon: Wrench, label: (n) => `Tool · ${n} calls` },
};

interface TranscriptAggregatedGroupProps {
  group: Extract<AggregatedGroup, { type: "read_group" | "search_group" | "web_group" | "command_group_agg" | "generic_group" }>;
  departmentType: DepartmentType;
  className?: string;
}

export function TranscriptAggregatedGroup({ group, departmentType, className }: TranscriptAggregatedGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const config = GROUP_CONFIG[group.type] ?? GROUP_CONFIG.generic_group!;
  const Icon = config.icon;

  return (
    <div className={cn("", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 h-10 rounded-lg bg-muted/40 hover:bg-muted/60 text-left transition-colors"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-[13px] text-foreground/80 flex-1">{config.label(group.count)}</span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="ml-4 mt-1 space-y-1">
          {group.items.map((item, i) => {
            const category = classifyToolEntry(item.name, item.input, departmentType);
            const summary = summarizeToolInput(item.name, item.input);
            return (
              <TranscriptToolPill
                key={i}
                name={displayToolName(item.name, item.input)}
                summary={summary}
                category={category}
                status={item.status}
                result={item.result}
                input={item.input}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
