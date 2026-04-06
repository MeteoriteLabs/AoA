// ui/src/components/workspace/transcript/aggregate-blocks.ts

import type {
  TranscriptBlock,
  AggregatedGroup,
  DisplayBlock,
  DepartmentType,
  EntryCategory,
} from "./types";
import { AGGREGATABLE_CATEGORIES } from "./types";
import { classifyToolEntry } from "./classify-entry";

/** Extract file path from tool input for edit grouping */
function extractFilePath(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "filePath", "path", "filename"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return null;
}

/** Parse +/- stats from tool result text */
export function parseEditStats(result: string | undefined): { additions: number; deletions: number } {
  if (!result) return { additions: 0, deletions: 0 };
  const addMatch = result.match(/\+(\d+)/);
  const delMatch = result.match(/-(\d+)/);
  return {
    additions: addMatch ? parseInt(addMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
  };
}

type ToolBlock = Extract<TranscriptBlock, { type: "tool" }>;

interface PendingGroup {
  category: EntryCategory;
  items: ToolBlock[];
  /** For file_edit: tracks all distinct file paths */
  filePaths: Set<string>;
}

function flushGroup(pending: PendingGroup): DisplayBlock[] {
  const { category, items, filePaths } = pending;
  if (items.length < 2) return items;

  switch (category) {
    case "file_read":
      return [{ type: "read_group", items, count: items.length }];

    case "file_edit": {
      if (filePaths.size === 1) {
        const filePath = [...filePaths][0]!;
        let totalAdditions = 0;
        let totalDeletions = 0;
        for (const item of items) {
          const stats = parseEditStats(item.result);
          totalAdditions += stats.additions;
          totalDeletions += stats.deletions;
        }
        return [{ type: "edit_group", filePath, items, totalAdditions, totalDeletions }];
      }
      return [{ type: "multi_edit_group", items, fileCount: filePaths.size }];
    }

    case "search":
      return [{ type: "search_group", items, count: items.length }];

    case "web":
      return [{ type: "web_group", items, count: items.length }];

    case "command":
      return [{ type: "command_group_agg", items, count: items.length }];

    default:
      return [{ type: "generic_group", category, items, count: items.length }];
  }
}

export function aggregateBlocks(
  blocks: TranscriptBlock[],
  departmentType: DepartmentType,
): DisplayBlock[] {
  const result: DisplayBlock[] = [];
  let pending: PendingGroup | null = null;

  for (const block of blocks) {
    // Only aggregate tool blocks
    if (block.type !== "tool") {
      if (pending) {
        result.push(...flushGroup(pending));
        pending = null;
      }
      result.push(block);
      continue;
    }

    const category = classifyToolEntry(block.name, block.input, departmentType);

    // Only aggregate categories in the AGGREGATABLE set
    if (!AGGREGATABLE_CATEGORIES.has(category)) {
      if (pending) {
        result.push(...flushGroup(pending));
        pending = null;
      }
      result.push(block);
      continue;
    }

    // Start or continue a group
    if (pending && pending.category === category) {
      pending.items.push(block);
      if (category === "file_edit") {
        const fp = extractFilePath(block.input);
        if (fp) pending.filePaths.add(fp);
      }
    } else {
      if (pending) {
        result.push(...flushGroup(pending));
      }
      const filePaths = new Set<string>();
      if (category === "file_edit") {
        const fp = extractFilePath(block.input);
        if (fp) filePaths.add(fp);
      }
      pending = { category, items: [block], filePaths };
    }
  }

  if (pending) {
    result.push(...flushGroup(pending));
  }

  return result;
}
