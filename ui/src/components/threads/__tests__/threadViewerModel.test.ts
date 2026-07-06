import { describe, expect, it } from "vitest";
import type { DiscussionDetail, DiscussionEntryAttachment, ExtractedItem } from "../../../api/discussions";
import {
  OPEN_TAB_KEY,
  browserTab,
  closeTab,
  createGlobalMapTab,
  createOpenTab,
  createThreadMapTab,
  ensureTab,
  extractThreadUrls,
  extractUrlsFromThread,
  scopeItemToTab,
  threadAttachmentToTab,
} from "../threadViewerModel";

function item(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    id: "item-1",
    type: "task",
    title: "Approve launch scope",
    description: "Confirm the proposed scope.",
    suggestedPriority: null,
    suggestedAssigneeId: null,
    suggestedDepartmentId: null,
    suggestedLayer: null,
    layer: null,
    priority: null,
    dedupAction: null,
    status: "pending",
    resultTaskId: null,
    resultMemoryId: null,
    conflictsWith: null,
    createdAt: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("threadViewerModel", () => {
  it("creates a closeable Open tab", () => {
    expect(createOpenTab()).toEqual({
      key: OPEN_TAB_KEY,
      label: "Open",
      kind: "open",
      closeable: true,
    });
  });

  it("maps scope items to closeable tabs", () => {
    expect(scopeItemToTab(item())).toMatchObject({
      key: "scope:item-1",
      label: "Approve launch scope",
      kind: "scope_item",
      closeable: true,
    });
  });

  it("maps artifact and asset attachments to distinct tab kinds", () => {
    const artifactAttachment: DiscussionEntryAttachment = {
      id: "att-1",
      assetId: null,
      artifactId: "artifact-1",
      artifactType: "markdown",
      artifactTitle: "Launch brief",
    };
    const assetAttachment: DiscussionEntryAttachment = {
      id: "att-2",
      assetId: "asset-1",
      artifactId: null,
      artifactType: null,
      artifactTitle: null,
      assetContentType: "image/png",
      assetOriginalFilename: "screenshot.png",
      assetByteSize: 1200,
    };

    expect(threadAttachmentToTab(artifactAttachment, "entry-1")).toMatchObject({
      key: "artifact:artifact-1",
      label: "Launch brief",
      kind: "artifact",
    });
    expect(threadAttachmentToTab(assetAttachment, "entry-1")).toMatchObject({
      key: "asset:asset-1",
      label: "screenshot.png",
      kind: "asset",
    });
  });

  it("maps asset-backed artifact attachments to asset tabs", () => {
    const attachment: DiscussionEntryAttachment = {
      id: "att-asset-artifact",
      assetId: null,
      artifactId: "artifact-1",
      artifactType: "design",
      artifactTitle: "Brand deck",
      currentVersionStorageKind: "asset",
      currentVersionAssetId: "asset-9",
      currentVersionFilename: "deck.pdf",
      currentVersionContentType: "application/pdf",
      currentVersionByteSize: 2048,
    };

    expect(threadAttachmentToTab(attachment, "entry-1")).toMatchObject({
      key: "asset:asset-9",
      label: "deck.pdf",
      kind: "asset",
    });
  });

  it("deduplicates tabs and allows closing the final Open tab", () => {
    const tabs = [createOpenTab()];
    const scopeTab = scopeItemToTab(item());

    expect(ensureTab(ensureTab(tabs, scopeTab), scopeTab)).toHaveLength(2);
    expect(closeTab([createOpenTab(), scopeTab], OPEN_TAB_KEY)).toEqual([scopeTab]);
    expect(closeTab([createOpenTab(), scopeTab], scopeTab.key)).toEqual([createOpenTab()]);
    expect(closeTab([createOpenTab()], OPEN_TAB_KEY)).toEqual([]);
  });

  it("normalizes browser and map tabs", () => {
    expect(browserTab("https://www.example.com/path")).toMatchObject({
      key: "browser:https://www.example.com/path",
      label: "example.com",
      kind: "browser",
    });
    expect(createThreadMapTab("thread-1")).toMatchObject({
      key: "map:thread:thread-1",
      label: "Map",
      kind: "map",
    });
    expect(createGlobalMapTab()).toMatchObject({
      key: "map:global",
      label: "Global Map",
      kind: "map",
    });
  });

  it("extracts unique http urls and strips sentence punctuation", () => {
    expect(
      extractThreadUrls([
        "Open https://example.com/path, then https://aoa.test/deck).",
        "Duplicate https://example.com/path",
      ]),
    ).toEqual(["https://example.com/path", "https://aoa.test/deck"]);
  });

  it("extracts urls from thread title, entries, and sourceInfo", () => {
    const thread = {
      id: "thread-1",
      title: "Review https://thread.example",
      status: "active",
      scopeType: null,
      scopeId: null,
      scopeName: null,
      tags: [],
      entryCount: 1,
      pendingItemCount: 0,
      createdBy: "user",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      crewPaused: false,
      autonomyLevel: null,
      entries: [
        {
          id: "entry-1",
          inputType: "paste",
          rawContent: "Here is https://entry.example/doc",
          title: null,
          sourceInfo: { url: "https://source.example/call", ignored: 2 },
          departmentId: null,
          projectId: null,
          goalId: null,
          parentEntryId: null,
          authorAgentId: null,
          authorAgentName: null,
          authorAgentAvatar: null,
          extractionStatus: "completed",
          createdBy: "user",
          createdAt: "2026-06-04T00:00:00.000Z",
          extractedItems: [],
          annotations: [],
        },
      ],
    } satisfies DiscussionDetail;

    expect(extractUrlsFromThread(thread)).toEqual([
      "https://thread.example/",
      "https://entry.example/doc",
      "https://source.example/call",
    ]);
  });
});
