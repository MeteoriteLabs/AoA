import { useQuery } from "@tanstack/react-query";
import { FileText, Globe, Home, ListTodo } from "lucide-react";
import type { CommanderOutputRef } from "@armyofagents/shared";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "../../../lib/utils";
import { COMMANDER_PANEL_CARD } from "../commanderChrome";
import { artifactsApi } from "../../../api/artifacts";
import { BrowserViewer } from "../../viewers/BrowserViewer";
import { ViewerTabs, type ViewerTabModel } from "../../viewers/ViewerTabs";
import { SharedContentViewer } from "../../viewers/SharedContentViewer";
import {
  assetUrlForArtifactVersion,
  contentTypeForArtifactVersion,
  filenameForArtifactVersion,
} from "../../viewers/artifact-version-viewer";
import { resolveViewer } from "../../viewers/viewer-registry";
import { CommanderViewerHome } from "./CommanderViewerHome";
import { TaskDetail } from "../../TaskDetail";
import type { CommanderViewerApi } from "./useCommanderViewer";
import type { ConversationViewerState, ViewerTab } from "./commanderViewerModel";

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

  const filename = filenameForArtifactVersion(artifact, version);
  const contentType = contentTypeForArtifactVersion(artifact, version);
  const viewer = resolveViewer({
    contentType,
    filename,
    assetId: version.assetId,
    assetUrl: assetUrlForArtifactVersion(version),
  });

  return (
    <SharedContentViewer
      viewer={viewer}
      filename={filename}
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

interface TaskDetailTabBodyProps {
  tab: ViewerTab;
  onDismiss: () => void;
}

function TaskDetailTabBody({ tab, onDismiss }: TaskDetailTabBodyProps) {
  // tab.refId is the issueId. Only mounted while active → active is true; TaskDetail
  // gates its own (incl. polling) queries on `active`.
  return <TaskDetail issueId={tab.refId} active onDismiss={onDismiss} />;
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
  onCloseTab: (id: string) => void;
}

export function TabBodySwitch({
  activeId,
  activeTab,
  companyId,
  conversationRefs,
  onOpen,
  onCloseTab,
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

  if (activeTab.kind === "task") {
    // Keyed per tab so switching between two task tabs remounts — TaskDetail holds
    // internal UI state (sidebarMode, detailTab, …) that must not bleed across issues.
    return (
      <TaskDetailTabBody
        key={activeTab.id}
        tab={activeTab}
        onDismiss={() => onCloseTab(activeTab.id)}
      />
    );
  }

  return (
    <UnavailableBody message="This item is no longer available (it may have been deleted, or you may not have access)." />
  );
}

// ---------------------------------------------------------------------------
// Tab model builder (shared between Panel and AgentPanelContent)
// ---------------------------------------------------------------------------

export function buildViewerTabModels(state: ConversationViewerState): ViewerTabModel[] {
  return [
    { id: "home", kind: "home", title: "Home", icon: Home, closeable: false },
    ...state.tabs.map(
      (t): ViewerTabModel => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        icon: t.kind === "browser" ? Globe : t.kind === "task" ? ListTodo : FileText,
      }),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Desktop detail card (owned width/height comes from the Panel parent)
// ---------------------------------------------------------------------------

export interface CommanderViewerDetailProps {
  viewer: CommanderViewerApi;
  companyId: string;
  conversationRefs: CommanderOutputRef[];
  activeTab: ViewerTab | undefined;
  tabModels: ViewerTabModel[];
  /** Global bridge: collapse the panel (persists) — wired by AgentPanelContent. */
  onCollapse: () => void;
}

export function CommanderViewerDetail({
  viewer,
  companyId,
  conversationRefs,
  activeTab,
  tabModels,
  onCollapse,
}: CommanderViewerDetailProps) {
  const state = viewer.state;
  const activeKey = {
    id: state.activeId,
    kind: state.activeId === "home" ? "home" : (activeTab?.kind ?? "home"),
  };
  return (
    <div
      data-testid="commander-viewer-panel"
      className={cn("relative flex h-full min-w-0 flex-1 flex-col", COMMANDER_PANEL_CARD)}
    >
      <ViewerTabs
        tabs={tabModels}
        activeKey={activeKey}
        onActivate={(tab) => viewer.activate(tab.id)}
        onClose={(tab) => viewer.close(tab.id)}
        onAdd={() => viewer.activate("home")}
        addLabel="Open viewer home"
        onToggleCollapse={onCollapse}
        headerTestId="commander-viewer-tabs"
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <TabBodySwitch
          activeId={state.activeId}
          activeTab={activeTab}
          companyId={companyId}
          conversationRefs={conversationRefs}
          onOpen={viewer.openRef}
          onCloseTab={viewer.close}
        />
      </div>
    </div>
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
// Main export — mobile only (desktop is composed by AgentPanelContent's Group)
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
  const state = viewer.state;
  const activeTab = state.tabs.find((t) => t.id === state.activeId);
  const tabModels = buildViewerTabModels(state);

  if (!isMobile) return null; // desktop is composed by AgentPanelContent's Group

  // ---------- Mobile (UNCHANGED pill + Sheet) ----------
  const activeKey = {
    id: state.activeId,
    kind: state.activeId === "home" ? "home" : (activeTab?.kind ?? "home"),
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
            onAdd={() => viewer.activate("home")}
            addLabel="Open viewer home"
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
              onCloseTab={viewer.close}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
