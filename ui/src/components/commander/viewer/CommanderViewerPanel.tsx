import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, FileText, Globe, Home } from "lucide-react";
import type { ArtifactWithVersions, ArtifactVersion } from "@armyofagents/shared";
import type { CommanderOutputRef } from "@armyofagents/shared";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { artifactsApi } from "../../../api/artifacts";
import { BrowserViewer } from "../../viewers/BrowserViewer";
import { ViewerTabs, type ViewerTabModel } from "../../viewers/ViewerTabs";
import { SharedContentViewer } from "../../viewers/SharedContentViewer";
import { resolveViewer } from "../../viewers/viewer-registry";
import { CommanderViewerHome } from "./CommanderViewerHome";
import type { CommanderViewerApi } from "./useCommanderViewer";
import type { ViewerTab } from "./commanderViewerModel";

const MIN_WIDTH = 320;
const MAX_WIDTH_FRACTION = 0.6;
const DEFAULT_WIDTH_FRACTION = 0.4;

// ---------------------------------------------------------------------------
// Helpers for artifact content-type resolution (mirrors ThreadViewer logic)
// ---------------------------------------------------------------------------

function extensionFromName(value: string | null | undefined): string {
  const name = value?.split(/[?#]/, 1)[0]?.trim().toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

function contentTypeForArtifactVersion(
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

// ---------------------------------------------------------------------------
// Tab body sub-components
// ---------------------------------------------------------------------------

function LoadingBody() {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function UnavailableBody({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

interface ArtifactTabBodyProps {
  tab: ViewerTab;
}

function ArtifactTabBody({ tab }: ArtifactTabBodyProps) {
  const {
    data: artifact,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["commander-viewer-artifact", tab.refId],
    queryFn: () => artifactsApi.get(tab.refId),
    enabled: Boolean(tab.refId),
  });

  if (isLoading) return <LoadingBody />;

  if (isError || !artifact) {
    return (
      <UnavailableBody message="This item is no longer available (it may have been deleted, or you may not have access)." />
    );
  }

  // Pick the version by versionId match, else versions[0].
  const version =
    (tab.versionId ? artifact.versions.find((v) => v.id === tab.versionId) : null) ??
    artifact.versions[0] ??
    null;

  if (!version) {
    return <UnavailableBody message={`${artifact.title} has no versions yet.`} />;
  }

  const contentType = contentTypeForArtifactVersion(artifact, version);
  const viewer = resolveViewer({
    contentType,
    filename: artifact.title,
    assetUrl: version.fileUrl ?? null,
  });

  return (
    <SharedContentViewer
      viewer={viewer}
      filename={artifact.title}
      inlineTextContent={version.content ?? null}
    />
  );
}

interface ReplyTabBodyProps {
  replyContent: string;
}

function ReplyTabBody({ replyContent }: ReplyTabBodyProps) {
  const viewer = resolveViewer({ contentType: "text/markdown", filename: "reply.md" });
  return (
    <SharedContentViewer viewer={viewer} filename="Commander reply" inlineTextContent={replyContent} />
  );
}

// ---------------------------------------------------------------------------
// Desktop resizable panel
// ---------------------------------------------------------------------------

interface DesktopPanelProps {
  viewer: CommanderViewerApi;
  companyId: string;
  conversationRefs: CommanderOutputRef[];
  activeTab: ViewerTab | undefined;
  tabModels: ViewerTabModel[];
  /** Lifted from parent so width survives collapse/expand cycles (Fix 3). */
  width: number | null;
  onWidthChange: (w: number) => void;
}

function DesktopPanel({
  viewer,
  companyId,
  conversationRefs,
  activeTab,
  tabModels,
  width,
  onWidthChange,
}: DesktopPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pointer-drag divider — uses pointer capture so out-of-window drags work (Fix 2).
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startWidth = containerRef.current?.offsetWidth ?? width ?? 400;
      const parentWidth = containerRef.current?.parentElement?.offsetWidth ?? window.innerWidth;

      const cleanup = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      };

      const onMove = (ev: PointerEvent) => {
        // Belt-and-braces: treat a missed pointerup as cleanup.
        if (ev.buttons === 0) { cleanup(); return; }
        const delta = startX - ev.clientX;
        const next = Math.min(
          Math.max(startWidth + delta, MIN_WIDTH),
          parentWidth * MAX_WIDTH_FRACTION,
        );
        onWidthChange(next);
      };

      const onUp = () => { cleanup(); };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [width, onWidthChange],
  );

  const state = viewer.state;
  const parentWidth =
    typeof window !== "undefined"
      ? (containerRef.current?.parentElement?.offsetWidth ?? window.innerWidth)
      : 800;
  const resolvedWidth = width ?? Math.round(parentWidth * DEFAULT_WIDTH_FRACTION);

  const activeKey = {
    id: state.activeId,
    kind:
      state.activeId === "home"
        ? "home"
        : (activeTab?.kind ?? "home"),
  };

  return (
    <div
      ref={containerRef}
      data-testid="commander-viewer-panel"
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-card"
      style={{ width: resolvedWidth }}
    >
      {/* Drag handle — 8px hit area straddles the border; pointer capture handles out-of-window drags */}
      <div
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize viewer panel"
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize touch-none hover:bg-brand/30 active:bg-brand/50"
      />

      <ViewerTabs
        tabs={tabModels}
        activeKey={activeKey}
        onActivate={(tab) => viewer.activate(tab.id)}
        onClose={(tab) => viewer.close(tab.id)}
        onToggleCollapse={viewer.collapse}
        headerTestId="commander-viewer-tabs"
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <TabBodySwitch
          activeId={state.activeId}
          activeTab={activeTab}
          companyId={companyId}
          conversationRefs={conversationRefs}
          onOpen={viewer.openRef}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop collapsed rail
// ---------------------------------------------------------------------------

interface DesktopRailProps {
  viewer: CommanderViewerApi;
  tabModels: ViewerTabModel[];
}

function DesktopRail({ viewer, tabModels }: DesktopRailProps) {
  return (
    <div
      data-testid="commander-viewer-rail"
      className="flex h-full w-9 shrink-0 flex-col items-center gap-1 border-l border-border bg-card py-2"
    >
      <button
        type="button"
        title="Expand viewer"
        aria-label="Expand viewer"
        onClick={viewer.expand}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <ChevronsLeft className="size-3.5" aria-hidden />
      </button>

      {/* Home icon */}
      <button
        type="button"
        title="Viewer home"
        aria-label="Viewer home"
        onClick={() => {
          viewer.expand();
          viewer.activate("home");
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <Home className="size-3.5" aria-hidden />
      </button>

      {/* One icon per open tab */}
      {tabModels
        .filter((t) => t.id !== "home")
        .map((t) => {
          const Icon = t.icon ?? FileText;
          return (
            <button
              key={t.id}
              type="button"
              title={t.title}
              aria-label={t.title}
              onClick={() => {
                viewer.expand();
                viewer.activate(t.id);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <Icon className="size-3.5" aria-hidden />
            </button>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab body switcher (shared between desktop panel + mobile sheet)
// ---------------------------------------------------------------------------

interface TabBodySwitchProps {
  activeId: string;
  activeTab: ViewerTab | undefined;
  companyId: string;
  conversationRefs: CommanderOutputRef[];
  onOpen: (ref: CommanderOutputRef) => void;
}

function TabBodySwitch({
  activeId,
  activeTab,
  companyId,
  conversationRefs,
  onOpen,
}: TabBodySwitchProps) {
  if (activeId === "home" || !activeTab) {
    return (
      <CommanderViewerHome
        companyId={companyId}
        conversationRefs={conversationRefs}
        onOpen={onOpen}
      />
    );
  }

  if (activeTab.kind === "artifact") {
    return <ArtifactTabBody tab={activeTab} />;
  }

  if (activeTab.kind === "reply" && activeTab.replyContent != null) {
    return <ReplyTabBody replyContent={activeTab.replyContent} />;
  }

  if (activeTab.kind === "browser") {
    // Keyed per tab so switching between two browser tabs remounts with the
    // right initialUrl (BrowserViewer seeds its url state on mount).
    return <BrowserViewer key={activeTab.id} initialUrl={activeTab.url ?? "about:blank"} />;
  }

  return (
    <UnavailableBody message="This item is no longer available (it may have been deleted, or you may not have access)." />
  );
}

// ---------------------------------------------------------------------------
// Mobile floating pill
// ---------------------------------------------------------------------------

interface MobilePillProps {
  viewer: CommanderViewerApi;
}

function MobilePill({ viewer }: MobilePillProps) {
  return (
    <button
      type="button"
      data-testid="commander-viewer-pill"
      aria-label={
        viewer.pendingBadge > 0
          ? `Open viewer — ${viewer.pendingBadge} new`
          : "Open viewer"
      }
      onClick={() => {
        viewer.expand();
        viewer.clearBadge();
      }}
      className="fixed bottom-20 right-4 z-50 flex h-11 items-center gap-2 rounded-full border border-border bg-card px-3 shadow-lg lg:hidden"
    >
      <FileText className="size-4 text-muted-foreground" />
      {viewer.pendingBadge > 0 && (
        <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
          {viewer.pendingBadge}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface CommanderViewerPanelProps {
  viewer: CommanderViewerApi;
  companyId: string;
  conversationRefs: CommanderOutputRef[];
  /** True on mobile breakpoints — caller passes (e.g. from window width check). */
  isMobile: boolean;
}

export function CommanderViewerPanel({
  viewer,
  companyId,
  conversationRefs,
  isMobile,
}: CommanderViewerPanelProps) {
  // Fix 3: width lives here (not in DesktopPanel) so it survives collapse ↔ expand cycles.
  // DesktopPanel unmounts when collapsed to the rail; this component stays mounted.
  const [panelWidth, setPanelWidth] = useState<number | null>(null);

  const state = viewer.state;
  const activeTab = state.tabs.find((t) => t.id === state.activeId);

  const tabModels: ViewerTabModel[] = [
    { id: "home", kind: "home", title: "Home", icon: Home, closeable: false },
    ...state.tabs.map(
      (t): ViewerTabModel => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        icon: t.kind === "browser" ? Globe : FileText,
      }),
    ),
  ];

  // ---------- Mobile ----------
  if (isMobile) {
    const activeKey = {
      id: state.activeId,
      kind:
        state.activeId === "home" ? "home" : (activeTab?.kind ?? "home"),
    };

    return (
      <>
        <MobilePill viewer={viewer} />

        <Sheet
          open={state.expanded}
          onOpenChange={(open) => {
            if (!open) viewer.collapse();
          }}
        >
          <SheetContent
            side="right"
            showCloseButton={false}
            className="flex flex-col p-0"
          >
            <SheetTitle className="sr-only">Commander Viewer</SheetTitle>

            <ViewerTabs
              tabs={tabModels}
              activeKey={activeKey}
              onActivate={(tab) => viewer.activate(tab.id)}
              onClose={(tab) => viewer.close(tab.id)}
              onToggleCollapse={viewer.collapse}
              headerTestId="commander-viewer-tabs"
            />

            <div className="min-h-0 flex-1 overflow-hidden">
              <TabBodySwitch
                activeId={state.activeId}
                activeTab={activeTab}
                companyId={companyId}
                conversationRefs={conversationRefs}
                onOpen={viewer.openRef}
              />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // ---------- Desktop ----------
  if (!state.expanded) {
    return <DesktopRail viewer={viewer} tabModels={tabModels} />;
  }

  return (
    <DesktopPanel
      viewer={viewer}
      companyId={companyId}
      conversationRefs={conversationRefs}
      activeTab={activeTab}
      tabModels={tabModels}
      width={panelWidth}
      onWidthChange={setPanelWidth}
    />
  );
}
