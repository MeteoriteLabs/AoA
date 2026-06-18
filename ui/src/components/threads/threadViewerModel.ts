import type {
  DiscussionDetail,
  DiscussionEntry,
  DiscussionEntryAttachment,
} from "../../api/discussions";

export type ThreadViewerTabKind =
  | "open"
  | "scope_item"
  | "task"
  | "task_output"
  | "memory"
  | "artifact_ref"
  | "asset"
  | "artifact"
  | "browser"
  | "map";

export interface ThreadViewerTab {
  key: string;
  label: string;
  kind: ThreadViewerTabKind;
  closeable: boolean;
  payload?: unknown;
}

export interface ThreadViewerScopeItem {
  id: string;
  type: string;
  kind?: string;
  scopeVersionId?: string | null;
  title: string;
  description: string | null;
  status: string;
  resultIssueId?: string | null;
  resultMemoryId?: string | null;
  artifactId?: string | null;
  artifactVersionId?: string | null;
  sourceEntryIds?: unknown[];
  payload?: Record<string, unknown>;
  suggestedPriority?: string | null;
  priority?: string | null;
  suggestedAssigneeId?: string | null;
  suggestedDepartmentId?: string | null;
  suggestedLayer?: string | null;
  layer?: string | null;
}

export interface ThreadViewerScopePayload {
  item: ThreadViewerScopeItem;
}

export interface ThreadViewerAttachmentPayload {
  attachment: DiscussionEntryAttachment;
  entryId?: string;
}

export interface ThreadViewerTaskPayload {
  issueId: string;
  title: string;
  scopeItemId?: string;
}

export interface ThreadViewerTaskOutputPayload {
  issueId: string;
  title: string;
  scopeItemId?: string;
}

export interface ThreadViewerMemoryPayload {
  companyId: string;
  memoryId: string;
  title: string;
  scopeItemId?: string;
}

export interface ThreadViewerArtifactRefPayload {
  artifactId: string;
  artifactVersionId?: string | null;
  title: string;
  scopeItemId?: string;
}

export interface ThreadViewerBrowserPayload {
  url: string;
  title: string;
}

export interface ThreadViewerMapPayload {
  scope: "thread" | "global";
  threadId?: string;
}

export const OPEN_TAB_KEY = "open";
const TRAILING_URL_PUNCTUATION = /[.,!?;:)\]}]+$/;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;

export function createOpenTab(): ThreadViewerTab {
  return {
    key: OPEN_TAB_KEY,
    label: "Open",
    kind: "open",
    closeable: true,
  };
}

export function createThreadMapTab(threadId: string): ThreadViewerTab {
  return {
    key: `map:thread:${threadId}`,
    label: "Map",
    kind: "map",
    closeable: true,
    payload: { scope: "thread", threadId } satisfies ThreadViewerMapPayload,
  };
}

export function createGlobalMapTab(): ThreadViewerTab {
  return {
    key: "map:global",
    label: "Global Map",
    kind: "map",
    closeable: true,
    payload: { scope: "global" } satisfies ThreadViewerMapPayload,
  };
}

export function scopeItemToTab(item: ThreadViewerScopeItem): ThreadViewerTab {
  return {
    key: `scope:${item.id}`,
    label: item.title || "Scope item",
    kind: "scope_item",
    closeable: true,
    payload: { item } satisfies ThreadViewerScopePayload,
  };
}

export function taskTab(issueId: string, title: string, scopeItemId?: string): ThreadViewerTab {
  return {
    key: `task:${issueId}`,
    label: title || "Task",
    kind: "task",
    closeable: true,
    payload: { issueId, title: title || "Task", scopeItemId } satisfies ThreadViewerTaskPayload,
  };
}

export function taskOutputTab(issueId: string, title: string, scopeItemId?: string): ThreadViewerTab {
  return {
    key: `task-output:${issueId}`,
    label: `${title} · Outputs` || "Task Outputs",
    kind: "task_output",
    closeable: true,
    payload: { issueId, title: title || "Task", scopeItemId } satisfies ThreadViewerTaskOutputPayload,
  };
}

export function memoryTab(
  companyId: string,
  memoryId: string,
  title: string,
  scopeItemId?: string,
): ThreadViewerTab {
  return {
    key: `memory:${memoryId}`,
    label: title || "Memory",
    kind: "memory",
    closeable: true,
    payload: { companyId, memoryId, title: title || "Memory", scopeItemId } satisfies ThreadViewerMemoryPayload,
  };
}

export function artifactRefTab(
  artifactId: string,
  title: string,
  artifactVersionId?: string | null,
  scopeItemId?: string,
): ThreadViewerTab {
  const scopeSuffix = scopeItemId ?? artifactVersionId ?? "latest";
  return {
    key: `artifact-ref:${artifactId}:${scopeSuffix}`,
    label: title || "Artifact",
    kind: "artifact_ref",
    closeable: true,
    payload: {
      artifactId,
      artifactVersionId,
      title: title || "Artifact",
      scopeItemId,
    } satisfies ThreadViewerArtifactRefPayload,
  };
}

export function scopeArtifactToTab(item: ThreadViewerScopeItem): ThreadViewerTab | null {
  if (!item.artifactId) return null;
  return artifactRefTab(item.artifactId, item.title, item.artifactVersionId, item.id);
}

export function threadAttachmentToTab(
  attachment: DiscussionEntryAttachment,
  entryId?: string,
): ThreadViewerTab {
  const isArtifact = Boolean(attachment.artifactId);
  const title =
    attachment.artifactTitle ||
    attachment.assetOriginalFilename ||
    (isArtifact ? "Artifact" : "File");

  return {
    key: isArtifact
      ? `artifact:${attachment.artifactId}`
      : `asset:${attachment.assetId ?? attachment.id}`,
    label: title,
    kind: isArtifact ? "artifact" : "asset",
    closeable: true,
    payload: { attachment, entryId } satisfies ThreadViewerAttachmentPayload,
  };
}

export function browserTab(url: string, title?: string): ThreadViewerTab {
  const normalizedUrl = normalizeUrl(url);
  return {
    key: `browser:${normalizedUrl}`,
    label: title || browserLabel(normalizedUrl),
    kind: "browser",
    closeable: true,
    payload: { url: normalizedUrl, title: title || browserLabel(normalizedUrl) } satisfies ThreadViewerBrowserPayload,
  };
}

export function ensureTab(tabs: ThreadViewerTab[], tab: ThreadViewerTab): ThreadViewerTab[] {
  return tabs.some((existing) => existing.key === tab.key) ? tabs : [...tabs, tab];
}

export function closeTab(tabs: ThreadViewerTab[], key: string): ThreadViewerTab[] {
  return tabs.filter((tab) => tab.key !== key || !tab.closeable);
}

export function extractThreadUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const value of values) {
    for (const match of value.matchAll(URL_PATTERN)) {
      const url = normalizeUrl(match[0].replace(TRAILING_URL_PUNCTUATION, ""));
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }

  return urls;
}

export function extractUrlsFromThread(thread: DiscussionDetail | null | undefined): string[] {
  if (!thread) return [];
  const values: string[] = [thread.title];
  for (const entry of thread.entries) {
    values.push(entry.rawContent);
    values.push(...sourceInfoValues(entry));
  }
  return extractThreadUrls(values);
}

function sourceInfoValues(entry: DiscussionEntry): string[] {
  if (!entry.sourceInfo) return [];
  return Object.values(entry.sourceInfo)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value.length > 0);
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url.trim();
  }
}

function browserLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Browser";
  } catch {
    return "Browser";
  }
}
