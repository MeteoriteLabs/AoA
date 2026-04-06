// ui/src/__tests__/transcript/aggregate-blocks.test.ts

import { describe, expect, it } from "vitest";
import { aggregateBlocks } from "../../components/workspace/transcript/aggregate-blocks";
import type { TranscriptBlock } from "../../components/workspace/transcript/types";

const tool = (name: string, input: unknown = {}, status: "completed" | "running" = "completed"): Extract<TranscriptBlock, { type: "tool" }> => ({
  type: "tool", ts: "2026-01-01T00:00:00Z", name, input, status,
});

describe("aggregateBlocks", () => {
  it("groups 3 consecutive file_read tools into read_group", () => {
    const blocks: TranscriptBlock[] = [
      tool("Read", { path: "a.ts" }),
      tool("Read", { path: "b.ts" }),
      tool("Read", { path: "c.ts" }),
    ];
    const result = aggregateBlocks(blocks, "general");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "read_group", count: 3 });
  });

  it("does NOT group a single file_read (minimum 2 required)", () => {
    const blocks: TranscriptBlock[] = [tool("Read", { path: "a.ts" })];
    const result = aggregateBlocks(blocks, "general");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "tool" });
  });

  it("groups consecutive file_edit on same file into edit_group", () => {
    const blocks: TranscriptBlock[] = [
      tool("Edit", { file_path: "auth.ts" }),
      tool("Edit", { file_path: "auth.ts" }),
    ];
    const result = aggregateBlocks(blocks, "general");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "edit_group", filePath: "auth.ts" });
  });

  it("groups consecutive file_edit on different files into multi_edit_group", () => {
    const blocks: TranscriptBlock[] = [
      tool("Edit", { file_path: "auth.ts" }),
      tool("Edit", { file_path: "routes.ts" }),
      tool("Edit", { file_path: "config.ts" }),
    ];
    const result = aggregateBlocks(blocks, "general");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "multi_edit_group", fileCount: 3 });
  });

  it("does not group non-consecutive same-type tools", () => {
    const blocks: TranscriptBlock[] = [
      tool("Read", { path: "a.ts" }),
      { type: "message", role: "assistant", ts: "2026-01-01T00:00:00Z", text: "hello", streaming: false } as TranscriptBlock,
      tool("Read", { path: "b.ts" }),
    ];
    const result = aggregateBlocks(blocks, "general");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: "tool" });
    expect(result[2]).toMatchObject({ type: "tool" });
  });

  it("passes through messages and events unchanged", () => {
    const msg: TranscriptBlock = { type: "message", role: "assistant", ts: "2026-01-01T00:00:00Z", text: "hi", streaming: false };
    const evt: TranscriptBlock = { type: "event", ts: "2026-01-01T00:00:00Z", label: "init", tone: "info", text: "ready" };
    const result = aggregateBlocks([msg, evt], "general");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "message" });
    expect(result[1]).toMatchObject({ type: "event" });
  });

  it("groups 2 consecutive search tools into search_group", () => {
    const blocks: TranscriptBlock[] = [
      tool("Grep", { pattern: "foo" }),
      tool("Glob", { pattern: "*.ts" }),
    ];
    const result = aggregateBlocks(blocks, "general");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "search_group", count: 2 });
  });
});
