import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Compass,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Link as LinkIcon,
  Map,
  Network,
  PanelRightOpen,
  RefreshCw,
} from "lucide-react";
import type { ArtifactVersion, ArtifactWithVersions } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { SharedContentViewer } from "@/components/viewers/SharedContentViewer";
import { ViewerTabs, type ViewerTabModel } from "@/components/viewers/ViewerTabs";
import { resolveViewer } from "@/components/viewers/viewer-registry";
import { cn } from "@/lib/utils";
import { artifactsApi } from "../../api/artifacts";
import type {
  DiscussionDetail,
  DiscussionEntryAttachment,
  ExtractedItem,
} from "../../api/discussions";
import {
  OPEN_TAB_KEY,
  browserTab,
  createGlobalMapTab,
  createOpenTab,
  createThreadMapTab,
  extractUrlsFromThread,
  scopeItemToTab,
  threadAttachmentToTab,
  type ThreadViewerAttachmentPayload,
  type ThreadViewerBrowserPayload,
  type ThreadViewerMapPayload,
  type ThreadViewerScopePayload,
  type ThreadViewerTab,
  type ThreadViewerTabKind,
} from "./threadViewerModel";

interface ThreadViewerProps {
  thread: DiscussionDetail;
  tabs: ThreadViewerTab[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onOpenTab: (tab: ThreadViewerTab) => void;
  onOpenScopePanel: () => void;
  onToggleCollapse?: () => void;
}

const ICON_FOR_KIND: Record<ThreadViewerTabKind, typeof LayoutGrid> = {
  open: LayoutGrid,
  scope_item: Boxes,
  asset: ImageIcon,
  artifact: FileText,
  browser: Globe,
  map: Network,
};

export function ThreadViewer({
  thread,
  tabs,
  activeKey,
  onActivate,
  onClose,
  onOpenTab,
  onOpenScopePanel,
  onToggleCollapse,
}: ThreadViewerProps) {
  const activeTab = activeKey ? tabs.find((tab) => tab.key === activeKey) ?? null : null;
  const viewerTabs: ViewerTabModel[] = tabs.map((tab) => ({
    id: tab.key,
    kind: tab.kind,
    title: tab.label,
    closeable: tab.closeable,
    icon: ICON_FOR_KIND[tab.kind],
  }));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="thread-viewer">
      <ViewerTabs
        tabs={viewerTabs}
        activeKey={activeTab ? { id: activeTab.key, kind: activeTab.kind } : null}
        onActivate={(tab) => onActivate(tab.id)}
        onClose={(tab) => onClose(tab.id)}
        onAdd={() => onOpenTab(createOpenTab())}
        addLabel="Open viewer tab"
        onToggleCollapse={onToggleCollapse}
        tabListLabel="Open thread viewer tabs"
        headerTestId="thread-viewer-header"
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          <ThreadViewerBody
            thread={thread}
            tab={activeTab}
            onOpenTab={onOpenTab}
            onOpenScopePanel={onOpenScopePanel}
          />
        ) : (
          <ThreadViewerEmpty onOpen={() => onOpenTab(createOpenTab())} />
        )}
      </div>
    </div>
  );
}

