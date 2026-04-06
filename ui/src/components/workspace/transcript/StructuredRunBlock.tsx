// ui/src/components/workspace/transcript/StructuredRunBlock.tsx

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { heartbeatsApi } from "../../../api/heartbeats";
import { getUIAdapter } from "../../../adapters/registry";
import { buildTranscript } from "../../../adapters/transcript";
import type { DepartmentType, DisplayBlock, TranscriptBlock, AggregatedGroup } from "./types";
import { isAggregatedGroup, RICH_CARD_CATEGORIES } from "./types";
import { normalizeTranscript } from "./normalize-transcript";
import { aggregateBlocks } from "./aggregate-blocks";
import { classifyToolEntry } from "./classify-entry";
import { summarizeToolInput, displayToolName } from "./normalize-transcript";
import { TranscriptToolPill } from "./TranscriptToolPill";
import { TranscriptToolCard } from "./TranscriptToolCard";
import { TranscriptMessageBlock } from "./TranscriptMessageBlock";
import { TranscriptThinkingBlock } from "./TranscriptThinkingBlock";
import { TranscriptAggregatedGroup } from "./TranscriptAggregatedGroup";
import { TranscriptEditGroup } from "./TranscriptEditGroup";
import { TranscriptProgressBlock } from "./TranscriptProgressBlock";
import { TranscriptEventRow } from "./TranscriptEventRow";
import { TranscriptErrorBlock } from "./TranscriptErrorBlock";
import { TranscriptStdoutBlock } from "./TranscriptStdoutBlock";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseEditStats } from "./aggregate-blocks";

interface StructuredRunBlockProps {
  runId: string;
  adapterType: string;
  departmentType: DepartmentType;
  isRunning: boolean;
  isLatest?: boolean;
  compact?: boolean;
  className?: string;
}

export function StructuredRunBlock({
  runId,
  adapterType,
  departmentType,
  isRunning,
  isLatest = false,
  compact = false,
  className,
}: StructuredRunBlockProps) {
  const { data: logData, isLoading } = useQuery({
    queryKey: ["run-log", runId],
    queryFn: () => heartbeatsApi.log(runId),
    refetchInterval: isRunning ? 3000 : false,
  });

  const displayBlocks = useMemo<DisplayBlock[]>(() => {
    if (!logData?.content) return [];

    // Parse raw content into NDJSON chunks
    const chunks = parseNdjsonContent(logData.content);

    // Build transcript entries via adapter parser
    const adapter = getUIAdapter(adapterType);
    const entries = buildTranscript(chunks, adapter.parseStdoutLine);

    // Pass 1: normalize (merge messages, match tool_call/result, group commands)
    const blocks = normalizeTranscript(entries, isRunning);

    // Pass 2: aggregate consecutive same-category blocks
    return aggregateBlocks(blocks, departmentType);
  }, [logData?.content, adapterType, departmentType, isRunning]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Loading run output...</span>
      </div>
    );
  }

  if (displayBlocks.length === 0) {
    if (isRunning) {
      return (
        <div className={cn("flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground", className)}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Waiting for output...</span>
        </div>
      );
    }
    return (
      <p className={cn("px-3 py-4 text-xs text-muted-foreground", className)}>
        No output recorded.
      </p>
    );
  }

  return (
    <div className={cn("space-y-1 py-2", className)}>
      {displayBlocks.map((block, i) => (
        <div key={i}>
          {renderBlock(block, departmentType)}
        </div>
      ))}
    </div>
  );
}

function renderBlock(block: DisplayBlock, departmentType: DepartmentType) {
  // Aggregated groups
  if (isAggregatedGroup(block)) {
    return renderAggregatedGroup(block as AggregatedGroup, departmentType);
  }

  const b = block as TranscriptBlock;

  switch (b.type) {
    case "message":
      return <TranscriptMessageBlock role={b.role} text={b.text} streaming={b.streaming} ts={b.ts} />;

    case "thinking":
      return <TranscriptThinkingBlock text={b.text} streaming={b.streaming} />;

    case "tool": {
      const category = classifyToolEntry(b.name, b.input, departmentType);
      const name = displayToolName(b.name, b.input);
      const summary = summarizeToolInput(b.name, b.input);

      // Progress update (TodoWrite)
      if (category === "progress_update") {
        const todos = extractTodos(b);
        if (todos) return <TranscriptProgressBlock todos={todos} />;
      }

      // Rich card
      if (RICH_CARD_CATEGORIES.has(category)) {
        return <TranscriptToolCard name={name} summary={summary} category={category} status={b.status} result={b.result} input={b.input} />;
      }

      // Default pill
      const editStats = category === "file_edit" ? parseEditStats(b.result) : undefined;
      return <TranscriptToolPill name={name} summary={summary} category={category} status={b.status} editStats={editStats} result={b.result} input={b.input} />;
    }

    case "command_group":
      return (
        <TranscriptAggregatedGroup
          group={{ type: "command_group_agg", items: b.items.map((item) => ({ type: "tool" as const, ts: item.ts, endTs: item.endTs, name: "command", input: item.input, result: item.result, isError: item.isError, status: item.status })), count: b.items.length }}
          departmentType={departmentType}
        />
      );

    case "tool_group":
      return (
        <TranscriptAggregatedGroup
          group={{ type: "generic_group", category: "generic_tool", items: b.items.map((item) => ({ type: "tool" as const, ts: item.ts, endTs: item.endTs, name: item.name, input: item.input, result: item.result, isError: item.isError, status: item.status })), count: b.items.length }}
          departmentType={departmentType}
        />
      );

    case "event":
      return <TranscriptEventRow label={b.label} text={b.text} tone={b.tone} />;

    case "stderr_group":
      return <TranscriptErrorBlock lines={b.lines} />;

    case "stdout":
      return <TranscriptStdoutBlock text={b.text} />;

    case "activity":
      return <TranscriptEventRow label={b.name} text={b.status} tone={b.status === "completed" ? "info" : "neutral"} />;

    default:
      return null;
  }
}

function renderAggregatedGroup(group: AggregatedGroup, departmentType: DepartmentType) {
  if (group.type === "edit_group" || group.type === "multi_edit_group") {
    return <TranscriptEditGroup group={group} />;
  }
  if (group.type === "thinking_group") {
    return <TranscriptThinkingBlock text={group.items.map((i) => i.text).join("\n")} streaming={false} isPreviousTurn={group.isPreviousTurn} />;
  }
  // read_group, search_group, web_group, command_group_agg, generic_group
  return <TranscriptAggregatedGroup group={group as Extract<AggregatedGroup, { type: "read_group" | "search_group" | "web_group" | "command_group_agg" | "generic_group" }>} departmentType={departmentType} />;
}

function extractTodos(block: Extract<TranscriptBlock, { type: "tool" }>): Array<{ content: string; status: "pending" | "in_progress" | "completed" }> | null {
  const record = block.input as Record<string, unknown> | null;
  if (!record || !Array.isArray(record.todos)) return null;
  return record.todos.map((t: any) => ({
    content: t.content ?? t.text ?? String(t),
    status: t.status ?? "pending",
  }));
}

/** Parse logData.content (raw string) into NDJSON chunks */
function parseNdjsonContent(content: string): Array<{ ts: string; stream: "stdout" | "stderr" | "system"; chunk: string }> {
  const lines = content.split("\n").filter(Boolean);
  const chunks: Array<{ ts: string; stream: "stdout" | "stderr" | "system"; chunk: string }> = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.ts === "string" && typeof parsed.chunk === "string") {
        chunks.push({
          ts: parsed.ts,
          stream: parsed.stream ?? "stdout",
          chunk: parsed.chunk,
        });
      }
    } catch {
      // If not NDJSON, treat entire content as single stdout chunk
      if (chunks.length === 0) {
        return [{ ts: new Date().toISOString(), stream: "stdout", chunk: content }];
      }
    }
  }
  return chunks.length > 0 ? chunks : [{ ts: new Date().toISOString(), stream: "stdout", chunk: content }];
}