interface ThreadCollapsedTabStripProps {
  tabs: ThreadViewerTab[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onExpand: () => void;
}

export function ThreadCollapsedTabStrip({
  tabs,
  activeKey,
  onActivate,
  onExpand,
}: ThreadCollapsedTabStripProps) {
  return (
    <aside
      className="flex h-full w-[46px] shrink-0 flex-col items-center bg-card"
      data-testid="thread-viewer-collapsed-strip"
    >
      <div className="flex h-[42px] w-full shrink-0 items-center justify-center border-b border-border">
        <button
          type="button"
          title="Open viewer"
          aria-label="Open viewer"
          onClick={onExpand}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <PanelRightOpen className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center gap-1 py-2">
        {tabs.map((tab) => {
          const Icon = ICON_FOR_KIND[tab.kind];
          const active = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              type="button"
              title={tab.label}
              aria-label={tab.label}
              data-tab-id={tab.key}
              data-tab-kind={tab.kind}
              data-active={active}
              onClick={() => {
                onActivate(tab.key);
                onExpand();
              }}
              className={cn(
                "relative flex size-10 items-center justify-center rounded-md",
                active
                  ? "bg-brand/[0.08] text-[hsl(15_60%_75%)]"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {active && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -left-[3px] top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ThreadViewerEmpty({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      className="flex h-full min-h-0 items-center justify-center p-6"
      data-testid="thread-viewer-empty"
    >
      <div className="max-w-xs text-center">
        <Compass className="mx-auto mb-3 h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">No viewer tab open</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Open files, links, scope items, maps, or a browser from this thread.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4 h-8 text-xs" onClick={onOpen}>
          Open
        </Button>
      </div>
    </div>
  );
}

function ThreadViewerBody({
  thread,
  tab,
  onOpenTab,
  onOpenScopePanel,
}: {
  thread: DiscussionDetail;
  tab: ThreadViewerTab;
  onOpenTab: (tab: ThreadViewerTab) => void;
  onOpenScopePanel: () => void;
}) {
  if (tab.key === OPEN_TAB_KEY || tab.kind === "open") {
    return (
      <ThreadOpenViewer
        thread={thread}
        onOpenTab={onOpenTab}
        onOpenScopePanel={onOpenScopePanel}
      />
    );
  }

  if (tab.kind === "scope_item") {
    const payload = tab.payload as ThreadViewerScopePayload | undefined;
    return payload ? (
      <ScopeItemViewer item={payload.item} onOpenScopePanel={onOpenScopePanel} />
    ) : null;
  }

  if (tab.kind === "asset") {
    const payload = tab.payload as ThreadViewerAttachmentPayload | undefined;
    return payload ? <AssetAttachmentViewer attachment={payload.attachment} /> : null;
  }

  if (tab.kind === "artifact") {
    const payload = tab.payload as ThreadViewerAttachmentPayload | undefined;
    return payload ? <ArtifactAttachmentViewer artifactId={payload.attachment.artifactId} /> : null;
  }

  if (tab.kind === "browser") {
    const payload = tab.payload as ThreadViewerBrowserPayload | undefined;
    return <BrowserViewer key={tab.key} initialUrl={payload?.url ?? "about:blank"} />;
  }

  if (tab.kind === "map") {
    const payload = tab.payload as ThreadViewerMapPayload | undefined;
    return <MapPlaceholder payload={payload} thread={thread} />;
  }

  return null;
}

function ThreadOpenViewer({
  thread,
  onOpenTab,
  onOpenScopePanel,
}: {
  thread: DiscussionDetail;
  onOpenTab: (tab: ThreadViewerTab) => void;
  onOpenScopePanel: () => void;
}) {
  const urls = useMemo(() => extractUrlsFromThread(thread), [thread]);
  const scopeItems = useMemo(
    () => thread.entries.flatMap((entry) => entry.extractedItems),
    [thread.entries],
  );
  const attachments = useMemo(
    () =>
      thread.entries.flatMap((entry) =>
        (entry.attachments ?? []).map((attachment) => ({ attachment, entryId: entry.id })),
      ),
    [thread.entries],
  );

  return (
    <div className="h-full min-h-0 overflow-auto p-3" data-testid="thread-open-viewer">
      <div className="space-y-3">
        <OpenSection title="Map" icon={Map}>
          <div className="grid grid-cols-2 gap-2">
            <OpenButton
              title="Thread map"
              subtitle="Relationships for this thread"
              icon={Network}
              onClick={() => onOpenTab(createThreadMapTab(thread.id))}
            />
            <OpenButton
              title="Global map"
              subtitle="All discussions placeholder"
              icon={Map}
              onClick={() => onOpenTab(createGlobalMapTab())}
            />
          </div>
        </OpenSection>

        <OpenSection title="Browser" icon={Globe}>
          <OpenButton
            title="New browser"
            subtitle="Open a URL in this viewer"
            icon={Globe}
            onClick={() => onOpenTab(browserTab("about:blank", "Browser"))}
          />
        </OpenSection>

        <OpenSection title="Scope items" icon={Boxes} trailing={scopeItems.length}>
          <div className="space-y-1">
            {scopeItems.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenTab(scopeItemToTab(item))}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 capitalize">{item.status}</span>
              </button>
            ))}
            {scopeItems.length === 0 && <EmptyLine>No scope items yet.</EmptyLine>}
            <button
              type="button"
              onClick={onOpenScopePanel}
              className="mt-1 inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Open Scope panel <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </OpenSection>

        <OpenSection title="Files & artifacts" icon={FolderOpen} trailing={attachments.length}>
          <div className="space-y-1">
            {attachments.map(({ attachment, entryId }) => (
              <button
                key={attachment.id}
                type="button"
                onClick={() => onOpenTab(threadAttachmentToTab(attachment, entryId))}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {attachment.artifactTitle || attachment.assetOriginalFilename || "Attached file"}
                </span>
              </button>
            ))}
            {attachments.length === 0 && <EmptyLine>No files attached yet.</EmptyLine>}
          </div>
        </OpenSection>

        <OpenSection title="Links" icon={LinkIcon} trailing={urls.length}>
          <div className="space-y-1">
            {urls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => onOpenTab(browserTab(url))}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{url}</span>
              </button>
            ))}
            {urls.length === 0 && <EmptyLine>No links detected in this thread.</EmptyLine>}
          </div>
        </OpenSection>
      </div>
    </div>
  );
}

function OpenSection({
  title,
  icon: Icon,
  trailing,
  children,
}: {
  title: string;
  icon: typeof LayoutGrid;
  trailing?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border/70 bg-card/50 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <h3 className="min-w-0 flex-1 text-xs font-semibold">{title}</h3>
        {trailing !== undefined && (
          <span className="text-[10px] tabular-nums text-muted-foreground">{trailing}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function OpenButton({
  title,
  subtitle,
  icon: Icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: typeof LayoutGrid;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background px-2 py-2 text-left transition-colors hover:bg-muted/50"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{title}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>;
}

function ScopeItemViewer({
  item,
  onOpenScopePanel,
}: {
  item: ExtractedItem;
  onOpenScopePanel: () => void;
}) {
  return (
    <div className="h-full min-h-0 overflow-auto p-4" data-testid="thread-scope-item-viewer">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {item.type}
          </div>
          <h3 className="mt-1 text-sm font-semibold leading-snug">{item.title}</h3>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
          {item.status}
        </span>
      </div>
      {item.description && (
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
      )}
      <dl className="space-y-2 text-xs">
        <MetaRow label="Priority" value={item.suggestedPriority ?? item.priority} />
        <MetaRow label="Layer" value={item.suggestedLayer ?? item.layer} />
        <MetaRow label="Assignee" value={item.suggestedAssigneeId} />
        <MetaRow label="Department" value={item.suggestedDepartmentId} />
      </dl>
      <Button type="button" variant="outline" size="sm" className="mt-4 h-8 text-xs" onClick={onOpenScopePanel}>
        Open Scope panel
      </Button>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
    </div>
  );
}

function AssetAttachmentViewer({ attachment }: { attachment: DiscussionEntryAttachment }) {
  const assetId = attachment.assetId;
  const filename = attachment.assetOriginalFilename || attachment.artifactTitle || "Attached file";
  const contentType = attachment.assetContentType || "application/octet-stream";

  if (!assetId) {
    return <CenteredMessage title="File unavailable" body="This attachment has no asset id." />;
  }

  const viewer = resolveViewer({
    contentType,
    filename,
    assetId,
    assetUrl: `/api/assets/${assetId}/content`,
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="thread-asset-viewer">
      <ViewerHeader title={filename} subtitle={viewer.label} url={viewer.assetUrl} />
      <SharedContentViewer viewer={viewer} filename={filename} />
    </div>
  );
}

function ArtifactAttachmentViewer({ artifactId }: { artifactId: string | null }) {
  const { data: artifact, isLoading, isError } = useQuery({
    queryKey: ["thread-viewer-artifact", artifactId],
    queryFn: () => artifactsApi.get(artifactId!),
    enabled: Boolean(artifactId),
  });

  if (!artifactId) {
    return <CenteredMessage title="Artifact unavailable" body="This attachment has no artifact id." />;
  }
  if (isLoading) return <CenteredMessage title="Loading artifact" body="Fetching the latest version." />;
  if (isError || !artifact) {
    return <CenteredMessage title="Artifact unavailable" body="Could not load this artifact." />;
  }

  const version = artifact.versions[0] ?? null;
  if (!version) {
    return <CenteredMessage title={artifact.title} body="This artifact has no versions yet." />;
  }

  const inlineContent = version.content ?? null;
  const contentType = contentTypeFromArtifactVersion(artifact, version);
  const viewer = resolveViewer({
    contentType,
    filename: artifact.title,
    assetId: null,
    assetUrl: version.fileUrl,
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="thread-artifact-viewer">
      <ViewerHeader
        title={artifact.title}
        subtitle={`${viewer.label} - v${version.versionNumber}`}
        url={viewer.assetUrl}
      />
      <SharedContentViewer
        viewer={viewer}
        filename={artifact.title}
        inlineTextContent={inlineContent}
      />
    </div>
  );
}

export function BrowserViewer({ initialUrl }: { initialUrl: string }) {
  const [iframeKey, setIframeKey] = useState(0);
  const [draftUrl, setDraftUrl] = useState(initialUrl === "about:blank" ? "" : initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const showFrame = url !== "about:blank";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = normalizeBrowserUrl(draftUrl);
    setDraftUrl(next);
    setUrl(next || "about:blank");
    setIframeKey((key) => key + 1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="thread-browser-viewer">
      <form onSubmit={submit} className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          placeholder="Enter a URL"
          className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-brand"
          aria-label="Browser URL"
          data-testid="thread-browser-url-input"
        />
        <Button type="submit" size="sm" className="h-7 px-2 text-xs">
          Open
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setIframeKey((key) => key + 1)}
          title="Reload"
          aria-label="Reload browser preview"
          data-testid="thread-browser-reload"
          disabled={!showFrame}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        {showFrame && (
          <Button asChild type="button" variant="ghost" size="icon" className="h-7 w-7" title="Open externally">
            <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open browser preview externally">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </form>
      {showFrame ? (
        <iframe
          key={iframeKey}
          title={url}
          src={url}
          className="min-h-0 flex-1 border-0 bg-background"
          sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
          data-testid="thread-browser-iframe"
        />
      ) : (
        <CenteredMessage title="Browser" body="Enter a URL to open it in the viewer." />
      )}
    </div>
  );
}

function MapPlaceholder({
  payload,
  thread,
}: {
  payload?: ThreadViewerMapPayload;
  thread: DiscussionDetail;
}) {
  const global = payload?.scope === "global";
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-5" data-testid="thread-map-placeholder">
      <div className="w-full max-w-sm rounded-md border border-border bg-muted/20 p-4 text-center">
        <Network className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
        <div className="text-sm font-semibold">{global ? "Global map" : "Thread map"}</div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {global
            ? "The global discussions relationship map will be wired here later."
            : `Relationships for "${thread.title}" will be wired here later.`}
        </p>
      </div>
    </div>
  );
}

function ViewerHeader({
  title,
  subtitle,
  url,
}: {
  title: string;
  subtitle: string;
  url: string | null;
}) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      {url && (
        <Button asChild type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        </Button>
      )}
    </div>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-5">
      <div className="max-w-xs text-center">
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function extensionFromName(value: string | null | undefined): string {
  const name = value?.split(/[?#]/, 1)[0]?.trim().toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

function contentTypeFromArtifactVersion(
  artifact: ArtifactWithVersions,
  version: ArtifactVersion,
): string {
  const extension = extensionFromName(artifact.title) || extensionFromName(version.fileUrl);
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "html":
    case "htm":
      return "text/html";
    case "md":
    case "mdx":
      return "text/markdown";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
  }
  if (artifact.type === "design" && version.fileUrl) return "image/png";
  if (version.content !== null && version.content !== undefined) {
    if (artifact.type === "code") return "text/plain";
    if (artifact.type === "document") return "text/markdown";
    return "text/plain";
  }
  return "application/octet-stream";
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "about:blank") return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
